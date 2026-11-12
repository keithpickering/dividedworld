/**
 * Blind Study (Pepperoni, uncommon, a Move on a post): for three days the post's reaction totals are withheld from every read, so
 * readers react without seeing how the post is doing. The reactions are still made and still count when the veil ends. One veil
 * fits on a post, so a second is refused in plain words; it costs nothing more to play than its price at the machine
 * (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 9).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const blindStudy: CardRules<Record<string, never>> = {
  key: 'blind-study',
  name: 'Blind Study',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  lasts: { unit: 'day', count: 3 },
  veil: 'totals',
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(blindStudy, target, effects, now),
  validateConfig: () => ok({}),
};
