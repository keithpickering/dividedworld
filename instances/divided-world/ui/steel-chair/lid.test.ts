/**
 * The can's lid (docs/plans/2026-11-23-steel-chair-objects-design.md, section 3, Task 6): at the can's hit the lid leaves it on an arc that goes out
 * of the content area through the top border or the nearer side border, and is gone. These tests hold the arc to what the picture needs: it is out of the
 * box within 1.2 s, it never comes back in once out (a lid that fell back onto the post would be a second chair), it is `done` by then, and the same
 * draws are the same arc.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng } from './body.ts';
import { lidArcOf, lidAt, LID_SECONDS } from './lid.ts';

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

test('the arc leaves the box within 1.2 s, never comes back in, and is done by then', () => {
  for (const box of BOXES) {
    for (const { seed, hitAt, arc } of arcs(box)) {
      assert.equal(outside(lidAt(arc, 0).position, box), false, `seed ${seed}: starts inside`);
      let left = -1;
      let doneAt = -1;
      for (let ms = 0; ms <= LID_SECONDS * 1000; ms++) {
        const at = lidAt(arc, ms / 1000);
        if (left < 0 && outside(at.position, box)) left = ms;
        if (left >= 0 && doneAt < 0) assert.equal(outside(at.position, box), true, `seed ${seed} ${JSON.stringify(box)}: back inside at ${ms} ms (left at ${left}, from ${JSON.stringify(hitAt)})`);
        if (at.done && doneAt < 0) doneAt = ms;
      }
      assert.ok(left >= 0, `seed ${seed} ${JSON.stringify(box)}: never leaves the box`);
      assert.ok(doneAt >= 0 && doneAt >= left, `seed ${seed}: done at ${doneAt}`);
      assert.equal(lidAt(arc, LID_SECONDS).done, true, `seed ${seed}: not done at 1.2 s`);
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

test('the arc goes out through the top border or the nearer side, both of which are drawn', () => {
  const box = BOXES[0]!;
  const exits = new Set<string>();
  for (const { hitAt, arc } of arcs(box)) {
    for (let t = 0; t <= LID_SECONDS; t += 0.002) {
      const p = lidAt(arc, t).position;
      if (!outside(p, box)) continue;
      exits.add(p.y < 0 ? 'top' : p.x < 0 ? (hitAt.x < box.width / 2 ? 'near-left' : 'far-left') : p.x > box.width ? (hitAt.x > box.width / 2 ? 'near-right' : 'far-right') : 'bottom');
      break;
    }
  }
  assert.ok(exits.has('top'), `${[...exits]}`);
  assert.ok(exits.has('near-left') && exits.has('near-right'), `${[...exits]}`);
  assert.equal([...exits].some((e) => e.startsWith('far') || e === 'bottom'), false, `${[...exits]}`);
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
