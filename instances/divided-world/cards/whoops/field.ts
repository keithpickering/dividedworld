/**
 * Whoops!'s ink field operations, pure (ink-field design, sections 1 to 3). A splat is a field of balls; a pen line
 * adds to that field and a wash takes from it, each in the order it was made, and what is ink is wherever the field
 * reaches `THRESHOLD`. No DOM and no canvas: the painter shades a dense grid of this field, `LayerInk` holds a grid of
 * cells and asks single points, and all three run the operations below, so they cannot disagree.
 *
 * A grid is `cols x rows` sample points `step` CSS px apart, the first at (step / 2, step / 2) in the box (or at an
 * `origin`, for a single point). Values are Float32, like `fieldGrid`'s.
 *
 * A brush is kept as a stroke keeps it: `width` a share of the box's width, `aspect` the drawer's box's proportions. It
 * is round in the space (x px, y px / k) with k = aspect * box.h / box.w (scrub.ts, paint.ts `trace`), and every
 * distance below is measured in that space ("round space"), so the brush is an ellipse on a box of other proportions.
 *
 * A line's "most, not the sum" scope is a scratch array the grid owns, cleared (by the rectangle it touched) when the
 * line ends: one pen line per grid is open at a time, and `beginPen` throws if one is already open. A pen line must
 * be ended: by `end()` at a lift, and by its caller on a pointer cancel or when the drawing is abandoned (Task 3's
 * caller does), or the grid refuses the next pen line.
 *
 * Each row of a disc or a segment visits only the columns the shape can reach there, so a long straight segment (a
 * simplified stroke has them) costs its area, not its bounding box's.
 */
import { mulberry32, unitPx, DESIGN, type Box, type Splat } from './splat.ts';
import type { Pt, Stroke } from './scrub.ts';

/** How much one straight wash pass takes from the field under its center: a thin arm clears in one pass, the core takes several. */
export const WASH_TAKES = 1.5;
/** The bulb at a pen line's end, as a multiple of the pen's radius. */
export const END_BULB = 1.35;
/** The most droplets a lifted pen throws. */
export const DROPS_MOST = 3;
/** The most a field value is held to when it is stored. */
export const FIELD_MOST = 16;

/** The falloff (1 - s^2/R^2)^3 summed across a line through its center, in units of R. */
const PASS_INTEGRAL = 32 / 35;
/** The bulb is only added to a line at least this many radii long. */
const BULB_MIN_LENGTH = 4;

/** A stroke as the field reads it: the card's `Stroke`, with its `continues` and `drops`. */
export type FieldStroke = Stroke;

/** The brush a line is drawn with: what a stroke keeps of it. */
export interface Brush { readonly width: number; readonly aspect: number }

/** A rectangle of grid points, half open: columns x0 to x1 - 1, rows y0 to y1 - 1. Empty when x1 <= x0 or y1 <= y0. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface Grid {
  readonly cols: number;
  readonly rows: number;
  /** CSS px between neighboring points. */
  readonly step: number;
  /** The CSS px position of point (0, 0). */
  readonly ox: number;
  readonly oy: number;
  readonly values: Float32Array;
  /** 1 where a wash has lowered the point's value. */
  readonly washed: Uint8Array;
  /** The open pen line's scratch (the largest value each point has had from it); null until a pen line is first begun. */
  scope: Float32Array | null;
  /** True while a pen line is open on this grid (begun, not ended). */
  penOpen: boolean;
  /** When set, counts the grid points the operations visit (a cost test reads it). */
  work?: { visits: number };
}

export function makeGrid(cols: number, rows: number, step: number, origin?: { readonly x: number; readonly y: number }): Grid {
  return {
    cols, rows, step,
    ox: origin ? origin.x : step / 2, oy: origin ? origin.y : step / 2,
    values: new Float32Array(cols * rows), washed: new Uint8Array(cols * rows), scope: null, penOpen: false,
  };
}
/** The painter's grid: points at pixel centers of a canvas at `density` pixels per CSS px (as `fieldGrid`). */
export function denseGrid(box: Box, density: number): Grid {
  return makeGrid(Math.ceil(box.w * density), Math.ceil(box.h * density), 1 / density);
}
/** A layer's cells: `step` px apart across the box. */
export function cellGrid(box: Box, step: number): Grid {
  return makeGrid(Math.ceil(box.w / step), Math.ceil(box.h / step), step);
}
/** One point, at (x, y) px. */
export function pointGrid(x: number, y: number): Grid {
  return makeGrid(1, 1, 1, { x, y });
}

const empty = (): Rect => ({ x0: 0, y0: 0, x1: 0, y1: 0 });
export function unionRect(a: Rect, b: Rect): Rect {
  if (a.x1 <= a.x0 || a.y1 <= a.y0) return { ...b };
  if (b.x1 <= b.x0 || b.y1 <= b.y0) return { ...a };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** The k of a brush on a box: the down-to-across ratio of its ellipse. */
export function kOf(brush: Brush, box: Box): number {
  return (brush.aspect * box.h) / box.w;
}
/** The brush's radius across, px. */
export function radiusOf(brush: Brush, box: Box): number {
  return (brush.width * box.w) / 2;
}

/** The grid points (as a half-open rectangle) whose px positions lie within [x0, x1] across and [y0, y1] down. */
function rectOf(g: Grid, x0: number, x1: number, y0: number, y1: number): Rect {
  return {
    x0: Math.max(0, Math.floor((x0 - g.ox) / g.step)), x1: Math.min(g.cols, Math.ceil((x1 - g.ox) / g.step) + 1),
    y0: Math.max(0, Math.floor((y0 - g.oy) / g.step)), y1: Math.min(g.rows, Math.ceil((y1 - g.oy) / g.step) + 1),
  };
}

/** The columns [i0, i1) of row j that lie within px range [xlo, xhi] across, clipped to `rect`. */
function colsIn(g: Grid, rect: Rect, xlo: number, xhi: number): [number, number] {
  return [Math.max(rect.x0, Math.ceil((xlo - g.ox) / g.step)), Math.min(rect.x1, Math.floor((xhi - g.ox) / g.step) + 1)];
}

/** The splat's field at every point, as `fieldGrid` computes it (and so `fieldAt`). Returns the rectangle it touched. */
export function splatInto(grid: Grid, splat: Splat, box: Box): Rect {
  const unit = unitPx(box);
  let touched = empty();
  for (const b of splat.balls) {
    const R = 2 * b.r * unit, bx = (b.x / DESIGN.w) * box.w, by = b.y * box.h;
    touched = unionRect(touched, discInto(grid, bx, by, R, 1, (v, w) => v + w));
  }
  return touched;
}

/**
 * Apply `f(value, falloff)` to every point within a disc of radius `R` round-space px at (cx, cy) (round space; k
 * stretches it down), where falloff is (1 - d^2/R^2)^3. `f` returns the new value.
 */
function discInto(g: Grid, cx: number, cy: number, R: number, k: number, f: (v: number, w: number) => number): Rect {
  const rect = rectOf(g, cx - R, cx + R, (cy - R) * k, (cy + R) * k);
  const R2 = R * R;
  for (let j = rect.y0; j < rect.y1; j++) {
    const dy = (g.oy + j * g.step) / k - cy, dy2 = dy * dy, row = j * g.cols;
    if (dy2 >= R2) continue;
    const half = Math.sqrt(R2 - dy2), [i0, i1] = colsIn(g, rect, cx - half, cx + half);
    if (g.work) g.work.visits += Math.max(0, i1 - i0);
    for (let i = i0; i < i1; i++) {
      const dx = g.ox + i * g.step - cx, d2 = dx * dx + dy2;
      if (d2 < R2) { const q = 1 - d2 / R2; g.values[row + i] = f(g.values[row + i]!, q * q * q); }
    }
  }
  return rect;
}

/* ------------------------------------------------------------------------------------------- pen ---- */

/** A ball in round space: x and y px across and (down / k), r px. */
export interface Ball { readonly x: number; readonly y: number; readonly r: number }

/** Add a ball to the field as a splat ball is added. `k` is the brush's down-to-across ratio. */
export function addBall(grid: Grid, k: number, ball: Ball): Rect {
  return discInto(grid, ball.x, ball.y, 2 * ball.r, k, (v, w) => v + w);
}

/** The points of a line's pieces, in order, in shares: a piece after the first starts on the last one's end, and a repeated point is one point. */
export function pointsOf(pieces: readonly { readonly points: readonly Pt[] }[]): Pt[] {
  const out: Pt[] = [];
  for (const piece of pieces) {
    for (const p of piece.points) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

/**
 * The bulb and drops at a pen line's end, worked out from the saved data alone, so every screen and every visit
 * gets the same ones. `line` is the line's pieces (or one stroke). A bulb of `END_BULB` radii at the last point when
 * the line is at least `4r` long; then `drops` droplets (the last piece's saved count, held to `DROPS_MOST`), each at
 * r * (2.6 + 2.2j + 2u) past the end within 0.25 rad of the last direction, radius r * (0.35 + 0.35u), the u from a
 * PRNG seeded by an FNV-1a hash of the saved points' ten-thousandths in order. Balls are in round space.
 */
export function endsOf(line: readonly (Brush & { readonly points: readonly Pt[]; readonly drops?: number })[], box: Box): Ball[] {
  const last = line[line.length - 1];
  if (!last) return [];
  const p = pointsOf(line), n = p.length;
  if (n < 2) return [];
  const k = kOf(last, box), r = radiusOf(last, box);
  const toRound = ([x, y]: Pt): [number, number] => [x * box.w, (y * box.h) / k];
  const end = toRound(p[n - 1]!);
  let len = 0;
  for (let i = 1; i < n; i++) {
    const a = toRound(p[i - 1]!), b = toRound(p[i]!);
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (len < r * BULB_MIN_LENGTH) return [];
  const balls: Ball[] = [{ x: end[0], y: end[1], r: r * END_BULB }];
  const drops = Math.max(0, Math.min(DROPS_MOST, Math.floor(last.drops ?? 0)));
  if (drops === 0) return balls;
  const back = toRound(p[Math.max(0, n - 3)]!), ang = Math.atan2(end[1] - back[1], end[0] - back[0]);
  let h = 2166136261;
  for (const [x, y] of p) {
    h = Math.imul(h ^ Math.round(x * 1e4), 16777619);
    h = Math.imul(h ^ Math.round(y * 1e4), 16777619);
  }
  const rnd = mulberry32(h);
  for (let j = 0; j < drops; j++) {
    const d = r * (2.6 + j * 2.2 + rnd() * 2), aj = ang + (rnd() - 0.5) * 0.5;
    balls.push({ x: end[0] + Math.cos(aj) * d, y: end[1] + Math.sin(aj) * d, r: r * (0.35 + rnd() * 0.35) });
  }
  return balls;
}

/** A line being drawn: `to` adds the point the pen moved to (the first begins the line), `end` lifts the pen. Each returns the rectangle it touched. */
export interface Line {
  to(p: Pt): Rect;
  end(drops?: number): Rect;
}

/** Begin a pen line: each segment adds (1 - d^2/R^2)^3 within R = 2r, a point keeping the most any segment gives it. */
export function beginPen(grid: Grid, box: Box, brush: Brush): Line {
  if (grid.penOpen) throw new Error('a pen line is already open on this grid: end() it before beginning another');
  grid.penOpen = true;
  const k = kOf(brush, box), r = radiusOf(brush, box), R = 2 * r, R2 = R * R;
  const scope = (grid.scope ??= new Float32Array(grid.cols * grid.rows));
  const points: Pt[] = [];
  let at: [number, number] | null = null, scoped = empty(), ended = false;
  const segment = (ax: number, ay: number, bx: number, by: number): Rect => {
    const rect = rectOf(grid, Math.min(ax, bx) - R, Math.max(ax, bx) + R, (Math.min(ay, by) - R) * k, (Math.max(ay, by) + R) * k);
    const sx = bx - ax, sy = by - ay, L2 = sx * sx + sy * sy, inv = L2 > 0 ? 1 / L2 : 0;
    for (let j = rect.y0; j < rect.y1; j++) {
      const y = (grid.oy + j * grid.step) / k, py = y - ay, row = j * grid.cols;
      /* The part of the segment within R of this row (down), and so the columns its capsule can reach here. */
      let t0 = 0, t1 = 1;
      if (sy !== 0) {
        const u = (y - R - ay) / sy, v = (y + R - ay) / sy;
        t0 = Math.max(0, Math.min(u, v)); t1 = Math.min(1, Math.max(u, v));
        if (t0 > t1) continue;
      } else if (py * py >= R2) continue;
      const xa = ax + sx * t0, xb = ax + sx * t1, [i0, i1] = colsIn(grid, rect, Math.min(xa, xb) - R, Math.max(xa, xb) + R);
      if (grid.work) grid.work.visits += Math.max(0, i1 - i0);
      for (let i = i0; i < i1; i++) {
        const px = grid.ox + i * grid.step - ax;
        let t = (px * sx + py * sy) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * sx, ey = py - t * sy, d2 = ex * ex + ey * ey;
        if (d2 >= R2) continue;
        const q = 1 - d2 / R2, kv = q * q * q, m = row + i, had = scope[m]!;
        if (kv > had) { grid.values[m] = grid.values[m]! + (kv - had); scope[m] = kv; }
      }
    }
    scoped = unionRect(scoped, rect);
    return rect;
  };
  return {
    to(p) {
      if (ended) return empty();
      const last = points[points.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) return empty();
      points.push(p);
      const b: [number, number] = [p[0] * box.w, (p[1] * box.h) / k];
      const a = at ?? b;
      at = b;
      return segment(a[0], a[1], b[0], b[1]);
    },
    end(drops) {
      if (ended) return empty();
      ended = true;
      grid.penOpen = false;
      for (let j = scoped.y0; j < scoped.y1; j++) scope.fill(0, j * grid.cols + scoped.x0, j * grid.cols + scoped.x1);
      let touched = empty();
      for (const ball of endsOf([{ ...brush, points, drops }], box)) touched = unionRect(touched, addBall(grid, k, ball));
      return touched;
    },
  };
}

/* ------------------------------------------------------------------------------------------ wash ---- */

/**
 * Begin a wash line: a disc every max(1, r / 3) px along the path, each taking a share of `WASH_TAKES`. A line whose
 * whole path is shorter than R = 2r is a dab, a tap or a short drag: at `end` it is topped up at its last point so the
 * center there has taken `WASH_TAKES`, as a one-point line's does.
 */
export function beginWash(grid: Grid, box: Box, brush: Brush): Line {
  const k = kOf(brush, box), r = radiusOf(brush, box), R = 2 * r, h = Math.max(1, r / 3);
  const w = (WASH_TAKES * h) / (PASS_INTEGRAL * R);
  let at: [number, number] | null = null, carry = 0, ended = false, length = 0;
  /* The discs pressed while the path is still short of R, so the top-up knows what its last point already took. */
  const dabs: [number, number][] = [];
  /* One disc: every point with ink under it is lowered by take * falloff, never below zero, and marked washed. */
  const press = (cx: number, cy: number, take: number): Rect => {
    const rect = rectOf(grid, cx - R, cx + R, (cy - R) * k, (cy + R) * k), R2 = R * R;
    for (let j = rect.y0; j < rect.y1; j++) {
      const dy = (grid.oy + j * grid.step) / k - cy, dy2 = dy * dy, row = j * grid.cols;
      if (dy2 >= R2) continue;
      const half = Math.sqrt(R2 - dy2), [i0, i1] = colsIn(grid, rect, cx - half, cx + half);
      if (grid.work) grid.work.visits += Math.max(0, i1 - i0);
      for (let i = i0; i < i1; i++) {
        const m = row + i, v = grid.values[m]!;
        if (v <= 0) continue;
        const dx = grid.ox + i * grid.step - cx, d2 = dx * dx + dy2;
        if (d2 >= R2) continue;
        const q = 1 - d2 / R2, lowered = take * q * q * q;
        if (lowered <= 0) continue;
        grid.values[m] = Math.max(0, v - lowered);
        grid.washed[m] = 1;
      }
    }
    return rect;
  };
  return {
    to(p) {
      if (ended) return empty();
      const b: [number, number] = [p[0] * box.w, (p[1] * box.h) / k];
      if (!at) { at = b; dabs.push(b); return press(b[0], b[1], w); }
      const a = at, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) return empty();
      length += len;
      at = b;
      let touched = empty(), d = h - carry;
      for (; d <= len; d += h) {
        const cx = a[0] + ((b[0] - a[0]) * d) / len, cy = a[1] + ((b[1] - a[1]) * d) / len;
        if (length < R) dabs.push([cx, cy]);
        touched = unionRect(touched, press(cx, cy, w));
      }
      carry = len - (d - h);
      return touched;
    },
    end() {
      if (ended) return empty();
      ended = true;
      if (!at || length >= R) return empty();
      /* A dab: what its discs gave the last point (the falloff of each, round space) is topped up to a whole pass. */
      let given = 0;
      for (const [x, y] of dabs) { const q = 1 - ((x - at[0]) ** 2 + (y - at[1]) ** 2) / (R * R); given += w * q * q * q; }
      return press(at[0], at[1], WASH_TAKES - given);
    },
  };
}

/* ------------------------------------------------------------------------------------ whole lines ---- */

/** Begin a line of the brush's tool. */
export function beginLine(grid: Grid, box: Box, stroke: Pick<FieldStroke, 'tool' | 'width' | 'aspect'>): Line {
  return stroke.tool === 'ink' ? beginPen(grid, box, stroke) : beginWash(grid, box, stroke);
}

/** A line's pieces, whole, through one line object; the last piece's `drops` end it. Returns the rectangle touched. */
function drawLine(grid: Grid, box: Box, pieces: readonly FieldStroke[]): Rect {
  const first = pieces[0];
  if (!first) return empty();
  const line = beginLine(grid, box, first);
  let touched = empty();
  /* A throw mid-line must not leave the grid's pen open. */
  try {
    for (const piece of pieces) for (const p of piece.points) touched = unionRect(touched, line.to(p));
  } finally {
    const last = pieces[pieces.length - 1]!;
    touched = unionRect(touched, line.end(last.tool === 'ink' ? last.drops : undefined));
  }
  return touched;
}

/** A pen line's pieces (strokes joined by `continues`) in one scope, ends included. */
export function penLine(grid: Grid, box: Box, pieces: readonly FieldStroke[]): Rect {
  return pieces.length && pieces[0]!.tool === 'ink' ? drawLine(grid, box, pieces) : empty();
}
/** A wash line's pieces, the leftover distance carried across them. */
export function washLine(grid: Grid, box: Box, pieces: readonly FieldStroke[]): Rect {
  return pieces.length && pieces[0]!.tool === 'wash' ? drawLine(grid, box, pieces) : empty();
}

/** The strokes in order as lines: a stroke with `continues` joins the line before it. */
export function linesOf(strokes: readonly FieldStroke[]): FieldStroke[][] {
  const lines: FieldStroke[][] = [];
  for (const s of strokes) {
    const prev = lines[lines.length - 1];
    if (s.continues && prev && prev[0]!.tool === s.tool) prev.push(s);
    else lines.push([s]);
  }
  return lines;
}

/** Every stroke, in order, over what the grid holds. Returns the rectangle touched. */
export function strokesInto(grid: Grid, box: Box, strokes: readonly FieldStroke[]): Rect {
  let touched = empty();
  for (const line of linesOf(strokes)) touched = unionRect(touched, drawLine(grid, box, line));
  return touched;
}

/**
 * The field at one point (px), by the same operations over a one-point grid, with every line that reaches the point
 * replayed in order (a line that cannot reach it leaves a point's value as it was, so skipping it changes nothing).
 */
export function fieldAtPoint(splat: Splat, box: Box, strokes: readonly FieldStroke[], x: number, y: number): number {
  const grid = pointGrid(x, y);
  splatInto(grid, splat, box);
  for (const line of linesOf(strokes)) {
    const first = line[0]!, k = kOf(first, box), r = radiusOf(first, box);
    /* A pen's balls (bulb and drops) reach furthest: a drop is at most 9r out and 0.7r across, so 11r + its field's 2r covers them. */
    const pad = first.tool === 'ink' ? 13 * r : 2 * r;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const piece of line) for (const [px, py] of piece.points) {
      x0 = Math.min(x0, px * box.w); x1 = Math.max(x1, px * box.w);
      y0 = Math.min(y0, py * box.h); y1 = Math.max(y1, py * box.h);
    }
    if (x < x0 - pad || x > x1 + pad || y < y0 - pad * k || y > y1 + pad * k) continue;
    drawLine(grid, box, line);
  }
  return grid.values[0]!;
}
