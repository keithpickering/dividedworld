/**
 * Graffiti's spray painter: the one place a wall's Acts are drawn (the canvas API, so nothing here runs in Node) and the one place a
 * click is tested against its ink (design section 8, "The ink is spray paint"; plan Task 8).
 *
 * `paintWall` draws the surface's live Acts in order onto two layers, in the space where a stroke's brush is a circle, as Whoops!'s
 * painter does: across px as they are, down px divided by `k = aspect * box.h / box.w`, under a transform that squashes it back. The
 * brush is `width * box.w` across and `width * aspect * box.h` down (radii half of each), the ellipse the engine's `cellsOf` counts
 * (engine/rules/surface.ts). Paths are kept in shares of the box with the proportions they were made in.
 *
 * The halo layer (a scratch canvas, released after each paint) takes every drawn stroke's overspray (a sprite of a radial falloff to 1.9x
 * the core's radius, built once per cap and color, stamped every quarter of the core's radius of arc length, at least a CSS px, at an
 * alpha that makes the pile peak near 0.35) and its speckle (dots beyond the overspray, counted in shares of the box's width and placed
 * by mulberry32 seeded by a hash of the stroke's own points, so every screen draws the same). The wall's own canvas takes the cores (the
 * capsule, alpha 0.92) and the pooling (a second core stamp, alpha 0.2, where two points lie closer than a third of the radius). At the
 * end the halo layer goes under all the cores. A wash is destination-out on each layer: on the cores at the sponge's width, on the
 * halos at that plus the widest halo's reach; a draw after a wash is not cut.
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
/** The speckle's places: from 1.9 to 3.1 core radii out, along a direction within 45 degrees of the path's normal (so out to 3.1 / cos 45). */
const SPECKLE_FAR = { from: OVERSPRAY.reach, span: 1.2, tilt: Math.PI / 4 } as const;
/** Speckles per unit of (path length + width) x width, both as shares of the box's width, so a tag has the same count on every screen. */
const SPECKLE_DENSITY = 4000;
/** The most speckles one stroke has. It caps the proportion above, a share-based number, so the cap too is the same on every screen. */
const MOST_SPECKLES = 400;
/** The least a stamp spacing is, in CSS px: a Skinny cap's quarter radius is under a pixel, and stamps closer than that add cost and nothing to see. */
const LEAST_STEP = 1;
/** How far past a Fat core's edge a speckle can lie, in CSS px of the box's width (a dot's own radius is under 1): what a wash must also clear from the halo layer. */
const haloMargin = (box: Box) => ((CAPS.fat * box.w) / 2) * (SPECKLE_FAR.from + SPECKLE_FAR.span) / Math.cos(SPECKLE_FAR.tilt) + 1;

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
/** The overspray as a unit sprite, a square whose edge is 1.9 core radii from its center: full alpha over the core, falling to 0 at the edge. Built once per color (and cap). */
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
    const a = falloff(Math.hypot(((x + 0.5) / SPRITE_PX) * 2 - 1, ((y + 0.5) / SPRITE_PX) * 2 - 1) * OVERSPRAY.reach);
    const o = (y * SPRITE_PX + x) * 4;
    img.data[o] = r!; img.data[o + 1] = gr!; img.data[o + 2] = b!; img.data[o + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  sprites.set(key, c);
  return c;
}
/** The overspray's profile by distance from a stamp's center in core radii: 1 over the core, falling to 0 at 1.9. */
const falloff = (d: number) => (d <= 1 ? 1 : d >= OVERSPRAY.reach ? 0 : (1 - (d - 1) / (OVERSPRAY.reach - 1)) ** 2);

const stampAlphas = new Map<number, number>();
/**
 * The alpha each stamp is laid at, for stamps `ratio` core radii apart: the one at which a straight run of them accumulates to 0.35 at the
 * core's edge, so the halo's peak is the plan's 0.35 however many stamps overlap (a quarter radius apart they pile about thirteen deep).
 */
function stampAlpha(ratio: number): number {
  const key = Math.round(ratio * 1000);
  const had = stampAlphas.get(key);
  if (had !== undefined) return had;
  const at = (c: number) => {
    let keep = 1;
    for (let j = -Math.ceil(OVERSPRAY.reach / ratio); j <= Math.ceil(OVERSPRAY.reach / ratio); j++) keep *= 1 - c * falloff(Math.hypot(j * ratio, 1));
    return 1 - keep;
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (at(mid) < OVERSPRAY.alpha) lo = mid; else hi = mid; }
  stampAlphas.set(key, lo);
  return lo;
}

function trace(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  /* A single point is a dab: a line to itself, nudged so a round cap draws. */
  if (pts.length === 1) g.lineTo(pts[0]![0] + 0.0001, pts[0]![1]);
}

/** A stroke's halo, on the halo layer: the overspray stamps, then the speckle. */
function drawHalo(g: CanvasRenderingContext2D, q: number, s: Brush, box: Box) {
  const { rw, k, pts } = s;
  g.globalCompositeOperation = 'source-over';
  /* The overspray: stamps along the path, each the sprite scaled to 1.9 radii a side, at least a CSS pixel apart. */
  const spr = sprite(s.cap, s.color);
  if (spr) {
    g.setTransform(q, 0, 0, q * k, 0, 0);
    const step = Math.max(rw / 4, LEAST_STEP);
    g.globalAlpha = stampAlpha(step / rw);
    const reach = rw * OVERSPRAY.reach;
    const stamp = (x: number, y: number) => g.drawImage(spr, x - reach, y - reach, reach * 2, reach * 2);
    stamp(pts[0]![0], pts[0]![1]);
    /* Every `step` of arc length, carried across segments: points closer than a step add no stamps, so the alpha above holds however dense they are. */
    let next = step;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!, len = Math.hypot(bx - ax, by - ay);
      if (len === 0) continue;
      for (; next <= len; next += step) stamp(ax + ((bx - ax) * next) / len, ay + ((by - ay) * next) / len);
      next -= len;
    }
  }
  /* The speckle: dots in CSS px (round on screen), from the stroke's own seed, in the brush's space. Its count is of shares of the box's width. */
  const along: number[] = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], (pts[i]![1] - pts[i - 1]![1]) * k));
  const length = along.at(-1)!;
  const width = (2 * rw) / box.w;
  const count = Math.min(MOST_SPECKLES, Math.round((length / box.w + width) * width * SPECKLE_DENSITY));
  const rng = mulberry32(seedOf(pts, box, k));
  g.setTransform(q, 0, 0, q, 0, 0);
  g.globalAlpha = SPECKLE_ALPHA;
  g.fillStyle = s.color;
  for (let n = 0; n < count; n++) {
    const t = rng() * length, side = rng() < 0.5 ? 0 : Math.PI, jitter = (rng() - 0.5) * SPECKLE_FAR.tilt * 2, far = SPECKLE_FAR.from + rng() * SPECKLE_FAR.span, r = 0.3 + rng() * 0.5, free = rng() * Math.PI * 2;
    /* The segment holding t: the first point whose running length reaches it (a repeated point adds a zero step and is passed over). */
    let lo = 1, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (along[mid]! < t) lo = mid + 1; else hi = mid; }
    const i = Math.min(lo, pts.length - 1);
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!;
    const span = i > 0 ? along[i]! - along[i - 1]! : 0;
    const f = span > 0 ? Math.min(1, Math.max(0, (t - along[i - 1]!) / span)) : 0;
    const cx = p0[0] + (p1[0] - p0[0]) * f, cy = p0[1] + (p1[1] - p0[1]) * f;
    /* Off the path's side, within 45 degrees of its normal, and out far enough that the normal's share is past the overspray; a dab has no side. */
    const flat = length === 0 || (p0[0] === p1[0] && p0[1] === p1[1]);
    const angle = flat ? free : Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + Math.PI / 2 + side + jitter;
    const dist = (rw * far) / (flat ? 1 : Math.cos(jitter));
    g.beginPath();
    g.arc(cx + Math.cos(angle) * dist, (cy + Math.sin(angle) * dist) * k, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** A stroke's core and pooling, on the core layer. */
function drawCore(g: CanvasRenderingContext2D, q: number, s: Brush) {
  const { rw, k, pts } = s;
  g.setTransform(q, 0, 0, q * k, 0, 0);
  g.globalCompositeOperation = 'source-over';
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

function washStroke(g: CanvasRenderingContext2D, q: number, s: Brush, radius: number) {
  g.setTransform(q, 0, 0, q * s.k, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  g.strokeStyle = '#000000';
  g.lineWidth = radius * 2;
  trace(g, s.pts);
  g.stroke();
  g.globalCompositeOperation = 'source-over';
}

let haloCanvas: HTMLCanvasElement | null = null;

/**
 * Paints the wall's live Acts, in order, on `ctx`'s canvas, whose pixels are ceil(box.w * q) by ceil(box.h * q) for q = `wallDensity`
 * (set by the caller). Coordinates are CSS px of the box. A box with no area draws nothing, and what was drawn before is cleared.
 *
 * Two layers: the cores and pooling go on `ctx` itself, and every halo (overspray and speckle) on one scratch canvas shared by all
 * walls, laid under all the cores at the end (destination-over), so no halo is over any core, and then released (sized to 0 by 0). A
 * wash cuts each layer in order: the core layer at exactly the sponge's radius, which is what `hitAt` and the engine count, and the
 * halo layer at that radius plus the widest halo's reach (a Fat cap's speckle), so no ghost of paint is left where the wash passed. A
 * later draw's halo is not cut. A canvas with no pixels draws nothing.
 */
export function paintWall(ctx: CanvasRenderingContext2D, box: Box, density: number, acts: readonly WallAct[]): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!validBox(box) || !(ctx.canvas.width > 0 && ctx.canvas.height > 0)) return;
  const q = wallDensity(box, density);
  if (!(q > 0)) return;
  haloCanvas ??= document.createElement('canvas');
  const halo = haloCanvas.getContext('2d');
  if (halo) {
    if (haloCanvas.width !== ctx.canvas.width) haloCanvas.width = ctx.canvas.width;
    if (haloCanvas.height !== ctx.canvas.height) haloCanvas.height = ctx.canvas.height;
    halo.setTransform(1, 0, 0, 1, 0, 0);
    halo.globalAlpha = 1;
    halo.globalCompositeOperation = 'source-over';
    halo.clearRect(0, 0, haloCanvas.width, haloCanvas.height);
    halo.lineCap = halo.lineJoin = 'round';
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  const margin = haloMargin(box);
  for (const act of acts) {
    for (const s of strokesOf(act, box)) {
      if (act.kind === 'draw') { if (halo) drawHalo(halo, q, s, box); drawCore(ctx, q, s); }
      else if (act.kind === 'wash') { washStroke(ctx, q, s, s.rw); if (halo) washStroke(halo, q, s, s.rw + margin); }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (halo) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(haloCanvas, 0, 0, haloCanvas.width, haloCanvas.height);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  /* Released, so a big wall does not pin a second canvas's memory until the next paint. */
  if (haloCanvas) haloCanvas.width = haloCanvas.height = 0;
}

/** An Act's brushes, kept for as long as the Act object and the box are the same, so a click does not rebuild a wall's strokes act by act. */
const kept = new WeakMap<object, { w: number; h: number; list: Brush[] }>();
function strokesOf(act: WallAct, box: Box): Brush[] {
  if (act.kind !== 'draw' && act.kind !== 'wash') return [];
  const had = kept.get(act);
  if (had && had.w === box.w && had.h === box.h) return had.list;
  const list = brushes(act, box);
  kept.set(act, { w: box.w, h: box.h, list });
  return list;
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

/**
 * Whether any ink lies under the point (CSS px of the box): in a draw's core and in no later wash's core. Overspray and speckle are not
 * ink. The last Act whose core holds the point decides, so the walk is from the newest and stops there.
 */
export function hitAt(acts: readonly WallAct[], box: Box, x: number, y: number): boolean {
  if (!validBox(box)) return false;
  for (let i = acts.length - 1; i >= 0; i--) {
    const act = acts[i]!;
    if (strokesOf(act, box).some((s) => inCore(s, x, y))) return act.kind === 'draw';
  }
  return false;
}
