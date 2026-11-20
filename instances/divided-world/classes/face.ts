/**
 * The Face: the crowd's favorite, earning from excitement it can share in. Its weakness is
 * boring the room, and stealing thunder: a play of its on another player's Act that drew more
 * votes than that Act in the window costs `face.cardOutdraws`, because upstaging is unbecoming.
 * Only where there was thunder the room valued: nothing is charged where the Act's reactions
 * lean negative (upstaging what the room booed is the Face doing its job), or where the Act is
 * a cast that reads as Salty (the other player swung first). A tie or no reactions holds the
 * charge. Design, section 6, as revised by docs/plans/2026-11-18-face-thunder-design.md, section 3.
 */
import type { ClassRules, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { hadThunder, outdraws, perVote } from './shared.ts';

export const face: ClassRules = {
  key: 'face',
  name: 'Face',
  reads: ['face.cardOutdraws'],
  earn: (input, settings) => [
    ...perVote(input, settings, 'excitedPositive', 1, 'face.cheered'),
    ...input.cardsPlayed
      .filter((c) => c.readsAs === 'sweet' && c.onOthers && c.targetAfter.excitedPositive > 0)
      .map((c): Earning => ({ reason: 'face.liftedAPost', amount: settings.vote * c.targetAfter.excitedPositive, act: c.act, quadrant: 'excitedPositive', valuing: { act: c.target, from: c.at } })),
    ...perVote(input, settings, 'boredNegative', -1, 'face.boredTheRoom'),
    ...input.cardsPlayed
      .filter((c) => c.onOthers && outdraws(c) && hadThunder(c))
      .map((c): Earning => ({ reason: 'face.stoleThunder', amount: economyOf(settings, 'face.cardOutdraws'), act: c.act, ofWindow: true })),
  ],
};
