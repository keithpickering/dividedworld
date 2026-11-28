/**
 * Heads Will Roll's orbit, as numbers (docs/plans/2026-11-27-season-two-cards-design.md, section 2.2): the heads' masses and sizes, the suns and their
 * satellites, and the projection to the content area, with no DOM. Each test names the defect it is for; the bench's two bugs (a wall clamp with negative
 * room that flipped a sun between two places every frame, and a system wider than its box) are the box-narrower-than-the-system and 200 px cases.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/heads-will-roll/orbit.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORBIT, createOrbit, headMass, headSize, reelSeconds, type HeadSpec, type Orbit } from './orbit.ts';

const DT = 1 / 60;
const SECONDS = 60;
/** The bench's six kinds (an Overreaction among them) and the React head: the heads of a busy post. */
const BUSY: readonly HeadSpec[] = [
  { id: 'laugh', count: 14 }, { id: 'fire', count: 6 }, { id: 'clap', count: 3 }, { id: 'roll', count: 2 }, { id: 'skull', count: 1 },
  { id: 'pizza', count: 4, local: true }, { id: 'react', count: 0, react: true },
];

/** Every box a viewer might read a post in: a phone's 200 px, a wide 900 px, a box narrower than its system, and a short, wide one. */
const BOXES = [{ width: 200, height: 320 }, { width: 900, height: 420 }, { width: 70, height: 260 }, { width: 600, height: 150 }];

/** The shown box of a head: its center, plus or minus half its size at its scale. */
const edges = (h: { x: number; y: number; size: number; scale: number }) => { const half = h.size * h.scale / 2; return { left: h.x - half, right: h.x + half, top: h.y - half, bottom: h.y + half }; };

function run(o: Orbit, seconds: number, each: (frame: number) => void): void {
  for (let i = 0; i < seconds / DT; i++) { o.step(DT); each(i); }
}

test('a head weighs its count, an Overreaction head its count times the multiple, and the React head nothing', () => {
  assert.equal(headMass({ id: 'a', count: 5 }, ORBIT.defaults), 5);
  assert.equal(headMass({ id: 'a', count: 5, local: true }, ORBIT.defaults), 10);
  assert.equal(headMass({ id: 'a', count: 5, local: true }, { ...ORBIT.defaults, overMass: 3.5 }), 17.5);
  assert.equal(headMass({ id: 'r', count: 9, react: true }, ORBIT.defaults), 0);
  assert.equal(headMass({ id: 'a', count: 0 }, ORBIT.defaults), 1, 'a head always weighs something');
});

test('a head is its least plus a step for each root of its mass, never past a share of the width, and the React head is mid-sized', () => {
  assert.equal(headSize(1, false, 900), ORBIT.least + ORBIT.perRoot);
  assert.equal(headSize(16, false, 900), ORBIT.least + 4 * ORBIT.perRoot);
  assert.equal(headSize(10_000, false, 900), ORBIT.share * 900);
  assert.equal(headSize(10_000, false, 200), ORBIT.share * 200, 'a phone caps at its own share');
  assert.equal(headSize(0, true, 900), ORBIT.reactSize);
  assert.ok(headSize(0, true, 900) > ORBIT.least && headSize(0, true, 900) < headSize(100, false, 900), 'above the least a head can be, below a heavy one');
});

for (const box of BOXES) {
  test(`${box.width} px: for ${SECONDS} s no head's box crosses the area's borders, none moves more than 4 px a step, and the angle never outruns its cap`, () => {
    const o = createOrbit(box, { seed: 7 });
    o.setHeads(BUSY);
    const cap = ORBIT.defaults.mostTurns * 2 * Math.PI;
    const before = new Map(o.project().map((h) => [h.id, h]));
    let worstStep = 0, worstTurn = 0, worstOut = 0;
    run(o, SECONDS, () => {
      for (const h of o.project()) {
        const e = edges(h), was = before.get(h.id)!;
        // A box narrower than a head cannot hold it, so what is asked there is that the head is centered rather than that its edges are in.
        worstOut = Math.max(worstOut, -e.left, e.right - box.width, -e.top, e.bottom - box.height);
        worstStep = Math.max(worstStep, Math.hypot(h.x - was.x, h.y - was.y));
        worstTurn = Math.max(worstTurn, Math.abs(h.angle - was.angle) / DT);
        before.set(h.id, h);
      }
    });
    assert.ok(worstOut <= 0.001, `a head ended ${worstOut.toFixed(2)} px past a border`);
    assert.ok(worstStep <= 4, `a head moved ${worstStep.toFixed(2)} px in one step`);
    assert.ok(worstTurn <= cap * 1.0001, `a head turned ${worstTurn.toFixed(2)} rad/s against a cap of ${cap.toFixed(2)}`);
  });
}

test('the same, after the heads change mid-run (a new kind, a count that grows) and the box is resized', () => {
  const o = createOrbit({ width: 200, height: 320 }, { seed: 3 });
  o.setHeads(BUSY.slice(0, 4));
  run(o, 5, () => {});
  o.setHeads([...BUSY, { id: 'new', count: 1 }]);
  const was = new Map(o.project().map((h) => [h.id, h]));
  run(o, 20, () => {
    for (const h of o.project()) {
      const e = edges(h);
      assert.ok(e.left >= -0.001 && e.right <= 200.001 && e.top >= -0.001 && e.bottom <= 320.001, `${h.id} crossed a border`);
      const w = was.get(h.id);
      if (w) assert.ok(Math.hypot(h.x - w.x, h.y - w.y) <= 4, `${h.id} jumped`);
      was.set(h.id, h);
    }
  });
  o.setBox({ width: 900, height: 420 });
  run(o, 10, () => {
    for (const h of o.project()) { const e = edges(h); assert.ok(e.left >= -0.001 && e.right <= 900.001 && e.top >= -0.001 && e.bottom <= 420.001, `${h.id} crossed a border after a resize`); }
  });
});

test('two suns of equal mass end at least the sum of their sizes apart, on a phone and on a wide box', () => {
  for (const box of BOXES.slice(0, 2)) {
    const o = createOrbit(box, { seed: 11 });
    o.setHeads([{ id: 'a', count: 9 }, { id: 'b', count: 9 }, { id: 'c', count: 2 }, { id: 'd', count: 1 }]);
    run(o, SECONDS, () => {});
    const [a, b] = ['a', 'b'].map((id) => o.bodies().find((x) => x.id === id)!);
    assert.equal(a!.sun, null); assert.equal(b!.sun, null);
    const d = Math.hypot(a!.X - b!.X, a!.Y - b!.Y, a!.Z - b!.Z);
    assert.ok(d >= a!.size + b!.size, `${box.width} px: the suns are ${d.toFixed(1)} apart, sizes sum to ${a!.size + b!.size}`);
  }
});

test('a satellite stays on its sun\'s ring, and heavier satellites hold nearer rings', () => {
  const o = createOrbit({ width: 900, height: 420 }, { seed: 5 });
  o.setHeads(BUSY);
  const worst = { off: 0 };
  run(o, 30, () => {
    for (const s of o.bodies()) {
      if (!s.sun) continue;
      const sun = o.bodies().find((x) => x.id === s.sun)!;
      const d = Math.hypot(s.X - sun.X, s.Y - sun.Y, s.Z - sun.Z);
      worst.off = Math.max(worst.off, Math.abs(d / s.ring - 1));
    }
  });
  assert.ok(worst.off <= ORBIT.ringTolerance, `a satellite left its ring by ${(worst.off * 100).toFixed(1)}%`);
  const sats = o.bodies().filter((b) => b.sun !== null);
  assert.ok(sats.length >= 3);
  for (const sun of new Set(sats.map((s) => s.sun))) {
    const mine = sats.filter((s) => s.sun === sun).sort((a, b) => a.ring - b.ring);
    for (let i = 1; i < mine.length; i++) assert.ok(mine[i - 1]!.mass >= mine[i]!.mass, 'a lighter satellite sits on a nearer ring than a heavier one');
  }
});

test('the heaviest heads are the suns, as many as the setting says, and the React head is never one while a kind is on the post', () => {
  const o = createOrbit({ width: 900, height: 420 }, { seed: 1, settings: { suns: 3 } });
  o.setHeads(BUSY);
  const suns = o.bodies().filter((b) => b.sun === null).map((b) => b.id).sort();
  assert.deepEqual(suns, ['fire', 'laugh', 'pizza']); // pizza: 4 x 2 = 8, over fire's 6
  assert.ok(o.bodies().find((b) => b.id === 'react')!.sun !== null);
  const one = createOrbit({ width: 900, height: 420 }, { seed: 1, settings: { suns: 4 } });
  one.setHeads([{ id: 'only', count: 3 }, { id: 'react', count: 0, react: true }]);
  assert.deepEqual(one.bodies().filter((b) => b.sun === null).map((b) => b.id), ['only']);
  const alone = createOrbit({ width: 300, height: 300 }, { seed: 1 });
  alone.setHeads([{ id: 'react', count: 0, react: true }]);
  run(alone, 5, () => {});
  assert.equal(alone.project().length, 1, 'the React head alone floats free');
});

test('a box narrower than the system holds the fit: a sun with negative room is parked, never flipped between two places', () => {
  const o = createOrbit({ width: 60, height: 200 }, { seed: 2 });
  o.setHeads(BUSY);
  let prev = o.project();
  let flips = 0;
  run(o, 20, () => {
    const now = o.project();
    for (let i = 0; i < now.length; i++) if (Math.hypot(now[i]!.x - prev[i]!.x, now[i]!.y - prev[i]!.y) > 4) flips++;
    for (const h of now) assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.scale) && Number.isFinite(h.angle), 'no NaN');
    prev = now;
  });
  assert.equal(flips, 0);
  for (const b of o.bodies()) assert.ok(Math.abs(b.X) <= 30 && Math.abs(b.Z) <= 30, `${b.id} is outside the box in depth or breadth`);
});

test('the stack order is far to near, and the tab order heaviest first with the React head last', () => {
  const o = createOrbit({ width: 900, height: 420 }, { seed: 9 });
  o.setHeads(BUSY);
  run(o, 3, () => {});
  const shown = o.project();
  assert.deepEqual(shown.map((h) => h.id), ['laugh', 'pizza', 'fire', 'clap', 'roll', 'skull', 'react']);
  assert.deepEqual(shown.map((h) => h.rank).sort((a, b) => a - b), shown.map((_, i) => i), 'ranks are a permutation');
  const far = shown.find((h) => h.rank === 0)!, near = shown.find((h) => h.rank === shown.length - 1)!;
  assert.ok(far.depth >= near.depth);
});

test('the same seed and heads give the same orbit, and heads that are not stepped stand still', () => {
  const a = createOrbit({ width: 400, height: 300 }, { seed: 4 }), b = createOrbit({ width: 400, height: 300 }, { seed: 4 });
  a.setHeads(BUSY); b.setHeads(BUSY);
  run(a, 2, () => {}); run(b, 2, () => {});
  assert.deepEqual(a.project(), b.project());
  assert.deepEqual(a.project(), a.project());
});

test('the reel-in takes the base plus the per-speed share of speed over size, and a head reports its own speed in widths a second', () => {
  assert.equal(reelSeconds(0, ORBIT.defaults), ORBIT.defaults.reelBase);
  assert.ok(Math.abs(reelSeconds(5, ORBIT.defaults) - (0.8 + 0.12 * 5)) < 1e-9);
  const o = createOrbit({ width: 900, height: 420 }, { seed: 6 });
  o.setHeads(BUSY);
  assert.ok(o.project().every((h) => h.speed === 0), 'before it moves a head has no speed');
  run(o, 5, () => {});
  assert.ok(o.project().some((h) => h.speed > 0));
});
