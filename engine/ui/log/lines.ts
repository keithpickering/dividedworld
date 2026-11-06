/**
 * The player's log as lines (the web plan's Task 8; the log shares plan's Task 5): what Log.tsx draws
 * as the Log board's rows and Settlement.tsx as the Settlement board's summary, from one reading, so
 * the summary says nothing the log does not.
 *
 * Every line is the player's own rows, said plainly and truly ("The fiction may lie; the log never
 * does"): which Act, what it changed and how much. Nothing here is computed from a private fact of
 * anyone else's: no line counts or names who reacted, and the only classes named are the player's own
 * characters', read from the player's own rows (the class a settlement scored them as is its reasons'
 * class, and a Turn's old class is the one the announcement or that window's reasons said).
 *
 * A Turn is read from `MyCharacter.classSince`, which is the latest Turn's alone, so only a character's
 * latest Turn is a line; a rank change is read from the standing the season holds now less the lines
 * settled after it, so it is drawn for the open season's settlements and never across a season's end.
 * The standing and the log are two reads: a settlement applied between them would shift a rank line
 * by that settlement until the next load (a moment in a day; the settlement's own row is true).
 *
 * A settlement's row says the player's characters' lines; its wallet is the account's, every
 * character's lines together, and the summary says so beside one character's reasons.
 */
import { rankIndex } from '../../rules/ranks.ts';
import type { Instance } from '../../rules/types.ts';
import type { Act, Estimate, EstimateLine, Id, Log, LogLine, LogSettlement, MyCharacter, Season, TurnAnnounced, WalletEvent } from '../data/api.ts';
import { micros } from '../data/log-page.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { paramsOf } from '../economy.ts';
import type { InstanceUi } from '../types.ts';

/** A piece of a line's words: plain text, or a link to an Act or a thread. */
export type Segment = string | { readonly text: string; readonly href: string };

export type LineKind = 'estimate' | 'settlement' | 'turn' | 'rank' | 'bought' | 'played' | 'onMine' | 'saved'
  /* The card mechanic's (docs/plans/2026-11-01-card-mechanic-design.md, section 10). */
  | 'set' | 'sprung' | 'payout' | 'setEnded' | 'passed' | 'caught' | 'struck' | 'wardEnded'
  /* The bot-card-options design, section 3: an admin ended a card play. */
  | 'ended';

/** One row of the log. */
export interface LogRow {
  readonly key: string;
  readonly kind: LineKind;
  /** ISO time, shown in UTC. */
  readonly at: string;
  readonly what: string;
  readonly details: readonly Segment[];
  /** Hundredths this line moved for the characters of the tab; null where it moved none it can say (the wallet's own lines). */
  readonly aura: number;
  /** The wallet after this line, or null where the log cannot say (an estimate; a settlement that moved no wallet). */
  readonly wallet: number | null;
  /** Whose lines these are: a row is in each of these characters' tabs, and in All; none for the account's own (a purchase), in every tab. */
  readonly characters: readonly Id[];
  /** A settlement's row: the settlement, for its breakdown. */
  readonly settlement?: LogSettlement;
}

/** What the log is drawn from: the player's own reads, and the public Acts and threads its lines name. */
export interface LogData {
  readonly log: Log;
  readonly mine: readonly MyCharacter[];
  readonly estimate: Estimate | null;
  /** The open season's standing of each of the player's characters, now. */
  readonly standings: Readonly<Record<Id, number>>;
  readonly season: Season | null;
  /** The announced Turns of the player's characters. */
  readonly turns: readonly TurnAnnounced[];
  /** When the next settlement is (ISO), which a log with no line yet says its first will be; null where none is scheduled or the read failed. */
  readonly nextSettlement: string | null;
  /** The Acts the lines name, and the posts the card plays among them landed on. */
  readonly acts: ReadonlyMap<Id, Act>;
  /** Names of the characters whose posts the lines name. */
  readonly names: ReadonlyMap<Id, string>;
  /** Titles of the threads the lines name (The System's Turn announcements). */
  readonly titles: ReadonlyMap<Id, string>;
  /** The state each play's effect was last saved with, for the saves the log reads (`effectStates`, public). */
  readonly states: ReadonlyMap<Id, unknown>;
}

export interface Words {
  readonly instance: Instance;
  readonly ui: Pick<InstanceUi, 'reasonWords' | 'quadrantLabels' | 'cards' | 'copy'>;
  readonly postsPerPage: number;
  /** The economy as the server holds it now (`economyNow`): the numbers a line with none of its own is said with. */
  readonly economy: Readonly<Record<string, number>>;
}

const MINUS = '\u2212';

/** A settlement made before its shares were kept (the log shares design, section 5): said once, on its row, which does not open. */
export const BEFORE_SHARES = 'This settlement was made before posts were kept with it.';
/** What a share is (the design, section 3), under every breakdown. */
export const SHARES_ARE = 'Each reason\'s total is exact. It is split across your posts by how the live estimate valued their reactions.';
/** A reason the estimate valued on no post in its window. */
export const NO_SHARES = 'Scored over the whole window, not post by post.';

/** Aura with its sign, as the board writes it: "+0.20", "−0.05", "0.00". */
export const signed = (hundredths: number) => (hundredths > 0 ? '+' : hundredths < 0 ? MINUS : '') + (Math.abs(hundredths) / 100).toFixed(2);
/** Aura without a sign: "4.72". */
export const plain = (hundredths: number) => (hundredths / 100).toFixed(2);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 29": a day in UTC, as the log's times are. */
export const utcDay = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
/** "Oct 29 · 08:17": a day and a time in UTC, as the Log board's When (UTC) column writes them. */
export const utcWhen = (iso: string) => {
  const d = new Date(iso);
  return `${utcDay(iso)} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** A reason's name, the instance's words before their colon ("Drew heat"), and the whole of them (what it pays for). */
export function reasonName(words: string): string {
  const head = words.split(':')[0]!.trim();
  return head === '' ? words : head;
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The class a settlement scored a character's lines as: their reasons' class, when every one names the same class the instance has. */
export function scoredAs(lines: readonly LogLine[], instance: Instance): string | null {
  const keys = new Set(lines.map((l) => l.reason.split('.')[0]!));
  if (keys.size !== 1) return null;
  const [key] = keys;
  return instance.classes.find((c) => c.key === key)?.key ?? null;
}

const className = (instance: Instance, key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
const withArticle = (name: string) => `${/^[aeiou]/iu.test(name) ? 'an' : 'a'} ${name}`;

/** A link to an Act: a post by its number in its thread; a card play by the post it landed on. */
export function actLink(act: Act | undefined, data: Pick<LogData, 'acts' | 'names' | 'mine'> & Partial<Pick<LogData, 'titles'>>, words: Words, own?: string): Segment | null {
  if (!act) return null;
  if (act.kind === 'card') {
    const place = placeOf(act, data);
    if (place !== null) {
      const card = words.instance.cards.find((c) => c.key === act.payload.card)?.name ?? 'card';
      return `${data.mine.some((c) => c.id === act.character) ? 'your' : 'a'} ${card} on ${place}`;
    }
    const post = act.targetActId ? data.acts.get(act.targetActId) : undefined;
    const card = words.instance.cards.find((c) => c.key === act.payload.card)?.name ?? 'card';
    const target = post && post.seq !== null ? postWords(post, data, own) : 'a post';
    const mine = data.mine.some((c) => c.id === act.character);
    const href = post && post.seq !== null ? threadHref(post.thread, pageOf(post.seq, words.postsPerPage), post.seq) : null;
    const text = `${mine ? 'your' : 'a'} ${card} on ${target}`;
    return href ? { text, href } : text;
  }
  if (act.seq === null) return null;
  return { text: postWords(act, data, own), href: threadHref(act.thread, pageOf(act.seq, words.postsPerPage), act.seq) };
}

/**
 * Where a play beyond a post landed, by its public name (design, section 9): "Gloomba", "'Thwomp appreciation'", "the Hobbies board".
 * The play's payload holds the target's id; its name is read beside the log (`names`, `titles`: a board's is kept with the threads'), and
 * a name that could not be read is said plainly. Null for a play on a post, which the lines name by its author and number.
 */
export function placeOf(play: Act, data: Pick<LogData, 'names' | 'mine'> & Partial<Pick<LogData, 'titles'>>): string | null {
  const id = (key: string) => (typeof play.payload[key] === 'string' ? play.payload[key] as Id : null);
  /* The name the card was played with is the name the line uses (play_card writes it, 0056); a play without one reads the name as it stands. */
  const said = typeof play.payload.targetName === 'string' && play.payload.targetName !== '' ? play.payload.targetName : null;
  switch (play.payload.reach) {
    case 'character': { const c = id('character'); return said ?? (c && (data.mine.find((m) => m.id === c)?.name ?? data.names.get(c))) ?? 'a character'; }
    case 'thread': { const t = id('thread'); const title = said ?? (t ? data.titles?.get(t) : undefined); return title ? `'${title}'` : 'a thread'; }
    case 'board': { const b = id('board'); const name = said ?? (b ? data.titles?.get(b) : undefined); return name ? `the ${name} board` : 'a board'; }
    default: return null;
  }
}

/** "your post #43" for the post of the character whose line it is, as the Settlement board says it; "Gloomba's post #46" otherwise. */
function postWords(post: Act, data: Pick<LogData, 'names' | 'mine'>, own?: string): string {
  if (post.character !== null && post.character === own) return `your post #${post.seq}`;
  if (post.character === null) return `post #${post.seq}`;
  const mine = data.mine.find((c) => c.id === post.character);
  const name = mine?.name ?? data.names.get(post.character);
  return name ? `${name}'s post #${post.seq}` : `post #${post.seq}`;
}

/** What the cap or the floor held back of a settlement's wallet move, in plain words, or nothing. */
export function heldBack(event: WalletEvent | undefined, cap: number): string | null {
  if (!event) return null;
  if (event.overflow > 0) return `Your wallet holds at most ${plain(cap)}, so ${plain(event.overflow)} of this was not added.`;
  if (event.floored > 0) return `Your wallet cannot go below 0.00, so ${plain(event.floored)} of this loss was not taken.`;
  return null;
}

/** A character's rank change at a settlement: the standing before and after it, and the ranks they are. */
export interface RankChange {
  readonly character: Id;
  readonly before: number;
  readonly after: number;
  /** The rank's index before the settlement and after it (`Instance.ranks`). */
  readonly rankWas: number;
  readonly rankNow: number;
}

/** A character's Turn that took effect at a settlement. */
export interface TurnTaken {
  readonly character: Id;
  readonly classNow: string;
  /** The class it Turned from, where the player's own rows say it; null otherwise. */
  readonly classWas: string | null;
  /** The announcement, where The System made one. */
  readonly announced: TurnAnnounced | null;
  /** The settlement end it was due at, where a reveal made it wait for this one; null where it took effect when due. */
  readonly dueAt: string | null;
}

const sameTime = (a: string, b: string) => micros(a) === micros(b);

/** The rank changes each settlement made, by settlement id: the open season's settlements, from the standing now back. */
export function rankChanges(data: Pick<LogData, 'log' | 'standings' | 'season' | 'mine'>, instance: Instance): ReadonlyMap<number, readonly RankChange[]> {
  const out = new Map<number, RankChange[]>();
  if (!data.season || instance.ranks.length === 0) return out;
  const seasonStart = micros(data.season.startsAt);
  const newestFirst = [...data.log.settlements].sort((a, b) => micros(b.endsAt) - micros(a.endsAt));
  for (const c of data.mine) {
    let after = data.standings[c.id] ?? 0;
    for (const s of newestFirst) {
      if (micros(s.startsAt) < seasonStart) break;
      const moved = s.lines.filter((l) => l.character === c.id).reduce((sum, l) => sum + l.amount, 0);
      const before = after - moved;
      const rankWas = rankIndex(instance.ranks, before);
      const rankNow = rankIndex(instance.ranks, after);
      if (rankWas !== rankNow) out.set(s.id, [...(out.get(s.id) ?? []), { character: c.id, before, after, rankWas, rankNow }]);
      after = before;
    }
  }
  return out;
}

/** The Turns each settlement made take effect, by settlement id: each character's latest Turn, where it fell on a settlement read. */
export function turnsTaken(data: Pick<LogData, 'log' | 'mine' | 'turns'>, instance: Instance): ReadonlyMap<number, readonly TurnTaken[]> {
  const out = new Map<number, TurnTaken[]>();
  for (const c of data.mine) {
    const s = data.log.settlements.find((x) => sameTime(x.endsAt, c.classSince));
    if (!s) continue;
    const announced = data.turns.find((t) => t.character === c.id && sameTime(t.at, c.classSince)) ?? null;
    /* The window this settlement scored was played under the old class, so its reasons name it. */
    const from = announced?.was ?? scoredAs(s.lines.filter((l) => l.character === c.id), instance);
    out.set(s.id, [...(out.get(s.id) ?? []), { character: c.id, classNow: c.class, classWas: from === c.class ? null : from, announced, dueAt: c.classDueAt }]);
  }
  return out;
}

/** A settlement's lines in the order the boards say them: what it paid first, the largest first, then by reason; then what it cost. */
export function inOrder(lines: readonly LogLine[]): LogLine[] {
  return [...lines].sort((a, b) => b.amount - a.amount || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}

/** The words of one character's lines in a settlement, as the board's row says them: "drew heat +0.20, stole thunder +0.20". */
function scoredWords(lines: readonly LogLine[], words: Words): string {
  return inOrder(lines).map((l) => `${lowerFirst(reasonName(words.ui.reasonWords(l.reason, paramsOf(l, words.economy))))} ${signed(l.amount)}`).join(', ');
}

/**
 * The log's rows, newest first: the open window's estimate on top, then each settlement with its Turns and rank changes beside
 * it. `tab` is a character of the player's, or null for All.
 */
export function logRows(data: LogData, words: Words, cap: number, tab: Id | null): readonly LogRow[] {
  const { instance } = words;
  const nameOf = (id: Id) => data.mine.find((c) => c.id === id)?.name ?? '';
  const inTab = (ids: readonly Id[]) => tab === null || ids.length === 0 || ids.includes(tab);
  const settlementWallet = new Map<number, WalletEvent>();
  for (const e of data.log.wallet) if (e.kind === 'settlement' && e.settlement !== null) settlementWallet.set(e.settlement, e);
  const ranks = rankChanges(data, instance);
  const turns = turnsTaken(data, instance);
  const rows: LogRow[] = [];

  for (const s of data.log.settlements) {
    const lines = s.lines.filter((l) => tab === null || l.character === tab);
    const wallet = settlementWallet.get(s.id)?.balanceAfter ?? null;
    if (lines.length > 0) {
      const day = utcDay(s.startsAt);
      const byCharacter = [...new Set(lines.map((l) => l.character))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      const said: string[] = [];
      if (tab !== null) {
        const cls = scoredAs(lines, instance);
        said.push(`${cls ? `Scored as ${withArticle(className(instance, cls))}` : 'Scored'} for ${day}: ${scoredWords(lines, words)}.`);
      } else {
        said.push(`Scored for ${day}.`);
        for (const c of byCharacter) {
          const own = lines.filter((l) => l.character === c);
          const cls = scoredAs(own, instance);
          said.push(`${nameOf(c)}${cls ? ` as ${withArticle(className(instance, cls))}` : ''}: ${scoredWords(own, words)}.`);
        }
      }
      const held = heldBack(settlementWallet.get(s.id), cap);
      if (held) said.push(held);
      if (!s.sharesKept) said.push(BEFORE_SHARES);
      rows.push({
        key: `settlement:${s.id}`, kind: 'settlement', at: s.endsAt, what: 'Settlement', details: [said.join(' ')],
        aura: lines.reduce((sum, l) => sum + l.amount, 0), wallet, characters: byCharacter, settlement: s,
      });
    }
    for (const t of turns.get(s.id) ?? []) {
      if (!inTab([t.character])) continue;
      const details: Segment[] = [`${nameOf(t.character)} is ${withArticle(className(instance, t.classNow))} now.`];
      if (t.announced) {
        const act = data.acts.get(t.announced.act);
        const title = act ? data.titles.get(act.thread) : undefined;
        const where: Segment = act && title ? { text: title, href: act.seq !== null ? threadHref(act.thread, pageOf(act.seq, words.postsPerPage), act.seq) : threadHref(act.thread, 1) } : 'The System\'s board';
        details.push(` Announced ${t.announced.was ? 'with its old class ' : ''}in `, where, '.');
      } else {
        details.push(' A silent Turn: no one else was told.');
      }
      if (t.dueAt) details.push(` It was due at the settlement of ${utcDay(t.dueAt)} and waited for this one: ${nameOf(t.character)} revealed after that window had ended.`);
      rows.push({ key: `turn:${s.id}:${t.character}`, kind: 'turn', at: s.endsAt, what: 'Turn took effect', details, aura: 0, wallet, characters: [t.character] });
    }
    for (const r of ranks.get(s.id) ?? []) {
      if (!inTab([r.character])) continue;
      const up = r.rankNow > r.rankWas;
      const name = (i: number) => instance.ranks[i]?.name ?? '';
      rows.push({
        key: `rank:${s.id}:${r.character}`, kind: 'rank', at: s.endsAt, what: up ? 'Rank up' : 'Rank down',
        details: [`${tab === null ? `${nameOf(r.character)}: ` : ''}${name(r.rankWas)} to ${name(r.rankNow)}. Standing ${plain(r.before)} to ${plain(r.after)} this season.`],
        aura: 0, wallet, characters: [r.character],
      });
    }
  }

  rows.push(...cardRows(data, words).filter((r) => inTab(r.characters)));

  const ORDER: Record<LineKind, number> = { estimate: 0, settlement: 1, turn: 2, rank: 3, bought: 4, played: 4, onMine: 4, saved: 4, set: 4, sprung: 4, payout: 4, setEnded: 4, passed: 4, caught: 4, struck: 4, wardEnded: 4, ended: 4 };
  rows.sort((a, b) => micros(b.at) - micros(a.at) || ORDER[a.kind] - ORDER[b.kind]);
  return [...estimateRows(data, words, tab), ...rows];
}

/**
 * The card lines (the cards plan's Task 6): a card bought, a card played and on whose post (one of the player's own characters' posts
 * said so), a play another player landed on the player's post, and a save of its effect the card says is worth a line (a layer washed
 * clean). A card is paid for once, at the machine (#78), so a play's price is what its post added. A Stick Around certified is
 * reading, which the log does not track.
 */
function cardRows(data: LogData, words: Words): LogRow[] {
  const { instance, ui } = words;
  /* What the card says a play of it did (`CardUi.logPlay`), as one more sentence of the line; nothing where it says nothing. */
  const said = (key: unknown, play: Act | undefined): string[] => {
    const config = play?.payload.config;
    const sentence = ui.cards.find((c) => c.key === key)?.logPlay?.(typeof config === 'object' && config !== null ? config as Readonly<Record<string, unknown>> : {});
    return sentence ? [` ${sentence}`] : [];
  };
  /* A card the instance no longer has, or a play the log could not read, is said plainly: never a key, never "undefined". */
  const cardName = (key: unknown) => instance.cards.find((c) => c.key === key)?.name ?? 'a card';
  const mine = (id: Id | null | undefined) => id !== null && id !== undefined && data.mine.some((c) => c.id === id);
  const nameOf = (id: Id | null | undefined, unknown: string) => (id ? data.mine.find((c) => c.id === id)?.name ?? data.names.get(id) ?? unknown : unknown);
  const at = (iso: string) => micros(iso);
  const rows: LogRow[] = [];
  /* Each wallet event is one card line's: two purchases at one instant and one price take one event each, in the order both were read. */
  const used = new Set<number>();
  const take = (match: (w: WalletEvent) => boolean) => {
    const i = data.log.wallet.findIndex((w, n) => !used.has(n) && match(w));
    if (i < 0) return undefined;
    used.add(i);
    return data.log.wallet[i];
  };
  data.log.cards.forEach((e, i) => {
    if (e.kind === 'bought') {
      const spent = take((w) => w.kind === 'purchase' && at(w.at) === at(e.at) && w.change === -e.price);
      rows.push({
        key: `bought:${i}`, kind: 'bought', at: e.at, what: `You bought ${cardName(e.card)}`, details: [`From the ${ui.copy.shopName}, for ${plain(e.price)}.`],
        aura: -e.price, wallet: spent?.balanceAfter ?? null, characters: [],
      });
      return;
    }
    const play = e.act ? data.acts.get(e.act) : undefined;
    const post = play?.targetActId ? data.acts.get(play.targetActId) : undefined;
    const caster = play?.character ?? null;
    /* A play beyond a post is named by its target's public name, and says nothing of the post it sits on. */
    const place = play ? placeOf(play, data) : null;
    const link = place ?? (post ? actLink(post, data, words, caster ?? undefined) : null);
    const ownOther = place === null && mine(post?.character) && post?.character !== caster;
    const paid = take((w) => w.kind === 'play' && w.ref === e.act);
    /* A card set face down: its card is the setter's own row, said only to them. */
    if (play?.kind === 'set') {
      rows.push({
        key: `set:${e.act}`, kind: 'set', at: e.at, what: `You set ${cardName(e.card)} face down`,
        /* A Bluff carries no trap (my_card_ledger's `springs`); a row with no `springs` keeps the trap's words. */
        details: [`${cardName(e.card)} set face down on `, link ?? 'your post', e.springs === false ? '. It never springs, and ends by itself.' : '. It springs once, or ends by itself.'],
        aura: -e.price, wallet: paid?.balanceAfter ?? null, characters: caster ? [caster] : [],
      });
      return;
    }
    /* A play a trap caught: the caster's whole cost, the machine's and the post's, and that nothing came back. */
    const catchOf = data.log.caught.find((c) => c.play === e.act);
    if (catchOf) {
      const cost = catchOf.boughtPrice === null ? plain(e.price) : `${plain(catchOf.boughtPrice)} and ${plain(e.price)}`;
      rows.push({
        key: `caught:${e.act}`, kind: 'caught', at: e.at, what: `Your ${cardName(e.card)} was caught`,
        details: [`Your ${cardName(e.card)} on `, link ?? 'a post', ` was caught by ${withArticle(cardName(catchOf.trap))}; it cost ${cost}, and nothing came back.`],
        aura: -e.price, wallet: paid?.balanceAfter ?? null, characters: caster ? [caster] : [],
      });
      return;
    }
    /* A Use with a time up says when it ended, once that time has passed (the design's section 10: "a timed end"). */
    const ends = typeof play?.payload.ends === 'string' ? play.payload.ends : null;
    if (ends && Date.parse(ends) <= Date.now()) {
      rows.push({
        key: `wardEnded:${e.act}`, kind: 'wardEnded', at: ends, what: `${cardName(e.card)}${place ? ` on ${place}` : ''} ended`,
        details: [`${cardName(e.card)} on `, link ?? 'your post', ' ended.'],
        aura: 0, wallet: null, characters: caster ? [caster] : [],
      });
    }
    rows.push({
      key: `played:${e.act ?? i}`, kind: 'played', at: e.at, what: `You played ${cardName(e.card)}${place ? ` on ${place}` : ''}`,
      details: [
        `As ${nameOf(caster, 'one of your characters')}, on `, link ?? 'a post', `${ownOther ? ', a post of one of your own characters' : ''}. `,
        `The card was paid for at the machine; ${e.price > 0 ? `this ${place ? 'play' : 'post'} added ${plain(e.price)}.` : 'this play cost nothing more.'}`,
        ...said(e.card, play),
      ],
      aura: -e.price, wallet: paid?.balanceAfter ?? null, characters: [caster, ownOther ? post!.character : null].filter((c): c is Id => c !== null),
    });
  });
  for (const p of data.log.playsOnMine) {
    const play = data.acts.get(p.play);
    const post = data.acts.get(p.post);
    /* A play a trap caught did nothing: the spring's own line (setEndRows) says what it caught. */
    if (play && typeof play.payload.caught === 'string') continue;
    /* A trap's strike on the player's post: the trap is public once it has sprung, and so is the post it was set on. */
    const spring = typeof play?.payload.spring === 'string' ? data.acts.get(play.payload.spring) : undefined;
    if (spring) {
      const trapped = spring.targetActId ? data.acts.get(spring.targetActId) : undefined;
      rows.push({
        key: `struck:${p.play}`, kind: 'struck', at: p.at, what: 'A trap struck your post',
        details: [`${withArticle(cardName(spring.payload.card)).replace(/^a/u, 'A')} on `, (trapped && actLink(trapped, data, words)) ?? 'a post',
          ` laid ${cardName(play?.payload.card)} on `, (post && actLink(post, data, words, post.character ?? undefined)) ?? 'your post', '.'],
        aura: 0, wallet: null, characters: post?.character ? [post.character] : [],
      });
      continue;
    }
    const message = typeof play?.payload.message === 'string' && play.payload.message.trim() !== '' ? play.payload.message.trim() : null;
    /* A play on one of the player's characters or on a thread one of them started: named by the target, and by no caster. */
    if (p.reach !== 'post') {
      const target = p.reach === 'thread' ? (p.targetName ? `'${p.targetName}'` : 'a thread') : p.targetName ?? 'a character';
      rows.push({
        key: `onMine:${p.play}`, kind: 'onMine', at: p.at, what: `A card on your ${p.reach}`,
        details: [`${cardName(play?.payload.card)} was played on ${target}${message ? `, with the message “${message}”` : ''}.`],
        aura: 0, wallet: null, characters: p.targetCharacter ? [p.targetCharacter] : [],
      });
      continue;
    }
    rows.push({
      key: `onMine:${p.play}`, kind: 'onMine', at: p.at, what: 'A card on your post',
      details: [`${nameOf(play?.character, 'Someone')} played ${cardName(play?.payload.card)} on `, (post && actLink(post, data, words, post.character ?? undefined)) ?? 'your post', `${message ? `, with the message “${message}”` : ''}.`, ...said(play?.payload.card, play)],
      aura: 0, wallet: null, characters: post?.character ? [post.character] : [],
    });
  }
  for (const s of data.log.saves) {
    const play = data.acts.get(s.play);
    const post = data.acts.get(s.post);
    const said = ui.cards.find((c) => c.key === play?.payload.card)?.logSave?.(data.states.get(s.play));
    if (!said) continue;
    rows.push({
      key: `saved:${s.play}`, kind: 'saved', at: s.savedAt, what: said.what,
      details: [`${nameOf(play?.character, 'Someone')}'s ${cardName(play?.payload.card)} on `, (post && actLink(post, data, words, post.character ?? undefined)) ?? 'your post', `. ${said.said}`],
      aura: 0, wallet: null, characters: post?.character ? [post.character] : [],
    });
  }
  rows.push(...setEndRows(data, words, take));
  rows.push(...endedRows(data, words));
  return rows;
}

/**
 * The cards an admin ended (`my_cards_ended`): plain and true, never in character. The caster's player is told it was ended and that
 * nothing came back; the one it landed on is told whose card it was. A reversal between two other players is in neither's view, so no
 * line. Each line follows to the play (`actsFollowed` reads the post it landed on), but a post is named by its author from the view, so
 * a post that could not be read is still named.
 */
function endedRows(data: LogData, words: Words): LogRow[] {
  const cardName = (key: unknown) => words.instance.cards.find((c) => c.key === key)?.name ?? 'a card';
  return data.log.ended.map((e): LogRow => {
    const play = data.acts.get(e.play);
    const post = play?.targetActId ? data.acts.get(play.targetActId) : undefined;
    const mine = e.side === 'onMine';
    const named = e.targetName ?? '';
    let place: Segment[];
    switch (e.reach) {
      case 'character': place = [mine ? `your character${named ? ` ${named}` : ''}` : named || 'a character']; break;
      case 'thread': place = [`${mine ? 'your' : 'the'} thread${named ? ` '${named}'` : ''}`]; break;
      case 'board': place = [`the ${named || 'a'} board`]; break;
      default: {
        const own = mine || (post?.character != null && data.mine.some((c) => c.id === post.character));
        const owner = own ? 'your post' : e.postAuthorName ? `${e.postAuthorName}'s post` : 'a post';
        place = post && post.seq !== null
          ? [{ text: `${owner} #${post.seq}`, href: threadHref(post.thread, pageOf(post.seq, words.postsPerPage), post.seq) }]
          : [owner];
      }
    }
    const card = cardName(e.card);
    return {
      key: `ended:${e.cardEnd}`, kind: 'ended', at: e.at,
      what: mine ? `${e.casterName ?? 'Someone'}'s ${card} was ended` : `Your ${card} was ended`,
      details: mine
        ? [`An admin ended ${e.casterName ?? 'someone'}'s ${card} on `, ...place, '.']
        : [`An admin ended your ${card} on `, ...place, '. Its cost and the card are not refunded.'],
      aura: 0, wallet: null,
      characters: [e.character],
    };
  });
}

const TRIGGERED: Readonly<Record<string, string>> = { cast: 'a cast', reaction: 'a reaction', reply: 'a reply', quote: 'a quote', visit: 'a visit' };

/**
 * The end of each card the player set face down: a spring (what it caught, what it laid, what it paid), or its time with nothing
 * springing it. A payout's line says what reached the wallet, from the player's own wallet event for the spring.
 */
function setEndRows(data: LogData, words: Words, take: (match: (w: WalletEvent) => boolean) => WalletEvent | undefined): LogRow[] {
  const cardName = (key: unknown) => words.instance.cards.find((c) => c.key === key)?.name ?? 'a card';
  const nameOf = (id: Id | null | undefined) => (id ? data.mine.find((c) => c.id === id)?.name ?? data.names.get(id) ?? 'someone' : 'someone');
  const rows: LogRow[] = [];
  /* A reply trap a reply passed by without springing it: its moment is spent, and it ends by itself at its time. */
  for (const e of data.log.setPasses) {
    if (words.instance.cards.find((c) => c.key === e.card)?.trap?.trigger.on !== 'reply') continue;
    if (Date.parse(e.passedAt) >= Date.parse(e.endsAt)) continue;
    const post = data.acts.get(e.post);
    const own = post?.character ?? undefined;
    rows.push({
      key: `passed:${e.play}`, kind: 'passed', at: e.passedAt, what: `A reply passed ${cardName(e.card)} by`,
      details: [`A reply passed ${cardName(e.card)} by on `, (post && actLink(post, data, words, own)) ?? 'your post', ` without springing it; it ends by itself ${utcDay(e.endsAt)}.`],
      aura: 0, wallet: null, characters: own ? [own] : [],
    });
  }
  for (const e of data.log.setEnds) {
    const post = data.acts.get(e.post);
    const own = post?.character ?? undefined;
    const on = (post && actLink(post, data, words, own)) ?? 'your post';
    const characters = own ? [own] : [];
    const spring = e.spring ? data.acts.get(e.spring) : undefined;
    if (!e.spring) {
      rows.push({ key: `setEnded:${e.play}`, kind: 'setEnded', at: e.endedAt, what: `${cardName(e.card)} ended`, details: [`${cardName(e.card)} on `, on, ' ended; nothing sprang it.'], aura: 0, wallet: null, characters });
      continue;
    }
    const outcome = (spring?.payload.outcome as { do?: string } | undefined)?.do;
    const caught = typeof spring?.payload.caught === 'string' ? data.acts.get(spring.payload.caught) : undefined;
    const by = typeof spring?.payload.by === 'string' ? data.acts.get(spring.payload.by) : undefined;
    if (caught) {
      const paid = outcome === 'payout' ? take((w) => (w.kind === 'trap' || w.kind === 'trapSystem') && w.ref === e.spring) : undefined;
      /* A staff card nobody paid for: The System pays, and the line states what the wallet event credited (the wallet's cap can cut it below the base price), so {n} is read from that row, never priced here (the staff roster design, section 7). */
      const stop = (name: string) => (/[.!?]$/.test(name) ? name : `${name}.`);
      const bySystem = paid?.kind === 'trapSystem';
      rows.push({
        key: `sprung:${e.play}`, kind: paid ? 'payout' : 'sprung', at: e.endedAt, what: `Your ${cardName(e.card)} sprang`,
        details: bySystem
          ? [`Your ${cardName(e.card)} caught ${nameOf(caught.character)}'s ${stop(cardName(caught.payload.card))} The System paid you ${plain(paid.change)} Aura.`]
          : [`${cardName(e.card)} caught ${nameOf(caught.character)}'s ${cardName(caught.payload.card)} on `, on, paid ? `; ${signed(paid.change)} to your wallet.` : '.'],
        aura: paid?.change ?? 0, wallet: paid?.balanceAfter ?? null, characters,
      });
      continue;
    }
    const struck = outcome === 'strike' ? (spring?.payload.outcome as { card?: string }).card : undefined;
    const trigger = TRIGGERED[String(spring?.payload.trigger)] ?? 'something';
    rows.push({
      key: `sprung:${e.play}`, kind: 'sprung', at: e.endedAt, what: `Your ${cardName(e.card)} sprang`,
      details: struck
        ? [`${cardName(e.card)} on `, on, ` sprang on ${trigger}, and laid ${cardName(struck)} on `, (by && actLink(by, data, words)) ?? 'the post that sprang it', '.']
        : [`${cardName(e.card)} on `, on, ` sprang on ${trigger}.`],
      aura: 0, wallet: null, characters,
    });
  }
  return rows;
}

/** The open window's estimate, a row per line: each reaction's own amount at its own time, before the shared vote and halving. */
function estimateRows(data: LogData, words: Words, tab: Id | null): LogRow[] {
  const lines = (data.estimate?.lines ?? []).filter((l) => tab === null || l.character === tab);
  const asOf = data.estimate?.asOf ?? new Date(0).toISOString();
  return lines
    .map((l, i) => ({ l, i, at: l.at !== undefined ? new Date(l.at).toISOString() : asOf }))
    .sort((a, b) => micros(b.at) - micros(a.at) || a.i - b.i)
    .map(({ l, i, at }) => ({
      key: `estimate:${i}`, kind: 'estimate' as const, at, what: 'Estimate', details: estimateWords(l, data, words, tab),
      aura: l.amount, wallet: null, characters: [l.character],
    }));
}

function estimateWords(l: EstimateLine, data: LogData, words: Words, tab: Id | null): Segment[] {
  const who = tab === null ? `${data.mine.find((c) => c.id === l.character)?.name ?? ''}: ` : '';
  const after = ' It counts at the next settlement, before the shared vote and halving. Who reacted is never shown.';
  const link = l.act ? actLink(data.acts.get(l.act), data, words, l.character) : null;
  if (link && l.quadrant) {
    const label = words.ui.quadrantLabels[l.quadrant];
    return [`${who}${withArticle(label).replace(/^a/u, 'A')} reaction on `, link, `.${after}`];
  }
  // The live estimate has no ledger row: it is said with the numbers in force, which it ran on.
  return [`${who}${words.ui.reasonWords(l.reason, words.economy)}.${after}`];
}

/** The Acts the log's lines name: every share's, every estimate line's, every announcement's and every card line's; then the posts the card plays among them landed on. */
export function actsNamed(log: Log, estimate: Estimate | null, turns: readonly TurnAnnounced[]): Id[] {
  const ids = new Set<Id>();
  for (const s of log.settlements) for (const l of s.lines) for (const sh of l.shares) ids.add(sh.act);
  for (const l of estimate?.lines ?? []) if (l.act) ids.add(l.act);
  for (const t of turns) ids.add(t.act);
  for (const c of log.cards) if (c.act) ids.add(c.act);
  for (const p of log.playsOnMine) { ids.add(p.play); ids.add(p.post); }
  for (const s of log.saves) { ids.add(s.play); ids.add(s.post); }
  for (const e of log.setEnds) { ids.add(e.post); if (e.spring) ids.add(e.spring); }
  for (const e of log.setPasses) ids.add(e.post);
  for (const c of log.caught) { ids.add(c.play); ids.add(c.post); }
  for (const e of log.ended) ids.add(e.play);
  return [...ids];
}

/**
 * The Acts the Acts already read lead to, for their lines: the post a card play or a spring landed on, the spring a strike's card
 * came from, and what a spring caught or was sprung by. Read in rounds until none is new (two at most: a spring, then its catch's post).
 */
export function actsFollowed(acts: ReadonlyMap<Id, Act>): Id[] {
  const ids = new Set<Id>();
  for (const a of acts.values()) {
    if ((a.kind === 'card' || a.kind === 'spring' || a.kind === 'set') && a.targetActId) ids.add(a.targetActId);
    for (const key of ['spring', 'caught', 'by'] as const) {
      const v = a.payload[key];
      if (typeof v === 'string' && (a.kind === 'spring' || (a.kind === 'card' && key === 'spring'))) ids.add(v);
    }
  }
  return [...ids].filter((id) => !acts.has(id));
}
