/**
 * Graffiti's spray painter: the one place a wall's Acts are drawn (the canvas API, so nothing here runs in Node) and the one place a
 * click is tested against its ink (design section 8, "The ink is spray paint"; plan Task 8).
 *
 * `paintWall` draws the surface's live Acts in order onto one layer: a draw with source-over, a wash with destination-out, so a wash cuts
 * every draw before it and a draw after it is not cut. A stroke's path is kept in shares of the box with the proportions it was made in;
 * as Whoops!'s painter does, it is drawn in the space where its brush is a circle: across px as they are, down px divided by
 * `k = aspect * box.h / box.w`, under a transform that squashes that space back. The brush is `width * box.w` across and
 * `width * aspect * box.h` down (radii half of each), which is the ellipse the engine's `cellsOf` counts (engine/rules/surface.ts).
 *
 * A drawn stroke is four layers, bottom to top: the overspray (a sprite of a radial falloff to 1.9x the core's radius, built once per
 * cap and color and stamped every quarter of the core's radius along the path), the speckle (dots beyond the overspray, whose places
 * come from mulberry32 seeded by a hash of the stroke's own points, so every screen draws the same), the core (the capsule, alpha 0.92)
 * and the pooling (a second core stamp, alpha 0.2, wherever two points lie closer than a third of the radius).
 *
 * `hitAt` is the click's test: a point is inked when it lies in a live draw's core and in no later wash's core, by the same capsule.
 * Overspray and speckle are looks and never claim anything.
 */
import { CANS, CAPS, SPONGE } from '../graffiti.ts';
import { MAX_CANVAS_PX, MAX_DPR } from '../whoops/paint.ts';
import { mulberry32 } from '../whoops/splat.ts';

/** The least a wall needs of an Act: its kind and its payload (`{ strokes }` for a draw, a stencil's expanded strokes included, and for a wash). */
export interface WallAct { readonly kind: string; readonly payload: unknown }
export interface Box { readonly w: number; readonly h: number }

type Point = readonly [number, number];
interface Brush { readonly rw: number; readonly k: number; readonly pts: readonly (readonly [number, number])[]; readonly color: string; readonly cap: string }

const OVERSPRAY = { reach: 1.9, alpha: 0.35 } as const;
const CORE_ALPHA = 0.92, POOL_ALPHA = 0.2, SPECKLE_ALPHA = 0.5;
const SPRITE_PX = 64;
const MOST_SPECKLES = 400;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validBox = (box: Box) => box.w > 0 && box.h > 0 && finite(box.w) && finite(box.h);

/** The density a wall is drawn at: at most MAX_DPR and what `density` asks, and low enough that the canvas stays within MAX_CANVAS_PX. */
export function wallDensity(box: Box, density: number): number {
  const area = box.w * box.h;
  let q = Math.min(MAX_DPR, density, area > 0 ? Math.sqrt(MAX_CANVAS_PX / area) : MAX_DPR);
  while (q > 0 && Math.ceil(box.w * q) * Math.ceil(box.h * q) > MAX_CANVAS_PX) q *= 0.9999;
  return q;
}

/** The strokes of an Act's payload, each kept only when it is well formed; the width is the cap's (a draw) or the sponge's (a wash). */
function brushes(act: WallAct, box: Box): Brush[] {
  const list = (act.payload as { strokes?: unknown } | null)?.strokes;
  if (!Array.isArray(list)) return [];
  const out: Brush[] = [];
  for (const s of list as Record<string, unknown>[]) {
    if (typeof s !== 'object' || s === null || !finite(s.aspect) || !(s.aspect > 0) || !Array.isArray(s.points) || s.points.length < 1) continue;
    let width: number, color = '#000000', cap = 'sponge';
    if (act.kind === 'wash') width = SPONGE;
    else {
      if (typeof s.cap !== 'string' || !Object.hasOwn(CAPS, s.cap) || typeof s.can !== 'string' || !Object.hasOwn(CANS, s.can)) continue;
      width = CAPS[s.cap as keyof typeof CAPS]; color = CANS[s.can as keyof typeof CANS]; cap = s.cap;
    }
    if (!(s.points as unknown[]).every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) continue;
    const k = (s.aspect * box.h) / box.w;
    out.push({ rw: (width * box.w) / 2, k, color, cap, pts: (s.points as Point[]).map(([x, y]): [number, number] => [x * box.w, (y * box.h) / k]) });
  }
  return out;
}

/** The stroke's own points, hashed (FNV-1a over each to a ten-thousandth of the box) into a seed that is the same on every screen. */
function seedOf(points: readonly Point[], box: Box, k: number): number {
  let h = 0x811c9dc5;
  for (const [ux, uy] of points) for (const n of [Math.round((ux / box.w) * 10_000), Math.round(((uy * k) / box.h) * 10_000)]) {
    h = Math.imul(h ^ (n & 0xffff), 0x01000193); h = Math.imul(h ^ ((n >> 16) & 0xffff), 0x01000193);
  }
  return h >>> 0;
}

const sprites = new Map<string, HTMLCanvasElement>();
/** The overspray as a unit sprite, a square whose edge is 1.9 core radii from its center: alpha 0.35 over the core, falling to 0 at the edge. Built once per cap and color. */
function sprite(cap: string, color: string): HTMLCanvasElement | null {
  const key = `${cap}:${color}`;
  const had = sprites.get(key);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(SPRITE_PX, SPRITE_PX);
  const [r, gr, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < SPRITE_PX; y++) for (let x = 0; x < SPRITE_PX; x++) {
    /* Distance from the center in core radii: the sprite spans -1.9 to 1.9. */
    const d = Math.hypot(((x + 0.5) / SPRITE_PX) * 2 - 1, ((y + 0.5) / SPRITE_PX) * 2 - 1) * OVERSPRAY.reach;
    const a = d <= 1 ? 1 : d >= OVERSPRAY.reach ? 0 : (1 - (d - 1) / (OVERSPRAY.reach - 1)) ** 2;
    const o = (y * SPRITE_PX + x) * 4;
    img.data[o] = r!; img.data[o + 1] = gr!; img.data[o + 2] = b!; img.data[o + 3] = Math.round(a * OVERSPRAY.alpha * 255);
  }
  g.putImageData(img, 0, 0);
  sprites.set(key, c);
  return c;
}

function trace(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  /* A single point is a dab: a line to itself, nudged so a round cap draws. */
  if (pts.length === 1) g.lineTo(pts[0]![0] + 0.0001, pts[0]![1]);
}

function drawStroke(g: CanvasRenderingContext2D, q: number, s: Brush, box: Box) {
  const { rw, k, pts } = s;
  const circle = () => g.setTransform(q, 0, 0, q * k, 0, 0);
  g.globalCompositeOperation = 'source-over';
  /* The overspray: stamps a quarter of the radius apart, each the sprite scaled to 1.9 radii a side. */
  const spr = sprite(s.cap, s.color);
  circle();
  if (spr) {
    g.globalAlpha = 1;
    const reach = rw * OVERSPRAY.reach, step = rw / 4;
    const stamp = (x: number, y: number) => g.drawImage(spr, x - reach, y - reach, reach * 2, reach * 2);
    stamp(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!, len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / step);
      for (let j = 1; j <= n; j++) stamp(ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n);
      if (n === 0 && len > 0) stamp(bx, by);
    }
  }
  /* The speckle: dots in CSS px (round on screen), placed from the stroke's own seed at 1.9 to 3.1 radii from the path, in the brush's space. */
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i]![0] - pts[i - 1]![0], (pts[i]![1] - pts[i - 1]![1]) * k);
  const count = Math.min(MOST_SPECKLES, Math.round((length + 2 * rw) * rw * 0.05));
  const rng = mulberry32(seedOf(pts, box, k));
  g.setTransform(q, 0, 0, q, 0, 0);
  g.globalAlpha = SPECKLE_ALPHA;
  g.fillStyle = s.color;
  const along = pts.map((p, i) => (i ? Math.hypot(p[0] - pts[i - 1]![0], (p[1] - pts[i - 1]![1]) * k) : 0));
  for (let i = 1; i < along.length; i++) along[i]! && (along[i] = along[i]! + along[i - 1]!);
  for (let n = 0; n < count; n++) {
    const t = rng() * length, side = rng() < 0.5 ? 0 : Math.PI, jitter = (rng() - 0.5) * (Math.PI / 2), far = OVERSPRAY.reach + rng() * 1.2, r = 0.3 + rng() * 0.5, free = rng() * Math.PI * 2;
    let i = 1;
    while (i < pts.length - 1 && along[i]! < t) i++;
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[Math.min(i, pts.length - 1)]!;
    const f = pts.length < 2 ? 0 : Math.min(1, Math.max(0, (t - along[i - 1]!) / Math.max(1e-9, along[i]! - along[i - 1]!)));
    const cx = p0[0] + (p1[0] - p0[0]) * f, cy = p0[1] + (p1[1] - p0[1]) * f;
    /* Off the path's side, within 45 degrees of its normal, and out far enough that the normal's share is past the overspray; a dab has no side. */
    const angle = pts.length < 2 || (p0[0] === p1[0] && p0[1] === p1[1]) ? free : Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + Math.PI / 2 + side + jitter;
    const dist = (rw * far) / (pts.length < 2 ? 1 : Math.cos(jitter));
    g.beginPath();
    g.arc(cx + Math.cos(angle) * dist, (cy + Math.sin(angle) * dist) * k, r, 0, Math.PI * 2);
    g.fill();
  }
  /* The core. */
  circle();
  g.globalAlpha = CORE_ALPHA;
  g.strokeStyle = s.color;
  g.lineWidth = rw * 2;
  trace(g, pts);
  g.stroke();
  /* Pooling: paint gathers where the can lingered. */
  g.globalAlpha = POOL_ALPHA;
  g.fillStyle = s.color;
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]) >= rw / 3) continue;
    g.beginPath();
    g.arc(pts[i]![0], pts[i]![1], rw, 0, Math.PI * 2);
    g.fill();
  }
}

function washStroke(g: CanvasRenderingContext2D, q: number, s: Brush) {
  g.setTransform(q, 0, 0, q * s.k, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  g.strokeStyle = '#000000';
  g.lineWidth = s.rw * 2;
  trace(g, s.pts);
  g.stroke();
  g.globalCompositeOperation = 'source-over';
}

/**
 * Paints the wall's live Acts, in order, on `ctx`'s canvas, whose pixels are ceil(box.w * q) by ceil(box.h * q) for q = `wallDensity`
 * (set by the caller). Coordinates are CSS px of the box. A box with no area draws nothing, and what was drawn before is cleared.
 */
export function paintWall(ctx: CanvasRenderingContext2D, box: Box, density: number, acts: readonly WallAct[]): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!validBox(box)) return;
  const q = wallDensity(box, density);
  if (!(q > 0)) return;
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const act of acts) {
    if (act.kind === 'draw') for (const s of brushes(act, box)) drawStroke(ctx, q, s, box);
    else if (act.kind === 'wash') for (const s of brushes(act, box)) washStroke(ctx, q, s);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

/** Whether the point (CSS px of the box) lies in the core of a stroke: within `rw` of its path in the brush's space. */
function inCore(s: Brush, x: number, y: number): boolean {
  const py = y / s.k;
  const { pts, rw } = s;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[Math.min(i + 1, pts.length - 1)]!;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (py - ay) * dy) / l2));
    if (Math.hypot(x - ax - t * dx, py - ay - t * dy) <= rw) return true;
  }
  return false;
}

/** Whether any ink lies under the point (CSS px of the box): in a draw's core and in no later wash's core. Overspray and speckle are not ink. */
export function hitAt(acts: readonly WallAct[], box: Box, x: number, y: number): boolean {
  if (!validBox(box)) return false;
  let inked = false;
  for (const act of acts) {
    if (act.kind !== 'draw' && act.kind !== 'wash') continue;
    if (brushes(act, box).some((s) => inCore(s, x, y))) inked = act.kind === 'draw';
  }
  return inked;
}
