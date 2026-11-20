/**
 * What the classes share: paying or charging a whole vote's worth per vote on one
 * quadrant of the reactions a character's own posts and cards received.
 */
import type { Alignment, ClassInput, Earning, Quadrant, Settings } from '../../../engine/rules/types.ts';

/**
 * `sign` times `weight` votes' worth (one by default) for each vote in `quadrant` the
 * character's Acts received.
 */
export function perVote(input: ClassInput, settings: Settings, quadrant: Quadrant, sign: 1 | -1, reason: string, weight = 1): Earning[] {
  return input.received
    .filter((r) => r.quadrant === quadrant)
    .map((r) => ({ reason, amount: sign * weight * settings.vote * r.votes, act: r.act, quadrant, at: r.at, kind: r.kind, votes: r.votes }));
}

/** A card outdraws the post it landed on when it drew more votes than the post in the window. */
export const outdraws = (c: { votes: number; targetVotes: number }) => c.votes > c.targetVotes;

/** The room valued what the card outdrew: it was not booed, and it was no Salty play. A tie or no reaction is not booed. */
export const hadThunder = (c: { targetLean: number; targetReadsAs?: Alignment }) => !(c.targetLean < 0) && c.targetReadsAs !== 'salty';
