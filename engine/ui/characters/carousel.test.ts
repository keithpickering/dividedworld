import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownRange } from './carousel.ts';

/* The Turn's row at 1440: 216px cards, 14px apart, in a 972px viewport, so four whole and a peek. */
const CARD = 216;
const GAP = 14;
const VIEW = 972;

test('at the start, the cards that fit whole are shown, counted from 1', () => {
  assert.deepEqual(shownRange(0, VIEW, CARD, GAP, 5), { first: 1, last: 4 });
});

test('mid-scroll, a card cut at either edge is not counted as shown', () => {
  // Scrolled by half a card: the first card is cut on the left, and the fifth's end is past the right edge.
  assert.deepEqual(shownRange(108, VIEW, CARD, GAP, 5), { first: 2, last: 4 });
});

test('at the end, the last card is shown whole', () => {
  const end = 5 * CARD + 4 * GAP - VIEW;
  assert.deepEqual(shownRange(end, VIEW, CARD, GAP, 5), { first: 2, last: 5 });
});

test('a row that fits every card shows them all', () => {
  assert.deepEqual(shownRange(0, 1400, CARD, GAP, 5), { first: 1, last: 5 });
  assert.deepEqual(shownRange(0, VIEW, CARD, GAP, 3), { first: 1, last: 3 });
});

test('a card a sub-pixel short of whole is shown: layout rounds', () => {
  assert.deepEqual(shownRange(0.4, VIEW, CARD, GAP, 5), { first: 1, last: 4 });
});

test('a phone row of one card and a peek shows one card, and the next after one card\'s scroll', () => {
  const card = 390 - 32 - 64;
  assert.deepEqual(shownRange(0, 390 - 32, card, GAP, 5), { first: 1, last: 1 });
  assert.deepEqual(shownRange(card + GAP, 390 - 32, card, GAP, 5), { first: 2, last: 2 });
});

test('a viewport narrower than one card still names the card it starts in, never a range backwards', () => {
  assert.deepEqual(shownRange(0, 100, CARD, GAP, 5), { first: 1, last: 1 });
});
