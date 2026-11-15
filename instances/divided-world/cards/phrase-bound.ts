/**
 * The phrase bound (Autocorrect's and Laugh Track's, and any card that covers a phrase of the post): 4 to 100 characters with at least 4
 * letters or digits, on one line. One list, so `validateConfig` refuses by it and a persona's repair drops by it.
 */
export const PHRASE = { least: 4, most: 100 } as const;
export const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
export const characters = (s: string) => [...s].length;
const WORDISH = /[\p{L}\p{N}]/gu;

/** A phrase as a card holds it (trimmed), or the reason it is out of bounds. */
export function boundedPhrase(raw: string): { readonly ok: true; readonly phrase: string } | { readonly ok: false; readonly why: string } {
  const phrase = raw.trim();
  if (characters(phrase) > PHRASE.most) return { ok: false, why: `the phrase is at most ${PHRASE.most} characters` };
  if ((phrase.match(WORDISH) ?? []).length < PHRASE.least) return { ok: false, why: `the phrase has at least ${PHRASE.least} letters or digits` };
  if (LINE_BREAK.test(phrase)) return { ok: false, why: 'the phrase is one line' };
  return { ok: true, phrase };
}
