/**
 * Heat Magnet (Salty, uncommon, Gimmick on a character): for 2 days (the design said 36 hours; a span is in days, weeks or months), every negative reaction (excited or bored) the character's
 * posts earn counts 0.1 more, then it ends by itself (the card types design). It only raises what is earned; it never deepens a loss.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const heatMagnet: CardRules<Record<string, never>> = {
  key: 'heat-magnet',
  name: 'Heat Magnet',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], by: 0.1 },
  lasts: { unit: 'day', count: 2 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(heatMagnet, target, effects, now),
  validateConfig: () => ok({}),
};
