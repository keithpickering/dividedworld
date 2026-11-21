/**
 * Divided World's packs (docs/plans/2026-11-04-booster-packs-design.md): the Booster, four common-leaning pulls and a hit pull
 * that is an uncommon, a rare or, rarely, a legendary. The odds are starting numbers the season review replaces; the owner's to tune.
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
      { weights: { uncommon: 74, rare: 24, legendary: 2 } },
    ],
  },
  // The Starter Pack (docs/plans/2026-11-18-starter-pack-design.md): a fixed pack, the same six commons for everyone, two of each flavor.
  // Hype-Up took Rope Break's place (docs/plans/2026-11-20-class-balance-design.md, section 3): a Reversal that catches Salty
  // commons in every hand taxed the Heel's own starter cards.
  { key: 'starter', contents: ['feelin-fab', 'hype-up', 'steel-chair', 'whoops', 'this', 'autocorrect'] },
]);
