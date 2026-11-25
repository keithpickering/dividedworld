/**
 * How much of a Whoops! play's ink has been washed away, as a share from 0 to 1, for the staff's read of the post (`whoops.seen`). The share is
 * the screens' own (`LayerInk.washed`, scrub.ts) over a nominal box, since the strokes are kept in shares of the body's box and the staff have no
 * screen: the same strokes give close shares on any box, not equal ones, which is the precision of "a bit" and "most". A layer the author washed clean
 * is 1; any other is below 1, as the screens' readout says (`percentWashed`). A malformed state or config counts as nothing washed, and nothing here throws.
 */
import { savedOf } from './saved.ts';
import { LayerInk, type Stroke } from './scrub.ts';
import { makeSplat, type Box } from './splat.ts';

const NOMINAL: Box = { w: 300, h: 150 };
/** The most points a play's strokes are thinned to before they are replayed, so a read that renders many plays does bounded work each (the card allows 40,000 points). */
export const POINT_BUDGET = 400;

/** The strokes with their points thinned evenly to about `POINT_BUDGET` in all, each keeping its first and last point so a line still starts where the one before ended. */
export function thinned(strokes: readonly Stroke[]): Stroke[] {
  const total = strokes.reduce((n, s) => n + s.points.length, 0);
  if (total <= POINT_BUDGET) return [...strokes];
  const keep = POINT_BUDGET / total;
  return strokes.map((s) => {
    const want = Math.max(2, Math.ceil(s.points.length * keep));
    if (s.points.length <= want) return s;
    const points = Array.from({ length: want }, (_, i) => s.points[Math.round((i * (s.points.length - 1)) / (want - 1))]!);
    return { ...s, points };
  });
}

export function washedShare(config: unknown, state: unknown): number {
  const { strokes, clean } = savedOf(state);
  if (clean) return 1;
  if (strokes.length === 0) return 0;
  const raw = typeof config === 'object' && config !== null ? (config as { seed?: unknown }).seed : undefined;
  const seed = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) | 0 : 0;
  try {
    const washed = new LayerInk(makeSplat(seed), thinned(strokes), NOMINAL).washed;
    return Number.isFinite(washed) ? Math.min(0.99, Math.max(0, washed)) : 0;
  } catch {
    return 0;
  }
}
