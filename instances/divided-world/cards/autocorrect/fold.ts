/**
 * The corner's fold (docs/plans/2026-11-20-autocorrect-feel-design.md section 5), as pure geometry with no DOM. A pick at `t`
 * (0..1) folds the end back along a crease: a line that starts at 45 degrees across the corner, a third of the tape's height in,
 * and moves in and stands upright as the pick goes on (smoothstep), so that when the pick is up it runs straight across the end,
 * which is where the roll starts. Everything on the corner's side of the crease turns about it by an angle growing from 110 to
 * 150 degrees; seen from above a point `d` from the crease lands `d * cos(angle)` from it, which past 90 degrees is back over the
 * tape. Ported from the bench's `drawPicked` (docs/research/2026-11-20-autocorrect-feel-bench/01-bench.html).
 *
 * Everything is for the LEFT end, in the piece's own pixels with y down; the right end is the same drawing mirrored, which the
 * caller does by flipping the context.
 */
import { endJags, tearJag, type Jag } from './paper.ts';

export interface Crease {
  /** The crease's unit normal, pointing to the corner. */
  readonly n: readonly [number, number];
  /** A point on the crease, on the tape's top edge (y = 0). */
  readonly A: readonly [number, number];
  /** The turn, in radians. */
  readonly angle: number;
}

const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** The crease for a pick at `t`, on a piece `w` by `h` whose left end is `endTop` from the piece's edge along its top. (`w` is the piece's width; the crease does not depend on it.) */
export function creaseAt(t: number, w: number, h: number, endTop: number): Crease {
  void w;
  const beta = (Math.PI / 4) * (1 - smoothstep(t));
  const n: [number, number] = [-Math.cos(beta), -Math.sin(beta)];
  const ax = endTop + (h * (0.34 + 0.9 * t) * (Math.cos(beta) + Math.sin(beta))) / Math.SQRT2;
  return { n, A: [ax, 0], angle: ((110 + 40 * t) * Math.PI) / 180 };
}

/** The affine `[a, b, c, d, e, f]` (canvas `transform` order) that maps p to p - q n (n.p - n.A), with q = 1 - cos(angle). */
export function foldMatrix({ n, A, angle }: Crease): [number, number, number, number, number, number] {
  const q = 1 - Math.cos(angle);
  const nA = n[0] * A[0] + n[1] * A[1];
  return [1 - q * n[0] * n[0], -q * n[0] * n[1], -q * n[0] * n[1], 1 - q * n[1] * n[1], q * n[0] * nA, q * n[1] * nA];
}

/**
 * The outline of the end being picked, in the fold's frame: `u` runs from the end into the tape (so the right end is the left one
 * mirrored) and `y` down, from the top to the bottom. It is the end's own shape, so the fold's edge matches the end it came from:
 * - a strip's own end (kind 0): the factory-torn jag `endJags` gives that end;
 * - a tear (kind 2): the ragged cut the body's outline makes there (`tearJag`, which Effect.tsx's `tornPath` cuts by too);
 * - a peel line (kind 1): a straight cut.
 * `edges` is the stretch's edge code (start kind * 3 + end kind) and `at` the picked edge in the piece's pixels.
 */
export function foldEnd(side: 'a' | 'b', at: number, edges: number, w: number, h: number, seed: string): Jag {
  const kind = side === 'a' ? Math.floor(edges / 3) : edges % 3;
  const dir = side === 'a' ? 1 : -1;
  if (kind === 0) {
    const ends = endJags(seed, w, h);
    return (side === 'a' ? ends.left : ends.right).map(([x, y]) => [dir * (x - (side === 'a' ? 0 : w)), y] as const);
  }
  if (kind === 1) return [[0, 0], [0, h]];
  /* The same cut as the body's outline, `tearJag`, taken from its own edge into the frame. */
  return tearJag(seed, at, h).map(([x, y]) => [dir * (x - at), y] as const);
}

/** The edge code of the stretch whose picked edge is `at` on `side`; a whole strip's (0) when none matches. */
export function edgesAt(stuck: ReadonlyArray<readonly number[]>, side: 'a' | 'b', at: number): number {
  const s = stuck.find((x) => Math.abs((side === 'a' ? x[0]! : x[1]!) - at) < 0.5);
  return s?.[2] ?? 0;
}
