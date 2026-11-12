/**
 * Sugar Coat (Sweet, rare, Use): used on one of the player's own posts, it turns away every Salty and Pepperoni card cast there, for a week, and then ends
 * by itself (docs/plans/2026-11-11-card-notes-design.md and its Part 4 plan). It is face up: every caster sees it and is told the same words. A Sweet card
 * passes, and it never blocks a card set face down.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const sugarCoat: CardRules<Record<string, never>> = {
  key: 'sugar-coat',
  name: 'Sugar Coat',
  alignment: 'sweet',
  rarity: 'rare',
  play: 'use',
  gimmick: { kind: 'ward', flavors: ['salty', 'pepperoni'] },
  lasts: { unit: 'day', count: 7 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(sugarCoat, target, effects, now),
  validateConfig: () => ok({}),
};
