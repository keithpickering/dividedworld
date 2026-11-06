/**
 * Whoops!'s canvas: the one place a splat is drawn (the canvas API, so nothing here runs in Node).
 *
 * `paintSplat` paints a splat as wet ink, pixel by pixel from its field (splat.ts `fieldGrid`), as the bench
 * approved (docs/research/2026-11-06-whoops-bench): the edge is anti-aliased from the field's signed distance,
 * `(v - T) / |grad v|` px; a meniscus rises over about 3.5 CSS px from the edge and is flat inside, lit from
 * up and left, so an edge facing the light gets a bright rim and a glint and the far side a darker rim; a
 * pale ink gets a darker rim scaled by its luminance so it has an edge on a white page; a broad gloss and a
 * slightly darker underside lie on top. The result is cached by the Effect, one per layer per box.
 *
 * `paint` composes a post's layers, bottom to top, each as its cached splat, then its strokes in the order
 * they were made: a wash takes the ink away, a pen writes it back in the layer's ink. A stroke is kept in
 * shares of the box with the proportions it was made in, so it is drawn under a transform that makes the
 * brush a circle, and the path's points are put into that space. Layers are composited through one scratch
 * canvas shared by every post, because a wash of one layer must not erase the layer under it and a canvas
 * of its own per layer would be three more ("Weigh a design at the scale of a busy instance"). A canvas is
 * painted only for a post near the viewport (Effect.tsx) and is dropped when it leaves.
 */
import { fieldGrid, rgbOf, luminance, THRESHOLD, type Box, type Splat } from './splat.ts';
import { type Stroke } from './scrub.ts';

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

export interface PaintLayer {
  /** The layer's splat as `paintSplat` painted it, for this box; drawn scaled to the box. */
  readonly painted: HTMLCanvasElement;
  readonly color: string;
  /** The strokes on it, saved and the reader's own, in the order they were made: washes, and the author's pen strokes in its ink. */
  readonly strokes: readonly Stroke[];
  /** 1 while it is on, falling to 0 as it fades after being washed clean. */
  readonly alpha: number;
}

/**
 * The splat as wet ink on a canvas of ceil(box.w * d) by ceil(box.h * d) pixels, d being `density`, at most 1 and
 * at most what keeps the canvas within MAX_CANVAS_PX.
 * A browser with no 2D context gives a blank canvas.
 */
export function paintSplat(splat: Splat, color: string, box: Box, density: number): HTMLCanvasElement {
  const area = box.w * box.h;
  let q = Math.min(1, density, area > 0 ? Math.sqrt(MAX_CANVAS_PX / area) : 1);
  /*
   * ceil can add a pixel a side and pass the cap. The density is lowered, never a side trimmed, so the canvas stays
   * the field's own grid (fieldGrid's ceil(box·q) both ways) and a row's stride is the field's.
   */
  while (q > 0 && Math.ceil(box.w * q) * Math.ceil(box.h * q) > MAX_CANVAS_PX) q *= 0.9999;
  const w = Math.ceil(box.w * q), h = Math.ceil(box.h * q);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g || !w || !h) return canvas;
  const f = fieldGrid(splat, box, q);
  const T = THRESHOLD;
  const img = g.createImageData(w, h), px = img.data;
  const [ir, ig, ib] = rgbOf(color), L = luminance(color);
  let lx = -0.45, ly = -0.65, lz = 0.62;
  { const n = Math.hypot(lx, ly, lz); lx /= n; ly /= n; lz /= n; }
  let hx = lx, hy = ly, hz = lz + 1;
  { const n = Math.hypot(hx, hy, hz); hx /= n; hy /= n; hz /= n; }
  const men = 3.5 * q, rimW = 1.6 * q, specK = 0.55 + 0.45 * (1 - L);
  for (let y = 0; y < h; y++) {
    const up = y > 0 ? -w : 0, dn = y < h - 1 ? w : 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = f[i]!;
      if (v < T * 0.4) continue;
      const gx = (f[i + (x < w - 1 ? 1 : 0)]! - f[i - (x > 0 ? 1 : 0)]!) * 0.5, gy = (f[i + dn]! - f[i + up]!) * 0.5;
      const gm = Math.hypot(gx, gy) + 1e-6;
      const sd = (v - T) / gm;
      const a = Math.min(1, Math.max(0, sd + 0.5));
      if (a <= 0) continue;
      const slope = 1.5 * Math.exp(-Math.max(0, sd) / men);
      let nx = (-gx / gm) * slope, ny = (-gy / gm) * slope, nz = 1;
      const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
      const diff = nx * lx + ny * ly + nz * lz;
      const shade = 0.86 + 0.6 * (diff - lz);
      const spec = Math.max(0, nx * hx + ny * hy + nz * hz) ** 60 * specK;
      const rim = L * 0.5 * Math.exp(-Math.max(0, sd) / rimW);
      const k = Math.max(0, shade * (1 - rim));
      const o = i * 4;
      px[o] = Math.min(255, ir * k + 255 * spec);
      px[o + 1] = Math.min(255, ig * k + 255 * spec);
      px[o + 2] = Math.min(255, ib * k + 255 * spec);
      px[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  /* A broad wet gloss and a darker underside, laid on the ink alone. */
  g.globalCompositeOperation = 'source-atop';
  const gl = g.createRadialGradient(w * 0.32, h * 0.28, 0, w * 0.32, h * 0.28, Math.max(w, h) * 0.7);
  gl.addColorStop(0, `rgba(255,255,255,${0.2 * (1 - L) + 0.04})`);
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl;
  g.fillRect(0, 0, w, h);
  const lo = g.createLinearGradient(0, h * 0.35, 0, h);
  lo.addColorStop(0, 'rgba(0,0,0,0)');
  lo.addColorStop(1, `rgba(0,0,0,${0.06 + 0.12 * L})`);
  g.fillStyle = lo;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  return canvas;
}

let scratch: HTMLCanvasElement | null = null;

/**
 * The one scratch canvas, shared by every post and sized to the canvas being painted: never larger than the largest single ink
 * canvas (each at most MAX_CANVAS_PX), since growing it to the widest and tallest seen apart would pass a browser's canvas limit.
 */
function scratchOf(width: number, height: number): CanvasRenderingContext2D | null {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  return scratch.getContext('2d', { willReadFrequently: false });
}

/** A stroke's path in the space where its brush is a circle: across px as they are, down px divided by the brush's down-to-across ratio. */
function trace(g: CanvasRenderingContext2D, points: readonly (readonly [number, number])[], box: Box, k: number) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x * box.w, (y * box.h) / k) : g.moveTo(x * box.w, (y * box.h) / k)));
  /* A single point is a dab: a line to itself, nudged so a round cap draws. */
  if (points.length === 1) g.lineTo(points[0]![0] * box.w + 0.0001, (points[0]![1] * box.h) / k);
}

/**
 * Paint the post's layers, each with its strokes, on `canvas`, whose pixels are `canvas.width` by
 * `canvas.height` (set by the caller, at the geometry's density). A browser with no 2D context draws nothing.
 */
export function paint(canvas: HTMLCanvasElement, geo: Geometry, layers: readonly PaintLayer[]): void {
  const ctx = canvas.getContext('2d');
  const work = scratchOf(canvas.width, canvas.height);
  if (!ctx || !work) return;
  const { dpr, box } = geo;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  /* A box with no area draws nothing, and what was drawn before is cleared. */
  if (!(box.w > 0 && box.h > 0 && Number.isFinite(box.w) && Number.isFinite(box.h))) return;
  for (const layer of layers) {
    if (layer.alpha <= 0) continue;
    work.setTransform(1, 0, 0, 1, 0, 0);
    work.globalCompositeOperation = 'source-over';
    work.shadowColor = 'transparent';
    work.shadowBlur = 0;
    work.clearRect(0, 0, canvas.width, canvas.height);
    work.drawImage(layer.painted, geo.left * dpr, geo.top * dpr, box.w * dpr, box.h * dpr);
    work.lineCap = work.lineJoin = 'round';
    for (const s of layer.strokes) {
      /* A wash takes the layer's ink away and a pen writes it back, whichever came last winning, as the layer's model (scrub.ts) says; neither touches the layers under. */
      /* The brush is `width * w` across and `width * aspect * h` down: squash the space by the ratio so the line is round in it. */
      const k = (s.aspect * box.h) / box.w;
      work.setTransform(dpr, 0, 0, dpr * k, geo.left * dpr, geo.top * dpr);
      work.lineWidth = s.width * box.w;
      if (s.tool === 'wash') {
        work.globalCompositeOperation = 'destination-out';
        /* Shadow sizes are device px, untouched by the transform: a soft edge, as on the bench. */
        work.shadowColor = '#000';
        work.shadowBlur = 2.5;
      } else {
        work.globalCompositeOperation = 'source-over';
        work.shadowColor = 'transparent';
        work.shadowBlur = 0;
        work.strokeStyle = s.color;
      }
      trace(work, s.points, box, k);
      work.stroke();
    }
    work.shadowColor = 'transparent';
    work.shadowBlur = 0;
    work.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = layer.alpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(work.canvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
}
