/**
 * Whoops!'s canvas: the one place a splat is drawn (the canvas API, so nothing here runs in Node). It
 * paints a post's layers, bottom to top, each as its splat in its ink with the shading splat.ts gives
 * that ink, less the washes on it, and then the author's pen strokes over all of them.
 *
 * Memory is the cost this is built around ("Weigh a design at the scale of a busy instance"): a page
 * can hold many splatted posts, and a canvas the size of a phone's post at its pixel density is
 * megabytes. So the canvas covers only the rows the splats reach (not the post's whole height, which
 * can be 64 widths), the pixel density is capped, and layers are composited through one scratch canvas
 * shared by every post, because a wash of one layer must not erase the layer under it and a canvas of
 * its own per layer would be three more. A canvas is painted only for a post near the viewport
 * (Effect.tsx) and is dropped when it leaves.
 */
import { shading, type Splat } from './splat.ts';
import { type Stroke } from './scrub.ts';

/** The pixel density a splat is drawn at: past two the extra pixels show nothing on soft ink and cost a quarter more memory each step. */
export const MAX_DPR = 2;

/** Where the canvas sits in its frame, and how the layout lies in it. */
export interface Geometry {
  /** Pixels per CSS pixel. */
  readonly dpr: number;
  /** The layout's width in CSS px, scaled: one "width" of the strokes' unit. */
  readonly width: number;
  /** How far in from the frame's left the layout starts, in CSS px. */
  readonly offset: number;
  /** The canvas's top in the frame, in CSS px. */
  readonly top: number;
  /** The reference width's scale, for sizes the shading names in px at the reference width. */
  readonly scale: number;
}

export interface PaintLayer {
  readonly splat: Splat;
  readonly color: string;
  /** The washes on it, saved and the reader's own, in the order they were made. */
  readonly washes: readonly Stroke[];
  /** 1 while it is on, falling to 0 as it fades after being washed clean. */
  readonly alpha: number;
}

let scratch: HTMLCanvasElement | null = null;

/** The one scratch canvas, at least this big, shared by every post. */
function scratchOf(width: number, height: number): CanvasRenderingContext2D | null {
  scratch ??= document.createElement('canvas');
  if (scratch.width < width) scratch.width = width;
  if (scratch.height < height) scratch.height = height;
  return scratch.getContext('2d', { willReadFrequently: false });
}

function trace(g: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  /* A single point is a dab: a line to itself, nudged so a round cap draws. */
  if (points.length === 1) g.lineTo(points[0]![0] + 0.0001, points[0]![1]);
}

function drawSplat(g: CanvasRenderingContext2D, layer: PaintLayer, geo: Geometry) {
  const sh = shading(layer.color);
  const { cx, cy, rx, ry } = layer.splat.placement;
  g.save();
  g.fillStyle = layer.color;
  /* A pale ink casts a soft shadow around its outside edge so it has an outline on a white page; shadow sizes are px, not scaled by the transform. */
  g.shadowColor = `rgba(0,0,0,${sh.edgeShadow})`;
  g.shadowBlur = sh.edgeBlur * geo.scale * geo.dpr;
  g.shadowOffsetY = sh.edgeOffset * geo.scale * geo.dpr;
  g.fill(new Path2D(layer.splat.path), 'nonzero');
  g.shadowColor = 'transparent';
  /* The shading is laid on the ink only: a wet white highlight up and left of center on a dark ink, a darker underside low and right. */
  g.globalCompositeOperation = 'source-atop';
  const hi = g.createRadialGradient(cx - rx * 0.2, cy - ry * 0.4, rx * 0.02, cx - rx * 0.2, cy - ry * 0.4, rx * 1.1);
  hi.addColorStop(0, `rgba(255,255,255,${sh.highlight})`);
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi;
  const { minX, maxX, minY, maxY } = layer.splat.bounds;
  g.fillRect(minX - 0.1, minY - 0.1, maxX - minX + 0.2, maxY - minY + 0.2);
  const lo = g.createRadialGradient(cx + rx * 0.25, cy + ry * 0.55, rx * 0.1, cx + rx * 0.25, cy + ry * 0.55, rx * 1.5);
  lo.addColorStop(0, 'rgba(0,0,0,0)');
  lo.addColorStop(1, `rgba(0,0,0,${sh.underside})`);
  g.fillStyle = lo;
  g.fillRect(minX - 0.1, minY - 0.1, maxX - minX + 0.2, maxY - minY + 0.2);
  g.restore();
}

/**
 * Paint the post's layers and the pen over them on `canvas`, whose pixels are `canvas.width` by
 * `canvas.height` (set by the caller, at the geometry's density). A browser with no 2D context draws nothing.
 */
export function paint(canvas: HTMLCanvasElement, geo: Geometry, layers: readonly PaintLayer[], pens: readonly Stroke[]): void {
  const ctx = canvas.getContext('2d');
  const work = scratchOf(canvas.width, canvas.height);
  if (!ctx || !work) return;
  const at = (g: CanvasRenderingContext2D) => {
    g.setTransform(geo.dpr, 0, 0, geo.dpr, geo.offset * geo.dpr, -geo.top * geo.dpr);
    g.scale(geo.width, geo.width);
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const layer of layers) {
    if (layer.alpha <= 0) continue;
    work.setTransform(1, 0, 0, 1, 0, 0);
    work.globalCompositeOperation = 'source-over';
    work.clearRect(0, 0, canvas.width, canvas.height);
    at(work);
    drawSplat(work, layer, geo);
    work.globalCompositeOperation = 'destination-out';
    work.lineCap = work.lineJoin = 'round';
    for (const s of layer.washes) {
      if (s.tool !== 'wash') continue;
      work.lineWidth = s.width;
      trace(work, s.points);
      work.stroke();
    }
    ctx.globalAlpha = layer.alpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(work.canvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  at(ctx);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of pens) {
    if (s.tool !== 'ink') continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    trace(ctx, s.points);
    ctx.stroke();
  }
}
