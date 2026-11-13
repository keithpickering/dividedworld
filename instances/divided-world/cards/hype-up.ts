/**
 * Hype-Up (Sweet, uncommon, Cast on a character, anyone's): for 3 days, every positive reaction (excited or calm) the character's posts earn counts 0.2
 * more, then it ends by itself. It is Publicity Tour's push cast on another's mask: the numbers are the same list (publicity.ts) and one group, so the two
 * never add and the larger applies. It pays the caster nothing for it (docs/plans/2026-11-11-card-notes-design.md and its Part 4 plan).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import { PUBLICITY, PUBLICITY_LASTS } from './publicity.ts';

export const hypeUp: CardRules<Record<string, never>> = {
  key: 'hype-up',
  name: 'Hype-Up',
  alignment: 'sweet',
  rarity: 'uncommon',
  reaches: ['character'],
  gimmick: PUBLICITY,
  lasts: PUBLICITY_LASTS,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(hypeUp, target, effects, now),
  validateConfig: () => ok({}),
};
