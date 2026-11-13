/**
 * Whoops!'s canvas: the one place a splat is drawn (the canvas API, so nothing here runs in Node).
 *
 * `paintSplat` paints a splat as wet ink, pixel by pixel from its field (field.ts `splatInto`), as the bench
 * approved (docs/research/2026-11-06-whoops-bench): the edge is anti-aliased from the field's signed distance,
 * `(v - T) / |grad v|` px; a meniscus rises over about 3.5 CSS px from the edge and is flat inside, lit from
 * up and left, so an edge facing the light gets a bright rim and a glint and the far side a darker rim; a
 * pale ink gets a darker rim scaled by its luminance so it has an edge on a white page; a broad gloss and a
 * slightly darker underside lie on top. The config form's preview is its one caller now.
 *
 * `shadeField` is that shading over any rectangle of a field grid, with the gloss and underside in the same loop and
 * washed ink thinned; `paintSplat` is the splat's grid alone through it. The field it shades is the model: field.ts holds
 * the one implementation of the operations (a pen adds to the field and melts in, a wash takes some each pass,
 * `WASH_TAKES`), run here over a dense grid and by `LayerInk` over its cells, so the picture and the counts cannot
 * disagree (docs/plans/2026-11-12-whoops-ink-field-design.md, sections 2, 3 and 5). A post's picture is cut into bands
 * (docs/plans/2026-11-12-whoops-followups-design.md, section 1): each band of each layer is built once from its strokes
 * (build.ts), in a worker when it is heavy, and live strokes are then run into the band's grid and only the rectangle they
 * changed is shaded again, onto the band's own canvas. `paintStandIn` is what shows on that canvas while a build is out, and
 * only then: each ball of the splat as a flat circle in the layer's ink, then the strokes drawn flat on it (a pen in the
 * layer's ink, a wash taking some away, destination-out), an approximation of the field that the build's picture replaces. It holds nothing
 * of its own: it draws straight onto the band's canvas. A stroke is kept in shares of the box with the proportions it was
 * made in, so it is drawn under a transform that makes the brush a circle.
 */
import { rgbOf, luminance, unitPx, DESIGN, THRESHOLD, type Box, type Splat } from './splat.ts';
import { type Stroke } from './scrub.ts';
import { THIN_FLOOR, THIN_SPAN, denseGrid, splatInto, type Grid, type Rect } from './field.ts';

/** The pixel density a splat is drawn at: past two the extra pixels show nothing on soft ink and cost a quarter more memory each step. */
export const MAX_DPR = 2;

/** The most pixels one canvas may have: past it iOS fails silently. It holds the config preview's splat (`paintSplat`, sized to its whole box) and the suds canvas over the span of the near bands, whose density is lowered to stay within it. The wet sheen's canvas is sized to the same span and keeps to its own cap of the same size, `WET_PX` in suds.ts. The ink is not held to it: a post's ink is in bands of at most `BAND_PX` rows, never sized to the post. */
export const MAX_CANVAS_PX = 4_000_000;

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
 * center and radius and the underside are placed from `whole`, the whole lattice's size in points (a grid that is the
 * whole lattice passes its own size), and a pixel's row is `grid.row0 + y`. The gradient reads one point each way inside the grid, so a
 * band's edge row is exact only where the grid holds the row beyond it (a band's apron).
 */
export function shadeField(grid: Grid, washed: Uint8Array, color: string, density: number, rect: Rect, out: PixelsOut, whole: { readonly cols: number; readonly rows: number }): void {
  const { cols: w, rows: h, values: f, row0 } = grid, px = out.data, q = density, T = THRESHOLD;
  const W = whole.cols, H = whole.rows;
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
  shadeField(grid, grid.washed, color, q, { x0: 0, y0: 0, x1: w, y1: h }, img, { cols: grid.cols, rows: grid.rows });
  g.putImageData(img, 0, 0);
  return canvas;
}

/** A wash's strength in the stand-in, which has no field: each pass takes this share of the ink under it (the field's washes take some each pass too). */
export const STAND_IN_WASH = 0.5;

/** A stroke's path in the space where its brush is a circle: across px as they are, down px divided by the brush's down-to-across ratio. */
function trace(g: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], box: Box, k: number) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x * box.w, (y * box.h) / k) : g.moveTo(x * box.w, (y * box.h) / k)));
  /* A single point is a dab: a line to itself, nudged so a round cap draws. */
  if (points.length === 1) g.lineTo(points[0]![0] * box.w + 0.0001, (points[0]![1] * box.h) / k);
}

/** What the stand-in draws a layer from: its splat, its ink and the strokes on it, in the order they were made. */
export interface StandIn {
  readonly splat: Splat;
  readonly color: string;
  readonly strokes: readonly Stroke[];
}

/** The band a stand-in is drawn for: the post's box, the lattice's points a CSS px (`q`), and the band's first lattice row and row count. */
export interface BandView {
  readonly box: Box;
  readonly q: number;
  readonly row0: number;
  readonly rows: number;
}

/**
 * A layer's picture of one band before its build has arrived, drawn straight onto the band's own canvas (`canvas.width` by
 * `canvas.height` points, one point a canvas pixel, the band's first row at the top): each ball of the splat as a flat circle in the
 * layer's ink (the ball's own center and radius, where `splatInto` places it: the radius is where its field is at the ink threshold,
 * a ball's own `r`), then each stroke in order, a pen flat in the layer's ink and a wash taking `STAND_IN_WASH` of it away with a 2.5 px
 * blur. What does not reach the band is not drawn. Nothing is kept: the canvas is cleared and drawn again, and the build's picture is
 * put over all of it. A browser with no 2D context draws nothing.
 */
export function paintStandIn(canvas: HTMLCanvasElement, layer: StandIn, view: BandView): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const { box, q, row0, rows } = view;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!(box.w > 0 && box.h > 0 && Number.isFinite(box.w) && Number.isFinite(box.h) && q > 0)) return;
  /* The band's rows lie between these CSS px down. */
  const top = row0 / q, bottom = (row0 + rows) / q;
  const unit = unitPx(box);
  g.setTransform(q, 0, 0, q, 0, 0 - row0);
  g.fillStyle = layer.color;
  for (const b of layer.splat.balls) {
    const cx = (b.x / DESIGN.w) * box.w, cy = b.y * box.h, r = b.r * unit;
    if (cy + r < top || cy - r > bottom) continue;
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    g.fill();
  }
  g.lineCap = g.lineJoin = 'round';
  for (const s of layer.strokes) {
    /* The brush is `width * w` across and `width * aspect * h` down: squash the space by the ratio so the line is round in it. */
    const k = (s.aspect * box.h) / box.w;
    const reach = (s.width * box.w * k) / 2 + 3 / q;
    let lo = Infinity, hi = -Infinity;
    for (const p of s.points) { lo = Math.min(lo, p[1] * box.h); hi = Math.max(hi, p[1] * box.h); }
    if (hi + reach < top || lo - reach > bottom) continue;
    g.setTransform(q, 0, 0, q * k, 0, 0 - row0);
    g.lineWidth = s.width * box.w;
    if (s.tool === 'wash') {
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = STAND_IN_WASH;
      /* Shadow sizes are device px, untouched by the transform: a soft edge, as on the bench. */
      g.shadowColor = '#000';
      g.shadowBlur = 2.5;
    } else {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.strokeStyle = s.color;
    }
    trace(g, s.points, box, k);
    g.stroke();
  }
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);
}
