/**
 * Last Word (Salty, uncommon, Use): used on one of the player's own posts, it stops every quote of that post, for a week, and then ends by itself
 * (docs/plans/2026-11-11-card-notes-design.md and its Part 4 plan). It is face up: the post carries no Quote link and the Lens says it cannot be quoted. It cannot be
 * used on a post that holds a card face down, since a back springs on a quote, and no card is set face down there while it is up.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const lastWord: CardRules<Record<string, never>> = {
  key: 'last-word',
  name: 'Last Word',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'use',
  gimmick: { kind: 'noQuote' },
  lasts: { unit: 'day', count: 7 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(lastWord, target, effects, now),
  validateConfig: () => ok({}),
};
