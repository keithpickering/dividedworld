/**
 * Hype-Up (Sweet, common, Cast on a post, anyone's): for 3 days, every positive reaction (excited or calm) the post earns its author counts double, then it
 * ends by itself. It is Publicity Tour's push cast on one post: the quadrants, group and span are the same list (publicity.ts), doubled, and one group, so the
 * two never add and the larger applies. It pays the caster nothing for it (docs/plans/2026-11-11-card-notes-design.md, Part 4 plan, and
 * docs/plans/2026-11-13-hype-up-on-a-post-design.md).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import { HYPE, PUBLICITY_LASTS } from './publicity.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const hypeUp: CardRules<Record<string, never>> = {
  key: 'hype-up',
  name: 'Hype-Up',
  alignment: 'sweet',
  rarity: 'common',
  reaches: ['post'],
  gimmick: HYPE,
  lasts: PUBLICITY_LASTS,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(hypeUp, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
