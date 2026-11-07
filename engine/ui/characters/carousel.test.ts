import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peeks, shownRange } from './carousel.ts';

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

test('a phone row of six cards, scrolled to the fifth with fractional card widths, counts it as 5, not 6', () => {
  // 355px viewport, cards calc(100% - 64px) = 291.375px: the fifth card starts at 4 * 305.375 = 1221.5, which the scroll reports as 1222.
  assert.deepEqual(shownRange(1222, 355, 291.375, 14, 6), { first: 5, last: 5 });
});

/*
 * The peeks: how much of the row's box, from each end, a card that is not whole covers. The box reaches `room` past the
 * column the cards are counted in (the glow's room, docs/plans/2026-11-07-carousel-edges-design.md, section 1).
 */
test('with no room, the peek at the end is what of the next card the column shows, and none at the start', () => {
  // Four whole cards end at 4 * 230 - 14 = 906; the fifth starts at 920 and shows 52px of the 972px column.
  assert.deepEqual(peeks(0, VIEW, 0, CARD, GAP, 6), { before: 0, after: 52 });
});

test('the room is part of the peek: a card past the column shows into it, and the fade starts at the box\'s edge', () => {
  assert.deepEqual(peeks(0, VIEW, 32, CARD, GAP, 6), { before: 0, after: 84 });
});

test('a card wholly in the room past the column still peeks, and a card that ends before the box does not', () => {
  // A column of 900: four cards end at 906, so the fourth is not whole and peeks by 900 + 32 - 690 = 242.
  assert.deepEqual(peeks(0, 900, 32, CARD, GAP, 6), { before: 0, after: 242 });
  // Scrolled by two cards: the second card ends at 446 - 460 = -14 from the column's start, 18px into the 32px room.
  assert.deepEqual(peeks(460, VIEW, 32, CARD, GAP, 6), { before: 18, after: 0 });
  // With no room the same card does not show.
  assert.deepEqual(peeks(460, VIEW, 0, CARD, GAP, 6), { before: 0, after: 0 });
});

test('scrolled to the end, nothing peeks past the last card, and the card before the first whole one peeks at the start', () => {
  const end = 6 * CARD + 5 * GAP - VIEW;
  // end = 394: the second card (230..446) ends 52px into the column, so it peeks 52 + 32 from the box's edge.
  assert.deepEqual(peeks(end, VIEW, 32, CARD, GAP, 6), { before: 84, after: 0 });
});

test('a row that fits every card peeks at neither end', () => {
  assert.deepEqual(peeks(0, 1400, 32, CARD, GAP, 5), { before: 0, after: 0 });
});
