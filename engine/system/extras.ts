/**
 * What a model reads of a post besides its words (docs/plans/2026-11-25-reads-see-the-board-design.md, sections 1 to 3b): its poll, the plays on it, its reactions, a rewind,
 * and the origin a spun thread was spun from. The types are the answer `post_extras` gives (and `pool_read` carries for each post); the renderers are pure, one set for every read
 * (the reader, the digest, the patrol), and say a time only from the `now` they are passed.
 *
 * The engine names no card, no reaction and no group: a key becomes a name through a callback the instance's lists answer. Everything rendered is what any reader of the board sees:
 * counts of characters, public sums by kind, never who voted or reacted.
 */
import type { PronounSet } from '../rules/pronouns.ts';
import { ago, until } from './when.ts';

/** A post's live poll as `post_extras` answers it. `names` is the design's path for voters' names on a public poll: unread today, and it changes nothing rendered. */
export interface ReadPoll {
  readonly question: string;
  readonly options: readonly string[];
  /** How many options a ballot may pick. */
  readonly pick: number;
  readonly secret: boolean;
  readonly endsAt: string;
  readonly closed: boolean;
  readonly closedBy: 'author' | 'admin' | null;
  /** Each option's count, in the options' order. */
  readonly counts: readonly number[];
  /** The number of characters whose ballots count. */
  readonly voters: number;
  readonly names?: readonly (readonly string[])[];
}

/** One play the board shows on a post: the card's key (null for a face-down back), when, the caster as the board names it (null where it names none), its configuration and public state. */
export interface ReadPlay {
  readonly play: string;
  readonly card: string | null;
  readonly at: string;
  readonly by: string | null;
  readonly config: unknown;
  readonly state: unknown;
}

/** Public reaction counts by kind (`{}` for none). */
export type Reactions = Readonly<Record<string, number>>;

/** `post_extras`' answer for one post. `body` is present where the post shows another version of itself (a rewind): then it is the shown version's body. */
export interface PostExtras {
  readonly post: string;
  readonly poll: ReadPoll | null;
  readonly plays: readonly ReadPlay[];
  readonly reactions: Reactions;
  readonly rewoundTo: string | null;
  readonly body?: string;
}

/** A post as an origin's block or a reader's candidate shows it, for the parts the renderers read. */
export interface Extras {
  readonly poll: ReadPoll | null;
  readonly plays: readonly ReadPlay[];
  readonly reactions: Reactions;
  readonly rewoundTo?: string | null;
}

/** A post place as `thread_open.origin_place` stores it. */
export interface PostPlace { readonly kind: 'post'; readonly thread: string; readonly title: string; readonly seq: number }
export type PlaceOn =
  | PostPlace
  | { readonly kind: 'update'; readonly act: string; readonly title: string }
  | { readonly kind: 'character'; readonly id: string; readonly name: string | null }
  | { readonly kind: 'thread'; readonly id: string; readonly title: string }
  | { readonly kind: 'board'; readonly slug: string; readonly name: string };

/** `origin_place` as stored (0079, 0351, 0396, 0422). */
export type ReadPlace =
  | PostPlace
  | { readonly kind: 'update'; readonly act: string; readonly title: string }
  | { readonly kind: 'poll'; readonly question: string; readonly on: PostPlace }
  | { readonly kind: 'ballot'; readonly character: { readonly id: string; readonly name: string }; readonly question: string; readonly on: PostPlace }
  | { readonly kind: 'play'; readonly card: string | null; readonly on: PlaceOn | null; readonly from?: PostPlace | null; readonly at?: PostPlace | null }
  | {
    readonly kind: 'answer'; readonly spun: 'ask' | 'answer'; readonly ask: 'report' | 'appeal';
    readonly asker: { readonly id: string; readonly name: string }; readonly staff: { readonly id: string; readonly name: string } | null;
    readonly punishment: 'infraction' | 'ban' | 'move' | null; readonly group: string | null; readonly on: PostPlace | null;
  };

/** The origin post: a candidate-shaped post plus where it is. `seq` is null or absent for an Updates post. */
export interface ReadOriginPost extends Extras {
  readonly act: string;
  readonly seq?: number | null;
  readonly at: string;
  readonly author: string;
  readonly name: string;
  readonly pronouns?: PronounSet | null;
  readonly body: string;
  readonly thread?: string | null;
  readonly title: string;
}

/** `pool_read`'s `origin`: what the thread was spun from. `moment`: the origin is read as it stood at the spin (a play spin), not live. */
export interface ReadOrigin {
  readonly kind: string;
  readonly place: ReadPlace | null;
  readonly at: string;
  readonly spunAt: string;
  readonly moment: boolean;
  readonly post: ReadOriginPost | null;
}

/** What the instance names: a card's name by key, a group's by key. */
export interface PlaceNames {
  readonly cardName?: (key: string) => string | undefined;
  readonly groupName?: (key: string) => string | undefined;
}

const clip = (s: string, n: number): string => { const chars = [...s]; return chars.length > n ? `${chars.slice(0, n).join('')}…` : s; };

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The options at the top count, and that count. */
function leaders(poll: ReadPoll): { names: string[]; top: number; second: number } {
  const counts = poll.options.map((_, i) => poll.counts[i] ?? 0);
  const top = counts.reduce((m, c) => Math.max(m, c), 0);
  const names = poll.options.filter((_, i) => counts[i] === top);
  const second = counts.reduce((m, c) => (c < top ? Math.max(m, c) : m), 0);
  return { names, top, second };
}

const joinAnd = (xs: readonly string[]): string => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A poll under its post, in the design's section 1 form. */
export function pollLines(poll: ReadPoll, now: number): string[] {
  const rules = [poll.pick === 1 ? 'pick one' : `pick up to ${poll.pick}`, ...(poll.secret ? ['secret ballots'] : [])].join('; ');
  const state = !poll.closed ? `Open: ends ${until(poll.endsAt, now)}.`
    : poll.closedBy === null ? `Closed ${ago(poll.endsAt, now)}.`
    : `Closed early, by ${poll.closedBy === 'author' ? 'its author' : 'an admin'}.`;
  const total = poll.options.reduce((s, _, i) => s + (poll.counts[i] ?? 0), 0);
  const options = poll.options.map((o, i) => {
    const c = poll.counts[i] ?? 0;
    return `  ${i + 1}. ${o}: ${c} (${total === 0 ? 0 : Math.round((100 * c) / total)}%)`;
  });
  const voted = poll.voters === 0 ? 'No one has voted.' : `${count(poll.voters, 'character', 'characters')} voted.`;
  return [`[poll on this post] "${poll.question}" (${rules})`, `  ${state}`, ...options, `  ${voted}`];
}

/** A poll in one line, for the digest: `[poll: "Rename this board?", Yes leads 9 to 4, closes in 2 hours]`; tied and closed forms read as the same line with their own verbs. */
export function pollShort(poll: ReadPoll, now: number): string {
  const { names, top, second } = leaders(poll);
  const tied = names.length > 1;
  const standing = top === 0 ? 'no votes yet'
    : tied ? `${joinAnd(names)} tied at ${top}`
    : `${names[0]} ${poll.closed ? 'won' : 'leads'} ${top} to ${second}`;
  const time = !poll.closed ? `closes ${until(poll.endsAt, now)}`
    : poll.closedBy === null ? `closed ${ago(poll.endsAt, now)}`
    : `closed early by ${poll.closedBy === 'author' ? 'its author' : 'an admin'}`;
  return `[poll: "${poll.question}", ${standing}, ${time}]`;
}

/**
 * One play as a line. `seen` is the instance's sentence for it (null for a card with no `seen`, or a back with no card); without one the line says what is known: the card's name by `cardName`
 * ("A card" where the instance does not have it) or "A card set face down", and when.
 */
export function playLine(play: ReadPlay, o: { readonly now: number; readonly seen: string | null; readonly cardName: (key: string) => string | undefined }): string {
  if (o.seen !== null && o.seen !== '') return `[${o.seen}]`;
  const who = play.card === null ? 'A card set face down' : o.cardName(play.card) ?? 'A card';
  return `[${who} was played on this post, ${ago(play.at, o.now)}.]`;
}

/** `[Reactions: ❤ 3, 😂 1]`: most first, then by kind; each kind as `name` says it. Null for none. */
export function reactionLine(reactions: Reactions, name: (kind: string) => string): string | null {
  const kinds = Object.keys(reactions).filter((k) => (reactions[k] ?? 0) > 0).sort((a, b) => reactions[b]! - reactions[a]! || (a < b ? -1 : a > b ? 1 : 0));
  return kinds.length === 0 ? null : `[Reactions: ${kinds.map((k) => `${name(k)} ${reactions[k]}`).join(', ')}]`;
}

/** The line before a rewound post's body, or null for a post that is not. */
export function rewoundLine(rewoundTo: string | null | undefined, now: number): string | null {
  return rewoundTo === null || rewoundTo === undefined ? null : `[This post is showing how it looked ${ago(rewoundTo, now)}.]`;
}

const postWords = (p: { readonly seq: number; readonly title: string }): string => `post #${p.seq} in "${p.title}"`;

function onWords(on: PlaceOn): string {
  switch (on.kind) {
    case 'post': return postWords(on);
    case 'update': return `the Updates post "${on.title}"`;
    case 'character': return on.name ?? 'a character';
    case 'thread': return `the thread "${on.title}"`;
    case 'board': return `the board ${on.name}`;
  }
}

/** The phrase after "spun from", as the ORIGIN band says it (every `origin_place` kind). A key the instance lacks never names a card or a group. */
export function placeWords(place: ReadPlace | null, names: PlaceNames = {}): string {
  if (place === null || typeof place !== 'object') return 'somewhere on the board';
  switch (place.kind) {
    case 'post': return postWords(place);
    case 'update': return `the Updates post "${place.title}"`;
    case 'poll': return `the poll "${clip(place.question, 60)}" on ${postWords(place.on)}`;
    case 'ballot': return `${place.character.name}'s ballot in the poll "${clip(place.question, 60)}" on ${postWords(place.on)}`;
    case 'play': {
      const card = place.card === null ? 'a face-down card' : names.cardName?.(place.card) ?? 'a card';
      if (place.on === null) return card;
      if (place.on.kind !== 'character') return `${card} on ${onWords(place.on)}`;
      const at = place.at ?? null;
      const from = place.from ?? null;
      const tail = at !== null ? `, at ${postWords(at)}` : from !== null ? `, cast from ${postWords(from)}` : '';
      return `${card} on ${onWords(place.on)}${tail}`;
    }
    case 'answer': {
      const appeal = place.ask === 'appeal';
      const post = place.on === null ? 'a post' : postWords(place.on);
      const what = !appeal ? post
        : place.punishment === 'move' ? `the move into ${place.group === null ? 'a group' : names.groupName?.(place.group) ?? place.group}`
        : `${place.punishment === 'ban' ? 'the ban from' : 'the warn points from'} ${post}`;
      const lead = place.spun === 'answer' && place.staff !== null ? `${place.staff.name}'s ${appeal ? 'ruling on ' : 'verdict on '}` : '';
      return `${lead}${place.asker.name}'s ${appeal ? 'appeal of ' : 'report of '}${what}`;
    }
    default: return 'somewhere on the board';
  }
}

/** The origin's one line: `(This thread was spun 3 days ago from <place>, 6 months ago.)`, with "as it stood when it was spun" for a moment. */
export function originLine(origin: ReadOrigin, now: number, names: PlaceNames = {}): string {
  const moment = origin.moment ? ', as it stood when it was spun' : '';
  return `(This thread was spun ${ago(origin.spunAt, now)} from ${placeWords(origin.place, names)}, ${ago(origin.at, now)}${moment}.)`;
}
