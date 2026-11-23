/**
 * The front door's marks, as the cards write them: the page describes a few hand-drawn marks (an arrow, a ring, a pair of question marks,
 * a heart, a scribble, a wash across a band) and this file turns each into the stroke formats Graffiti and Whoops! already keep, so the
 * page draws them with the cards' own surfaces and nothing is a picture. Every shape wobbles by a fixed seed, so the same call gives the
 * same hand-drawn line for every visitor, and never a different one on a reload.
 *
 * - **A shape** returns strokes, each a list of `[across, down]` points in shares of the post body's box, held to 0 to 1 and to a
 *   ten-thousandth. Every shape takes an optional last `seed` (default 1); two calls with the same arguments and seed return the same points.
 * - **`tag`** makes one Graffiti draw from shapes, in one can, cap and aspect: `{ strokes: [{ can, cap, aspect, points }] }`.
 * - **`washPasses`** makes the saved state of a Whoops! layer: wash strokes, each a back-and-forth pass across a band of the box, packed as
 *   the card packs them.
 */
import type { Can, Cap } from '../../cards/graffiti.ts';
import { BOUNDS } from '../../cards/graffiti.ts';
import type { SavedStroke } from '../../cards/whoops.ts';
import { STROKES } from '../../cards/whoops.ts';
import { packStroke } from '../../cards/whoops/points.ts';
import { mulberry32 } from '../../cards/whoops/splat.ts';

export type Pt = [number, number];
export type Shape = Pt[][];
export type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

const unit = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
/** A point held to the box. */
const pt = (x: number, y: number): Pt => [unit(x), unit(y)];
/** A seeded jitter in [-amount, amount]. */
const jitter = (r: () => number, amount: number) => (r() - 0.5) * 2 * amount;

/** A line from one point to another, as `steps` + 1 points with a small wobble across it. */
function line(r: () => number, [ax, ay]: Pt, [bx, by]: Pt, steps: number, wobble: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, edge = i === 0 || i === steps ? 0.4 : 1;
    out.push(pt(ax + (bx - ax) * t + jitter(r, wobble) * edge, ay + (by - ay) * t + jitter(r, wobble) * edge));
  }
  return out;
}

/** An arrow from one point to another: the shaft, then two barbs at the head, three strokes. */
export function arrow(from: Pt, to: Pt, seed = 1): Shape {
  const r = mulberry32(seed);
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(dx, dy) || 1, back = Math.atan2(dy, dx) + Math.PI, barb = Math.min(0.06, len * 0.35);
  const wing = (turn: number): Pt[] => {
    const a = back + turn + jitter(r, 0.12);
    return line(r, to, [to[0] + Math.cos(a) * barb, to[1] + Math.sin(a) * barb], 4, 0.002);
  };
  return [line(r, from, to, Math.max(6, Math.round(len * 40)), 0.004), wing(0.5), wing(-0.5)];
}

/** One loop around a center, drawn the way a hand does it: it starts, goes all the way around, overshoots its start, and drifts a little off true. */
export function ring(center: Pt, rx: number, ry: number, seed = 1): Shape {
  const r = mulberry32(seed);
  const start = r() * Math.PI * 2, drift = 0.08 + r() * 0.06, sweep = Math.PI * 2 + 0.55, steps = 48;
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = start + sweep * t, k = 1 + drift * t - 0.03 + jitter(r, 0.015);
    points.push(pt(center[0] + Math.cos(a) * rx * k, center[1] + Math.sin(a) * ry * k));
  }
  return [points];
}

/** Marks written out: each `?` is a hook and a dot, `size` tall (a share of the box's height), `at` the top left of the first. Other characters are spaces. */
export function glyphs(text: string, at: Pt, size: number, seed = 1): Shape {
  const r = mulberry32(seed);
  const out: Shape = [];
  const w = size * 0.55, pitch = size * 0.8;
  [...text].forEach((ch, i) => {
    if (ch !== '?') return;
    const [x, y] = [at[0] + i * pitch, at[1]];
    const hook: Pt[] = [];
    for (let k = 0; k <= 14; k++) {
      const a = Math.PI * (1.05 - 1.75 * (k / 14));
      hook.push(pt(x + w / 2 + Math.cos(a) * w * 0.48 + jitter(r, size * 0.015), y + w * 0.5 - Math.sin(a) * w * 0.5 + jitter(r, size * 0.015)));
    }
    hook.push(pt(x + w / 2 + jitter(r, size * 0.02), y + size * 0.68));
    const dot = [pt(x + w / 2, y + size * 0.92), pt(x + w / 2 + size * 0.02 + jitter(r, size * 0.01), y + size * 0.93)];
    out.push(hook, dot);
  });
  return out;
}

/** A heart, `size` across (a share of the box's width), as one stroke from its cleft around and back. */
export function heart(center: Pt, size: number, seed = 1): Shape {
  const r = mulberry32(seed);
  const points: Pt[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push(pt(center[0] + (x / 34) * size + jitter(r, size * 0.01), center[1] - (y / 34) * size + jitter(r, size * 0.01)));
  }
  return [points];
}

/** A tight zigzag filling a box, as one stroke, back and forth down it. */
export function scribble(box: Box, seed = 1): Shape {
  const r = mulberry32(seed);
  const rows = Math.max(3, Math.round((box.y1 - box.y0) / 0.012)), points: Pt[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = box.y0 + ((box.y1 - box.y0) * i) / rows, left = i % 2 === 0;
    points.push(pt((left ? box.x0 : box.x1) + jitter(r, 0.01), y + jitter(r, 0.004)));
    points.push(pt((left ? box.x1 : box.x0) + jitter(r, 0.01), y + 0.006 + jitter(r, 0.004)));
  }
  return [points];
}

export type Tagged = { readonly strokes: readonly { readonly can: Can; readonly cap: Cap; readonly aspect: number; readonly points: Pt[] }[] };

/** One Graffiti draw of the shapes' strokes, in one can and cap, drawn at `aspect` (the box's width over its height). Held to the card's bounds: a draw over them throws. */
export function tag(can: Can, cap: Cap, aspect: number, ...shapes: Shape[]): Tagged {
  const strokes = shapes.flat().map((points) => ({ can, cap, aspect: Number(aspect.toPrecision(3)), points }));
  const total = strokes.reduce((n, s) => n + s.points.length, 0);
  if (strokes.length > BOUNDS.strokes || total > BOUNDS.totalPoints || strokes.some((s) => s.points.length > BOUNDS.points)) throw new Error('a tag is held to Graffiti\'s bounds');
  return { strokes };
}

export type Band = { readonly top: number; readonly bottom: number };

/** A Whoops! layer's saved state of washing: for each band, one wash stroke that goes back and forth across the whole width, down the band, at the brush's `width` (a share of the box's width). */
export function washPasses(bands: readonly Band[], o: { aspect: number; width: number; seed?: number }): { strokes: SavedStroke[] } {
  const r = mulberry32(o.seed ?? 1);
  const row = Math.max(0.01, o.width * o.aspect * 0.7);
  const strokes = bands.map(({ top, bottom }): SavedStroke => {
    const points: Pt[] = [];
    const rows = Math.max(1, Math.ceil((bottom - top) / row));
    for (let i = 0; i <= rows; i++) {
      const y = top + ((bottom - top) * i) / rows;
      const [a, b] = i % 2 === 0 ? [0.02, 0.98] : [0.98, 0.02];
      points.push(pt(a + jitter(r, 0.01), y + jitter(r, row * 0.15)), pt(b + jitter(r, 0.01), y + jitter(r, row * 0.15)));
    }
    if (points.length > STROKES.points) throw new Error('a pass is held to Whoops!\'s points in a stroke');
    return packStroke({ tool: 'wash', width: o.width, aspect: o.aspect, points });
  });
  return { strokes };
}
