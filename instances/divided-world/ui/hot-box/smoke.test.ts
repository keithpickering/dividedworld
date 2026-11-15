/**
 * The smoke's pure half (docs/plans/2026-11-15-hot-box-plan.md, Task 3): its numbers, the strength a play has left,
 * a clearing's openness and coverage, the drifting puffs and a held sweep's place. No DOM and no clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMOKE, covered, fogAlpha, holeRadius, maskAlpha, openness, puffAt, puffs, strength, sweepAt, type Clearing } from './smoke.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('the numbers are the plan\'s', () => {
  assert.equal(SMOKE.full, 0.94); assert.equal(SMOKE.least, 0.45); assert.equal(SMOKE.hole, 90);
  assert.equal(SMOKE.edge, 0.35); assert.equal(SMOKE.roll, 2500); assert.equal(SMOKE.touchHold, 4000);
  assert.equal(SMOKE.waved, 20000); assert.equal(SMOKE.puffArea, 1800);
});

test('strength is 1 at playedAt, a straight line down to 0 at ends, clamped, and 1 for a time that is no time', () => {
  assert.equal(strength(1000, 1000, 5000), 1);
  assert.equal(strength(5000, 1000, 5000), 0);
  near(strength(3000, 1000, 5000), 0.5);
  near(strength(2000, 1000, 5000), 0.75);
  assert.equal(strength(0, 1000, 5000), 1);
  assert.equal(strength(9000, 1000, 5000), 0);
  assert.equal(strength(NaN, 1000, 5000), 1);
  assert.equal(strength(3000, NaN, 5000), 1);
  assert.equal(strength(3000, 1000, Infinity), 1);
  assert.equal(strength(3000, 1000, undefined as unknown as number), 1);
});

test('fogAlpha runs from full to least, and maskAlpha is always its complement', () => {
  near(fogAlpha(1), 0.94); near(fogAlpha(0), 0.45); near(fogAlpha(0.5), 0.695);
  near(maskAlpha(1), 0.06); near(maskAlpha(0), 0.55); near(maskAlpha(0.5), 0.305);
  for (const s of [0, 0.1, 0.5, 0.77, 1]) near(maskAlpha(s), 1 - fogAlpha(s));
});

test('a hole is 90 px, never under 56 and never over 22% of the box (the floor wins in a box too narrow for both)', () => {
  assert.equal(holeRadius(400), 88);
  assert.equal(holeRadius(2000), 90);
  assert.equal(holeRadius(200), 56);
  assert.equal(holeRadius(0), 56);
  assert.equal(holeRadius(NaN), 56);
  assert.equal(holeRadius(410), 90);
});

const still: Clearing = { x: 0, y: 0, openedAt: 0, leftAt: null, hold: 0 };

test('openness: 1 while the pointer is there and for hold after, then down to 0 over roll', () => {
  const c: Clearing = { x: 0, y: 0, openedAt: 0, leftAt: 1000, hold: 4000 };
  assert.equal(openness(still, 99999, false), 1);
  assert.equal(openness(c, 1000, false), 1);
  assert.equal(openness(c, 5000, false), 1);
  near(openness(c, 5000 + 1250, false), 0.5);
  assert.equal(openness(c, 5000 + 2500, false), 0);
  assert.equal(openness(c, 99999, false), 0);
  const mouse: Clearing = { ...c, hold: 0 };
  assert.equal(openness(mouse, 1000, false), 1);
  near(openness(mouse, 1000 + 625, false), 0.75);
  assert.equal(openness(mouse, 3500, false), 0);
  assert.equal(openness({ ...still, openedAt: 500 }, 100, false), 0);
});

test('openness under reduced motion is 1 or 0, changing where the animated one starts to close', () => {
  const c: Clearing = { x: 0, y: 0, openedAt: 0, leftAt: 1000, hold: 4000 };
  assert.equal(openness(still, 99999, true), 1);
  assert.equal(openness(c, 5000, true), 1);
  assert.equal(openness(c, 5001, true), 0);
  assert.equal(openness(c, 5000 + 1250, true), 0);
  const seen = new Set<number>();
  for (let t = 0; t < 10000; t += 50) seen.add(openness(c, t, true));
  assert.deepEqual([...seen].sort(), [0, 1]);
});

test('coverage: 0 at a clearing\'s center and inside its clear core, between at the rim, 1 beyond and with none', () => {
  const c: Clearing = { x: 100, y: 100, openedAt: 0, leftAt: null, hold: 0 };
  const r = 80;
  assert.equal(covered(100, 100, [c], r, 0, false), 0);
  assert.equal(covered(100 + r * (1 - SMOKE.edge), 100, [c], r, 0, false), 0);
  near(covered(100 + r * (1 - SMOKE.edge / 2), 100, [c], r, 0, false), 0.5);
  assert.equal(covered(100 + r, 100, [c], r, 0, false), 1);
  assert.equal(covered(1000, 1000, [c], r, 0, false), 1);
  assert.equal(covered(100, 100, [], r, 0, false), 1);
  const going: Clearing = { ...c, leftAt: 0, hold: 0 };
  near(covered(100, 100, [going], r, 1250, false), 0.5);
  assert.equal(covered(100, 100, [going], r, 2500, false), 1);
});

test('two overlapping clearings: the more open one wins at a point, and the fog is 0 where either is clear', () => {
  const a: Clearing = { x: 100, y: 100, openedAt: 0, leftAt: null, hold: 0 };
  const b: Clearing = { x: 150, y: 100, openedAt: 0, leftAt: null, hold: 0 };
  const r = 80;
  assert.equal(covered(125, 100, [a, b], r, 0, false), 0);
  const between = covered(125, 100, [a], r, 0, false);
  assert.equal(covered(125, 100, [a, b], r, 0, false), Math.min(between, covered(125, 100, [b], r, 0, false)));
  const closing: Clearing = { ...b, leftAt: 0, hold: 0 };
  assert.equal(covered(150, 100, [a, closing], r, 1250, false), Math.min(covered(150, 100, [a], r, 0, false), 0.5));
  assert.equal(covered(100, 100, [closing, a], r, 1250, false), 0);
});

test('two partly closed clearings overlapping at a rim point: each is weighted by its openness, and the more open one wins', () => {
  const r = 40; // core 26
  const a: Clearing = { x: 100, y: 100, openedAt: 0, leftAt: 0, hold: 0 }; // 0.5 open at 1250
  const b: Clearing = { x: 158, y: 100, openedAt: 0, leftAt: -625, hold: 0 }; // 0.25 open at 1250
  near(openness(a, 1250, false), 0.5); near(openness(b, 1250, false), 0.25);
  // at x = 130: 30 px from a (local 4/14) and 28 px from b (local 2/14)
  near(covered(130, 100, [a, b], r, 1250, false), 9 / 14);
  near(covered(130, 100, [b, a], r, 1250, false), 9 / 14);
  near(covered(130, 100, [b], r, 1250, false), 11 / 14);
});

test('strength with ends at or before playedAt: 1 until ends, 0 from then on', () => {
  assert.equal(strength(999, 1000, 1000), 1);
  assert.equal(strength(1000, 1000, 1000), 0);
  assert.equal(strength(1001, 1000, 1000), 0);
  assert.equal(strength(499, 1000, 500), 1);
  assert.equal(strength(500, 1000, 500), 0);
  assert.equal(strength(700, 1000, 500), 0);
  assert.equal(strength(2000, 1000, 500), 0);
});

test('puffs: the same seed gives the same puffs, another gives others, nothing reads Math.random, and the count is clamped', () => {
  const real = Math.random; let calls = 0;
  Math.random = () => { calls++; return real(); };
  try {
    assert.deepEqual(puffs(7, 600, 400), puffs(7, 600, 400));
    assert.notDeepEqual(puffs(7, 600, 400), puffs(8, 600, 400));
  } finally { Math.random = real; }
  assert.equal(calls, 0);
  assert.equal(puffs(1, 10, 10).length, 24);
  assert.equal(puffs(1, 0, 0).length, 24);
  assert.equal(puffs(1, 3000, 3000).length, 160);
  assert.equal(puffs(1, 360, 360).length, 72);
  for (const p of puffs(3, 600, 400)) {
    assert.ok(p.x >= 0 && p.x < 600 && p.y >= 0 && p.y < 400 && p.r > 0);
  }
});

test('a puff drifts and wraps at the box\'s edges; at t = 0 it is where it was made', () => {
  const p = puffs(5, 600, 400)[0]!;
  const at0 = puffAt(p, 0, 600, 400);
  near(at0.x, p.x); near(at0.y, p.y); near(at0.r, p.r);
  assert.ok(at0.shade >= -1 && at0.shade <= 1);
  assert.notEqual(puffAt(p, 5000, 600, 400).x, at0.x);
  for (const t of [0, 1000, 123456, 99999999]) {
    const q = puffAt(p, t, 600, 400);
    assert.ok(q.x >= 0 && q.x < 600 && q.y >= 0 && q.y < 400, `${t}: ${q.x}, ${q.y}`);
  }
  const fast = { x: 590, y: 10, r: 20, dx: 100, dy: -100, phase: 0 };
  const w = puffAt(fast, 1000, 600, 400);
  near(w.x, 90); near(w.y, 310);
  assert.deepEqual(puffAt(p, 12345, 600, 400), puffAt(p, 12345, 600, 400));
  assert.doesNotThrow(() => puffAt(p, 1000, 0, 0));
});

const LINES = [{ top: 0, bottom: 20 }, { top: 20, bottom: 40 }, { top: 40, bottom: 60 }];

test('a sweep over three lines finishes each in width / pace seconds, left to right, then drops to the next', () => {
  const W = 400, PACE = 400; // one second a line
  let s = sweepAt(LINES, 0, W, PACE);
  assert.deepEqual([s.x, s.y, s.finished, s.done], [0, 10, -1, false]);
  s = sweepAt(LINES, 500, W, PACE);
  assert.deepEqual([s.x, s.y, s.finished, s.done], [200, 10, -1, false]);
  s = sweepAt(LINES, 999, W, PACE);
  assert.equal(s.finished, -1);
  s = sweepAt(LINES, 1000, W, PACE);
  assert.deepEqual([s.x, s.y, s.finished, s.done], [0, 30, 0, false]);
  s = sweepAt(LINES, 1500, W, PACE);
  assert.deepEqual([s.x, s.y, s.finished, s.done], [200, 30, 0, false]);
  s = sweepAt(LINES, 2000, W, PACE);
  assert.deepEqual([s.x, s.y, s.finished, s.done], [0, 50, 1, false]);
  s = sweepAt(LINES, 2999, W, PACE);
  assert.equal(s.finished, 1); assert.equal(s.done, false);
  s = sweepAt(LINES, 3000, W, PACE);
  assert.equal(s.finished, 2); assert.equal(s.done, true);
  s = sweepAt(LINES, 99999, W, PACE);
  assert.equal(s.finished, 2); assert.equal(s.done, true);
  assert.equal(sweepAt(LINES, 2000, 800, 400).finished, 0);
  assert.equal(sweepAt(LINES, 2000, 800, 800).finished, 1);
});

test('a sweep depends on elapsed time and nothing else (no reduced-motion argument), and has odd inputs in hand', () => {
  assert.equal(sweepAt.length, 4);
  assert.deepEqual(sweepAt(LINES, 1234, 400, 400), sweepAt(LINES, 1234, 400, 400));
  assert.equal(sweepAt(LINES, -50, 400, 400).finished, -1);
  const none = sweepAt([], 0, 400, 400);
  assert.equal(none.done, true); assert.equal(none.finished, -1);
  assert.equal(sweepAt(LINES, 0, 0, 400).done, true);
  assert.equal(sweepAt(LINES, 0, 400, 0).done, true);
  assert.equal(sweepAt(LINES, 0, 400, NaN).done, true);
  assert.equal(sweepAt(LINES, 0, -400, -400).done, true);
  assert.equal(sweepAt(LINES, 0, 0, 400).y, 50);
  const inf = sweepAt(LINES, Infinity, 400, 400);
  assert.equal(inf.done, true); assert.equal(inf.finished, 2);
  const nan = sweepAt(LINES, NaN, 400, 400);
  assert.deepEqual([nan.x, nan.finished, nan.done], [0, -1, false]);
});
