/**
 * The surface's geometry: a 100 x 100 grid of cells over the box a play covers, in shares of the box. Pure, so the browser, the
 * server and the tests count the same cells. A cell is covered when a stroke's core holds its center.
 */
export const GRID = 100;
/** The grid as bits, row-major: bit `y * GRID + x`, most significant bit first within a byte, so `toBits` maps bit i to character i. */
export type Cells = Uint8Array;
export interface SurfaceStroke { readonly width: number; readonly aspect: number; readonly points: readonly (readonly [number, number])[] }

const BYTES = (GRID * GRID) / 8;

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
