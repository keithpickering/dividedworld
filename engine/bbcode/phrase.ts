/**
 * The phrase matcher: whether, and where, a phrase is in a post's visible text (engine/bbcode/visible.ts). It began as Autocorrect's finder
 * and moved here, unchanged, when a face-down Move came to need the same question asked in the database (the face-down Moves design,
 * section 6): the server checks it inside the write that springs a back, so `phrase_in` (supabase/migrations/0142_face_down_moves.sql)
 * asks it of `bbcode_plain(body)` (0117), which mirrors `visibleText(parse(body))`. The two are one list in two languages: engine/bbcode/
 * phrase.fixtures.ts is read by phrase.test.ts against `phraseIn(visibleText(parse(body)), phrase)`, tools/phrase-sql.mjs makes
 * supabase/tests/0136-phrase.sql from it, which holds `phrase_in` to the same answers, and tools/check-phrase-sql.mjs holds that file to
 * exactly what the fixtures make ("Two lists that must agree are one list").
 *
 * It reads visible text, never BBCode, so a match may cross formatting and never reaches into a quote, code, a link or an image, and its
 * offsets are the ones the renderer's text layers take (the Autocorrect design, section 1).
 *
 * Whole words in any case: an occurrence is the phrase, case-folded, with no letter or digit (any script's) just before or just after it,
 * so "cats" covers "Cats." and "CATS" and never "concatenate". Occurrences are found left to right and never overlap. A phrase with no
 * letter or digit in it matches nothing; its rules refuse one anyway. The work is one regular-expression pass over the text, linear in
 * its length.
 *
 * Case folding is JavaScript's `i` flag with `u`: Unicode's simple case folding. So ς and σ and Σ are one letter; ſ is s; ı (dotless) and
 * İ (dotted capital) are not i; ß is not "ss" (ẞ is ß). `phrase_in` folds the same way and the fixtures hold the places where Postgres's own
 * `lower()` parts from it.
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

/** Whether the phrase is in the text as a whole word at least once; an empty phrase, or one with no letter or digit, is in nothing. */
export const phraseIn = (plain: string, phrase: string): boolean => occurrences(plain, phrase).length > 0;
