/**
 * Divided World's packs (docs/plans/2026-11-04-booster-packs-design.md): the Booster, four common-leaning pulls and a hit pull
 * that is an uncommon or a rare. The odds are starting numbers the season review replaces; the owner's to tune.
 */
import { deepFreeze } from '../../engine/rules/instance.ts';
import type { PackRules } from '../../engine/rules/packs.ts';

export const packs: readonly PackRules[] = deepFreeze<PackRules[]>([
  {
    key: 'booster',
    pulls: [
      { weights: { common: 85, uncommon: 15 } },
      { weights: { common: 85, uncommon: 15 } },
      { weights: { common: 85, uncommon: 15 } },
      { weights: { common: 85, uncommon: 15 } },
      { weights: { uncommon: 75, rare: 25 } },
    ],
  },
]);
