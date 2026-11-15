/**
 * A selection in a post's words, as the phrase a card's form takes (shared by Laugh Track's and THIS's play forms, which both point at whole words of the
 * post): the selection as whole words of the text, else without a first or last word that the selection cut short, else nothing.
 */
import { occurrences } from '../../../engine/bbcode/phrase.ts';
import { PHRASE } from '../cards/phrase-bound.ts';

export function wholeWords(selected: string, text: string): string {
  const words = selected.trim().split(/\s+/u).filter(Boolean);
  const tries = [words, words.slice(1), words.slice(0, -1), words.slice(1, -1)];
  for (const t of tries) {
    const phrase = t.join(' ');
    if (phrase && [...phrase].length <= PHRASE.most && occurrences(text, phrase).length > 0) return phrase;
  }
  return '';
}
