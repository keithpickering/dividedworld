/**
 * The Jabroni: anti-comedy, posts built to bomb, whose win is the groan. It earns from
 * bored-negative reactions and from Salty cards landing on its posts (selling the L). Its
 * weakness is being taken sincerely, the excited-positive reaction. Design, section 6.
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economy } from '../settings.ts';
import { perVote } from './shared.ts';

export const jabroni: ClassRules = {
  key: 'jabroni',
  name: 'Jabroni',
  earn: (input, settings) => [
    ...perVote(input, settings, 'boredNegative', 1, 'jabroni.drewTheGroan'),
    ...input.cardsLanded
      .filter((c) => c.alignment === 'salty')
      .map((c): Earning => ({ reason: 'jabroni.soldTheL', amount: economy.jabroni.saltyLanded, act: c.act })),
    ...perVote(input, settings, 'excitedPositive', -1, 'jabroni.takenSincerely'),
  ],
};
