/**
 * The Technician: the respected regular, the effort poster whose answers are nodded at rather
 * than adored. It earns from calm-positive reactions to its posts and cards (Respected), and a
 * little more for each one that lands on a post of its own once that post is a few days old
 * (Evergreen): the reference reply that keeps getting nods. Its weakness is heat, the
 * excited-negative reaction (Dragged in). It is the Heel's foil both ways.
 * Design: docs/plans/2026-10-30-technician-design.md, section 1.
 *
 * Evergreen is judged by when each vote lands or leaves, by the reaction's time against the
 * post's: a calm vote withdrawn once the post is old takes the bonus back, so removing and
 * re-adding a reaction across settlements farms nothing (a vote cast young and withdrawn old
 * charges a bonus it never paid; the design accepts that). Cards never pay it.
 */
import type { ClassRules, EconomyRead, Earning } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';
import { perVote } from './shared.ts';

/** The Technician's numbers, in the order its rules read them: one list, which its `reads` is too. */
const READS: readonly EconomyRead[] = ['technician.evergreen', { key: 'technician.evergreenDays', whole: true, min: 1 }];
const keyOf = (r: EconomyRead) => (typeof r === 'string' ? r : r.key);
const DAY = 86_400_000;

export const technician: ClassRules = {
  key: 'technician',
  name: 'Technician',
  reads: READS,
  earn: (input, settings) => {
    const [evergreen, evergreenDays] = READS.map((r) => economyOf(settings, keyOf(r))) as [number, number];
    return [
      ...perVote(input, settings, 'calmPositive', 1, 'technician.respected'),
      ...input.received
        .filter((r) => r.actKind === 'post' && r.quadrant === 'calmPositive' && r.at - r.actAt >= evergreenDays * DAY)
        .map((r): Earning => ({ reason: 'technician.evergreen', amount: evergreen * r.votes, act: r.act, quadrant: r.quadrant, at: r.at })),
      ...perVote(input, settings, 'excitedNegative', -1, 'technician.draggedIn'),
    ];
  },
};
