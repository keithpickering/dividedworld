/**
 * Whoops!'s scrubbing, the pure half of its drawing (design section 11; cards plan Task 5): the fixed
 * layout's arithmetic, what a layer's ink is after the strokes on it, which layer a stroke scrubs, the
 * bounds a saved stroke keeps to, the accessible sweep's pace, and which lines of text lie under ink.
 * No DOM and no canvas: `Effect.tsx` draws what this decides, and every rule here is testable in Node.
 *
 * Everything is in widths of the post's fixed layout (`REF_WIDTH` px wide, scaled as a whole to the
 * screen), the unit the card's strokes are kept in (whoops.ts), so a stroke lands on the same words
 * at every screen width and survives an edit. A layer's ink is the seeded splat (splat.ts) less the
 * washed strokes on it; "does this point still have ink" is geometry (the splat's outline, and the
 * distance to a wash's path), never a read of pixels, so the answer is the same on every screen and
 * costs no canvas.
 */
import { STROKES } from '../whoops.ts';
import { covers, type Splat } from './splat.ts';

/** The width the post's body is laid out at, in px, whatever the screen: lines break in the same places everywhere. */
export const REF_WIDTH = 360;
/** How far the layout may grow: not at all (#76). A splatted post keeps the board's 12px type in its 360px column on a wide screen, centered, the ink free to run into the margins, and is scaled down on a narrow one. */
export const MAX_SCALE = 1;
/** The wash's brush and the author's pen, in widths. */
export const BRUSH = 0.045;
export const PEN = BRUSH * 0.3;
/** A line of the post's text, in widths (18px at the reference width): the accessible sweep's band. */
export const ROW = 0.05;
/** The accessible sweep's pace, in widths a second: about a hand's. */
export const SWEEP_SPEED = 0.55;
/** The sweep's brush: a little over its band, so the bands leave no sliver between them. */
export const SWEEP_BRUSH = ROW * 1.15;

export type Pt = readonly [number, number];
export type Stroke =
  | { readonly tool: 'wash'; readonly width: number; readonly points: readonly Pt[] }
  | { readonly tool: 'ink'; readonly color: string; readonly width: number; readonly points: readonly Pt[] };

/** The layout in a frame `frame` px wide: its scale, its width in px and how far in from the frame's left it starts. */
export function layoutOf(frame: number): { readonly scale: number; readonly width: number; readonly offset: number } {
  const scale = Math.min(MAX_SCALE, frame / REF_WIDTH);
  const width = REF_WIDTH * scale;
  return { scale, width, offset: (frame - width) / 2 };
}

/** A point in px from the frame's top left, in widths of the layout. */
export function toLayout([px, py]: Pt, frame: number): Pt {
  const { width, offset } = layoutOf(frame);
  return [(px - offset) / width, py / width];
}

/* ------------------------------------------------------------------ what a stroke may be ---- */

const thousandth = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Points closer than this to the one before are dropped: a drag reports far more than a path needs, and a layer's points are bounded. */
const MIN_STEP = 0.008;

/**
 * A stroke as the card keeps it: points held to the layout (across 0 to 1, down 0 to `STROKES.deepest`), to a
 * thousandth, thinned of the ones that add nothing, and cut into strokes of at most `STROKES.points` points
 * (each starting on the point the last ended on, so a long drag is one unbroken line).
 */
export function fitStroke(stroke: Stroke): Stroke[] {
  const kept: Pt[] = [];
  for (const [x, y] of stroke.points) {
    const p: Pt = [thousandth(clamp(x, 0, 1)), thousandth(clamp(y, 0, STROKES.deepest))];
    const last = kept[kept.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) continue;
    kept.push(p);
  }
  const lastIn = stroke.points[stroke.points.length - 1];
  if (kept.length === 0 && lastIn) kept.push([thousandth(clamp(lastIn[0], 0, 1)), thousandth(clamp(lastIn[1], 0, STROKES.deepest))]);
  const width = thousandth(clamp(stroke.width, 0.001, STROKES.widest));
  const out: Stroke[] = [];
  for (let at = 0; at < kept.length || at === 0; at += STROKES.points - 1) {
    const points = kept.slice(at, at + STROKES.points);
    out.push(stroke.tool === 'ink' ? { tool: 'ink', color: stroke.color, width, points } : { tool: 'wash', width, points });
    if (at + STROKES.points >= kept.length) break;
  }
  return out;
}

/** Whether a layer's strokes are within the card's counts, so a save of them is kept. */
export function fits(strokes: readonly Stroke[]): boolean {
  return strokes.length <= STROKES.most && strokes.reduce((n, s) => n + s.points.length, 0) <= STROKES.totalPoints;
}

/* --------------------------------------------------------------------- a layer's ink ---- */

/** The spacing of the points a layer's remaining ink is counted at, in widths. */
const CELL = 0.02;

/** Squared distance from (px, py) to the segment a-b. */
function segment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** A rectangle in widths of the layout. */
export interface Region { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }

/**
 * One layer: its splat less the washes on it. `has` asks whether a point still has ink (the splat's
 * outline, and the distance to each wash's path); `washed` is the share of the splat washed away, counted
 * at a grid of points inside it, kept as washes are added so a stroke costs the cells it passes.
 *
 * `region` is where a stroke can reach: the post's own box. The ink runs past it into the margins (and a
 * stroke is kept to across 0 to 1 and down the post), so ink out there can never be washed; counting it
 * would leave a layer short of clean for good. Only the ink inside the region is counted and swept.
 */
export class LayerInk {
  readonly splat: Splat;
  /** Each wash as a segment and its radius: ax, ay, bx, by, r. */
  private readonly segments: [number, number, number, number, number][] = [];
  private readonly nx: number;
  private readonly ny: number;
  private readonly alive: Uint8Array;
  private left = 0;
  private total = 0;

  constructor(splat: Splat, strokes: readonly Stroke[], region?: Region) {
    this.splat = splat;
    const { minX, maxX, minY, maxY } = splat.bounds;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / CELL));
    this.ny = Math.max(1, Math.ceil((maxY - minY) / CELL));
    this.alive = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = minX + (i + 0.5) * CELL, y = minY + (j + 0.5) * CELL;
        if ((!region || (x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY)) && covers(splat, x, y)) {
          this.alive[j * this.nx + i] = 1;
          this.total++;
        }
      }
    }
    this.left = this.total;
    for (const s of strokes) if (s.tool === 'wash') this.wash(s.points, s.width);
  }

  /** Whether a point still has ink on this layer. */
  has(x: number, y: number): boolean {
    if (!covers(this.splat, x, y)) return false;
    for (const [ax, ay, bx, by, r] of this.segments) {
      if (x < Math.min(ax, bx) - r || x > Math.max(ax, bx) + r || y < Math.min(ay, by) - r || y > Math.max(ay, by) + r) continue;
      if (segment2(x, y, ax, ay, bx, by) <= r * r) return false;
    }
    return true;
  }

  /** A brush of `width` passing through `points` washes the ink under it; one point washes a round dab. */
  wash(points: readonly Pt[], width: number): void {
    const r = width / 2;
    const { minX, minY } = this.splat.bounds;
    for (let k = 0; k < Math.max(1, points.length - 1); k++) {
      const [ax, ay] = points[k]!;
      const [bx, by] = points[k + 1] ?? points[k]!;
      this.segments.push([ax, ay, bx, by, r]);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - minX) / CELL));
      const i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx) + r - minX) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - minY) / CELL));
      const j1 = Math.min(this.ny - 1, Math.floor((Math.max(ay, by) + r - minY) / CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const at = j * this.nx + i;
          if (!this.alive[at]) continue;
          if (segment2(minX + (i + 0.5) * CELL, minY + (j + 0.5) * CELL, ax, ay, bx, by) <= r * r) {
            this.alive[at] = 0;
            this.left--;
          }
        }
      }
    }
  }

  /** The share of the splat washed away, 0 to 1 (a splat with no area is already clean). */
  get washed(): number {
    return this.total === 0 ? 1 : 1 - this.left / this.total;
  }

  /** The cells of the grid in the band y ± half that still hold ink: their left and right edges, or null with none. */
  inkSpan(y: number, half: number): readonly [number, number] | null {
    const { minX, minY } = this.splat.bounds;
    const j0 = Math.max(0, Math.floor((y - half - minY) / CELL));
    const j1 = Math.min(this.ny - 1, Math.floor((y + half - minY) / CELL));
    let lo = Infinity, hi = -Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (this.alive[j * this.nx + i]) {
          lo = Math.min(lo, minX + i * CELL);
          hi = Math.max(hi, minX + (i + 1) * CELL);
        }
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /** Whether any ink is left in the band y ± half. */
  inkNear(y: number, half: number): boolean {
    return this.inkSpan(y, half) !== null;
  }
}

/**
 * Which layer a stroke starting at (x, y) scrubs: the top one that still has ink there, or -1. `inks` are in play
 * order, the latest last; a layer that is washed clean is null and is not there.
 */
export function topLayer(inks: readonly (LayerInk | null)[], x: number, y: number): number {
  for (let i = inks.length - 1; i >= 0; i--) if (inks[i]?.has(x, y)) return i;
  return -1;
}

/* ------------------------------------------------------------- the accessible sweep ---- */

/** The sweep's bands for a post `height` widths tall: the centers of its lines, top to bottom. */
export function bandsOf(height: number): number[] {
  const n = Math.max(1, Math.floor(height / ROW));
  return Array.from({ length: n }, (_, k) => (k + 0.5) * ROW);
}

/** Where the sweep is: the band it is on and how far across (0 to 1). */
export interface Sweep { readonly row: number; readonly x: number }

/**
 * The sweep after `dt` seconds: it moves across its band at `SWEEP_SPEED`, then on to the start of the next, and
 * round to the first after the last. It never crosses more than a line's width in a step of any size a frame
 * is, so the post is never cleared at once. `span`, when given, says where a band's ink lies: a band with none is
 * passed over and the sweep starts and ends each band at its ink, so it does not wait out a line with nothing
 * to wash. `idle` is true when no band has ink at all.
 */
export function sweepStep(
  rows: readonly number[], at: Sweep, dt: number, span?: (row: number) => readonly [number, number] | null,
): { readonly sweep: Sweep; readonly point: Pt; readonly idle: boolean } {
  let { row, x } = at;
  x += dt * SWEEP_SPEED;
  let hops = 0;
  for (;;) {
    const s = span?.(row);
    const done = span ? s === null || x > Math.min(1, s![1]) : x >= 1;
    if (!done) {
      if (span && s) x = Math.max(x, s[0]);
      break;
    }
    if (++hops > rows.length) return { sweep: at, point: [at.x, rows[at.row] ?? 0], idle: true };
    row = (row + 1) % rows.length;
    x = 0;
  }
  return { sweep: { row, x }, point: [Math.min(1, x), rows[row]!], idle: false };
}

/* ------------------------------------------------------------ lines under the ink ---- */

/** A line of the post's text: where it lies down the layout, in widths, and its words. */
export interface TextLine { readonly top: number; readonly bottom: number; readonly text: string }

/** A line is under ink when this share of its length has ink on some layer; a reader sees too little of it otherwise to read it. */
const COVERED = 0.5;
const ACROSS = 51;

/**
 * Which lines of text lie under ink: a screen reader is given a line once it is not, as the eye is. Lines are
 * sampled along their middle; a layer that is washed clean is null and covers nothing.
 */
export function coveredLines(lines: readonly TextLine[], inks: readonly (LayerInk | null)[]): boolean[] {
  const live = inks.filter((i): i is LayerInk => i !== null);
  return lines.map((line) => {
    if (live.length === 0) return false;
    const y = (line.top + line.bottom) / 2;
    let under = 0;
    for (let k = 0; k < ACROSS; k++) {
      const x = k / (ACROSS - 1);
      if (live.some((i) => i.has(x, y))) under++;
    }
    return under / ACROSS >= COVERED;
  });
}
