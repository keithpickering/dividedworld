/**
 * The shape of a board name The System proposes, Divided World's: PPP, after the forum's own
 * "Pointless Post Palace" (design, section 9: "three alliterative words, or a take on 'Pointless
 * Post Palace'"). A name is in style when either
 *
 *   - its last three words start with the same letter ("Pirate Puns Palace", and
 *     "Pointless Post SATAN SATAN SATAN", which may run longer than three words), or
 *   - it is a take on the original: three words or more that keep two of its three words where
 *     they stand ("Pointless Toast Palace" keeps the first and the last).
 *
 * A player's own rename is free-form and never asks this. Returns the problems in plain words
 * (they go back to the model that proposed the name, and to an admin reading the queue); an empty
 * list means in style.
 */
const ORIGINAL = ['pointless', 'post', 'palace'] as const;

/** The first letter or digit of a word, lowercased, or '' for a word with none ("&", "--"). */
function initial(word: string): string {
  const m = /[\p{L}\p{N}]/u.exec(word.normalize('NFD').replace(/\p{M}/gu, ''));
  return m ? m[0].toLowerCase() : '';
}

/** A word without the marks around it, lowercased: `"Wario",` is `wario`. */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
}

export function nameStyle(name: string): string[] {
  if (typeof name !== 'string') return ['a board name must be text'];
  const words = name.split(/\s+/).filter((w) => initial(w) !== '');
  if (words.length < 3) {
    return [`a board name needs at least three words (like Pointless Post Palace); "${name.trim()}" has ${words.length}`];
  }
  const last = words.slice(-3);
  if (last.every((w) => initial(w) === initial(last[0]!))) return [];
  const first = bare(words[0]!);
  const final = bare(words[words.length - 1]!);
  const kept = [first === ORIGINAL[0] && bare(words[1]!) === ORIGINAL[1], bare(words[words.length - 2]!) === ORIGINAL[1] && final === ORIGINAL[2], first === ORIGINAL[0] && final === ORIGINAL[2]];
  if (kept.some(Boolean)) return [];
  return [
    `the last three words must start with the same first letter (these start with ${last.map((w) => initial(w).toUpperCase()).join(', ')}), or the name must be a take on Pointless Post Palace that keeps two of its three words in place`,
  ];
}

/** The same style in words, for the meeting's prompt (the engine composes the prompt and writes no community's style itself). */
export const nameStyleBrief =
  'A board\'s name follows the forum\'s own "Pointless Post Palace": either the last three words start with the same letter ("Pirate Puns Palace", "Pointless Post SATAN SATAN SATAN"), or it is a take on the original that has at least three words and keeps two of its three words where they stand ("Pointless Toast Palace"). Anything else is dropped, never fixed for you.';
