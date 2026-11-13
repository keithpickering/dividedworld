import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, cellsOf, count, fromBits, minus, toBits, union, type Cells, type SurfaceStroke } from './surface.ts';

const has = (c: Cells, x: number, y: number): boolean => (c[(y * GRID + x) >> 3]! & (0x80 >> ((y * GRID + x) & 7))) !== 0;
const rowCount = (c: Cells, y: number): number => { let n = 0; for (let x = 0; x < GRID; x++) if (has(c, x, y)) n++; return n; };
const rowsCovered = (c: Cells): number => { let n = 0; for (let y = 0; y < GRID; y++) if (rowCount(c, y) > 0) n++; return n; };
const bar = (aspect: number, width = 0.04): SurfaceStroke => ({ width, aspect, points: [[0.1, 0.5], [0.9, 0.5]] });
const of = (...cells: [number, number][]): Cells => {
  const c = new Uint8Array((GRID * GRID) / 8);
  for (const [x, y] of cells) c[(y * GRID + x) >> 3]! |= 0x80 >> ((y * GRID + x) & 7);
  return c;
};

test('a horizontal stroke across the middle covers row 50, and not rows 45 or 55', () => {
  const c = cellsOf([bar(1)]);
  assert.ok(rowCount(c, 50) > 70, 'row 50 is covered along the stroke');
  assert.equal(rowCount(c, 45), 0);
  assert.equal(rowCount(c, 55), 0);
});

test('aspect scales the rows a stroke covers down, so 0.5 covers half as many', () => {
  const full = rowsCovered(cellsOf([bar(1)]));
  const half = rowsCovered(cellsOf([bar(0.5)]));
  assert.equal(full, 4);
  assert.equal(half * 2, full);
});

test('a dab covers the one cell whose center it holds', () => {
  const c = cellsOf([{ width: 0.012, aspect: 1, points: [[0.505, 0.505]] }]);
  assert.equal(count(c), 1);
  assert.equal(has(c, 50, 50), true);
});

test('a stroke with no points or a malformed brush covers nothing', () => {
  assert.equal(count(cellsOf([{ width: 0.04, aspect: 1, points: [] }, { width: 0.04, aspect: 0, points: [[0.5, 0.5]] }, { width: Number.NaN, aspect: 1, points: [[0.5, 0.5]] }])), 0);
});

test('union, minus and count on hand-built grids', () => {
  const a = of([0, 0], [1, 0], [99, 99]);
  const b = of([1, 0], [2, 0]);
  assert.equal(count(a), 3);
  assert.equal(count(union(a, b)), 4);
  assert.deepEqual(minus(a, b), of([0, 0], [99, 99]));
  assert.deepEqual(minus(b, a), of([2, 0]));
  assert.equal(count(minus(a, a)), 0);
  assert.equal(count(a), 3, 'the operands are not changed');
});

test('toBits and fromBits round-trip, row-major, and an empty grid is 10,000 zeros', () => {
  assert.equal(toBits(new Uint8Array(1250)), '0'.repeat(10000));
  const c = of([0, 0], [7, 0], [8, 0], [0, 1], [99, 99]);
  const bits = toBits(c);
  assert.equal(bits.length, 10000);
  for (const i of [0, 7, 8, 100, 9999]) assert.equal(bits[i], '1', String(i));
  assert.equal(count(c), (bits.match(/1/g) ?? []).length);
  assert.deepEqual(fromBits(bits), c);
  assert.throws(() => fromBits('01'), /10000/);
});

/** The definition, cell by cell: a center within the capsule of every segment. The reference the fast version must equal. */
function brute(strokes: readonly SurfaceStroke[]): Cells {
  const out = new Uint8Array((GRID * GRID) / 8);
  for (const s of strokes) {
    if (s.points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    const r = s.width / 2;
    for (let k = 0; k < s.points.length; k++) {
      const [ax, ay] = s.points[k]!, [bx, by] = s.points[Math.min(k + 1, s.points.length - 1)]!;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const cx = (x + 0.5) / GRID, cy = (y + 0.5) / GRID / s.aspect, py = ay / s.aspect, qy = by / s.aspect;
        const dx = bx - ax, dy = qy - py, l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - py) * dy) / l2));
        if ((cx - ax - t * dx) ** 2 + (cy - py - t * dy) ** 2 <= r * r) out[(y * GRID + x) >> 3]! |= 0x80 >> ((y * GRID + x) & 7);
      }
    }
  }
  return out;
}
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const zigzag = (n: number, strokes: number, width: number, aspect: number, seed: number): SurfaceStroke[] => {
  const next = rng(seed);
  return Array.from({ length: strokes }, () => ({ width, aspect, points: Array.from({ length: n }, (_, i): [number, number] => [next(), i % 2 === 0 ? next() * 0.1 : 0.9 + next() * 0.1]) }));
};

test('the fast count equals the cell-by-cell definition, across widths and aspects', () => {
  for (const [w, a] of [[0.25, 1], [0.04, 2.5], [0.1, 0.4], [0.013, 1.3]] as const) {
    const strokes = zigzag(6, 3, w, a, Math.round(w * 1000 + a));
    assert.deepEqual(cellsOf(strokes), brute(strokes), `${w} x ${a}`);
  }
});

test('the worst draw (120 strokes, 3,000 points, the widest brush, across the whole box) is cheap', () => {
  const worst = zigzag(25, 120, 0.25, 1, 7);
  assert.equal(worst.reduce((n, s) => n + s.points.length, 0), 3000);
  const t0 = performance.now();
  const c = cellsOf(worst);
  const ms = performance.now() - t0;
  assert.ok(count(c) > 9000, 'it covers nearly the box');
  assert.ok(ms < 250, `took ${ms.toFixed(0)} ms; the bound is 250`);
  const diagonal = Array.from({ length: 120 }, () => ({ width: 0.25, aspect: 4, points: Array.from({ length: 25 }, (_, i): [number, number] => (i % 2 ? [0.02, 0.02] : [0.98, 0.98])) }));
  const t1 = performance.now();
  cellsOf(diagonal);
  assert.ok(performance.now() - t1 < 250, 'a wide, tall diagonal zigzag is cheap too');
});

test('a stroke with a point that is not a number covers nothing, and is not joined across', () => {
  const bad: SurfaceStroke = { width: 0.04, aspect: 1, points: [[0.1, 0.5], [Number.NaN, 0.5], [0.9, 0.5]] };
  assert.equal(count(cellsOf([bad])), 0);
  assert.equal(count(cellsOf([{ ...bad, points: [[0.1, 0.5], [0.5, Number.POSITIVE_INFINITY]] }])), 0);
  assert.deepEqual(cellsOf([bad, bar(1)]), cellsOf([bar(1)]), 'the others still count');
});

test('a stroke partly outside the box is clipped, and one wholly outside covers nothing', () => {
  const half = cellsOf([{ width: 0.04, aspect: 1, points: [[-0.5, 0.5], [0.5, 0.5]] }]);
  assert.equal(rowCount(half, 50), 52, "to the cap of the stroke's end, 0.52");
  assert.equal(count(cellsOf([{ width: 0.04, aspect: 1, points: [[1.5, 0.5], [2, 0.5]] }, { width: 0.04, aspect: 1, points: [[0.5, -3], [0.5, -2]] }])), 0);
  assert.deepEqual(half, brute([{ width: 0.04, aspect: 1, points: [[-0.5, 0.5], [0.5, 0.5]] }]));
});

test('an L-shaped polyline covers both legs and not the empty corner', () => {
  const c = cellsOf([{ width: 0.04, aspect: 1, points: [[0.2, 0.2], [0.2, 0.8], [0.8, 0.8]] }]);
  assert.equal(has(c, 20, 50), true);
  assert.equal(has(c, 50, 80), true);
  assert.equal(has(c, 50, 20), false);
  assert.equal(has(c, 80, 50), false);
});

test('a two-point stroke of no length is a dab, and a tall brush covers more rows than a flat one', () => {
  const dab = cellsOf([{ width: 0.1, aspect: 1, points: [[0.5, 0.5]] }]);
  assert.deepEqual(cellsOf([{ width: 0.1, aspect: 1, points: [[0.5, 0.5], [0.5, 0.5]] }]), dab);
  assert.equal(rowsCovered(cellsOf([bar(2)])), 8);
  assert.deepEqual(cellsOf([bar(2)]), brute([bar(2)]));
});

test('a brush of no width or a negative one covers nothing', () => {
  assert.equal(count(cellsOf([bar(1, 0), bar(1, -0.04)])), 0);
});

test('fromBits refuses ten thousand characters that are not all zeros and ones', () => {
  assert.throws(() => fromBits('2' + '0'.repeat(9999)), /10000/);
});
