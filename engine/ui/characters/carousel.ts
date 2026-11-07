/**
 * The class cards' carousel, as numbers: which cards a row shows whole at a scroll position, for
 * its count ("1–4 of 6"). Pure, so it is tested without layout; ClassCards.tsx reads the four
 * lengths from the row. Nothing here knows how many classes an instance has.
 */

/** Within this much of whole, a card is whole: layout lands on fractions of a pixel. */
const SLACK = 1;

/**
 * The first and last cards (counted from 1) that lie whole inside the row's viewport, for cards
 * `card` wide and `gap` apart, scrolled by `scrollLeft`. A card cut at either edge is not shown.
 * Where no card is whole (a viewport narrower than one), it names the card the viewport starts in.
 */
export function shownRange(scrollLeft: number, viewport: number, card: number, gap: number, count: number): { first: number; last: number } {
  if (count <= 0) return { first: 0, last: 0 };
  const step = card + gap;
  const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
  const first = clamp(Math.ceil((scrollLeft - SLACK) / step));
  const last = clamp(Math.floor((scrollLeft + viewport - card + SLACK) / step));
  return { first: first + 1, last: Math.max(first, last) + 1 };
}

/**
 * How far, from each end of the row's box, a card that only peeks in reaches: the fade is drawn over that much and no
 * more. The cards are counted whole in a column `viewport` wide; the box reaches `room` past it at each end (the glow's
 * room, docs/plans/2026-11-07-carousel-edges-design.md, section 1), so a card past the column shows up to that much
 * more. At the start it is the card before the first whole one, to its end; at the end, the card after the last whole
 * one, from its start. Whole pixels, never below none.
 */
export function peeks(scrollLeft: number, viewport: number, room: number, card: number, gap: number, count: number): { before: number; after: number } {
  if (count <= 0 || card <= 0) return { before: 0, after: 0 };
  const step = card + gap;
  const { first, last } = shownRange(scrollLeft, viewport, card, gap, count);
  /* `first` and `last` count from 1: the card before the first whole one is index first - 2, the one after the last is index last. */
  const before = first > 1 ? Math.max(0, Math.round((first - 2) * step + card - scrollLeft + room)) : 0;
  const after = last < count ? Math.max(0, Math.round(scrollLeft + viewport + room - last * step)) : 0;
  return { before, after };
}
