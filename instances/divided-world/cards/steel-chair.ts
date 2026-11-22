/**
 * Steel Chair (Salty, common, a Move on a post): a folding chair is thrown at the post, dents it and falls to the floor under its
 * words (docs/plans/2026-11-15-wave-1-cards-design.md, section 2.3). It covers none of the words and holds nobody: it is loud, so
 * that it can outdraw the post it lands on. Up to three stack, each its own dent and chair, and each is gone 3 days after it landed.
 * Where a throw lands is chosen on each reader's screen each time (instances/divided-world/ui/steel-chair/), so nothing is seeded,
 * saved or sent. It costs nothing more to play than its price at the machine.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths, Span } from '../../../engine/rules/types.ts';

export const STEEL_CHAIR_LASTS: Span = { unit: 'day', count: 3 };

export const steelChair: CardRules<Record<string, never>> = {
  key: 'steel-chair',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Steel Chair',
  alignment: 'salty',
  rarity: 'common',
  stack: 3,
  lasts: STEEL_CHAIR_LASTS,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(steelChair, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
