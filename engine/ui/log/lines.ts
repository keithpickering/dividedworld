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
import { ENGINE_DEFAULT_PRONOUNS, words as pronounWords } from '../../rules/pronouns.ts';
import { playOf as playKindOf, reachesOf } from '../../rules/cards.ts';
import { rankIndex } from '../../rules/ranks.ts';
import type { Instance, Quadrant } from '../../rules/types.ts';
import type { Act, CardEvent, MyBan, Estimate, EstimateLine, Id, Log, LogLine, LogSettlement, MyCharacter, ScoredAs, Season, TurnAnnounced, WalletEvent } from '../data/api.ts';
import { micros } from '../data/log-page.ts';
import { officeRole } from '../board/move-words.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { paramsOf } from '../economy.ts';
import type { InstanceUi } from '../types.ts';
import { shareWords, upperFirst } from '../copy-words.ts';
import { quotedWords, shortQuote, springConditions, whoWords } from '../cards/lens-words.ts';

/** A piece of a line's words: plain text, or a link to an Act or a thread. */
export type Segment = string | { readonly text: string; readonly href: string };

export type LineKind = 'estimate' | 'settlement' | 'turn' | 'rank' | 'bought' | 'pack' | 'played' | 'returned' | 'onMine' | 'saved' | 'written'
  /* The card mechanic's (docs/plans/2026-11-01-card-mechanic-design.md, section 10). */
  | 'set' | 'sprung' | 'payout' | 'setEnded' | 'caught' | 'struck' | 'gimmickEnded'
  /* The bot-card-options design, section 3: an admin ended a card play. */
  | 'ended'
  /* The Mod Bots design, sections 5 to 9: warn points filed, a ban, a report made and an appeal made, each of the player's own characters. */
  | 'infraction' | 'ban' | 'report' | 'appeal' | 'bribe'
  /* Member groups, Task 11: a staff move into a group, how it ended and an appeal's ruling on it. */
  | 'grouped'
  /* The aura-grant design, section 2: an admin gave the player Aura (docs/plans/2026-11-08-aura-grant-design.md). */
  | 'grant'
  /* A drive's gift, the giver's and the post's author's (docs/plans/2026-11-03-jimmy-wails-design.md, section 10). */
  | 'gift';

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
  /** A ban's line while it runs and has not been appealed: the ban, which the line's "Appeal to the Boss" names (Forms.tsx's `BanAppeal`). */
  readonly appealBan?: MyBan;
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
  /** The staff characters among them (a public fact of a character): a staff setter's catching set card takes nothing. Absent, none is known to be staff. */
  readonly staff?: ReadonlySet<Id>;
  /** Titles of the threads the lines name (The System's Turn announcements). */
  readonly titles: ReadonlyMap<Id, string>;
  /** The state each play's effect was last saved with, for the saves the log reads (`effectStates`, public). */
  readonly states: ReadonlyMap<Id, unknown>;
}

export interface Words {
  readonly instance: Instance;
  readonly ui: Pick<InstanceUi, 'reasonWords' | 'quadrantLabels' | 'cards' | 'copy' | 'packs'>;
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

/** The class a settlement scored a character's lines as: their reasons' class, when every one names the same class the instance has (a card's payout names none). */
export function scoredAs(lines: readonly LogLine[], instance: Instance): string | null {
  /* A card's payout (`card.boost`, `card.skim`, `card.ride`) is no class's reason: a boosted or paid character is still scored as the class its other lines name. */
  const keys = new Set(lines.map((l) => l.reason.split('.')[0]!).filter((k) => k !== 'card'));
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

/**
 * What a card set face down waits for, in the words after "It waits": "to spring on a quote", "for a Whoops!", "for a Mod Bot's visit". A Move waits for a
 * quote (and the phrase it needs, where it was set with one); a set card waits for its trigger, and a Card Collector for the card it names. Null for a card with no trap,
 * which waits for nothing, and for a back set under a trigger that is gone (a reply, a reaction), which keeps the words it had.
 */
export function setWaits(e: Pick<CardEvent, 'card' | 'springs' | 'catches' | 'phrase' | 'passage' | 'who' | 'whoExcept'>, words: Pick<Words, 'instance'>, nameOf: (id: Id) => string = () => 'someone'): string | null {
  if (e.springs === false) return null;
  const rules = words.instance.cards.find((c) => c.key === e.card);
  if (!rules) return null;
  if (playKindOf(rules) === 'cast') return castWaits(e, nameOf);
  const on = rules.trap?.trigger.on as string | undefined;
  if (on === 'visit') return 'for a Mod Bot\'s visit';
  if (on === 'cast') {
    const named = e.catches ? words.instance.cards.find((c) => c.key === e.catches)?.name : undefined;
    return named ? `for ${withArticle(named)}` : 'for the card it names';
  }
  return null;
}

/** What a Move waits for, said to its setter alone, every condition in full. The Anyone-but list is named here and nowhere else. */
function castWaits(e: Pick<CardEvent, 'phrase' | 'passage' | 'who' | 'whoExcept'>, nameOf: (id: Id) => string): string {
  const who = whoWords(e.who ?? [], e.whoExcept === true, nameOf);
  if (!e.passage && !who) return e.phrase ? `to spring on a quote that says \u201c${e.phrase}\u201d` : 'to spring on a quote';
  return `to spring when ${who ?? 'someone'} quotes ${e.passage ? shortQuote(e.passage, Infinity) : 'it'}${e.phrase ? ` saying ${shortQuote(e.phrase, Infinity)}` : ''}`;
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
  /* A reason that names a card (a boost's `{ card }`) keeps the card's capital: only a reason's own first word is lowered into the sentence. */
  return inOrder(lines).map((l) => {
    const said = reasonName(words.ui.reasonWords(l.reason, paramsOf(l, words.economy)));
    return `${typeof l.params?.['card'] === 'string' ? said : lowerFirst(said)} ${signed(l.amount)}`;
  }).join(', ');
}

/** A character of the player's own pronouns, as the lines say them: the engine's default where the character has set none. */
const pronounsIn = (data: LogData, id: Id) => pronounWords(data.mine.find((c) => c.id === id)?.pronouns ?? ENGINE_DEFAULT_PRONOUNS);

/**
 * The log's rows, newest first: the open window's estimate on top, then each settlement with its Turns and rank changes beside
 * it. `tab` is a character of the player's, or null for All.
 */
export function logRows(data: LogData, words: Words, cap: number, tab: Id | null): readonly LogRow[] {
  const { instance } = words;
  const nameOf = (id: Id) => data.mine.find((c) => c.id === id)?.name ?? '';
  const pronounsOf = (id: Id) => pronounsIn(data, id);
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
      /* A card that named the class this window was scored as (an Off Day) says so after the character's own sentence: the player's own rows (`my_scored_as`), never a guess. */
      const named = (c: Id) => (data.log.scoredAs ?? []).filter((r) => r.settlement === s.id && r.character === c).map((r) => scoredAsWords(r, nameOf(c), words));
      if (tab !== null) {
        const cls = scoredAs(lines, instance);
        said.push(`${cls ? `Scored as ${withArticle(className(instance, cls))}` : 'Scored'} for ${day}: ${scoredWords(lines, words)}.`, ...named(tab));
      } else {
        said.push(`Scored for ${day}.`);
        for (const c of byCharacter) {
          const own = lines.filter((l) => l.character === c);
          const cls = scoredAs(own, instance);
          said.push(`${nameOf(c)}${cls ? ` as ${withArticle(className(instance, cls))}` : ''}: ${scoredWords(own, words)}.`, ...named(c));
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
        const where: Segment = act && title ? { text: title, href: act.seq !== null ? threadHref(act.thread, pageOf(act.seq, words.postsPerPage), act.seq) : threadHref(act.thread, 1) } : 'the board';
        details.push(` Announced ${t.announced.was ? `with ${pronounsOf(t.character).their} old class ` : ''}in `, where, '.');
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

  rows.push(...scoredAsRows(data, words).filter((r) => inTab(r.characters)));
  rows.push(...cardRows(data, words).filter((r) => inTab(r.characters)));
  rows.push(...modRows(data, words).filter((r) => inTab(r.characters)));
  rows.push(...groupRows(data, words).filter((r) => inTab(r.characters)));
  rows.push(...grantRows(data).filter((r) => inTab(r.characters)));
  rows.push(...giftRows(data, words).filter((r) => inTab(r.characters)));

  const ORDER: Record<LineKind, number> = { estimate: 0, settlement: 1, turn: 2, rank: 3, bought: 4, pack: 4, played: 4, returned: 4, onMine: 4, saved: 4, written: 4, set: 4, sprung: 4, payout: 4, setEnded: 4, caught: 4, struck: 4, gimmickEnded: 4, ended: 4, infraction: 4, ban: 4, report: 4, appeal: 4, bribe: 4, grouped: 4, grant: 4, gift: 4 };
  rows.sort((a, b) => micros(b.at) - micros(a.at) || ORDER[a.kind] - ORDER[b.kind]);
  return [...estimateRows(data, words, tab), ...rows];
}

/** The sentence a settlement's row gains for a character a card scored as a named class (an Off Day): what named it, for whom and that nothing outlasted the window. */
function scoredAsWords(r: ScoredAs, name: string, words: Words): string {
  const card = words.instance.cards.find((c) => c.key === r.card)?.name ?? 'A card';
  return `${card} named ${withArticle(className(words.instance, r.classKey))} for ${name} in this window, so it was scored as one whatever its own class. That ended with this settlement, and its own class never changed.`;
}

/**
 * A window a card named a class for, in which the character had no line at all: a row of its own at the settlement's end, so the Off Day that did nothing is not
 * a play that simply vanishes. (A character that did have lines has the sentence in its settlement's row instead.) The player's own rows, plain and true.
 */
function scoredAsRows(data: LogData, words: Words): LogRow[] {
  const nameOf = (id: Id) => data.mine.find((c) => c.id === id)?.name ?? 'one of your characters';
  const rows: LogRow[] = [];
  for (const r of data.log.scoredAs ?? []) {
    if (data.log.settlements.find((s) => s.id === r.settlement)?.lines.some((l) => l.character === r.character)) continue;
    const card = words.instance.cards.find((c) => c.key === r.card)?.name ?? 'A card';
    rows.push({
      key: `scoredAs:${r.settlement}:${r.character}:${r.play}`, kind: 'gimmickEnded', at: r.endsAt, what: `${card} on ${nameOf(r.character)} ended`,
      details: [`${nameOf(r.character)} was to be scored as ${withArticle(className(words.instance, r.classKey))} for ${utcDay(r.startsAt)}, and nothing was scored for it in that window. Its own class never changed.`],
      aura: 0, wallet: null, characters: [r.character],
    });
  }
  return rows;
}

/**
 * An admin's grant (docs/plans/2026-11-08-aura-grant-design.md, section 2): the wallet's own event of kind `grant`, in plain and true words. It belongs to the account, so it is in every tab,
 * and it says how much of it the wallet's cap held back.
 */
function grantRows(data: LogData): LogRow[] {
  const rows: LogRow[] = [];
  for (const w of data.log.wallet) {
    if (w.kind !== 'grant') continue;
    rows.push({
      key: `grant:${w.at}`, kind: 'grant', at: w.at, what: 'An admin gave you Aura',
      details: [`An admin gave you ${plain(w.change)} Aura.${w.overflow > 0 ? ` ${plain(w.overflow)} more didn't fit under your wallet's cap.` : ''}`],
      aura: w.change, wallet: w.balanceAfter, characters: [],
    });
  }
  return rows;
}

/**
 * A drive's gifts (docs/plans/2026-11-03-jimmy-wails-design.md, section 10): the wallet's own events `gift_out` (the giver's) and `gift_in` (the post's author's), each named by `ref`, the gift's
 * Act, whose payload holds the amount, the overhead The System kept and what arrived, in whole hundredths, public with the Act. The overhead is said as the amount the Act stored, never a
 * percent: a percent is today's setting and rounding makes it never exact, and the Act is what was done. The giver's line is read from the giver's event and the Act alone and says nothing of the
 * author's wallet or whose it is ("A response never proves a private fact"); the author's says what its own event held back. Each links the post the drive is on. The engine names no card:
 * a gift is an Act of kind `donation` on a drive's opening play, whatever card made the drive.
 */
function giftRows(data: LogData, words: Words): LogRow[] {
  const rows: LogRow[] = [];
  const mine = (id: Id | null | undefined) => id !== null && id !== undefined && data.mine.some((c) => c.id === id);
  for (const w of data.log.wallet) {
    if ((w.kind !== 'gift_out' && w.kind !== 'gift_in') || w.ref === null) continue;
    const gift = data.acts.get(w.ref);
    /* The giver's own event holds what they paid when the Act could not be read; the author's holds only what reached them. */
    const amount = typeof gift?.payload.amount === 'number' ? gift.payload.amount : w.kind === 'gift_out' ? -w.change : null;
    const overhead = typeof gift?.payload.overhead === 'number' ? gift.payload.overhead : null;
    const arrives = typeof gift?.payload.arrives === 'number' ? gift.payload.arrives : null;
    const drive = gift?.targetActId ? data.acts.get(gift.targetActId) : undefined;
    const onPost = drive?.targetActId ? data.acts.get(drive.targetActId) : undefined;
    const placed = onPost && onPost.seq !== null ? onPost : undefined;
    const href = placed ? threadHref(placed.thread, pageOf(placed.seq!, words.postsPerPage), placed.seq!) : null;
    const post = (yours: boolean): Segment => {
      const text = yours ? `your post #${placed?.seq}` : `post #${placed?.seq}`;
      return href ? { text, href } : text;
    };
    if (w.kind === 'gift_out') {
      const gave = `You gave ${plain(amount ?? 0)} to`;
      const went = overhead === null || arrives === null ? '' : arrives === 0 ? '; it all went to overhead' : `; ${plain(arrives)} reached its author after an overhead of ${plain(overhead)}`;
      rows.push({
        key: `gift:${w.ref}:gift_out`, kind: 'gift', at: w.at, what: 'You gave to a drive',
        details: placed ? [`${gave} the drive on `, post(false), `${went}.`] : [`${gave} a drive${went}.`],
        aura: w.change, wallet: w.balanceAfter, characters: gift?.character && mine(gift.character) ? [gift.character] : [],
      });
      continue;
    }
    const giver = gift?.character ? data.mine.find((c) => c.id === gift.character)?.name ?? data.names.get(gift.character) : undefined;
    const got = arrives ?? w.change + w.overflow;
    const lost = w.overflow > 0 ? `, and your wallet was full, so ${plain(w.overflow)} of it was lost` : '';
    rows.push({
      key: `gift:${w.ref}:gift_in`, kind: 'gift', at: w.at, what: 'A gift reached you',
      details: [`${giver ?? 'Someone'} gave ${amount === null ? '' : `${plain(amount)} `}to `, ...(placed ? ['the drive on ', post(true)] : ['a drive on one of your posts']), `; you received ${plain(got)}${lost}.`],
      aura: w.change, wallet: w.balanceAfter, characters: onPost?.character && mine(onPost.character) ? [onPost.character] : [],
    });
  }
  return rows;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The group lines (docs/plans/2026-11-06-member-groups-plan.md, Task 11): a staff member put one of the player's characters in a group, how that ended, and an appeal's ruling on it, in
 * plain and true words ("The fiction may lie; the log never does"), the role word from the move's office. Each links to the move's Act. The rows are the player's own
 * (`my_group_moves`), so no line names who else is in a group, and no alert goes with them. A group is named by the instance's own name for it.
 */
function groupRows(data: LogData, words: Words): LogRow[] {
  const nameOf = (id: Id) => data.mine.find((c) => c.id === id)?.name ?? 'one of your characters';
  const pronounsOf = (id: Id) => pronounsIn(data, id);
  const groups = [...words.instance.groups.ladder, ...words.instance.groups.conferred];
  const rows: LogRow[] = [];
  for (const g of data.log.groupMoves) {
    const name = nameOf(g.character);
    const group = groups.find((x) => x.key === g.group)?.name ?? g.group;
    const to = g.seq === null ? undefined : threadHref(g.thread, pageOf(g.seq, words.postsPerPage), g.seq);
    const linked = (text: string): Segment => (to === undefined ? text : { text, href: to });
    const role = officeRole(words.ui.copy, g.office ?? undefined);
    const until = g.landedUntil === null ? '' : ` until ${utcDay(g.landedUntil)}`;
    const check = g.checkAt === null ? '' : ` It stays if ${name} meets the demand by ${utcDay(g.checkAt)}.`;
    rows.push({
      key: `grouped:${g.move}`, kind: 'grouped', at: g.at, what: `${name} was put in ${group}`,
      details: [`${role} `, linked(`put ${name} in ${group}`), g.boardName === null ? `${until}.${check}` : ` and barred ${pronounsOf(g.character).them} from posting on ${g.boardName}${until}.${check}`],
      aura: 0, wallet: null, characters: [g.character],
    });
    if (g.endedWhy !== null && g.endedAt !== null) {
      const why = g.endedWhy === 'met' ? (g.demand === 'apologyAccepted' ? 'an apology was accepted' : 'its demand was met')
        : g.endedWhy === 'expired' ? 'it expired'
        : g.endedWhy === 'reversed' ? (g.endedBy === 'admin' ? 'an admin reversed it' : 'it was reversed')
        : g.endedWhy === 'unmet' ? 'the demand wasn\'t met by its check'
        : g.endedWhy === 'overturned' ? 'overturned on appeal'
        : g.endedWhy === 'superseded' ? 'it ended at the handover' : 'it was used up at the handover';
      rows.push({
        key: `grouped:${g.move}:left`, kind: 'grouped', at: g.endedAt, what: `${name} left ${group}`,
        details: [linked(`${name} left ${group}`), `: ${why}.`], aura: 0, wallet: null, characters: [g.character],
      });
    }
    if (g.ruling !== null && g.ruledAt !== null) {
      /* The hearer is the office stamped on the ruling (0157); a ruling written before the stamp names none, and no default stands in for it. */
      const hearer = g.ruledOffice === null ? null : officeRole(words.ui.copy, g.ruledOffice);
      const ruled = g.ruledUntil === null ? Number.NaN : Date.parse(g.ruledUntil);
      const result = g.ruling === 'upheld' ? 'nothing changed'
        : g.ruling === 'overturned' ? 'it ended'
        : Number.isNaN(ruled) ? null
        : ruled <= Date.parse(g.ruledAt) ? 'it ended at once' : `it now ends ${utcDay(g.ruledUntil!)}`;
      rows.push({
        key: `grouped:${g.move}:ruling`, kind: 'grouped', at: g.ruledAt, what: `Appeal ${g.ruling}`,
        details: hearer === null
          ? [linked(`${name}'s ${group}`), ` was ${g.ruling} on appeal${result === null ? '' : `: ${result}`}.`]
          : [`${hearer} ${g.ruling} `, linked(`${name}'s ${group}`), ` on appeal${result === null ? '' : `: ${result}`}.`],
        aura: 0, wallet: null, characters: [g.character],
      });
    }
  }
  return rows;
}

/**
 * The Mod Bots' lines (the design, section 9): the warn points filed against the player's characters, the bans laid on them, and the reports and appeals they made, each in
 * plain and true words, never in character ("The fiction may lie; the log never does"): which Act did what, the points and when they drop off. The rows are the player's
 * own (`my_infractions`, `my_bans`, `my_reports`, `my_appeals`); no line says who reacted or what anyone's class is, and no line is computed from a character that is not theirs.
 * A post is named by its number in its thread, linked, and "your" where the row is the player's own.
 */
function modRows(data: LogData, words: Words): LogRow[] {
  const now = Date.now();
  const nameOf = (id: Id) => data.mine.find((c) => c.id === id)?.name ?? 'one of your characters';
  const pronounsOf = (id: Id) => pronounsIn(data, id);
  const post = (thread: Id, seq: number | null, own: boolean): Segment => (seq === null ? (own ? 'your post' : 'a post') : { text: `${own ? 'your ' : ''}post #${seq}`, href: threadHref(thread, pageOf(seq, words.postsPerPage), seq) });
  const rows: LogRow[] = [];

  for (const i of data.log.infractions) {
    const drops = Date.parse(i.expiresAt);
    const left = i.points - i.relief;
    const tail: string[] = [];
    if (i.relief > 0) tail.push(` An appeal took ${plural(i.relief, 'point', 'points')} off.`);
    if (i.emptiedAt !== null) tail.push(` A ban emptied the bar on ${utcDay(i.emptiedAt)}, so ${left === 1 ? 'this point' : 'these points'} stopped counting then.`);
    rows.push({
      key: `infraction:${i.infraction}`, kind: 'infraction', at: i.at, what: `Warn points: ${plural(i.points, 'point', 'points')}`,
      details: [`${i.mod ?? 'A Mod'}'s visit to `, post(i.thread, i.postSeq, true), ` filed ${i.rule ?? 'a breach of the rules'}: ${plural(i.points, 'warn point', 'warn points')} for ${nameOf(i.character)}, ${drops > now ? 'dropping off' : 'dropped off'} ${utcDay(i.expiresAt)}.`, ...tail],
      aura: 0, wallet: null, characters: [i.character],
    });
  }

  for (const b of data.log.bans) {
    const over = Date.parse(b.until) <= now;
    /* How the ban ends, by what an appeal's ruling did to it (`ruling`, 0157); a ban with no ruling, or an upheld one, ends as it was laid. */
    const ends = b.ruling === 'overturned' ? `An appeal overturned the ban on ${utcWhen(b.until)} UTC.`
      : b.ruling === 'reduced' ? `An appeal shortened the ban: it ${over ? 'ended' : 'ends'} ${utcWhen(b.until)} UTC.`
      : b.ruling === 'increased' ? `An appeal lengthened the ban: it ${over ? 'ended' : 'ends by itself'} ${utcWhen(b.until)} UTC.`
      : `The ban ${over ? 'ended by itself' : 'ends by itself'} ${utcWhen(b.until)} UTC.`;
    rows.push({
      key: `ban:${b.ban}`, kind: 'ban', at: b.at, what: `${nameOf(b.character)} was banned`,
      details: [`${nameOf(b.character)}'s warn bar filled${b.rule ? ` with ${b.rule}` : ''}, so ${pronounsOf(b.character).they} ${pronounsOf(b.character).was} banned for ${plural(b.days, 'day', 'days')} and the bar was emptied. ${pronounsOf(b.character).They} can read but not post, react or play cards. ${ends} The ban is on ${nameOf(b.character)} only; each character has its own warn bar.`],
      aura: 0, wallet: null, characters: [b.character],
      ...(!over && !data.log.appeals.some((a) => a.punishment === b.ban && a.refund === null) ? { appealBan: { ban: b.ban, character: b.character, until: b.until, days: b.days, rule: b.rule } } : {}),
    });
  }

  /* What a report or an appeal cost, and what came back, are the wallet's own events (`my_wallet_events`, kinds report, appeal and refund, `ref` the Act): the amounts paid then, never today's prices. */
  const paid = (kind: 'report' | 'appeal', act: Id): number | null => { const e = data.log.wallet.find((w) => w.kind === kind && w.ref === act); return e ? -e.change : null; };
  const back = (act: Id): number => data.log.wallet.filter((w) => w.kind === 'refund' && w.ref === act).reduce((n, w) => n + w.change, 0);
  const forPrice = (n: number | null) => (n === null ? '' : `, for ${plain(n)} Aura`);

  for (const r of data.log.reports) {
    const price = paid('report', r.report);
    const gone = back(r.report);
    const spent = price === null ? '' : ` The ${plain(price)} Aura was spent.`;
    const verdict = r.verdict === null
      ? (r.refund !== null ? ` ${r.mod ?? 'The Mod'} could not hear it, so your Aura came back${gone > 0 ? ` (${plain(gone)})` : ''}, and you can make it again.` : ' It has not been answered yet. If it cannot be, your Aura comes back by itself.')
      : r.verdict === 'visit' ? ` ${r.mod ?? 'The Mod'} judged it and sent a visit.`
      : r.verdict === 'dismissed' ? ` ${r.mod ?? 'The Mod'} dismissed it.${spent}`
      : ` ${r.mod ?? 'The Mod'} judged it a backfire: a visit went to ${nameOf(r.character)}'s latest post.${spent}`;
    rows.push({
      key: `report:${r.report}`, kind: 'report', at: r.at, what: 'You reported a post',
      details: [`${nameOf(r.character)} reported `, post(r.thread, r.postSeq, false), `${forPrice(price)}. The report is public.${verdict}`],
      aura: -(price ?? 0) + gone, wallet: null, characters: [r.character],
    });
  }

  for (const a of data.log.appeals) {
    const price = paid('appeal', a.appeal);
    const gone = back(a.appeal);
    /* A group move is named by its group, and linked to the move's own line in the announcements, where the log holds that move; else it is "a group move". */
    const moved = a.punishmentKind === 'move' ? data.log.groupMoves.find((g) => g.move === a.punishment) : undefined;
    const movedGroup = moved ? ([...words.instance.groups.ladder, ...words.instance.groups.conferred].find((x) => x.key === moved.group)?.name ?? moved.group) : null;
    const what = a.punishmentKind === 'ban' ? 'the ban' : a.punishmentKind === 'move' ? (movedGroup === null ? 'a group move' : `the move into ${movedGroup}`) : 'the warn points';
    const came = price === null ? '' : `, and the ${plain(price)} Aura came back`;
    const ruling = a.verdict === null
      ? (a.refund !== null ? ' No one could hear it, so your Aura came back and you can appeal again.' : ' It has not been ruled on yet. If it cannot be, your Aura comes back by itself.')
      : a.verdict === 'overturned' ? ` ${a.hearer ?? 'The hearer'} overturned it${a.pointsDelta ? `: ${plural(-a.pointsDelta, 'point', 'points')} came off` : ''}${came}.`
      : a.verdict === 'upheld' ? ` ${a.hearer ?? 'The hearer'} upheld it. Nothing changed.`
      : a.verdict === 'reduced' ? ` ${a.hearer ?? 'The hearer'} reduced it${a.pointsDelta ? `: ${plural(-a.pointsDelta, 'point', 'points')} came off` : ''}.`
      : ` ${a.hearer ?? 'The hearer'} increased it${a.pointsDelta ? `: ${plural(a.pointsDelta, 'more point', 'more points')} landed` : ''}.`;
    rows.push({
      key: `appeal:${a.appeal}`, kind: 'appeal', at: a.at, what: 'You made an appeal',
      details: a.punishmentKind === 'move'
        ? [`${nameOf(a.character)} appealed `, moved?.seq == null ? what : { text: what, href: threadHref(moved.thread, pageOf(moved.seq, words.postsPerPage), moved.seq) }, `${forPrice(price)}. The plea is public.${ruling}`]
        : [`${nameOf(a.character)} appealed ${what} from `, post(a.thread, a.postSeq, true), `${forPrice(price)}. The plea is public.${ruling}`],
      aura: -(price ?? 0) + gone, wallet: null, characters: [a.character],
    });
  }

  /* A bribe that talked a visit down: the wallet's own event, named by the interception it paid for and the visit's Mod, read as public Acts. */
  for (const w of data.log.wallet) {
    if (w.kind !== 'bribe') continue;
    const attempt = w.ref ? data.acts.get(w.ref) : undefined;
    const visit = typeof attempt?.payload.visit_act === 'string' ? data.acts.get(attempt.payload.visit_act) : undefined;
    const mod = visit?.character ? data.names.get(visit.character) : undefined;
    rows.push({
      key: `bribe:${w.ref ?? w.at}`, kind: 'bribe', at: w.at, what: 'You paid a bribe',
      details: [`You paid ${plain(-w.change)} Aura to talk down ${mod ? `${mod}'s` : 'a'} visit.`],
      aura: w.change, wallet: w.balanceAfter, characters: attempt?.character && data.mine.some((c) => c.id === attempt.character) ? [attempt.character] : [],
    });
  }
  return rows;
}

/**
 * The card lines (the cards plan's Task 6): a card bought, a card played and on whose post (one of the player's own characters' posts
 * said so), a play another player landed on the player's post, and a save of its effect the card says is worth a line (a layer washed
 * clean). A card is paid for once, at the machine (#78), so a play's price is what its post added. A Stick Around certified is
 * reading, which the log does not track.
 */
function cardRows(data: LogData, words: Words): LogRow[] {
  const { instance, ui } = words;
  /* What the card says a play of it did (`CardUi.logPlay`), as one more sentence of the line; nothing where it says nothing. It is given what the
     play recorded with itself (the tokens a card that writes bought, in the play's own Act), never a number worked out from today's economy. */
  const said = (key: unknown, play: Act | undefined): string[] => {
    const config = play?.payload.config;
    const tokens = play?.payload.tokens;
    /* A drive card's play opened its drive where the drive is its own id (a later play's names the play that opened it); a play with no drive says neither. */
    const drive = play?.payload.drive;
    const starts = play?.payload.starts;
    const ends = play?.payload.ends;
    const recorded = {
      ...(typeof tokens === 'number' && Number.isSafeInteger(tokens) ? { tokens } : {}), ...(typeof drive === 'string' ? { opened: drive === play?.id } : {}),
      ...(typeof starts === 'string' ? { starts } : {}), ...(typeof ends === 'string' ? { ends } : {}),
    };
    const sentence = ui.cards.find((c) => c.key === key)?.logPlay?.(typeof config === 'object' && config !== null ? config as Readonly<Record<string, unknown>> : {}, recorded);
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
  /* What a purchase at the machine says after its price: the Boss's markup or markdown, when the slot was moved when it was bought (recorded with the purchase). */
  const bossSaid = (repriced: boolean | undefined) => (repriced ? ' The Boss had repriced it.' : '');
  /* A pack is one line: its pulled rows (one per card) with the pack row that holds its kind, its price and the cards in pull order. */
  const packsDone = new Set<Id>();
  data.log.cards.forEach((e, i) => {
    if (e.kind === 'bought') {
      const spent = take((w) => w.kind === 'purchase' && at(w.at) === at(e.at) && w.change === -e.price);
      rows.push({
        key: `bought:${i}`, kind: 'bought', at: e.at, what: `You bought ${cardName(e.card)}`, details: [`From the ${ui.copy.shopName}, for ${plain(e.price)}.${bossSaid(e.repriced)}`],
        aura: -e.price, wallet: spent?.balanceAfter ?? null, characters: [],
      });
      return;
    }
    /* A card a catching set card of the player's took: the card went to the player's hand, and cost nothing (the spring's line says what sprang). */
    if (e.kind === 'caught') {
      const spring = e.act ? data.acts.get(e.act) : undefined;
      const took = typeof spring?.payload.caught === 'string' ? data.acts.get(spring.payload.caught) : undefined;
      const trapped = spring?.targetActId ? data.acts.get(spring.targetActId) : undefined;
      const setter = nameOf(spring?.character, 'your character');
      rows.push({
        key: `caught:${e.act}`, kind: 'caught', at: e.at, what: `You caught ${cardName(e.card)}`,
        details: spring
          ? [`${setter}'s ${cardName(spring.payload.card)} caught ${nameOf(took?.character, 'someone')}'s ${cardName(e.card)} on `, (trapped && actLink(trapped, data, words, spring.character ?? undefined)) ?? 'a post', `; the ${cardName(e.card)} went to ${setter}'s hand.`]
          : [`A card set face down caught a ${cardName(e.card)}; it went to your hand.`],
        aura: 0, wallet: null, characters: spring?.character ? [spring.character] : [],
      });
      return;
    }
    if (e.kind === 'pulled') {
      if (!e.pack || packsDone.has(e.pack)) return;
      packsDone.add(e.pack);
      const bought = data.log.packs.find((p) => p.pack === e.pack);
      /* Pull order is the pack row's; the pulled rows only say which pack, since they are read at one instant in no order of their own. */
      const names = (bought?.contents ?? data.log.cards.filter((c) => c.kind === 'pulled' && c.pack === e.pack).map((c) => c.card)).map(cardName);
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
      const spent = bought ? take((w) => w.kind === 'purchase' && at(w.at) === at(bought.at) && w.change === -bought.price) : undefined;
      rows.push({
        key: `pack:${e.pack}`, kind: 'pack', at: e.at, what: `You bought ${withArticle(ui.packs[bought?.kind ?? '']?.name ?? 'pack')}`,
        details: [`${list}. From the ${ui.copy.shopName}${bought ? `, for ${plain(bought.price)}` : ''}.${bossSaid(bought?.repriced)}`],
        aura: bought ? -bought.price : 0, wallet: spent?.balanceAfter ?? null, characters: [],
      });
      return;
    }
    /* A card back in the hand. From a face-down card (a take-back, its Act the take-back; or a back whose time passed, with no Act) it is the setter's
       end row's line (setEndRows), whose words say it. From a play the old voice did not answer (its Act the play), its price went back to the
       caster's wallet (the refund's own event, `ref` the play) and its card to the hand: its own line, after the play's; the card is the
       instance's, and the engine names none. */
    if (e.kind === 'returned') {
      const acted = e.act ? data.acts.get(e.act) : undefined;
      const refund = data.log.wallet.find((w) => w.kind === 'refund' && w.ref === e.act);
      if (e.act === null || (acted ? acted.kind !== 'card' : refund === undefined)) return;
      const actedPost = acted?.targetActId ? data.acts.get(acted.targetActId) : undefined;
      const where = (acted ? placeOf(acted, data) : null) ?? (actedPost ? actLink(actedPost, data, words, acted?.character ?? undefined) : null);
      const back = refund && refund.change > 0 ? `so your ${plain(refund.change)} came back, and the card is back in your hand.` : 'so the card is back in your hand.';
      rows.push({
        key: `returned:${e.act}`, kind: 'returned', at: e.at, what: `Your ${cardName(e.card)} came back`,
        details: [`The old voice didn't answer for your ${cardName(e.card)} on `, where ?? 'a post', `, ${back}`],
        aura: refund?.change ?? 0, wallet: refund?.balanceAfter ?? null, characters: acted?.character ? [acted.character] : [],
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
      const waits = setWaits(e, words, (id) => data.mine.find((c) => c.id === id)?.name ?? data.names.get(id) ?? 'someone');
      rows.push({
        key: `set:${e.act}`, kind: 'set', at: e.at, what: `You set ${cardName(e.card)} face down`,
        /* A card with no trap says so (my_card_ledger's `springs`); a row with no `springs` keeps the trap's words. */
        details: [`${cardName(e.card)} set face down on `, link ?? 'your post',
          e.springs === false ? '. It never springs, and ends by itself.' : waits ? `. It waits ${waits}, and ends by itself if none comes.` : '. It springs once, or ends by itself.'],
        aura: -e.price, wallet: paid?.balanceAfter ?? null, characters: caster ? [caster] : [],
      });
      return;
    }
    /* A play a trap caught: what the cast cost, and that nothing came back. The price the card was bought at is not quoted: it is the machine's own, one of possibly several the player paid (the design, section 5). */
    const catchOf = data.log.caught.find((c) => c.play === e.act);
    if (catchOf) {
      const cost = plain(e.price);
      /* Where the card went, only for a spring that says it caught (`did`, from the face-down Moves on): a play caught before had its card spent, and keeps its old words.
         The setter is the spring's character, public with it, never an account; a staff setter takes nothing. */
      const spring = data.acts.get(catchOf.spring);
      const setter = spring?.payload.did === 'caught' ? spring.character : null;
      const fate = setter ? (data.staff?.has(setter) ? ', and the card is spent' : `, and went to ${nameOf(setter, 'the setter')}`) : '';
      rows.push({
        key: `caught:${e.act}`, kind: 'caught', at: e.at, what: `Your ${cardName(e.card)} was caught`,
        details: [`Your ${cardName(e.card)} on `, link ?? 'a post', ` was caught by ${withArticle(cardName(catchOf.trap))}${fate}; the cast cost ${cost}, and nothing came back${setter ? ' to you' : ''}.`],
        aura: -e.price, wallet: paid?.balanceAfter ?? null, characters: caster ? [caster] : [],
      });
      return;
    }
    /* A Use with a time up says when it ended, once that time has passed, whichever use card it was (the design's section 10: "a timed end"). */
    const ends = typeof play?.payload.ends === 'string' ? play.payload.ends : null;
    /* A scored-as card's end is its window's: the settlement's row (or the row of its own, `scoredAsRows`) says it, so no second row says it ended. */
    if (ends && Date.parse(ends) <= Date.now() && !instance.cards.find((c) => c.key === e.card)?.scoresAs) {
      rows.push({
        key: `gimmickEnded:${e.act}`, kind: 'gimmickEnded', at: ends, what: `${cardName(e.card)}${place ? ` on ${place}` : ''} ended`,
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
      const landedOn = (play ? placeOf(play, data) : null) ?? (post && actLink(post, data, words, post.character ?? undefined)) ?? 'your post';
      /* A face-down card sprang on a quote: the setter's character is the spring's, public with it; the line names no account. */
      if (spring.payload.did === 'landed') {
        const by = typeof spring.payload.by === 'string' ? data.acts.get(spring.payload.by) : undefined;
        rows.push({
          key: `struck:${p.play}`, kind: 'struck', at: p.at, what: 'A face-down card struck your post',
          details: [`${nameOf(spring.character, 'Someone')}'s face-down ${cardName(spring.payload.card)} on `, (trapped && actLink(trapped, data, words)) ?? 'a post', ' sprang when ',
            (by && actLink(by, data, words, post?.character ?? undefined)) ?? 'a post', ` quoted ${quotedWords(springConditions(spring.payload))}, and landed on `, landedOn, '.'],
          aura: 0, wallet: null, characters: post?.character ? [post.character] : [],
        });
        continue;
      }
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
        details: [`${cardName(play?.payload.card)} was played on ${target}${message ? `, with the message “${message}”` : ''}.`, ...said(play?.payload.card, play)],
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
  /* A post the author wrote, named by its number and linked: the words of a line about a card's text on it ("your post #3" where it says whose). */
  const postRef = (post: Act | undefined, whose: string): Segment =>
    post && post.seq !== null ? { text: `${whose}post #${post.seq}`, href: threadHref(post.thread, pageOf(post.seq, words.postsPerPage), post.seq) } : whose === '' ? 'a post' : 'your post';
  for (const s of data.log.saves) {
    const play = data.acts.get(s.play);
    const post = data.acts.get(s.post);
    const said = ui.cards.find((c) => c.key === play?.payload.card)?.logSave?.(data.states.get(s.play));
    if (!said) continue;
    if ('verb' in said) {
      /* The author's own act, said as theirs: "You erased <card> on post #3." */
      rows.push({
        key: `saved:${s.play}`, kind: 'saved', at: s.savedAt, what: said.what,
        details: [`You ${said.verb} ${cardName(play?.payload.card)} on `, postRef(post, ''), '.'],
        aura: 0, wallet: null, characters: post?.character ? [post.character] : [],
      });
      continue;
    }
    rows.push({
      key: `saved:${s.play}`, kind: 'saved', at: s.savedAt, what: said.what,
      details: [`${nameOf(play?.character, 'Someone')}'s ${cardName(play?.payload.card)} on `, (post && actLink(post, data, words, post.character ?? undefined)) ?? 'your post', `. ${said.said}`],
      aura: 0, wallet: null, characters: post?.character ? [post.character] : [],
    });
  }
  /* What a card that writes did to the author's post (`my_posts_written_on`): the play's first text continued the post (whatever version it came
     on), a text after an earlier text is the card again, and the failure that ended the play did not take. A failure the play survived, and a
     failed regeneration after a text, kept things as they were and are no line. The words are the card's own. */
  for (const x of data.log.writes) {
    const play = data.acts.get(x.play);
    const post = data.acts.get(x.post);
    const hooks = ui.cards.find((c) => c.key === play?.payload.card)?.logWritten;
    if (!hooks || (x.failed && !x.over)) continue;
    const card = cardName(play?.payload.card);
    const key = `written:${x.play}:${x.version}`;
    const characters = post?.character && mine(post.character) ? [post.character] : [];
    if (x.failed) rows.push({ key, kind: 'written', at: x.at, what: `${card} did not take`, details: [`${card} on `, postRef(post, ''), ` ${hooks.failed}.`], aura: 0, wallet: null, characters });
    else if (x.opening) rows.push({ key, kind: 'written', at: x.at, what: `${card} continued your post`, details: [`${card} on `, postRef(post, 'your '), ` ${hooks.continued}.`], aura: 0, wallet: null, characters });
    else rows.push({ key, kind: 'written', at: x.at, what: `Your edit got a new ${card}`, details: ['Your edit of ', postRef(post, ''), ` ${hooks.again(card)}.`], aura: 0, wallet: null, characters });
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
 * The end of each card the player set face down: a spring (what it landed on, what it caught, or the visit it ended), or its time with nothing
 * springing it. A spring written before the face-down Moves has an `outcome` and no `did`, and keeps its old words: a payout's line says what
 * reached the wallet, from the player's own wallet event for the spring; a strike says what it laid.
 */
function setEndRows(data: LogData, words: Words, take: (match: (w: WalletEvent) => boolean) => WalletEvent | undefined): LogRow[] {
  const rules = (key: unknown) => words.instance.cards.find((c) => c.key === key);
  const cardName = (key: unknown) => rules(key)?.name ?? 'a card';
  const nameOf = (id: Id | null | undefined) => (id ? data.mine.find((c) => c.id === id)?.name ?? data.names.get(id) ?? 'someone' : 'someone');
  const rows: LogRow[] = [];
  for (const e of data.log.setEnds) {
    const post = data.acts.get(e.post);
    const own = post?.character ?? undefined;
    const on = (post && actLink(post, data, words, own)) ?? 'your post';
    const characters = own ? [own] : [];
    const spring = e.spring ? data.acts.get(e.spring) : undefined;
    if (e.endedBy === 'taken back') {
      rows.push({ key: `setEnded:${e.play}`, kind: 'setEnded', at: e.endedAt, what: `You took back ${cardName(e.card)}`, details: [`You took back ${cardName(e.card)} from `, on, '.'], aura: 0, wallet: null, characters });
      continue;
    }
    if (!e.spring) {
      rows.push({ key: `setEnded:${e.play}`, kind: 'setEnded', at: e.endedAt, what: `${cardName(e.card)} ended`, details: [`${cardName(e.card)} on `, on, ' ended; nothing sprang it, and it came back to your hand.'], aura: 0, wallet: null, characters });
      continue;
    }
    const did = spring?.payload.did;
    if (did === 'landed' || did === 'caught' || did === 'ended' || did === 'rode') {
      const by = typeof spring?.payload.by === 'string' ? data.acts.get(spring.payload.by) : undefined;
      if (did === 'ended') {
        rows.push({ key: `sprung:${e.play}`, kind: 'sprung', at: e.endedAt, what: `Your ${cardName(e.card)} sprang`, details: [`${cardName(e.card)} on `, on, ' sprang when a Mod Bot\'s visit began, and ended the visit.'], aura: 0, wallet: null, characters });
        continue;
      }
      if (did === 'rode') {
        const rode = typeof spring?.payload.by === 'string' ? data.acts.get(spring.payload.by) : undefined;
        const move = cardName(rode?.payload.card);
        const share = rules(e.card)?.trap?.outcome?.share;
        const kind = typeof spring?.payload.quadrant === 'string' ? words.ui.quadrantLabels[spring.payload.quadrant as Quadrant] : undefined;
        rows.push({
          key: `sprung:${e.play}`, kind: 'sprung', at: e.endedAt, what: `Your ${cardName(e.card)} sprang`,
          details: [`${cardName(e.card)} on `, on, ` sprang when ${nameOf(rode?.character)} cast ${move} on it. ${move} landed as usual, and its caster keeps what it earns. Each vote of ${kind ?? 'the kind it named'} it draws pays you ${share === undefined ? 'a share of a vote' : shareWords(share)}, in each settlement's lines.`],
          aura: 0, wallet: null, characters,
        });
        continue;
      }
      if (did === 'caught') {
        const took = typeof spring?.payload.caught === 'string' ? data.acts.get(spring.payload.caught) : undefined;
        const card = cardName(took?.payload.card);
        rows.push({
          key: `sprung:${e.play}`, kind: 'sprung', at: e.endedAt, what: `Your ${cardName(e.card)} sprang`,
          details: [`${cardName(e.card)} on `, on, ` sprang when ${nameOf(took?.character)} cast ${card} on it. It caught the ${card}, which is in your hand now.`],
          aura: 0, wallet: null, characters,
        });
        continue;
      }
      /* A Move lands at its card's first reach: on the quoting post, its character, its thread or its board. */
      const reach = reachesOf(words.instance.cards.find((c) => c.key === e.card) ?? {})[0] ?? 'post';
      const quoter = by?.character ? nameOf(by.character) : null;
      const landed: Segment[] = reach === 'post' ? [(by && actLink(by, data, words)) ?? 'the post that quoted it']
        : reach === 'character' ? [quoter ?? 'the quoting post\'s character'] : [reach === 'thread' ? 'the thread it quoted in' : 'the board it quoted on'];
      rows.push({
        key: `sprung:${e.play}`, kind: 'sprung', at: e.endedAt, what: `Your ${cardName(e.card)} sprang`,
        details: [`${cardName(e.card)} on `, on, ` sprang when ${quoter ?? 'a post'} quoted ${quotedWords(springConditions(spring?.payload ?? {}))}, and landed on `, ...landed, '.'],
        aura: 0, wallet: null, characters,
      });
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
          ? [`Your ${cardName(e.card)} caught ${nameOf(caught.character)}'s ${stop(cardName(caught.payload.card))} ${upperFirst(words.ui.copy.gameWord)} paid you ${plain(paid.change)} Aura.`]
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

/**
 * What the open window's estimate says of a character a card scores as a named class now (an Off Day whose window has opened and not closed, and that no admin ended),
 * read from the plays the log holds (the player's own characters', named by `my_*` rows): " Scored as a Heel this window by Off Day.", or nothing.
 */
function scoredNow(character: Id, data: LogData, words: Words): string {
  const now = Date.now();
  const ended = new Set(data.log.ended.map((e) => e.play));
  for (const a of data.acts.values()) {
    if (a.kind !== 'card' || a.payload.reach !== 'character' || a.payload.character !== character || ended.has(a.id)) continue;
    const rules = words.instance.cards.find((c) => c.key === a.payload.card);
    const { starts, ends } = a.payload;
    const named = typeof a.payload.config === 'object' && a.payload.config !== null ? (a.payload.config as { class?: unknown }).class : undefined;
    if (!rules?.scoresAs || typeof starts !== 'string' || typeof ends !== 'string' || typeof named !== 'string') continue;
    if (Date.parse(starts) <= now && now < Date.parse(ends)) return ` Scored as ${withArticle(className(words.instance, named))} this window by ${rules.name}.`;
  }
  return '';
}

function estimateWords(l: EstimateLine, data: LogData, words: Words, tab: Id | null): Segment[] {
  const who = tab === null ? `${data.mine.find((c) => c.id === l.character)?.name ?? ''}: ` : '';
  const after = ' It counts at the next settlement, before the shared vote and halving. Who reacted is never shown.';
  const link = l.act ? actLink(data.acts.get(l.act), data, words, l.character) : null;
  if (link && l.quadrant) {
    const label = words.ui.quadrantLabels[l.quadrant];
    return [`${who}${withArticle(label).replace(/^a/u, 'A')} reaction on `, link, `.${after}${scoredNow(l.character, data, words)}`];
  }
  // The live estimate has no ledger row: it is said with the numbers in force, which it ran on.
  return [`${who}${words.ui.reasonWords(l.reason, words.economy)}.${after}${scoredNow(l.character, data, words)}`];
}

/** The Acts the log's lines name: every share's, every estimate line's, every announcement's and every card line's; then the posts the card plays among them landed on. */
export function actsNamed(log: Log, estimate: Estimate | null, turns: readonly TurnAnnounced[]): Id[] {
  const ids = new Set<Id>();
  for (const s of log.settlements) for (const l of s.lines) for (const sh of l.shares) ids.add(sh.act);
  for (const l of estimate?.lines ?? []) if (l.act) ids.add(l.act);
  for (const t of turns) ids.add(t.act);
  for (const c of log.cards) if (c.act) ids.add(c.act);
  for (const p of log.playsOnMine) { ids.add(p.play); ids.add(p.post); }
  for (const w of log.writes) { ids.add(w.play); ids.add(w.post); }
  for (const s of log.saves) { ids.add(s.play); ids.add(s.post); }
  for (const e of log.setEnds) { ids.add(e.post); if (e.spring) ids.add(e.spring); }
  for (const c of log.caught) { ids.add(c.play); ids.add(c.post); ids.add(c.spring); }
  for (const e of log.ended) ids.add(e.play);
  for (const w of log.wallet) if ((w.kind === 'bribe' || w.kind === 'gift_out' || w.kind === 'gift_in') && w.ref) ids.add(w.ref);
  return [...ids];
}

/**
 * The Acts the Acts already read lead to, for their lines: the post a card play or a spring landed on, the spring a strike's card
 * came from, and what a spring caught or was sprung by. Read in rounds until none is new (two at most: a spring, then its catch's post; a gift, then its drive's opening play, then the post).
 */
export function actsFollowed(acts: ReadonlyMap<Id, Act>): Id[] {
  const ids = new Set<Id>();
  for (const a of acts.values()) {
    if ((a.kind === 'card' || a.kind === 'spring' || a.kind === 'set' || a.kind === 'donation') && a.targetActId) ids.add(a.targetActId);
    if (a.kind === 'intercept' && typeof a.payload.visit_act === 'string') ids.add(a.payload.visit_act);
    for (const key of ['spring', 'caught', 'by'] as const) {
      const v = a.payload[key];
      if (typeof v === 'string' && (a.kind === 'spring' || (a.kind === 'card' && key === 'spring'))) ids.add(v);
    }
  }
  return [...ids].filter((id) => !acts.has(id));
}
