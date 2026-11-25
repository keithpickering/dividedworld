/**
 * The settlement job, as a pure module: ask the database for the next window up to `until`,
 * read what it holds, run the engine's settle() with the instance, and apply the result.
 * supabase/functions/settle/index.ts is the thin Edge Function around it; this file is what
 * Node tests (core.test.ts) and Deno both run.
 *
 * A run settles every window up to `until`, one at a time and in order: a day missed is its own
 * window (supabase/migrations/0004_schedule.sql's next_settlement_window), never folded into
 * the next. A run is safe to repeat. The same `until` sent again asks for a window already settled
 * (`nothing to settle`); two runs at once with the same `until` both compute the window and
 * apply_settlement() writes it once (`already settled`); two that overlap with different ones
 * leave the later failing on the window's start, and the next firing settles from there. A database error is
 * thrown, never swallowed: the window stays unsettled, and the next firing settles from where
 * the last settled window ended, so nothing is lost and nothing is counted twice.
 *
 * What a settlement posts (its tally, a season's reveal) is written with it into an outbox
 * (supabase/migrations/0007_seasons.sql's broadcasts_due), and every run ends by sending what
 * waits there and clearing what was sent. A run that fails between the two, or a send that
 * fails, leaves it for the next run; a window is applied once, so nothing is queued twice. A
 * run that dies between a send and its clearing sends that batch again, which a client, keeping
 * each Act by its id, takes as the same Act.
 *
 * **The Roster Report** (the staff-board threads plan, Task 7) follows the windows when the caller gives it (`options.roster`): each applied window of the open season with no entry
 * (`roster_due`, oldest first) is read (`roster_facts`: public facts only), given one light-tier call for its commentary in the Boss's name, and written (`write_roster_entry`: the
 * Boss's posts and the entry). It runs after `apply_settlement` has committed and is never the settlement's failure: whatever goes wrong in it is logged and the run goes on, and a
 * window whose entry was not written is still due at the next run, which writes it (a run with nothing to settle writes the entries that wait). A model that fails posts the entry under
 * the stock heading and says why on its record; a database or ledger error stops the roster there, leaving the window due. The settlement's answer says nothing of it.
 */
import { settle, shareEntries } from '../../../engine/rules/settle.ts';
import type { Instance, SettlementInput } from '../../../engine/rules/types.ts';
import { DUTY_SPECS, staffFor } from '../../../engine/system/duties.ts';
import type { Models } from '../../../engine/system/model.ts';
import { DEFAULT_ROSTER_COPY, rosterBodies, rosterCommentary, rosterIsEmpty, rosterPrompt, type RosterCopy, type RosterFacts } from '../../../engine/system/roster.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { LedgerWriteFailed } from '../_shared/models/index.ts';
import type { Broadcast, Delivery } from '../_shared/broadcast.ts';
import { sendWaiting } from '../_shared/outbox.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

type Window = { readonly start: string; readonly end: string };
export type SettlementOutcome =
  | { readonly status: 'nothing to settle'; readonly until: string }
  | {
    readonly status: 'applied' | 'already settled';
    /** The last window this run settled. */
    readonly window: Window;
    /**
     * Every window this run settled, in order, each with whether this run applied it and its
     * entries, and why its tally (masks) or its reveal could not be written, where one could not.
     */
    readonly windows: readonly (Window & { readonly applied: boolean; readonly entries: number; readonly masks?: string; readonly reveal?: string })[];
    readonly entries: number;
    /** Whether windows are still waiting, because this run settled as many as one run may. */
    readonly behind: boolean;
  };

/** What a run is given beside its database: a clock, and how it sends what waits to be broadcast. */
export interface RunOptions {
  readonly clock?: () => number;
  /** Sends live updates and says how it ended (supabase/functions/_shared/broadcast.ts); none sends nothing, and leaves them waiting. */
  readonly deliver?: (messages: readonly Broadcast[]) => Promise<Delivery>;
  /** The Roster Report's commentary: the models, built from the instance as the database's settings tune it (the tiers are a setting), and the words of its headings. None writes no entries. */
  readonly roster?: RosterRun;
}

export interface RosterRun {
  readonly models: (tuned: Instance) => Models | Promise<Models>;
  readonly copy?: RosterCopy;
}

/**
 * How many windows one run settles before it stops: a month of missed days, and the next firing
 * carries on from where this one ended. A cron that fires less often than this many lengths
 * never catches up; a run that stops behind says so in the function's log (index.ts).
 */
export const MOST_WINDOWS_PER_RUN = 31;

/**
 * How long a run goes on starting windows, in milliseconds: well inside an Edge Function's
 * wall clock, so a busy instance's slow windows stop the run between windows, each one whole,
 * rather than a kill stopping it inside one. The next firing carries on.
 */
export const MOST_RUN_MS = 60_000;

/** How many windows' entries one run writes: as many as a run settles. */
const MOST_ROSTER_WINDOWS = MOST_WINDOWS_PER_RUN;

export async function runSettlement(db: Db, instance: Instance, until: string, options: RunOptions = {}): Promise<SettlementOutcome> {
  const clock = options.clock ?? Date.now;
  // With no sender nothing is claimed from the outbox: a claim that is never sent holds its rows for its lease, away from the next run that sends.
  const deliver = options.deliver;
  const sendOutbox = async () => { if (deliver) await sendWaiting(db, deliver); };
  if (Number.isNaN(Date.parse(until))) throw new Error(`settle: until is not a time: ${JSON.stringify(until)}`);
  const windows: (Window & { applied: boolean; entries: number; masks?: string; reveal?: string })[] = [];
  const started = clock();
  let tuned: Instance | undefined;
  // Missed days are settled one window at a time, in order, each in its own transaction
  // (apply_settlement), so a failure between two keeps the first and the next run resumes at
  // the second (the owner's answer 7, on #4).
  for (;;) {
    const window = await db.rpc<Window | null>('next_settlement_window', { until });
    if (!window) break;
    if (windows.length === MOST_WINDOWS_PER_RUN || (windows.length && clock() - started >= MOST_RUN_MS)) {
      await sendOutbox();
      return outcome(windows, true);
    }
    // The run's claim on the window, before it reads the window (the core loop design, section 4, #22): a reveal waits while a
    // claim on an ended window covering a waiting Turn stands (unmask, 0074), since the window's end is not always known in advance.
    // The claim holds until a settlement past its start is written, this run's or an overlapping one's, and never by a clock: one
    // window's work can outlast any fixed length on a busy instance, and no clock tells a live run from a dead one (#179). A claim
    // that cannot be written fails the run, as any read does.
    await db.rpc('claim_settlement_window', { window_start: window.start, window_end: window.end });
    tuned ??= await withDatabaseSettings(instance, db);
    const input = await db.rpc<SettlementInput>('settlement_input', { window_start: window.start, window_end: window.end });
    const result = settle(input, tuned);
    // Each entry split across the posts the live estimate valued, written with it (the log shares
    // design): a second run of settle over the window, with the shared vote and the halving off.
    const shares = shareEntries(input, tuned, result.entries);
    const applied = await db.rpc<{ applied: boolean; masks?: string; reveal?: string }>('apply_settlement', {
      window_start: window.start,
      window_end: window.end,
      // With the numbers each entry's words state, as it was settled under them (ledger.params, 0073).
      entries: result.entries.map((e) => ({ player: e.player, character: e.character, reason: e.reason, amount: e.amount, ...(e.params ? { params: e.params } : {}) })),
      class_totals: result.byClass,
      paid: result.paid,
      // Each player's crowd pay as the Acts alone: apply_settlement checks each against the window and prices them from the setting, so an amount is never sent.
      crowd: result.crowd.map(({ player, acts }) => ({ player, acts })),
      shares: shares.map((s) => ({ character: s.character, reason: s.reason, ...(typeof s.params?.card === 'string' ? { card: s.params.card } : {}), act: s.act, ...(s.quadrant ? { quadrant: s.quadrant } : {}), amount: s.amount })),
      // This window's sums of the earnings a class marked `tally`, by Act and reason: written with the settlement in the same transaction, and read back by the next window's input as `tallied`.
      tallied: result.tallied,
    });
    // A tally or a reveal that could not be written leaves what waited for the next settlement;
    // said in the log, so an admin sees what to seed, and in the outcome.
    if (applied.masks) console.error('settle: the masks did not change at', window.end, applied.masks);
    if (applied.reveal) console.error('settle: the season was not revealed at', window.end, applied.reveal);
    windows.push({ ...window, applied: applied.applied, entries: result.entries.length, ...(applied.masks ? { masks: applied.masks } : {}), ...(applied.reveal ? { reveal: applied.reveal } : {}) });
  }
  if (options.roster) {
    try {
      await runRoster(db, async () => (tuned ??= await withDatabaseSettings(instance, db)), options.roster, clock, started);
    } catch (e) {
      console.error('settle: the Roster Report stopped; its windows stay due for the next run', e instanceof Error ? e.message : String(e));
    }
  }
  await sendOutbox();
  return windows.length ? outcome(windows, false) : { status: 'nothing to settle', until };
}

const said = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** What the commentary call came to: its words (none where it failed or said nothing), the bounds it overshot, and why it has none where that is a failure. */
interface Commentary { readonly text: string | null; readonly trims: readonly Trim[]; readonly failed?: string }

async function commentary(db: Db, tuned: Instance, models: () => Promise<Models>, facts: RosterFacts): Promise<Commentary> {
  // Nothing is asked of a System that is off, or of a season with no Boss: the database writes such an entry with no posts, and says why.
  if (!tuned.settings.systemEnabled) return { text: null, trims: [] };
  const boss = await db.rpc<string | null>('current_boss', {});
  if (!boss) return { text: null, trims: [] };
  const persona = tuned.system.roster.find((p) => p.key === boss);
  if (!persona) return { text: null, trims: [], failed: `the Boss ${boss} is not in the roster` };
  // The report is the Boss's work: its commentary is written in the Boss's voice and its posts are the Boss's. A duty the instance gives to anyone else is not served by a call in the Boss's name.
  const assigned = staffFor('roster', tuned);
  if (assigned !== 'boss') return { text: null, trims: [], failed: `the roster duty is assigned to ${assigned}, and only the Boss writes the report` };
  const className = (key: string) => tuned.classes.find((c) => c.key === key)?.name ?? key;
  try {
    const frame = rosterPrompt(tuned.system, persona, facts, className);
    const out = await (await models()).chat({ duty: 'roster', tier: DUTY_SPECS.roster.tier, staff: boss, system: frame.system, messages: frame.messages, schema: frame.schema, rules: frame.rules, maxTokens: frame.maxTokens });
    const answer = rosterCommentary(out.value);
    const trims = [...out.trims, ...answer.trims];
    return answer.text === null ? { text: null, trims, failed: 'the answer held no commentary' } : { text: answer.text, trims };
  } catch (e) {
    // A ledger that cannot be written, or a database that cannot be reached, is a fact about the infrastructure: the entry waits for the next run, as a paid call that cannot be recorded must not be followed by anything.
    if (e instanceof LedgerWriteFailed || e instanceof DatabaseError || e instanceof TransportError) throw e;
    return { text: null, trims: [], failed: said(e) };
  }
}

/** The due windows' entries, oldest first, each one whole: read, commented on, written. A window that cannot be written stops the roster there, so that later windows are never written ahead of it. */
async function runRoster(db: Db, tunedNow: () => Promise<Instance>, roster: RosterRun, clock: () => number, started: number): Promise<void> {
  const due = (await db.rpc<string[]>('roster_due', {})).slice(0, MOST_ROSTER_WINDOWS);
  let models: Models | undefined;
  for (const end of due) {
    if (clock() - started >= MOST_RUN_MS) return;
    const facts = await db.rpc<RosterFacts>('roster_facts', { window_end: end });
    const record: Record<string, unknown> = { counts: { newcomers: facts.newcomers.length, announced: facts.announced.length, landed: facts.landed.length, reveals: facts.reveals.length } };
    let bodies: string[] = [];
    if (!rosterIsEmpty(facts)) {
      const tuned = await tunedNow();
      const answer = await commentary(db, tuned, async () => (models ??= await roster.models(tuned)), facts);
      const className = (key: string) => tuned.classes.find((c) => c.key === key)?.name ?? key;
      bodies = rosterBodies(facts, roster.copy ?? DEFAULT_ROSTER_COPY, tuned.settings.postMaxLength, { postsPerPage: tuned.settings.postsPerPage, commentary: answer.text, className });
      record.commentary = answer.text;
      if (answer.trims.length) record.trims = answer.trims;
      if (answer.failed !== undefined) record.commentaryFailed = answer.failed;
    }
    await db.rpc('write_roster_entry', { window_end: end, newcomers: facts.newcomers.map((n) => n.character), bodies, record });
  }
}

function outcome(windows: (Window & { applied: boolean; entries: number; masks?: string; reveal?: string })[], behind: boolean): SettlementOutcome {
  const last = windows.at(-1)!;
  return {
    status: windows.some((w) => w.applied) ? 'applied' : 'already settled',
    window: { start: last.start, end: last.end },
    windows,
    entries: windows.reduce((n, w) => n + w.entries, 0),
    behind,
  };
}
