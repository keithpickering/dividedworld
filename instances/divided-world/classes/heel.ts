/**
 * The Heel: earns heat, the excited-negative reaction, and a Salty card that steals a post's
 * thunder. Its weakness is the polite shrug, the calm-positive reaction. Design, section 6.
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { outdraws, perVote } from './shared.ts';

export const heel: ClassRules = {
  key: 'heel',
  name: 'Heel',
  reads: ['heel.saltyOutdraws'],
  earn: (input, settings) => [
    ...perVote(input, settings, 'excitedNegative', 1, 'heel.drewHeat'),
    ...input.cardsPlayed
      .filter((c) => c.alignment === 'salty' && c.onOthers && outdraws(c))
      .map((c): Earning => ({ reason: 'heel.stoleThunder', amount: economyOf(settings, 'heel.saltyOutdraws'), act: c.act })),
    ...perVote(input, settings, 'calmPositive', -1, 'heel.shrugged'),
  ],
};
