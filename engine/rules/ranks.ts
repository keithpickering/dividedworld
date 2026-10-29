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
