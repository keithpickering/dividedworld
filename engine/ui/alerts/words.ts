/**
 * The words of an Alerts row (the alerts plan, Task 9; the alerts design, sections 2, 4, 9 and 12): each kind's line, its detail and its ways
 * (a link, or the way out the row offers), from the row (`Alert`) and the public Acts it names. Plain and true ("The fiction may lie; the log
 * never does"): no line names a caster or a reactor, and none depends on anything private; every name here is the player's own character's, a
 * thread's title or the target's public name.
 */
import type { Act, Alert, Id } from '../data/api.ts';
import type { Instance } from '../../rules/types.ts';
import type { InstanceUi } from '../types.ts';
import { FOLLOWED_COUNT_CAP } from '../data/api.ts';
import { pageOf, threadHref } from '../thread/pages.ts';

/** A run of words: plain, or a title set in italics, as the board draws it. */
export type Part = string | { readonly em: string };
/** A link a row offers. `state` is what the navigation carries (router.tsx). */
export interface Way { readonly text: string; readonly to: string; readonly state?: unknown }
export interface Said {
  readonly line: readonly Part[];
  readonly detail: readonly Part[];
  readonly ways: readonly Way[];
  /** The tag at the row's right: the character it concerns, or whose it is. */
  readonly who: string;
}
export interface WordsContext {
  readonly instance: Pick<Instance, 'cards'>;
  readonly ui: Pick<InstanceUi, 'copy'>;
  /** The Acts the rows name, and the Acts those name (a card's post). */
  readonly acts: ReadonlyMap<Id, Act>;
  /** The furthest seq read in each followed thread (a thread never read is absent); null where it could not be read. */
  readonly reading: Readonly<Record<Id, number>> | null;
  /** Followed thread -> the name of the player's own character that started it (a public fact, the thread's first post); absent for a thread followed by choice. */
  readonly startedBy: ReadonlyMap<Id, string>;
  readonly perPage: number;
  /** The settlement id (a row's `sub`) of the newest settlement, which `/log/settlement` shows. */
  readonly newestSettlement: string | null;
}

export const plainText = (parts: readonly Part[]): string => parts.map((p) => (typeof p === 'string' ? p : p.em)).join('');

/** Sentences in a row, a space between those that are not empty. */
const sentences = (...groups: readonly (readonly Part[])[]): Part[] => groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? [...g] : [' ', ...g]));
const inTitle = (row: Alert, tail = '.'): Part[] => (row.title ? ['In ', { em: row.title }, tail] : []);
const threadWay = (row: Alert): Way[] => (row.thread ? [{ text: 'Go to the thread', to: `/t/${row.thread}` }] : []);
const ownPost = (name: string | null) => (name ? `${name}'s post` : 'your post');

/** A post's number in words: "Pipewrench's post #43", else "a post of Pipewrench's" when the post could not be read. */
function postWords(name: string | null, post: Act | undefined): string {
  if (post && post.seq !== null) return `${ownPost(name)} #${post.seq}`;
  return name ? `a post of ${name}'s` : 'your post';
}
const postHref = (post: Act, ctx: WordsContext) => threadHref(post.thread, pageOf(post.seq!, ctx.perPage), post.seq!);

/** The way to a post: the post itself where its number is known, else its thread. */
function postWay(post: Act | undefined, row: Alert, ctx: WordsContext): Way[] {
  if (post && post.seq !== null) return [{ text: 'Go to the post', to: postHref(post, ctx) }];
  return threadWay({ ...row, thread: post?.thread ?? row.thread });
}

/** The post an Act is about: itself, or the post a card was played on. */
const aboutPost = (a: Act | undefined, ctx: WordsContext): Act | undefined => (a?.kind === 'card' && a.targetActId ? ctx.acts.get(a.targetActId) : a);

const cardName = (key: unknown, ctx: WordsContext): string | null => ctx.instance.cards.find((c) => c.key === key)?.name ?? null;

/** A card play's parts: its name, where it landed, the detail and the way to it. Null when the play could not be read. */
function cardOn(row: Alert, ctx: WordsContext): { card: string; place: Part[]; detail: Part[]; ways: Way[] } | null {
  const play = row.act === null ? undefined : ctx.acts.get(row.act);
  if (!play) return null;
  const card = cardName(play.payload.card, ctx) ?? 'A card';
  const id = (key: string) => (typeof play.payload[key] === 'string' ? play.payload[key] as Id : null);
  const said = typeof play.payload.targetName === 'string' && play.payload.targetName !== '' ? play.payload.targetName : null;
  switch (play.payload.reach) {
    case 'character': {
      const target = id('character');
      const name = said ?? row.name ?? 'your character';
      return { card, place: [name], detail: ['It was played on your character, not on a post.'], ways: target ? [{ text: `Go to ${name}`, to: `/c/${encodeURIComponent(target)}` }] : [] };
    }
    case 'thread': {
      const target = id('thread');
      const title = said ?? row.title ?? 'your thread';
      return { card, place: [{ em: title }], detail: ['Your character started this thread.'], ways: target ? [{ text: 'Go to the thread', to: threadHref(target, 1) }] : threadWay(row) };
    }
    default: {
      const post = play.targetActId ? ctx.acts.get(play.targetActId) : undefined;
      return { card, place: [postWords(row.name, post)], detail: inTitle(row), ways: postWay(post, row, ctx) };
    }
  }
}

/** The key the cards of one target share, so a page can batch them; null for a row that is not a card on something that can be told. */
export function targetKey(row: Alert, ctx: WordsContext): string | null {
  if (row.kind !== 'cardOnYours' || row.act === null) return null;
  const play = ctx.acts.get(row.act);
  if (!play) return null;
  const reach = typeof play.payload.reach === 'string' ? play.payload.reach : 'post';
  const target = reach === 'post' ? play.targetActId : play.payload[reach];
  return typeof target === 'string' && target !== '' ? `${reach}:${target}` : null;
}

/** Cards played on one target, as one row ("Glitter Bomb and 2 more were played on your post"); `rows` are newest first. */
export function batchWords(rows: readonly Alert[], ctx: WordsContext): Said {
  const newest = rows[0]!;
  const on = cardOn(newest, ctx);
  if (!on || rows.length === 1) return wordsFor(newest, ctx);
  return {
    line: [`${on.card} and ${rows.length - 1} more were played on `, ...on.place],
    detail: sentences([`${rows.length} cards in all.`], on.detail),
    ways: on.ways,
    who: newest.name ?? 'Yours',
  };
}

export function wordsFor(row: Alert, ctx: WordsContext): Said {
  const who = row.name ?? 'Yours';
  const act = row.act === null ? undefined : ctx.acts.get(row.act);
  switch (row.kind) {
    case 'quote':
      return {
        line: [`${ownPost(row.name)} was quoted`],
        detail: row.title ? ['In ', { em: row.title }, act && act.seq !== null ? `, post #${act.seq}.` : '.'] : [],
        ways: postWay(act, row, ctx), who,
      };
    case 'cardOnYours': {
      const on = cardOn(row, ctx);
      if (!on) return { line: ['A card was played on something of yours'], detail: inTitle(row), ways: threadWay(row), who };
      return { line: [`${on.card} was played on `, ...on.place], detail: on.detail, ways: on.ways, who };
    }
    case 'trapStruck': {
      const post = act?.targetActId ? ctx.acts.get(act.targetActId) : undefined;
      const card = cardName(act?.payload.card, ctx);
      return {
        line: [`A trap struck ${postWords(row.name, post)}`],
        detail: sentences(card ? [`It laid ${card} on it.`] : [], inTitle(row)),
        ways: postWay(post, row, ctx), who,
      };
    }
    case 'trapSprang': {
      const post = act?.targetActId ? ctx.acts.get(act.targetActId) : undefined;
      const card = cardName(act?.payload.card, ctx);
      return { line: ['Your trap sprang'], detail: sentences(card ? [`The trap was ${card}, in `, ...(row.title ? [{ em: row.title }] : ['a thread']), '.'] : inTitle(row)), ways: postWay(post ?? act, row, ctx), who };
    }
    case 'hint': {
      const own = row.sub === null ? undefined : ctx.ui.copy.alerts?.hint?.(row.sub, { card: act?.kind === 'card' });
      const post = aboutPost(act, ctx);
      return {
        line: [own ? own.line : `A pattern in the reactions to ${ownPost(row.name)}`],
        detail: own ? [own.detail] : sentences(['Counted from the reaction counts anyone can see on the post.'], inTitle(row)),
        ways: postWay(post, row, ctx), who,
      };
    }
    case 'ruling':
      return { line: [`A ruling landed on ${row.name ?? 'your character'}`], detail: sentences(['The ruling is public, on the board.'], inTitle(row)), ways: postWay(aboutPost(act, ctx), row, ctx), who };
    case 'settlement': {
      const moved = row.count === null ? 'It moved your characters.' : `It moved ${row.count} of your characters.`;
      const newest = row.sub !== null && row.sub === ctx.newestSettlement;
      const id = Number(row.sub);
      return {
        line: ['A settlement is in'], detail: [moved],
        ways: newest ? [{ text: 'Open the summary', to: '/log/settlement' }] : Number.isInteger(id) ? [{ text: 'Open it in My log', to: '/log', state: { open: id } }] : [{ text: 'Open My log', to: '/log' }],
        who: 'All yours',
      };
    }
    case 'followed': {
      const n = row.count ?? 0;
      const count = n >= FOLLOWED_COUNT_CAP ? `${FOLLOWED_COUNT_CAP}+` : String(n);
      const thread = row.thread;
      const first = ctx.reading === null || thread === null ? null : (ctx.reading[thread] ?? 0) + 1;
      const by = thread === null ? undefined : ctx.startedBy.get(thread);
      return {
        line: [`${count} new ${n === 1 ? 'post' : 'posts'} in `, { em: row.title ?? 'a thread' }],
        detail: [by === undefined ? 'Since you last read it.' : `Since you last read it. You follow it because ${by} started it.`],
        ways: thread === null ? [] : first === null ? threadWay(row) : [{ text: 'First unread post', to: threadHref(thread, pageOf(first, ctx.perPage), first) }],
        who: by ?? 'Followed',
      };
    }
    case 'update':
      return {
        line: [`New update${row.name ? ` from ${row.name}` : ''}: “${row.title ?? ''}”`], detail: [],
        ways: row.act === null ? [] : [{ text: 'Read it in Updates', to: `/updates?update=${encodeURIComponent(row.act)}` }], who: 'Everyone',
      };
    case 'seasonNews': {
      const ways = [{ text: 'Read it on the Season page', to: '/season?tab=news' }];
      const n = row.count;
      const own = row.sub === null ? undefined : ctx.ui.copy.alerts?.seasonNews?.(row.sub, row);
      if (own) return { line: [own.line], detail: own.detail === '' ? [] : [own.detail], ways, who: 'Everyone' };
      switch (row.sub) {
        case 'results': return { line: ['The season\'s results are in'], detail: n === null ? [] : [`${n} characters ranked.`], ways, who: 'Everyone' };
        case 'tally': return { line: ['New debuts and Turns are in'], detail: n === null ? [] : [`${n} ${n === 1 ? 'character is' : 'characters are'} named.`], ways, who: 'Everyone' };
        case 'bossArrived': return { line: [row.name ? `A new Boss has arrived: ${row.name}` : 'A new Boss has arrived'], detail: [], ways, who: 'Everyone' };
        case 'bossLeft': return { line: [row.name ? `The Boss, ${row.name}, has left` : 'The Boss has left'], detail: [], ways, who: 'Everyone' };
        default: return { line: ['There is news for the season'], detail: [], ways, who: 'Everyone' };
      }
    }
  }
}
