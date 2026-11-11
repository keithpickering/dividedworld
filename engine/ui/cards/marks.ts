/**
 * The pure parts of a post's marks (Marks.tsx; marks-and-the-lens design, section 1): which kinds a post carries and in
 * what order, how many marks a strip draws before it ends in "+N", and the words a mark is named by. Kept apart from the
 * screen so the order and the names are tested under plain node.
 */
import type { Tally } from '../data/api.ts';
import type { GimmickEffect } from '../../rules/cards.ts';
import type { Span } from '../../rules/types.ts';
import type { CardPlay } from './types.ts';
import { dayAndTime } from '../characters/format.ts';
import { orbs } from './faces.ts';
import { shareWords } from '../copy-words.ts';
import { STATUS_MAX_WORDS } from './lens-words.ts';

/** The most marks a strip draws on a desktop, before the "+N" mark. */
export const MARKS_WIDE = 4;
/**
 * The most under the thread's 40em breakpoint (cards/Effects.tsx `useNarrow`). Two and "+N", not three: the strip's tiles are 2.25rem
 * (glass/meta-tile.css), and three marks and "+N" leave a phone's 390px date bar 100px for a 140px date, which the bar would cut with an
 * ellipsis (e2e/glass-layout.spec.ts, the Lens story's post #41). The "+N" mark opens the Lens on the first kind left out.
 */
export const MARKS_NARROW = 2;

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
export function markName(m: { readonly card: string; readonly plays: number; readonly state: string; readonly more: boolean; readonly yours: boolean; readonly where?: string }): string {
  const state = m.state.trim().replace(/[.\s]+$/u, '');
  const said = state === '' || state === m.card ? '' : `, ${state}`;
  return [
    `${m.card}, ${playsPhrase(m.plays)}${said}. Opens the cards on this ${m.where ?? 'post'}.`,
    m.more ? 'One has more reactions than the post.' : '',
    m.yours ? 'Yours to act on.' : '',
  ].filter((s) => s !== '').join(' ');
}

/** The "+N" mark's name: it begins with its visible text, so a voice command for what is seen finds it. */
export const moreName = (hidden: number): string => `+${hidden} more ${hidden === 1 ? 'card' : 'cards'} played on this post`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 5": a day in UTC, as the log says its days. */
export const utcDate = (iso: string): string => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
/** "Nov 5": a day in the reader's zone, as a back's words say when it was set and when it sprang. */
const localDate = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const DAY = 86_400_000;
export const spanMs = (s: Span): number => s.count * (s.unit === 'minute' ? 60_000 : s.unit === 'hour' ? 3_600_000 : s.unit === 'day' ? DAY : s.unit === 'week' ? 7 * DAY : 30 * DAY);
const article = (name: string) => `${/^[aeiou]/iu.test(name) ? 'an' : 'a'} ${name}`;

/**
 * A card back's words (the card mechanic's design, section 3): the same for every card face down, so a reader cannot tell one card's back
 * from another's. Its `state` is the engine's alone ("Face down on this post", the Lens's status); who set it and when is its play's
 * `note`, and when it ends is its `ends`, in the reader's zone. Once it has sprung, the card is public, and its name is said.
 * The end is the one the server stored when the card was set (`back.endsAt`), the same span for every Set, so it names no card either; a back
 * with none (a read from before 0155 carried no end) says only that its end is not shown, which is true where nothing else is known. `cardName` is asked only of a back that sprang.
 */
export function backWords(back: CardPlay, setter: string, cardName: (key: string) => string): { readonly name: string; readonly state: string; readonly note: string; readonly ends: string } {
  if (back.revealed) {
    const card = cardName(back.revealed.card);
    return { name: `${card}, set face down by ${setter}`, state: `Sprang on ${localDate(back.revealed.at)}`, note: `${article(card).replace(/^a/u, 'A')} set face down by ${setter}.`, ends: 'It has sprung, and ended.' };
  }
  if (back.takenBack) return { name: `A card set face down by ${setter}`, state: `Taken back on ${localDate(back.takenBack.at)}`, note: `Set face down by ${setter} on ${localDate(back.playedAt)}, and taken back.`, ends: 'It was taken back, and ended.' };
  const ends = back.endsAt ? `${endsWords(back.endsAt)}, unless it springs first.` : 'Its end is not shown here.';
  return { name: `A card set face down by ${setter}`, state: 'Face down on this post', note: `Set face down by ${setter} on ${localDate(back.playedAt)}.`, ends };
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const list = (words: readonly string[]): string => (words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/**
 * A use card's words, as the Lens's status for a live one: what it does while it is up, and when it ends (or ended), the end in the
 * reader's zone. They are read from the effect's own numbers: a ward says everything it turns away (a card by the name `nameOf` gives), a price what a cast
 * costs more, an earn how much more a reaction earns (an earn's `by` is a share: 0.1 is 10%).
 */
export function gimmickWords(effect: GimmickEffect, ends: string | undefined, now: Date = new Date(), nameOf: (key: string) => string = (key) => key): { readonly state: string; readonly ends?: string; readonly report?: string } {
  if (ends !== undefined && Date.parse(ends) <= now.getTime()) return { state: 'Ended, changing nothing', ends: `Ended ${dayAndTime(ends)}` };
  const finish = (state: string, report?: string) => ({ state, ...(ends !== undefined ? { ends: endsWords(ends) } : {}), ...(report !== undefined ? { report } : {}) });
  if (effect.kind === 'price') return finish(`${list(effect.flavors.map(capital))} cards cost ${orbs(effect.add)} more here`);
  if (effect.kind === 'earn') return finish(`Earns ${Math.round(effect.by * 100)}% more from some reactions`);
  /* A ride pays the post's author, from the cards others cast on it: the heading is the short status, and the report says how much, from the effect's own share. */
  if (effect.kind === 'ride') return finish('Pays its author for votes here', `Each vote on a card another player casts here pays its author ${shareWords(effect.share)}.`);
  /* A ward turns away a card that meets any one of its conditions, so it says every one, in the order the rules read them. When that is more than a heading may run, the heading is the short "some cards" and the whole list is the detail. */
  const away = [...(effect.upTo !== undefined ? [`cards up to ${effect.upTo}`] : []), ...(effect.flavors?.length ? [`${list(effect.flavors.map(capital))} cards`] : []), ...(effect.cards?.map(nameOf) ?? [])];
  const full = `Turns away ${away.length > 0 ? list(away) : 'some cards'}`;
  return full.split(/\s+/u).length <= STATUS_MAX_WORDS ? finish(full) : finish('Turns away some cards', `${full}.`);
}

/** When a play beyond a post ends, as its Lens line says it: on its timer, in the reader's zone ("Ends Nov 7, 9:14 PM"). */
export const endsWords = (ends: string): string => `Ends ${dayAndTime(ends)}`;

/**
 * A caught play's note: what caught it, where the trap has been revealed (it always is, once it caught something). The card is spent unless the spring says
 * a player took it (`fate.taken`, the setter's character): a play caught before the face-down Moves, and one a staff catching set card caught, were spent.
 */
/** Where the card went is said only once the spring is read (`readCaughtFate`): `{ taken }` went to a player's hand, `{}` is spent; unread, nothing is claimed. */
export const caughtWords = (trap: string | null, fate?: { readonly taken?: string }): string =>
  `Caught by ${trap ? article(trap) : 'a trap'}. It did nothing${fate === undefined ? '' : `, and its card ${fate.taken ? `went to ${fate.taken}` : 'is spent'}`}.`;

/** The Lens's state for a play an admin ended: plain words, never in character. Its layer is off for everyone and nothing was refunded. */
export const endedWords = (): string => 'Ended by an admin';
/**
 * The Lens's words for a play whose first generation failed: it did not take, so its text never arrived and it is not in effect on the post.
 * Plain and true for every reader, in the glass's voice: it names no card and claims nothing about a hand or an Aura (a Mod Bot's play has none).
 */
export const UNTAKEN_STATE = 'Didn\'t take';
export const untakenWords = (): string => 'Didn\'t take. Its text never arrived, so it is not in effect on this post.';
/** The state for a kind whose plays are all over, some ended by an admin and some not taken: true of both. */
export const OVER_STATE = 'Over';
/** The Lens's heading for a kind whose plays a trap caught: a short status, the same for every kind; what caught it is each play's note (`caughtWords`). */
export const CAUGHT_STATE = 'Caught, did nothing';
