/**
 * Force Field (Sweet, uncommon, Use): used on one of the player's own posts, it turns away every card cast there that is no rarer
 * than it, for a week, and then ends by itself (the card mechanic's design, sections 5 and 6). It is face up: every caster sees it
 * and is told the same words. It never blocks a card set face down.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const forceField: CardRules<Record<string, never>> = {
  key: 'force-field',
  name: 'Force Field',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'use',
  ward: true,
  lasts: { unit: 'day', count: 7 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(forceField, target, effects, now),
  validateConfig: () => ok({}),
};
