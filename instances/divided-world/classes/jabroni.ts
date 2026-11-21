/**
 * The Jabroni: anti-comedy, posts built to bomb, whose win is the groan. It earns from
 * bored-negative reactions and from Salty cards landing on its posts (selling the L). Its
 * weakness is being taken sincerely, the excited-positive reaction. Design, section 6.
 * A vote of the groan pays two votes' worth (`jabroni.groanVotes`) while being taken
 * sincerely costs one: groans are scarce among friends, so the higher rate pays for the work
 * of drawing them, and the weakness stays at one because hype is the most plentiful
 * reaction there is (class balance design, section 1).
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { perVote } from './shared.ts';

export const jabroni: ClassRules = {
  key: 'jabroni',
  name: 'Jabroni',
  reads: ['jabroni.saltyLanded', { key: 'jabroni.groanVotes', min: 0 }],
  earn: (input, settings) => [
    ...perVote(input, settings, 'boredNegative', 1, 'jabroni.drewTheGroan', economyOf(settings, 'jabroni.groanVotes')),
    ...input.cardsLanded
      .filter((c) => c.readsAs === 'salty')
      .map((c): Earning => ({ reason: 'jabroni.soldTheL', amount: economyOf(settings, 'jabroni.saltyLanded'), act: c.act })),
    ...perVote(input, settings, 'excitedPositive', -1, 'jabroni.takenSincerely'),
  ],
};
