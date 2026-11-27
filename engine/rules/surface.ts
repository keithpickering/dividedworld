/**
 * The surface's geometry: a 100 x 100 grid of cells over the box a play covers, in shares of the box. Pure, so the browser, the
 * server and the tests count the same cells. A cell is covered when a stroke's core holds its center.
 */
export const GRID = 100;
/** The grid as bits, row-major: bit `y * GRID + x`, most significant bit first within a byte, so `toBits` maps bit i to character i. */
export type Cells = Uint8Array;
export interface SurfaceStroke { readonly width: number; readonly aspect: number; readonly points: readonly (readonly [number, number])[] }

/** The bytes a grid's cells take. */
export const BYTES = (GRID * GRID) / 8;

/** Whether cell `i` is set. */
export const hasCell = (cells: Cells, i: number): boolean => (cells[i >> 3]! & (0x80 >> (i & 7))) !== 0;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Sets the cells of row `y` whose centers lie in the capsule of the segment A-B, in a space where the brush is a circle of radius `r`
 * (the y axis divided by the aspect). The capsule is convex, so the row's cells are one span: the union of the two end disks' chords
 * and the chord of the body between them, a parallelogram, each found by algebra and never by testing the cells.
 */
function paintRow(out: Cells, y: number, cy: number, ax: number, ay: number, bx: number, by: number, r: number): void {
  let lo = Infinity, hi = -Infinity;
  const disk = (px: number, py: number): void => {
    const h2 = r * r - (cy - py) * (cy - py);
    if (h2 < 0) return;
    const h = Math.sqrt(h2);
    lo = Math.min(lo, px - h); hi = Math.max(hi, px + h);
  };
  disk(ax, ay);
  if (ax !== bx || ay !== by) {
    disk(bx, by);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = (-dy / len) * r, ny = (dx / len) * r;
    // The body's four corners, in order round it; each side that crosses the row gives one end of the chord.
    const xs = [ax + nx, bx + nx, bx - nx, ax - nx], ys = [ay + ny, by + ny, by - ny, ay - ny];
    for (let i = 0; i < 4; i++) {
      const x0 = xs[i]!, y0 = ys[i]!, x1 = xs[(i + 1) % 4]!, y1 = ys[(i + 1) % 4]!;
      if ((y0 - cy) * (y1 - cy) > 0 || y0 === y1) continue;
      const x = x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
  }
  if (lo > hi) return;
  const from = Math.max(0, Math.ceil(lo * GRID - 0.5)), to = Math.min(GRID - 1, Math.floor(hi * GRID - 0.5));
  for (let x = from; x <= to; x++) { const i = y * GRID + x; out[i >> 3]! |= 0x80 >> (i & 7); }
}

/**
 * The cells whose centers (`(x + 0.5) / GRID`, `(y + 0.5) / GRID`) lie in a stroke's core: the capsule swept by an ellipse of radii
 * `width / 2` across and `width / 2 * aspect` down, in shares of the box (Whoops!'s brush). A single point is a dab. A stroke whose width
 * or aspect is not a positive number, or any of whose points is not a pair of numbers, covers nothing as a whole; a validator is what
 * refuses it. Cost is the rows a segment crosses, at most GRID, so a draw of 3,000 points is bounded however wide its brush.
 */
export function cellsOf(strokes: readonly SurfaceStroke[]): Cells {
  const out = new Uint8Array(BYTES);
  for (const s of strokes) {
    if (!finite(s.width) || !finite(s.aspect) || !(s.width > 0) || !(s.aspect > 0)) continue;
    if (s.points.some((p) => !finite(p[0]) || !finite(p[1]))) continue;
    const r = s.width / 2;
    // A point that repeats the one before it adds nothing; a stroke of one distinct point is a dab.
    const pts: [number, number][] = [];
    for (const p of s.points) if (pts.length === 0 || p[0] !== pts.at(-1)![0] || p[1] / s.aspect !== pts.at(-1)![1]) pts.push([p[0], p[1] / s.aspect]);
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]!, [bx, by] = pts[Math.min(k + 1, pts.length - 1)]!;
      const y0 = Math.max(0, Math.floor((Math.min(ay, by) - r) * s.aspect * GRID - 0.5)), y1 = Math.min(GRID - 1, Math.ceil((Math.max(ay, by) + r) * s.aspect * GRID - 0.5));
      for (let y = y0; y <= y1; y++) paintRow(out, y, (y + 0.5) / GRID / s.aspect, ax, ay, bx, by, r);
    }
  }
  return out;
}

const POP = Uint8Array.from({ length: 256 }, (_, n) => { let c = 0; for (let v = n; v; v >>= 1) c += v & 1; return c; });
/** How many cells are set. */
export function count(cells: Cells): number { let n = 0; for (const b of cells) n += POP[b]!; return n; }
/** The cells in either. A new grid; neither operand is changed. */
export function union(a: Cells, b: Cells): Cells { return a.map((v, i) => v | (b[i] ?? 0)); }
/** The cells in `a` and not in `b`. A new grid. */
export function minus(a: Cells, b: Cells): Cells { return a.map((v, i) => v & ~(b[i] ?? 0) & 0xff); }

/** Postgres `bit(10000)` text: character i is bit i, row-major. */
export function toBits(cells: Cells): string {
  let out = '';
  for (let i = 0; i < GRID * GRID; i++) out += (cells[i >> 3]! & (0x80 >> (i & 7))) !== 0 ? '1' : '0';
  return out;
}
/** The grid a `toBits` string names; a string that is not 10,000 zeros and ones throws. */
export function fromBits(bits: string): Cells {
  if (!/^[01]+$/.test(bits) || bits.length !== GRID * GRID) throw new Error(`a surface's cells are ${GRID * GRID} zeros and ones`);
  const out = new Uint8Array(BYTES);
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3]! |= 0x80 >> (i & 7);
  return out;
}

/**
 * Coats (docs/plans/2026-11-27-graffiti-everywhere-design.md, section 5): the paint's depth, one byte per cell in tenths of a coat, 0 to 40, row-major as
 * `toBits`. A cell is painted while it holds 2 tenths or more; at 1 or less it is clean and is kept as 0. Pure, so the browser, the server and the tests
 * count the same coats.
 */
export type Coats = Uint8Array;
/** The most tenths a cell holds: four coats. */
export const COAT_MAX = 40;
/** A cell holding at least this many tenths is painted. */
export const PAINTED = 2;
/** The coat string's alphabet: the index of a character is the tenths it names. */
export const COAT_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDE';

/** The coats of a drawing's strokes: each stroke adds `line` tenths to the cells of its own core, once however often it crosses itself, and a cell holds at most `most`. */
export function coatsOf(strokes: readonly SurfaceStroke[], rules: { readonly line: number; readonly most: number }): Coats {
  const out = new Uint8Array(GRID * GRID);
  // Static card config, but a Uint8Array wraps: the cap is held to 0..COAT_MAX and a negative or non-finite line adds nothing.
  const cap = Math.max(0, Math.min(finite(rules.most) ? rules.most : 0, COAT_MAX)), line = finite(rules.line) ? Math.max(0, rules.line) : 0;
  for (const s of strokes) {
    const cells = cellsOf([s]);
    for (let i = 0; i < out.length; i++) if (hasCell(cells, i)) out[i] = Math.min(cap, out[i]! + line);
  }
  return out;
}

/**
 * What a wash's presses take, in tenths per cell. Each press is a disc of radius `R = 2 * radius` (a share of the box's width; the y axis is divided by
 * `aspect`, as `cellsOf` does) taking `10 * PER * (1 - d^2/R^2)^3` at each cell center within R. `PER` is set so that presses every third of the radius
 * along a straight line take one coat (10 tenths) under its center: the integral of (1 - t^2)^3 over -1..1 is 32/35. The sum is rounded to whole tenths.
 * The cost is presses x (4R * GRID)^2 cells, held to the grid (at most presses x GRID^2), so the card bounds it: its `validateWash` caps the number of presses,
 * and the radius comes from the draw's own box, which its `validateDraw` keeps wide enough that the radius stays small.
 */
export function takesOf(presses: readonly (readonly [number, number])[], radius: number, aspect: number): Coats {
  const out = new Uint8Array(GRID * GRID);
  if (!finite(radius) || !finite(aspect) || !(radius > 0) || !(aspect > 0)) return out;
  const R = 2 * radius, per = (radius / 3) / ((R * 32) / 35);
  const sum = new Float64Array(GRID * GRID);
  for (const p of presses) {
    if (!finite(p[0]) || !finite(p[1])) continue;
    const py = p[1] / aspect;
    const y0 = Math.max(0, Math.floor((p[1] - R * aspect) * GRID - 0.5)), y1 = Math.min(GRID - 1, Math.ceil((p[1] + R * aspect) * GRID - 0.5));
    const x0 = Math.max(0, Math.floor((p[0] - R) * GRID - 0.5)), x1 = Math.min(GRID - 1, Math.ceil((p[0] + R) * GRID - 0.5));
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5) / GRID / aspect - py;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) / GRID - p[0];
        const q = (dx * dx + dy * dy) / (R * R);
        if (q >= 1) continue;
        sum[y * GRID + x]! += 10 * per * (1 - q) ** 3;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(COAT_MAX, Math.round(sum[i]!));
  return out;
}

/** The coats left once `b` is taken off `a`: each cell `max(0, a - b)`, with 1 or less set to 0. A new grid. */
export function minusCoats(a: Coats, b: Coats): Coats {
  return a.map((v, i) => { const left = Math.max(0, v - (b[i] ?? 0)); return left < PAINTED ? 0 : left; });
}

/** How many cells are painted: the ones holding 2 tenths or more. */
export function paintedCount(c: Coats): number { let n = 0; for (const v of c) if (v >= PAINTED) n++; return n; }

/** A coat string: one character per cell, row-major, over `COAT_ALPHABET`. */
export function toCoatString(c: Coats): string {
  let out = '';
  for (let i = 0; i < GRID * GRID; i++) out += COAT_ALPHABET[Math.min(COAT_MAX, c[i] ?? 0)]!;
  return out;
}
/** The coats a coat string names; a string that is not 10,000 characters of the alphabet throws. */
export function fromCoatString(s: string): Coats {
  if (s.length !== GRID * GRID) throw new Error(`a coat string is ${GRID * GRID} characters of ${COAT_ALPHABET}`);
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < s.length; i++) {
    const v = COAT_ALPHABET.indexOf(s[i]!);
    if (v < 0) throw new Error(`a coat string is ${GRID * GRID} characters of ${COAT_ALPHABET}`);
    out[i] = v;
  }
  return out;
}
/** The coats of a drawing that had only cells: `line` tenths on each set cell. */
export function legacyCoats(cells: Cells, line: number): Coats {
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < out.length; i++) if (hasCell(cells, i)) out[i] = Math.min(COAT_MAX, line);
  return out;
}
