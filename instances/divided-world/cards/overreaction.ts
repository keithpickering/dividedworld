/**
 * Overreaction (Pepperoni, common, a Move on a post, three to a post): the caster names an emoji and the quadrant it scores in, and
 * that reaction joins this post's picker alone, for as long as the post stands. The emoji must be one the forum does not already have;
 * that the post does not already hold it is the database's to refuse, since an effect carries no configuration for the rules to read
 * (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 9).
 */
import { landsOn, type CardRules } from '../../../engine/rules/cards.ts';
import { localReaction } from '../../../engine/rules/emoji.ts';
import type { Quadrant } from '../../../engine/rules/types.ts';
import { reactions } from '../reactions.ts';

export const overreaction: CardRules<{ emoji: string; quadrant: Quadrant }> = {
  key: 'overreaction',
  name: 'Overreaction',
  alignment: 'pepperoni',
  rarity: 'common',
  stack: 3,
  reaction: true,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(overreaction, target, effects, now),
  validateConfig: (config) => localReaction(config, reactions),
};
