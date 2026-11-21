/**
 * The shapes the stage's walls are tagged with (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R4): small named functions, each
 * a hand's tag as strokes in Graffiti's own stroke format (`{ can, cap, aspect, points }`, points in shares of the post body's box, to a
 * ten-thousandth; instances/divided-world/cards/graffiti.ts). A wall is drawn a shape at a time, as a player draws one: each shape is one draw.
 *
 * Every shape is laid out in the box's own proportions: `aspect` is the box's width over its height, so a circle is round on a 3:1 wall.
 * Only cans the card allows are used (`CANS`), and the caps it allows (`CAPS`).
 */
import type { Can, Cap } from '../../cards/graffiti.ts';

export type Point = [number, number];
export interface Stroke { readonly can: Can; readonly cap: Cap; readonly aspect: number; readonly points: Point[] }
/** A shape: what it is, and the strokes that draw it. */
export interface Shape { readonly kind: 'arrow' | 'heart' | 'face' | 'word' | 'scribble-out' | 'underline'; readonly strokes: Stroke[] }

/** The post body's width over its height, as the stage's graffiti post shows it (about three to one). */
export const WALL_ASPECT = 3;

const r4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
const pt = (x: number, y: number): Point => [r4(x), r4(y)];
const stroke = (can: Can, cap: Cap, aspect: number, points: Point[]): Stroke => ({ can, cap, aspect, points });
/** A line of `n` steps between two points, so no stroke is only its two ends. */
const line = (a: Point, b: Point, n = 8): Point[] => Array.from({ length: n + 1 }, (_, i) => pt(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
/** An arc of an ellipse whose height radius is `ry` (in shares of the box's height): the width radius is `ry / aspect`, so it is round on the wall. */
const arc = (cx: number, cy: number, ry: number, from: number, to: number, aspect: number, n = 24): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return pt(cx + (ry / aspect) * Math.cos(a), cy + ry * Math.sin(a)); });

/** An arrow from (x0, y0) to (x1, y1) with a two-stroke head. */
export function arrow(x0: number, y0: number, x1: number, y1: number, can: Can = 'red', aspect = WALL_ASPECT): Shape {
  const angle = Math.atan2(y1 - y0, (x1 - x0) * aspect);
  const head = (spread: number): Point[] => [pt(x1 - (Math.cos(angle + spread) * 0.22) / aspect, y1 - Math.sin(angle + spread) * 0.22), pt(x1, y1)];
  return { kind: 'arrow', strokes: [stroke(can, 'stock', aspect, line([x0, y0], [x1, y1], 14)), stroke(can, 'stock', aspect, head(0.5)), stroke(can, 'stock', aspect, head(-0.5))] };
}

/** A heart, centered on (cx, cy), `size` tall in shares of the box's height. */
export function heart(cx: number, cy: number, size = 0.7, can: Can = 'pink', aspect = WALL_ASPECT): Shape {
  const points = Array.from({ length: 41 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return pt(cx + (x / 34) * (size / aspect) * 1.1, cy - (y / 30) * size);
  });
  return { kind: 'heart', strokes: [stroke(can, 'stock', aspect, points)] };
}

/** A face: a ring, two eyes and a grin, centered on (cx, cy), `size` tall. */
export function face(cx: number, cy: number, size = 0.8, can: Can = 'yellow', aspect = WALL_ASPECT): Shape {
  const ry = size / 2;
  return {
    kind: 'face',
    strokes: [
      stroke(can, 'stock', aspect, arc(cx, cy, ry, 0, Math.PI * 2, aspect, 36)),
      stroke(can, 'fat', aspect, [pt(cx - (ry * 0.35) / aspect, cy - ry * 0.25), pt(cx - (ry * 0.35) / aspect, cy - ry * 0.12)]),
      stroke(can, 'fat', aspect, [pt(cx + (ry * 0.35) / aspect, cy - ry * 0.25), pt(cx + (ry * 0.35) / aspect, cy - ry * 0.12)]),
      stroke(can, 'stock', aspect, arc(cx, cy + ry * 0.05, ry * 0.55, Math.PI * 0.15, Math.PI * 0.85, aspect, 14)),
    ],
  };
}

/** Block capitals on a grid of 4 across by 6 down: each letter's strokes, as points on that grid. */
const LETTERS: Readonly<Record<string, readonly (readonly [number, number][])[]>> = {
  F: [[[0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
  I: [[[1, 0], [3, 0]], [[2, 0], [2, 6]], [[1, 6], [3, 6]]],
  R: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]], [[2, 3], [4, 6]]],
  S: [[[4, 0], [0, 0], [0, 3], [4, 3], [4, 6], [0, 6]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  O: [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]],
  M: [[[0, 6], [0, 0], [2, 3], [4, 0], [4, 6]]],
  A: [[[0, 6], [2, 0], [4, 6]], [[1, 4], [3, 4]]],
  G: [[[4, 0], [0, 0], [0, 6], [4, 6], [4, 3], [2, 3]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  P: [[[0, 6], [0, 0], [4, 0], [4, 3], [0, 3]]],
  W: [[[0, 0], [1, 6], [2, 2], [3, 6], [4, 0]]],
};

/** A word in block capitals, its left edge at x and its top at y, each letter `height` tall (in shares of the box's height). */
export function word(text: string, x: number, y: number, height = 0.5, can: Can = 'cyan', aspect = WALL_ASPECT): Shape {
  const unit = height / 6;
  const strokes: Stroke[] = [];
  [...text.toUpperCase()].forEach((ch, i) => {
    const glyph = LETTERS[ch];
    if (glyph === undefined) throw new Error(`the stage's block capitals have no "${ch}": they have ${Object.keys(LETTERS).join('')}`);
    for (const g of glyph) {
      const dense: Point[] = g.flatMap((p, j) => (j === 0 ? [p] : line(g[j - 1]!, p, 3).slice(1)));
      strokes.push(stroke(can, 'stock', aspect, dense.map(([gx, gy]) => pt(x + (i * 5 + gx) * (unit / aspect) * 1.2, y + gy * unit))));
    }
  });
  return { kind: 'word', strokes };
}

/** A scribble-out over a span: a back-and-forth zigzag, as a hand crosses a thing out. */
export function scribbleOut(x0: number, x1: number, y: number, can: Can = 'black', aspect = WALL_ASPECT): Shape {
  const points = Array.from({ length: 21 }, (_, i) => pt(x0 + ((x1 - x0) * i) / 20, y + (i % 2 === 0 ? -0.16 : 0.16) + 0.02 * Math.sin(i * 1.7)));
  return { kind: 'scribble-out', strokes: [stroke(can, 'fat', aspect, points)] };
}

/** An underline: a slightly wavering stroke, with a short second one under it. */
export function underline(x0: number, x1: number, y: number, can: Can = 'lime', aspect = WALL_ASPECT): Shape {
  const wob = (x: number, i: number) => pt(x, y + 0.015 * Math.sin(i * 0.9));
  const main = Array.from({ length: 19 }, (_, i) => wob(x0 + ((x1 - x0) * i) / 18, i));
  const second = Array.from({ length: 9 }, (_, i) => pt(x0 + (x1 - x0) * 0.25 + ((x1 - x0) * 0.5 * i) / 8, y + 0.07 + 0.012 * Math.sin(i * 1.3)));
  return { kind: 'underline', strokes: [stroke(can, 'stock', aspect, main), stroke(can, 'skinny', aspect, second)] };
}

/** The tags the stage's graffiti post wears, in the order they are drawn: five different kinds. */
export function tags(aspect = WALL_ASPECT): Shape[] {
  return [
    word('FIRST', 0.03, 0.08, 0.34, 'cyan', aspect),
    underline(0.03, 0.57, 0.56, 'lime', aspect),
    arrow(0.08, 0.8, 0.5, 0.8, 'red', aspect),
    face(0.75, 0.3, 0.46, 'yellow', aspect),
    heart(0.92, 0.3, 0.36, 'pink', aspect),
    scribbleOut(0.62, 0.92, 0.78, 'black', aspect),
  ];
}
