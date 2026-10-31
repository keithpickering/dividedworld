/**
 * What the classes share: paying or charging a whole vote's worth per vote on one
 * quadrant of the reactions a character's own posts and cards received.
 */
import type { ClassInput, Earning, Quadrant, Settings } from '../../../engine/rules/types.ts';

/** `sign` times one vote's worth for each vote in `quadrant` the character's Acts received. */
export function perVote(input: ClassInput, settings: Settings, quadrant: Quadrant, sign: 1 | -1, reason: string): Earning[] {
  return input.received
    .filter((r) => r.quadrant === quadrant)
    .map((r) => ({ reason, amount: sign * settings.vote * r.votes, act: r.act, quadrant, at: r.at }));
}

/** A card outdraws the post it landed on when it drew more votes than the post in the window. */
export const outdraws = (c: { votes: number; targetVotes: number }) => c.votes > c.targetVotes;
