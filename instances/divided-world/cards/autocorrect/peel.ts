/**
 * What Autocorrect's strips are, and what peeling one does, as plain functions the Effect draws from (the Autocorrect design,
 * sections 3 and 4).
 *
 * - **A strip** is one occurrence of one play's phrase in the post's visible text (match.ts), numbered in the post's order, so a
 *   peel saved by the author ("the second Mario") is kept by place and holds across edits that keep the order.
 * - **Peeled**, it leaves an adhesive mark over the author's words: by the author's save, for everyone, or by this reader's own
 *   peel, on this screen only.
 * - **Stacked**, the later play's strip is stuck over the earlier one: where live strips overlap, only the top one shows, over
 *   the whole stretch they cover together, and peeling it shows the one beneath.
 * - **A peel** is a drag past twice the strip's height (24 pixels at least), or a key held for the card's `peelMs`, about as long
 *   as a drag takes ("An accessible path costs what the obstacle costs").
 */
import { occurrences } from './match.ts';

/** One play as the strips read it: its phrase and replacement, and the places its author's save has peeled. */
export interface PlayStrips {
  readonly id: string;
  readonly phrase: string;
  readonly replacement: string;
  readonly peeled: ReadonlySet<number>;
}

/** One strip: a play's occurrence, at offsets into the visible text, with its place in the play and its height in the stack. */
export interface Strip {
  /** `${play}:${index}`, which a reader's own peels are kept by. */
  readonly key: string;
  readonly play: string;
  readonly index: number;
  readonly from: number;
  readonly to: number;
  readonly replacement: string;
  readonly z: number;
}

const LEAST_DRAG = 24;

/** How far a strip is pulled before it comes away: twice its height, and never less than 24 pixels. */
export const dragThreshold = (height: number): number => Math.max(LEAST_DRAG, 2 * height);

/** Whether a pull of (dx, dy) pixels takes a strip this tall off. */
export const dragPeels = (dx: number, dy: number, height: number): boolean => Math.hypot(dx, dy) >= dragThreshold(height);

/** How far a held key has peeled a strip, 0 to 1. */
export const holdShare = (heldMs: number, peelMs: number): number => Math.max(0, Math.min(1, heldMs / Math.max(1, peelMs)));

/**
 * The strips of every play on a post: those that show (the top of each stack of live strips, over all it covers), those peeled
 * (each its adhesive mark), and each play's count of places in this version of the post.
 */
export function stripsOf(text: string, plays: readonly PlayStrips[], local: ReadonlySet<string>): { shown: Strip[]; peeled: Strip[]; total: Record<string, number> } {
  const live: Strip[] = [];
  const peeled: Strip[] = [];
  const total: Record<string, number> = {};
  plays.forEach((p, z) => {
    const found = occurrences(text, p.phrase);
    total[p.id] = found.length;
    found.forEach(({ from, to }, index) => {
      const strip: Strip = { key: `${p.id}:${index}`, play: p.id, index, from, to, replacement: p.replacement, z };
      (p.peeled.has(index) || local.has(strip.key) ? peeled : live).push(strip);
    });
  });
  const shown: Strip[] = [];
  let stack: Strip[] = [];
  const close = () => {
    if (!stack.length) return;
    const top = stack.reduce((a, b) => (b.z > a.z ? b : a));
    shown.push({ ...top, from: Math.min(...stack.map((s) => s.from)), to: Math.max(...stack.map((s) => s.to)) });
    stack = [];
  };
  let reach = -1;
  for (const s of [...live].sort((a, b) => a.from - b.from || a.z - b.z)) {
    if (s.from >= reach) close();
    stack.push(s);
    reach = Math.max(reach, s.to);
  }
  close();
  return { shown, peeled, total };
}

/** The author's save once they peel a place: every place peeled, in order, and clean once none is left in this version. */
export function savedAfterPeel(peeled: readonly number[], index: number, total: number): { peeled: number[]; clean?: true } {
  const kept = [...new Set([...peeled, index])].sort((a, b) => a - b);
  const clean = total > 0 && Array.from({ length: total }, (_, i) => i).every((i) => kept.includes(i));
  return clean ? { peeled: kept, clean: true } : { peeled: kept };
}
