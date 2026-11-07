/** A copy word set mid-sentence: its first letter lowered ("The staff" becomes "the staff"). A word the instance wrote lower already stays. */
export const lowerFirst = (word: string): string => (word === '' ? word : word[0]!.toLowerCase() + word.slice(1));

/** A copy word that opens a sentence: its first letter raised ("the game" becomes "The game"). */
export const upperFirst = (word: string): string => (word === '' ? word : word[0]!.toUpperCase() + word.slice(1));
