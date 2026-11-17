/**
 * Front Row (Pepperoni, uncommon, Gimmick on a character): for 3 days, each vote, in any quadrant, on a card the character plays pays half
 * a vote more, to any class, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, section 4). A card it plays is its card Act, or
 * the spring of a card it set face down, a Reversal or a Move (`acts`); its posts are not. The settlement's is the pay; this file names only the effect and its size.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const frontRow: CardRules<Record<string, never>> = {
  key: 'front-row',
  name: 'Front Row',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'], flat: 0.5, acts: ['card', 'spring'] },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(frontRow, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
