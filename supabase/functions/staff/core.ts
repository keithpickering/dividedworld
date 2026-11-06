/**
 * The Mod Bots' filing run, as a pure module (the Mod Bots design, sections 2 and 6; its plan, Task 7): it takes a `Db`, the `Models`, the instance, the minute the
 * schedule fired for and a clock, and files the visits that are due. supabase/functions/staff/index.ts is the thin Edge Function around it; this file is what Node tests
 * (core.test.ts) and Deno both run. The engine's side of the call (the prompt, the shape of the answer, the repair of a line and of the Mod's one move) is
 * engine/system/judgment.ts; this file moves data between the database, the model and it.
 *
 *   1. Nothing at all unless `systemEnabled`.
 *   2. The visits due and still open (`filings_due`: their end is past, and the tick has not failed to file them), oldest first, at most `FILINGS_PER_RUN`.
 *   3. For each, the beat Mod's call (`mod_standing`, its career, memory and notes, the thread, the rules in force), duty `filing`, with `staff` set, so every call is a
 *      ledger row (models(), "Cost is a column"). A chat persona is asked once, in structure, for its line and its one optional move. A persona on the old voice writes its
 *      line in raw completion, and its move in a second, chat call only when it has an allowance.
 *   4. The answer is repaired (repairFiling): the line cut to 280, the move held to the Mod's office, every trim and every drop named on the filing's record.
 *   5. The Mod's move, if it still stands, is queued as the Mod's (`apply_mod_move`, caused by the visit), then the visit is filed (`file_visit`) with the line.
 *
 * **The stock line is the way out of every failure.** A visit whose call failed, was rejected, was over the day's count (`modBots.filingLinesPerDay`, counted from the
 * ledger's filing calls today, `filing_calls_today`, and up as this run calls), whose Mod has left the staff or is not in the roster, is filed with no line, and the
 * database says its stock line (`visitFiled`). The tick files every visit `filingGraceMinutes` past its end whatever this run does, so nothing waits on a model.
 *
 * **Races.** The run files nothing before the visit's end (the database's list is held to `ends_at <= now()`, and the run checks it again against its own clock), so the
 * tick's grace gives the cron the first chance and the run is the model-voiced one. Both can still file the same visit: `file_visit` is idempotent, and the run says
 * `already` when the tick got there first. A crash between the move and the filing leaves the visit open: the next run asks again, and `apply_mod_move` finds the move by
 * its cause (the visit) and queues nothing a second time, so the allowance is spent once. That is why the move goes first: a crash after the filing could lose the
 * move, and a crash after the move can only repeat a call. Two runs overlapping cost a second model call, never a second effect; the run stops starting visits when
 * `RUN_BUDGET_MS` is spent, well inside the function's time, so a run does not outlive the next one.
 *
 * **Failures** ("Three unrelated timeouts are not a poison pill"). A model's transport failure is retried on the request itself, inside models(); this file never
 * retries a call. A call that failed or was rejected files the stock line. A database error on one visit is recorded and the run goes on to the next (the visit stays
 * open for the next run, or the tick); a ledger row that could not be written, or a transport failure to the database, stops the run: an unrecorded call is not trusted.
 *
 * **Where the trims and the drops go.** The call's ledger row holds the model layer's result; `record_staff_call` keeps the repair's, once per call, in `staff_call_records`. The trims `repairFiling` makes (a line cut, an expiry clamped, a why
 * cut) and what it drops (a move off the beat or with no allowance, a line that was blank) are on the filing's record in the result and in the function's console.warn
 * (index.ts); what the database refused is `move.reason` there. `apply_mod_move` returns its own clamp.
 *
 * Nothing private reaches the model: the visit, the post, the thread and the rules are public play, the board's premise and the Boss's order are the game's, and the
 * memory, career and notes are a staff character's. The run reads no owner, class or reactor.
 *
 * **Cost does not grow with the instance.** One light-tier call per visit (two for an old voice with something to spend), at most `FILINGS_PER_RUN` visits, at most
 * `filingLinesPerDay` calls a day. A Mod's standing, career, memory and notes are read once for all its visits in a run, and a board's rules once.
 */
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import type { Career } from '../../../engine/system/career.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import {
  FILING_LINE_MOST,
  FILING_RULE,
  MOD_MOVE_RULE,
  filingCompletion,
  filingPrompt,
  repairFiling,
  repairMoveAnswer,
  type Dropped,
  type FilingInput,
  type ModMove,
  type ModMoveContext,
  type RuleLine,
} from '../../../engine/system/judgment.ts';
import type { Memory } from '../../../engine/system/memory.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';

/** The most visits one run files. A busy instance's rest is the next run's (every five minutes), or the tick's. */
export const FILINGS_PER_RUN = 20;

/** How long a run keeps starting visits: well inside the function's 150 seconds, so one run is over before the next is due. */
export const RUN_BUDGET_MS = 100_000;

interface Charge { readonly rule?: string; readonly rule_number?: number | null; readonly board?: string; readonly band: string; readonly cause: string; readonly about_act?: string }

interface DueVisit {
  readonly visit: string;
  readonly post: string;
  readonly thread: string;
  readonly staff: string;
  readonly ends_at: string;
  readonly board: { readonly id: string; readonly name: string; readonly premise: string };
  readonly charges: readonly Charge[];
}

interface Standing {
  readonly office: string | null;
  allowance: number;
  readonly order: string | null;
  readonly beat: readonly { readonly id: string; readonly name: string }[];
}

interface ThreadRead {
  readonly title: string;
  readonly posts: readonly { readonly act: string; readonly name: string; readonly body: string }[];
}

/** What a filing came to. `filed` and `already` ended the visit (this run, or the tick before it); every other status left it open. */
export type FilingStatus = 'filed' | 'already' | 'failed' | 'early' | 'late';

export interface FilingRecord {
  readonly visit: string;
  readonly staff: string;
  readonly status: FilingStatus;
  /** Whose words the filed line is: the model's, or the database's stock line. */
  readonly line: 'model' | 'stock';
  /** Why the stock line stands, or why a visit was left open. */
  readonly why?: string;
  /** Every bound the answer was trimmed to. */
  readonly trims: readonly Trim[];
  /** Everything the repair dropped, each with the predicate that failed. */
  readonly dropped: readonly Dropped[];
  /** What `apply_mod_move` said: queued, an earlier move of this cause found, or the database's reason it queued none. */
  readonly move?: { readonly move: number | null; readonly queued: boolean; readonly existing?: boolean; readonly reason?: string; readonly trimmed?: unknown };
  /** The model calls this filing made. */
  readonly calls: number;
}

export type StaffOutcome =
  | { readonly status: 'off' }
  | { readonly status: 'ok'; readonly due: number; readonly filings: readonly FilingRecord[] };

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const said = (e: unknown): string => clip(e instanceof Error ? e.message : String(e), 500);

/** Errors that are facts about the ledger or the transport to the database, not about one visit: thrown, stopping the run. */
const stopsTheRun = (e: unknown): boolean => e instanceof LedgerWriteFailed || e instanceof TransportError;

/** What a Mod is read for once in a run: its standing, career, memory, notes and the names its memory mentions. */
interface Known {
  readonly persona: Persona | undefined;
  readonly standing: Standing | null;
  readonly career: Career | null;
  readonly memory: Memory | null;
  readonly notes: readonly string[];
  readonly names: Readonly<Record<string, string>>;
}

export async function runFilings(db: Db, models: Models, instance: Instance, slot: string, clock: () => number = Date.now): Promise<StaffOutcome> {
  if (Number.isNaN(Date.parse(slot))) throw new Error(`staff: slot is not a time: ${JSON.stringify(slot)}`);
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  if (!settings.systemEnabled) return { status: 'off' };
  const started = clock();

  const visits = await db.rpc<DueVisit[]>('filings_due', { most: FILINGS_PER_RUN });
  const records: FilingRecord[] = [];
  if (visits.length === 0) return { status: 'ok', due: 0, filings: records };

  // The day's count of filing calls, and up as this run calls: every call is a ledger row, so the count is the spend.
  let used = await db.rpc<number>('filing_calls_today', {});
  const most = settings.modBots.filingLinesPerDay;
  const roster = tuned.system.roster;
  const known = new Map<string, Known>();
  const rulesOf = new Map<string, readonly RuleLine[]>();

  const learn = async (staff: string): Promise<Known> => {
    const have = known.get(staff);
    if (have) return have;
    const persona = roster.find((p) => p.key === staff);
    if (!persona) {
      const none: Known = { persona, standing: null, career: null, memory: null, notes: [], names: {} };
      known.set(staff, none);
      return none;
    }
    const standing = await db.rpc<Standing>('mod_standing', { staff });
    if (standing.office !== 'mod') {
      const off: Known = { persona, standing, career: null, memory: null, notes: [], names: {} };
      known.set(staff, off);
      return off;
    }
    const [career, memory, since] = await Promise.all([
      db.rpc<Career>('staff_career', { of_staff: staff }),
      db.rpc<Memory | null>('staff_memory_latest', { staff }),
      db.rpc<string | null>('staff_memory_at', { staff }),
    ]);
    const notes = await db.rpc<string[]>('staff_notes_recent', { of_staff: staff, since: since ? new Date(Date.parse(since)).toISOString() : null, most: settings.pool.notesRead });
    const mentioned = memory ? [...memory.opinions.map((o) => o.character), ...memory.grudges.map((g) => g.character)] : [];
    const names = mentioned.length ? await db.rpc<Record<string, string>>('pool_names', { ids: mentioned }) : {};
    const full: Known = { persona, standing, career, memory, notes, names };
    known.set(staff, full);
    return full;
  };

  for (const v of visits) {
    if (clock() - started > RUN_BUDGET_MS) { records.push(left(v, 'late', 'the run\'s time was spent; this visit is the next run\'s, or the tick\'s')); continue; }
    if (Date.parse(v.ends_at) > clock()) { records.push(left(v, 'early', 'its end has not come')); continue; }
    try {
      records.push(await oneFiling(v));
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (e instanceof DatabaseError) { records.push(left(v, 'failed', said(e))); continue; }
      throw e;
    }
  }
  return { status: 'ok', due: visits.length, filings: records };

  /** One visit, from its inputs to its filing. Throws only a run-stopping error or a database error, which the caller records. */
  async function oneFiling(v: DueVisit): Promise<FilingRecord> {
    const mod = await learn(v.staff);
    const trims: Trim[] = [];
    const dropped: Dropped[] = [];
    let calls = 0;
    let line: string | null = null;
    let why: string | undefined;
    let move: ModMove | null = null;

    // Who may be asked: a persona in the roster that is a Mod now, and only while the day's count has room.
    if (!mod.persona) why = 'the persona is not in the roster';
    else if (mod.standing?.office !== 'mod') why = 'the persona is not a Mod now';
    else if (used >= most) why = 'the day\'s filingLinesPerDay is spent';

    if (!why && mod.persona && mod.standing) {
      const persona = mod.persona;
      const standing = mod.standing;
      const rules = rulesOf.get(v.board.id) ?? await db.rpc<RuleLine[]>('rules_in_force', { board: v.board.id });
      rulesOf.set(v.board.id, rules);
      const read = await db.rpc<ThreadRead>('pool_thread', { in_thread: v.thread, most: settings.pool.chatterThreadPosts, chars: settings.digestExcerptChars, also: v.post });
      const post = read.posts.find((p) => p.act === v.post) ?? { name: 'a character', body: '' };
      const charges = v.charges.map((c) => ({ rule: c.rule ?? 'a breach of the rules', band: c.band, cause: c.cause }));
      const moveContext = (): ModMoveContext => ({ allowance: standing.allowance, beat: standing.beat.map((b) => b.id), ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours });
      const input = (): FilingInput => ({
        persona, order: standing.order, career: mod.career!, memory: mod.memory, notes: mod.notes, rules, allowance: standing.allowance, beat: standing.beat,
        ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours, names: (id) => mod.names[id] ?? 'a character',
        board: v.board, thread: { title: read.title, posts: read.posts.map((p) => ({ name: p.name, body: p.body })) }, post: { name: post.name, body: post.body }, charges,
        limits: { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, titleMaxLength: settings.titleMaxLength },
      });

      // The call. A transport failure was retried inside models(); what comes back is an answer, a rejection, or a failure.
      try {
        if (persona.voice === 'oldVoice') {
          const frame = filingCompletion({ name: persona.name, board: v.board.name, thread: input().thread, post: input().post, charges, limits: input().limits });
          used++; calls++;
          const out = await models.complete({ duty: 'filing', staff: v.staff, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens: 160, maxChars: FILING_LINE_MOST });
          const repaired = repairFiling({ words: out.value }, moveContext());
          line = repaired.line;
          trims.push(...repaired.trims);
          dropped.push(...repaired.dropped);
        } else {
          const frame = filingPrompt(input());
          used++; calls++;
          const out = await models.chat({
            duty: 'filing', tier: DUTY_SPECS.filing.tier, staff: v.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
            schema: frame.schema, rules: FILING_RULE, maxTokens: 1_000,
          });
          const repaired = repairFiling(out.value, moveContext());
          line = repaired.line;
          move = repaired.move;
          trims.push(...repaired.trims);
          dropped.push(...repaired.dropped);
        }
      } catch (e) {
        if (stopsTheRun(e)) throw e;
        why = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
      }

      // An old voice's move is its own, chat call, and only when it said a line, has something to spend, and the day has room.
      if (persona.voice === 'oldVoice' && !why && line !== null && standing.allowance >= 1 && standing.beat.length > 0 && used < most) {
        try {
          const frame = filingPrompt({ ...input(), mode: 'move', said: line });
          used++; calls++;
          const out = await models.chat({
            duty: 'filing', tier: DUTY_SPECS.filing.tier, staff: v.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
            schema: frame.schema, rules: MOD_MOVE_RULE, maxTokens: 600,
          });
          const repaired = repairMoveAnswer(out.value, moveContext());
          move = repaired.move;
          trims.push(...repaired.trims);
          if (repaired.dropped) dropped.push(repaired.dropped);
        } catch (e) {
          if (stopsTheRun(e)) throw e;
          dropped.push({ path: 'move', predicate: `callFailed: ${said(e)}` });
        }
      }
    }

    // The call's record, in the database: the trims and drops, once per call (a retry finds it), before anything that could fail after it.
    if (calls > 0) {
      await db.rpc('record_staff_call', { cause_act: v.visit, duty: 'filing', staff: v.staff, record: { line: line === null ? 'stock' : 'model', ...(why ? { why } : {}), trims, dropped, calls } });
    }

    // The move first (see the header): the database's guard decides it, and a refusal costs the filing nothing.
    let queued: FilingRecord['move'];
    if (move) {
      queued = await db.rpc<NonNullable<FilingRecord['move']>>('apply_mod_move', { staff: v.staff, move, cause_act: v.visit });
      if (queued.queued && mod.standing) mod.standing.allowance = Math.max(0, mod.standing.allowance - 1);
    }
    const filed = await db.rpc<{ filed: boolean }>('file_visit', line === null ? { visit_act: v.visit } : { visit_act: v.visit, line });
    return {
      visit: v.visit, staff: v.staff, status: filed.filed ? 'filed' : 'already', line: line === null ? 'stock' : 'model',
      ...(why ? { why } : {}), trims, dropped, ...(queued ? { move: queued } : {}), calls,
    };
  }
}

/** A visit this run left open. */
function left(v: DueVisit, status: FilingStatus, why: string): FilingRecord {
  return { visit: v.visit, staff: v.staff, status, line: 'stock', why, trims: [], dropped: [], calls: 0 };
}
