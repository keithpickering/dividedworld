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
import { FIELD_MOST, bandGrid, radiusOf, kOf, splatInto, strokesInto, type Grid } from './field.ts';
import { shadeField } from './paint.ts';
import { makeSplat, type Box } from './splat.ts';
import type { Stroke } from './scrub.ts';

/**
 * What a build costs is estimated in nanoseconds of work, from a bench in Node (2026-11-12, buildLayer on a 600x500 box,
 * median of 7): the box costs about 250ns a cell (splat, shade and quantize; 253 at density 1, 240 at 2), a pen about 86
 * to 300ns and a wash about 12 to 40ns a point visit (the dearer figure is the thin brush, where the capsule or disc
 * is mostly its edge). The weights take the dearer figure, because a layer called light that is not blocks the page. A
 * browser's main thread differs from Node by some factor, and the owner tunes these on a device; the page also learns its
 * own factor (the pace, buildClient.ts) from what builds measure against what was estimated. A review's re-measure
 * on a busier run (240x240 light layers at 17.7 to 26.8ms in single runs) raised the box to 330 and the wash to 60, so a layer called
 * light stays near its target when the machine is not idle.
 */
export const BOX_NS = 330;
export const PEN_NS = 300;
export const WASH_NS = 60;
/** The milliseconds of estimated work (times the page's pace) under which a band is built on the main thread. */
export const QUICK_MS = 12;
/** The most points a band may hold: past it the build is refused (its apron rows are not counted). */
export const BAND_MOST_PX = 2_000_000;
/** The field's fixed-point scale, and the largest stored value. */
export const FIELD_SCALE = 4096;
const STORED_MOST = 65535;

/** A run of rows of a post's lattice, `denseGrid(box, density)`'s: the rows a build shades, without its apron. */
export interface Band { readonly row0: number; readonly rows: number }

export interface BuildInput {
  readonly seed: number;
  readonly color: string;
  readonly box: Box;
  readonly density: number;
  readonly strokes: readonly Stroke[];
  /** The band's own rows. Left out, the whole lattice (the one band of a post that is not cut). */
  readonly band?: Band;
}
export interface Built {
  /** The band's field and washed marks WITH the apron rows (`apron` of them above and below), `cols` a row. */
  readonly field: Uint16Array;
  readonly washed: Uint8Array;
  /** The band's own rows alone. */
  readonly image: { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray };
  /** How many rows of `field` and `washed` lie above and below the band's own: one each, but none past the lattice. */
  readonly apron: { readonly above: number; readonly below: number };
  /** What the build took, by the injected clock (milliseconds). */
  readonly ms: number;
}

/** The lattice's width and height in points, and the band of the whole of it. */
function latticeOf(box: Box, density: number): { cols: number; rows: number; whole: Band } {
  const cols = Math.ceil(box.w * density), rows = Math.ceil(box.h * density);
  return { cols, rows, whole: { row0: 0, rows } };
}
/** The band's rows and its apron's, clipped to the lattice: the first and one past the last row held. */
function heldOf(band: Band, lattice: number): { top: number; end: number } {
  return { top: Math.max(0, band.row0 - 1), end: Math.min(lattice, band.row0 + band.rows + 1) };
}

const defaultNow = (): number => performance.now();

/**
 * The band's picture and the grids behind it: the splat and the strokes run over the band's rows and one row of apron
 * each side (so the gradient at the band's edge reads the neighbor's real value), shaded from the whole post's size.
 */
export function buildLayer(input: BuildInput, now: () => number = defaultNow): Built {
  const t0 = now();
  const { seed, color, box, density, strokes } = input;
  const { cols, rows: lattice, whole } = latticeOf(box, density);
  const band = input.band ?? whole;
  if (!(band.row0 >= 0 && band.rows >= 0 && band.row0 + band.rows <= lattice)) throw new Error(`a band outside the lattice (rows ${band.row0} to ${band.row0 + band.rows} of ${lattice})`);
  if (cols * band.rows > BAND_MOST_PX) throw new Error(`a band of too many points (more than ${BAND_MOST_PX})`);
  const { top, end } = heldOf(band, lattice);
  const grid = bandGrid(box, density, top, end - top);
  splatInto(grid, makeSplat(seed), box);
  strokesInto(grid, box, strokes);
  const n = cols * grid.rows, above = band.row0 - top, below = end - (band.row0 + band.rows);
  const shaded = new Uint8ClampedArray(n * 4);
  shadeField(grid, grid.washed, color, density, { x0: 0, y0: above, x1: cols, y1: above + band.rows }, { width: cols, height: grid.rows, data: shaded }, { cols, rows: lattice });
  /* The shading writes a row of apron it grew by; the image is the band's own rows alone. */
  const data = above === 0 && below === 0 ? shaded : shaded.slice(above * cols * 4, (above + band.rows) * cols * 4);
  const field = new Uint16Array(n);
  for (let i = 0; i < n; i++) field[i] = Math.min(STORED_MOST, Math.round(Math.min(FIELD_MOST, grid.values[i]!) * FIELD_SCALE));
  return { field, washed: grid.washed, image: { width: cols, height: band.rows, data }, apron: { above, below }, ms: now() - t0 };
}

/**
 * A build's field and washed marks (the apron rows with them) as a grid of Float32 values, which the main thread draws
 * live strokes into: the band's rows and its apron, `row0` the first of them in the post's lattice. `band` is the
 * band the build was asked for (the whole lattice when left out).
 */
export function gridOf(built: Pick<Built, 'field' | 'washed' | 'apron'>, box: Box, density: number, band?: Band): Grid {
  const { cols, rows: lattice, whole } = latticeOf(box, density);
  const own = band ?? whole, { above, below } = built.apron;
  const grid = bandGrid(box, density, own.row0 - above, above + own.rows + below);
  if (built.field.length !== grid.values.length || cols * grid.rows !== grid.values.length || own.row0 + own.rows > lattice) throw new Error('a build for another box or density');
  for (let i = 0; i < built.field.length; i++) grid.values[i] = built.field[i]! / FIELD_SCALE;
  grid.washed.set(built.washed);
  return grid;
}

/**
 * What a build costs, in nanoseconds of work (weights above): the band's cells (the splat and the shading), plus, for each
 * segment, the points its reach covers: a pen's capsule of radius 2r once, a wash's discs of radius 2r every max(1, r / 3) px along it. A
 * lone point counts as a disc. Round space's area is stretched by k back to the box. With a `band`, the cells are the band's
 * own, and a segment counts the share of its reach's height that lies in the band's rows (a reach wholly outside costs
 * nothing); without one, the whole post.
 */
export function estimateWork(box: Box, density: number, strokes: readonly Stroke[], band?: Band): number {
  const d2 = density * density, cols = Math.ceil(box.w * density);
  let work = cols * (band ? band.rows : Math.ceil(box.h * density)) * BOX_NS;
  /* The band's rows lie between these CSS px down. */
  const lo = band ? band.row0 / density : -Infinity, hi = band ? (band.row0 + band.rows) / density : Infinity;
  /* The share of a reach that spans px [y0, y1] down which lies in the band. */
  const inBand = (y0: number, y1: number): number => (!band ? 1 : Math.max(0, Math.min(hi, y1) - Math.max(lo, y0)) / Math.max(1e-9, y1 - y0));
  for (const s of strokes) {
    const k = kOf(s, box), r = radiusOf(s, box), R = 2 * r, disc = Math.PI * R * R * k * d2;
    const pts = s.points;
    if (pts.length === 1) work += disc * (s.tool === 'ink' ? PEN_NS : WASH_NS) * inBand((pts[0]![1] * box.h) - R * k, (pts[0]![1] * box.h) + R * k);
    for (let i = 1; i < pts.length; i++) {
      const ay = pts[i - 1]![1] * box.h, by = pts[i]![1] * box.h;
      const len = Math.hypot((pts[i]![0] - pts[i - 1]![0]) * box.w, (by - ay) / k);
      const share = inBand(Math.min(ay, by) - R * k, Math.max(ay, by) + R * k);
      work += share * (s.tool === 'ink' ? (len * 2 * R + Math.PI * R * R) * k * d2 * PEN_NS : (len / Math.max(1, r / 3) + 1) * disc * WASH_NS);
    }
  }
  return Math.ceil(work);
}

/**
 * A layer's key: the play, the box, the density, the band's first row, the strokes' count and last point, and the
 * requester's token (`buildClient().requester()`), so two Effects asking for the same layer are two builds that neither
 * replaces nor cancels. A caller that gives no band or requester is the whole lattice and the one shared requester 0.
 */
export function layerKey(playId: string, box: Box, density: number, strokes: readonly Stroke[], row0 = 0, requester = 0): string {
  const last = strokes[strokes.length - 1]?.points.at(-1);
  return `${playId}|${box.w}x${box.h}|${density}|${row0}|${strokes.length}|${last ? `${last[0]},${last[1]}` : '-'}|${requester}`;
}
