import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintFor, hintPatterns, windowStart, type HintSettings, type QuadrantCounts } from './hints.ts';

const s: HintSettings = { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } };
const c = (p: Partial<QuadrantCounts>): QuadrantCounts => ({ excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0, ...p });

test('one quadrant leading: at least `least` reactions and at least `share` of them in one quadrant', () => {
  assert.equal(hintFor(c({ excitedNegative: 10 }), s), 'leading:excitedNegative');
  assert.equal(hintFor(c({ excitedPositive: 10 }), s), 'leading:excitedPositive');
  assert.equal(hintFor(c({ calmPositive: 10 }), s), 'leading:calmPositive');
  assert.equal(hintFor(c({ boredNegative: 10 }), s), 'leading:boredNegative');
});

test('leading needs the least: one short is no hint', () => {
  assert.equal(hintFor(c({ excitedNegative: 9 }), s), null);
});

test('leading needs the share: 6 of 10 is enough, 5 of 10 is not', () => {
  assert.equal(hintFor(c({ excitedNegative: 6, boredNegative: 4 }), s), 'leading:excitedNegative');
  assert.equal(hintFor(c({ excitedNegative: 5, boredNegative: 5 }), s), null);
});

test('divisive: positive and negative each at least `split` of the window, with the least in all', () => {
  assert.equal(hintFor(c({ excitedPositive: 3, excitedNegative: 7 }), s), 'divisive');
  assert.equal(hintFor(c({ calmPositive: 4, boredNegative: 6 }), s), 'divisive');
  assert.equal(hintFor(c({ excitedPositive: 2, excitedNegative: 8 }), s), 'leading:excitedNegative', '2 of 10 is under the split, so the 8 only lead');
  assert.equal(hintFor(c({ excitedPositive: 2, calmPositive: 1, excitedNegative: 4, boredNegative: 3 }), { ...s, split: 0.4 }), null, 'neither side has a share, and no quadrant leads');
  assert.equal(hintFor(c({ excitedPositive: 3, excitedNegative: 6 }), s), null, '9 reactions are under the least');
});

test('the split counts both quadrants of a side', () => {
  assert.equal(hintFor(c({ excitedPositive: 2, calmPositive: 1, excitedNegative: 4, boredNegative: 3 }), s), 'divisive');
});

test('divisive wins over leading when both could apply', () => {
  // 7 of 12 in one quadrant leads at 0.6, and the 4 positive of 12 are over the split of 0.3: both apply.
  const both = c({ excitedNegative: 7, excitedPositive: 4, calmPositive: 1 });
  assert.equal(hintFor(both, s), 'divisive');
  // The same shape with the other side under the split leads alone.
  assert.equal(hintFor(c({ excitedNegative: 11, excitedPositive: 1 }), s), 'leading:excitedNegative');
});

test('stealing the thunder: only for a card, only when the card has drawn more than its post', () => {
  const small = c({ excitedPositive: 3 });
  assert.equal(hintFor(small, s), null, 'no card, no thunder');
  assert.equal(hintFor(c({ excitedPositive: 12 }), s, { cardCount: 12, postCount: 11 }), 'thunder');
  assert.equal(hintFor(c({ excitedPositive: 5, calmPositive: 4, boredNegative: 3 }), s, { cardCount: 12, postCount: 12 }), null, 'as many is not more');
  assert.equal(hintFor(c({ excitedPositive: 5, calmPositive: 4, boredNegative: 3 }), s, { cardCount: 12, postCount: 40 }), null);
});

test('thunder needs the least, so one reaction on an unreacted post is no theft', () => {
  assert.equal(hintFor(c({ excitedPositive: 1 }), s, { cardCount: 1, postCount: 0 }), null);
  assert.equal(hintFor(c({ excitedPositive: 9 }), s, { cardCount: 9, postCount: 0 }), null);
  assert.equal(hintFor(c({ excitedPositive: 10 }), s, { cardCount: 10, postCount: 0 }), 'thunder');
});

test('a card that has not outdrawn its post falls through to what its own reactions say', () => {
  assert.equal(hintFor(c({ excitedNegative: 10 }), s, { cardCount: 10, postCount: 30 }), 'leading:excitedNegative');
});

test('zero reactions are no hint, whatever the settings', () => {
  assert.equal(hintFor(c({}), s), null);
  assert.equal(hintFor(c({}), { ...s, least: 1 }), null);
  assert.equal(hintFor(c({}), { ...s, least: 1 }, { cardCount: 0, postCount: 0 }), null);
});

test('a least of one lets one reaction lead', () => {
  assert.equal(hintFor(c({ calmPositive: 1 }), { ...s, least: 1 }), 'leading:calmPositive');
});

test('the patterns are the four leads, divisive and thunder', () => {
  assert.deepEqual([...hintPatterns].sort(), ['divisive', 'leading:boredNegative', 'leading:calmPositive', 'leading:excitedNegative', 'leading:excitedPositive', 'thunder']);
});

test('the window starts its whole length before now, to the millisecond', () => {
  const now = new Date('2026-11-02T12:00:00.000Z');
  assert.equal(windowStart(now, { unit: 'minute', count: 360 }).toISOString(), '2026-11-02T06:00:00.000Z');
  assert.equal(windowStart(now, { unit: 'day', count: 1 }).toISOString(), '2026-11-01T12:00:00.000Z');
  assert.equal(windowStart(now, { unit: 'week', count: 1 }).toISOString(), '2026-10-26T12:00:00.000Z');
});
