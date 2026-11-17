/**
 * Publicity Tour (Sweet, uncommon, Gimmick on a character): for 3 days, every positive vote (excited or calm) on the character's
 * posts pays a flat half a vote more, whatever class the character holds, then it ends by itself (the card types design). It never deepens a loss.
 * Hype-Up (publicity.ts) gives one post the same push at a whole vote; where the two are up on one vote, only the larger pays.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import { PUBLICITY, PUBLICITY_LASTS } from './publicity.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

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

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
