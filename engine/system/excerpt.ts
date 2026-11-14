/**
 * One way every post excerpt a model reads is cut and marked (the excerpts-and-orders design, section 1).
 *
 * The staff and the personas are shown other people's posts in excerpt, and an excerpt that stopped mid-word with nothing to say so
 * was reviewed as the author's own words. So every cut is marked: `excerpt` returns the text on one line, and where it is over
 * `most`, or `cut` says the source (SQL) already shortened it, cut at a word (`cutAtWord`) and ending in "…". `EXCERPT_WORDS` is
 * the one sentence a prompt that shows excerpts says, once, plainly and never in character.
 *
 * Names, titles and other strings that are not a post keep the cut they have.
 */
import { cutAtWord } from './validate.ts';

export const EXCERPT_WORDS = 'An excerpt that ends in … was shortened by the game for space; its author wrote more.';

export function excerpt(text: string, most: number, cut = false): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '' || (line.length <= most && !cut)) return line;
  return `${cutAtWord(line, Math.min(line.length, most))}…`;
}
