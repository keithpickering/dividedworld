/**
 * Whoops!'s scrubbing, the pure half of its drawing (refinements design sections 3 and 4): what a layer's ink is
 * after the strokes on it, which layer a stroke scrubs, the bounds a saved stroke keeps to, the accessible sweep's
 * pace, and which lines of text lie under ink. No DOM and no canvas: `Effect.tsx` draws what this decides, and
 * every rule here is testable in Node.
 *
 * Everything is in shares of the post body's box on this screen: a point is across 0 to 1 and down 0 to 1, so a
 * stroke lands on the same words wherever the box is and survives an edit. A brush is a size on the screen, so
 * its measures are in px; a stroke keeps its brush as a share of the box's width (`width`) and the drawer's box's
 * proportions (`aspect`), which makes it an ellipse of `width / 2` across and `width / 2 * aspect` down, in shares,
 * on any box: round on the drawer's screen, stretched with the box on another. A layer's ink is the seeded splat
 * (splat.ts) over the box, less the washed strokes on it; "does this point still have ink" is geometry (the
 * splat's outline, and the distance to a stroke's path in the ellipse's own unit circle), never a read of pixels,
 * so it costs no canvas. Each screen's model is its own; for the same strokes the shares are close, not equal.
 */
import { STROKES } from '../whoops.ts';
import { covers, type Box, type Splat } from './splat.ts';

/** The wash's brush and the author's pen, in px: a hand-sized brush on the board's 15px type, the pen a third of it. */
export const BRUSH_PX = 30;
export const PEN_PX = 9;
/** A line of the post's text, px (the board's 15px type at about 1.5): the accessible sweep's band. */
export const ROW_PX = 22.5;
/** The sweep's brush, in rows: a little over its band, so the bands leave no sliver between them. */
export const SWEEP_BRUSH_ROWS = 1.15;
/** The accessible sweep's pace, in shares of the box's width a second: a line a little under two seconds, as a hand takes. */
export const SWEEP_SPEED = 0.55;
/** The spacing of the points a layer's remaining ink is counted at, px (under half the brush). */
export const CELL_PX = 12.5;
/** The side of the squares `has` files a stroke's segments under, px (a few cells, a little over a brush). */
export const BUCKET_PX = 50;
/** Points closer than this to the one before are dropped, px: a drag reports far more than a path needs. */
export const MIN_STEP_PX = 5;

export type Pt = readonly [number, number];
export type Stroke =
  | { readonly tool: 'wash'; readonly width: number; readonly aspect: number; readonly points: readonly Pt[] }
  | { readonly tool: 'ink'; readonly color: string; readonly width: number; readonly aspect: number; readonly points: readonly Pt[] };

/** A brush `px` across on a drawer's `box`, as a stroke keeps it. */
export function brushOf(px: number, box: Box): { readonly width: number; readonly aspect: number } {
  return { width: px / box.w, aspect: box.w / box.h };
}

/** `MIN_STEP_PX` as the shares across and down of `box`, for `fitStroke`. */
export function minStepOf(box: Box): Pt {
  return [MIN_STEP_PX / box.w, MIN_STEP_PX / box.h];
}

/* ------------------------------------------------------------------ what a stroke may be ---- */

const tenThousandth = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A stroke as the card keeps it: points held to the box (0 to 1 both ways) to a ten-thousandth, `width` to a
 * ten-thousandth (never 0), `aspect` to three significant figures, the points thinned of the ones that add
 * nothing (`minStep`, the shares across and down a point must be from the last one kept: see `minStepOf`), and cut
 * into strokes of at most `STROKES.points` points (each starting on the point the last ended on, so a long drag
 * is one unbroken line).
 */
export function fitStroke(stroke: Stroke, minStep: Pt): Stroke[] {
  const held = (x: number, y: number): Pt => [tenThousandth(clamp(x, 0, 1)), tenThousandth(clamp(y, 0, STROKES.deepest))];
  const kept: Pt[] = [];
  for (const [x, y] of stroke.points) {
    const p = held(x, y);
    const last = kept[kept.length - 1];
    if (last && Math.hypot((p[0] - last[0]) / minStep[0], (p[1] - last[1]) / minStep[1]) < 1) continue;
    kept.push(p);
  }
  /* The stroke ends where the pen did: a last point too close to the last one kept takes its place (a lone point stays a dab). */
  const lastIn = stroke.points[stroke.points.length - 1];
  if (lastIn) {
    const end = held(lastIn[0], lastIn[1]);
    if (kept.length === 0) kept.push(end);
    else if (kept.length > 1) kept[kept.length - 1] = end;
  }
  const width = tenThousandth(clamp(stroke.width, 0.0001, STROKES.widest));
  const aspect = Number(clamp(stroke.aspect, 0.001, 1000).toPrecision(3));
  const out: Stroke[] = [];
  for (let at = 0; at < kept.length || at === 0; at += STROKES.points - 1) {
    const points = kept.slice(at, at + STROKES.points);
    out.push(stroke.tool === 'ink' ? { tool: 'ink', color: stroke.color, width, aspect, points } : { tool: 'wash', width, aspect, points });
    if (at + STROKES.points >= kept.length) break;
  }
  return out;
}

/** Whether a layer's strokes are within the card's counts, so a save of them is kept. */
export function fits(strokes: readonly Stroke[]): boolean {
  return strokes.length <= STROKES.most && strokes.reduce((n, s) => n + s.points.length, 0) <= STROKES.totalPoints;
}

/* --------------------------------------------------------------------- a layer's ink ---- */

/**
 * How many points' answers a layer keeps of its splat's outline, at most, checked on every insert. It serves `has`
 * (a post's lines sampled across, a few thousand points, and the pointer's own); the constructor's grid pass asks
 * `covers` directly, since each grid point is asked once and a memory of it would only fill and thrash.
 */
const MEMO_MOST = 20_000;

/** Squared distance from (px, py) to the segment a-b. */
function segment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Whether (x, y) is within the segment a-b's ellipse of radii rx across and ry down: the distance measured after scaling into its unit circle. */
function reaches(x: number, y: number, ax: number, ay: number, bx: number, by: number, rx: number, ry: number): boolean {
  return segment2(x / rx, y / ry, ax / rx, ay / ry, bx / rx, by / ry) <= 1;
}

/** A segment of a stroke, in shares: ax, ay, bx, by, the radii across and down, and whether it is a pen (1) or a wash (0). */
type Segment = readonly [number, number, number, number, number, number, number];

/**
 * One layer on one screen: its splat over the body's box, less the washes on it, plus the author's pen strokes
 * written back in it. The strokes apply in the order they were made, so a pen written over a wash is ink again and
 * a wash after it removes it: a pen stroke belongs to its layer and is scrubbed like the rest of its ink. `has`
 * asks whether a point (shares of the box) still has ink (the last stroke that reaches it, else the splat's
 * outline); `washed` is the share of the layer's ink washed away, counted at a grid of `CELL_PX` px cells over the
 * box and wherever a pen can write, kept as strokes are added so a stroke costs the cells it passes. A pen stroke
 * counts at the cells it passes (a thin pen rounded out to the grid's spacing), so the share and the sweep find it
 * as a hand does.
 *
 * The grid is the box, so the splat's ink that runs past the box (where no stroke can reach) is never counted:
 * counting it would leave a layer short of clean for good.
 */
export class LayerInk {
  readonly splat: Splat;
  readonly box: Box;
  /** Each stroke as segments, in the order made. */
  private readonly segments: Segment[] = [];
  /** The segments (by index, in the order made) whose reach overlaps each bucket of the plane, so `has` reads the few near a point and not every segment ever made. */
  private readonly buckets = new Map<number, number[]>();
  /** The splat's outline, by point, as asked. */
  private readonly memo = new Map<number, Map<number, boolean>>();
  private memoed = 0;
  /** The buckets' size in shares across and down, and how many lie across and down the box. */
  private readonly bw: number;
  private readonly bh: number;
  private readonly bnx: number;
  private readonly bny: number;
  /** The grid's cells across and down the box. */
  private readonly nx: number;
  private readonly ny: number;
  /** The cells that count toward the share: the splat's, and those a pen has written on. */
  private readonly counted: Uint8Array;
  private readonly alive: Uint8Array;
  private left = 0;
  private total = 0;

  constructor(splat: Splat, strokes: readonly Stroke[], box: Box) {
    this.splat = splat;
    this.box = box;
    this.bw = BUCKET_PX / box.w;
    this.bh = BUCKET_PX / box.h;
    this.bnx = Math.ceil(1 / this.bw);
    this.bny = Math.ceil(1 / this.bh);
    this.nx = Math.max(1, Math.ceil(box.w / CELL_PX));
    this.ny = Math.max(1, Math.ceil(box.h / CELL_PX));
    this.alive = new Uint8Array(this.nx * this.ny);
    this.counted = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (covers(this.splat, this.box, (i + 0.5) / this.nx, (j + 0.5) / this.ny)) {
          this.alive[j * this.nx + i] = 1;
          this.counted[j * this.nx + i] = 1;
          this.total++;
        }
      }
    }
    this.left = this.total;
    for (const s of strokes) {
      if (s.tool === 'wash') this.wash(s.points, s.width, s.aspect);
      else this.pen(s.points, s.width, s.aspect);
    }
  }

  /** A bucket's key. Points past the box share the bucket at its edge, so a segment's range and a query clamp alike. */
  private bucketKey(i: number, j: number): number {
    return (clamp(j, -1, this.bny) + 1) * (this.bnx + 3) + clamp(i, -1, this.bnx) + 1;
  }

  /** Whether a point (shares of the box) still has ink on this layer: the last stroke that reaches it decides, and with none the splat does. */
  has(x: number, y: number): boolean {
    /* Only the segments whose reach touches this point's bucket can reach the point, and each bucket keeps them in the order made, so the latest is still read first. */
    const near = this.buckets.get(this.bucketKey(Math.floor(x / this.bw), Math.floor(y / this.bh)));
    for (let k = (near?.length ?? 0) - 1; k >= 0; k--) {
      const [ax, ay, bx, by, rx, ry, pen] = this.segments[near![k]!]!;
      if (x < Math.min(ax, bx) - rx || x > Math.max(ax, bx) + rx || y < Math.min(ay, by) - ry || y > Math.max(ay, by) + ry) continue;
      if (reaches(x, y, ax, ay, bx, by, rx, ry)) return pen === 1;
    }
    return this.splatCovers(x, y);
  }

  /**
   * Whether the splat's own outline holds a point. The outline never changes, and the lines under ink are asked about the same
   * points again at each refresh of a sweep, so an answer is kept (by the point, exactly) rather than worked out again from every
   * ball of the splat. The memory is bounded: it never holds more than `MEMO_MOST` points, and starts over when it would.
   */
  private splatCovers(x: number, y: number): boolean {
    let held = this.memo.get(x)?.get(y);
    if (held !== undefined) return held;
    held = covers(this.splat, this.box, x, y);
    if (this.memoed >= MEMO_MOST) {
      this.memo.clear();
      this.memoed = 0;
    }
    let column = this.memo.get(x);
    if (!column) {
      column = new Map();
      this.memo.set(x, column);
    }
    column.set(y, held);
    this.memoed++;
    return held;
  }

  /** A brush of `width` (a share of the box's width) and `aspect` passing through `points` washes the ink under it; one point washes a dab. */
  wash(points: readonly Pt[], width: number, aspect: number): void {
    this.stroke(points, width, aspect, false);
  }

  /** The author's pen of `width` and `aspect` passing through `points` writes ink back where it passes; one point is a dab. */
  pen(points: readonly Pt[], width: number, aspect: number): void {
    this.stroke(points, width, aspect, true);
  }

  private addSegment(seg: Segment): void {
    const [ax, ay, bx, by, rx, ry] = seg;
    const at = this.segments.push(seg) - 1;
    const i0 = Math.floor((Math.min(ax, bx) - rx) / this.bw), i1 = Math.floor((Math.max(ax, bx) + rx) / this.bw);
    const j0 = Math.floor((Math.min(ay, by) - ry) / this.bh), j1 = Math.floor((Math.max(ay, by) + ry) / this.bh);
    /* A brush can be wider than the box: only the buckets the box holds, and the two edge buckets for what lies past it, are visited. */
    for (let j = Math.max(j0, -1); j <= Math.min(j1, this.bny); j++) {
      for (let i = Math.max(i0, -1); i <= Math.min(i1, this.bnx); i++) {
        const key = this.bucketKey(i, j);
        const list = this.buckets.get(key);
        if (list) list.push(at);
        else this.buckets.set(key, [at]);
      }
    }
  }

  private stroke(points: readonly Pt[], width: number, aspect: number, pen: boolean): void {
    const rx = width / 2, ry = (width / 2) * aspect;
    /* The grid is coarser than a pen is thick, so a pen takes the cells whose area it crosses. */
    const reachX = pen ? rx + 0.5 / this.nx : rx, reachY = pen ? ry + 0.5 / this.ny : ry;
    for (let k = 0; k < Math.max(1, points.length - 1); k++) {
      const [ax, ay] = points[k]!;
      const [bx, by] = points[k + 1] ?? points[k]!;
      this.addSegment([ax, ay, bx, by, rx, ry, pen ? 1 : 0]);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reachX) * this.nx));
      const i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx) + reachX) * this.nx));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reachY) * this.ny));
      const j1 = Math.min(this.ny - 1, Math.floor((Math.max(ay, by) + reachY) * this.ny));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const at = j * this.nx + i;
          if (!reaches((i + 0.5) / this.nx, (j + 0.5) / this.ny, ax, ay, bx, by, reachX, reachY)) continue;
          if (!pen) {
            if (this.alive[at]) {
              this.alive[at] = 0;
              this.left--;
            }
            continue;
          }
          if (!this.counted[at]) {
            this.counted[at] = 1;
            this.total++;
          }
          if (!this.alive[at]) {
            this.alive[at] = 1;
            this.left++;
          }
        }
      }
    }
  }

  /** The share of the layer's ink washed away, 0 to 1 (a layer with no ink is already clean). */
  get washed(): number {
    return this.total === 0 ? 1 : 1 - this.left / this.total;
  }

  /** The cells of the grid in the band y ± half (shares of the box's height) that still hold ink: their left and right edges, across, or null with none. */
  inkSpan(y: number, half: number): readonly [number, number] | null {
    const j0 = Math.max(0, Math.floor((y - half) * this.ny));
    const j1 = Math.min(this.ny - 1, Math.floor((y + half) * this.ny));
    let lo = Infinity, hi = -Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < this.nx; i++) {
        if (this.alive[j * this.nx + i]) {
          lo = Math.min(lo, i / this.nx);
          hi = Math.max(hi, (i + 1) / this.nx);
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

/** The sweep's bands for a box: the centers of its lines, `ROW_PX` tall, top to bottom, in shares of its height. */
export function bandsOf(box: Box): number[] {
  const n = Math.max(1, Math.floor(box.h / ROW_PX));
  return Array.from({ length: n }, (_, k) => ((k + 0.5) * ROW_PX) / box.h);
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
  /* A resize can leave a saved row past the box's last: the sweep resumes on the last. */
  row = Math.min(Math.max(0, row), Math.max(0, rows.length - 1));
  x += dt * SWEEP_SPEED;
  let hops = 0;
  for (;;) {
    const s = span?.(row);
    const done = span ? s === null || x > Math.min(1, s![1]) : x >= 1;
    if (!done) {
      if (span && s) x = Math.max(x, s[0]);
      break;
    }
    if (++hops > rows.length) return { sweep: { row, x: at.x }, point: [at.x, rows[row] ?? 0], idle: true };
    row = (row + 1) % rows.length;
    x = 0;
  }
  return { sweep: { row, x }, point: [Math.min(1, x), rows[row]!], idle: false };
}

/* ------------------------------------------------------------ lines under the ink ---- */

/** A line of the post's text: where it lies down the box, in shares of its height, and its words. */
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
