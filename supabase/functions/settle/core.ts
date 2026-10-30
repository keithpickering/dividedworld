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

/** How many waiting broadcasts one send carries. */
const BROADCASTS_PER_SEND = 500;

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
  const deliver = options.deliver ?? (async (): Promise<Delivery> => 'unreachable');
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
      await sendWaiting(db, deliver);
      return outcome(windows, true);
    }
    tuned ??= await withDatabaseSettings(instance, db);
    const input = await db.rpc<SettlementInput>('settlement_input', { window_start: window.start, window_end: window.end });
    const result = settle(input, tuned);
    // Each entry split across the posts the live estimate valued, written with it (the log shares
    // design): a second run of settle over the window, with the shared vote and the halving off.
    const shares = shareEntries(input, tuned, result.entries);
    const applied = await db.rpc<{ applied: boolean; masks?: string; reveal?: string }>('apply_settlement', {
      window_start: window.start,
      window_end: window.end,
      entries: result.entries.map((e) => ({ player: e.player, character: e.character, reason: e.reason, amount: e.amount })),
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
  await sendWaiting(db, deliver);
  return windows.length ? outcome(windows, false) : { status: 'nothing to settle', until };
}

/**
 * Sends what waits in the outbox, a batch at a time, and clears each batch once it went. Where
 * Realtime cannot be reached, everything stays for the next run. Where it refuses a batch for
 * good (a 413, say), the batch is sent one message at a time, so one bad message never holds back
 * every one after it, run after run: each that goes is cleared, and one refused alone is given
 * up, logged by its topic, and cleared too. Its Act is on the board for the next load.
 */
async function sendWaiting(db: Db, deliver: NonNullable<RunOptions['deliver']>): Promise<void> {
  const shape = (m: { topic: string; event: string; payload: unknown }) => ({ topic: m.topic, event: m.event, payload: m.payload });
  for (;;) {
    const due = await db.rpc<{ id: number; topic: string; event: string; payload: unknown }[]>('due_broadcasts', { most: BROADCASTS_PER_SEND });
    if (!due.length) return;
    const outcome = await deliver(due.map(shape));
    if (outcome === 'unreachable') return;
    if (outcome === 'refused') {
      for (const m of due) {
        const one = await deliver([shape(m)]);
        if (one === 'unreachable') return;
        if (one === 'refused') console.error('broadcast given up: Realtime refuses it for good', m.topic, m.event, m.id);
        await db.rpc('broadcasts_sent', { ids: [m.id] });
      }
    } else {
      await db.rpc('broadcasts_sent', { ids: due.map((m) => m.id) });
    }
    if (due.length < BROADCASTS_PER_SEND) return;
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
