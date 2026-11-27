/**
 * The smoke's pure half (docs/plans/2026-11-15-hot-box-plan.md, Task 3; the trail, docs/plans/2026-11-15-hot-box-fog-design.md
 * section 3.1): its numbers, the strength a play has left, a clearing's openness and coverage, the pointer's trail and a held sweep's place. No DOM and no clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMOKE, airedTop, covered, extendTrail, fogAlpha, hardDiscs, hardOpen, holeRadius, maskAlpha, openness, strength, sweepAt, trailOpenness, type Clearing, type TrailPoint } from './smoke.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('the numbers are the plan\'s', () => {
  assert.equal(SMOKE.full, 0.94); assert.equal(SMOKE.least, 0.45); assert.equal(SMOKE.hole, 90);
  assert.equal(SMOKE.edge, 0.35); assert.equal(SMOKE.roll, 2500); assert.equal(SMOKE.touchHold, 4000);
  assert.equal(SMOKE.waved, 20000);
  assert.equal(SMOKE.wake, 1500); assert.equal(SMOKE.trailStep, 1 / 3); assert.equal(SMOKE.trailHard, 0.5);
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

const R = 90;

test('the trail takes a point only after a third of a radius of travel, and a still pointer adds none', () => {
  const first = extendTrail([], 10, 20, 100, R);
  assert.deepEqual(first, [{ x: 10, y: 20, leftAt: 100 }]);
  assert.equal(extendTrail(first, 10, 20, 116, R).length, 1);
  assert.equal(extendTrail(first, 10 + R * SMOKE.trailStep - 1, 20, 116, R).length, 1);
  const moved = extendTrail(first, 10 + R * SMOKE.trailStep, 20, 116, R);
  assert.deepEqual(moved, [{ x: 10, y: 20, leftAt: 100 }, { x: 10 + R * SMOKE.trailStep, y: 20, leftAt: 116 }]);
  assert.equal(first.length, 1, 'the trail it was given is not changed');
});

test('the trail drops points a wake old and never holds more than the wake needs at a frame each', () => {
  const old: TrailPoint = { x: 0, y: 0, leftAt: 0 };
  assert.equal(extendTrail([old], 500, 0, SMOKE.wake - 1, R).length, 2);
  assert.deepEqual(extendTrail([old], 500, 0, SMOKE.wake, R), [{ x: 500, y: 0, leftAt: SMOKE.wake }]);
  assert.deepEqual(extendTrail([old], 0, 0, SMOKE.wake, R), []);
  const cap = Math.ceil(SMOKE.wake / 16) + 1;
  let trail: TrailPoint[] = [];
  for (let i = 0; i < 10000; i++) {
    trail = extendTrail(trail, i * R, 0, i, R);
    assert.ok(trail.length <= cap, `${i}: ${trail.length} points`);
    assert.ok(trail.every((p) => i - p.leftAt < SMOKE.wake));
  }
  assert.equal(trail.length, cap);
  assert.equal(trail[trail.length - 1]!.leftAt, 9999);
  assert.equal(trail[0]!.leftAt, 9999 - cap + 1, 'the oldest are the ones dropped');
});

test('a trail point is open at once and closes in a straight line over the wake; reduced motion switches at trailHard of it', () => {
  const p: TrailPoint = { x: 0, y: 0, leftAt: 1000 };
  assert.equal(trailOpenness(p, 1000, false), 1);
  near(trailOpenness(p, 1750, false), 0.5);
  assert.equal(trailOpenness(p, 2500, false), 0);
  assert.equal(trailOpenness(p, 99999, false), 0);
  assert.equal(trailOpenness(p, 500, false), 1);
  assert.equal(trailOpenness(p, 1749, true), 1);
  assert.equal(trailOpenness(p, 1750, true), 0);
  const seen = new Set<number>();
  for (let t = 1000; t < 3000; t += 10) seen.add(trailOpenness(p, t, true));
  assert.deepEqual([...seen].sort(), [0, 1]);
});

test('coverage with a trail: the point the pointer left 300 ms ago is partly open, and without the trail it is fog', () => {
  const trail: TrailPoint[] = [{ x: 100, y: 100, leftAt: 0 }];
  near(covered(100, 100, [], R, 300, false, trail), 0.2);
  assert.equal(covered(100, 100, [], R, 300, false), 1);
  assert.equal(covered(100, 100, [], R, 300, false, []), 1);
  assert.equal(covered(100 + R, 100, [], R, 300, false, trail), 1, 'the trail point has the same rim a clearing has');
  near(covered(100 + R * (1 - SMOKE.edge / 2), 100, [], R, 0, false, trail), 0.5);
  const c: Clearing = { x: 100, y: 100, openedAt: 0, leftAt: null, hold: 0 };
  assert.equal(covered(100, 100, [c], R, 300, false, trail), 0, 'the most open of a clearing and a trail point wins');
  const closing: Clearing = { ...c, leftAt: 0, hold: 0 };
  near(covered(100, 100, [closing], R, 1250, false, [{ x: 100, y: 100, leftAt: 1000 }]), 250 / SMOKE.wake, 1e-9);
  assert.equal(covered(100, 100, [], R, 1500, false, trail), 1);
  assert.equal(covered(100, 100, [], R, 749, true, trail), 0);
  assert.equal(covered(100, 100, [], R, 750, true, trail), 1);
});

test('hardOpen (forced colors): a clearing at least trailHard open and a trail point younger than trailHard of the wake show the words', () => {
  const c: Clearing = { x: 100, y: 100, openedAt: 0, leftAt: null, hold: 0 };
  assert.equal(hardOpen(100, 100, [c], [], R, 0), true);
  assert.equal(hardOpen(100 + R - 1, 100, [c], [], R, 0), true);
  assert.equal(hardOpen(100 + R, 100, [c], [], R, 0), false);
  assert.equal(hardOpen(100, 100, [], [], R, 0), false);
  for (const dx of [0, R / 2, R, R + 50]) {
    assert.equal(hardOpen(100 + dx, 100, [c], [], R, 0), covered(100 + dx, 100, [c], R, 0, false) < 1 - SMOKE.trailHard, `${dx}`);
  }
  const closing: Clearing = { ...c, leftAt: 0, hold: 0 };
  assert.equal(hardOpen(100, 100, [closing], [], R, 1249), true);
  assert.equal(hardOpen(100, 100, [closing], [], R, 1251), false);
  const trail: TrailPoint[] = [{ x: 300, y: 100, leftAt: 0 }];
  assert.equal(hardOpen(300, 100, [], trail, R, 749), true);
  assert.equal(hardOpen(300, 100, [], trail, R, 750), false);
  assert.equal(hardOpen(300 + R - 1, 100, [], trail, R, 749), true);
  assert.equal(hardOpen(300 + R, 100, [], trail, R, 749), false);
});

test('hardDiscs lists a clearing at least half open and a trail point younger than trailHard of the wake, and hardOpen is true exactly inside a listed disc', () => {
  const now = 1000, half = SMOKE.roll * SMOKE.trailHard;
  /* A clearing left `age` ms ago with no hold is `1 - age / roll` open. */
  const clearing = (x: number, age: number): Clearing => ({ x, y: 100, openedAt: 0, leftAt: now - age, hold: 0 });
  const whole = clearing(100, 0), justOpen = clearing(300, half), justShut = clearing(500, half + 1), gone = clearing(700, SMOKE.roll);
  const young: TrailPoint = { x: 900, y: 100, leftAt: now - (SMOKE.trailHard * SMOKE.wake - 1) }, old: TrailPoint = { x: 1100, y: 100, leftAt: now - SMOKE.trailHard * SMOKE.wake };
  const discs = hardDiscs([whole, justOpen, justShut, gone], [young, old], now);
  assert.deepEqual(discs.map((d) => d.x), [100, 300, 900]);
  for (const d of [whole, justOpen, justShut, gone, young, old]) {
    const listed = discs.some((l) => l.x === d.x);
    assert.equal(hardOpen(d.x, 100, [whole, justOpen, justShut, gone], [young, old], R, now), listed, `at ${d.x}`);
    assert.equal(hardOpen(d.x + R - 1, 100, [whole, justOpen, justShut, gone], [young, old], R, now), listed, `inside the rim at ${d.x}`);
    assert.equal(hardOpen(d.x + R, 100, [whole, justOpen, justShut, gone], [young, old], R, now), false, `at the rim at ${d.x}`);
  }
});

test('airedTop: 0 for no share, the share of the box for a saved one, the whole box for clean, at three box heights', () => {
  for (const h of [200, 600, 1234]) {
    assert.equal(airedTop(undefined, h), 0);
    assert.equal(airedTop({}, h), 0);
    near(airedTop({ aired: 0.25 }, h), h * 0.25);
    near(airedTop({ aired: 0.9999 }, h), h * 0.9999);
    assert.equal(airedTop({ clean: true }, h), h);
  }
});

test('airedTop takes only what the card keeps: a share out of 0 to 1, a clean that is not true, a state that is no object and a box that is no size give 0', () => {
  for (const bad of [{ aired: 0 }, { aired: 1 }, { aired: -0.5 }, { aired: NaN }, { aired: '0.5' }, { clean: false }, { clean: 'yes' }, null, 7, 'clean', []]) assert.equal(airedTop(bad, 600), 0, JSON.stringify(bad));
  assert.equal(airedTop({ aired: 0.5 }, NaN), 0);
  assert.equal(airedTop({ aired: 0.5 }, -10), 0);
  assert.equal(airedTop({ clean: true }, 0), 0);
});
