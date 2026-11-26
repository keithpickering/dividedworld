/** The extinguisher's puff model: the billow's front, the floor it gives the fog field, the fade and its end (design section 4). */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PUFF, puffAlpha, puffDone, puffFront, puffTarget } from './puff.ts';

const BOX = { width: 600, height: 80 };
const SPOUTS: readonly { x: number; y: number }[] = [{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 590, y: 75 }, { x: 40, y: 70 }];
const MID = { x: 300, y: 40 };
const farthest = (s: { x: number; y: number }, b: { width: number; height: number }): number =>
  Math.max(...([[0, 0], [b.width, 0], [0, b.height], [b.width, b.height]] as const).map(([x, y]) => Math.hypot(x - s.x, y - s.y)));

describe('puffFront', () => {
  test('is 0 at 0 ms', () => { for (const s of SPOUTS) assert.equal(puffFront(s, BOX, 0), 0); });
  test('covers the farthest corner at billowMs, and stays there after', () => {
    for (const s of SPOUTS) {
      assert.ok(puffFront(s, BOX, PUFF.billowMs) > farthest(s, BOX));
      assert.equal(puffFront(s, BOX, PUFF.billowMs + 5000), puffFront(s, BOX, PUFF.billowMs));
    }
  });
  test('grows without shrinking, and is eased out (more than half the way by half the time)', () => {
    const s = MID; let prev = 0;
    for (let ms = 0; ms <= PUFF.billowMs; ms += 20) { const f = puffFront(s, BOX, ms); assert.ok(f >= prev); prev = f; }
    assert.ok(puffFront(s, BOX, PUFF.billowMs / 2) > puffFront(s, BOX, PUFF.billowMs) / 2);
  });
});

describe('puffTarget', () => {
  test('allows no fog outside the front and all of it inside', () => {
    const s = MID, ms = PUFF.billowMs / 3, front = puffFront(s, BOX, ms), t = puffTarget(s, BOX, ms);
    assert.equal(t(s.x, s.y), 1);
    assert.equal(t(s.x + front * 0.9, s.y), 1);
    assert.equal(t(s.x + front * 1.1, s.y), 0);
    assert.equal(t(s.x, s.y - front * 1.1), 0);
  });
  test('is the front\'s disc: the same answer as a distance taken with hypot, at every point of a grid', () => {
    for (const s of SPOUTS) for (const ms of [1, 100, 300, PUFF.billowMs]) {
      const front = puffFront(s, BOX, ms), t = puffTarget(s, BOX, ms);
      for (let x = -20; x <= BOX.width + 20; x += 7) for (let y = -20; y <= BOX.height + 20; y += 7) assert.equal(t(x, y), Math.hypot(x - s.x, y - s.y) <= front ? 1 : 0);
    }
  });
  test('is clear everywhere at 0 ms away from the spout, and full everywhere once the billow is done', () => {
    const s = { x: 0, y: 0 };
    assert.equal(puffTarget(s, BOX, 0)(300, 40), 0);
    const done = puffTarget(s, BOX, PUFF.billowMs);
    for (const [x, y] of [[0, 0], [600, 0], [0, 80], [600, 80], [300, 40]] as const) assert.equal(done(x, y), 1);
  });
});

describe('puffAlpha and puffDone', () => {
  test('is full through the billow and the hold', () => {
    for (const ms of [0, 100, PUFF.billowMs, PUFF.billowMs + PUFF.holdMs]) assert.equal(puffAlpha(ms), PUFF.full);
  });
  test('falls in a straight line to 0 over the fade', () => {
    const t0 = PUFF.billowMs + PUFF.holdMs;
    assert.ok(Math.abs(puffAlpha(t0 + PUFF.fadeMs / 2) - PUFF.full / 2) < 1e-9);
    assert.ok(Math.abs(puffAlpha(t0 + PUFF.fadeMs / 4) - PUFF.full * 0.75) < 1e-9);
    assert.equal(puffAlpha(t0 + PUFF.fadeMs), 0);
    assert.equal(puffAlpha(t0 + PUFF.fadeMs + 1000), 0);
  });
  test('is done at the end of the fade and no sooner', () => {
    const end = PUFF.billowMs + PUFF.holdMs + PUFF.fadeMs;
    assert.equal(puffDone(0), false);
    assert.equal(puffDone(end - 1), false);
    assert.equal(puffDone(end), true);
    assert.equal(puffDone(end + 1), true);
  });
});
