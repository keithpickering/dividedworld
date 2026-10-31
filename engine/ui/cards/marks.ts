/**
 * The pure parts of a post's marks (Marks.tsx; marks-and-the-lens design, section 1): which kinds a post carries and in
 * what order, how many marks a strip draws before it ends in "+N", and the words a mark is named by. Kept apart from the
 * screen so the order and the names are tested under plain node.
 */
import type { Tally } from '../data/api.ts';
import type { CardPlay } from './types.ts';

/** The most marks a strip draws on a desktop, before the "+N" mark. */
export const MARKS_WIDE = 4;
/** The most under the thread's 40em breakpoint (cards/Effects.tsx `useNarrow`). */
export const MARKS_NARROW = 3;

/**
 * The card kinds of a post's plays in billing order: a kind's place is the place of its first play in `billed` (the
 * most drawn of its plays, since billing puts the most drawn first, and a play that arrives live after them). Billing
 * is the plays store's, set when the page is read, so this order moves only when the page is read again.
 */
export function kindsOf(billed: readonly CardPlay[]): readonly string[] {
  return [...new Set(billed.map((p) => p.card))];
}

/** The sum of a tally: how many public reactions an Act has drawn. */
export function sumOf(tally: Tally): number {
  let sum = 0;
  for (const count of Object.values(tally)) sum += count;
  return sum;
}

/** "1 play" or "3 plays". */
export const playsPhrase = (n: number): string => (n === 1 ? '1 play' : `${n} plays`);

/**
 * A mark's accessible name: the card, its plays, and the card's state in plain words, then what pressing it does, then
 * what the corner sign and the notch say. The state is the card's own sentence, so any stop it ended with is dropped
 * before the name's; a card that has no more to say than its name (its view is the default's) is not named twice.
 */
export function markName(m: { readonly card: string; readonly plays: number; readonly state: string; readonly more: boolean; readonly yours: boolean }): string {
  const state = m.state.trim().replace(/[.\s]+$/u, '');
  const said = state === '' || state === m.card ? '' : `, ${state}`;
  return [
    `${m.card}, ${playsPhrase(m.plays)}${said}. Opens the cards on this post.`,
    m.more ? 'One has more reactions than the post.' : '',
    m.yours ? 'Yours to act on.' : '',
  ].filter((s) => s !== '').join(' ');
}

/** The "+N" mark's name: it begins with its visible text, so a voice command for what is seen finds it. */
export const moreName = (hidden: number): string => `+${hidden} more ${hidden === 1 ? 'card' : 'cards'} played on this post`;
