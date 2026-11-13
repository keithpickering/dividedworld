/**
 * Whoops!'s canvas: the one place a splat is drawn (the canvas API, so nothing here runs in Node).
 *
 * `paintSplat` paints a splat as wet ink, pixel by pixel from its field (field.ts `splatInto`), as the bench
 * approved (docs/research/2026-11-06-whoops-bench): the edge is anti-aliased from the field's signed distance,
 * `(v - T) / |grad v|` px; a meniscus rises over about 3.5 CSS px from the edge and is flat inside, lit from
 * up and left, so an edge facing the light gets a bright rim and a glint and the far side a darker rim; a
 * pale ink gets a darker rim scaled by its luminance so it has an edge on a white page; a broad gloss and a
 * slightly darker underside lie on top. The result is cached by the Effect, one per layer per box.
 *
 * `shadeField` is that shading over any rectangle of a field grid, with the gloss and underside in the same loop and
 * washed ink thinned; `paintSplat` is the splat's grid alone through it. The field it shades is the model: field.ts holds
 * the one implementation of the operations (a pen adds to the field and melts in, a wash takes some each pass,
 * `WASH_TAKES`), run here over a dense grid and by `LayerInk` over its cells, so the picture and the counts cannot
 * disagree (docs/plans/2026-11-12-whoops-ink-field-design.md, sections 2, 3 and 5). A layer's picture is built once from
 * its strokes (build.ts), in a worker when the layer is heavy; live strokes are then run into the grid and only the
 * rectangle they changed is shaded again. `paint` composes a post's layers' pictures, bottom to top, each at its alpha,
 * and draws no strokes. `paintStandIn` is what shows while a heavy build is out, and only then: the cached splat with
 * its strokes drawn on it as a stand-in (a pen in the layer's ink, a wash taking some away, destination-out), which is
 * an approximation of the field and is replaced by the build's picture when it arrives. A stroke is kept in shares of
 * the box with the proportions it was made in, so it is drawn under a transform that makes the brush a circle. A canvas
 * is painted only for a post near the viewport (Effect.tsx) and is dropped when it leaves.
 */
import { rgbOf, luminance, THRESHOLD, type Box, type Splat } from './splat.ts';
import { type Stroke } from './scrub.ts';
import { THIN_FLOOR, THIN_SPAN, denseGrid, splatInto, type Grid, type Rect } from './field.ts';

/** The pixel density a splat is drawn at: past two the extra pixels show nothing on soft ink and cost a quarter more memory each step. */
export const MAX_DPR = 2;

/** The most pixels one post's ink canvas, and each splat painted for it, may have: past it iOS fails silently, and three layers of it would be about 94 MB. */
export const MAX_CANVAS_PX = 4_000_000;

/** Where the box lies in the ink canvas. */
export interface Geometry {
  /** Pixels per CSS pixel. */
  readonly dpr: number;
  /** The box the strokes' shares are of, in CSS px. */
  readonly box: Box;
  /** Where the box's origin lies in the canvas's own frame, in CSS px (0, 0 when the canvas is the box). */
  readonly left: number;
  readonly top: number;
}

/** A layer's picture, as the build or the stand-in made it, and how much of it shows. */
export interface PaintLayer {
  /** The layer's whole picture for this box (a canvas or an image), drawn scaled to the box. */
  readonly picture: CanvasImageSource;
  /** 1 while it is on, falling to 0 as it fades after being washed clean. */
  readonly alpha: number;
}

/** What `shadeField` writes into: ImageData's shape, so a worker with no DOM can use it. */
export interface PixelsOut {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/* `THIN_FLOOR` and `THIN_SPAN` (washed ink's opacity ramp) live in field.ts, which the model reads; re-exported here. */
export { THIN_FLOOR, THIN_SPAN };

/** The light, and the glint's half vector, as the bench approved. */
const LIGHT = (() => { const n = Math.hypot(-0.45, -0.65, 0.62); return [-0.45 / n, -0.65 / n, 0.62 / n] as const; })();
const HALF = (() => { const n = Math.hypot(LIGHT[0], LIGHT[1], LIGHT[2] + 1); return [LIGHT[0] / n, LIGHT[1] / n, (LIGHT[2] + 1) / n] as const; })();

/**
 * Shade the grid's points in `rect` (half open, grown by one point each way for the gradient and clipped to the
 * grid) into `out`, one pixel a point, `out` being the grid's size: the wet-ink look (the splat's edge from its signed
 * distance, meniscus, rim, glint) with the broad gloss and the darker underside computed in the same loop, where
 * `paintSplat` once laid them on with `source-atop`. A point a wash has lowered (`washed[i] === 1`) is thinned, so
 * a scrubbed core is see-through before it is gone. `density` is the grid's points per CSS px. Pure: no DOM.
 *
 * A grid that holds a band of the post's lattice (`grid.row0`, field.ts) is shaded as the whole post is: the gloss's
 * center and radius and the underside are placed from `whole`, the whole lattice's size in points (the grid's own size
 * where left out), and a pixel's row is `grid.row0 + y`. The gradient reads one point each way inside the grid, so a
 * band's edge row is exact only where the grid holds the row beyond it (a band's apron).
 */
export function shadeField(grid: Grid, washed: Uint8Array, color: string, density: number, rect: Rect, out: PixelsOut, whole?: { readonly cols: number; readonly rows: number }): void {
  const { cols: w, rows: h, values: f, row0 } = grid, px = out.data, q = density, T = THRESHOLD;
  const W = whole?.cols ?? w, H = whole?.rows ?? h;
  const [ir, ig, ib] = rgbOf(color), L = luminance(color);
  const [lx, ly, lz] = LIGHT, [hx, hy, hz] = HALF;
  const men = 3.5 * q, rimW = 1.6 * q, specK = 0.55 + 0.45 * (1 - L);
  const gcx = W * 0.32, gcy = H * 0.28, grad = Math.max(W, H) * 0.7, gA = 0.2 * (1 - L) + 0.04;
  const uA = 0.06 + 0.12 * L, uTop = H * 0.35, uSpan = H * 0.65;
  const x0 = Math.max(0, rect.x0 - 1), y0 = Math.max(0, rect.y0 - 1), x1 = Math.min(w, rect.x1 + 1), y1 = Math.min(h, rect.y1 + 1);
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return;
  for (let y = y0; y < y1; y++) {
    const up = y > 0 ? -w : 0, dn = y < h - 1 ? w : 0;
    const Y = row0 + y, ua = Y + 0.5 > uTop ? (uA * (Y + 0.5 - uTop)) / uSpan : 0;
    for (let x = x0; x < x1; x++) {
      const i = y * w + x, v = f[i]!, o = i * 4;
      if (v < T * 0.4) { px[o + 3] = 0; continue; }
      const gx = (f[i + (x < w - 1 ? 1 : 0)]! - f[i - (x > 0 ? 1 : 0)]!) * 0.5, gy = (f[i + dn]! - f[i + up]!) * 0.5;
      const gm = Math.hypot(gx, gy) + 1e-6;
      const sd = (v - T) / gm;
      const a = Math.min(1, Math.max(0, sd + 0.5));
      if (a <= 0) { px[o + 3] = 0; continue; }
      const slope = 1.5 * Math.exp(-Math.max(0, sd) / men);
      let nx = (-gx / gm) * slope, ny = (-gy / gm) * slope, nz = 1;
      const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
      const shade = 0.86 + 0.6 * (nx * lx + ny * ly + nz * lz - lz);
      const spec = Math.max(0, nx * hx + ny * hy + nz * hz) ** 60 * specK;
      const rim = L * 0.5 * Math.exp(-Math.max(0, sd) / rimW);
      const k = Math.max(0, shade * (1 - rim));
      const gd = Math.hypot(x + 0.5 - gcx, Y + 0.5 - gcy) / grad, ga = gd < 1 ? gA * (1 - gd) : 0;
      const r = Math.min(255, ir * k + 255 * spec), g = Math.min(255, ig * k + 255 * spec), b = Math.min(255, ib * k + 255 * spec);
      const thin = washed[i] === 1 ? Math.min(1, Math.max(0, THIN_FLOOR + ((1 - THIN_FLOOR) * (v - T)) / THIN_SPAN)) : 1;
      px[o] = (r * (1 - ga) + 255 * ga) * (1 - ua);
      px[o + 1] = (g * (1 - ga) + 255 * ga) * (1 - ua);
      px[o + 2] = (b * (1 - ga) + 255 * ga) * (1 - ua);
      px[o + 3] = a * thin * 255;
    }
  }
}

/**
 * The splat as wet ink on a canvas of ceil(box.w * d) by ceil(box.h * d) pixels, d being `density`, at most 1 and
 * at most what keeps the canvas within MAX_CANVAS_PX: the splat's grid alone, through `shadeField`.
 * A browser with no 2D context gives a blank canvas.
 */
export function paintSplat(splat: Splat, color: string, box: Box, density: number): HTMLCanvasElement {
  const area = box.w * box.h;
  let q = Math.min(1, density, area > 0 ? Math.sqrt(MAX_CANVAS_PX / area) : 1);
  /*
   * ceil can add a pixel a side and pass the cap. The density is lowered, never a side trimmed, so the canvas stays
   * the field's own grid (denseGrid's ceil(box·q) both ways) and a row's stride is the field's.
   */
  while (q > 0 && Math.ceil(box.w * q) * Math.ceil(box.h * q) > MAX_CANVAS_PX) q *= 0.9999;
  const w = Math.ceil(box.w * q), h = Math.ceil(box.h * q);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g || !w || !h) return canvas;
  const grid = denseGrid(box, q);
  splatInto(grid, splat, box);
  const img = g.createImageData(w, h);
  shadeField(grid, grid.washed, color, q, { x0: 0, y0: 0, x1: w, y1: h }, img);
  g.putImageData(img, 0, 0);
  return canvas;
}

/** A wash's strength in the stand-in, which has no field: each pass takes this share of the ink under it (the field's washes take some each pass too). */
export const STAND_IN_WASH = 0.5;

/**
 * One canvas per layer slot, shared by every post, each sized to the canvas being painted (never past the largest ink canvas).
 * A slot's picture is used at once (`paint` draws it in the same frame), so no post depends on one staying: they are let go,
 * sized to nothing, when no post holds a layer (`holdStandIns`), and made again by the next stand-in.
 */
const slots: HTMLCanvasElement[] = [];
let holders = 0;
/**
 * A post that holds layers says so (and lets go with the function it gets, once). When the last holder lets go the slot canvases
 * are released: a page whose posts have all gone far from the viewport keeps no megabytes of stand-in canvas.
 */
export function holdStandIns(): () => void {
  holders++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--holders > 0) return;
    for (const c of slots) { c.width = 0; c.height = 0; }
    slots.length = 0;
  };
}
function slotOf(slot: number, width: number, height: number): CanvasRenderingContext2D | null {
  const c = (slots[slot] ??= document.createElement('canvas'));
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  return c.getContext('2d', { willReadFrequently: false });
}

/** A stroke's path in the space where its brush is a circle: across px as they are, down px divided by the brush's down-to-across ratio. */
function trace(g: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], box: Box, k: number) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x * box.w, (y * box.h) / k) : g.moveTo(x * box.w, (y * box.h) / k)));
  /* A single point is a dab: a line to itself, nudged so a round cap draws. */
  if (points.length === 1) g.lineTo(points[0]![0] * box.w + 0.0001, (points[0]![1] * box.h) / k);
}

/**
 * Paint the post's layers on `canvas`, whose pixels are `canvas.width` by `canvas.height` (set by the caller, at the
 * geometry's density): each layer's picture as given, scaled to the box, bottom to top, at its alpha. A browser with
 * no 2D context draws nothing.
 */
export function paint(canvas: HTMLCanvasElement, geo: Geometry, layers: readonly PaintLayer[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { dpr, box } = geo;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  /* A box with no area draws nothing, and what was drawn before is cleared. */
  if (!(box.w > 0 && box.h > 0 && Number.isFinite(box.w) && Number.isFinite(box.h))) return;
  for (const layer of layers) {
    if (layer.alpha <= 0) continue;
    ctx.globalAlpha = layer.alpha;
    ctx.drawImage(layer.picture, geo.left * dpr, geo.top * dpr, box.w * dpr, box.h * dpr);
  }
  ctx.globalAlpha = 1;
}

/** What the stand-in draws a layer from: its cached splat, its ink and the strokes on it, in the order they were made. */
export interface StandIn {
  readonly painted: HTMLCanvasElement;
  readonly color: string;
  readonly strokes: readonly Stroke[];
}

/**
 * A layer's picture before its build has arrived (and, until the Effect is rewired, always): the cached splat, then
 * each stroke in order, a pen flat in the layer's ink and a wash taking `STAND_IN_WASH` of it away with a 2.5 px blur.
 * The picture is a canvas of `width` by `height` pixels held for `slot` (one per layer index, shared by every post),
 * so it is valid until the next call with that slot. It is the box alone at the origin, with no offset, like a build's picture. A browser with no 2D context returns a blank one.
 */
export function paintStandIn(layer: StandIn, geo: Geometry, width: number, height: number, slot: number): HTMLCanvasElement {
  const work = slotOf(slot, width, height);
  const { dpr, box } = geo;
  if (!work) return slots[slot]!;
  work.setTransform(1, 0, 0, 1, 0, 0);
  work.globalAlpha = 1;
  work.globalCompositeOperation = 'source-over';
  work.shadowColor = 'transparent';
  work.shadowBlur = 0;
  work.clearRect(0, 0, width, height);
  if (!(box.w > 0 && box.h > 0 && Number.isFinite(box.w) && Number.isFinite(box.h))) return work.canvas;
  /* The picture is the box and nothing else, as a build's is: `paint` puts it at the geometry's offset, so it is not offset here too. */
  work.drawImage(layer.painted, 0, 0, box.w * dpr, box.h * dpr);
  work.lineCap = work.lineJoin = 'round';
  for (const s of layer.strokes) {
    /* The brush is `width * w` across and `width * aspect * h` down: squash the space by the ratio so the line is round in it. */
    const k = (s.aspect * box.h) / box.w;
    work.setTransform(dpr, 0, 0, dpr * k, 0, 0);
    work.lineWidth = s.width * box.w;
    if (s.tool === 'wash') {
      work.globalCompositeOperation = 'destination-out';
      work.globalAlpha = STAND_IN_WASH;
      /* Shadow sizes are device px, untouched by the transform: a soft edge, as on the bench. */
      work.shadowColor = '#000';
      work.shadowBlur = 2.5;
    } else {
      work.globalCompositeOperation = 'source-over';
      work.globalAlpha = 1;
      work.shadowColor = 'transparent';
      work.shadowBlur = 0;
      work.strokeStyle = s.color;
    }
    trace(work, s.points, box, k);
    work.stroke();
  }
  work.shadowColor = 'transparent';
  work.shadowBlur = 0;
  work.globalAlpha = 1;
  work.globalCompositeOperation = 'source-over';
  work.setTransform(1, 0, 0, 1, 0, 0);
  return work.canvas;
}
