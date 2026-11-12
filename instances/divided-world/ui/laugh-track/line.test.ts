/**
 * The reading line's arithmetic (docs/plans/2026-11-11-laugh-track-plan.md, Task 13), over plain numbers, carried over from the bench
 * (docs/research/2026-11-11-laugh-track-bench/01-bench.html): where the line is, how far a place is from it (a pointer counts double), and
 * how loud a murmur is at that distance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, murmurGain, readingLine } from './line.ts';

test('the line is 40% of the way down the space above the HUD', () => {
  assert.equal(readingLine(900, 76, 40), 329.6);
  assert.equal(readingLine(900, 0, 10), 90);
  assert.equal(readingLine(600, 100, 90), 450);
});

test('a place on the line is at distance 0, and one off it is as far as its nearest edge', () => {
  assert.equal(distance([{ top: 300, bottom: 320, left: 0, right: 50 }], 310), 0);
  assert.equal(distance([{ top: 400, bottom: 420, left: 0, right: 50 }], 310), 90);
  assert.equal(distance([{ top: 100, bottom: 120, left: 0, right: 50 }], 310), 190);
});

test('a place of several lines is as near as its nearest line, and none is infinitely far', () => {
  const lines = [{ top: 100, bottom: 120, left: 0, right: 50 }, { top: 330, bottom: 350, left: 0, right: 50 }];
  assert.equal(distance(lines, 310), 20);
  assert.equal(distance([], 310), Infinity);
});

test('a pointer\'s distance counts double, and it only ever brings a place nearer', () => {
  const rect = { top: 600, bottom: 620, left: 100, right: 200 };
  assert.equal(distance([rect], 310, { x: 150, y: 640 }), 40);
  assert.equal(distance([rect], 310, { x: 230, y: 640 }), Math.hypot(30, 20) * 2);
  assert.equal(distance([rect], 310, { x: 150, y: 610 }), 0);
  assert.equal(distance([rect], 610, { x: 5000, y: 5000 }), 0);
});

test('the gain is the most at the line, nothing at the reach and linear between', () => {
  assert.equal(murmurGain(0, 192, 35), 0.35);
  assert.equal(murmurGain(192, 192, 35), 0);
  assert.equal(murmurGain(96, 192, 35), 0.175);
  assert.equal(murmurGain(400, 192, 35), 0);
  assert.equal(murmurGain(Infinity, 192, 35), 0);
  assert.equal(murmurGain(0, 0, 35), 0);
});
