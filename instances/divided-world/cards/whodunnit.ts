/**
 * Whodunnit? (Pepperoni, rare, a Move on a post): for three days the post's author is withheld from every read, and the post is
 * signed by the instance's anonymous poster instead (Instance.anonymous). Nothing is destroyed: the author is a fact the Act keeps, and
 * it comes back when the veil ends. One veil fits on a post, so a second is refused in plain words; it costs nothing more to play than
 * its price at the machine (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 9).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const whodunnit: CardRules<Record<string, never>> = {
  key: 'whodunnit',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Whodunnit?',
  alignment: 'pepperoni',
  rarity: 'rare',
  lasts: { unit: 'day', count: 3 },
  veil: 'author',
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(whodunnit, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
