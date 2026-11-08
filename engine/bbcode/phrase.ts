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
 * Whole words in any case, a little loosely (the quote-conditions design, section 2): both the text and the phrase are read through `normalize`
 * first, and an occurrence is the normalized phrase, case-folded, with no letter or digit (any script's) just before or just after it in the
 * normalized text, so "cats" covers "Cats." and "CATS" and never "concatenate", "dont" covers "Don't", and "nice try" covers "Nice... try!"
 * and never "nice-try". Occurrences are found left to right and never overlap, and are mapped back to the original text's offsets, from the
 * first letter or digit to the last, so Autocorrect's strips and the renderer's layers take the text they always took. A phrase with no letter
 * or digit in it matches nothing; its rules refuse one anyway. The work is one pass to normalize and one regular-expression pass, linear in
 * the text's length. `phrase_norm` in SQL (supabase/migrations/0144_quote_conditions.sql) is `normalize`; the fixtures hold them together.
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

/* Whitespace and line breaks are written out as sets, never `\s`, whose set Postgres reads by locale: supabase/migrations/0144_quote_conditions.sql writes the same two sets, and
   phrase.fixtures.ts holds the places they matter (a non-breaking space, an ideographic space). A line break is also whitespace. */
const SPACE = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const BREAK = /[\u000a-\u000d\u0085\u2028\u2029]/u;

/**
 * The text as the matcher reads it, with where each of its units came from. A run of characters that are neither letters, digits nor
 * whitespace, with a letter or digit on each side, is removed ("don't" is "dont", "e-mail" is "email", "U.S.A." is "USA"); every other
 * run of characters that are not letters or digits becomes one line break if it holds one, else one space; the ends are trimmed. It is
 * never longer than its input, and a letter or digit is never added, changed or moved past another.
 * `origin[i]` is the index in the original text of the normalized text's unit `i`: a letter or digit's own, a separator's the run's first.
 */
export function normalizeWithOrigin(text: string): { readonly text: string; readonly origin: readonly number[] } {
  let unit = 0;
  const chars = [...text].map((ch) => { const c = { ch, at: unit, word: WORDISH.test(ch) }; unit += ch.length; return c; });
  // Pass 1: drop each run of punctuation (neither word nor whitespace) that has a word character on both sides.
  const kept: typeof chars = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (!c.word && !SPACE.test(c.ch)) {
      let j = i;
      while (j < chars.length && !chars[j]!.word && !SPACE.test(chars[j]!.ch)) j++;
      if (i > 0 && chars[i - 1]!.word && j < chars.length && chars[j]!.word) { i = j - 1; continue; }
      for (; i < j; i++) kept.push(chars[i]!);
      i = j - 1;
      continue;
    }
    kept.push(c);
  }
  // Pass 2: every run of non-word characters is one line break or one space.
  let out = '';
  const origin: number[] = [];
  for (let i = 0; i < kept.length; i++) {
    const c = kept[i]!;
    if (c.word) {
      out += c.ch;
      for (let u = 0; u < c.ch.length; u++) origin.push(c.at + u);
      continue;
    }
    let j = i;
    let broken = false;
    while (j < kept.length && !kept[j]!.word) { broken ||= BREAK.test(kept[j]!.ch); j++; }
    out += broken ? '\n' : ' ';
    origin.push(c.at);
    i = j - 1;
  }
  const lead = out.length - out.trimStart().length;
  const kept2 = out.trim();
  return { text: kept2, origin: origin.slice(lead, lead + kept2.length) };
}

/** `normalizeWithOrigin`'s text alone: what the matcher reads of a string. */
export const normalize = (text: string): string => normalizeWithOrigin(text).text;

/** Whether two strings are the same words as the matcher reads them: the same once normalized, case-folded as its `i` folds them. */
export const sameWords = (a: string, b: string): boolean => new RegExp(`^${escape(normalize(a))}$`, 'iu').test(normalize(b));

export function occurrences(text: string, phrase: string): Occurrence[] {
  const wanted = normalize(phrase);
  if (!WORDISH.test(wanted)) return [];
  const { text: read, origin } = normalizeWithOrigin(text);
  const find = new RegExp(`(?<![\\p{L}\\p{N}])${escape(wanted)}(?![\\p{L}\\p{N}])`, 'giu');
  return [...read.matchAll(find)].map((m) => {
    const last = m.index! + m[0].length - 1;
    // The match ends on a letter or digit, so its last unit is a character's own (or, past the BMP, the second unit of a pair).
    return { from: origin[m.index!]!, to: origin[last]! + 1 };
  });
}

/** Whether the phrase is in the text as a whole word at least once; an empty phrase, or one with no letter or digit, is in nothing. */
export const phraseIn = (plain: string, phrase: string): boolean => occurrences(plain, phrase).length > 0;
