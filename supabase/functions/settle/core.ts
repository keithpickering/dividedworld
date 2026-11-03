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
 */
import { settle, shareEntries } from '../../../engine/rules/settle.ts';
import type { Instance, SettlementInput } from '../../../engine/rules/types.ts';
import type { Db } from '../_shared/rpc.ts';
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
      shares: shares.map((s) => ({ character: s.character, reason: s.reason, act: s.act, ...(s.quadrant ? { quadrant: s.quadrant } : {}), amount: s.amount })),
    });
    // A tally or a reveal that could not be written leaves what waited for the next settlement;
    // said in the log, so an admin sees what to seed, and in the outcome.
    if (applied.masks) console.error('settle: the masks did not change at', window.end, applied.masks);
    if (applied.reveal) console.error('settle: the season was not revealed at', window.end, applied.reveal);
    windows.push({ ...window, applied: applied.applied, entries: result.entries.length, ...(applied.masks ? { masks: applied.masks } : {}), ...(applied.reveal ? { reveal: applied.reveal } : {}) });
  }
  await sendOutbox();
  return windows.length ? outcome(windows, false) : { status: 'nothing to settle', until };
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
