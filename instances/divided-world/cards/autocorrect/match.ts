/**
 * Autocorrect's phrase matcher, shared by its rules (the server prices and refuses by it) and its effect (the screens lay a strip
 * on each occurrence), so both agree on what an occurrence is. It reads a post's visible text (engine/bbcode/visible.ts), never
 * its BBCode, so a match may cross formatting and never reaches into a quote, code, a link or an image, and its offsets are the
 * ones the renderer's text layers take (the Autocorrect design, section 1).
 *
 * Whole words in any case: an occurrence is the phrase, case-folded, with no letter or digit (any script's) just before or just
 * after it, so "cats" covers "Cats." and "CATS" and never "concatenate". Occurrences are found left to right and never overlap. A
 * phrase with no letter or digit in it matches nothing; its rules refuse one anyway. The work is one regular-expression pass over
 * the text, linear in its length.
 */

/** A run of the visible text: from its first character to just past its last, in the string's own units. */
export interface Occurrence {
  readonly from: number;
  readonly to: number;
}

const WORDISH = /[\p{L}\p{N}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether two strings are the same words as the matcher reads them: the same, case-folded as its `i` folds them. */
export const sameWords = (a: string, b: string): boolean => new RegExp(`^${escape(a)}$`, 'iu').test(b);

export function occurrences(text: string, phrase: string): Occurrence[] {
  if (!WORDISH.test(phrase)) return [];
  const find = new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase)}(?![\\p{L}\\p{N}])`, 'giu');
  return [...text.matchAll(find)].map((m) => ({ from: m.index!, to: m.index! + m[0].length }));
}
