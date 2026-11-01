/**
 * What the screens read out of a move: the notice a board shows (the Boss's `move` Act, its top reactions and the progress of its
 * demand) and the parts of a demand's progress. Pure, and shared by the Supabase adapter and the in-memory backend so the two
 * build a notice the one way.
 */
import { NOTICE_REACTIONS, type Act, type Demand, type DemandProgress, type MoveNotice, type Tally } from './api.ts';

const isObject = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);

/** A demand as a move's payload (or the queue) carries it, or null when there is none. */
export function toDemand(v: unknown): Demand | null {
  if (!isObject(v) || typeof v['kind'] !== 'string') return null;
  return { kind: v['kind'], params: isObject(v['params']) ? v['params'] : {} };
}

/** A progress as `move_progress` answers it; anything that is not one is "0 of 0, not met", which a screen shows without a count. */
export function toProgress(v: unknown): DemandProgress {
  if (!isObject(v)) return { done: 0, of: 0, met: false };
  const error = typeof v['error'] === 'string' ? v['error'] : undefined;
  return { done: whole(v['done']), of: whole(v['of']), met: v['met'] === true, ...(error === undefined ? {} : { error }) };
}

/** The kinds with the most reactions, most first (ties by kind, so the order is the same everywhere), at most `limit`. */
export function topReactions(tally: Tally, limit = NOTICE_REACTIONS): MoveNotice['reactions'] {
  return Object.entries(tally)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([kind, count]) => ({ kind, count }));
}

/** The notice for a `move` Act, or null for an Act that is no move. */
export function buildMoveNotice(act: Act, tally: Tally, progress: unknown): MoveNotice | null {
  if (act.kind !== 'move') return null;
  const p = act.payload;
  const demand = toDemand(p['demand']);
  return {
    act: act.id, thread: act.thread, character: act.character, kind: typeof p['kind'] === 'string' ? p['kind'] : '',
    params: isObject(p['params']) ? p['params'] : {}, demand, body: typeof p['body'] === 'string' ? p['body'] : '',
    expiresAt: typeof p['expires_at'] === 'string' ? p['expires_at'] : null, landedAt: act.createdAt,
    progress: demand === null ? null : toProgress(progress), reactions: topReactions(tally),
  };
}
