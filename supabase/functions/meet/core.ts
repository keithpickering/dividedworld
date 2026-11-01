/**
 * The Boss's meeting, as a pure module: it takes a `Db`, the `Models`, the instance, the slot the schedule fired for, a clock and a
 * `fetch`, and does the run the system plan's Task 9 lists. supabase/functions/meet/index.ts is the thin Edge Function around it;
 * this file is what Node tests (core.test.ts) and Deno both run. The engine's side of the call (the prompt, the rule, the repair)
 * is engine/system/meeting.ts; this file moves data between the database, the model and it.
 *
 * **The meeting's row is opened at its start and closed once** (supabase/migrations/0046_meeting.sql). Every model call's ledger
 * row names its meeting, so the row exists before the first call. `begin_meeting(slot)` opens it, or says the slot was already
 * met (closed: nothing to do), or hands back the row of a run that began and never closed (a crash: the retry reuses it).
 * Everything the meeting keeps is written by one SQL function, `apply_meeting`, in one transaction that closes the row, so a
 * retry cannot queue a move twice: the second apply finds the meeting closed and writes nothing.
 *
 * **A failure is a closed row, not a lost run.** A model that fails or whose answer cannot be repaired closes the meeting `failed`
 * or `rejected` with the error; memory, profile, moves and the bank stay as they were (the ledger already holds the call). A
 * database error is thrown after the row is closed `failed` with its error (best effort) and rethrown, so the error survives
 * on the row; only when that close fails too is the row left open, and then the next run of the slot resumes it (`resumed`) and
 * a row never closed is closed `failed` by the next slot's `begin_meeting`. A model's transport failures are retried inside `models()`, on the request itself; this
 * file never retries a whole meeting ("Three unrelated timeouts are not a poison pill").
 *
 * **The window.** The digest runs from where the previous meeting's window ended (its slot) to this slot, so no play falls
 * between two meetings: the previous meeting's finish time would skip what happened between its slot and its close.
 *
 * **Cost does not grow with the instance.** One strong-tier call per meeting, a digest bounded by the settings' ceilings
 * (engine/system/digest.ts), a memory bounded by its caps, at most `bankCap` (28) description completions on the light end of
 * the old voice, and one fetch per configured feed with a short timeout. Nothing here reads a row per player, character or Act.
 *
 * Nothing private reaches the model: the digest is built by a role that reads public relations only, and the characters the
 * model names are checked against `characters_public`.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { DIGEST_MOST, renderDigest, type Digest } from '../../../engine/system/digest.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { feedTitles } from '../../../engine/system/feed.ts';
import type { Memory } from '../../../engine/system/memory.ts';
import {
  MEETING_RULE,
  REFERENCE_MOST,
  SUCCESSOR_WINDOW_MS,
  meetingSystemPrompt,
  namedCharacters,
  referenceText,
  repairAnswer,
  ruleSchema,
  type PlannedMove,
} from '../../../engine/system/meeting.ts';
import type { Models } from '../../../engine/system/model.ts';
import { phaseAt } from '../../../engine/system/phases.ts';
import { cutCompletion, type Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';

export interface SkippedFeed {
  readonly name: string;
  readonly why: string;
}

export type MeetingOutcome =
  | { readonly status: 'already met'; readonly slot: string; readonly meeting: number }
  | { readonly status: 'already applied'; readonly meeting: number }
  | { readonly status: 'off'; readonly meeting: number }
  | { readonly status: 'failed' | 'rejected'; readonly meeting: number; readonly error: string }
  | {
    readonly status: 'ok';
    readonly meeting: number;
    readonly boss: string;
    readonly phase: string;
    readonly queued: number;
    /** Every bound the meeting cut or move it dropped, beside the model-level trims the call's ledger row holds. */
    readonly trims: readonly Trim[];
    /** Things the run did that a reader of the result should know (a stock description stood in). */
    readonly notes: readonly string[];
    readonly feedsSkipped: readonly SkippedFeed[];
    readonly inherited: readonly { readonly move_act: string; readonly decision: 'keep' | 'end' }[];
    readonly successor: { readonly boss: string; readonly why: string } | null;
    readonly bankBefore?: number;
    readonly bankAfter?: number;
  };

interface Context {
  readonly season: { readonly startsAt: number; readonly endsAt: number } | null;
  readonly boss: string | null;
  /** The slot of the last meeting that closed ok or failed: where this window starts. Null before the first. */
  readonly lastSlot: string | null;
  readonly boards: readonly { readonly id: string; readonly name: string }[];
}

/** How long one feed may take: outside material is a garnish, not a dependency. */
export const FEED_TIMEOUT_MS = 5_000;
/** The most of a feed's body that is read. */
const FEED_BYTES = 400_000;

const DAY = 86_400_000;
const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const said = (e: unknown): string => clip(e instanceof Error ? e.message : String(e), 500);

/** Errors that are facts about the database or the ledger, never about the model: thrown at once, after the row is closed failed. */
const isInfrastructure = (e: unknown): boolean => e instanceof DatabaseError || e instanceof TransportError || e instanceof LedgerWriteFailed;

export async function runMeeting(
  db: Db,
  models: Models,
  instance: Instance,
  slot: string,
  clock: () => number,
  fetchFeed: typeof globalThis.fetch,
): Promise<MeetingOutcome> {
  const slotAt = Date.parse(slot);
  if (Number.isNaN(slotAt)) throw new Error(`meet: slot is not a time: ${JSON.stringify(slot)}`);
  const slotIso = new Date(slotAt).toISOString();
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;

  const began = await db.rpc<{ status: 'begun' | 'resumed' | 'already met'; meeting: number }>('begin_meeting', { slot: slotIso });
  if (began.status === 'already met') return { status: 'already met', slot: slotIso, meeting: began.meeting };
  const meeting = began.meeting;

  // Past this point the row is open: whatever throws is written onto it (best effort) and thrown again, so the error survives the next slot's generic close.
  try {

    const close = async (outcome: 'failed' | 'rejected' | 'off', error: string | null, record: Record<string, unknown> = {}) => {
      await db.rpc('fail_meeting', { meeting, outcome, error, record });
    };

    if (!settings.systemEnabled) {
      await close('off', null);
      return { status: 'off', meeting };
    }

    const context = await db.rpc<Context>('meeting_context', {});
    const bossKey = context.boss;
    if (!context.season || !bossKey) {
      const error = context.season ? 'the open season has no Boss' : 'the instance has no open season';
      await close('failed', error);
      return { status: 'failed', meeting, error };
    }
    const boss = tuned.system.bosses.find((b) => b.key === bossKey);
    if (!boss) {
      const error = `the season's Boss "${bossKey}" is not in the instance's roster`;
      await close('failed', error);
      return { status: 'failed', meeting, error };
    }

    const now = clock();
    const phase = phaseAt(context.season, now, settings, boss);

    // The window: from where the last meeting's ended (the first meeting: the season's start, or a day back if the season is older).
    const first = Math.max(context.season.startsAt, slotAt - DAY);
    const sinceAt = Math.min(context.lastSlot ? Date.parse(context.lastSlot) : first, slotAt - 60_000);
    const digest = await db.rpc<Digest>('system_digest', { since: new Date(sinceAt).toISOString(), until: slotIso });

    // Its own latest memory; a Boss with none (a new one) reads nothing, or the memory of the Boss its persona inherits.
    let memory = await db.rpc<Memory | null>('staff_memory_latest', { staff: bossKey });
    if (memory === null && boss.inheritsMemoryOf) memory = await db.rpc<Memory | null>('staff_memory_latest', { staff: boss.inheritsMemoryOf });

    const bank = await db.rpc<number>('bank_now', { staff: bossKey, weekly_moves: phase.numbers.weeklyMoves, bank_cap: phase.numbers.bankCap });

    const { titles, skipped } = await readFeeds(tuned.system.feeds, fetchFeed);

    const successorAllowed = phase.phase === 'meltdown' && now >= context.season.endsAt - SUCCESSOR_WINDOW_MS;
    const system = meetingSystemPrompt({
      boss,
      system: tuned.system,
      settings,
      phase,
      bank,
      successorAllowed,
      roster: tuned.system.bosses.map((b) => ({ key: b.key, name: b.name })),
    });
    const notes = skipped.map((f) => `The feed "${f.name}" could not be read today (${f.why}).`);
    const message = [
      renderDigest(digest, memory, titles),
      ...(notes.length ? ['', ...notes] : []),
      '',
      referenceText({
        boards: context.boards,
        threads: digest.threads.map((t) => ({ id: t.thread, title: t.title })),
        characters: digest.characters.filter((c) => !c.staff).map((c) => ({ id: c.id, name: c.name })).slice(0, REFERENCE_MOST.characters),
      }),
      '',
      'Hold your meeting.',
    ].join('\n');

    let raw: unknown;
    try {
      const answered = await models.chat({
        duty: 'meeting',
        tier: DUTY_SPECS.meeting.tier,
        staff: bossKey,
        meeting,
        system,
        messages: [{ role: 'user', content: message }],
        schema: ruleSchema(MEETING_RULE),
        rules: MEETING_RULE,
        maxTokens: 8_000,
      });
      raw = answered.value;
    } catch (e) {
      if (isInfrastructure(e)) throw e;
      const outcome = e instanceof AnswerRejected ? 'rejected' : 'failed';
      const error = said(e);
      await close(outcome, error, { phase: phase.phase, feedsSkipped: skipped });
      return { status: outcome, meeting, error };
    }

    // The characters the answer names are checked against who is public now, not against today's digest.
    const named = namedCharacters(raw);
    const publicNow = new Set(named.length ? await db.rpc<string[]>('public_characters', { ids: named }) : []);
    const repaired = repairAnswer(raw, {
      settings,
      system: tuned.system,
      boss: bossKey,
      phase,
      bank,
      now,
      boards: new Set(context.boards.map((b) => b.id)),
      // The threads the model was shown (the reference list is bounded), the only ones a demand may name.
      threads: new Set(digest.threads.slice(0, REFERENCE_MOST.threads).map((t) => t.thread)),
      isPublic: (id) => publicNow.has(id),
      successorAllowed,
    });
    if (!repaired.ok) {
      const error = `the answer failed ${repaired.predicate} at ${repaired.path || 'the top'}`;
      await close('rejected', error, { phase: phase.phase, trims: repaired.trims });
      return { status: 'rejected', meeting, error };
    }

    const trims: Trim[] = [...repaired.trims];
    const moves = await Promise.all(repaired.moves.map((m, i) => withDescription(models, tuned, m, i, bossKey, meeting, trims, notes)));

    const record = {
      phase: phase.phase,
      clamps: phase.clamps,
      trims,
      notes,
      feedsSkipped: skipped,
      inherited: repaired.inherited,
      successor: repaired.successor,
    };
    const applied = await db.rpc<{ status: 'applied' | 'already applied'; queued?: number; bank_before?: number; bank_after?: number }>('apply_meeting', {
      meeting,
      payload: {
        boss: bossKey,
        memory: repaired.memory,
        profile: repaired.profile,
        moves: moves.map((m) => ({
          kind: m.kind,
          params: m.params,
          demand: m.demand,
          go_live_at: new Date(m.goLiveAt).toISOString(),
          expires_in_hours: m.expiresInHours,
          why: m.why,
        })),
        // The database computes the bank itself, in the transaction, from these numbers, so a delayed apply debits the true balance.
        weekly_moves: phase.numbers.weeklyMoves,
        bank_cap: phase.numbers.bankCap,
        record,
      },
    });
    if (applied.status === 'already applied') return { status: 'already applied', meeting };
    return {
      status: 'ok',
      meeting,
      boss: bossKey,
      phase: phase.phase,
      queued: moves.length,
      trims,
      notes,
      feedsSkipped: skipped,
      inherited: repaired.inherited,
      successor: repaired.successor,
      ...(applied.bank_before !== undefined ? { bankBefore: applied.bank_before, bankAfter: applied.bank_after } : {}),
    };
  } catch (e) {
    try {
      await db.rpc('fail_meeting', { meeting, outcome: 'failed', error: said(e), record: {} });
    } catch {
      // The close failed too: the original error is the one that matters.
    }
    throw e;
  }
}

/** A move with its params complete: a rename gets the old voice's description, or the instance's stock one when the voice cannot. */
async function withDescription(
  models: Models,
  instance: Instance,
  move: PlannedMove,
  index: number,
  staff: string,
  meeting: number,
  trims: Trim[],
  notes: string[],
): Promise<PlannedMove> {
  if (move.kind !== 'renameBoard') return move;
  const name = String(move.params['name']);
  const frame = instance.system.oldVoice({ name, premise: String(move.params['premise']) });
  const stock = (why: string): PlannedMove => {
    const lines = instance.system.stockLines.boardDescription;
    // The same name always draws the same line, so a retried meeting writes what the first would have.
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    notes.push(`moves[${index}]: the old voice could not write a description (${why}); a stock description stands in.`);
    return { ...move, params: { ...move.params, description: lines[h % lines.length]!.replaceAll('{board}', name) } };
  };
  try {
    const out = await models.complete({
      duty: 'meeting',
      staff,
      meeting,
      prompt: frame.prompt,
      temperature: 0.9,
      topP: 0.95,
      stop: frame.stop,
      maxTokens: 120,
      maxChars: 400,
    });
    const cut = cutCompletion(out.value, frame.stop, 400);
    if (!cut.ok) return stock(cut.predicate);
    trims.push(...cut.trims.map((t) => ({ ...t, path: `moves[${index}].params.description` })));
    return { ...move, params: { ...move.params, description: cut.text } };
  } catch (e) {
    // A completion failing never fails the meeting; only a call the ledger could not record is not trusted.
    if (e instanceof LedgerWriteFailed) throw e;
    return stock(said(e));
  }
}

/**
 * Each feed's item titles, fetched by plain code with a short timeout and read with a few patterns (engine/system/feed.ts). A feed
 * that fails is skipped and said so; the titles of the rest are taken one from each in turn, up to the digest's ceiling.
 */
async function readFeeds(feeds: Instance['system']['feeds'], fetchFeed: typeof globalThis.fetch): Promise<{ titles: string[]; skipped: SkippedFeed[] }> {
  const read = await Promise.all(
    feeds.map(async (f): Promise<{ name: string; titles: string[] } | SkippedFeed> => {
      try {
        const response = await fetchFeed(f.url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
        if (!response.ok) {
          await response.body?.cancel();
          return { name: f.name, why: `HTTP ${response.status}` };
        }
        return { name: f.name, titles: feedTitles(await readCapped(response, FEED_BYTES), DIGEST_MOST.feed) };
      } catch (e) {
        return { name: f.name, why: e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
      }
    }),
  );
  const skipped = read.filter((r): r is SkippedFeed => 'why' in r);
  const lists = read.filter((r): r is { name: string; titles: string[] } => 'titles' in r).map((r) => r.titles);
  const titles: string[] = [];
  for (let i = 0; titles.length < DIGEST_MOST.feed && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && titles.length < DIGEST_MOST.feed) titles.push(l[i]!);
  }
  return { titles, skipped };
}

/** A response's body read through its stream and stopped at `max` bytes (the rest cancelled), so a huge feed cannot fill memory. */
async function readCapped(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return clip(await response.text(), max);
  const chunks: Uint8Array[] = [];
  let have = 0;
  try {
    while (have < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(have + value.length > max ? value.subarray(0, max - have) : value);
      have += chunks.at(-1)!.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(have);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}
