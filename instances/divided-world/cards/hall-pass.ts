/**
 * Hall Pass (Sweet, uncommon, Set): set face down on one of the player's own posts, it springs when a Mod Bot's visit to that post
 * starts, and ends the visit (the face-down Moves design, section 4). It names no card: a visit is its trigger, not a play. A card
 * back shows on the post like any other, so a reader cannot tell it from a Card Collector.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';

export const hallPass: CardRules<Record<string, never>> = {
  key: 'hall-pass',
  name: 'Hall Pass',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'set',
  trap: { trigger: { on: 'visit' } },
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};
