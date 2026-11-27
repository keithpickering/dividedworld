/**
 * Graffiti's spray painter: the one place a wall's Acts are turned into paint (the canvas API, so `paint` does not run in Node), tested against a
 * click and thinned by the sponge (docs/plans/2026-11-27-graffiti-everywhere-design.md, sections 4 and 5; plan Task 7). The bench it follows for the
 * look is docs/research/2026-11-27-graffiti-everywhere/01-scrub-bench.html.
 *
 * **A group is a field.** Each group of each live draw is a grid of 2 px cells over the group's own bounds on this screen (never the whole box, so
 * the cost follows the paint and not the post), in px as `placeGroups` (engine/ui/cards/place.ts) puts the group here: its origin, and how many px a
 * unit of its is (an em of this screen's text, or the width of the image it is attached to, shrunk by the group's scale). A cell holds
 * - `core`, in tenths of a coat: each stroke lays `COATS.line` once on the cells its core covers (the cell center within the brush radius of its path),
 *   held to `COATS.most`;
 * - `halo` and `dot`, the overspray and the speckle, as the old painter drew them: the overspray falls off to `OVERSPRAY.reach` radii, the speckle is
 *   dots out to 3.1 radii seeded by the stroke's own points, so every screen draws the same ones. Both thin as the core under them does, and are seen
 *   only where the core is clean.
 *
 * **The sponge.** A press is a disc of radius `R = 2r` (`r` is `SPONGE_EM / 2` ems of this screen's text) taking `10 * per * (1 - d^2/R^2)^3` tenths from
 * the cell it is over: presses every third of `r` along a straight line take one coat under the center, the rule `takesOf` (engine/rules/surface.ts)
 * counts for the server. A press goes to the top group of the wall with paint under its center (wall order: a later draw over an earlier, a later group
 * over an earlier), and takes from that group alone; a press with no paint under its center goes to the top group in that order with paint within
 * the sponge radius of its center (`r`; for a legacy group, its own radius), and takes from that group alone, so a pass that runs beside the last
 * scraps still finishes them. A cell under `CLEAN` tenths is clean and is kept as 0. A legacy group's sponge is the old one: a disc of `SPONGE / 2`
 * of the box's width (`r`), as the server counts a draw of the old shape, and its presses are spaced by that, so the screen replays and predicts
 * what the server computes.
 *
 * **What a screen replays.** The saved washes are `{ cuts: [{ draw, group, presses }] }`, presses in the group's own units, replayed at the group's
 * placed scale: that is what keeps the fine edge. This visit's own presses follow, as `chunks`. A legacy wash (`{ strokes }`) is an instant cut, as it
 * was stored, of the legacy draws before it.
 *
 * **Composited as the bench does:** the halos of every group, then the cores in wall order. Thinned paint (any cell a press touched) is drawn at
 * `CORE_ALPHA * min(1, 0.35 + 0.65 * (coats - 1.2) / 10)`, coats in tenths.
 *
 * **Cached.** A field keeps a bitmap of its halo pass and of its core pass, drawn again only after a press or a cut changed the field (`Field.rasters` counts the
 * draws), so a frame of a scrub or a Hold costs the groups it pressed and the compositing of the rest. A wall built over the one before it (`Wall.of`'s last
 * argument) keeps each field whose inputs, placement and washes are the same, bitmaps and all.
 *
 * **Legacy.** A draw of the old shape (`{ strokes }`, in shares of the box with an aspect) is one group at its shares, its strokes at their old widths
 * (`CAPS`), laid as a 2-coat group; its units are shares of the box.
 */
import type { Attachment } from '../../../../engine/rules/anchor.ts';
import { placeGroups, type Measured, type PlaceGroup } from '../../../../engine/ui/cards/place.ts';
import { CANS, CAPS, CAPS_EM, COATS, SPONGE, SPONGE_EM } from '../graffiti.ts';
import { MAX_CANVAS_PX, MAX_DPR } from '../whoops/paint.ts';
import { ROW_PX } from '../whoops/scrub.ts';
import { mulberry32 } from '../whoops/splat.ts';

/** The least a wall needs of an Act: its kind, its payload and, for a draw, its id and where its groups are attached in the post as it is now. */
export interface WallAct {
  readonly kind: string;
  readonly payload: unknown;
  readonly id?: string;
  readonly places?: readonly { readonly grp: number; readonly place: Attachment | null }[];
}
export interface Box { readonly w: number; readonly h: number }
type Pt = readonly [number, number];

const OVERSPRAY = { reach: 1.9, alpha: 0.35 } as const;
const CORE_ALPHA = 0.92, SPECKLE_ALPHA = 0.5;
/** The speckle's places: from 1.9 to 3.1 core radii out, along a direction within 45 degrees of the path's normal (so out to 3.1 / cos 45). */
const SPECKLE_FAR = { from: OVERSPRAY.reach, span: 1.2, tilt: Math.PI / 4 } as const;
const SPECKLE_DENSITY = 4000;
const MOST_SPECKLES = 400;
/** The width in ems of the box a speckle's density was set in (988 px at 15 px), so a tag has the same count whatever the screen. */
const DENSITY_EMS = 65.9;
/** A cell's side in px. */
const CELL = 2;
/** A cell holding less than this many tenths of a coat is clean. */
export const CLEAN = 1.2;
/** How far past a core's radius paint can lie: the speckle's farthest dot, in core radii. */
const REACHES = (SPECKLE_FAR.from + SPECKLE_FAR.span) / Math.cos(SPECKLE_FAR.tilt);
/** What one press takes under its center, in tenths, once the profile is `(1 - d^2/R^2)^3`: `10 * (r / 3) / (2r * 32 / 35)`. */
const PRESS_TENTHS = (10 * 35) / (6 * 32);
/** How many presses to a sponge radius's travel. */
const PRESSES_PER_RADIUS = 3;
/** The old sponge's width, as a share of the box, which a legacy wash cut at. */
const OLD_SPONGE = 0.06;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validBox = (box: Box) => box.w > 0 && box.h > 0 && finite(box.w) && finite(box.h);
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const round = (digits: number) => (n: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** The density a wall is drawn at: at most MAX_DPR and what `density` asks, and low enough that the canvas stays within MAX_CANVAS_PX. */
export function wallDensity(box: Box, density: number): number {
  const area = box.w * box.h;
  let q = Math.min(MAX_DPR, density, area > 0 ? Math.sqrt(MAX_CANVAS_PX / area) : MAX_DPR);
  while (q > 0 && Math.ceil(box.w * q) * Math.ceil(box.h * q) > MAX_CANVAS_PX) q *= 0.9999;
  return q;
}

/* ------------------------------------------------------------------- what a wall holds ---- */

interface SrcStroke { readonly can: string; readonly cap: string; readonly aspect?: number; readonly points: readonly Pt[] }
/** A group of a live draw, as its Act gives it: what it is attached to now, its strokes in its own units, and the box it was drawn in. */
export interface GroupSrc {
  /** The draw's Act id, '' for a drawing with none (a draft). */
  readonly draw: string;
  /** Which draw of the wall it is, in order: the drawing key placement nudges within. */
  readonly act: number;
  /** The group's place in its draw. */
  readonly index: number;
  readonly legacy: boolean;
  readonly at: Pt;
  /** Where the group is attached in the post as it is now: the Act's `places` when it has them, else what it was drawn on; a box where it has fallen. */
  readonly anchor: Attachment;
  readonly unit: 'em' | 'image';
  readonly em?: number;
  readonly strokes: readonly SrcStroke[];
  /** The drawer's box in ems (a legacy group: its shares). */
  readonly frame: Box;
}

/** The name a group's mark carries, so a screen finds it again after layout. */
export const markKey = (g: { readonly act: number; readonly index: number }): string => `${g.act}.${g.index}`;

const isCan = (v: unknown): v is keyof typeof CANS => typeof v === 'string' && Object.hasOwn(CANS, v);
const isCap = (v: unknown): v is keyof typeof CAPS_EM => typeof v === 'string' && Object.hasOwn(CAPS_EM, v);
const pointsOf = (list: unknown): Pt[] | null => {
  if (!Array.isArray(list) || list.length < 1) return null;
  const out: Pt[] = [];
  for (const p of list) { if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return null; out.push([p[0], p[1]]); }
  return out;
};

/** The groups of the live draws of `acts`, in wall order (the draws as they stand, each one's groups in order). A malformed group or stroke is left out. */
export function groupsOf(acts: readonly WallAct[]): GroupSrc[] {
  const out: GroupSrc[] = [];
  acts.forEach((a, act) => {
    if (a.kind !== 'draw' || !record(a.payload)) return;
    const p = a.payload;
    const draw = a.id ?? '';
    if (Array.isArray(p.groups) && record(p.box) && finite(p.box.w) && finite(p.box.h) && p.box.w > 0 && p.box.h > 0) {
      const frame = { w: p.box.w, h: p.box.h };
      (p.groups as unknown[]).forEach((raw, index) => {
        if (!record(raw) || !Array.isArray(raw.at) || raw.at.length !== 2 || !finite(raw.at[0]) || !finite(raw.at[1]) || !record(raw.anchor) || typeof raw.anchor.kind !== 'string') return;
        const unit = raw.unit === 'image' ? 'image' : 'em';
        const strokes: SrcStroke[] = [];
        for (const s of Array.isArray(raw.strokes) ? raw.strokes : []) {
          if (!record(s) || !isCan(s.can) || !isCap(s.cap)) continue;
          const points = pointsOf(s.points);
          if (points) strokes.push({ can: s.can, cap: s.cap, points });
        }
        if (strokes.length === 0) return;
        let anchor = raw.anchor as unknown as Attachment;
        if (a.places) anchor = a.places.find((e) => e.grp === index)?.place ?? { kind: 'box' };
        out.push({ draw, act, index, legacy: false, at: [raw.at[0], raw.at[1]], anchor, unit, ...(unit === 'image' && finite(raw.em) ? { em: raw.em } : {}), strokes, frame });
      });
    } else if (Array.isArray(p.strokes)) {
      const strokes: SrcStroke[] = [];
      for (const s of p.strokes as unknown[]) {
        if (!record(s) || !isCan(s.can) || !isCap(s.cap) || !finite(s.aspect) || !(s.aspect > 0)) continue;
        const points = pointsOf(s.points);
        if (points) strokes.push({ can: s.can, cap: s.cap, aspect: s.aspect, points });
      }
      if (strokes.length > 0) out.push({ draw, act, index: 0, legacy: true, at: [0, 0], anchor: { kind: 'box' }, unit: 'em', strokes, frame: { w: 1, h: 1 } });
    }
  });
  return out;
}

/** A press as the wash keeps it: the draw it is on, its group, and its place in the group's own units (ems to a hundredth, image widths and shares to a ten-thousandth). */
export interface Press { readonly draw: string; readonly group: number; readonly u: number; readonly v: number }
/** This visit's presses on one group, in its units: replayed after the saved washes. */
export interface Chunk { readonly draw: string; readonly group: number; readonly presses: readonly (readonly [number, number])[] }
/** A sponge pass under way: where the last press went, and how far past it the next one is. */
export interface Walker { last: Pt | null; left: number }

/** What a wall is drawn against on this screen. `measured` finds where a group's attachment is: a text mark's left and line top, or an image's rect, in px of the box. */
export interface Layout {
  readonly box: Box;
  /** The size of the post's text, px. */
  readonly emPx: number;
  readonly measured?: (g: GroupSrc) => Measured | null;
}

/** A stroke in px of this screen: its points in real px, its brush radius across (down it is `r * k`, which is `r` but for a legacy draw's ellipse). */
interface PxStroke { readonly pts: readonly (readonly [number, number])[]; readonly r: number; readonly k: number; readonly ci: number; readonly seed: number; readonly lengthEms: number; readonly widthEms: number; readonly shares: boolean }

/** The stroke's own points, hashed (FNV-1a over each, to a hundredth of a unit) into a seed that is the same on every screen. */
function seedOf(points: readonly Pt[], scale: number): number {
  let h = 0x811c9dc5;
  for (const [x, y] of points) for (const n of [Math.round(x * scale), Math.round(y * scale)]) {
    h = Math.imul(h ^ (n & 0xffff), 0x01000193); h = Math.imul(h ^ ((n >> 16) & 0xffff), 0x01000193);
  }
  return h >>> 0;
}

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Where a group is on this screen: its origin, how much placement shrank it, and the px of one of its units before that. */
interface Spot { readonly x: number; readonly y: number; readonly scale: number; readonly unitPx: number }

/** One group's grid: coats, overspray and speckle over the group's own bounds on this screen. */
export class Field {
  /** Where the group's origin is on this screen, and how many px a unit of its is across and down. */
  readonly ox: number; readonly oy: number; readonly sx: number; readonly sy: number;
  /** How much placement shrank it (1 for a group that fits). */
  readonly scale: number;
  readonly draw: string; readonly group: number; readonly act: number; readonly legacy: boolean;
  /** The decimals a press in its units is kept to. */
  readonly keep: (n: number) => number;
  /** The cells' grid: the first cell's index across and down (a cell is `CELL` px), and its size. */
  readonly cx0: number; readonly cy0: number; readonly gw: number; readonly gh: number;
  readonly core: Float32Array; readonly halo: Float32Array; readonly dot: Float32Array;
  readonly coreColor: Uint8Array; readonly haloColor: Uint8Array; readonly touched: Uint8Array;
  readonly palette: [number, number, number][] = [];
  /** How many times a pass of this field was drawn into its bitmap: a repaint with nothing pressed adds none. */
  rasters = 0;
  /** What was done to the field since it was laid, as `Wall.of` would replay it: a press is `[0, x, y, radius]`, a legacy cut `[1, k, rw, margin, n, ...x, y]`. */
  readonly log: number[] = [];
  private readonly sprites: (HTMLCanvasElement | null)[] = [null, null];
  private readonly stale = [true, true];
  private readonly drawn = [false, false];

  /** Where a group's origin is on this screen, and how many px a unit of it is across and down. */
  static frameOf(src: GroupSrc, spot: Spot, box: Box): { ox: number; oy: number; sx: number; sy: number } {
    return src.legacy ? { ox: 0, oy: 0, sx: box.w, sy: box.h } : { ox: spot.x, oy: spot.y, sx: spot.unitPx * spot.scale, sy: spot.unitPx * spot.scale };
  }

  constructor(src: GroupSrc, spot: Spot, private readonly layout: Layout) {
    const { box } = layout;
    this.draw = src.draw; this.group = src.index; this.act = src.act; this.legacy = src.legacy; this.scale = spot.scale;
    ({ ox: this.ox, oy: this.oy, sx: this.sx, sy: this.sy } = Field.frameOf(src, spot, box));
    this.keep = src.legacy || src.unit !== 'em' ? round(4) : round(2);
    const em = src.unit === 'image' ? src.em ?? 1 : 1;
    const strokes: PxStroke[] = [];
    for (const s of src.strokes) {
      if (!isCan(s.can) || !isCap(s.cap)) continue;
      const rgb = rgbOf(CANS[s.can]);
      let ci = this.palette.findIndex((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]);
      if (ci < 0) { this.palette.push(rgb); ci = this.palette.length - 1; }
      if (src.legacy) {
        const k = (s.aspect! * box.h) / box.w;
        const pts = s.points.map(([x, y]): [number, number] => [x * box.w, y * box.h]);
        strokes.push({ pts, r: (CAPS[s.cap] * box.w) / 2, k, ci, seed: seedOf(s.points, 10_000), lengthEms: 0, widthEms: 0, shares: true });
      } else {
        const pts = s.points.map(([x, y]): [number, number] => [this.ox + x * this.sx, this.oy + y * this.sy]);
        let length = 0;
        for (let i = 1; i < s.points.length; i++) length += Math.hypot(s.points[i]![0] - s.points[i - 1]![0], s.points[i]![1] - s.points[i - 1]![1]);
        strokes.push({ pts, r: (CAPS_EM[s.cap] / 2 / em) * this.sx, k: 1, ci, seed: seedOf(s.points, 100), lengthEms: length * em, widthEms: CAPS_EM[s.cap], shares: false });
      }
    }
    /* The cells the paint can reach, held to the box. */
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of strokes) {
      const reach = s.r * REACHES + 1;
      for (const [x, y] of s.pts) { x0 = Math.min(x0, x - reach); x1 = Math.max(x1, x + reach); y0 = Math.min(y0, y - reach * s.k); y1 = Math.max(y1, y + reach * s.k); }
    }
    if (x0 === Infinity) [x0, y0, x1, y1] = [0, 0, -1, -1];
    this.cx0 = Math.max(0, Math.floor(x0 / CELL)); this.cy0 = Math.max(0, Math.floor(y0 / CELL));
    const cx1 = Math.min(Math.ceil(box.w / CELL) - 1, Math.ceil(x1 / CELL)), cy1 = Math.min(Math.ceil(box.h / CELL) - 1, Math.ceil(y1 / CELL));
    this.gw = Math.max(0, cx1 - this.cx0 + 1); this.gh = Math.max(0, cy1 - this.cy0 + 1);
    const n = this.gw * this.gh;
    this.core = new Float32Array(n); this.halo = new Float32Array(n); this.dot = new Float32Array(n);
    this.coreColor = new Uint8Array(n); this.haloColor = new Uint8Array(n); this.touched = new Uint8Array(n);
    if (n > 0) for (const s of strokes) this.lay(s);
  }

  /** How many cells the field holds. */
  get cells(): number { return this.gw * this.gh; }

  /** The index of the cell holding the px point, or -1 outside the field. */
  private at(x: number, y: number): number {
    const cx = Math.floor(x / CELL) - this.cx0, cy = Math.floor(y / CELL) - this.cy0;
    return cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh ? -1 : cy * this.gw + cx;
  }

  /** The tenths of a coat the core holds at a px point (0 where clean or outside). */
  coatsAt(x: number, y: number): number { const i = this.at(x, y); return i < 0 ? 0 : Math.round(this.core[i]! * 100) / 100; }
  /** Whether the point is inked: the core holds `CLEAN` tenths or more there. */
  inked(x: number, y: number): boolean { const i = this.at(x, y); return i >= 0 && this.core[i]! >= CLEAN; }
  /** Whether any cell is inked. */
  inkedAny(): boolean { for (const v of this.core) if (v >= CLEAN) return true; return false; }
  /** Whether an inked cell lies within `r` px of the point. */
  inkedNear(x: number, y: number, r: number): boolean {
    const x0 = Math.max(this.cx0, Math.floor((x - r) / CELL)), x1 = Math.min(this.cx0 + this.gw - 1, Math.floor((x + r) / CELL));
    const y0 = Math.max(this.cy0, Math.floor((y - r) / CELL)), y1 = Math.min(this.cy0 + this.gh - 1, Math.floor((y + r) / CELL));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (this.core[(cy - this.cy0) * this.gw + cx - this.cx0]! < CLEAN) continue;
      if (Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y) <= r) return true;
    }
    return false;
  }
  /** The px extent across of the inked cells in a band of rows (px, top to bottom), or null. */
  spanOf(top: number, bottom: number): [number, number] | null {
    const y0 = Math.max(this.cy0, Math.floor(top / CELL)), y1 = Math.min(this.cy0 + this.gh - 1, Math.floor(bottom / CELL));
    let lo = Infinity, hi = -Infinity;
    for (let cy = y0; cy <= y1; cy++) for (let cx = 0; cx < this.gw; cx++) {
      if (this.core[(cy - this.cy0) * this.gw + cx]! < CLEAN) continue;
      lo = Math.min(lo, (cx + this.cx0) * CELL); hi = Math.max(hi, (cx + this.cx0 + 1) * CELL);
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /** Lays one stroke: the cells its core covers take `COATS.line` tenths once, the overspray and the speckle go beside them. */
  private lay(s: PxStroke): void {
    const { pts, r, k, ci } = s;
    const reach = r * OVERSPRAY.reach;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const sx0 = Math.max(this.cx0, Math.floor((Math.min(...xs) - reach) / CELL)), sx1 = Math.min(this.cx0 + this.gw - 1, Math.ceil((Math.max(...xs) + reach) / CELL));
    const sy0 = Math.max(this.cy0, Math.floor((Math.min(...ys) - reach * k) / CELL)), sy1 = Math.min(this.cy0 + this.gh - 1, Math.ceil((Math.max(...ys) + reach * k) / CELL));
    if (sx1 >= sx0 && sy1 >= sy0) {
      const w = sx1 - sx0 + 1, mask = new Uint8Array(w * (sy1 - sy0 + 1)), over = new Float32Array(mask.length);
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[Math.max(0, i - 1)]!, [bx, by] = pts[i]!;
        const x0 = Math.max(sx0, Math.floor((Math.min(ax, bx) - reach) / CELL)), x1 = Math.min(sx1, Math.ceil((Math.max(ax, bx) + reach) / CELL));
        const y0 = Math.max(sy0, Math.floor((Math.min(ay, by) - reach * k) / CELL)), y1 = Math.min(sy1, Math.ceil((Math.max(ay, by) + reach * k) / CELL));
        const dx = bx - ax, dy = (by - ay) / k, l2 = dx * dx + dy * dy;
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          const px = (cx + 0.5) * CELL, py = ((cy + 0.5) * CELL) / k;
          let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay / k) * dy) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + t * dx - px, ay / k + t * dy - py), j = (cy - sy0) * w + cx - sx0;
          if (d <= r) mask[j] = 1;
          else if (d < reach) { const f = 1 - (d - r) / (reach - r); over[j] = Math.max(over[j]!, COATS.line * f * f); }
        }
      }
      for (let j = 0; j < mask.length; j++) {
        const i = (Math.floor(j / w) + sy0 - this.cy0) * this.gw + (j % w) + sx0 - this.cx0;
        if (mask[j]) { this.core[i] = Math.min(COATS.most, this.core[i]! + COATS.line); this.coreColor[i] = ci; }
        else if (over[j]! > this.halo[i]!) { this.halo[i] = over[j]!; this.haloColor[i] = ci; }
      }
    }
    this.speckle(s);
  }

  /** The speckle: dots past the overspray, from the stroke's own seed, so every screen has the same ones. */
  private speckle(s: PxStroke): void {
    const { pts, r, k } = s;
    const along: number[] = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], (pts[i]![1] - pts[i - 1]![1]) / k));
    const length = along.at(-1)!;
    const { w } = this.layout.box;
    const count = s.shares
      ? Math.min(MOST_SPECKLES, Math.round((length / w + (2 * r) / w) * ((2 * r) / w) * SPECKLE_DENSITY))
      : Math.min(MOST_SPECKLES, Math.round((s.lengthEms / DENSITY_EMS + s.widthEms / DENSITY_EMS) * (s.widthEms / DENSITY_EMS) * SPECKLE_DENSITY));
    const rng = mulberry32(s.seed);
    for (let n = 0; n < count; n++) {
      const t = rng() * length, side = rng() < 0.5 ? 0 : Math.PI, jitter = (rng() - 0.5) * SPECKLE_FAR.tilt * 2, far = SPECKLE_FAR.from + rng() * SPECKLE_FAR.span;
      rng();
      const free = rng() * Math.PI * 2;
      let lo = 1, hi = pts.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (along[mid]! < t) lo = mid + 1; else hi = mid; }
      const i = Math.min(lo, pts.length - 1);
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!;
      const span = i > 0 ? along[i]! - along[i - 1]! : 0;
      const f = span > 0 ? Math.min(1, Math.max(0, (t - along[i - 1]!) / span)) : 0;
      const cx = p0[0] + (p1[0] - p0[0]) * f, cy = (p0[1] + (p1[1] - p0[1]) * f) / k;
      const flat = length === 0 || (p0[0] === p1[0] && p0[1] === p1[1]);
      const angle = flat ? free : Math.atan2((p1[1] - p0[1]) / k, p1[0] - p0[0]) + Math.PI / 2 + side + jitter;
      const dist = (r * far) / (flat ? 1 : Math.cos(jitter));
      const at = this.at(cx + Math.cos(angle) * dist, (cy + Math.sin(angle) * dist) * k);
      if (at >= 0 && COATS.line > this.dot[at]!) { this.dot[at] = COATS.line; this.haloColor[at] = s.ci; }
    }
  }

  /** One press: a disc of the sponge over the field, at a px point. */
  disc(x: number, y: number, radius: number): void {
    this.log.push(0, x, y, radius);
    const R = 2 * radius;
    let changed = false;
    const x0 = Math.max(this.cx0, Math.floor((x - R) / CELL)), x1 = Math.min(this.cx0 + this.gw - 1, Math.floor((x + R) / CELL));
    const y0 = Math.max(this.cy0, Math.floor((y - R) / CELL)), y1 = Math.min(this.cy0 + this.gh - 1, Math.floor((y + R) / CELL));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + 0.5) * CELL - x, dy = (cy + 0.5) * CELL - y, q = 1 - (dx * dx + dy * dy) / (R * R);
      if (q <= 0) continue;
      const i = (cy - this.cy0) * this.gw + cx - this.cx0, amount = PRESS_TENTHS * q * q * q;
      if (this.halo[i]! > 0) { this.halo[i] = Math.max(0, this.halo[i]! - amount); changed = true; }
      if (this.dot[i]! > 0) { this.dot[i] = Math.max(0, this.dot[i]! - amount); changed = true; }
      const v = this.core[i]!;
      if (v <= 0) continue;
      this.core[i] = v - amount < CLEAN ? 0 : v - amount;
      this.touched[i] = 1;
      changed = true;
    }
    if (changed) this.stale[0] = this.stale[1] = true;
  }

  /** Replays what `log` holds, in order: the presses and cuts a wall is built from. */
  apply(ops: readonly number[]): void {
    for (let i = 0; i < ops.length;) {
      if (ops[i] === 0) { this.disc(ops[i + 1]!, ops[i + 2]!, ops[i + 3]!); i += 4; continue; }
      const n = ops[i + 4]!, pts: [number, number][] = [];
      for (let j = 0; j < n; j++) pts.push([ops[i + 5 + 2 * j]!, ops[i + 6 + 2 * j]!]);
      this.cut(pts, ops[i + 1]!, ops[i + 2]!, ops[i + 3]!);
      i += 5 + 2 * n;
    }
  }

  /** An instant cut (a legacy wash), along a polyline in real px whose y is divided by `k` in the brush's space: the core within `rw`, the halo and speckle within `rw + margin`. */
  cut(pts: readonly (readonly [number, number])[], k: number, rw: number, margin: number): void {
    this.log.push(1, k, rw, margin, pts.length);
    for (const [x, y] of pts) this.log.push(x, y);
    this.stale[0] = this.stale[1] = true;
    const reach = rw + margin;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[Math.max(0, i - 1)]!, [bx, by] = pts[i]!;
      const x0 = Math.max(this.cx0, Math.floor((Math.min(ax, bx) - reach) / CELL)), x1 = Math.min(this.cx0 + this.gw - 1, Math.ceil((Math.max(ax, bx) + reach) / CELL));
      const y0 = Math.max(this.cy0, Math.floor((Math.min(ay, by) - reach * k) / CELL)), y1 = Math.min(this.cy0 + this.gh - 1, Math.ceil((Math.max(ay, by) + reach * k) / CELL));
      const dx = bx - ax, dy = (by - ay) / k, l2 = dx * dx + dy * dy;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const px = (cx + 0.5) * CELL, py = ((cy + 0.5) * CELL) / k;
        let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay / k) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + t * dx - px, ay / k + t * dy - py), j = (cy - this.cy0) * this.gw + cx - this.cx0;
        if (d <= rw) { this.core[j] = 0; this.halo[j] = 0; this.dot[j] = 0; } else if (d <= reach && this.core[j]! < CLEAN) { this.halo[j] = 0; this.dot[j] = 0; }
      }
    }
  }

  /** The core's alpha at a cell: the can's coat, thinned once a press has touched it. */
  coreAlpha(i: number): number {
    const v = this.core[i]!;
    if (v < CLEAN) return 0;
    return this.touched[i] ? CORE_ALPHA * Math.min(1, 0.35 + (0.65 * (v - CLEAN)) / 10) : CORE_ALPHA;
  }
  /** The overspray's and speckle's alpha at a cell: seen only where the core is clean. */
  haloAlpha(i: number): number {
    if (this.core[i]! >= CLEAN) return 0;
    const a = OVERSPRAY.alpha * Math.min(1, this.halo[i]! / COATS.line), b = SPECKLE_ALPHA * Math.min(1, this.dot[i]! / COATS.line);
    return 1 - (1 - a) * (1 - b);
  }

  /** Draws a pass of the field (its halos, or its cores) onto `ctx` at the field's own bounds, a cell `CELL` px: from its bitmap, which is drawn again only if the field changed since. */
  drawTo(ctx: CanvasRenderingContext2D, halos: boolean): void {
    const p = halos ? 0 : 1;
    if (this.stale[p]) { this.drawn[p] = this.raster(halos, p); this.stale[p] = false; }
    const sprite = this.sprites[p];
    if (this.drawn[p] && sprite) ctx.drawImage(sprite, this.cx0 * CELL, this.cy0 * CELL, this.gw * CELL, this.gh * CELL);
  }

  /** Draws pass `p` into its bitmap, a cell to a pixel; whether it holds any paint. */
  private raster(halos: boolean, p: number): boolean {
    this.rasters += 1;
    if (this.gw === 0 || this.gh === 0) return false;
    const cv = (this.sprites[p] ??= document.createElement('canvas'));
    if (cv.width !== this.gw) cv.width = this.gw;
    if (cv.height !== this.gh) cv.height = this.gh;
    const g = cv.getContext('2d');
    if (!g) return false;
    const img = g.createImageData(this.gw, this.gh);
    let any = false;
    for (let i = 0; i < this.gw * this.gh; i++) {
      const a = halos ? this.haloAlpha(i) : this.coreAlpha(i);
      if (a <= 0.004) continue;
      const [r, gr, b] = this.palette[halos ? this.haloColor[i]! : this.coreColor[i]!] ?? [0, 0, 0];
      img.data[i * 4] = r; img.data[i * 4 + 1] = gr; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = Math.round(a * 255);
      any = true;
    }
    if (any) g.putImageData(img, 0, 0);
    return any;
  }
}

/** The px a unit of a group is on this screen before its scale: an em, or the width of the image it is attached to (an image group fallen to the box keeps the ems a width was). */
const unitPx = (src: GroupSrc, m: Measured | null, emPx: number): number =>
  src.unit === 'image' && src.anchor.kind === 'image' && m?.kind === 'rect' && finite(m.w) ? m.w : src.unit === 'em' ? emPx : (src.em ?? 1) * emPx;

/** The brush radius of a stroke in its group's units: half its cap in ems, over an image group's ems to a unit. */
const rOf = (src: GroupSrc, cap: string): number => (isCap(cap) ? CAPS_EM[cap] / 2 / (src.unit === 'image' ? src.em ?? 1 : 1) : 0);

/** Where each group lands on this screen: `placeGroups` over the draws' groups, each draw a drawing of its own. A legacy group is in its shares and is not placed. */
function placements(srcs: readonly GroupSrc[], layout: Layout): Spot[] {
  const real = srcs.filter((s) => !s.legacy);
  const ms = real.map((s) => layout.measured?.(s) ?? null);
  const groups: PlaceGroup[] = real.map((s) => ({
    drawing: `${s.act}`, at: s.at, anchor: s.anchor, unit: s.unit, ...(s.em !== undefined ? { em: s.em } : {}),
    strokes: s.strokes.map((st) => ({ points: st.points, r: rOf(s, st.cap) })), frame: s.frame,
  }));
  const put = layout.emPx > 0 && validBox(layout.box) ? placeGroups(groups, ms, layout.box, layout.emPx) : real.map(() => ({ x: 0, y: 0, scale: 1 }));
  let at = 0;
  return srcs.map((s): Spot => {
    if (s.legacy) return { x: 0, y: 0, scale: 1, unitPx: 1 };
    const p = put[at]!, m = ms[at]!;
    at++;
    return { ...p, unitPx: unitPx(s, m, layout.emPx) };
  });
}

/* --------------------------------------------------------------------------- the wall ---- */

/** A number mixed into two 32-bit hashes, which are a field's fingerprint (a draw's strokes are fixed by its id, but a test or a draft may reuse an id). */
function fingerprint(src: GroupSrc): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mix = (n: number) => { h1 = Math.imul(h1 ^ (n & 0xffff), 0x01000193); h1 = Math.imul(h1 ^ ((n >> 16) & 0xffff), 0x01000193); h2 = Math.imul(h2 + n | 0, 0x85ebca6b) ^ (h2 >>> 13); };
  for (const s of src.strokes) {
    for (const ch of `${s.can}/${s.cap}`) mix(ch.charCodeAt(0));
    mix(s.aspect === undefined ? -1 : Math.round(s.aspect * 10_000));
    for (const [x, y] of s.points) { mix(Math.round(x * 10_000)); mix(Math.round(y * 10_000)); }
    mix(-2);
  }
  for (const n of [src.at[0], src.at[1], src.em ?? 0, src.frame.w, src.frame.h]) mix(Math.round(n * 10_000));
  return `${h1 >>> 0}.${h2 >>> 0}`;
}

/** What a field is laid from: the group, where it is placed, the box it is clipped to and the text size. A field with the same key and the same washes is the same field. */
function keyOf(src: GroupSrc, spot: Spot, layout: Layout): string | null {
  if (src.draw === '') return null;
  return [src.draw, src.index, src.act, src.legacy ? 1 : 0, spot.x, spot.y, spot.scale, spot.unitPx, layout.box.w, layout.box.h, layout.emPx, fingerprint(src)].join('|');
}

/** The farthest a press reaches to find paint to take from, past its sponge's radius, in px: a band of the sweep and a cell it reports (`bandHalf`). */
const BAND_REACH = ROW_PX / 2 + 2 * CELL;

const sameLog = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The wall as one screen holds it: a field for each group of each live draw, in wall order, with the saved washes and this visit's presses replayed. */
export class Wall {
  readonly groups: readonly Field[];
  /** The sponge's radius, px: `SPONGE_EM / 2` ems of this screen's text. */
  readonly spongePx: number;
  /** A group's sponge radius, px: the screen's, or for a legacy group `SPONGE / 2` of the box's width, as the server takes it. */
  radiusOf(f: Field): number { return f.legacy ? (SPONGE / 2) * this.layout.box.w : this.spongePx; }
  /** How far from its center a press looks for paint to take from when there is none under it, px: the sponge's radius, or a little more where that is less than a sweep's band is deep (a legacy group on a narrow box), so every band the sweep reports has a press that reaches it. */
  reachOf(f: Field): number { const r = this.radiusOf(f); return Math.max(r, Math.min(BAND_REACH, 1.5 * r)); }
  /** Half the depth of a sweep's band, px: `ROW_PX / 2`, or less where a press cannot reach the farthest cell `spanOf` reports in a band that deep. */
  bandHalf(): number {
    let half = ROW_PX / 2;
    for (const f of this.groups) {
      const r = this.radiusOf(f), reach = this.reachOf(f);
      /* A cell is reported when its extent touches the band: its center is up to half a cell past it, and a press is up to a sixth of a radius, and half a cell, from the cell's center along the band. */
      const along = r / (2 * PRESSES_PER_RADIUS) + CELL / 2;
      half = Math.min(half, Math.sqrt(Math.max(0, reach * reach - along * along)) - CELL / 2);
    }
    return Math.max(CELL, half);
  }
  private readonly byKey = new Map<string, Field>();
  private draft: { readonly act: WallAct; readonly fields: Field[] } | null = null;

  private constructor(readonly layout: Layout, groups: Field[], private readonly keys: readonly (string | null)[]) {
    this.groups = groups;
    this.spongePx = (SPONGE_EM / 2) * layout.emPx;
    for (const f of groups) this.byKey.set(`${f.draw}/${f.group}`, f);
  }

  /**
   * The fields of `acts` against a layout, with the saved washes among them and then `chunks` replayed. Built over `prev` (the wall of the same post before), each of
   * its fields whose group, placement, box, text size and washes are the same is kept as it is, with its bitmaps; the others are laid again.
   */
  static of(acts: readonly WallAct[], layout: Layout, chunks: readonly Chunk[] = [], prev: Wall | null = null): Wall {
    const srcs = groupsOf(acts);
    const spots = placements(srcs, layout);
    const frames = srcs.map((s, i) => Field.frameOf(s, spots[i]!, layout.box));
    const radius = (i: number) => (srcs[i]!.legacy ? (SPONGE / 2) * layout.box.w : (SPONGE_EM / 2) * layout.emPx);
    const index = new Map<string, number>();
    srcs.forEach((s, i) => index.set(`${s.draw}/${s.index}`, i));
    const logs = srcs.map(() => [] as number[]);
    const presses = (draw: string, group: number, list: readonly (readonly [number, number])[]) => {
      const i = index.get(`${draw}/${group}`);
      if (i === undefined) return;
      const f = frames[i]!, r = radius(i);
      for (const [u, v] of list) logs[i]!.push(0, f.ox + u * f.sx, f.oy + v * f.sy, r);
    };
    acts.forEach((a, at) => {
      if (a.kind !== 'wash' || !record(a.payload)) return;
      const p = a.payload;
      if (Array.isArray(p.cuts)) {
        for (const c of p.cuts as unknown[]) {
          if (!record(c) || typeof c.draw !== 'string' || !finite(c.group)) continue;
          const list = pointsOf(c.presses);
          if (list) presses(c.draw, c.group, list);
        }
      } else if (Array.isArray(p.strokes)) {
        /* A wash from before groups: an instant cut, at its old width, of the older draws that were drawn in shares. */
        const { box } = layout;
        for (const s of p.strokes as unknown[]) {
          if (!record(s) || !finite(s.aspect) || !(s.aspect > 0)) continue;
          const points = pointsOf(s.points);
          if (!points) continue;
          const k = (s.aspect * box.h) / box.w, rw = (OLD_SPONGE * box.w) / 2;
          const margin = ((CAPS.fat * box.w) / 2) * REACHES + 1;
          srcs.forEach((g, i) => {
            if (!g.legacy || g.act >= at) return;
            logs[i]!.push(1, k, rw, margin, points.length);
            for (const [x, y] of points) logs[i]!.push(x * box.w, y * box.h);
          });
        }
      }
    });
    for (const c of chunks) presses(c.draw, c.group, c.presses);
    const keys = srcs.map((s, i) => keyOf(s, spots[i]!, layout));
    const fields = srcs.map((s, i) => {
      const was = keys[i] === null ? undefined : prev?.fieldOf(keys[i]!);
      if (was && sameLog(was.log, logs[i]!)) return was;
      const f = new Field(s, spots[i]!, layout);
      f.apply(logs[i]!);
      return f;
    });
    return new Wall(layout, fields, keys);
  }

  /** The field laid from a key, if this wall has one. */
  private fieldOf(key: string): Field | undefined {
    const at = this.keys.indexOf(key);
    return at < 0 ? undefined : this.groups[at];
  }

  /** The fields of a drawing painted but not part of the wall (a draft): placed like any, never hit and never pressed. */
  fieldsOf(acts: readonly WallAct[]): Field[] {
    const srcs = groupsOf(acts);
    const spots = placements(srcs, this.layout);
    return srcs.map((s, i) => new Field(s, spots[i]!, this.layout));
  }

  /** Whether the wall has paint under the point: some group's core holds `CLEAN` tenths there. */
  hitAt(x: number, y: number): boolean {
    for (let i = this.groups.length - 1; i >= 0; i--) if (this.groups[i]!.inked(x, y)) return true;
    return false;
  }
  /** Whether any group still has paint. */
  anyPaint(): boolean { return this.groups.some((f) => f.inkedAny()); }
  /** Where, across, the wall still has paint in a band of rows (px): the union of the groups', or null. */
  spanOf(top: number, bottom: number): [number, number] | null {
    let lo = Infinity, hi = -Infinity;
    for (const f of this.groups) { const s = f.spanOf(top, bottom); if (s) { lo = Math.min(lo, s[0]); hi = Math.max(hi, s[1]); } }
    return lo <= hi ? [lo, hi] : null;
  }

  /** The top group a press at a px point goes to: the topmost with paint under the point, else the topmost with paint within the press's reach (`reachOf`). */
  topAt(x: number, y: number): Field | null {
    for (let i = this.groups.length - 1; i >= 0; i--) if (this.groups[i]!.inked(x, y)) return this.groups[i]!;
    for (let i = this.groups.length - 1; i >= 0; i--) if (this.groups[i]!.inkedNear(x, y, this.reachOf(this.groups[i]!))) return this.groups[i]!;
    return null;
  }

  /** One press of the sponge at a px point: it thins the top group with paint there, and says what it took in that group's units; null when there was none. */
  press(x: number, y: number): Press | null { return this.pressed(x, y)?.press ?? null; }

  private pressed(x: number, y: number): { press: Press; r: number } | null {
    const f = this.topAt(x, y);
    if (!f) return null;
    const r = this.radiusOf(f);
    f.disc(x, y, r);
    return { press: { draw: f.draw, group: f.group, u: f.keep((x - f.ox) / f.sx), v: f.keep((y - f.oy) / f.sy) }, r };
  }

  /** A sponge pass: presses every third of the radius along the way from the last point to `to` (the first press at the first point); a press on a legacy group is spaced by that group's radius. */
  walk(w: Walker, to: Pt): Press[] {
    const out: Press[] = [];
    let step = this.spongePx / PRESSES_PER_RADIUS;
    const take = (p: Pt) => { const made = this.pressed(p[0], p[1]); if (made) { out.push(made.press); step = made.r / PRESSES_PER_RADIUS; } return step; };
    if (!w.last) { w.left = take(to); w.last = to; return out; }
    const [ax, ay] = w.last, len = Math.hypot(to[0] - ax, to[1] - ay);
    let d = w.left;
    while (d <= len) { const t = d / len; d += take([ax + t * (to[0] - ax), ay + t * (to[1] - ay)]); }
    w.left = d - len; w.last = to;
    return out;
  }

  /** Paints the wall's fields, and a draft's after them, onto `ctx` (density `q`, set by the caller): the halos of all, then the cores in wall order. Each field is drawn from its bitmap, laid again only if it changed. */
  paint(ctx: CanvasRenderingContext2D, q: number, draft: WallAct | null = null): void {
    const { box } = this.layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!validBox(box) || !(ctx.canvas.width > 0 && ctx.canvas.height > 0) || !(q > 0)) return;
    if (draft && this.draft?.act !== draft) this.draft = { act: draft, fields: this.fieldsOf([draft]) };
    const fields = draft ? [...this.groups, ...this.draft!.fields] : this.groups;
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.imageSmoothingEnabled = true;
    for (const halos of [true, false]) for (const f of fields) f.drawTo(ctx, halos);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Walls kept by the acts array they were built for, for a caller (a draft's painter, a test) with acts and no wall of its own. */
const made = new WeakMap<object, { key: string; wall: Wall }>();
function wallFor(acts: readonly WallAct[], box: Box, emPx: number): Wall {
  const key = `${box.w}x${box.h}@${emPx}`, had = made.get(acts);
  if (had && had.key === key) return had.wall;
  const wall = Wall.of(acts, { box, emPx });
  made.set(acts, { key, wall });
  return wall;
}

/** The size of the post's text a caller with no measure of its own assumes, px: the board's. */
export const DEFAULT_EM_PX = 15;

/**
 * Paints a wall on `ctx`'s canvas, whose pixels are ceil(box.w * q) by ceil(box.h * q) for q = `wallDensity` (set by the caller), in CSS px of the box:
 * a `Wall` the caller keeps, or the acts of one (built here at the board's text size, each group at its spot). A draft is drawn after it, as no ink of
 * the wall's. A box with no area draws nothing, and what was drawn before is cleared.
 */
export function paintWall(ctx: CanvasRenderingContext2D, box: Box, density: number, wall: Wall | readonly WallAct[], draft: WallAct | null = null): void {
  const w = wall instanceof Wall ? wall : validBox(box) ? wallFor(wall, box, DEFAULT_EM_PX) : null;
  if (!w || !validBox(box)) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); return; }
  w.paint(ctx, wallDensity(box, density), draft);
}

/** Whether any ink lies under the point (CSS px of the box): in some group's core. Overspray and speckle are not ink. */
export function hitAt(wall: Wall | readonly WallAct[], box: Box, x: number, y: number): boolean {
  if (wall instanceof Wall) return wall.hitAt(x, y);
  return validBox(box) ? wallFor(wall, box, DEFAULT_EM_PX).hitAt(x, y) : false;
}
