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
 * **Rounds (the chattier staff design; its plan, Task 7).** The schedule fires a round every `cronMinutes` (the step of the cron's minute field, else 15), and a round does, in this order:
 *   1. The System-enabled check, then `claim_pool_round(slot)`: a round that loses the claim returns `busy` having written nothing.
 *   2. The day's first round (the day not marked started, `pool_day_started`): the day's claim, the adoption of orphans, the week, then the daily path above with `keep_pick` where it wrote a post,
 *      and last the sessions each posting persona keeps that day (`drawSessions`, seeded from the day and the persona, `write_sessions`). That call is last on purpose: it also marks the day
 *      started (even with no session), so a round that dies earlier leaves the day unmarked and the next is a first round again, which keeps and draws the same (a second keep, a second
 *      write of the same rows, is a no-op in the database) and loses no pick.
 *   3. Each kept pick whose persona has a session open now, or none left in the day, is written by `onePick`, unchanged, and spent in `pool_spends` as ever. Every round adopts the day's orphans first.
 *   4. Turns: the replies waiting on the personas in session (`pool_waiting`), `roundShare` of what is left of the day's turns, `planTurns`; each planned turn reads its conversation, thread, record,
 *      talking points, memory and notes, makes one light-tier call under the duty `conversation` (a chat call, or a raw completion for the old voice), repairs it as a pick's is (no card, no
 *      title), writes it whole with `write_staff_turn` and leaves its note. A refusal of `write_staff_turn` skips the turn; a failed or rejected call spends nothing and its replies wait.
 *   5. The outcome lists the picks written, the turns taken, skipped and failed, and the personas whose picks were kept.
 * **A crash between a turn's call and `write_staff_turn` spends nothing and loses nothing** (the call is a ledger row; the replies are still waiting); **an answer from `write_staff_turn` lost on
 * the way back** is a transport error, which stops the round, and the next round finds the replies answered (`pool_answered`) and writes no second turn: the write is never repeated on a guess (handler.ts).
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
import { writeTokensMost, withheld, atOrBelow, inPrint, decideDraw, decidePlay, decideSet, effectsOnTarget, playOf, postTarget, staffConfigOf, staffDrawOf, staffOffers, type DecidedDraw, type CardEffect, type CardTarget, type EffectsAbove } from '../../../engine/rules/cards.ts';
import { forgedList } from '../../../engine/bbcode/quoted.ts';
import { ENGINE_DEFAULT_PRONOUNS, pronounsOr, taggedName, type PronounSet } from '../../../engine/rules/pronouns.ts';
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import type { Career } from '../../../engine/system/career.ts';
import {
  POOL_PREMISE,
  TURN_PREMISE,
  CHATTER_RULE,
  CHATTER_TOKENS,
  chatterCompletion,
  chatterPrompt,
  chatterSchema,
  repairChatter,
  type ConversationView,
  type OfferedCard,
  type PublicRecord,
  type ThreadPost,
} from '../../../engine/system/chatter.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import type { Memory } from '../../../engine/system/memory.ts';
import type { Models } from '../../../engine/system/model.ts';
import { scrubbedComplete } from '../../../engine/system/scrub.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import { drawSessions } from '../../../engine/system/sessions.ts';
import { planTurns, roundShare, type AwakeSession, type OpenThread, type PlannedTurn } from '../../../engine/system/turns.ts';
import {
  allowance,
  candidates,
  dayOf,
  dayRng,
  pick,
  POSTING_OFFICES,
  priorities,
  seededRng,
  sessionRng,
  type PoolPhase,
  type PoolPick,
  type PostingOffice,
  type PoolSignals,
} from '../../../engine/system/pool.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';

const DAY = 86_400_000;

/** The most tokens an old voice's pool post may take, before the window's own bound (`writeTokensMost`). */
const OLD_VOICE_POST_TOKENS = 400;

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

/** What a turn came to. `taken` wrote a post; every other status wrote nothing and its replies wait (`skipped`: the database refused it or it could not be set up). */
export type TurnStatus = 'taken' | 'skipped' | 'rejected' | 'failed';

export interface TurnRecord {
  readonly staff: string;
  readonly thread: string;
  readonly session: number;
  readonly status: TurnStatus;
  /** Why a turn that wrote nothing did not: the predicate that rejected the answer, the database's refusal, the error, or the reason it was skipped. */
  readonly why?: string;
  readonly post?: string;
  /** The replies the turn answered. */
  readonly answers: readonly string[];
  readonly trims: readonly Trim[];
  readonly noteWritten?: boolean;
}

export type ChatterOutcome =
  | { readonly status: 'off' }
  | { readonly status: 'no season' }
  /** Another round of the slot, or another run of the day (the first round's pick), holds the claim: this one wrote and read nothing more. */
  | { readonly status: 'busy' }
  | {
    readonly status: 'ok';
    readonly day: string;
    /** Today's allowance, in slots, before the rows already spent today. */
    readonly allowance: number;
    /** The picks this round wrote, or skipped (a persona not in the roster, one that already posted today). */
    readonly picks: readonly PickRecord[];
    /** The posts an earlier run of the week left without a spend, which this round recorded (on their own days). */
    readonly adopted: readonly PickRecord[];
    /** The personas whose pick of the day this round kept (the day's first round) for their session. */
    readonly kept: readonly string[];
    /** The round's turns, taken, skipped, rejected and failed. */
    readonly turns: readonly TurnRecord[];
  };

interface Context {
  readonly season: { readonly startsAt: number; readonly endsAt: number } | null;
  readonly boss: string | null;
  readonly predecessor: string | null;
  readonly offices: Readonly<Record<string, string>>;
  readonly characters: Readonly<Record<string, string>>;
  readonly boards: Readonly<Record<string, string>>;
  /** Absent from an older `pool_context`: reads as none. */
  readonly lockouts?: readonly { readonly staff: string; readonly thread: string }[];
}

interface Week {
  readonly spent: number;
  readonly threads: number;
  readonly today: readonly { readonly staff: string; readonly card_act: string | null; readonly started_thread: boolean }[];
}

interface ThreadRead {
  readonly title: string;
  readonly posts: readonly { readonly act: string; readonly name: string; readonly pronouns: PronounSet | null; readonly body: string; readonly cut?: boolean }[];
  /** The live surfaces on the page it reads (pool_thread), each its play, its card's key and a few plain words naming whose post it is on; absent where the database reports none. */
  readonly walls?: readonly { readonly play: string; readonly card: string; readonly about: string }[];
}
/** The most walls a persona is offered to draw on, for each surface card. */
const WALLS_OFFERED = 3;

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const said = (e: unknown): string => clip(e instanceof Error ? e.message : String(e), 500);

/** Errors that are facts about the ledger or the transport to the database, not about one pick: thrown, stopping the run. */
const stopsTheRun = (e: unknown): boolean => e instanceof LedgerWriteFailed || e instanceof TransportError;

/** A refusal a SQL function raised on purpose (a 4xx with its own words), as opposed to a database that is down. */
const isRefusal = (e: unknown): e is DatabaseError => e instanceof DatabaseError && e.status >= 400 && e.status < 500;

/** A persona's visit on the day, as `sessions_day` reports it. */
interface DaySession { readonly staff: string; readonly session: number; readonly startsAt: string; readonly endsAt: string }

// The minutes between rounds: N where the cron's minute field is a step of every N minutes (star, slash, N), else 15, the design's round.
export function cronMinutes(cron: string): number {
  const field = cron.trim().split(/\s+/)[0] ?? '';
  const step = /^\*\/(\d+)$/.exec(field);
  const n = step ? Number(step[1]) : 0;
  return Number.isSafeInteger(n) && n >= 1 ? n : 15;
}

const isPosting = (office: string | undefined): boolean => office !== undefined && (POSTING_OFFICES as readonly string[]).includes(office);

export async function runChatter(db: Db, models: Models, instance: Instance, slot: string): Promise<ChatterOutcome> {
  const slotAt = Date.parse(slot);
  if (Number.isNaN(slotAt)) throw new Error(`chatter: slot is not a time: ${JSON.stringify(slot)}`);
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  if (!settings.systemEnabled) return { status: 'off' };

  // One round of a slot at a time: the claim is taken before anything is read or written, and a crashed round's claim ages out by itself.
  const round = await db.rpc<string | null>('claim_pool_round', { slot: new Date(slotAt).toISOString() });
  if (round === null) return { status: 'busy' };
  const day = dayOf(slotAt);

  // The day's first round is the one that finds the day not marked started (`pool_day_started`). It claims the day, as the daily run always has, before anything else is read.
  // `write_sessions` writes the mark, last: it is the first round's last call, after every pick is kept, and it marks the day in the same transaction as the sessions (a day that draws none
  // is marked all the same). A crash before it leaves the day unmarked, so the next round redoes the day whole (a second keep and a second write of the same rows are no-ops) and loses no pick.
  const [started, daySessions] = await Promise.all([db.rpc<boolean>('pool_day_started', { on_day: day }), db.rpc<DaySession[]>('sessions_day', { on_day: day })]);
  let sessions = daySessions;
  if (!started) {
    const claimed = await db.rpc<string | null>('claim_pool_run', { on_day: day, lease: CLAIM_LEASE });
    if (claimed === null) return { status: 'busy' };
  }
  const context = await db.rpc<Context>('pool_context', {});
  if (!context.season) return { status: 'no season' };
  const adopted = await adoptOrphans(db, day);
  const week = await db.rpc<Week>('pool_week', { today: day });
  const first = !started;

  // The allowance counts the week before today, so every round of the day computes the allowance the first did.
  const todays = allowance(week.spent, settings.pool.weekly, slotAt);
  const startedToday = week.today.some((r) => r.started_thread);
  let threadsLeft = startedToday ? 0 : Math.max(settings.pool.threadsWeekly - week.threads, 0);
  let used = week.today.reduce((n, r) => n + 1 + (r.card_act === null ? 0 : 1), 0);
  const already = new Set(week.today.map((r) => r.staff));
  const records: PickRecord[] = [];
  const kept: string[] = [];
  const roster = tuned.system.roster;

  const slugs = new Set(Object.values(context.boards));
  const offerable = settings.pool.cardRarityMost;
  // A card out of print is never offered: a Mod Bot's play is a rare drop from The System, a new copy, and nothing gives one out (the card retirement design, section 2).
  const cardsOnOffer = tuned.cards.filter((c) => {
    const play = playOf(c);
    return inPrint(c) && (play === 'cast' || play === 'set') && atOrBelow(c.rarity, offerable) && staffOffers(c) && !withheld(c, settings);
  });

  if (first) {
    if (todays > 0) {
      const keeping = await keepThePicks({ db, tuned, context, roster, slotAt, day, todays, threadsLeft, used, already });
      records.push(...keeping.records);
      kept.push(...keeping.kept);
    }
    // The sessions come last: they are what says the day's first round is done (see the header).
    await drawTheSessions(db, tuned, context, day);
    sessions = await db.rpc<DaySession[]>('sessions_day', { on_day: day });
  }

  if (todays > 0) {
    // The kept picks that are due: the persona's session is open now, or it has none left in the day. They are written as the pool's picks always were.
    const keptPicks = await db.rpc<{ staff: string; pick: PoolPick }[]>('kept_picks', { on_day: day });
    for (const k of keptPicks) {
      const p = k.pick;
      const mine = sessions.filter((x) => x.staff === k.staff);
      const open = mine.some((x) => Date.parse(x.startsAt) <= slotAt && slotAt < Date.parse(x.endsAt));
      const toCome = mine.some((x) => Date.parse(x.endsAt) > slotAt);
      if (!open && toCome) continue;
      const persona = roster.find((r) => r.key === k.staff);
      const base = { staff: k.staff, trigger: p.trigger, trims: [] as Trim[] };
      if (!persona) { records.push({ ...base, status: 'skipped', why: 'the persona is not in the roster' }); continue; }
      if (already.has(k.staff)) { records.push({ ...base, status: 'already' }); continue; }
      if (used + 1 > todays) { records.push({ ...base, status: 'skipped', why: 'the day\'s allowance is spent' }); continue; }

      const record = await onePick({
        db, models, tuned, persona, office: p.office, p, day, slugs, cardsOnOffer,
        threadsLeft, cardRoom: p.cardSlot && used + 2 <= todays,
      });
      records.push(record);
      // A thread start whose spend failed is still a thread started: the rerun adopts it, and no second starts meanwhile.
      if (record.status === 'failed' && record.post && record.startedThread) threadsLeft = 0;
      if (record.status === 'posted') {
        used += 1 + (record.card ? 1 : 0);
        already.add(k.staff);
        if (record.startedThread) threadsLeft = 0;
      }
    }
  }

  const turns = await takeTurns({ db, models, tuned, context, slotAt, day });
  return { status: 'ok', day, allowance: todays, picks: records, adopted, kept, turns };
}

interface Keeping {
  readonly db: Db;
  readonly tuned: Instance;
  readonly context: Context;
  readonly roster: readonly Persona[];
  readonly slotAt: number;
  readonly day: string;
  readonly todays: number;
  readonly threadsLeft: number;
  readonly used: number;
  readonly already: ReadonlySet<string>;
}

/** The daily path as ever it ran (the signals, `candidates`, `pick`), except that each pick is kept for its persona's session (`keep_pick`) where it was written. */
async function keepThePicks(k: Keeping): Promise<{ records: PickRecord[]; kept: string[] }> {
  const { db, tuned, context, roster, slotAt, day, todays, threadsLeft } = k;
  const settings = tuned.settings;
  const signals = await db.rpc<PoolSignals>('pool_signals', { since: new Date(slotAt - DAY).toISOString(), until: new Date(slotAt).toISOString() });
  const memories: Record<string, Memory | undefined> = {};
  await Promise.all(roster.map(async (p) => {
    let m = await db.rpc<Memory | null>('staff_memory_latest', { staff: p.key });
    if (m === null && p.inheritsMemoryOf) m = await db.rpc<Memory | null>('staff_memory_latest', { staff: p.inheritsMemoryOf });
    if (m !== null) memories[p.key] = m;
  }));
  const phase: PoolPhase = {
    season: context.season!,
    since: slotAt - DAY,
    until: slotAt,
    settings,
    boss: context.boss,
    predecessor: context.predecessor,
  };
  const cands = candidates(signals, roster, memories, phase, { offices: context.offices, boards: context.boards, characters: context.characters, lockouts: context.lockouts ?? [] });
  const picked = pick(cands, priorities(signals.tallies), todays, threadsLeft, dayRng(day), { strengths: settings.pool.strengths, holdback: settings.pool.holdback });
  const records: PickRecord[] = [];
  const kept: string[] = [];
  let planned = k.used;
  for (const p of picked.picks) {
    const base = { staff: p.staff, trigger: p.trigger, trims: [] as Trim[] };
    if (!roster.some((r) => r.key === p.staff)) { records.push({ ...base, status: 'skipped', why: 'the persona is not in the roster' }); continue; }
    if (k.already.has(p.staff)) { records.push({ ...base, status: 'already' }); continue; }
    if (planned + 1 > todays) { records.push({ ...base, status: 'skipped', why: 'the day\'s allowance is spent' }); continue; }
    await db.rpc('keep_pick', { on_day: day, of_staff: p.staff, pick: p });
    planned += 1;
    kept.push(p.staff);
  }
  return { records, kept };
}

/**
 * The sessions each posting persona (one in a posting office) keeps on the day, drawn by plain code seeded from the day and the persona and written once
 * (`write_sessions`; a row already there is left as it is). Where the database refuses the whole list (a persona benched since the context was read), each persona's own
 * rows are written on their own and the one refused is left without: a persona that cannot post keeps no session, and the rest keep theirs.
 */
async function drawTheSessions(db: Db, tuned: Instance, context: Context, day: string): Promise<void> {
  const rows = tuned.system.roster.filter((p) => isPosting(context.offices[p.key]))
    .flatMap((p) => drawSessions(p, day, tuned.settings.pool, sessionRng(day, p.key)).map((s) => ({ staff: p.key, start: s.start, end: s.end })));
  try {
    // One call, which also marks the day started, even with no rows.
    await db.rpc('write_sessions', { on_day: day, rows });
  } catch (e) {
    if (stopsTheRun(e) || !isRefusal(e)) throw e;
    // Persona by persona (each call marks the day, the first of them marking it before the rest are written: a crash among them leaves a persona without its sessions that day, never a pick lost).
    for (const staff of new Set(rows.map((r) => r.staff))) {
      try {
        await db.rpc('write_sessions', { on_day: day, rows: rows.filter((r) => r.staff === staff) });
      } catch (each) {
        if (stopsTheRun(each) || !isRefusal(each)) throw each;
      }
    }
    await db.rpc('write_sessions', { on_day: day, rows: [] });
  }
}

/** The persona's own reads for a call: its career, memory, notes and the faces its memory names. */
async function personaReads(db: Db, settings: Instance['settings'], staff: string) {
  const [career, memory, since] = await Promise.all([
    db.rpc<Career>('staff_career', { of_staff: staff }),
    db.rpc<Memory | null>('staff_memory_latest', { staff }),
    db.rpc<string | null>('staff_memory_at', { staff }),
  ]);
  const notes = await db.rpc<string[]>('staff_notes_recent', { of_staff: staff, since: since ? new Date(Date.parse(since)).toISOString() : null, most: settings.pool.notesRead });
  const known = memory ? [...memory.opinions.map((o) => o.character), ...memory.grudges.map((g) => g.character)] : [];
  const faces = known.length ? await db.rpc<Record<string, { name: string; pronouns: PronounSet | null }>>('character_faces', { ids: known }) : {};
  return { career, memory, notes, faces };
}

/** The most replies to one of its posts a conversation view shows (the database clamps at ten). */
const CONVERSATION_REPLIES = 10;

interface ConversationRead {
  readonly posts: readonly {
    readonly act: string;
    readonly body: string;
    readonly cut?: boolean;
    readonly replies: readonly { readonly act: string; readonly name: string; readonly pronouns: PronounSet | null; readonly body: string; readonly cut?: boolean }[];
  }[];
}

/** What a call reads of a thread beside the thread itself: the persona's own conversation there, the public record, and its talking point. */
async function threadReads(db: Db, settings: Instance['settings'], staff: string, thread: string) {
  const [conversation, record, points] = await Promise.all([
    db.rpc<ConversationRead>('pool_conversation', { staff_key: staff, in_thread: thread, most: settings.pool.chatterThreadPosts, replies: CONVERSATION_REPLIES, chars: settings.digestExcerptChars }),
    db.rpc<PublicRecord>('pool_record', { in_thread: thread, staff_key: staff }),
    db.rpc<string | null>('staff_points_latest', { staff_key: staff }),
  ]);
  return { conversation, record, points };
}

/** The view the prompt shows: pronouns resolved as a thread post's are, and the replies this call answers named. */
function viewOf(c: ConversationRead, instanceSet: PronounSet, answering: readonly string[]): ConversationView {
  return {
    posts: c.posts.map((m) => ({ act: m.act, body: m.body, cut: m.cut === true, replies: m.replies.map((r) => ({ act: r.act, name: r.name, pronouns: pronounsOr(r.pronouns, instanceSet), body: r.body, cut: r.cut === true })) })),
    answering,
  };
}

interface TurnsRun {
  readonly db: Db;
  readonly models: Models;
  readonly tuned: Instance;
  readonly context: Context;
  readonly slotAt: number;
  readonly day: string;
}

/**
 * The round's turns: the personas in session now, the replies waiting on them since the wait began, the day's share of the ceiling, and `planTurns`.
 * One after another, as the picks are. Nothing is read unless a persona is in session and the day has turns left.
 */
async function takeTurns(r: TurnsRun): Promise<TurnRecord[]> {
  const { db, tuned, context, slotAt, day } = r;
  const rules = tuned.settings.pool.turns;
  const awake = await db.rpc<AwakeSession[]>('sessions_awake', { at: new Date(slotAt).toISOString() });
  if (awake.length === 0) return [];
  const spentToday = await db.rpc<number>('pool_turns_today', { on_day: day });
  const share = roundShare(spentToday, rules.perDay, slotAt, cronMinutes(tuned.settings.pool.chatterCron));
  if (share === 0) return [];
  const keys = [...new Set(awake.map((a) => a.staff))].sort();
  const open = await db.rpc<OpenThread[]>('pool_waiting', { staff_keys: keys, since: new Date(slotAt - rules.waitHours * 3_600_000).toISOString() });
  const records: TurnRecord[] = [];
  for (const planned of planTurns(open, awake, share, rules, slotAt)) {
    const persona = tuned.system.roster.find((p) => p.key === planned.staff);
    const office = context.offices[planned.staff];
    const base = { staff: planned.staff, thread: planned.thread, session: planned.session, answers: planned.answers, trims: [] as Trim[] };
    if (!persona) { records.push({ ...base, status: 'skipped', why: 'the persona is not in the roster' }); continue; }
    if (!isPosting(office)) { records.push({ ...base, status: 'skipped', why: 'the persona holds no posting office' }); continue; }
    records.push(await oneTurn({ ...r, persona, office: office as PostingOffice, planned }));
  }
  return records;
}

interface TurnRun extends TurnsRun {
  readonly persona: Persona;
  readonly office: PostingOffice;
  readonly planned: PlannedTurn;
}

/** One turn, from its reads to its note. Never throws except for a run-stopping error. A call that failed or was rejected, or a write that was refused, spends nothing and its replies wait. */
async function oneTurn(r: TurnRun): Promise<TurnRecord> {
  const { db, models, tuned, persona, planned } = r;
  const settings = tuned.settings;
  const base = { staff: planned.staff, thread: planned.thread, session: planned.session };
  const skip = (why: string, answers: readonly string[] = planned.answers): TurnRecord => ({ ...base, status: 'skipped', why, answers, trims: [] });
  const fail = (status: 'failed' | 'rejected', why: string, answers: readonly string[], trims: readonly Trim[]): TurnRecord => ({ ...base, status, why, answers, trims });
  try {
    const instanceSet = pronounsOr(settings.pronouns, ENGINE_DEFAULT_PRONOUNS);
    const [view, read, reads] = await Promise.all([
      threadReads(db, settings, planned.staff, planned.thread),
      db.rpc<ThreadRead>('pool_thread', { in_thread: planned.thread, most: settings.pool.chatterThreadPosts, chars: settings.digestExcerptChars, also: planned.quoting }),
      personaReads(db, settings, planned.staff),
    ]);
    // A turn answers every waiting reply it was handed, and is shown each: those in the conversation view, and for the rest (replies to an older post of its own) the one post
    // read alone (`pool_thread` with `most` 0 and `also`, a bounded read of one post). A reply that cannot be read is not answered (the database would find it no longer waiting).
    const shown = new Map<string, { name: string; pronouns: PronounSet | null; body: string; cut?: boolean }>(view.conversation.posts.flatMap((m) => m.replies.map((x) => [x.act, x] as const)));
    const missing = planned.answers.filter((a) => !shown.has(a));
    const fetched = await Promise.all(missing.map((act) => db.rpc<ThreadRead>('pool_thread', { in_thread: planned.thread, most: 0, chars: settings.digestExcerptChars, also: act })));
    const others: { act: string; name: string; pronouns: PronounSet; body: string; cut: boolean }[] = [];
    missing.forEach((act, i) => {
      const x = fetched[i]!.posts.find((q) => q.act === act);
      if (!x) return;
      shown.set(act, x);
      others.push({ act, name: x.name, pronouns: pronounsOr(x.pronouns, instanceSet), body: x.body, cut: x.cut === true });
    });
    const answers = planned.answers.filter((a) => shown.has(a));
    if (answers.length === 0) return skip('none of the waiting replies can be read');
    const quoting = answers.includes(planned.quoting) ? planned.quoting : answers.at(-1)!;
    const quotedRead = shown.get(quoting)!;
    const quotedPost: ThreadPost = { name: quotedRead.name, pronouns: pronounsOr(quotedRead.pronouns, instanceSet), body: quotedRead.body, cut: quotedRead.cut === true };
    const limits = { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength };
    const thread = { title: read.title, posts: read.posts.map((x) => ({ name: x.name, pronouns: pronounsOr(x.pronouns, instanceSet), body: x.body, cut: x.cut === true })) };
    const { career, memory, notes, faces } = reads;

    let raw: unknown;
    try {
      if (persona.voice === 'oldVoice') {
        // The conversation view is its thread: each of its posts, then the replies to it, the newest last.
        const own = pronounsOr(persona.pronouns, instanceSet);
        const posts = view.conversation.posts.flatMap((m) => [{ name: persona.name, pronouns: own, body: m.body, cut: m.cut === true }, ...m.replies.map((x) => ({ name: x.name, pronouns: pronounsOr(x.pronouns, instanceSet), body: x.body, cut: x.cut === true }))]).concat(others);
        const maxTokens = Math.min(OLD_VOICE_POST_TOKENS, writeTokensMost(settings));
        const frame = chatterCompletion({ name: persona.name, thread: { title: read.title, posts }, limits, fit: { budget: settings.oldVoiceWindow - maxTokens, count: tokenCounter(settings.oldVoiceTokenizer) } });
        const out = await scrubbedComplete(models, {
          duty: 'conversation', staff: planned.staff, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens, maxChars: settings.postMaxLength,
        }, tuned.system.scrubWords);
        raw = { words: out.value };
      } else {
        const frame = chatterPrompt({
          premise: TURN_PREMISE, persona, office: r.office, offices: tuned.system.offices, pronouns: pronounsOr(persona.pronouns, instanceSet), career, memory, notes, thread, quoting: quotedPost,
          trigger: 'answered', conversation: { ...viewOf(view.conversation, instanceSet, answers), others }, record: view.record, points: view.points,
          // A turn offers no card: the ceiling counts calls and nothing else.
          offeredCards: [], startThread: false, limits, names: (id) => { const f = faces[id]; return f ? taggedName(clip(f.name, 60), pronounsOr(f.pronouns, instanceSet)) : 'a character'; },
        });
        const out = await models.chat({
          duty: 'conversation', tier: DUTY_SPECS.conversation.tier, staff: planned.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
          schema: chatterSchema({ askedTitle: false, offered: [] }), rules: CHATTER_RULE, maxTokens: CHATTER_TOKENS,
        });
        raw = out.value;
      }
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      return fail(e instanceof AnswerRejected ? 'rejected' : 'failed', said(e), answers, []);
    }

    const repaired = repairChatter(raw, { postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength, askedTitle: false, offered: [] });
    if (!repaired.ok) return fail('rejected', `the answer failed ${repaired.predicate} at ${repaired.path || 'the top'}`, answers, repaired.trims);
    const answer = repaired.answer;
    const trims: Trim[] = [...repaired.trims];

    // The turn, whole: the post, the turn's row and each reply's answered row, in one transaction. A refusal writes nothing; the replies wait.
    let post: string;
    try {
      const written = await db.rpc<{ turn: number; post: { id: string } }>('write_staff_turn', {
        staff_key: planned.staff, in_session: planned.session, in_thread: planned.thread, quoting, answers, body: answer.words,
      });
      post = written.post.id;
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (isRefusal(e) && e.hint === 'kayfabb.refusal') return { ...base, status: 'skipped', why: e.reason, answers, trims };
      return fail('failed', said(e), answers, trims);
    }

    // From here the turn is written: a failed note loses nothing and writes nothing twice.
    let noteWritten = false;
    if (answer.note) {
      try {
        await db.rpc('write_staff_note', { staff_key: planned.staff, post, body: answer.note });
        noteWritten = true;
      } catch (e) {
        if (stopsTheRun(e)) throw e;
      }
    }
    return { ...base, status: 'taken', post, answers, trims, noteWritten };
  } catch (e) {
    if (stopsTheRun(e)) throw e;
    if (e instanceof DatabaseError) return fail('failed', said(e), planned.answers, []);
    throw e;
  }
}

interface PickRun {
  readonly db: Db;
  readonly models: Models;
  readonly tuned: Instance;
  readonly persona: Persona;
  readonly office: PostingOffice;
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
    // A character with no profile row reads null pronouns; it takes the instance's default, else the engine's it-set. The persona's own set is its file's, else the same.
    const instanceSet = pronounsOr(settings.pronouns, ENGINE_DEFAULT_PRONOUNS);
    const quotedRead = read && p.quoting ? (read.posts.find((x) => x.act === p.quoting) ?? null) : null;
    const quotedPost: ThreadPost | null = quotedRead ? { name: quotedRead.name, pronouns: pronounsOr(quotedRead.pronouns, instanceSet), body: quotedRead.body, cut: quotedRead.cut === true } : null;

    // The cards on offer: a Cast needs a post to land on (the post it replies to, which it was shown), a Set lands on its own new post. Only
    // when the day's allowance has a slot for a card.
    const offered: OfferedCard[] = r.cardRoom && persona.voice === 'chat'
      ? r.cardsOnOffer.filter((c) => (playOf(c) === 'set' ? true : quotedPost !== null)).map((c) => ({ key: c.key, name: c.name, play: playOf(c) as 'cast' | 'set', ...(c.staffOptions ? { options: c.staffOptions } : {}),
        ...wallsOf(c, read) }))
      : [];

    const { career, memory, notes, faces } = await personaReads(db, settings, p.staff);
    // The conversation in the thread, the public record and the persona's talking point, as a turn is given them (the old voice writes its words from the thread alone).
    const extra = read && persona.voice === 'chat' ? await threadReads(db, settings, p.staff, p.thread!) : null;
    const points = persona.voice !== 'chat' ? null : extra !== null ? extra.points : await db.rpc<string | null>('staff_points_latest', { staff_key: p.staff });

    const limits = { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength };
    const thread = read ? { title: read.title, posts: read.posts.map((x) => ({ name: x.name, pronouns: pronounsOr(x.pronouns, instanceSet), body: x.body, cut: x.cut === true })) } : null;

    // The call. A transport failure was retried inside models(); what comes back is an answer, a rejection, or a failure.
    let raw: unknown;
    try {
      if (persona.voice === 'oldVoice') {
        // The window's room for the answer, then the prompt fitted to what is left (design section 3); a prompt that still does not fit is refused by `models.complete` as a rejection.
        const maxTokens = Math.min(OLD_VOICE_POST_TOKENS, writeTokensMost(settings));
        const frame = chatterCompletion({ name: persona.name, thread, limits, fit: { budget: settings.oldVoiceWindow - maxTokens, count: tokenCounter(settings.oldVoiceTokenizer) } });
        const out = await scrubbedComplete(models, {
          duty: 'chatter', staff: p.staff, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens, maxChars: settings.postMaxLength,
        }, tuned.system.scrubWords);
        raw = { words: out.value };
      } else {
        const frame = chatterPrompt({
          premise: POOL_PREMISE, persona, office: r.office, offices: tuned.system.offices, pronouns: pronounsOr(persona.pronouns, instanceSet), career, memory, notes, thread,
          quoting: quotedPost, conversation: extra ? viewOf(extra.conversation, instanceSet, []) : null, record: extra?.record ?? null, points,
          trigger: p.trigger, offeredCards: offered, startThread: startsThread, limits, names: (id) => { const f = faces[id]; return f ? taggedName(clip(f.name, 60), pronounsOr(f.pronouns, instanceSet)) : 'a character'; },
        });
        const out = await models.chat({
          duty: 'chatter', tier: DUTY_SPECS.chatter.tier, staff: p.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
          schema: chatterSchema({ askedTitle: startsThread, offered }), rules: CHATTER_RULE, maxTokens: CHATTER_TOKENS,
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
        if (rules?.surface !== undefined) {
          // A surface card's options are its first draw, not a configuration: the play's configuration is {} (the card's default). The persona's own pick (a stencil, a can, a spot) is
          // read by the card's own `surface.validateDraw`, as a player's first draw is, and when it fails or is none the draw is plain code's: one of the card's `staffConfigs`, seeded
          // from the day and the persona so a rerun draws the same. A wall it chose to draw on is drawn on through staff_draw_on_surface, with no card played.
          const wall = answer.card.wall;
          const decideFirst = async (pick: unknown): Promise<{ ok: true; draw: DecidedDraw } | { ok: false; why: string }> => {
            if (wall !== undefined) { const d = decideDraw(rules, tuned.settings, pick); return d.ok ? { ok: true, draw: d.value } : { ok: false, why: d.why }; }
            const d = await decideOptions(db, tuned, rules, p.quoting, 'reply', {}, pick);
            trims.push(...d.trims);
            return d.ok && d.draw !== undefined ? { ok: true, draw: d.draw } : { ok: false, why: d.ok ? 'no first draw' : d.why };
          };
          let first: DecidedDraw | undefined;
          let chosen: unknown;
          if (answer.card.config !== undefined) {
            const decided = await decideFirst(answer.card.config);
            if (decided.ok) { first = decided.draw; chosen = answer.card.config; }
            else {
              record['cardOptionsFailed'] = `${answer.card.key}: ${decided.why}`;
              trims.push({ path: `card.config.${answer.card.key}`, predicate: decided.why, before: 1, after: 0 });
            }
          }
          if (first === undefined) {
            const fallback = staffDrawOf(rules, seededRng(`kayfabb-pool-card:${day}:${p.staff}`));
            const decided = fallback === null ? null : await decideFirst(fallback);
            if (decided?.ok) { first = decided.draw; chosen = fallback; }
          }
          if (first === undefined) throw new DatabaseError('no configuration could be built for the card', '', 400, 'no configuration could be built for the card');
          record['cardConfig'] = chosen;
          const drawn = wall !== undefined
            ? await db.rpc<{ id: string }>('staff_draw_on_surface', { staff_key: p.staff, play: wall, payload: { ...first.payload, pool: day }, cells: first.cells, most: first.most })
            : await db.rpc<{ id: string }>('staff_play_surface_card', {
              staff_key: p.staff, card: answer.card.key, target: p.quoting, config: {}, message: '', pool_day: day,
              // `tokens` has no default in staff_play_surface_card, so it is always sent, null for a card that writes nothing.
              tokens: rules.writes === undefined ? null : rules.writes.tokens({} as never, tuned.settings),
              first: first.payload, first_cells: first.cells, most: first.most, most_live: rules.surface.mostLive,
            });
          card = drawn.id;
        } else {
          // The persona's own options first, decided by the card's rules against the target as the act function reads it; when they fail the trim
          // names the predicate, and the configuration is plain code's, seeded from the day and the persona so a rerun builds the same.
          let config: unknown = null;
          if (rules && answer.card.config !== undefined) {
            const decided = await decideOptions(db, tuned, rules, answer.card.on === 'reply' ? p.quoting : post, answer.card.on, answer.card.config);
            // What the card's repair trimmed (its `repairStaff`) is written on the call's record beside the options' own, whether or not the options then pass.
            trims.push(...decided.trims);
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
          // A catching set card's named catch is what its own rules read from the configuration the card's rules accepted (SQL holds it to a card cast on a post).
          const catches = rules?.catches?.(config);
          // A card that writes buys its tokens at this decision, from the settings as the rows hold them now, as a player's play does (act/core.ts); the database writes them with the play.
          const tokens = rules?.writes?.tokens(config as never, tuned.settings);
          const played = answer.card.on === 'reply'
            ? await db.rpc<{ id: string }>('staff_play_card', { staff_key: p.staff, card: answer.card.key, target: p.quoting, config, message: '', pool_day: day, ...(tokens === undefined ? {} : { tokens }) })
            : await db.rpc<{ id: string }>('staff_set_card', { staff_key: p.staff, card: answer.card.key, target: post, config, ...(catches === undefined ? {} : { catches }) });
          card = played.id;
        }
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

/** A surface card's open walls on the page the persona reads, at most three: the card's own, never another's. */
function wallsOf(card: Instance['cards'][number], read: ThreadRead | null): { walls?: readonly { play: string; about: string }[] } {
  if (card.surface === undefined) return {};
  const walls = (read?.walls ?? []).filter((w) => w.card === card.key).slice(0, WALLS_OFFERED).map((w) => ({ play: w.play, about: w.about }));
  return walls.length ? { walls } : {};
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
export async function decideOptions(db: Db, tuned: Instance, rules: Instance['cards'][number], target: string | null, on: 'reply' | 'own', config: unknown, first?: unknown):
  Promise<({ ok: true; config: unknown; draw?: DecidedDraw } | { ok: false; why: string }) & { trims: readonly Trim[] }> {
  if (target === null) return { ok: false, why: 'there is no post to read', trims: [] };
  const read = await db.rpc<(CardTarget & { effects: CardEffect[]; above?: EffectsAbove }) | null>('card_target_reach', { reach: 'post', target });
  if (!read) return { ok: false, why: 'there is no such post', trims: [] };
  const { effects: own, above = {}, ...said } = read;
  const post = said as { act: string; kind: Parameters<typeof postTarget>[1]; body?: unknown; version?: string; forged?: unknown };
  const t = postTarget(post.act, post.kind, post.body, post.version, undefined, undefined, forgedList({ forged: post.forged }));
  const effects = effectsOnTarget(t, own ?? [], above);
  // The card's own repair of what the persona chose, against the post as its rules see it, before the options are decided; a player's play never comes here.
  // A repair that throws is no repair: the options are decided as given, and the throw is named like a trim, so a card's bug never costs the answer.
  let repaired: { readonly config: unknown; readonly trims: readonly Trim[] } = { config, trims: [] };
  try {
    repaired = rules.repairStaff?.(config, t, on === 'own' ? 'set' : 'cast') ?? repaired;
  } catch (e) {
    repaired = { config, trims: [{ path: `card.config.${rules.key}`, predicate: 'repairThrew', before: 1, after: 1 }] };
  }
  const trims: readonly Trim[] = repaired.trims;
  const decided = on === 'own'
    ? decideSet(rules, tuned.settings, t, effects, repaired.config, tuned.cards)
    : decidePlay(rules, tuned.settings, t, effects, repaired.config, '', { nameOf: (key) => tuned.cards.find((c) => c.key === key)?.name ?? key, first });
  return decided.ok ? { ok: true, config: decided.value.config, ...('draw' in decided.value && decided.value.draw !== undefined ? { draw: decided.value.draw } : {}), trims } : { ok: false, why: decided.why, trims };
}
