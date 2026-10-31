/**
 * The class cards' carousel, as numbers: which cards a row shows whole at a scroll position, for
 * its count ("1–4 of 5"). Pure, so it is tested without layout; ClassCards.tsx reads the four
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
