/**
 * The settlement job, as a pure module: ask the database for the next window up to `until`,
 * read what it holds, run the engine's settle() with the instance, and apply the result.
 * supabase/functions/settle/index.ts is the thin Edge Function around it; this file is what
 * Node tests (core.test.ts) and Deno both run.
 *
 * A run is safe to repeat. The same `until` sent again asks for a window already settled
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

export type SettlementOutcome =
  | { readonly status: 'nothing to settle'; readonly until: string }
  | { readonly status: 'applied' | 'already settled'; readonly window: { readonly start: string; readonly end: string }; readonly entries: number };

export async function runSettlement(db: Db, instance: Instance, until: string): Promise<SettlementOutcome> {
  if (Number.isNaN(Date.parse(until))) throw new Error(`settle: until is not a time: ${JSON.stringify(until)}`);
  const window = await db.rpc<{ start: string; end: string } | null>('next_settlement_window', { until });
  if (!window) return { status: 'nothing to settle', until };
  const tuned = await withDatabaseSettings(instance, db);
  const input = await db.rpc<SettlementInput>('settlement_input', { window_start: window.start, window_end: window.end });
  const result = settle(input, tuned);
  const applied = await db.rpc<{ applied: boolean }>('apply_settlement', {
    window_start: window.start,
    window_end: window.end,
    entries: result.entries.map((e) => ({ player: e.player, character: e.character, reason: e.reason, amount: e.amount })),
    class_totals: result.byClass,
    paid: result.paid,
  });
  return { status: applied.applied ? 'applied' : 'already settled', window, entries: result.entries.length };
}
