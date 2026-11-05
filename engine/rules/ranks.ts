/**
 * A character's rank, from its season standing. The instance's ranks ascend by threshold
 * (`instanceProblems` holds them to it); the rank is the highest one the standing reaches, and the
 * first where it reaches none or the character has no standing yet.
 */
import type { Hundredths, Rank } from './types.ts';

export function rankIndex(ranks: readonly Rank[], standing: Hundredths | null): number {
  let at = 0;
  if (standing === null) return at;
  ranks.forEach(({ from: threshold }, i) => { if (standing >= threshold) at = i; });
  return at;
}

/** The least standing that lands on the rank at `index` (its threshold), or null where there is no such rank: a staged postbit's standing. */
export function rankFloor(ranks: readonly Rank[], index: number): Hundredths | null {
  const rank = ranks[index];
  return rank === undefined ? null : rank.from;
}
