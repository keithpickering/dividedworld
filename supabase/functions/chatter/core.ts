/**
 * The pool's daily run, as a pure module (the staff roster design, sections 4 to 8; its plan, Task 10): it takes a `Db`, the `Models`, the
 * instance, the minute the schedule fired for and nothing else, and does the run the plan lists. supabase/functions/chatter/index.ts is the
 * thin Edge Function around it; this file is what Node tests (core.test.ts) and Deno both run. The engine's side of the call (who posts, the
 * prompt, the repair) is engine/system/pool.ts and engine/system/chatter.ts; this file moves data between the database, the model and them.
 *
 *   1. Nothing at all unless `systemEnabled`.
 *   2. The week's spend (`pool_week`), the season and offices (`pool_context`), the last day's signals (`pool_signals`) and each persona's
 *      memory: the pick's inputs.
 *   3. `candidates`, then `pick`, seeded from the day.
 *   4. For each pick: its career, memory, notes and thread; then one model call, duty `chatter`, with `staff` set, so the call is a ledger row
 *      (models(), "Cost is a column"). A chat persona is asked in structure; a persona on the old voice writes its words in raw completion.
 *   5. The answer is repaired (repairChatter): every bound trimmed and named, and only what cannot be repaired without inventing content is rejected.
 *   6. The post (`write_staff_act` or `write_staff_thread`), then the card if one was asked for and a slot is left, then the note, then the spend.
 *
 * **A rerun the same day posts nothing twice.** The pick is seeded from the day and the allowance is computed from the week before today, so a
 * rerun picks the same personas. A persona with a spend row today is skipped (`already`), and the run stops at the day's allowance, counting
 * the rows already there, so even a rerun whose window shifted (a different slot) cannot spend more than the day was given. A crash between a
 * post and its spend leaves a post with no row: every pool post, and the card played with it, carries `pool: <day>` in its payload (a Cast takes `pool_day`; a Set's payload is empty by
 * rule, and it is tied by landing on the post itself), and the run starts by asking `pool_orphans` for the week's posts with no spend, every day from Monday to today (the
 * run is daily, so a crash's orphan is met the next day). Each is adopted: its spend is recorded on its own day, with the card tied to it by
 * the marker and the target, so the week counts the post, the card's slot and the thread, and nothing is written twice. This is done before
 * the week is read. The one thing a crash there loses is that post's note, never a second post or an uncounted card.
 *
 * **One run at a time.** The first thing a run does after the System-enabled check is `claim_pool_run(day, CLAIM_LEASE)`. A run that loses
 * the claim (another run of the day holds one younger than the lease) returns `busy` having written nothing. A crashed run's claim ages out.
 *
 * **Failures.** A model's transport failure is retried on the request itself, inside models() ("Three unrelated timeouts are not a poison
 * pill"); this file never retries a pick. An answer that is rejected, or a call that fails, is skipped and spends nothing. A database error
 * stops that pick (the run goes on to the next) and is written on the pick's record in the result.
 *
 * **Where the trims and the errors go.** The call's ledger row (models(), duty `chatter`) is written when the call returns, before the answer is
 * repaired, and is append-only, so it holds the model-level result and nothing of this file's repair. The trims repairChatter makes, the
 * card rules' refusal and a failed note are written on the pick's `record` in its spend row (`pool_spends.record`, which exists once the post
 * does). A rejected answer, a failed call and a failed write spend nothing, so no row exists to carry them: their predicate or error is in the
 * returned result (and in the function's console.warn, index.ts), which is all there is of them. A ledger row that could not be written stops
 * the run: an unrecorded call is not trusted.
 *
 * **Cost does not grow with the instance.** One light-tier call per pick, at most the day's allowance (a week's pool over its days), and
 * reads bounded by the roster, the signals' own caps and `chatterThreadPosts`. Nothing here reads a row per player, character or Act.
 *
 * Nothing private reaches the model: the signals come from the digest role, the thread from public play, and the memory and career are a
 * staff character's. A card's target is the post the pick replies to, or the persona's own post, chosen from the trigger, never from who
 * owns anything. A card's options are the persona's own words (an ink, a phrase), held to the card's own rules as a player's are: read the
 * target as the act function does (`card_target_reach`), then `validateConfig`, `effectsOnTarget` and `decidePlay` or `decideSet`. When they
 * fail, the trim names the predicate and plain code's seeded configuration is played instead; where code can build none, the card is dropped
 * (`cardRefused`) and the post stands. The database then holds every rule it holds for a player's play.
 */
import { atOrBelow, decidePlay, decideSet, effectsOnTarget, playOf, postTarget, staffConfigOf, staffOffers, type CardEffect, type CardTarget, type EffectsAbove } from '../../../engine/rules/cards.ts';
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import type { Career } from '../../../engine/system/career.ts';
import {
  POOL_PREMISE,
  chatterRule,
  chatterCompletion,
  chatterPrompt,
  chatterSchema,
  repairChatter,
  type OfferedCard,
  type ThreadPost,
} from '../../../engine/system/chatter.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import type { Memory } from '../../../engine/system/memory.ts';
import type { Models } from '../../../engine/system/model.ts';
import {
  allowance,
  candidates,
  dayOf,
  dayRng,
  pick,
  priorities,
  seededRng,
  type PoolPhase,
  type PoolPick,
  type PoolSignals,
} from '../../../engine/system/pool.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';

const DAY = 86_400_000;

/**
 * How long a run's claim on its day holds. It is longer than the run can last: the schedule gives the function 150 seconds
 * (supabase/migrations/0089_pool_spends.sql, `timeout_milliseconds`), and the platform kills a function well before ten minutes, so a claim
 * younger than this belongs to a run that may still be writing, and an older one to a run that is dead. A crashed run's claim is its own way
 * out: it ages out, and the next run goes ahead.
 */
export const CLAIM_LEASE = '10 minutes';

interface Orphan { readonly staff: string; readonly day: string; readonly act: string; readonly startedThread: boolean; readonly card: string | null }

/**
 * The posts an earlier run (today's, or an earlier day of this ISO week) wrote and died before spending: each is recorded on its own day,
 * with the card tied to it exactly (the card Act carries the same `pool` marker), so the week counts the post and the card, and nothing is
 * written twice. Done before the week is read, so the allowance and the thread share see them. The run is once a day, so an orphan is
 * always met a day later at the soonest: adopting only today's would count none. A database error on one is recorded on its result and the
 * others go on.
 */
async function adoptOrphans(db: Db, today: string): Promise<PickRecord[]> {
  const found = await db.rpc<Orphan[]>('pool_orphans', { through: today });
  const adopted: PickRecord[] = [];
  for (const o of found) {
    const base = { staff: o.staff, trigger: 'adopted', trims: [] as Trim[], day: o.day, post: o.act };
    try {
      await db.rpc('record_pool_spend', { on_day: o.day, of_staff: o.staff, by_trigger: 'adopted', post: o.act, card: o.card, started: o.startedThread, note: { adopted: true } });
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      adopted.push({ ...base, status: 'failed', why: said(e) });
      continue;
    }
    adopted.push({ ...base, status: 'adopted', startedThread: o.startedThread, ...(o.card ? { card: o.card } : {}) });
  }
  return adopted;
}

/** What a pick came to. `posted` and `adopted` spent a slot; every other status spent nothing. */
export type PickStatus = 'posted' | 'adopted' | 'already' | 'skipped' | 'rejected' | 'failed';

export interface PickRecord {
  readonly staff: string;
  readonly trigger: string;
  readonly status: PickStatus;
  /** Why a pick that spent nothing did not: the predicate that rejected the answer, the error, or the reason it was skipped. */
  readonly why?: string;
  readonly post?: string;
  readonly card?: string;
  readonly startedThread?: boolean;
  /** Every bound the answer was trimmed to. */
  readonly trims: readonly Trim[];
  /** The card rules' words, when a card the persona asked for was refused (the post stands). */
  readonly cardRefused?: string;
  /** Why the persona's own options for its card were not played, where they were not (the fallback played, or the card dropped). */
  readonly cardOptionsFailed?: string;
  readonly noteWritten?: boolean;
  /** An adopted post: the day it was written on, which is the day its spend is recorded on. */
  readonly day?: string;
}

export type ChatterOutcome =
  | { readonly status: 'off' }
  | { readonly status: 'no season' }
  /** Another run of the day holds the claim (core.ts, `claim_pool_run`): this one wrote and read nothing more. */
  | { readonly status: 'busy' }
  | {
    readonly status: 'ok';
    readonly day: string;
    /** Today's allowance, in slots, before the rows already spent today. */
    readonly allowance: number;
    readonly picks: readonly PickRecord[];
    /** The posts an earlier run of the week left without a spend, which this run recorded (on their own days). */
    readonly adopted: readonly PickRecord[];
  };

interface Context {
  readonly season: { readonly startsAt: number; readonly endsAt: number } | null;
  readonly boss: string | null;
  readonly predecessor: string | null;
  readonly offices: Readonly<Record<string, string>>;
  readonly characters: Readonly<Record<string, string>>;
  readonly boards: Readonly<Record<string, string>>;
}

interface Week {
  readonly spent: number;
  readonly threads: number;
  readonly today: readonly { readonly staff: string; readonly card_act: string | null; readonly started_thread: boolean }[];
}

interface ThreadRead {
  readonly title: string;
  readonly posts: readonly { readonly act: string; readonly name: string; readonly body: string }[];
}

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const said = (e: unknown): string => clip(e instanceof Error ? e.message : String(e), 500);

/** Errors that are facts about the ledger or the transport to the database, not about one pick: thrown, stopping the run. */
const stopsTheRun = (e: unknown): boolean => e instanceof LedgerWriteFailed || e instanceof TransportError;

/** A refusal a SQL function raised on purpose (a 4xx with its own words), as opposed to a database that is down. */
const isRefusal = (e: unknown): e is DatabaseError => e instanceof DatabaseError && e.status >= 400 && e.status < 500;

export async function runChatter(db: Db, models: Models, instance: Instance, slot: string): Promise<ChatterOutcome> {
  const slotAt = Date.parse(slot);
  if (Number.isNaN(slotAt)) throw new Error(`chatter: slot is not a time: ${JSON.stringify(slot)}`);
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  if (!settings.systemEnabled) return { status: 'off' };

  const day = dayOf(slotAt);
  // One run of a day at a time: the claim is taken before anything is read or written, and a crashed run's claim ages out by itself.
  const claimed = await db.rpc<string | null>('claim_pool_run', { on_day: day, lease: CLAIM_LEASE });
  if (claimed === null) return { status: 'busy' };
  const context = await db.rpc<Context>('pool_context', {});
  if (!context.season) return { status: 'no season' };
  const adopted = await adoptOrphans(db, day);
  const week = await db.rpc<Week>('pool_week', { today: day });

  // The allowance counts the week before today, so a rerun of the day computes the day's allowance the first run did.
  const todays = allowance(week.spent, settings.pool.weekly, slotAt);
  const startedToday = week.today.some((r) => r.started_thread);
  let threadsLeft = startedToday ? 0 : Math.max(settings.pool.threadsWeekly - week.threads, 0);
  let used = week.today.reduce((n, r) => n + 1 + (r.card_act === null ? 0 : 1), 0);
  const already = new Set(week.today.map((r) => r.staff));
  const records: PickRecord[] = [];
  if (todays === 0) return { status: 'ok', day, allowance: todays, picks: records, adopted };

  const roster = tuned.system.roster;
  const signals = await db.rpc<PoolSignals>('pool_signals', { since: new Date(slotAt - DAY).toISOString(), until: new Date(slotAt).toISOString() });
  const memories: Record<string, Memory | undefined> = {};
  await Promise.all(roster.map(async (p) => {
    let m = await db.rpc<Memory | null>('staff_memory_latest', { staff: p.key });
    if (m === null && p.inheritsMemoryOf) m = await db.rpc<Memory | null>('staff_memory_latest', { staff: p.inheritsMemoryOf });
    if (m !== null) memories[p.key] = m;
  }));

  const phase: PoolPhase = {
    season: context.season,
    since: slotAt - DAY,
    until: slotAt,
    settings,
    boss: context.boss,
    predecessor: context.predecessor,
  };
  const cands = candidates(signals, roster, memories, phase, { offices: context.offices, boards: context.boards, characters: context.characters });
  const picked = pick(cands, priorities(signals.tallies), todays, threadsLeft, dayRng(day), { strengths: settings.pool.strengths, holdback: settings.pool.holdback });

  const slugs = new Set(Object.values(context.boards));
  const offerable = settings.pool.cardRarityMost;
  const cardsOnOffer = tuned.cards.filter((c) => {
    const play = playOf(c);
    return (play === 'cast' || play === 'set') && atOrBelow(c.rarity, offerable) && staffOffers(c)
      && !(play === 'set' && c.trap?.outcome.do === 'payout');
  });

  for (const p of picked.picks) {
    const persona = roster.find((r) => r.key === p.staff);
    const base = { staff: p.staff, trigger: p.trigger, trims: [] as Trim[] };
    if (!persona) { records.push({ ...base, status: 'skipped', why: 'the persona is not in the roster' }); continue; }
    if (already.has(p.staff)) { records.push({ ...base, status: 'already' }); continue; }
    if (used + 1 > todays) { records.push({ ...base, status: 'skipped', why: 'the day\'s allowance is spent' }); continue; }

    const record = await onePick({
      db, models, tuned, persona, p, day, slugs, cardsOnOffer,
      threadsLeft, cardRoom: p.cardSlot && used + 2 <= todays,
    });
    records.push(record);
    // A thread start whose spend failed is still a thread started: the rerun adopts it, and no second starts meanwhile.
    if (record.status === 'failed' && record.post && record.startedThread) threadsLeft = 0;
    if (record.status === 'posted') {
      used += 1 + (record.card ? 1 : 0);
      already.add(p.staff);
      if (record.startedThread) threadsLeft = 0;
    }
  }
  return { status: 'ok', day, allowance: todays, picks: records, adopted };
}

interface PickRun {
  readonly db: Db;
  readonly models: Models;
  readonly tuned: Instance;
  readonly persona: Persona;
  readonly p: PoolPick;
  readonly day: string;
  readonly slugs: ReadonlySet<string>;
  readonly cardsOnOffer: Instance['cards'];
  readonly threadsLeft: number;
  readonly cardRoom: boolean;
}

/** One pick, from its inputs to its spend. Never throws except for a run-stopping error. */
async function onePick(r: PickRun): Promise<PickRecord> {
  const { db, models, tuned, persona, p, day } = r;
  const settings = tuned.settings;
  const base = { staff: p.staff, trigger: p.trigger };
  const skip = (why: string, trims: readonly Trim[] = []): PickRecord => ({ ...base, status: 'skipped', why, trims });
  const fail = (status: 'failed' | 'rejected', why: string, trims: readonly Trim[], extra: Partial<PickRecord> = {}): PickRecord => ({ ...base, status, why, trims, ...extra });
  try {
    // Where it posts: a thread start (the pick's thread-null stumble, or the day's top scorer, while the week has a thread left and the persona
    // has a beats board and a voice that can give a title); else a reply in its trigger's thread.
    const wantsStart = p.startThread || p.thread === null;
    const board = wantsStart && r.threadsLeft > 0 && persona.voice === 'chat' ? beatsBoard(persona, r.slugs, `${day}:${p.staff}`) : null;
    const startsThread = board !== null;
    if (!startsThread && p.thread === null) return skip(r.threadsLeft > 0 ? 'no board on its beats to start a thread on' : 'no thread to reply in, and the week has no thread left');

    const read = !startsThread
      ? await db.rpc<ThreadRead>('pool_thread', { in_thread: p.thread, most: settings.pool.chatterThreadPosts, chars: settings.digestExcerptChars, also: p.quoting })
      : null;
    const quotedPost: ThreadPost | null = read && p.quoting ? (read.posts.find((x) => x.act === p.quoting) ?? null) : null;

    // The cards on offer: a Cast needs a post to land on (the post it replies to, which it was shown), a Set lands on its own new post. Only
    // when the day's allowance has a slot for a card.
    const offered: OfferedCard[] = r.cardRoom && persona.voice === 'chat'
      ? r.cardsOnOffer.filter((c) => (playOf(c) === 'set' ? true : quotedPost !== null)).map((c) => ({ key: c.key, name: c.name, play: playOf(c) as 'cast' | 'set', ...(c.staffOptions ? { options: c.staffOptions } : {}) }))
      : [];

    const [career, memory, since] = await Promise.all([
      db.rpc<Career>('staff_career', { of_staff: p.staff }),
      db.rpc<Memory | null>('staff_memory_latest', { staff: p.staff }),
      db.rpc<string | null>('staff_memory_at', { staff: p.staff }),
    ]);
    const notes = await db.rpc<string[]>('staff_notes_recent', { of_staff: p.staff, since: since ? new Date(Date.parse(since)).toISOString() : null, most: settings.pool.notesRead });
    const known = memory ? [...memory.opinions.map((o) => o.character), ...memory.grudges.map((g) => g.character)] : [];
    const names = known.length ? await db.rpc<Record<string, string>>('pool_names', { ids: known }) : {};

    const limits = { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength };
    const thread = read ? { title: read.title, posts: read.posts.map((x) => ({ name: x.name, body: x.body })) } : null;

    // The call. A transport failure was retried inside models(); what comes back is an answer, a rejection, or a failure.
    let raw: unknown;
    try {
      if (persona.voice === 'oldVoice') {
        const frame = chatterCompletion({ name: persona.name, thread, limits });
        const out = await models.complete({
          duty: 'chatter', staff: p.staff, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens: 400, maxChars: settings.postMaxLength,
        });
        raw = { words: out.value };
      } else {
        const frame = chatterPrompt({
          premise: POOL_PREMISE, persona, career, memory, notes, thread,
          quoting: quotedPost ? { name: quotedPost.name, body: quotedPost.body } : null,
          trigger: p.trigger, offeredCards: offered, startThread: startsThread, limits, names: (id) => names[id] ?? 'a character',
        });
        const out = await models.chat({
          duty: 'chatter', tier: DUTY_SPECS.chatter.tier, staff: p.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
          schema: chatterSchema({ askedTitle: startsThread, offered }), rules: chatterRule({ offered }), maxTokens: 1_500,
        });
        raw = out.value;
      }
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      return fail(e instanceof AnswerRejected ? 'rejected' : 'failed', said(e), []);
    }

    const repaired = repairChatter(raw, { postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength, askedTitle: startsThread, offered });
    if (!repaired.ok) return fail('rejected', `the answer failed ${repaired.predicate} at ${repaired.path || 'the top'}`, repaired.trims);
    const answer = repaired.answer;
    const trims: Trim[] = [...repaired.trims];

    // The post. A database error here stops this pick with nothing written.
    let post: string;
    try {
      if (startsThread) {
        const made = await db.rpc<{ act: { id: string } }>('write_staff_thread', { staff_key: p.staff, board, title: answer.title, body: answer.words, marker: { pool: day } });
        post = made.act.id;
      } else {
        const written = await db.rpc<{ id: string }>('write_staff_act', { staff_key: p.staff, kind: 'post', thread: p.thread, target: p.quoting, payload: { body: answer.words, pool: day } });
        post = written.id;
      }
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      return fail('failed', said(e), trims);
    }

    // From here the post is written: whatever goes wrong with the card, the note or the spend must not lose it, and nothing is written twice.
    const record: Record<string, unknown> = { trims };
    let card: string | undefined;
    if (answer.card) {
      try {
        const rules = r.cardsOnOffer.find((c) => c.key === answer.card!.key);
        // The persona's own options first, decided by the card's rules against the target as the act function reads it; when they fail the trim
        // names the predicate, and the configuration is plain code's, seeded from the day and the persona so a rerun builds the same.
        let config: unknown = null;
        if (rules && answer.card.config !== undefined) {
          const decided = await decideOptions(db, tuned, rules, answer.card.on === 'reply' ? p.quoting : post, answer.card.on, answer.card.config);
          if (decided.ok) config = decided.config;
          else {
            const failed = `${answer.card.key}: ${decided.why}`;
            record['cardOptionsFailed'] = failed;
            trims.push({ path: `card.config.${answer.card.key}`, predicate: decided.why, before: 1, after: 0 });
          }
        }
        if (config === null && rules) config = staffConfigOf(rules, seededRng(`kayfabb-pool-card:${day}:${p.staff}`));
        if (config === null) throw new DatabaseError('no configuration could be built for the card', '', 400, 'no configuration could be built for the card');
        record['cardConfig'] = config;
        // Unlike supabase/functions/act/core.ts's play_card, staff_play_card is sent no `version`, so an edit landing between the read
        // above and this play is not refused (as before the options existed).
        const played = answer.card.on === 'reply'
          ? await db.rpc<{ id: string }>('staff_play_card', { staff_key: p.staff, card: answer.card.key, target: p.quoting, config, message: '', pool_day: day })
          : await db.rpc<{ id: string }>('staff_set_card', { staff_key: p.staff, card: answer.card.key, target: post, config });
        card = played.id;
      } catch (e) {
        if (stopsTheRun(e)) throw e;
        record['cardRefused'] = said(isRefusal(e) ? e.reason : e);
      }
    }
    let noteWritten = false;
    if (answer.note) {
      try {
        await db.rpc('write_staff_note', { staff_key: p.staff, post, body: answer.note });
        noteWritten = true;
      } catch (e) {
        if (stopsTheRun(e)) throw e;
        record['noteError'] = said(e);
      }
    }
    try {
      await db.rpc('record_pool_spend', { on_day: day, of_staff: p.staff, by_trigger: p.trigger, post, card: card ?? null, started: startsThread, note: record });
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      // The post stands with no row: the next run of the day adopts it (pool_orphans) and writes no second.
      return fail('failed', `the post was written but its spend was not recorded: ${said(e)}`, trims, { post, startedThread: startsThread, ...(card ? { card } : {}) });
    }
    return {
      ...base, status: 'posted', post, trims, startedThread: startsThread, noteWritten,
      ...(card ? { card } : {}), ...(typeof record['cardOptionsFailed'] === 'string' ? { cardOptionsFailed: record['cardOptionsFailed'] } : {}),
      ...(typeof record['cardRefused'] === 'string' ? { cardRefused: record['cardRefused'] } : {}),
    };
  } catch (e) {
    if (stopsTheRun(e)) throw e;
    if (e instanceof DatabaseError) return fail('failed', said(e), []);
    throw e;
  }
}

/** The board a persona starts a thread on: one of its beats that exists, chosen by a seed so a rerun chooses the same; null where none does. */
function beatsBoard(persona: Persona, slugs: ReadonlySet<string>, seed: string): string | null {
  const mine = persona.beats.filter((b) => slugs.has(b)).sort();
  return mine.length ? mine[Math.floor(seededRng(`kayfabb-pool-board:${seed}`)() * mine.length)]! : null;
}

/**
 * A persona's options for its card, decided as a player's play is (supabase/functions/act/core.ts): the target read as the card's rules see
 * it (`card_target_reach`, the post replied to or the persona's own new post), then `decidePlay` or `decideSet`, which hold `validateConfig`
 * and `canApply` against the post's whole visible text, never the excerpt the persona was shown. `why` is the card's own words. A database
 * error is thrown, as any other; a target that cannot be read is a failure of the options, so the fallback plays.
 */
async function decideOptions(db: Db, tuned: Instance, rules: Instance['cards'][number], target: string | null, on: 'reply' | 'own', config: unknown):
  Promise<{ ok: true; config: unknown } | { ok: false; why: string }> {
  if (target === null) return { ok: false, why: 'there is no post to read' };
  const read = await db.rpc<(CardTarget & { effects: CardEffect[]; above?: EffectsAbove }) | null>('card_target_reach', { reach: 'post', target });
  if (!read) return { ok: false, why: 'there is no such post' };
  const { effects: own, above = {}, ...said } = read;
  const post = said as { act: string; kind: Parameters<typeof postTarget>[1]; body?: unknown; version?: string };
  const t = postTarget(post.act, post.kind, post.body, post.version);
  const effects = effectsOnTarget(t, own ?? [], above);
  const decided = on === 'own'
    ? decideSet(rules, tuned.settings, t, effects, config, tuned.cards)
    : decidePlay(rules, tuned.settings, t, effects, config, '', { nameOf: (key) => tuned.cards.find((c) => c.key === key)?.name ?? key });
  return decided.ok ? { ok: true, config: decided.value.config } : { ok: false, why: decided.why };
}
