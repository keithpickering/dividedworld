/**
 * Billing: the order of a post's tags (docs/plans/2026-10-31-plays-on-a-post-design.md, section 2). The play that
 * has drawn the most gets top billing; "drawn" is its public reaction count plus the threads spun from it, and ties
 * go to the newest, then to the id, so the order is total and two readers given the same counts see the same order.
 *
 * Only public counts are read, never who reacted or who owns a play ("A response never proves a private fact"). The
 * order is only the tags': the order the effects wrap a post's words in is `inPlayOrder` (plays.ts), unchanged.
 *
 * Spent kinds go last when a page is read (docs/plans/2026-11-20-spent-marks-design.md, section 4): `billPost` puts the kinds with a play still
 * up before the spent ones, each part in billing order, so live cards fill a strip's marks before "+N". A kind that goes spent later keeps its
 * place, since billing is set at the read and no mark moves under a reader's pointer. `billing` itself is only the order by draws.
 */
import type { Id, Tally } from '../data/api.ts';
import { kindSpent, type Plays } from './plays.ts';
import type { CardPlay } from './types.ts';

/** A play's draw: the sum of its public tally, plus the threads spun from it. */
export function drawnOf(tally: Tally, spun: number): number {
  let sum = spun;
  for (const count of Object.values(tally)) sum += count;
  return sum;
}

/** The plays in billing order, a new list: the most drawn first, then the newest, then by id. */
export function billing(plays: readonly CardPlay[], drawn: (play: Id) => number): readonly CardPlay[] {
  /* Each play's draw is asked once; one that is not a number counts as none, so the order stays total. */
  const draws = new Map(plays.map((p) => { const n = drawn(p.id); return [p.id, Number.isFinite(n) ? n : 0]; }));
  return [...plays].sort((a, b) =>
    draws.get(b.id)! - draws.get(a.id)!
    || Date.parse(b.playedAt) - Date.parse(a.playedAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Bill a post's plays once its page's reads are in: the plays the read counted (`counted`), most drawn first. A play
 * that arrived while the reads were out was not counted, and keeps its place after them, as any play that arrives
 * live does; so a read never has to know what came meanwhile, and nothing is asked of a count it does not have.
 * Kinds that are not spent at `over.now` (`kindSpent`, judged on all the post's counted plays of the kind) come first, then the spent ones, each in billing order.
 */
export function billPost(plays: Plays, post: Id, counted: { has(play: Id): boolean }, drawn: (play: Id) => number, over: { readonly now: number; readonly keeps: ReadonlySet<string> }): void {
  const here = plays.get(post).plays.filter((p) => counted.has(p.id));
  if (here.length === 0) return;
  const spent = new Set<string>();
  for (const kind of new Set(here.map((p) => p.card))) if (kindSpent(here.filter((p) => p.card === kind), over.now, over.keeps)) spent.add(kind);
  const order = billing(here, drawn);
  plays.setBilling(post, [...order.filter((p) => !spent.has(p.card)), ...order.filter((p) => spent.has(p.card))].map((p) => p.id));
}
