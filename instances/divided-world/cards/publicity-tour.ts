/**
 * Publicity Tour (Sweet, uncommon, Gimmick on a character): for 3 days, every positive reaction (excited or calm) the character's
 * posts earn counts 0.2 more, then it ends by itself (the card types design). It never deepens a loss. Its numbers are shared with Hype-Up (publicity.ts), one group, so the two do not add.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import { PUBLICITY, PUBLICITY_LASTS } from './publicity.ts';

export const publicityTour: CardRules<Record<string, never>> = {
  key: 'publicity-tour',
  name: 'Publicity Tour',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: PUBLICITY,
  lasts: PUBLICITY_LASTS,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(publicityTour, target, effects, now),
  validateConfig: () => ok({}),
};
