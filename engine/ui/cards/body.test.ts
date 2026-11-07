/**
 * The share of a shine effect's density a painted box is drawn at (engine/ui/cards/body.ts `paintScale`): a post painting its whole
 * body costs no more pixels than its words' box did at full density, down to a floor of half the density for a post of a line or two.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paintScale, paintShare } from './body.ts';

describe('paintScale', () => {
  test('a box no bigger than the words is drawn at full density', () => {
    assert.equal(paintScale(1000, 1000), 1);
    assert.equal(paintScale(1000, 400), 1);
  });
  test('a body twice the words\' area is drawn at 1/sqrt(2) of the density: the same pixels', () => {
    assert.ok(Math.abs(paintScale(1000, 2000) - Math.SQRT1_2) < 1e-10);
    const s = paintScale(924 * 65, 943 * 135);
    assert.ok(Math.abs(943 * 135 * s * s - 924 * 65) < 1e-3);
  });
  test('a line of words in a tall body is drawn at no less than half the density', () => {
    assert.equal(paintScale(924 * 22, 943 * 276), 0.5);
    assert.equal(paintScale(0, 1000), 0.5);
  });
  test('an empty box is drawn at full density (it holds no pixels)', () => {
    assert.equal(paintScale(0, 0), 1);
  });
});

/**
 * The share of the redraw rate a shine effect's painted box is redrawn at (`paintShare`): the screen area its redraws change in a second
 * stays what its words' box changed at the full rate, down to a floor of a quarter of the rate for a post of a line or two.
 */
describe('paintShare', () => {
  test('a box no bigger than the words is redrawn at the full rate', () => {
    assert.equal(paintShare(1000, 1000), 1);
    assert.equal(paintShare(1000, 400), 1);
  });
  test('a body twice the words\' area is redrawn at half the rate: the same area a second', () => {
    assert.equal(paintShare(1000, 2000), 0.5);
    const s = paintShare(924 * 65, 943 * 135);
    assert.ok(Math.abs(943 * 135 * s - 924 * 65) < 1e-6);
  });
  test('a line of words in a tall body is redrawn at no less than a quarter of the rate', () => {
    assert.equal(paintShare(924 * 22, 943 * 276), 0.25);
    assert.equal(paintShare(0, 1000), 0.25);
  });
  test('an empty or unmeasured box is redrawn at the full rate', () => {
    assert.equal(paintShare(0, 0), 1);
    assert.equal(paintShare(Number.NaN, 1000), 1);
  });
});
