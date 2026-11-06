/**
 * The checks on the Lens's words (backfill-boards design, section 6): what each block of a card's words is for, held to what
 * can be checked from the words alone. The heading (`CardView.state`, or `CardUi.status` for a card with no live view) is a
 * short status, never a sentence; a view that holds the reader or covers the post has an `ends`, its way out (CLAUDE.md, "No
 * player is ever stuck"). Pure: `instanceUiProblems` runs `wordsProblems` over every card's status, and each effect's own
 * tests run `viewProblems` over the views it can show.
 */
import type { CardView } from './types.ts';

/** The most words a state or status may run: a heading, not a description. */
export const STATUS_MAX_WORDS = 6;

/** What a view does to the reader: holds their screen (`EffectProps.holdScreen`), or covers the post (`CardUi.takeover`). */
export interface ViewKind {
  readonly holds: boolean;
  readonly covers: boolean;
}

/** The words counted: a run with a letter or a digit in it, so a separating "·" is no word. */
const wordCount = (words: string): number => words.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Whether the words hold a sentence: a stop followed by more words, or a colon. */
const isSentence = (words: string): boolean => /[.!?]\s+\S/u.test(words.trim()) || words.includes(':');

/** A state or status held to the roles; each problem names the predicate that failed. */
export function wordsProblems(what: 'state' | 'status', words: string): string[] {
  if (words.trim() === '') return [`the ${what} is empty`];
  const out: string[] = [];
  if (isSentence(words)) out.push(`the ${what} "${words}" is a sentence (a stop followed by more words, or a colon), and a ${what} is a short status`);
  const n = wordCount(words);
  if (n > STATUS_MAX_WORDS) out.push(`the ${what} "${words}" is ${n} words, over the ${STATUS_MAX_WORDS} a ${what} may run`);
  return out;
}

/** A view held to the roles: its state, and an `ends` whenever it holds the reader or covers the post. */
export function viewProblems(view: CardView, kind: ViewKind): string[] {
  const out = wordsProblems('state', view.state);
  const needs = kind.holds ? 'holds the reader' : kind.covers ? 'covers the post' : null;
  if (needs !== null && (view.ends === undefined || view.ends.trim() === '')) out.push(`the view "${view.state}" ${needs} and has no ends, its way out`);
  return out;
}
