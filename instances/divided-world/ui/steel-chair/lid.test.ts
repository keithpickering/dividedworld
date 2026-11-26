/**
 * The can's lid (docs/plans/2026-11-23-steel-chair-objects-design.md, section 3, Task 6): at the can's hit the lid leaves it on an arc that goes out
 * of the content area through the nearer side border (or falls out of the bottom of a wide one), and is gone. These tests hold the arc to what the picture needs: it is out of the
 * box within 1.2 s, it never comes back in once out (a lid that fell back onto the post would be a second chair), it is `done` by then, and the same
 * draws are the same arc.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng } from './body.ts';
import { lidArcOf, lidAt, LID_SECONDS, LID_SPEED } from './lid.ts';

const BOXES = [{ width: 640, height: 330 }, { width: 340, height: 520 }, { width: 980, height: 240 }, { width: 300, height: 1600 }];
const SEEDS = 500;
const outside = (p: { x: number; y: number }, box: { width: number; height: number }): boolean => p.x < 0 || p.x > box.width || p.y < 0 || p.y > box.height;

/** The arcs of one box: the hit is drawn from the same generator, anywhere in the box's middle. */
function arcs(box: { width: number; height: number }) {
  return Array.from({ length: SEEDS }, (_, seed) => {
    const rand = rng(seed + 1);
    const hitAt = { x: box.width * (0.15 + 0.7 * rand()), y: box.height * (0.15 + 0.45 * rand()) };
    return { seed, hitAt, arc: lidArcOf(rand, hitAt, box) };
  });
}

test('the arc leaves through the nearer side or falls out of the bottom, never the top, never back in, and is done by 1.2 s', () => {
  for (const box of BOXES) {
    for (const { seed, hitAt, arc } of arcs(box)) {
      assert.equal(outside(lidAt(arc, 0).position, box), false, `seed ${seed}: starts inside`);
      const near = hitAt.x < box.width / 2 ? -1 : 1;
      let left = -1;
      let doneAt = -1;
      for (let ms = 0; ms <= LID_SECONDS * 1000; ms++) {
        const at = lidAt(arc, ms / 1000);
        const p = at.position;
        if (left < 0 && outside(p, box)) {
          left = ms;
          const via = p.y > box.height ? 'bottom' : p.x < 0 ? 'left' : 'right';
          assert.ok(via === 'bottom' || via === (near < 0 ? 'left' : 'right'), `seed ${seed} ${JSON.stringify(box)}: out through ${via}, from ${JSON.stringify(hitAt)}`);
        }
        assert.ok(p.y >= 0, `seed ${seed} ${JSON.stringify(box)}: through the top at ${ms} ms`);
        if (left >= 0 && doneAt < 0) assert.equal(outside(p, box), true, `seed ${seed} ${JSON.stringify(box)}: back inside at ${ms} ms (left at ${left})`);
        if (at.done && doneAt < 0) doneAt = ms;
      }
      assert.ok(doneAt >= 0 && (left < 0 || doneAt >= left), `seed ${seed}: done at ${doneAt}`);
      assert.equal(lidAt(arc, LID_SECONDS).done, true, `seed ${seed}: not done at 1.2 s`);
      /* A lid still inside the box when it is done has faded out first, never popped. */
      const end = lidAt(arc, doneAt / 1000);
      if (!outside(end.position, box)) assert.ok(lidAt(arc, LID_SECONDS).opacity <= 0.001, `seed ${seed}: pops inside the box`);
    }
  }
});

test('the lid is whole while it is in view: opaque until it is well out, and gone by the time it is done', () => {
  for (const { seed, arc } of arcs(BOXES[0]!)) {
    assert.equal(lidAt(arc, 0).opacity, 1, `seed ${seed}`);
    const end = lidAt(arc, LID_SECONDS);
    assert.ok(end.opacity <= 0.001 || end.done, `seed ${seed}`);
    for (let t = 0; t <= LID_SECONDS; t += 0.01) {
      const o = lidAt(arc, t).opacity;
      assert.ok(o >= 0 && o <= 1, `seed ${seed} t ${t}: ${o}`);
    }
  }
});

test('the arc goes out through the nearer side, both sides are drawn, and a wide post lets it fall out of the bottom', () => {
  const exits = new Set<string>();
  for (const box of [BOXES[0]!, BOXES[2]!]) {
    for (const { hitAt, arc } of arcs(box)) {
      for (let t = 0; t <= LID_SECONDS; t += 0.002) {
        const p = lidAt(arc, t).position;
        if (!outside(p, box)) continue;
        exits.add(p.y > box.height ? 'bottom' : p.x < 0 ? (hitAt.x < box.width / 2 ? 'near-left' : 'far-left') : (hitAt.x > box.width / 2 ? 'near-right' : 'far-right'));
        break;
      }
    }
  }
  assert.ok(exits.has('near-left') && exits.has('near-right') && exits.has('bottom'), `${[...exits]}`);
  assert.equal([...exits].some((e) => e.startsWith('far')), false, `${[...exits]}`);
});

test('the same draws are the same arc, and the orientation is a rotation', () => {
  const box = BOXES[0]!;
  const a = lidArcOf(rng(9), { x: 200, y: 100 }, box), b = lidArcOf(rng(9), { x: 200, y: 100 }, box);
  assert.deepEqual(lidAt(a, 0.4), lidAt(b, 0.4));
  const m = lidAt(a, 0.37).matrix;
  assert.equal(m.length, 16);
  const col = (c: number) => [m[c * 4]!, m[c * 4 + 1]!, m[c * 4 + 2]!];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(Math.hypot(...(col(c) as [number, number, number])) - 1) < 1e-9);
});

test('the lid is launched at 550 px/s, give or take a tenth, 30 degrees (give or take 8) off straight up toward the nearer side', () => {
  assert.equal(LID_SPEED, 550);
  const box = BOXES[0]!;
  for (const [hitAt, sign] of [[{ x: 70, y: 150 }, -1], [{ x: 570, y: 150 }, 1]] as const) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const arc = lidArcOf(rng(seed + 1), hitAt, box);
      const speed = Math.hypot(arc.vx, arc.vy);
      assert.ok(speed >= 0.9 * LID_SPEED - 1e-9 && speed <= 1.1 * LID_SPEED + 1e-9, `seed ${seed}: ${speed}`);
      const off = Math.atan2(Math.abs(arc.vx), -arc.vy) * 180 / Math.PI;
      assert.ok(off >= 22 - 1e-9 && off <= 38 + 1e-9, `seed ${seed}: ${off} degrees`);
      assert.equal(Math.sign(arc.vx), sign, `seed ${seed}`);
    }
  }
});
