/**
 * The card plays on the posts on screen, kept apart from the page like the tallies are: each play's
 * Act (a tag on its post), the state its effect has saved, and the reader's own releases. A change
 * wakes only the post it belongs to, so a card played, or a state saved, on a busy thread
 * re-renders the post it lands on and never the page. A post reads its own through `usePlays`.
 *
 * A card play takes no number in its thread (supabase/migrations/0035_card_takes_no_seq.sql): it is
 * found through the post it targets, so a page of posts reads every play on them in one request
 * (`readPlays`), never one per post ("Weigh a design at the scale of a busy instance"), and a play
 * that arrives live is added to the post it names whichever page that post is on.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Act, ActKind, EffectState, Id, KayfaApi, KindCount, PostPlaysRead, Rewind, SurfaceAct, SurfaceNow } from '../data/api.ts';
import type { InstanceUi } from '../types.ts';
import { useKayfa } from '../context.tsx';
import { BEYOND_POST, fallsOn, type BeyondPost, type CardRules } from '../../rules/cards.ts';
import { localKey, singleEmoji } from '../../rules/emoji.ts';
import { QUADRANTS, type Quadrant, type Settings, type Span } from '../../rules/types.ts';
import type { CardPlay, CardUi, CardView, KitControl } from './types.ts';
import { endsWords, keptEndedWords } from './marks.ts';
import { backoff, REPEAT_TRIES } from './tails.ts';

/**
 * The kind every card set face down is drawn as: one back, the same for every card, so two cards set face down look alike to everyone
 * but their setter (the card mechanic's design, section 3). No instance's card key can be it: a key is lowercase words.
 */
export const CARD_BACK = 'kb:card-back';
/**
 * Whether a kind is a card back: a live one (`CARD_BACK`), or one that sprang, which is its own kind (`CARD_BACK` and its spring), so a
 * back set later on the same post is never drawn or named as the card that sprang.
 */
export const isBack = (kind: string): boolean => kind === CARD_BACK || kind.startsWith(`${CARD_BACK}:`);
const sprungKind = (spring: Id) => `${CARD_BACK}:${spring}`;

/** Whether a back's time has passed, at the end the server stored: a back with none is over only when it springs or is taken back. */
export const backOver = (back: CardPlay, now: number): boolean => back.endsAt != null && Date.parse(back.endsAt) <= now;

/** Whether a sprung back's lockout is still live: its spring locked someone out (`revealed.until`), that end is ahead, and no admin ended it (`reversed`). The one rule `inForce` and `playOver` read. */
export const lockoutLive = (play: CardPlay, now: number): boolean =>
  play.revealed?.until !== undefined && Date.parse(play.revealed.until) > now && !play.reversed;

/**
 * The plays a post shows: all but a card back whose time has passed with nothing springing it, or that its setter took back, which is gone, as the server drops it
 * (card_target). Its end is the one the server stored when it was set (`endsAt`).
 */
export function shownPlays(plays: readonly CardPlay[], now: number): readonly CardPlay[] {
  const shown = plays.filter((p) => !(p.faceDown && !p.revealed && (p.takenBack !== undefined || backOver(p, now))));
  return shown.length === plays.length ? plays : shown;
}

/**
 * These plays as the ones named in `then` stood in a moment (an ORIGIN box draws them as they were, so an end since is no part of what it shows): those plays without `reversed`, the states
 * that can come after a moment (an admin's end, a cutting card's cut). `untaken` is no such state (a play that never took never did, then or now), so it is kept. The same array where nothing changes.
 */
export function asThen(plays: readonly CardPlay[], then: ReadonlySet<Id> | undefined): readonly CardPlay[] {
  if (then === undefined || !plays.some((p) => (p.reversed || p.cut) && then.has(p.id))) return plays;
  return plays.map((p) => {
    if (!(p.reversed || p.cut) || !then.has(p.id)) return p;
    const { reversed: _reversed, cut: _cut, ...kept } = p;
    return kept;
  });
}

/** A cast's `handedBack` (the play whose refund it was handed, and that play's card), as `{ handedBack }` where the payload's is an object with a string `by` and `card`, else nothing. */
function handedBackOf(raw: unknown): { readonly handedBack?: NonNullable<CardPlay['handedBack']> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const { by, card } = raw as Record<string, unknown>;
  return typeof by === 'string' && typeof card === 'string' ? { handedBack: { by, card } } : {};
}

/** A cast's `pierce` (the pierce play it spent, that play's card and the Ward it got past), as `{ pierce }` where the payload's is an object with a string `by` and `card` (`ward` is kept only where a string), else nothing. */
function pierceOf(raw: unknown): { readonly pierce?: NonNullable<CardPlay['pierce']> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const { by, card, ward } = raw as Record<string, unknown>;
  return typeof by === 'string' && typeof card === 'string' ? { pierce: { by, card, ...(typeof ward === 'string' ? { ward } : {}) } } : {};
}

/** A cutting play's `cut` (the Gimmick play it ended and that play's card), as `{ cuts }` where the payload's is an object with a string `play` and `card`, else nothing. */
function cutsOf(raw: unknown): { readonly cuts?: NonNullable<CardPlay['cuts']> } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const { play, card } = raw as Record<string, unknown>;
  return typeof play === 'string' && typeof card === 'string' ? { cuts: { play, card } } : {};
}

/** The pierce play a card Act's payload names as spent (`pierce.by`), or null for any other Act. */
const spendsOf = (act: Act): Id | null => (act.kind === 'card' ? pierceOf(act.payload.pierce).pierce?.by ?? null : null);

/**
 * Each play with `handedOut`: how many of these plays' casts name it in `handedBack` (the refund sign's count). Set only where it is above zero, so a play nobody names
 * carries no key; the same array where none is named.
 */
export function withHandedOut(plays: readonly CardPlay[]): readonly CardPlay[] {
  const counts = new Map<Id, number>();
  for (const p of plays) if (p.handedBack) counts.set(p.handedBack.by, (counts.get(p.handedBack.by) ?? 0) + 1);
  if (!plays.some((p) => counts.has(p.id))) return plays;
  return plays.map((p) => (counts.has(p.id) ? { ...p, handedOut: counts.get(p.id)! } : p));
}

/**
 * A card play, from its card Act or its set Act (a card back); null for any other Act, or a card Act with no card in it. A spring
 * is no play of its own: `Plays.add` reveals the back it names.
 */
export function playOf(act: Act): CardPlay | null {
  /* A play that is over when it lands (a heart, an Unban) keeps no `ends` and no `play_reach` row: it is a mark on the post it was played from, whatever reach its payload names, so it is read before the beyond-a-post rule asks for a time up. */
  const instant = act.kind === 'card' && act.payload.instant === true;
  const beyond = act.kind === 'card' && !instant && BEYOND_POST.includes(act.payload.reach as BeyondPost) ? act.payload.reach as BeyondPost : null;
  const on = beyond ? act.payload[beyond] : undefined;
  if (beyond && (typeof on !== 'string' || typeof act.payload.ends !== 'string')) return null;
  if (act.targetActId === null && !beyond) return null;
  if (act.kind === 'set') {
    return { id: act.id, card: CARD_BACK, layer: 1, caster: act.character, message: '', config: {}, playedAt: act.createdAt, post: act.targetActId ?? '', faceDown: true, endsAt: act.endsAt ?? null };
  }
  if (act.kind !== 'card' || typeof act.payload.card !== 'string') return null;
  const layer = act.payload.layer;
  const config = act.payload.config;
  return {
    id: act.id,
    card: act.payload.card,
    layer: typeof layer === 'number' && Number.isInteger(layer) && layer >= 1 ? layer : 1,
    caster: act.character,
    message: typeof act.payload.message === 'string' ? act.payload.message : '',
    config: typeof config === 'object' && config !== null && !Array.isArray(config) ? (config as Record<string, unknown>) : {},
    playedAt: act.createdAt,
    post: act.targetActId ?? '',
    ...(beyond ? { reach: beyond, on: on as Id } : {}),
    ...(typeof act.payload.caught === 'string' ? { caught: act.payload.caught } : {}),
    ...(typeof act.payload.spring === 'string' ? { spring: act.payload.spring } : {}),
    ...(typeof act.payload.rode === 'string' ? { rode: act.payload.rode } : {}),
    ...(typeof act.payload.starts === 'string' ? { starts: act.payload.starts } : {}),
    ...(typeof act.payload.rewind_at === 'string' ? { rewindAt: act.payload.rewind_at } : {}),
    ...(typeof act.payload.ends === 'string' ? { ends: act.payload.ends } : {}),
    ...(act.untaken === true ? { untaken: true as const } : {}),
    ...(typeof act.payload.drive === 'string' ? { drive: act.payload.drive } : {}),
    ...(typeof act.payload.drawn === 'string' ? { drawn: act.payload.drawn } : {}),
    ...(typeof act.payload.targetName === 'string' ? { targetName: act.payload.targetName } : {}),
    ...(handedBackOf(act.payload.handedBack)),
    ...(pierceOf(act.payload.pierce)),
    ...(act.kind === 'card' ? cutsOf(act.payload.cut) : {}),
    ...(instant ? {
      instant: true as const,
      ...(typeof act.payload.took === 'number' && Number.isSafeInteger(act.payload.took) ? { took: act.payload.took } : {}),
      ...(Array.isArray(act.payload.lifted) ? { lifted: act.payload.lifted.length } : {}),
    } : {}),
  };
}

/**
 * Where a play is kept and drawn: on its post, or for a play beyond a post on its target (the character, the thread or the board),
 * which the store reads by that id as it reads a post's (`Plays.get(character)`), so a postbit's, a thread head's and a banner's
 * marks are drawn as a post's are.
 */
export const homeOf = (play: Pick<CardPlay, 'post' | 'on'>): Id => play.on ?? play.post;

/** Whether a play is up on its post's own reach: not a reach beyond the post, caught, ended, cut, untaken or face down. What `PostEffects` draws, and what `useRowFilling` lays a layer for. */
export const actsOnPost = (p: CardPlay): boolean => !p.caught && !p.reversed && !p.cut && !p.untaken && !p.faceDown && !p.reach;

/**
 * The plays in force: all but a play an admin ended (`reversed`: its layer is off), a play that did not take (`untaken`: its text never
 * arrived, and it was refunded), a play that is over when it lands (`instant`: a heart, an Unban), a fall a filing has spent (`spent`) and a play beyond a post whose end has passed (it ends on its timer, its way out). A Use's end on a post is the Lens's to say ("has ended"), so it is kept. What counts layers, offers
 * a card or pins a thread reads this; the marks and the Lens read `markedPlays`, which keeps an ended play on a post to say so.
 */
export function livePlays(plays: readonly CardPlay[], now: number): readonly CardPlay[] {
  const live = plays.filter((p) => !p.reversed && !p.cut && !p.untaken && !p.instant && !p.spent && !(p.reach && p.ends !== undefined && Date.parse(p.ends) <= now));
  return live.length === plays.length ? plays : live;
}

/**
 * Whether a play is up now: what the Lens's Who groups by and the kinds grid's sign reads. Face up, it is in force unless an admin ended it (`reversed`),
 * a cutting card cut it (`cut`), it did not take (`untaken`), a trap caught it (`caught`), it was over when it landed (`instant`), a filing spent it (`spent`),
 * or its time has passed and its card does not keep (`keeps`: its level stays until an admin ends it). A play whose `starts` is ahead is in force: it is
 * set, and waits. A face-down back is in force, unless an admin ended it or a trap caught it, until it sprang (`revealed`), its setter took it back (`takenBack`) or its stored end has passed (`backOver`); a back that sprang into a lockout stays in force until the lockout's end (`revealed.until`).
 * It agrees with `endable` (`engine/ui/cards/Lens.tsx`) on every face-up play that is neither `instant` nor `spent`, which `endable` does not read.
 */
export function inForce(play: CardPlay, now: number, keeps: boolean): boolean {
  if (play.reversed || play.caught !== undefined) return false;
  /* A sprung back is over, unless its spring locked someone out and that lockout is still live (the owner, #984: Set, then Up now, then Ended). */
  if (play.faceDown && play.revealed) return lockoutLive(play, now);
  if (play.faceDown) return play.takenBack === undefined && !backOver(play, now);
  if (play.cut || play.untaken || play.instant || play.spent) return false;
  return keeps || play.ends === undefined || Date.parse(play.ends) > now;
}

/**
 * Whether a play is over (spent-marks design, section 1): caught, ended by an admin, didn't take, instant, spent by a filing, a back that sprang, or its
 * time is up and its card does not keep. A back that sprang into a lockout is not over while the lockout is live (`lockoutLive`), and in a moment (`then`)
 * it is not over when its spring locked someone out at all (judged as it stood, its lockout's end does not count); a sprung back with no lockout is over.
 * In a moment, a play named there is judged as it stood: its timed end does not count.
 */
export function playOver(p: CardPlay, now: number, keeps: ReadonlySet<string>, then?: ReadonlySet<Id>): boolean {
  if (p.caught || p.reversed || p.cut || p.untaken || p.instant || p.spent) return true;
  if (p.revealed && !((then?.has(p.id) && p.revealed.until !== undefined) || lockoutLive(p, now))) return true;
  if (then?.has(p.id)) return false;
  return p.ends !== undefined && Date.parse(p.ends) <= now && !keeps.has(p.card);
}

/**
 * The plays a post shows while a rewind is up (Time Machine design, 4.2): those played at or before the rewind's point, and those played at or after the rewind play itself (the rewind, and anything that
 * got through its freeze). Every other play is hidden, not ended: it is still held, its clock runs and it shows again when the rewind ends. The same array where none is hidden.
 */
export function rewoundPlays(plays: readonly CardPlay[], rewind: Pick<Rewind, 'at'>, rewindPlayAt: string): readonly CardPlay[] {
  const point = Date.parse(rewind.at);
  const from = Date.parse(rewindPlayAt);
  const kept = plays.filter((p) => { const t = Date.parse(p.playedAt); return t <= point || t >= from; });
  return kept.length === plays.length ? plays : kept;
}

/** What a post shows under a live rewind: its view (the words), and its plays split into those drawn and those hidden (`rewoundPlays`). */
export interface Rewound {
  readonly rewind: Rewind; readonly shown: readonly CardPlay[]; readonly hidden: readonly CardPlay[];
  /** Whether the rewind lets a play of any reach show on this post (`rewoundPlays`' rule), for the plays above it (a thread's, a character's) that fall on it. */
  readonly shows: (play: CardPlay) => boolean;
}

/**
 * The rewind a post is drawn under at `now`, or null. A rewind is live while its play is held and not over (`playOver`: its time is up, an admin ended it, it did not take); where more than one is live (a rarer
 * one over a lesser), the latest played is drawn (design, 4.2). A view whose play the store does not hold is not live, since it cannot be judged.
 */
export function rewoundOf(here: Pick<PostPlays, 'plays' | 'rewinds'>, now: number, keeps: ReadonlySet<string>): Rewound | null {
  let best: { readonly rewind: Rewind; readonly play: CardPlay } | null = null;
  for (const rewind of here.rewinds) {
    const play = here.plays.find((p) => p.id === rewind.play);
    if (!play || playOver(play, now, keeps)) continue;
    if (best === null || inPlayOrder(best.play, play) < 0) best = { rewind, play };
  }
  if (best === null) return null;
  const shown = rewoundPlays(here.plays, best.rewind, best.play.playedAt);
  const kept = new Set(shown);
  return { rewind: best.rewind, shown, hidden: here.plays.filter((p) => !kept.has(p)), shows: (p) => rewoundPlays([p], best.rewind, best.play.playedAt).length === 1 };
}

/** Whether a kind is spent on a post: it has plays, and every one is over. */
export const kindSpent = (plays: readonly CardPlay[], now: number, keeps: ReadonlySet<string>, then?: ReadonlySet<Id>): boolean =>
  plays.length > 0 && plays.every((p) => playOver(p, now, keeps, then));

/**
 * The plays that hold a place in a target's stack, which is what the form and the ghost marks ask the rules whether another card lands on: `livePlays`, and also a fall a filing has spent, as the
 * server counts it (`place_cast`, 0361: a spent fall holds its place unless an admin ended it, which `reversed` says). An instant play holds none. A spent fall is never drawn from this list; it is a mark, and
 * `livePlays` is what draws.
 */
export function stackPlays(plays: readonly CardPlay[], now: number): readonly CardPlay[] {
  const held = plays.filter((p) => !p.reversed && !p.cut && !p.untaken && !p.instant && !(p.reach && p.ends !== undefined && Date.parse(p.ends) <= now));
  return held.length === plays.length ? plays : held;
}

/**
 * The plays the marks and the Lens draw: `livePlays`, but a play on a post that an admin ended, or that did not take, is kept, as a caught
 * play is, so its mark and its Lens row can say "Ended by an admin" or "Didn't take". Its layer is off all the same (`livePlays`,
 * `effectsOf`, the post's effects); the marks do not count it. A play beyond a post whose time is up is dropped too, unless its card keeps (`keeps`: the keys of
 * the cards whose rules `keeps`) and it was not ended by an admin: it stays on the pages that hold a post it falls on, the only ended plays a page is given. A kept play at character reach
 * is drawn on every postbit of the character, so a strip on a post's own postbit gives that post's date (`postAt`) and an ended one is kept only where the post was written while it was up (`fallsOn`).
 */
export function markedPlays(plays: readonly CardPlay[], now: number, keeps: ReadonlySet<string> = NO_KEYS, postAt?: string): readonly CardPlay[] {
  const marked = plays.filter((p) => !(p.reach && (p.reversed || p.cut || (p.ends !== undefined && Date.parse(p.ends) <= now && (!keeps.has(p.card) || (p.reach === 'character' && postAt !== undefined && !fallsOn({ at: p.playedAt, ends: p.ends }, { at: postAt }, true, new Date(now))))))));
  return marked.length === plays.length ? plays : marked;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** The keys of the cards whose rules keep (`CardRules.keeps`): what `markedPlays` and `playsFallingOn` are given. */
export const keepingKeys = (cards: readonly Pick<CardRules, 'key' | 'keeps'>[]): ReadonlySet<string> => new Set(cards.filter((c) => c.keeps === true).map((c) => c.key));

/**
 * Which of a target's plays beyond a post fall on this post (`fallsOn`, engine/rules/cards.ts, which the database reads by the same dates): all but a play an admin
 * ended or that did not take, then the plays that are up now, and those of a card that keeps (`keeps` holds the keys of the cards whose rules `keeps`) written while the
 * post was up. Dates alone: nothing is read from the post but when it was written. The thread layer asks it of the thread's plays.
 */
export function playsFallingOn(plays: readonly CardPlay[], post: { readonly createdAt: string }, keeps: ReadonlySet<string>, now: number): readonly CardPlay[] {
  const at = new Date(now);
  const falling = plays.filter((p) => !p.reversed && !p.cut && !p.untaken && fallsOn({ at: p.playedAt, ...(p.ends !== undefined ? { ends: p.ends } : {}) }, { at: post.createdAt }, keeps.has(p.card), at));
  return falling.length === plays.length ? plays : falling;
}

/** A timer's delay is held under 2^31 ms; a later end is waited for in steps, each re-arming at the time it wakes to. */
export const TIMER_MOST = 2 ** 31 - 1;

/**
 * The time, redrawn when the soonest of these ends (epochs) passes, so something that ends on its own (a drive, a veil's line) is drawn as ended without a
 * read. Nothing is scheduled while none is ahead.
 */
export function useAt(ends: readonly number[]): number {
  const { api } = useKayfa();
  const [now, setNow] = useState(() => api.now());
  const ahead = ends.filter((e) => e > now);
  const next = ahead.length === 0 ? null : Math.min(...ahead);
  useEffect(() => {
    if (next === null) return;
    const timer = setTimeout(() => setNow(api.now()), Math.min(TIMER_MOST, Math.max(0, next - api.now()) + 1));
    return () => clearTimeout(timer);
  }, [api, next, now]);
  return now;
}

/** The plays a card of the rules reaches nothing beyond a post with, still in force on their post: not caught, not a card back, not reversed by an admin, not one that did not take. */
const standing = (p: CardPlay): boolean => !p.caught && !p.faceDown && !p.untaken && !p.reach;

/** A reaction a card added to one post (a `reaction` card's play, card notes Part 3): the key it is tallied under, its emoji and the quadrant it scores in. */
export interface LocalKind {
  /** `x-` and the emoji's code points (`localKey`): what a tally and `react` carry. */
  readonly key: string;
  readonly emoji: string;
  readonly quadrant: Quadrant;
  readonly play: Id;
  /** An admin ended its play: the kind is no longer offered, and what it earned stays counted. */
  readonly ended: boolean;
}

/**
 * The post-local reaction kinds a post's plays of a `reaction` card add, in play order, each once: a play that was caught, did not take or holds a
 * configuration the rules would not take adds none. Read from the plays as they are on this screen, so a kind is offered the moment its play lands.
 */
export function localKindsOf(plays: readonly CardPlay[], cards: readonly Pick<CardRules, 'key' | 'reaction'>[]): readonly LocalKind[] {
  const out: LocalKind[] = [];
  for (const p of plays) {
    if (!standing(p) || !cards.some((c) => c.key === p.card && c.reaction === true)) continue;
    const emoji = singleEmoji(p.config.emoji);
    const quadrant = QUADRANTS.find((q) => q === p.config.quadrant);
    if (emoji === null || quadrant === undefined) continue;
    const key = localKey(emoji);
    if (out.some((k) => k.key === key)) continue;
    out.push({ key, emoji, quadrant, play: p.id, ended: p.reversed === true || p.cut !== undefined });
  }
  return out;
}

/** A live play of a `veil: 'totals'` card on a post: who cast it, and when its totals show again. */
export interface BlindPlay { readonly play: Id; readonly caster: Id | null; readonly ends: string }

/** The plays on a post that hide its reaction totals now: a `totals` veil, in force, whose end is still ahead. */
export function blindPlaysOf(plays: readonly CardPlay[], cards: readonly Pick<CardRules, 'key' | 'veil'>[], now: number): readonly BlindPlay[] {
  return plays
    .filter((p) => standing(p) && !p.reversed && !p.cut && p.ends !== undefined && Date.parse(p.ends) > now && cards.some((c) => c.key === p.card && c.veil === 'totals'))
    .map((p) => ({ play: p.id, caster: p.caster, ends: p.ends! }));
}

/**
 * The soonest end still ahead among plays that have one (a play beyond a post, or a ward on a post, a face-down back's `endsAt`, a sprung back's lockout `revealed.until`), as an epoch,
 * or null: when what is drawn, or what a mark says, changes next by itself. It is what wakes the Lens, the marks and the board at a back's or a lockout's end.
 */
export function nextEnd(plays: readonly CardPlay[], now: number): number | null {
  let soonest: number | null = null;
  for (const p of plays) {
    for (const end of [p.ends, p.faceDown && !p.revealed && p.takenBack === undefined ? p.endsAt : undefined, p.revealed?.until]) {
      if (end == null) continue;
      const at = Date.parse(end);
      if (at > now && (soonest === null || at < soonest)) soonest = at;
    }
  }
  return soonest;
}

/** What a spring Act reveals: the set it ends and the card that was face down. */
function springOf(act: Act): { readonly set: Id; readonly card: string; readonly spring: Id; readonly at: string; readonly quadrant?: string; readonly until?: string } | null {
  if (act.kind !== 'spring' || typeof act.payload.set !== 'string' || typeof act.payload.card !== 'string') return null;
  const until = act.payload.did === 'lockedOut' && typeof act.payload.until === 'string' ? act.payload.until : undefined;
  return { set: act.payload.set, card: act.payload.card, spring: act.id, at: act.createdAt, ...(typeof act.payload.quadrant === 'string' ? { quadrant: act.payload.quadrant } : {}), ...(until !== undefined ? { until } : {}) };
}

/** The back a `take_back` Act ends, and when, or null for any other Act. */
const takeBackOf = (act: Act): { readonly set: Id; readonly at: string } | null =>
  act.kind === 'take_back' && typeof act.payload.set === 'string' ? { set: act.payload.set, at: act.createdAt } : null;

/** The play a `card_end` Act (or the `open_gift` that opens a box) ends, or null for any other Act. */
const endOf = (act: Act): Id | null => ((act.kind === 'card_end' || act.kind === 'open_gift') && typeof act.targetActId === 'string' ? act.targetActId : null);

/** Layer first, then when it was played, then its id: the order plays are laid over a post, the first innermost. */
export const inPlayOrder = (a: CardPlay, b: CardPlay): number =>
  a.layer - b.layer || Date.parse(a.playedAt) - Date.parse(b.playedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What a post carries: its plays in play order and in billing order, their saved states, and the reader's releases among them. */
export interface PostPlays {
  /** In play order (`inPlayOrder`): the order the effects wrap the post's words in. */
  readonly plays: readonly CardPlay[];
  /** In billing order (billing.ts): the order the tags are drawn in, set when the page is read and never moved while it is read. */
  readonly billed: readonly CardPlay[];
  readonly states: Readonly<Record<Id, EffectState>>;
  readonly released: ReadonlySet<Id>;
  /** How many times the post's page has been read (each `setBilling`): what the tags opened on it are closed by. */
  readonly read: number;
  /** Which card each of the reader's own card backs on the post is, by set (`my_face_down`): on the setter's screen alone. */
  readonly faces: Readonly<Record<Id, string>>;
  /** Each of the post's surface plays (0317): the cells it covers, its live Acts' ids, and the live Acts themselves (null until read, where a wall is near). */
  readonly surfaces: Readonly<Record<Id, Surface>>;
  /**
   * How many plays each kind has had on the post, and how many took, by kind (the back kind under `CARD_BACK`): the server's count (`setCounts`) kept current by plays heard since, and for a kind
   * the server sent none for, the plays held. A back counts once it has sprung.
   */
  readonly counts: ReadonlyMap<string, KindTally>;
  /** The views of the rewind plays on the post (`Plays.setRewinds`), in the order they were kept; `rewoundOf` says which is drawn. */
  readonly rewinds: readonly Rewind[];
}
/** How many plays a kind has had on a post, and how many took. */
export interface KindTally { readonly all: number; readonly took: number }
/** A surface play as the store holds it. */
export interface Surface extends SurfaceNow { readonly acts: readonly SurfaceAct[] | null }

const NONE: PostPlays = Object.freeze({ plays: Object.freeze([]), billed: Object.freeze([]), states: Object.freeze({}), released: new Set<Id>(), read: 0, faces: Object.freeze({}), surfaces: Object.freeze({}), counts: new Map<string, KindTally>(), rewinds: Object.freeze([]) });

/** The kind a play is counted under: its card, the back kind for a back, and none for a back not sprung (it is not counted until its spring arrives). */
const countedKind = (p: Pick<CardPlay, 'card' | 'revealed'>): string | null => (isBack(p.card) ? (p.revealed || p.card !== CARD_BACK ? CARD_BACK : null) : p.card);

const viewKey = (post: Id, card: string): string => `${post}\u0000${card}`;

const sameEntries = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && a[k] === b[k]);
};
/** A control is the same when every field is (functions by reference, options and all else by entry): an effect that rebuilds its controls each render should memoize them. */
const sameControl = (a: KitControl, b: KitControl): boolean => {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((k) => {
    if (!(k in y)) return false;
    if (k === 'options') {
      const o = x[k] as readonly { value: string; label: string }[];
      const p = y[k] as readonly { value: string; label: string }[];
      return o.length === p.length && o.every((q, i) => q.value === p[i]!.value && q.label === p[i]!.label);
    }
    return x[k] === y[k];
  });
};

/** Whether two views say the same, field by field: `notes` entry by entry, `controls` control by control. */
export function sameView(a: CardView, b: CardView): boolean {
  return Object.is(a.progress, b.progress) && a.state === b.state && a.ends === b.ends && a.yours === b.yours && a.report === b.report
    && sameEntries(a.notes, b.notes) && a.controls.length === b.controls.length && a.controls.every((c, i) => sameControl(c, b.controls[i]!));
}

/**
 * The engine's view for a card with no effect, or before its effect has said anything: its State is the card's `status`,
 * else its `summary`, else the first sentence of what `describe` says under `settings`, else (no settings to describe under)
 * its name; no edge, no notch, no controls. A play that ends on a timer (`endsAt`, a Use's `ends`) gives the view its way out,
 * "Ends Nov 7, 9:14 PM", in the reader's zone; a card that keeps (`rules.keeps`) whose end has passed at `now` says "Ended Nov 7, 9:14 PM. Posts written while it was up keep it." A status that is a function is given the card's `plays` on the post.
 * The overloads: with no `endsAt` there is no end to word and no clock is needed; with an `endsAt` (even one that may be `undefined`) a `now` is required, so the tense of "Ends" or "Ended" is never guessed.
 * A strip showing a post in a moment passes a clock before the end, so the end reads as it stood then.
 */
export function defaultView(rules: Pick<CardRules, 'name' | 'keeps'>, ui: Pick<CardUi, 'status' | 'summary' | 'describe'> | undefined, settings?: Settings, endsAt?: undefined, plays?: readonly CardPlay[]): CardView;
/** With an end that may be given, the clock is required: the tense of "Ends" or "Ended" is the clock's to give. */
export function defaultView(rules: Pick<CardRules, 'name' | 'keeps'>, ui: Pick<CardUi, 'status' | 'summary' | 'describe'> | undefined, settings: Settings | undefined, endsAt: string | undefined, plays: readonly CardPlay[], now: number): CardView;
export function defaultView(rules: Pick<CardRules, 'name' | 'keeps'>, ui: Pick<CardUi, 'status' | 'summary' | 'describe'> | undefined, settings?: Settings, endsAt?: string, plays: readonly CardPlay[] = [], now = 0): CardView {
  const described = ui && settings ? ui.describe(settings) : '';
  const first = /^.*?[.!?](?=\s|$)/s.exec(described.trim())?.[0] ?? described.trim();
  return { progress: null, state: (typeof ui?.status === 'function' ? ui.status(plays) : ui?.status) ?? ui?.summary ?? (first || rules.name), ...(endsAt !== undefined ? { ends: rules.keeps === true && Date.parse(endsAt) <= now ? keptEndedWords(endsAt, now) : endsWords(endsAt, now) } : {}), yours: false, controls: [], notes: {} };
}

export interface Plays {
  get(post: Id): PostPlays;
  /** Take in card Acts, and the `card_end` of a play (it marks its play reversed, or is held for when the play arrives); anything else is ignored. True when a play was new or ended. A play is its Act's id: the same again is the same play.
   * `older`: plays a kind's page read (`kindPlays`), which the server's count already holds and the billing never named: they are kept, and neither move a kind's count nor take a place in the billing, so a paged back is no mark of its own. */
  add(acts: readonly Act[], options?: { readonly older?: true }): boolean;
  /** Keep each play's newest saved state, by when it was saved; true when any was newer. A state for a play not here is kept for when it is. */
  setStates(states: Readonly<Record<Id, EffectState>>): boolean;
  /** Mark each of these plays reversed in place, as its `card_end` would (one not held yet is remembered, as an early `card_end` is); true when a play was marked or newly remembered. */
  setEnded(plays: readonly Id[]): boolean;
  /** A filing spent these Take the Fall plays (the thread page's `spent`): each is marked spent in place, stays a mark and is no longer live. One for a play not here is kept for when it is; true when any was new. */
  setSpent(plays: readonly Id[]): boolean;
  /** The reader released themselves from these plays. */
  setReleased(plays: readonly Id[]): boolean;
  /** The reader's own card backs' cards, by set: drawn under the back on their screen alone, never sent. */
  setFaces(faces: Readonly<Record<Id, string>>): boolean;
  /** Keep each surface play's cells covered and live ids, as the page's read or the channel says them (the live Acts read before are kept until read again); true when any changed. A surface for a play not here is kept for when it is. */
  setSurfaces(surfaces: Readonly<Record<Id, Pick<SurfaceNow, 'covered'> & { readonly live?: readonly Id[] }>>): boolean;
  /** Keep a surface play's live Acts, as `surfaceActs` read them, with the cells covered. */
  setSurfaceActs(play: Id, covered: number | null, acts: readonly SurfaceAct[], ticket?: number): boolean;
  /** The next ticket for a read of a surface's Acts: an answer carrying an older ticket than one already kept is dropped. */
  surfaceTicket(play: Id): number;
  /** A surface play as held, or undefined. */
  surfaceOf(play: Id): Surface | undefined;
  /** Say the surface's live Acts are wanted (a wall is near the viewport): true the first time, so the caller reads once. */
  wantSurface(play: Id): boolean;
  /** Whether its live Acts are wanted, and so read again when it changes. */
  wantsSurface(play: Id): boolean;
  /** Take the want back, where a read failed, so the next ask reads again. */
  unwantSurface(play: Id): void;
  /** Keep the server's count of each kind (`postPlays`' `counts`, a page's), by post: a post named has exactly the kinds given, and is woken when any changed. */
  setCounts(counts: readonly KindCount[]): void;
  /**
   * Keep each rewind play's view (`Rewind`, the page's `rewinds` or `api.rewindView`), by its play: a view kept again replaces the one held. A post draws it only while its play is held and up (`rewoundOf`), so a
   * view that outlives its play changes nothing. True when any was new or changed.
   */
  setRewinds(rewinds: readonly Rewind[]): boolean;
  /** Say a rewind play's view is wanted (read once, `readRewinds`): true the first time, and never for a view already kept (the page's, delivered by `hydrate`). */
  wantRewind(play: Id): boolean;
  /** Take the want back, where the read failed, so the next ask reads again. */
  unwantRewind(play: Id): void;
  /** The post's plays in billing order: as last set, then each play added since, in the order it arrived. */
  billing(post: Id): readonly Id[];
  /** Set the post's billing, when its page is read (a new read, even in the same order); a play it leaves out keeps its place after the ones it names. */
  setBilling(post: Id, plays: readonly Id[]): void;
  /** The card's view of itself on a post (`CardView`), or null; on this screen only, never saved or sent. */
  view(post: Id, card: string): CardView | null;
  /**
   * Set or clear (null) a card's view on a post. A view equal to the one held (`sameView`) does nothing; any other wakes
   * the post's listeners and leaves the post's snapshot as it was, so a view written while an effect runs draws only what
   * reads it (`useCardView`), never the effects or the post's words, and never another card's view.
   */
  setView(post: Id, card: string, view: CardView | null): void;
  subscribe(post: Id, listener: () => void): () => void;
}

export function createPlays(): Plays {
  const byPost = new Map<Id, Map<Id, CardPlay>>();
  const postOf = new Map<Id, Id>();
  const states = new Map<Id, EffectState>();
  const released = new Set<Id>();
  const faces = new Map<Id, string>();
  const surfaces = new Map<Id, Surface>();
  /* The server's count of each kind on a post, kept current by the plays heard since (`bump`). A kind with none is counted from the plays held (`get`). */
  const counts = new Map<Id, Map<string, KindTally>>();
  const wanted = new Set<Id>();
  /*
   * Each rewind play's view, by the play, and the same views by post in the order kept (`get` reads the latter, so it never scans every view). Their lifetime is the store's: one for a thread
   * screen (its posts, and its ORIGIN box's store for the origin post), dropped with it. They are bounded by the rewinds that screen's pages carry or its live plays bring, a few per post
   * (a rewind card has a stack of one and only a rarer rewind lies over a lesser), and a view whose play is over is kept but draws nothing (`rewoundOf`).
   */
  const rewinds = new Map<Id, Rewind>();
  const rewindsByPost = new Map<Id, Rewind[]>();
  const wantedRewinds = new Set<Id>();
  const issued = new Map<Id, number>();
  const taken = new Map<Id, number>();
  /* A spring that arrived before the back it reveals, kept for when it does. */
  const springs = new Map<Id, NonNullable<ReturnType<typeof springOf>>>();
  /* The back each spring revealed, by the spring's id: an admin ends a lockout by a `card_end` on its spring, which ends the back it sprang from. */
  const setOfSpring = new Map<Id, Id>();
  /* The backs their setters took back: a `take_back` that arrived before its back is kept here for when the back does. */
  const takenBacks = new Map<Id, string>();
  /* The plays an admin ended: a `card_end` that arrived before its play is kept here for when the play does. */
  const ended = new Set<Id>();
  /* Every cutting play of a Gimmick, by the Gimmick play's id, in the order they arrived (one that came before its Gimmick is kept for when it does): the first one an admin has not ended is what cut it. */
  const cutters = new Map<Id, { readonly by: Id; readonly card: string }[]>();
  /* Each cutting play's Gimmick, by the cutting play's id. */
  const cuttingOf = new Map<Id, Id>();
  const cutOf = (gimmick: Id): NonNullable<CardPlay['cut']> | undefined => cutters.get(gimmick)?.find((c) => !ended.has(c.by));
  /* The falls a filing spent: a mark that arrived before its play is kept here for when the play does. */
  const spentPlays = new Set<Id>();
  /* Each post's billing order, by play id: set by a read of its page, with a play that arrives later appended. */
  const order = new Map<Id, readonly Id[]>();
  /* Each card's view on a post, by `viewKey`: kept apart from the snapshots, so setting one never moves a snapshot or another card's view. */
  const views = new Map<string, CardView>();
  const reads = new Map<Id, number>();
  const snapshots = new Map<Id, PostPlays>();
  const listeners = new Map<Id, Set<() => void>>();

  const changed = (posts: Iterable<Id>) => {
    for (const post of posts) {
      snapshots.delete(post);
      for (const l of [...(listeners.get(post) ?? [])]) l();
    }
  };
  /* An admin's end of a cutting play brings its Gimmick back: the cut is cleared from the play it named, and from the held set. */
  const clearCut = (cutting: Id, touched: Set<Id>) => {
    const gimmick = cuttingOf.get(cutting);
    if (gimmick === undefined) return;
    const at = postOf.get(gimmick);
    const mine = at === undefined ? undefined : byPost.get(at);
    const was = mine?.get(gimmick);
    if (!mine || !was?.cut || was.cut.by !== cutting) return;
    const next = cutOf(gimmick);
    if (next) mine.set(gimmick, { ...was, cut: next });
    else { const { cut: _cut, ...back } = was; mine.set(gimmick, back); }
    touched.add(at!);
  };
  /* A play heard that the held count does not include moves its kind's count, where the server sent one. */
  const bump = (home: Id, kind: string | null, all: number, took: number, touched: Set<Id>) => {
    const was = kind === null ? undefined : counts.get(home)?.get(kind);
    if (!was) return;
    counts.get(home)!.set(kind!, { all: was.all + all, took: was.took + took });
    touched.add(home);
  };
  const newer = (a: EffectState, b: EffectState) => Date.parse(a.savedAt) > Date.parse(b.savedAt);
  return {
    get(post) {
      const own = byPost.get(post);
      if (!own && !counts.has(post) && !rewindsByPost.has(post)) return NONE;
      let snap = snapshots.get(post);
      if (!snap) {
        const plays = [...(own?.values() ?? [])].sort(inPlayOrder);
        const kinds = new Map<string, KindTally>();
        for (const p of plays) {
          const kind = countedKind(p);
          if (kind !== null) kinds.set(kind, { all: (kinds.get(kind)?.all ?? 0) + 1, took: (kinds.get(kind)?.took ?? 0) + (p.untaken ? 0 : 1) });
        }
        /* The server's count may be older than a play heard while its read was out: never lower than the plays held. */
        for (const [kind, count] of counts.get(post) ?? []) { const held = kinds.get(kind); kinds.set(kind, held ? { all: Math.max(count.all, held.all), took: Math.max(count.took, held.took) } : count); }
        snap = {
          counts: kinds,
          plays,
          billed: (order.get(post) ?? []).map((id) => own!.get(id)!),
          states: Object.fromEntries(plays.filter((p) => states.has(p.id)).map((p) => [p.id, states.get(p.id)!])),
          released: new Set(plays.filter((p) => released.has(p.id)).map((p) => p.id)),
          read: reads.get(post) ?? 0,
          faces: Object.fromEntries(plays.filter((p) => faces.has(p.id)).map((p) => [p.id, faces.get(p.id)!])),
          surfaces: Object.fromEntries(plays.filter((p) => surfaces.has(p.id)).map((p) => [p.id, surfaces.get(p.id)!])),
          rewinds: rewindsByPost.get(post) ?? [],
        };
        snapshots.set(post, snap);
      }
      return snap;
    },
    add(acts, options) {
      const older = options?.older === true;
      const touched = new Set<Id>();
      for (const act of acts) {
        /* A spring reveals its back in place: the same play, keeping its place in the billing, so no mark moves. */
        const sprung = springOf(act);
        if (sprung) {
          springs.set(sprung.set, sprung);
          setOfSpring.set(sprung.spring, sprung.set);
          const post = postOf.get(sprung.set);
          const own = post === undefined ? undefined : byPost.get(post);
          const back = own?.get(sprung.set);
          if (own && back && !back.revealed) {
            own.set(back.id, { ...back, ...(ended.has(sprung.spring) ? { reversed: true as const } : {}), card: sprungKind(sprung.spring), revealed: { card: sprung.card, spring: sprung.spring, at: sprung.at, ...(sprung.quadrant !== undefined ? { quadrant: sprung.quadrant } : {}), ...(sprung.until !== undefined ? { until: sprung.until } : {}) } });
            touched.add(homeOf(back));
            if (!older) bump(homeOf(back), CARD_BACK, 1, back.untaken ? 0 : 1, touched);
          }
          continue;
        }
        /* A take-back ends its back in place, as a spring reveals one: the same play, with the time it was taken back. */
        const taken = takeBackOf(act);
        if (taken) {
          takenBacks.set(taken.set, taken.at);
          const post = postOf.get(taken.set);
          const own = post === undefined ? undefined : byPost.get(post);
          const back = own?.get(taken.set);
          if (own && back && !back.takenBack) {
            own.set(back.id, { ...back, takenBack: { at: taken.at } });
            touched.add(homeOf(back));
          }
          continue;
        }
        /* A card_end marks its play reversed in place, keeping its place in the billing; one that comes first is held. */
        const target = endOf(act);
        if (target !== null) {
          ended.add(target);
          /* The end of a spring (a lockout) ends the back it sprang from. */
          const marked = setOfSpring.get(target) ?? target;
          const home = postOf.get(marked);
          const own = home === undefined ? undefined : byPost.get(home);
          const was = own?.get(marked);
          if (own && was && !was.reversed) {
            own.set(marked, { ...was, reversed: true });
            touched.add(home!);
          }
          clearCut(target, touched);
          continue;
        }
        const found = playOf(act);
        if (!found) continue;
        /* A Move that got past a ward with a pierce spends that play (as `setSpent` does for a filing's fall): marked now, or held for when the play arrives. */
        const spends = spendsOf(act);
        if (spends !== null) {
          spentPlays.add(spends);
          const at = postOf.get(spends);
          const mine = at === undefined ? undefined : byPost.get(at);
          const was = mine?.get(spends);
          if (mine && was && !was.spent) { mine.set(spends, { ...was, spent: true }); touched.add(at!); }
        }
        const early = found.faceDown ? springs.get(found.id) : undefined;
        const withSpring = early ? { ...found, card: sprungKind(early.spring), revealed: { card: early.card, spring: early.spring, at: early.at, ...(early.quadrant !== undefined ? { quadrant: early.quadrant } : {}), ...(early.until !== undefined ? { until: early.until } : {}) } } : found;
        const takenAt = found.faceDown ? takenBacks.get(found.id) : undefined;
        const withTaken = takenAt ? { ...withSpring, takenBack: { at: takenAt } } : withSpring;
        /* A cutting play ends the Gimmick it names in place: marked now, or held for when that play arrives. One an admin already ended cuts nothing. */
        if (found.cuts && !cuttingOf.has(found.id)) {
          cuttingOf.set(found.id, found.cuts.play);
          cutters.set(found.cuts.play, [...(cutters.get(found.cuts.play) ?? []), { by: found.id, card: found.card }]);
          if (!ended.has(found.id)) {
            const mark = cutOf(found.cuts.play)!;
            const at = postOf.get(found.cuts.play);
            const mine = at === undefined ? undefined : byPost.get(at);
            const was = mine?.get(found.cuts.play);
            if (mine && was && was.cut?.by !== mark.by) { mine.set(was.id, { ...was, cut: mark }); touched.add(at!); }
          }
        }
        const withEnd = ended.has(found.id) || (early !== undefined && ended.has(early.spring)) ? { ...withTaken, reversed: true as const } : withTaken;
        const withSpent = spentPlays.has(found.id) ? { ...withEnd, spent: true as const } : withEnd;
        const cutNow = cutOf(found.id);
        const play = cutNow ? { ...withSpent, cut: cutNow } : withSpent;
        const home = homeOf(play);
        const own = byPost.get(home) ?? new Map<Id, CardPlay>();
        /* A play already held is the same play, with one change it can learn: that it did not take (`untaken`, 0149), set in place so its place in the billing stays. */
        const held = own.get(play.id);
        if (held) {
          if (play.untaken && !held.untaken) { own.set(play.id, { ...held, untaken: true as const }); touched.add(home); bump(home, countedKind(held), 0, -1, touched); }
          continue;
        }
        own.set(play.id, play);
        if (!older) bump(home, countedKind(play), 1, play.untaken ? 0 : 1, touched);
        byPost.set(home, own);
        if (!older) order.set(home, [...(order.get(home) ?? []), play.id]);
        postOf.set(play.id, home);
        touched.add(home);
      }
      changed(touched);
      return touched.size > 0;
    },
    setStates(next) {
      const touched = new Set<Id>();
      for (const [play, state] of Object.entries(next)) {
        const was = states.get(play);
        if (was && !newer(state, was)) continue;
        states.set(play, state);
        const post = postOf.get(play);
        if (post !== undefined) touched.add(post);
      }
      changed(touched);
      return touched.size > 0;
    },
    setEnded(next) {
      const touched = new Set<Id>();
      let remembered = false;
      for (const target of next) {
        if (!ended.has(target)) { ended.add(target); remembered = true; }
        const home = postOf.get(target);
        const own = home === undefined ? undefined : byPost.get(home);
        const was = own?.get(target);
        if (own && was && !was.reversed) {
          own.set(target, { ...was, reversed: true });
          touched.add(home!);
        }
        clearCut(target, touched);
      }
      changed(touched);
      return remembered || touched.size > 0;
    },
    setCounts(next) {
      const touched = new Set<Id>();
      const given = new Map<Id, Map<string, KindTally>>();
      for (const c of next) {
        const kinds = given.get(c.post) ?? new Map<string, KindTally>();
        kinds.set(c.card ?? CARD_BACK, { all: c.all, took: c.took });
        given.set(c.post, kinds);
      }
      for (const [post, kinds] of given) {
        const was = counts.get(post);
        if (was && was.size === kinds.size && [...kinds].every(([k, v]) => was.get(k)?.all === v.all && was.get(k)?.took === v.took)) continue;
        counts.set(post, kinds);
        touched.add(post);
      }
      changed(touched);
    },
    setSpent(next) {
      const touched = new Set<Id>();
      let learned = false;
      for (const target of next) {
        if (!spentPlays.has(target)) { spentPlays.add(target); learned = true; }
        const home = postOf.get(target);
        const own = home === undefined ? undefined : byPost.get(home);
        const was = own?.get(target);
        if (own && was && !was.spent) {
          own.set(target, { ...was, spent: true });
          touched.add(home!);
        }
      }
      changed(touched);
      return learned || touched.size > 0;
    },
    setReleased(plays) {
      const touched = new Set<Id>();
      for (const play of plays) {
        if (released.has(play)) continue;
        released.add(play);
        const post = postOf.get(play);
        if (post !== undefined) touched.add(post);
      }
      changed(touched);
      return touched.size > 0;
    },
    setFaces(next) {
      const touched = new Set<Id>();
      for (const [play, card] of Object.entries(next)) {
        if (faces.get(play) === card) continue;
        faces.set(play, card);
        const post = postOf.get(play);
        if (post !== undefined) touched.add(post);
      }
      changed(touched);
      return touched.size > 0;
    },
    setSurfaces(next) {
      const touched = new Set<Id>();
      for (const [play, now] of Object.entries(next)) {
        const was = surfaces.get(play);
        const live = now.live ?? was?.live ?? [];
        if (was && was.covered === now.covered && was.live.length === live.length && was.live.every((id, i) => id === live[i])) continue;
        surfaces.set(play, { covered: now.covered, live, acts: was?.acts ?? null });
        const post = postOf.get(play);
        if (post !== undefined) touched.add(post);
      }
      changed(touched);
      return touched.size > 0;
    },
    surfaceTicket(play) { const n = (issued.get(play) ?? 0) + 1; issued.set(play, n); return n; },
    surfaceOf: (play) => surfaces.get(play),
    setSurfaceActs(play, now, acts, ticket) {
      if (ticket !== undefined) {
        if (ticket < (taken.get(play) ?? 0)) return false;
        taken.set(play, ticket);
      }
      const was = surfaces.get(play);
      const covered = now ?? was?.covered ?? 0;
      surfaces.set(play, { covered, live: acts.map((a) => a.id), acts });
      const post = postOf.get(play);
      if (post === undefined) return false;
      const same = was?.acts != null && was.covered === covered && was.acts.length === acts.length && was.acts.every((a, i) => a.id === acts[i]!.id && a.share === acts[i]!.share);
      if (!same) changed([post]);
      return !same;
    },
    setRewinds(next) {
      const touched = new Set<Id>();
      for (const r of next) {
        const was = rewinds.get(r.play);
        if (was && was.post === r.post && was.at === r.at && JSON.stringify(was.version) === JSON.stringify(r.version)) continue;
        rewinds.set(r.play, r);
        const mine = (rewindsByPost.get(r.post) ?? []).filter((v) => v.play !== r.play);
        rewindsByPost.set(r.post, [...mine, r]);
        if (was && was.post !== r.post) rewindsByPost.set(was.post, (rewindsByPost.get(was.post) ?? []).filter((v) => v.play !== r.play));
        touched.add(r.post);
      }
      changed(touched);
      return touched.size > 0;
    },
    wantRewind(play) { if (wantedRewinds.has(play) || rewinds.has(play)) return false; wantedRewinds.add(play); return true; },
    unwantRewind(play) { wantedRewinds.delete(play); },
    wantSurface(play) { if (wanted.has(play)) return false; wanted.add(play); return true; },
    wantsSurface: (play) => wanted.has(play),
    unwantSurface(play) { wanted.delete(play); },
    billing: (post) => order.get(post) ?? [],
    setBilling(post, ids) {
      const own = byPost.get(post);
      if (!own) return;
      const named = [...new Set(ids.filter((id) => own.has(id)))];
      const next = [...named, ...(order.get(post) ?? []).filter((id) => !named.includes(id))];
      order.set(post, next);
      reads.set(post, (reads.get(post) ?? 0) + 1);
      changed([post]);
    },
    view: (post, card) => views.get(viewKey(post, card)) ?? null,
    setView(post, card, view) {
      const key = viewKey(post, card);
      const was = views.get(key) ?? null;
      if (was === view || (was !== null && view !== null && sameView(was, view))) return;
      if (view === null) views.delete(key); else views.set(key, view);
      for (const l of [...(listeners.get(post) ?? [])]) l();
    },
    subscribe(post, listener) {
      const set = listeners.get(post) ?? new Set();
      listeners.set(post, set.add(listener));
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(post) === set) listeners.delete(post);
      };
    },
  };
}

export function usePlays(plays: Plays, post: Id): PostPlays {
  return useSyncExternalStore((l) => plays.subscribe(post, l), () => plays.get(post));
}

/**
 * The rewind a post is drawn under, or null, redrawn when the rewind's own time passes (`useAt`), so a post draws everything again at the end of its rewind with no read. A rewind's view that has not
 * arrived yet is no rewind: the post shows as it did until it does, and draws rewound once, never the present after it.
 */
export function useRewound(plays: Plays, post: Id): Rewound | null {
  const { instance, api } = useKayfa();
  const here = usePlays(plays, post);
  const keeps = useMemo(() => keepingKeys(instance.cards), [instance.cards]);
  const ends = here.rewinds.flatMap((r) => { const e = here.plays.find((p) => p.id === r.play)?.ends; return e === undefined ? [] : [Date.parse(e)]; });
  const now = useAt(ends);
  return useMemo(() => rewoundOf(here, Math.max(now, api.now()), keeps), [here, now, api, keeps]);
}

/** The plays a live rewind does not let show on its post, or the rewind's own while "The present" is shown: not ended, only not drawn (`PostEffects`, and the row's fill layers). */
export function hiddenByRewind(rewound: Rewound | null, presenting: boolean): ReadonlySet<Id> {
  return new Set(presenting && rewound ? [rewound.rewind.play] : rewound?.hidden.map((p) => p.id));
}

/** A card's view on a post (`Plays.view`): what reads it is drawn again when it changes, and nothing else is. */
export function useCardView(plays: Plays, post: Id, card: string): CardView | null {
  return useSyncExternalStore((l) => plays.subscribe(post, l), () => plays.view(post, card));
}

/** The keys of the cards the instance draws an effect for: only their plays' saved states and releases are ever read. */
export const effectCards = (ui: Pick<InstanceUi, 'cards'>): ReadonlySet<string> => new Set(ui.cards.filter((c) => c.Effect !== undefined).map((c) => c.key));

/** Read what an effect keeps of these plays (the post author's saved state, the reader's releases), for the cards that draw one; a read that fails leaves the play as it was. */
export async function readEffects(api: KayfaApi, plays: Plays, acts: readonly Act[], cards: ReadonlySet<string>): Promise<void> {
  const wanted = acts.filter((a) => typeof a.payload.card === 'string' && cards.has(a.payload.card)).map((a) => a.id);
  if (wanted.length === 0) return;
  const [states, released] = await Promise.all([api.effectStates(wanted).catch(() => ({})), api.myReleases(wanted).catch(() => [])]);
  plays.setStates(states);
  plays.setReleased(released);
}

/**
 * Read every play on these posts, with what their effects keep, in the reads a page costs: one for
 * the plays, one for their states and one for the reader's releases, whatever the page holds. A
 * result is the one `KayfaApi.postPlays` answers. A failed read leaves the posts
 * as they are drawn without it: a tag is missing, never a post.
 */
export async function readPlays(api: KayfaApi, plays: Plays, posts: readonly Id[], cards: ReadonlySet<string>): Promise<readonly Act[]> {
  if (posts.length === 0) return [];
  const read = await api.postPlays(posts).then((r) => r, (): PostPlaysRead => ({ plays: [], counts: [] }));
  const acts = read.plays;
  plays.add(acts);
  plays.setCounts(read.counts);
  await readEffects(api, plays, acts, cards);
  /* The plays' ends ride in the read for the store; they are no plays, so no tally, reaction or caster is read for one. */
  return acts.filter((a) => a.kind !== 'card_end' && a.kind !== 'open_gift');
}

/**
 * Take a screen document's plays, with their saved states and the reader's releases, into the store with no read (the forum-load plan,
 * Task 13): the document holds what `readPlays`, `readAbove` and `readEffects` would have asked for. `faces` are the reader's own card
 * backs' cards, by set; `spent` the Take the Fall plays a filing has spent. The states and releases are the document's for the cards the instance draws an effect for.
 */
export function hydrate(plays: Plays, acts: readonly Act[], states: Readonly<Record<Id, EffectState>>, releases: readonly Id[], faces: Readonly<Record<Id, string>> = {}, surfaces: Readonly<Record<Id, SurfaceNow>> = {}, spent: readonly Id[] = [], counts: readonly KindCount[] = [], rewinds: readonly Rewind[] = []): void {
  plays.add(acts);
  plays.setRewinds(rewinds);
  plays.setCounts(counts);
  plays.setSpent(spent);
  plays.setStates(states);
  plays.setReleased(releases);
  plays.setFaces(faces);
  plays.setSurfaces(surfaces);
}

/**
 * Read the view of each rewind play among these Acts (`KayfaApi.rewindView`), once each, into the store: the plays that land while a reader is on the page, which the page's own `rewinds` did not carry.
 * The post shows as it did until the view is in, then rewound, so the present is never drawn after it. A read that fails is asked again after `backoff`, at most `REPEAT_TRIES` times in all, and then `failed` is called once for it (the screen reads its page again, whose `rewinds` carry the view); an Act that is no rewind play is nothing.
 * `cards` are the keys of the cards with a rewind.
 */
export async function readRewinds(api: KayfaApi, plays: Plays, acts: readonly Act[], cards: ReadonlySet<string>, failed?: () => void, attempt = 0): Promise<void> {
  const wanted = acts.filter((a) => a.kind === 'card' && a.targetActId !== null && typeof a.payload.card === 'string' && cards.has(a.payload.card) && a.payload.instant !== true && plays.wantRewind(a.id));
  await Promise.all(wanted.map(async (a) => {
    try {
      const view = await api.rewindView(a.id);
      if (view !== null) plays.setRewinds([view]);
    } catch {
      plays.unwantRewind(a.id);
      if (attempt + 1 < REPEAT_TRIES) setTimeout(() => { void readRewinds(api, plays, [a], cards, failed, attempt + 1); }, backoff(attempt));
      else failed?.();
    }
  }));
}

/** The keys of the cards whose rules have a rewind. */
export const rewindCards = (cards: readonly Pick<CardRules, 'key' | 'rewind'>[]): ReadonlySet<string> => new Set(cards.filter((c) => c.rewind !== undefined).map((c) => c.key));

/**
 * Read a surface play's live draws and washes (`KayfaApi.surfaceActs`) into the store. Asked where a wall is near the viewport and again when the
 * channel says it changed, so a page of many walls reads the few that are near. Each read takes a ticket and an answer older than one already taken
 * in is dropped, so reads that cross never move the wall back. A read that finds no surface leaves the cells covered as they were. A read that fails
 * leaves the surface as it was and keeps the want (so the channel's next change reads again), and is tried again after `backoff`, at most `REPEAT_TRIES` times in all.
 */
export async function readSurface(api: KayfaApi, plays: Plays, play: Id, attempt = 0): Promise<void> {
  const ticket = plays.surfaceTicket(play);
  try {
    const read = await api.surfaceActs(play);
    plays.setSurfaceActs(play, read === null ? null : read.covered, read?.acts ?? [], ticket);
  } catch {
    if (attempt + 1 < REPEAT_TRIES) setTimeout(() => { void readSurface(api, plays, play, attempt + 1); }, backoff(attempt));
  }
}

/**
 * After a page is read again (a rejoined channel, a catch-up): the live Acts of each wanted wall whose live list is no longer the one drawn are read
 * again, since the page carries the list's ids and never the Acts. A wall nobody asked to read, and one whose list is unchanged, is left.
 */
export async function rereadSurfaces(api: KayfaApi, plays: Plays, surfaces: Readonly<Record<Id, SurfaceNow>>): Promise<void> {
  const stale = Object.entries(surfaces).filter(([play, now]) => {
    const held = plays.surfaceOf(play);
    return plays.wantsSurface(play) && held?.acts != null && (held.acts.length !== now.live.length || held.acts.some((a, i) => a.id !== now.live[i]));
  });
  await Promise.all(stale.map(([play]) => readSurface(api, plays, play)));
}

/**
 * Read the live plays above a page's posts (`KayfaApi.effectsAbove`): on its distinct authors, its thread and its board, in one read
 * however many posts the page holds, each kept on its target. A failed read leaves them undrawn: a mark is missing, never a post. `failed`, if given,
 * is called when the read of the plays failed, for a caller that reads again.
 */
export async function readAbove(api: KayfaApi, plays: Plays, characters: readonly (Id | null)[], thread: Id | null, board: Id | null, cards: ReadonlySet<string>, failed?: () => void): Promise<readonly Act[]> {
  const authors = [...new Set(characters.filter((c): c is Id => c !== null))];
  if (authors.length === 0 && thread === null && board === null) return [];
  const above = await api.effectsAbove(authors, thread, board).catch(() => { failed?.(); return []; });
  const acts = above.map((p) => p.act);
  plays.add(acts);
  await readEffects(api, plays, acts, cards);
  return acts;
}

/**
 * The kinds of Act drawn as a plain line or a System post, with no card effect around them. The thread's post (its
 * default case draws the words in `PostEffects`) and the ORIGIN box both ask `holdsEffects`, so the kinds that wear an
 * effect, and so carry marks, are one list.
 */
const WITHOUT_EFFECTS: ReadonlySet<ActKind> = new Set<ActKind>(['card', 'unmask', 'announce', 'tally', 'reveal', 'move', 'move_end', 'move_keep', 'set', 'take_back', 'spring', 'update', 'card_end', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'infraction', 'ban', 'appeal', 'appeal_ruling', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close', 'open_gift']);
export const holdsEffects = (kind: ActKind): boolean => !WITHOUT_EFFECTS.has(kind);
