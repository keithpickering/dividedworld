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
 */
import { settle } from '../../../engine/rules/settle.ts';
import type { Instance, SettlementInput } from '../../../engine/rules/types.ts';
import type { Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

type Window = { readonly start: string; readonly end: string };
export type SettlementOutcome =
  | { readonly status: 'nothing to settle'; readonly until: string }
  | {
    readonly status: 'applied' | 'already settled';
    /** The last window this run settled. */
    readonly window: Window;
    /** Every window this run settled, in order, each with whether this run applied it and its entries. */
    readonly windows: readonly (Window & { readonly applied: boolean; readonly entries: number })[];
    readonly entries: number;
    /** Whether windows are still waiting, because this run settled as many as one run may. */
    readonly behind: boolean;
  };

/**
 * How many windows one run settles before it stops: a month of missed days, so a run fits in an
 * Edge Function's time, and the next firing carries on from where this one ended.
 */
export const MOST_WINDOWS_PER_RUN = 31;

export async function runSettlement(db: Db, instance: Instance, until: string): Promise<SettlementOutcome> {
  if (Number.isNaN(Date.parse(until))) throw new Error(`settle: until is not a time: ${JSON.stringify(until)}`);
  const windows: (Window & { applied: boolean; entries: number })[] = [];
  let tuned: Instance | undefined;
  // Missed days are settled one window at a time, in order, each in its own transaction
  // (apply_settlement), so a failure between two keeps the first and the next run resumes at
  // the second (the owner's answer 7, on #4).
  for (;;) {
    const window = await db.rpc<Window | null>('next_settlement_window', { until });
    if (!window) break;
    if (windows.length === MOST_WINDOWS_PER_RUN) return outcome(windows, true);
    tuned ??= await withDatabaseSettings(instance, db);
    const input = await db.rpc<SettlementInput>('settlement_input', { window_start: window.start, window_end: window.end });
    const result = settle(input, tuned);
    const applied = await db.rpc<{ applied: boolean }>('apply_settlement', {
      window_start: window.start,
      window_end: window.end,
      entries: result.entries.map((e) => ({ player: e.player, character: e.character, reason: e.reason, amount: e.amount })),
      class_totals: result.byClass,
      paid: result.paid,
    });
    windows.push({ ...window, applied: applied.applied, entries: result.entries.length });
  }
  return windows.length ? outcome(windows, false) : { status: 'nothing to settle', until };
}

function outcome(windows: (Window & { applied: boolean; entries: number })[], behind: boolean): SettlementOutcome {
  const last = windows.at(-1)!;
  return {
    status: windows.some((w) => w.applied) ? 'applied' : 'already settled',
    window: { start: last.start, end: last.end },
    windows,
    entries: windows.reduce((n, w) => n + w.entries, 0),
    behind,
  };
}
