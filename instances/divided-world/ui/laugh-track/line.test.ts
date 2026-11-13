/**
 * The reading band's arithmetic (docs/plans/2026-11-12-laugh-track-band-design.md, §1), over plain numbers, carried over from the bench
 * (docs/research/2026-11-11-laugh-track-bench/01-bench.html): where the line and the band round it are, whether a place is in the band, how
 * far it is from it (a pointer counts double), and how loud a murmur is at that distance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, distance, inBand, murmurGain, readingLine } from './line.ts';

test('the line is 40% of the way down the space above the HUD', () => {
  assert.equal(readingLine(900, 76, 40), 329.6);
  assert.equal(readingLine(900, 0, 10), 90);
  assert.equal(readingLine(600, 100, 90), 450);
});

const near = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('the band is its percent of the reading space, centered on the line', () => {
  const band = bandOf(800, 189, 40, 34);
  near(band.top, 244.4 - 103.87);
  near(band.bottom, 244.4 + 103.87);
});

test('a band that would pass the top of the window or the HUD\'s top is cut to the reading space', () => {
  const high = bandOf(800, 189, 10, 34);
  assert.equal(high.top, 0);
  near(high.bottom, 61.1 + 103.87);
  const low = bandOf(800, 189, 90, 34);
  near(low.top, 549.9 - 103.87);
  assert.equal(low.bottom, 611);
});

test('a band wider than the whole reading space is the whole space, and a band of 0 percent is a point at the line', () => {
  assert.deepEqual(bandOf(800, 189, 40, 200), { top: 0, bottom: 611 });
  const point = bandOf(800, 189, 40, 0);
  near(point.top, 244.4);
  near(point.bottom, 244.4);
});

test('a HUD taller than the window leaves no reading space, and the band is a point at 0, never inverted', () => {
  assert.deepEqual(bandOf(100, 150, 40, 34), { top: 0, bottom: 0 });
});

test('a place is in the band when the middle of any box is, and a box that only overlaps its edge is not', () => {
  const band = { top: 100, bottom: 300 };
  assert.equal(inBand([{ top: 190, bottom: 210, left: 0, right: 50 }], band), true);
  assert.equal(inBand([{ top: 0, bottom: 10, left: 0, right: 50 }, { top: 295, bottom: 305, left: 0, right: 50 }], band), true);
  assert.equal(inBand([{ top: 290, bottom: 330, left: 0, right: 50 }], band), false);
  assert.equal(inBand([{ top: 60, bottom: 110, left: 0, right: 50 }], band), false);
  assert.equal(inBand([], band), false);
});

test('the band\'s edges are inside it: a middle exactly on the top or the bottom is in the band', () => {
  const band = { top: 100, bottom: 300 };
  assert.equal(inBand([{ top: 90, bottom: 110, left: 0, right: 50 }], band), true);
  assert.equal(inBand([{ top: 290, bottom: 310, left: 0, right: 50 }], band), true);
  assert.equal(inBand([{ top: 89, bottom: 109, left: 0, right: 50 }], band), false);
  assert.equal(inBand([{ top: 291, bottom: 311, left: 0, right: 50 }], band), false);
});

test('a box of no height has its top for a middle', () => {
  const band = { top: 100, bottom: 300 };
  assert.equal(inBand([{ top: 200, bottom: 200, left: 0, right: 50 }], band), true);
  assert.equal(inBand([{ top: 100, bottom: 100, left: 0, right: 50 }], band), true);
  assert.equal(inBand([{ top: 301, bottom: 301, left: 0, right: 50 }], band), false);
  assert.equal(distance([{ top: 50, bottom: 50, left: 0, right: 50 }], band), 50);
});

test('a place in the band is at distance 0, and one off it is as far as its middle from the band\'s nearer edge', () => {
  const band = { top: 200, bottom: 400 };
  assert.equal(distance([{ top: 290, bottom: 310, left: 0, right: 50 }], band), 0);
  assert.equal(distance([{ top: 590, bottom: 610, left: 0, right: 50 }], band), 200);
  assert.equal(distance([{ top: 90, bottom: 110, left: 0, right: 50 }], band), 100);
});

test('a place of several lines is as near as its nearest line, and none is infinitely far', () => {
  const band = { top: 200, bottom: 400 };
  const lines = [{ top: 90, bottom: 110, left: 0, right: 50 }, { top: 430, bottom: 450, left: 0, right: 50 }];
  assert.equal(distance(lines, band), 40);
  assert.equal(distance([], band), Infinity);
});

test('a pointer\'s distance counts double, and it only ever brings a place nearer', () => {
  const band = { top: 200, bottom: 400 };
  const rect = { top: 600, bottom: 620, left: 100, right: 200 };
  assert.equal(distance([rect], band, { x: 150, y: 640 }), 40);
  assert.equal(distance([rect], band, { x: 230, y: 640 }), Math.hypot(30, 20) * 2);
  assert.equal(distance([rect], band, { x: 150, y: 610 }), 0);
  assert.equal(distance([rect], band, { x: 5000, y: 5000 }), 210);
});

test('the gain is the most at the line, nothing at the reach and linear between', () => {
  assert.equal(murmurGain(0, 192, 35), 0.35);
  assert.equal(murmurGain(192, 192, 35), 0);
  assert.equal(murmurGain(96, 192, 35), 0.175);
  assert.equal(murmurGain(400, 192, 35), 0);
  assert.equal(murmurGain(Infinity, 192, 35), 0);
  assert.equal(murmurGain(0, 0, 35), 0);
});
