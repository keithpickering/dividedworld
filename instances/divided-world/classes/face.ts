/**
 * The Face: the crowd's favorite, earning from excitement it can share in. Its weakness is
 * boring the room, and stealing thunder: a card of its that outdraws the post it landed on
 * costs, because upstaging is unbecoming. Design, section 6.
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { outdraws, perVote } from './shared.ts';

export const face: ClassRules = {
  key: 'face',
  name: 'Face',
  reads: ['face.cardOutdraws'],
  earn: (input, settings) => [
    ...perVote(input, settings, 'excitedPositive', 1, 'face.cheered'),
    ...input.cardsPlayed
      .filter((c) => c.alignment === 'sweet' && c.onOthers && c.targetAfter.excitedPositive > 0)
      .map((c): Earning => ({ reason: 'face.liftedAPost', amount: settings.vote * c.targetAfter.excitedPositive, act: c.act, quadrant: 'excitedPositive', valuing: { act: c.target, from: c.at } })),
    ...perVote(input, settings, 'boredNegative', -1, 'face.boredTheRoom'),
    ...input.cardsPlayed
      .filter((c) => c.onOthers && outdraws(c))
      .map((c): Earning => ({ reason: 'face.stoleThunder', amount: economyOf(settings, 'face.cardOutdraws'), act: c.act })),
  ],
};
