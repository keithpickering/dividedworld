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
 */
import { rankIndex } from '../../rules/ranks.ts';
import type { Instance } from '../../rules/types.ts';
import type { Act, Estimate, EstimateLine, Id, Log, LogLine, LogSettlement, MyCharacter, Season, TurnAnnounced, WalletEvent } from '../data/api.ts';
import { micros } from '../data/log-page.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import type { InstanceUi } from '../types.ts';

/** A piece of a line's words: plain text, or a link to an Act or a thread. */
export type Segment = string | { readonly text: string; readonly href: string };

export type LineKind = 'estimate' | 'settlement' | 'turn' | 'rank';

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
  /** Whose lines these are: a row is in each of these characters' tabs, and in All. */
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
  /** The Acts the lines name, and the posts the card plays among them landed on. */
  readonly acts: ReadonlyMap<Id, Act>;
  /** Names of the characters whose posts the lines name. */
  readonly names: ReadonlyMap<Id, string>;
  /** Titles of the threads the lines name (The System's Turn announcements). */
  readonly titles: ReadonlyMap<Id, string>;
}

export interface Words {
  readonly instance: Instance;
  readonly ui: Pick<InstanceUi, 'reasonWords' | 'quadrantLabels'>;
  readonly postsPerPage: number;
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
export function actLink(act: Act | undefined, data: Pick<LogData, 'acts' | 'names' | 'mine'>, words: Words, own?: string): Segment | null {
  if (!act) return null;
  if (act.kind === 'card') {
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

/** "post #43", or "Gloomba's post #46" where the post is not the character's own whose line it is. */
function postWords(post: Act, data: Pick<LogData, 'names' | 'mine'>, own?: string): string {
  if (post.character === null || post.character === own) return `post #${post.seq}`;
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
  readonly from: number;
  readonly to: number;
}

/** A character's Turn that took effect at a settlement. */
export interface TurnTaken {
  readonly character: Id;
  readonly to: string;
  /** The class it Turned from, where the player's own rows say it; null otherwise. */
  readonly from: string | null;
  /** The announcement, where The System made one. */
  readonly announced: TurnAnnounced | null;
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
      if (moved === 0) continue;
      const before = after - moved;
      const from = rankIndex(instance.ranks, before);
      const to = rankIndex(instance.ranks, after);
      if (from !== to) out.set(s.id, [...(out.get(s.id) ?? []), { character: c.id, before, after, from, to }]);
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
    out.set(s.id, [...(out.get(s.id) ?? []), { character: c.id, to: c.class, from: from === c.class ? null : from, announced }]);
  }
  return out;
}

/** A settlement's lines in the order the boards say them: what it paid first, the largest first, then by reason; then what it cost. */
export function inOrder(lines: readonly LogLine[]): LogLine[] {
  return [...lines].sort((a, b) => b.amount - a.amount || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}

/** The words of one character's lines in a settlement, as the board's row says them: "drew heat +0.20, stole thunder +0.20". */
function scoredWords(lines: readonly LogLine[], words: Words): string {
  return inOrder(lines).map((l) => `${lowerFirst(reasonName(words.ui.reasonWords(l.reason)))} ${signed(l.amount)}`).join(', ');
}

/**
 * The log's rows, newest first: the open window's estimate on top, then each settlement with its Turns and rank changes beside
 * it. `tab` is a character of the player's, or null for All.
 */
export function logRows(data: LogData, words: Words, cap: number, tab: Id | null): readonly LogRow[] {
  const { instance } = words;
  const nameOf = (id: Id) => data.mine.find((c) => c.id === id)?.name ?? '';
  const inTab = (ids: readonly Id[]) => tab === null || ids.includes(tab);
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
      const details: Segment[] = [`${nameOf(t.character)} is ${withArticle(className(instance, t.to))} now.`];
      if (t.announced) {
        const act = data.acts.get(t.announced.act);
        const title = act ? data.titles.get(act.thread) : undefined;
        const where: Segment = act && title ? { text: title, href: act.seq !== null ? threadHref(act.thread, pageOf(act.seq, words.postsPerPage), act.seq) : threadHref(act.thread, 1) } : 'The System\'s board';
        details.push(` Announced ${t.announced.was ? 'with its old class ' : ''}in `, where, '.');
      } else {
        details.push(' A silent Turn: no one else was told.');
      }
      rows.push({ key: `turn:${s.id}:${t.character}`, kind: 'turn', at: s.endsAt, what: 'Turn took effect', details, aura: 0, wallet, characters: [t.character] });
    }
    for (const r of ranks.get(s.id) ?? []) {
      if (!inTab([r.character])) continue;
      const up = r.to > r.from;
      const name = (i: number) => instance.ranks[i]?.name ?? '';
      rows.push({
        key: `rank:${s.id}:${r.character}`, kind: 'rank', at: s.endsAt, what: up ? 'Rank up' : 'Rank down',
        details: [`${tab === null ? `${nameOf(r.character)}: ` : ''}${name(r.from)} to ${name(r.to)}. Standing ${plain(r.before)} to ${plain(r.after)} this season.`],
        aura: 0, wallet, characters: [r.character],
      });
    }
  }

  const ORDER: Record<LineKind, number> = { estimate: 0, settlement: 1, turn: 2, rank: 3 };
  rows.sort((a, b) => micros(b.at) - micros(a.at) || ORDER[a.kind] - ORDER[b.kind]);
  return [...estimateRows(data, words, tab), ...rows];
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
  return [`${who}${words.ui.reasonWords(l.reason)}.${after}`];
}

/** The Acts the log's lines name: every share's, every estimate line's and every announcement's; then the posts the card plays among them landed on. */
export function actsNamed(log: Log, estimate: Estimate | null, turns: readonly TurnAnnounced[]): Id[] {
  const ids = new Set<Id>();
  for (const s of log.settlements) for (const l of s.lines) for (const sh of l.shares) ids.add(sh.act);
  for (const l of estimate?.lines ?? []) if (l.act) ids.add(l.act);
  for (const t of turns) ids.add(t.act);
  return [...ids];
}
