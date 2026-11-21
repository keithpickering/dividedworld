/**
 * The Heel: earns heat, the excited-negative reaction, and a Salty card that steals a post's
 * thunder. Its weakness is the polite shrug, the calm-positive reaction. Design, section 6.
 * A vote of heat pays two votes' worth (`heel.heatVotes`) while the shrug costs one: heat is
 * scarce among friends, so the higher rate pays for the work of drawing it, and the
 * weakness stays at one because a polite shrug is the most plentiful reaction there is
 * (class balance design, section 1).
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { outdraws, perVote } from './shared.ts';

export const heel: ClassRules = {
  key: 'heel',
  name: 'Heel',
  reads: ['heel.saltyOutdraws', { key: 'heel.heatVotes', min: 0 }],
  earn: (input, settings) => [
    ...perVote(input, settings, 'excitedNegative', 1, 'heel.drewHeat', economyOf(settings, 'heel.heatVotes')),
    ...input.cardsPlayed
      .filter((c) => c.readsAs === 'salty' && c.onOthers && outdraws(c))
      .map((c): Earning => ({ reason: 'heel.stoleThunder', amount: economyOf(settings, 'heel.saltyOutdraws'), act: c.act })),
    ...perVote(input, settings, 'calmPositive', -1, 'heel.shrugged'),
  ],
};
