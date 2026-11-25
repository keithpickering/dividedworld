/**
 * Kick Me (Pepperoni, common, Gimmick on the player's own post): for 3 days a "Kick Me" sign is taped on the post. Each negative vote on it, heat
 * or groan, pays its author a vote more, to any class (a flat earn, as Required Reading's), and the first three Salty cards cast there land and
 * go back to their casters' hands (`refunds`), a card set face down that hands one back first taking its turn
 * (docs/plans/2026-11-20-refund-outcome-design.md; its row, docs/plans/2026-11-15-base-set-card-numbers-design.md, section 3). A cast by the
 * author's own other mask is handed back like any other; a staff cast passes over it. One sign per post.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const kickMe: CardRules<Record<string, never>> = {
  key: 'kick-me',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Kick Me',
  alignment: 'pepperoni',
  rarity: 'common',
  play: 'use',
  reaches: ['post'],
  gimmick: { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 1 },
  refunds: { flavors: ['salty'], count: 3 },
  lasts: { unit: 'day', count: 3 },
  seen: (p) => `${who(p)} taped a “Kick Me” sign to this post, ${p.ago}: for a few days it begs to be kicked, and every boo and groan it draws is worth extra to its author.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(kickMe, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
