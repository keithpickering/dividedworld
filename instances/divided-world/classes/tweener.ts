/**
 * The Tweener: splits the room. It earns when a post or card of its own draws hype (excited-positive) and heat
 * (excited-negative) in equal measure, paid on the smaller side, and when its card on another's post sets that post
 * arguing among players who arrived after the card. Each other player is counted once, by their net lean between hype
 * and heat, so one player hedging both ways never pays it. Its weakness is the shrug: calm-positive and bored-negative
 * reactions on its Acts. Design, sections 1 to 4.
 */
import type { ClassRules, Earning, Quadrant, Standing } from '../../../engine/rules/types.ts';

/** The smaller of the hype and heat sides: each vote counted once, by its net lean between the two. */
export function smallerSide(votes: readonly Standing[]): number {
  let hype = 0;
  let heat = 0;
  for (const v of votes) {
    const lean = v.excitedPositive - v.excitedNegative;
    if (lean > 0) hype += lean; else heat -= lean;
  }
  return Math.min(hype, heat);
}
const nothing = (x: number) => Math.abs(x) < 1e-12;
const SHRUG: readonly Quadrant[] = ['calmPositive', 'boredNegative'];

export const tweener: ClassRules = {
  key: 'tweener',
  name: 'Tweener',
  earn: (input, settings) => [
    ...input.standings
      .map((s): Earning => ({ reason: 'tweener.splitTheRoom', amount: settings.vote * 2 * (smallerSide(s.now) - smallerSide(s.before)), act: s.act, at: s.at }))
      .filter((e) => !nothing(e.amount)),
    ...input.cardsPlayed
      .flatMap((c) => (c.onOthers && c.drawnAfter ? [{ card: c, drawn: c.drawnAfter }] : []))
      .map(({ card, drawn }): Earning => ({ reason: 'tweener.stirredThePot', amount: settings.vote * 2 * smallerSide(drawn.now), act: card.act, at: drawn.at }))
      .filter((e) => !nothing(e.amount)),
    ...input.received
      .filter((r) => SHRUG.includes(r.quadrant))
      .map((r): Earning => ({ reason: 'tweener.shrugged', amount: -0.5 * settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at, kind: r.kind })),
  ],
};
