/**
 * Good Vibes (Sweet, uncommon, Gimmick on a thread): for 3 days, casting a Salty card in the thread costs 0.25 more, then it ends
 * by itself (the card types design).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const goodVibes: CardRules<Record<string, never>> = {
  key: 'good-vibes',
  name: 'Good Vibes',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['thread'],
  gimmick: { kind: 'price', flavors: ['salty'], add: 25 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(goodVibes, target, effects, now),
  validateConfig: () => ok({}),
};
