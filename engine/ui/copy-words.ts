/** A copy word set mid-sentence: its first letter lowered ("The staff" becomes "the staff"). A word the instance wrote lower already stays. */
export const lowerFirst = (word: string): string => (word === '' ? word : word[0]!.toLowerCase() + word.slice(1));

/** A copy word that opens a sentence: its first letter raised ("the game" becomes "The game"). */
export const upperFirst = (word: string): string => (word === '' ? word : word[0]!.toUpperCase() + word.slice(1));

/** The unit fractions with a word of their own; any other share under a vote is said as a percent. */
const FRACTIONS: ReadonlyArray<readonly [number, string]> = [[0.5, 'half'], [0.25, 'a quarter'], [0.2, 'a fifth'], [0.1, 'a tenth']];

/**
 * A share of a vote in words, read from a card's own rules and never restated: 1 is "a vote", 0.5 "half a vote", 0.1 "a tenth of a vote", more than one "2 votes",
 * and a share with no word of its own a percent ("15% of a vote").
 */
export function shareWords(share: number): string {
  if (share === 1) return 'a vote';
  if (share > 1) return `${Number(share.toFixed(2))} votes`;
  const named = FRACTIONS.find(([n]) => Math.abs(n - share) < 1e-9);
  if (named) return named[1] === 'half' ? 'half a vote' : `${named[1]} of a vote`;
  return `${Number((share * 100).toFixed(2))}% of a vote`;
}
