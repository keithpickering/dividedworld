/**
 * Whether a card can land on a post, as the screens ask it: to offer a card only the posts it can
 * land on (every post "Play Whoops! here" is shown on) and the form what the post can still take. It is the card's own rules (`canApply`), given the post as
 * its rules see it, so a card that stacks three deep stops being offered on a post with three, and
 * the screen and the server agree because they ask the same function. The server decides again at
 * the play (`decidePlay`), whatever this said.
 */
import type { CardRules, CardTarget, Verdict } from '../../rules/cards.ts';
import type { Act } from '../data/api.ts';
import type { CardPlay } from './types.ts';

/** A post's length in characters, as its rules count it: of its current words (an edit counts), and nothing for a body that is not text. */
export function lengthOf(post: Act): number {
  const body = post.currentPayload.body;
  return typeof body === 'string' ? [...body].length : 0;
}

/** The post as a card's rules see it. */
export function targetOf(post: Act): CardTarget {
  return { act: post.id, kind: post.kind as CardTarget['kind'], length: lengthOf(post) };
}

/** Whether `rules`' card lands on `post`, which already carries `plays` (every card's, in any order); the refusal says why in the rules' words. */
export function landing(rules: Pick<CardRules, 'canApply'>, post: Act, plays: readonly CardPlay[]): Verdict {
  return rules.canApply(targetOf(post), plays.map((p) => ({ card: p.card, act: p.id })));
}
