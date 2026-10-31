/**
 * Billing: the order of a post's tags (docs/plans/2026-10-31-plays-on-a-post-design.md, section 2). The play that
 * has drawn the most gets top billing; "drawn" is its public reaction count plus the threads spun from it, and ties
 * go to the newest, then to the id, so the order is total and two readers given the same counts see the same order.
 *
 * Only public counts are read, never who reacted or who owns a play ("A response never proves a private fact"). The
 * order is only the tags': the order the effects wrap a post's words in is `inPlayOrder` (plays.ts), unchanged.
 */
import type { Id, Tally } from '../data/api.ts';
import type { CardPlay } from './types.ts';

/** A play's draw: the sum of its public tally, plus the threads spun from it. */
export function drawnOf(tally: Tally, spun: number): number {
  let sum = spun;
  for (const count of Object.values(tally)) sum += count;
  return sum;
}

/** The plays in billing order, a new list: the most drawn first, then the newest, then by id. */
export function billing(plays: readonly CardPlay[], drawn: (play: Id) => number): readonly CardPlay[] {
  const draws = new Map(plays.map((p) => [p.id, drawn(p.id)]));
  return [...plays].sort((a, b) =>
    draws.get(b.id)! - draws.get(a.id)!
    || Date.parse(b.playedAt) - Date.parse(a.playedAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
