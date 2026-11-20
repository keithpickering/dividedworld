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
