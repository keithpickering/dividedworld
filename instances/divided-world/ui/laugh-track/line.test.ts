/**
 * The reading line's arithmetic (docs/plans/2026-11-12-laugh-track-point-design.md, §2), over plain numbers, carried over from the bench
 * (docs/research/2026-11-11-laugh-track-bench/01-bench.html): where the line is, how far a place is from it (a pointer counts double), how
 * near that is from 0 to 1, and how loud a murmur is at that nearness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, murmurGain, nearness, readingLine } from './line.ts';

test('the line is 40% of the way down the space above the HUD', () => {
  assert.equal(readingLine(900, 76, 40), 329.6);
  assert.equal(readingLine(900, 0, 10), 90);
  assert.equal(readingLine(600, 100, 90), 450);
});

const box = (top: number, bottom: number, left = 0, right = 50) => ({ top, bottom, left, right });

test('a place with the line inside a box is at distance 0, edges included', () => {
  assert.equal(distance([box(190, 210)], 200), 0);
  assert.equal(distance([box(200, 220)], 200), 0);
  assert.equal(distance([box(180, 200)], 200), 0);
  assert.equal(distance([box(200, 200)], 200), 0);
});

test('a place off the line is as far as its nearer edge, above or below', () => {
  assert.equal(distance([box(100, 150)], 200), 50);
  assert.equal(distance([box(260, 300)], 200), 60);
});

test('a place of several lines is as near as its nearest box, and none is infinitely far', () => {
  assert.equal(distance([box(90, 110), box(230, 250)], 200), 30);
  assert.equal(distance([], 200), Infinity);
});

test('a pointer\'s distance counts double, and it only ever brings a place nearer', () => {
  const rect = box(600, 620, 100, 200);
  assert.equal(distance([rect], 200, { x: 150, y: 640 }), 40);
  assert.equal(distance([rect], 200, { x: 230, y: 640 }), Math.hypot(30, 20) * 2);
  assert.equal(distance([rect], 200, { x: 150, y: 610 }), 0);
  assert.equal(distance([rect], 200, { x: 5000, y: 5000 }), 400);
});

test('nearness is 1 on the line, 0 at the reach and past it, and linear between', () => {
  assert.equal(nearness(0, 192), 1);
  assert.equal(nearness(96, 192), 0.5);
  assert.equal(nearness(192, 192), 0);
  assert.equal(nearness(400, 192), 0);
  assert.equal(nearness(Infinity, 192), 0);
});

test('nearness is 0 for a reach of 0 or less, or a distance that is not a number', () => {
  assert.equal(nearness(0, 0), 0);
  assert.equal(nearness(0, -5), 0);
  assert.equal(nearness(NaN, 192), 0);
});

test('the gain is the most at the line, nothing at the reach and linear between', () => {
  assert.equal(murmurGain(0, 192, 35), 0.35);
  assert.equal(murmurGain(192, 192, 35), 0);
  assert.equal(murmurGain(96, 192, 35), 0.175);
  assert.equal(murmurGain(400, 192, 35), 0);
  assert.equal(murmurGain(Infinity, 192, 35), 0);
  assert.equal(murmurGain(0, 0, 35), 0);
});
