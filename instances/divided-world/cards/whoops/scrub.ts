/**
 * Whoops!'s scrubbing, the pure half of its drawing (refinements design sections 3 and 4): what a layer's ink is
 * after the strokes on it, which layer a stroke scrubs, the bounds a saved stroke keeps to, the accessible sweep's
 * pace, and which lines of text lie under ink. No DOM and no canvas: `Effect.tsx` draws what this decides, and
 * every rule here is testable in Node.
 *
 * Everything is in shares of the post body's box on this screen: a point is across 0 to 1 and down 0 to 1, so a
 * stroke lands on the same shares of the box, not the same words, wherever the box is, and survives an edit. A brush is a size on the screen, so
 * its measures are in px; a stroke keeps its brush as a share of the box's width (`width`) and the drawer's box's
 * proportions (`aspect`), which makes it an ellipse of `width / 2` across and `width / 2 * aspect` down, in shares,
 * on any box: round on the drawer's screen, stretched with the box on another.
 *
 * The model is the field (docs/plans/2026-11-12-whoops-ink-field-design.md). A layer's ink is the seeded splat (splat.ts), a field
 * of balls over the box, with each stroke's operation applied to it in the order made: a pen line adds to the field
 * and melts into it (its ends swell, a quick lift throws drops), and a wash takes some of it each pass (`WASH_TAKES`),
 * so a thin arm clears in a pass and a core takes several, and a pass does not clear the cells it reaches. Ink is
 * wherever the field reaches THRESHOLD. There is one implementation of those operations, in field.ts, shared with the
 * painter (paint.ts shades the same field over a denser grid), so what is counted here and what is drawn cannot
 * disagree. "Does this point still have ink" is that field's value, never a read of pixels, so it costs no canvas.
 * A stroke's points are kept packed when saved (points.ts), and a layer too heavy to build on the page is built in a
 * worker (build.ts) with a stand-in drawn meanwhile; this model never waits for either. Each screen's model is its
 * own; for the same strokes the shares are close, not equal.
 */
import { STROKES } from '../whoops.ts';
import { addBall, beginLine, penAt, cellGrid, endsOf, kOf, linesOf, pointGrid, radiusOf, splatInto, type Ball, type Grid, type Rect } from './field.ts';
import { THRESHOLD, type Box, type Splat } from './splat.ts';

/** The wash's brush and the author's pen, in px: a hand-sized brush on the board's 15px type, the pen about half of it. */
export const BRUSH_PX = 30;
export const PEN_PX = 16;
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
/** The droplets a lifted pen throws: 0 to 3 (the card refuses others). */
export type Drops = 0 | 1 | 2 | 3;
export type Stroke =
  | { readonly tool: 'wash'; readonly width: number; readonly aspect: number; readonly points: readonly Pt[]; readonly continues?: true }
  | { readonly tool: 'ink'; readonly color: string; readonly width: number; readonly aspect: number; readonly points: readonly Pt[]; readonly continues?: true; readonly drops?: Drops };

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
 * Ramer-Douglas-Peucker over `pts` (in px): the indices of the points kept, the first and last always among them; a
 * point within `tol` of the line through the kept ones around it is dropped (distances compared squared, so the inner loop
 * takes no square root). Iterative, since a 500-point drag can be a deep chain. Worst case O(n²) on one drag (every split
 * peels one point); that is fine here, since a drag is bounded by what a hand reports between two lifts (a few thousand points
 * at most) and the work runs once, when the stroke ends.
 */
function simplify(pts: readonly Pt[], tol: number): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const todo: [number, number][] = [[0, n - 1]];
  while (todo.length) {
    const [lo, hi] = todo.pop()!;
    let far = -1, farD = tol * tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = segment2(pts[i]![0], pts[i]![1], pts[lo]![0], pts[lo]![1], pts[hi]![0], pts[hi]![1]);
      if (d > farD) { far = i; farD = d; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    todo.push([lo, far], [far, hi]);
  }
  return pts.flatMap((_, i) => (keep[i] === 1 ? [i] : []));
}

/**
 * A stroke as the card keeps it: points held to the box (0 to 1 both ways) to a ten-thousandth, `width` to a
 * ten-thousandth (never 0), `aspect` to three significant figures; the points simplified (Ramer-Douglas-Peucker in the
 * drawer's px, within a quarter of the brush's radius, keeping the first and last), then thinned of the ones that add
 * nothing (`minStep`, the shares across and down a point must be from the last one kept: see `minStepOf`), and cut
 * into strokes of at most `STROKES.points` points (each starting on the point the last ended on, so a long drag
 * is one unbroken line). Each piece after the first `continues`; only the last keeps `drops`.
 */
export function fitStroke(stroke: Stroke, minStep: Pt): Stroke[] {
  const held = (x: number, y: number): Pt => [tenThousandth(clamp(x, 0, 1)), tenThousandth(clamp(y, 0, STROKES.deepest))];
  const width = tenThousandth(clamp(stroke.width, 0.0001, STROKES.widest));
  const aspect = Number(clamp(stroke.aspect, 0.001, 1000).toPrecision(3));
  const all = stroke.points.map(([x, y]) => held(x, y));
  /* The tolerance is a share of the width, so any positive drawer width gives the same answer: 1,000 px here. */
  const W = 1000;
  const simple = simplify(all.map(([x, y]): Pt => [x * W, (y * W) / aspect]), (width * W) / 8).map((i) => all[i]!);
  const kept: Pt[] = [];
  for (const p of simple) {
    const last = kept[kept.length - 1];
    if (last && Math.hypot((p[0] - last[0]) / minStep[0], (p[1] - last[1]) / minStep[1]) < 1) continue;
    kept.push(p);
  }
  /* The stroke ends where the pen did: a last point too close to the last one kept takes its place (a lone point stays a dab). */
  const end = simple[simple.length - 1];
  if (end) {
    if (kept.length === 0) kept.push(end);
    else if (kept.length > 1) kept[kept.length - 1] = end;
  }
  const drops = stroke.tool === 'ink' ? stroke.drops : undefined;
  const out: Stroke[] = [];
  for (let from = 0; from < kept.length || from === 0; from += STROKES.points - 1) {
    const points = kept.slice(from, from + STROKES.points);
    const last = from + STROKES.points >= kept.length;
    const more = from > 0 || stroke.continues ? { continues: true as const } : null;
    out.push(stroke.tool === 'ink'
      ? { tool: 'ink', color: stroke.color, width, aspect, points, ...more, ...(last && drops !== undefined ? { drops } : null) }
      : { tool: 'wash', width, aspect, points, ...more });
    if (last) break;
  }
  return out;
}

/** Whether a layer's strokes are within the card's counts, so a save of them is kept. */
export function fits(strokes: readonly Stroke[]): boolean {
  return strokes.length <= STROKES.most && strokes.reduce((n, s) => n + s.points.length, 0) <= STROKES.totalPoints;
}

/* --------------------------------------------------------------------- a layer's ink ---- */

/** How many points' splat values a layer keeps, at most, checked on every insert. It serves `has` (a post's lines sampled across, a few thousand points, and the pointer's own). */
const MEMO_MOST = 20_000;

/** Squared distance from (px, py) to the segment a-b. */
function segment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** What `LayerInk` keeps of a line: its first piece's brush and tool, every point `to` was given, and whether it has been ended. */
interface LineRec {
  readonly first: Stroke;
  readonly points: Pt[];
  open: boolean;
  drops?: number;
  /** The buckets this line is already filed under. */
  readonly filed: Set<number>;
  /** The line's brush's down-to-across ratio and its reach (2r, round space, px), for the replay's skipping of far pen segments. */
  readonly k: number;
  readonly reach: number;
  /** A closed pen line's bulb and drops, worked out once at `end`. */
  balls?: readonly Ball[];
}

/** A line being drawn on a layer: `to` adds the point the pen moved to, `end` lifts it (a pen's ends, a dab's top-up). */
export interface LiveLine {
  to(p: Pt): void;
  end(drops?: number): void;
}

/**
 * One layer on one screen: its splat's field over the body's box with the strokes on it, in the order made, through
 * field.ts's operations (the painter shades the same operations over a denser grid, so the two cannot disagree). A
 * pen line adds to the field and a wash takes from it; ink is wherever the value is at least `THRESHOLD`.
 *
 * Inside it holds a grid of cells `CELL_PX` px apart (`cells`, with `ink` the cells that have ink) for `washed`
 * and the sweep, kept as strokes are added so a stroke costs the cells it passes. `counted` is each cell the splat,
 * or a pen, ever brought to the threshold; `washed` is the share of those no longer inked.
 *
 * `has(x, y)` asks one point (shares of the box): the splat's field there, memoized, then every line that reaches
 * the point replayed in order and whole (a pen line's most-not-sum scope and its ends, and a wash's carry, belong
 * to the whole line, and a `continues` piece is part of the line before it), so it gives what the cells give at
 * their centers and what `fieldAtPoint` gives anywhere. Lines are filed by the buckets their reach touches, so a
 * point replays only the few near it.
 *
 * A pen line must be ended (by `end` at a lift, and by the caller on a cancel): the field refuses a second open pen
 * line. The grid is the box, so splat ink that runs past the box (where no stroke can reach) is never counted.
 */
export class LayerInk {
  readonly splat: Splat;
  readonly box: Box;
  /** The field at the cells' centers. */
  readonly cells: Grid;
  /** 1 where a cell has ink now. */
  readonly ink: Uint8Array;
  /** Each line made, in order. */
  private readonly lines: LineRec[] = [];
  /** The lines (by index, in order) whose reach overlaps each bucket of the plane. */
  private readonly buckets = new Map<number, number[]>();
  /** The splat's field at a point as asked, and the last answer for the point with the version of its bucket it was made at. */
  private readonly memo = new Map<number, Map<number, { splat: number; ver: number; value: number }>>();
  /** Each bucket's version: a fresh number whenever a segment within reach of it is filed or a line that reaches it is ended. */
  private readonly versions = new Map<number, number>();
  private tick = 0;
  /** One point's grid, reused by every replay. */
  private readonly scratch = pointGrid(0, 0);
  /** Work done, for a cost test: replays of a point's lines, and a pen line's ends worked out. */
  readonly stats = { replays: 0, ends: 0 };
  private memoed = 0;
  /** The buckets' size in shares across and down, and how many lie across and down the box. */
  private readonly bw: number;
  private readonly bh: number;
  private readonly bnx: number;
  private readonly bny: number;
  /** The cells that count toward the share. */
  private readonly counted: Uint8Array;
  private left = 0;
  private total = 0;
  /** The line still open, which a `continues` piece goes on with. */
  private current: { readonly tool: Stroke['tool']; readonly handle: LiveLine } | null = null;

  constructor(splat: Splat, strokes: readonly Stroke[], box: Box) {
    this.splat = splat;
    this.box = box;
    this.bw = BUCKET_PX / box.w;
    this.bh = BUCKET_PX / box.h;
    this.bnx = Math.ceil(1 / this.bw);
    this.bny = Math.ceil(1 / this.bh);
    this.cells = cellGrid(box, CELL_PX);
    this.ink = new Uint8Array(this.cells.cols * this.cells.rows);
    this.counted = new Uint8Array(this.cells.cols * this.cells.rows);
    this.absorb(splatInto(this.cells, splat, box));
    this.add(strokes);
  }

  /** Strokes made in order, whole lines at a time (a `continues` piece joins the line before it), each ended. */
  add(strokes: readonly Stroke[]): void {
    for (const line of linesOf(strokes)) {
      const live = this.begin(line[0]!);
      for (const piece of line) for (const p of piece.points) live.to(p);
      const last = line[line.length - 1]!;
      live.end(last.tool === 'ink' ? last.drops : undefined);
    }
  }

  /**
   * Begin a line of `stroke`'s tool and brush. A stroke that `continues` goes on with the line still open, if there is one of
   * its tool (the same handle comes back); with none open it begins a line of its own.
   */
  begin(stroke: Stroke): LiveLine {
    if (stroke.continues && this.current && this.current.tool === stroke.tool) return this.current.handle;
    const line = beginLine(this.cells, this.box, stroke);
    const idx = this.lines.length;
    const k = kOf(stroke, this.box), r = radiusOf(stroke, this.box);
    const rec: LineRec = { first: stroke, points: [], open: true, filed: new Set(), k, reach: 2 * r };
    this.lines.push(rec);
    const handle: LiveLine = {
      to: (p) => {
        if (!rec.open) return;
        const last = rec.points[rec.points.length - 1] ?? p;
        rec.points.push(p);
        this.file(rec, idx, last, p, 2 * r, k);
        this.absorb(line.to(p));
      },
      end: (drops) => {
        if (!rec.open) return;
        rec.open = false;
        rec.drops = drops;
        if (this.current?.handle === handle) this.current = null;
        /* A pen's bulb and drops lie further out than its path does. */
        const end = rec.points[rec.points.length - 1];
        if (stroke.tool === 'ink' && end) {
          rec.balls = endsOf([{ ...stroke, points: rec.points, drops }], this.box);
          this.stats.ends++;
          this.file(rec, idx, end, end, 13 * r, k);
        } else if (end) this.file(rec, idx, end, end, 2 * r, k); /* a wash's top-up lies within its brush of the last point */
        this.absorb(line.end(drops));
      },
    };
    this.current = { tool: stroke.tool, handle };
    return handle;
  }

  /** A bucket's key. Points past the box share the bucket at its edge, so a line's range and a query clamp alike. */
  private bucketKey(i: number, j: number): number {
    return (clamp(j, -1, this.bny) + 1) * (this.bnx + 3) + clamp(i, -1, this.bnx) + 1;
  }

  /** File a line under the buckets the segment a-b's reach touches (`reach` px across, `reach * k` down, round space). */
  private file(rec: LineRec, idx: number, a: Pt, b: Pt, reach: number, k: number): void {
    const px = reach / this.box.w, py = (reach * k) / this.box.h;
    const i0 = Math.floor((Math.min(a[0], b[0]) - px) / this.bw), i1 = Math.floor((Math.max(a[0], b[0]) + px) / this.bw);
    const j0 = Math.floor((Math.min(a[1], b[1]) - py) / this.bh), j1 = Math.floor((Math.max(a[1], b[1]) + py) / this.bh);
    /* A brush can be wider than the box: only the buckets the box holds, and the two edge buckets for what lies past it, are visited. */
    for (let j = Math.max(j0, -1); j <= Math.min(j1, this.bny); j++) {
      for (let i = Math.max(i0, -1); i <= Math.min(i1, this.bnx); i++) {
        const key = this.bucketKey(i, j);
        this.versions.set(key, ++this.tick);
        if (rec.filed.has(key)) continue;
        rec.filed.add(key);
        const list = this.buckets.get(key);
        if (!list) this.buckets.set(key, [idx]);
        else if (list[list.length - 1]! < idx) list.push(idx);
        else {
          /* Two lines can be open at once (the live stroke and the sweep), so one can be filed after a later one: keep line order. */
          let lo = 0, hi = list.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]! < idx) lo = m + 1; else hi = m; }
          list.splice(lo, 0, idx);
        }
      }
    }
  }

  /** Take in a rectangle of cells the field just changed in: which have ink, which have ever, and the counts. */
  private absorb(rect: Rect): void {
    const { cols, values } = this.cells;
    for (let j = rect.y0; j < rect.y1; j++) {
      for (let i = rect.x0; i < rect.x1; i++) {
        const at = j * cols + i, inked = values[at]! >= THRESHOLD;
        if (inked && !this.counted[at]) { this.counted[at] = 1; this.total++; }
        if (inked !== (this.ink[at] === 1)) { this.ink[at] = inked ? 1 : 0; this.left += inked ? 1 : -1; }
      }
    }
  }

  /**
   * The field's value at a point (shares of the box): the splat's, then the lines that reach it, replayed whole and in
   * order. With no line near it that is the splat's value as it stands; otherwise the answer is kept with its bucket's
   * version, so an unchanged bucket is a hit and a segment filed within reach of the point is what makes it replay.
   */
  valueAt(x: number, y: number): number {
    const key = this.bucketKey(Math.floor(x / this.bw), Math.floor(y / this.bh));
    const near = this.buckets.get(key);
    const base = this.splatValue(x, y);
    if (!near || near.length === 0) return base.splat;
    const ver = this.versions.get(key) ?? 0;
    if (base.ver === ver) return base.value;
    this.stats.replays++;
    base.value = this.replay(x, y, base.splat, near);
    base.ver = ver;
    return base.value;
  }

  /** The splat's value at the point, then each of `near` (line indexes, in order) replayed whole, on the layer's one scratch grid. */
  private replay(x: number, y: number, splat: number, near: readonly number[]): number {
    const g = this.scratch as { ox: number; oy: number } & Grid;
    g.ox = x * this.box.w;
    g.oy = y * this.box.h;
    g.values[0] = splat;
    g.washed[0] = 0;
    g.penOpen = false;
    for (const idx of near) {
      const rec = this.lines[idx]!;
      if (rec.first.tool === 'wash') {
        /* A wash's discs carry from one segment to the next, so every piece of it is replayed. */
        const line = beginLine(g, this.box, rec.first);
        for (const p of rec.points) line.to(p);
        if (!rec.open) line.end(rec.drops);
      } else this.replayPen(g, rec, g.ox, g.oy / rec.k);
    }
    return g.values[0]!;
  }

  /**
   * A pen line at one point. Its segments are independent (the point keeps the most any one gives it: field.ts's
   * "most, not the sum"), so the point's value is raised by the largest (1 - d^2/R^2)^3 over the segments, and a
   * segment whose box lies more than a brush's reach (R) from the point is skipped. A closed line's bulb and drops
   * are the balls kept at `end`.
   */
  private replayPen(g: Grid, rec: LineRec, px: number, py: number): void {
    g.values[0] = g.values[0]! + penAt(rec.points, rec.first, this.box, px, py);
    if (!rec.open && rec.balls) for (const ball of rec.balls) addBall(g, rec.k, ball);
  }

  /** Whether a point (shares of the box) has ink on this layer now. */
  has(x: number, y: number): boolean {
    return this.valueAt(x, y) >= THRESHOLD;
  }

  /**
   * The splat's own field at a point, with the entry the point's last answer is kept in. The splat's never changes, and the lines under ink are
   * asked about the same points again at each refresh of a sweep, so an answer is kept (by the point, exactly). The memory is
   * bounded: it never holds more than `MEMO_MOST` points, and starts over when it would.
   */
  private splatValue(x: number, y: number): { splat: number; ver: number; value: number } {
    const held = this.memo.get(x)?.get(y);
    if (held) return held;
    const g = pointGrid(x * this.box.w, y * this.box.h);
    splatInto(g, this.splat, this.box);
    const entry = { splat: g.values[0]!, ver: -1, value: 0 };
    if (this.memoed >= MEMO_MOST) {
      this.memo.clear();
      this.memoed = 0;
    }
    let column = this.memo.get(x);
    if (!column) {
      column = new Map();
      this.memo.set(x, column);
    }
    column.set(y, entry);
    this.memoed++;
    return entry;
  }

  /** The share of the layer's ink washed away, 0 to 1 (a layer with no ink is already clean). */
  get washed(): number {
    return this.total === 0 ? 1 : 1 - this.left / this.total;
  }

  /** The cells of the grid in the band y ± half (shares of the box's height) that still hold ink: their left and right edges, across, or null with none. */
  inkSpan(y: number, half: number): readonly [number, number] | null {
    const { cols, rows } = this.cells;
    const j0 = Math.max(0, Math.floor((y - half) * rows));
    const j1 = Math.min(rows - 1, Math.floor((y + half) * rows));
    let lo = Infinity, hi = -Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = 0; i < cols; i++) {
        if (this.ink[j * cols + i]) {
          lo = Math.min(lo, i / cols);
          hi = Math.max(hi, (i + 1) / cols);
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
