/**
 * Building a Whoops! layer's picture, pure and with no DOM (ink-field design, section 5): the splat, every stroke in
 * order, then shaded once. The same function runs on the main thread (a light layer) and in the worker (buildWorker.ts),
 * so the two cannot disagree. A layer's key and what it costs are here too, so the client (buildClient.ts) and the Effect
 * read one definition.
 *
 * The field leaves as a `Uint16Array` of value x 4096, half a `Float32Array`'s memory. A `Uint16Array` tops out at 65535,
 * so a value held to `FIELD_MOST` (16) is stored as 65535 (15.99976): the one place the rounding exceeds 1/8192, and far
 * above any value the shading can tell apart. `gridOf` turns a build back into a Float32 `Grid` for live strokes.
 */
import { FIELD_MOST, denseGrid, radiusOf, kOf, splatInto, strokesInto, type Grid } from './field.ts';
import { MAX_CANVAS_PX, shadeField } from './paint.ts';
import { makeSplat, type Box } from './splat.ts';
import type { Stroke } from './scrub.ts';

/**
 * What a build costs is estimated in nanoseconds of work, from a bench in Node (2026-11-12, buildLayer on a 600x500 box,
 * median of 7): the box costs about 250ns a cell (splat, shade and quantize; 253 at density 1, 240 at 2), a pen about 86
 * to 300ns and a wash about 12 to 40ns a point visit (the dearer figure is the thin brush, where the capsule or disc
 * is mostly its edge). The weights take the dearer figure, because a layer called light that is not blocks the page. A
 * browser's main thread differs from Node by some factor, and the owner tunes these on a device.
 */
export const BOX_NS = 250;
export const PEN_NS = 300;
export const WASH_NS = 40;
/** The estimated work under which a layer is built on the main thread: about 15ms on the bench machine (design: 10 to 20ms). */
export const QUICK_WORK = 15_000_000;
/** The field's fixed-point scale, and the largest stored value. */
export const FIELD_SCALE = 4096;
const STORED_MOST = 65535;

export interface BuildInput {
  readonly seed: number;
  readonly color: string;
  readonly box: Box;
  readonly density: number;
  readonly strokes: readonly Stroke[];
}
export interface Built {
  readonly field: Uint16Array;
  readonly washed: Uint8Array;
  readonly image: { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray };
}

/** The layer's picture and the grids behind it. */
export function buildLayer(input: BuildInput): Built {
  const { seed, color, box, density, strokes } = input;
  if (Math.ceil(box.w * density) * Math.ceil(box.h * density) > MAX_CANVAS_PX) throw new Error(`a layer of too many pixels (more than ${MAX_CANVAS_PX})`);
  const grid = denseGrid(box, density);
  splatInto(grid, makeSplat(seed), box);
  strokesInto(grid, box, strokes);
  const { cols, rows } = grid, n = cols * rows;
  const data = new Uint8ClampedArray(n * 4);
  shadeField(grid, grid.washed, color, density, { x0: 0, y0: 0, x1: cols, y1: rows }, { width: cols, height: rows, data });
  const field = new Uint16Array(n);
  for (let i = 0; i < n; i++) field[i] = Math.min(STORED_MOST, Math.round(Math.min(FIELD_MOST, grid.values[i]!) * FIELD_SCALE));
  return { field, washed: grid.washed, image: { width: cols, height: rows, data } };
}

/** A build's field and washed marks as a grid of Float32 values, which the main thread draws live strokes into. */
export function gridOf(built: Pick<Built, 'field' | 'washed'>, box: Box, density: number): Grid {
  const grid = denseGrid(box, density);
  if (built.field.length !== grid.values.length) throw new Error('a build for another box or density');
  for (let i = 0; i < built.field.length; i++) grid.values[i] = built.field[i]! / FIELD_SCALE;
  grid.washed.set(built.washed);
  return grid;
}

/**
 * What a build costs, in nanoseconds of work (weights above): the box's cells (the splat and the shading), plus, for each
 * segment, the points its reach covers: a pen's capsule of radius 2r once, a wash's discs of radius 2r every max(1, r / 3) px along it. A
 * lone point counts as a disc. Round space's area is stretched by k back to the box.
 */
export function estimateWork(box: Box, density: number, strokes: readonly Stroke[]): number {
  const d2 = density * density;
  let work = Math.ceil(box.w * density) * Math.ceil(box.h * density) * BOX_NS;
  for (const s of strokes) {
    const k = kOf(s, box), r = radiusOf(s, box), R = 2 * r, disc = Math.PI * R * R * k * d2;
    const pts = s.points;
    if (pts.length === 1) work += disc * (s.tool === 'ink' ? PEN_NS : WASH_NS);
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot((pts[i]![0] - pts[i - 1]![0]) * box.w, ((pts[i]![1] - pts[i - 1]![1]) * box.h) / k);
      work += s.tool === 'ink' ? (len * 2 * R + Math.PI * R * R) * k * d2 * PEN_NS : (len / Math.max(1, r / 3) + 1) * disc * WASH_NS;
    }
  }
  return Math.ceil(work);
}

/** A layer's key: the play, the box, the density, and the strokes' count and last point. */
export function layerKey(playId: string, box: Box, density: number, strokes: readonly Stroke[]): string {
  const last = strokes[strokes.length - 1]?.points.at(-1);
  return `${playId}|${box.w}x${box.h}|${density}|${strokes.length}|${last ? `${last[0]},${last[1]}` : '-'}`;
}
