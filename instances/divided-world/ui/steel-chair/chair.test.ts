/**
 * The chair's pieces and shade (docs/plans/2026-11-15-steel-chair-plan.md, Task 4): shut, the pieces are the 46 by 90 by 8 box the
 * body simulates; open, the seat stands 88 degrees from the back frame and the rear frame -32 degrees.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BOX, piecesOf, shadeOf, type Piece } from './chair.ts';

/** A piece's corners in the chair's frame: its centered rectangle through its column-major matrix. */
function corners(p: Piece): [number, number, number][] {
  const m = p.matrix;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * p.width) / 2;
    const y = (sy * p.height) / 2;
    return [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13], m[2] * x + m[6] * y + m[14]] as [number, number, number];
  });
}
const byName = (ps: Piece[], name: string) => ps.find((p) => p.name === name)!;

describe('piecesOf', () => {
  test('shut, every piece fits inside the 46 by 90 by 8 box', () => {
    const ps = piecesOf(0);
    assert.ok(ps.length > 4);
    for (const p of ps) for (const [x, y, z] of corners(p)) {
      assert.ok(Math.abs(x) <= BOX.width / 2 + 1e-6);
      assert.ok(Math.abs(y) <= BOX.height / 2 + 1e-6);
      assert.ok(Math.abs(z) <= BOX.depth / 2 + 1e-6);
    }
  });
  test('shut, the seat and the rear frame lie in the back frame plane (normals along z)', () => {
    for (const n of ['seat', 'rear']) assert.ok(Math.abs(Math.abs(byName(piecesOf(0), n).normal[2]) - 1) < 1e-6);
  });
  test("open, the seat's top edge lies on the hinge line (within the 2 px the seat is set back from it)", () => {
    const seat = byName(piecesOf(1), 'seat');
    const hingeY = BOX.height / 2 - 58;
    const edge = corners(seat).sort((p, q) => Math.hypot(p[1] - hingeY, p[2]) - Math.hypot(q[1] - hingeY, q[2])).slice(0, 2);
    assert.ok(Math.abs(edge[0][0] - edge[1][0]) > 41, 'the two nearest corners are the ends of one edge');
    for (const [, y, z] of edge) assert.ok(Math.hypot(y - hingeY, z) <= 2 + 1e-6, `corner at y ${y}, z ${z} is off the hinge line ${hingeY}`);
  });
  test('at a fold of 0.5 the seat is half way: 44 degrees from the back frame', () => {
    const ps = piecesOf(0.5);
    const angle = (n: number[]) => Math.atan2(n[1], n[2]) * 180 / Math.PI;
    assert.ok(Math.abs(Math.abs(angle(byName(ps, 'seat').normal) - angle(byName(ps, 'back').normal)) - 44) < 1e-3);
  });
  test("every piece's left and top are minus half its size", () => {
    for (const f of [0, 1]) for (const p of piecesOf(f)) {
      assert.equal(p.left, -p.width / 2, p.name);
      assert.equal(p.top, -p.height / 2, p.name);
    }
  });
  test('sizes: back frame 46 by 90, backrest 42 by 26, seat 42 by 38, rear 42 by 58', () => {
    const ps = piecesOf(1);
    const size = (n: string) => [byName(ps, n).width, byName(ps, n).height];
    assert.deepEqual(size('back'), [46, 90]);
    assert.deepEqual(size('backrest'), [42, 26]);
    assert.deepEqual(size('seat'), [42, 38]);
    assert.deepEqual(size('rear'), [42, 58]);
  });
  test('a tube is two strips crossed at right angles', () => {
    const tubes = piecesOf(1).filter((p) => p.kind === 'tube');
    assert.equal(tubes.length % 2, 0);
    assert.ok(tubes.length > 0);
    const [a, b] = tubes;
    const dot = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2];
    assert.ok(Math.abs(dot) < 1e-9);
  });
});

describe('shadeOf', () => {
  const rgb = (b: number) => `rgb(${b}, ${b + 6}, ${b + 16})`;
  test('the three axes', () => {
    assert.equal(shadeOf([0, 0, 1]), rgb(220));
    assert.equal(shadeOf([0, -1, 0]), rgb(190));
    assert.equal(shadeOf([0, 1, 0]), rgb(110));
    assert.equal(shadeOf([1, 0, 0]), rgb(150));
  });
  test('clamps to 60 and 235', () => {
    assert.equal(shadeOf([0, -2, 2]), rgb(235));
    assert.equal(shadeOf([0, 5, 0]), rgb(60));
  });
  test('a back-facing piece is as bright as a front-facing one', () => {
    assert.equal(shadeOf([0, 0, -1]), shadeOf([0, 0, 1]));
  });
});
