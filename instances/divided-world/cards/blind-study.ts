/**
 * Blind Study (Pepperoni, uncommon, a Move on a post): for three days the post's reaction totals are withheld from every read, so
 * readers react without seeing how the post is doing. The reactions are still made and still count when the veil ends. One veil
 * fits on a post, so a second is refused in plain words; it costs nothing more to play than its price at the machine
 * (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 9).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const blindStudy: CardRules<Record<string, never>> = {
  key: 'blind-study',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Blind Study',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  lasts: { unit: 'day', count: 3 },
  veil: 'totals',
  seen: (p) => `${who(p)} drew a veil over this post's reaction totals, ${p.ago}: for a few days readers react blind, without seeing how it is doing.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(blindStudy, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
