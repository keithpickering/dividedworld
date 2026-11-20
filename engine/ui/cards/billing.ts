/**
 * Billing: the order of a post's tags (docs/plans/2026-10-31-plays-on-a-post-design.md, section 2). The play that
 * has drawn the most gets top billing; "drawn" is its public reaction count plus the threads spun from it, and ties
 * go to the newest, then to the id, so the order is total and two readers given the same counts see the same order.
 *
 * Only public counts are read, never who reacted or who owns a play ("A response never proves a private fact"). The
 * order is only the tags': the order the effects wrap a post's words in is `inPlayOrder` (plays.ts), unchanged.
 *
 * Spent kinds go last when a page is read (docs/plans/2026-11-20-spent-marks-design.md, section 4): `billPost` puts
 * the kinds with a play still up before the spent ones, each part in billing order, so live cards fill a strip's marks
 * before "+N". The spent judgment for a post is made at the `now` of that post's first billing in this page's life
 * (`over.billedAt` keeps it), so a re-read or a catch-up never moves a mark because a clock passed; a kind that goes
 * spent while the page is open keeps its place, and no mark moves under a reader's pointer. A change that comes from
 * Acts (a catch, an admin's end, a draw) may still re-bill. `billing` itself is only the order by draws.
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

/** What `billPost` judges spent by: the keeping kinds, the clock, and where a post's first-billed time is kept. */
export interface BillOver {
  readonly now: number;
  readonly keeps: ReadonlySet<string>;
  /** A post's `now` at its first billing in this page's life; set here when it bills, read on every later billing. */
  readonly billedAt?: Map<Id, number>;
}

/**
 * Bill a post's plays once its page's reads are in: the plays the read counted (`counted`), most drawn first. A play
 * that arrived while the reads were out was not counted, and keeps its place after them, as any play that arrives
 * live does; so a read never has to know what came meanwhile, and nothing is asked of a count it does not have.
 * With `over`, kinds that are not spent (`kindSpent`, judged on all the post's counted plays of the kind, at the
 * post's first-billed time) come first, then the spent ones, each in billing order; without it, billing order alone.
 */
export function billPost(plays: Plays, post: Id, counted: { has(play: Id): boolean }, drawn: (play: Id) => number, over?: BillOver): void {
  const here = plays.get(post).plays.filter((p) => counted.has(p.id));
  if (here.length === 0) return;
  const order = billing(here, drawn);
  if (!over) { plays.setBilling(post, order.map((p) => p.id)); return; }
  const now = over.billedAt?.get(post) ?? over.now;
  over.billedAt?.set(post, now);
  const spent = new Set<string>();
  for (const kind of new Set(here.map((p) => p.card))) if (kindSpent(here.filter((p) => p.card === kind), now, over.keeps)) spent.add(kind);
  plays.setBilling(post, [...order.filter((p) => !spent.has(p.card)), ...order.filter((p) => spent.has(p.card))].map((p) => p.id));
}
