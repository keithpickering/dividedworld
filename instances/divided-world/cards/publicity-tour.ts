/**
 * Publicity Tour (Sweet, uncommon, Gimmick on a character): for 36 hours, every positive reaction (excited or calm) the character's
 * posts earn counts 0.1 more, then it ends by itself (the card types design). It never deepens a loss.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const publicityTour: CardRules<Record<string, never>> = {
  key: 'publicity-tour',
  name: 'Publicity Tour',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.1 },
  lasts: { unit: 'hour', count: 36 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(publicityTour, target, effects, now),
  validateConfig: () => ok({}),
};
