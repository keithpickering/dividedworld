/**
 * Graffiti's stencils (docs/plans/2026-11-11-graffiti-design.md, section 9): six drawings made by hand in code, each a list of strokes
 * in a unit box (across 0 to 1, down 0 to 1) with the cap of the can that draws it. A stencil is placed by `validateDraw`, which scales
 * it to a third of the wall's width, centers it in a spot of the 3 by 3 grid over the body and draws it at aspect 1, so the server, the
 * chatter and the screen all expand it the same. The drawings are instance content: the owner may change them.
 */
export type Cap = 'skinny' | 'stock' | 'fat';
export type Point = readonly [number, number];
export interface StencilStroke { readonly cap: Cap; readonly points: readonly Point[] }
export interface Stencil { readonly strokes: readonly StencilStroke[] }

/** A closed ring of `n` points about (cx, cy), `from` to `to` in turns, starting at the right and going clockwise down the screen. */
const arc = (cx: number, cy: number, r: number, from: number, to: number, n: number): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (from + ((to - from) * i) / n) * 2 * Math.PI;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as Point;
  });

/** Block letters on a unit glyph box, as polylines; only the letters KILROY WAS HERE needs. */
const GLYPHS: Record<string, readonly (readonly Point[])[]> = {
  K: [[[0, 0], [0, 1]], [[1, 0], [0, 0.55], [1, 1]]],
  I: [[[0.2, 0], [0.8, 0], [0.5, 0], [0.5, 1], [0.2, 1], [0.8, 1]]],
  L: [[[0, 0], [0, 1], [1, 1]]],
  R: [[[0, 1], [0, 0], [0.8, 0], [1, 0.25], [0.8, 0.5], [0, 0.5]], [[0.5, 0.5], [1, 1]]],
  O: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  Y: [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]],
  W: [[[0, 0], [0.25, 1], [0.5, 0.4], [0.75, 1], [1, 0]]],
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.2, 0.65], [0.8, 0.65]]],
  S: [[[1, 0], [0, 0], [0, 0.5], [1, 0.5], [1, 1], [0, 1]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.8, 0.5]]],
};

/** A line of text as skinny strokes: glyphs of `w` by `h`, a gap of `w / 2` between them, the line centered on x = 0.5 with its top at `top`. */
function line(text: string, top: number, w: number, h: number): StencilStroke[] {
  const step = w * 1.5;
  const left = 0.5 - (text.length * step - w / 2) / 2;
  const out: StencilStroke[] = [];
  [...text].forEach((ch, i) => {
    for (const g of GLYPHS[ch] ?? []) out.push({ cap: 'skinny', points: g.map(([x, y]) => [left + i * step + x * w, top + y * h] as Point) });
  });
  return out;
}

export const STENCILS = {
  mustache: { strokes: [
    { cap: 'fat', points: [[0.08, 0.4], [0.12, 0.3], [0.2, 0.28], [0.3, 0.4], [0.42, 0.5], [0.5, 0.45], [0.58, 0.5], [0.7, 0.4], [0.8, 0.28], [0.88, 0.3], [0.92, 0.4]] },
    { cap: 'fat', points: [[0.2, 0.4], [0.35, 0.58], [0.5, 0.55], [0.65, 0.58], [0.8, 0.4]] },
  ] },
  horns: { strokes: [
    { cap: 'fat', points: [[0.28, 0.9], [0.16, 0.65], [0.2, 0.35], [0.36, 0.1]] },
    { cap: 'fat', points: [[0.72, 0.9], [0.84, 0.65], [0.8, 0.35], [0.64, 0.1]] },
    { cap: 'stock', points: [[0.28, 0.9], [0.72, 0.9]] },
  ] },
  crown: { strokes: [
    { cap: 'stock', points: [[0.1, 0.85], [0.1, 0.3], [0.3, 0.55], [0.5, 0.2], [0.7, 0.55], [0.9, 0.3], [0.9, 0.85], [0.1, 0.85]] },
    { cap: 'fat', points: [[0.5, 0.68]] },
    { cap: 'fat', points: [[0.28, 0.72]] },
    { cap: 'fat', points: [[0.72, 0.72]] },
  ] },
  // The nose over a wall, and the words under it, in two lines.
  kilroy: { strokes: [
    { cap: 'stock', points: [[0.05, 0.38], [0.95, 0.38]] },
    { cap: 'stock', points: [[0.3, 0.38], [0.32, 0.22], [0.4, 0.12], [0.5, 0.1], [0.6, 0.12], [0.68, 0.22], [0.7, 0.38]] },
    { cap: 'fat', points: [[0.4, 0.2]] },
    { cap: 'fat', points: [[0.6, 0.2]] },
    { cap: 'stock', points: [[0.5, 0.2], [0.5, 0.38]] },
    ...line('KILROY WAS', 0.5, 0.06, 0.13),
    ...line('HERE', 0.72, 0.06, 0.13),
  ] },
  x: { strokes: [
    { cap: 'fat', points: [[0.1, 0.1], [0.9, 0.9]] },
    { cap: 'fat', points: [[0.9, 0.1], [0.1, 0.9]] },
  ] },
  smiley: { strokes: [
    { cap: 'stock', points: arc(0.5, 0.5, 0.4, 0, 1, 24) },
    { cap: 'fat', points: [[0.36, 0.38]] },
    { cap: 'fat', points: [[0.64, 0.38]] },
    { cap: 'stock', points: arc(0.5, 0.5, 0.24, 0.1, 0.4, 10) },
  ] },
} as const satisfies Record<string, Stencil>;

export type StencilKey = keyof typeof STENCILS;
export const STENCIL_KEYS = Object.keys(STENCILS) as readonly StencilKey[];
