/**
 * Hints: a nudge to the player whose post or card is drawing a pattern of reactions (the alerts design's section 5,
 * docs/plans/2026-11-02-alerts-design.md). Pure: it reads the public per-quadrant counts of one Act's reactions inside a
 * window and names at most one pattern, so every hint is true by construction and costs no model call. It reads no account
 * and no character; "A response never proves a private fact" holds because nothing here could.
 *
 * The patterns, by the core loop's four quadrants: one quadrant leading (heat is excited-negative, a pop excited-positive,
 * polite shrugs calm-positive, groans bored-negative); the positive and the negative sides each drawing a real share
 * (divisive); a card that has drawn more than the post it landed on (stealing the thunder). The instance sets the numbers
 * (`HintSettings`) and the words.
 */
import { spanMs } from './cards.ts';
import { QUADRANTS, type Quadrant, type Span } from './types.ts';

/** The reactions an Act drew inside a window, by the quadrant of their kind: the counts a reader sees on its chips. */
export type QuadrantCounts = Readonly<Record<Quadrant, number>>;

/** The instance's numbers for hints (`Settings.hints`). */
export interface HintSettings {
  /** The fewest reactions in the window before any hint fires. */
  readonly least: number;
  /** A quadrant leads when it holds at least this share (above one half, so at most one quadrant can lead) of the window's reactions. */
  readonly share: number;
  /** Divisive: the positive quadrants together and the negative together each hold at least this share (at most one half). */
  readonly split: number;
  /** How far back a hint counts reactions. Minutes are allowed: a hint is about a recent burst. */
  readonly window: Span;
}

export type HintPattern = `leading:${Quadrant}` | 'divisive' | 'thunder';

/** Every pattern a hint can name, which an instance has words for. */
export const hintPatterns: readonly HintPattern[] = Object.freeze([
  ...QUADRANTS.map((q) => `leading:${q}` as const),
  'divisive',
  'thunder',
]);

const POSITIVE: readonly Quadrant[] = ['excitedPositive', 'calmPositive'];
const NEGATIVE: readonly Quadrant[] = ['excitedNegative', 'boredNegative'];
const sum = (c: QuadrantCounts, qs: readonly Quadrant[]): number => qs.reduce((n, q) => n + c[q], 0);

/**
 * The one pattern a window of reactions shows, or null. `card`, given when the Act is a card play on a post, carries the totals
 * the card and its post have each drawn in the window; a card that has drawn more than its post (and the least) is stealing the
 * thunder, which is the news. Otherwise divisive wins over a quadrant leading when both apply (it is the more telling of the
 * two), and a quadrant leads only when it holds the share.
 */
export function hintFor(window: QuadrantCounts, settings: HintSettings, card?: { readonly cardCount: number; readonly postCount: number }): HintPattern | null {
  if (card && card.cardCount >= settings.least && card.cardCount > card.postCount) return 'thunder';
  const total = sum(window, QUADRANTS);
  if (total < settings.least || total < 1) return null;
  if (sum(window, POSITIVE) >= settings.split * total && sum(window, NEGATIVE) >= settings.split * total) return 'divisive';
  const lead = QUADRANTS.find((q) => window[q] >= settings.share * total);
  return lead ? `leading:${lead}` : null;
}

/** When the window starts, given now: its whole length before. A reaction at exactly this instant is inside it. */
export const windowStart = (now: Date, window: Span): Date => new Date(now.getTime() - spanMs(window));
