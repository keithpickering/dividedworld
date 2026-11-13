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
import { useSyncExternalStore } from 'react';
import type { Act, ActKind, EffectState, Id, KayfaApi, SurfaceAct, SurfaceNow } from '../data/api.ts';
import type { InstanceUi } from '../types.ts';
import { BEYOND_POST, fallsOn, type BeyondPost, type CardRules } from '../../rules/cards.ts';
import type { Settings, Span } from '../../rules/types.ts';
import type { CardPlay, CardUi, CardView, KitControl } from './types.ts';
import { endsWords, keptEndedWords } from './marks.ts';
import { backoff, REPEAT_TRIES } from './tails.ts';

/** More than any card stacks on one post; a page of posts asks for this many plays per post at most. */
export const PLAYS_PER_POST = 8;

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

/**
 * The plays a post shows: all but a card back whose time has passed with nothing springing it, or that its setter took back, which is gone, as the server drops it
 * (card_target). Its end is the one the server stored when it was set (`endsAt`).
 */
export function shownPlays(plays: readonly CardPlay[], now: number): readonly CardPlay[] {
  const shown = plays.filter((p) => !(p.faceDown && !p.revealed && (p.takenBack !== undefined || backOver(p, now))));
  return shown.length === plays.length ? plays : shown;
}

/**
 * A card play, from its card Act or its set Act (a card back); null for any other Act, or a card Act with no card in it. A spring
 * is no play of its own: `Plays.add` reveals the back it names.
 */
export function playOf(act: Act): CardPlay | null {
  const beyond = act.kind === 'card' && BEYOND_POST.includes(act.payload.reach as BeyondPost) ? act.payload.reach as BeyondPost : null;
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
    ...(typeof act.payload.ends === 'string' ? { ends: act.payload.ends } : {}),
    ...(act.untaken === true ? { untaken: true as const } : {}),
    ...(typeof act.payload.drive === 'string' ? { drive: act.payload.drive } : {}),
    ...(typeof act.payload.drawn === 'string' ? { drawn: act.payload.drawn } : {}),
  };
}

/**
 * Where a play is kept and drawn: on its post, or for a play beyond a post on its target (the character, the thread or the board),
 * which the store reads by that id as it reads a post's (`Plays.get(character)`), so a postbit's, a thread head's and a banner's
 * marks are drawn as a post's are.
 */
export const homeOf = (play: Pick<CardPlay, 'post' | 'on'>): Id => play.on ?? play.post;

/**
 * The plays in force: all but a play an admin ended (`reversed`: its layer is off), a play that did not take (`untaken`: its text never
 * arrived, and it was refunded) and a play beyond a post whose end has passed (it ends on its timer, its way out). A Use's end on a post is the Lens's to say ("has ended"), so it is kept. What counts layers, offers
 * a card or pins a thread reads this; the marks and the Lens read `markedPlays`, which keeps an ended play on a post to say so.
 */
export function livePlays(plays: readonly CardPlay[], now: number): readonly CardPlay[] {
  const live = plays.filter((p) => !p.reversed && !p.untaken && !(p.reach && p.ends !== undefined && Date.parse(p.ends) <= now));
  return live.length === plays.length ? plays : live;
}

/**
 * The plays the marks and the Lens draw: `livePlays`, but a play on a post that an admin ended, or that did not take, is kept, as a caught
 * play is, so its mark and its Lens row can say "Ended by an admin" or "Didn't take". Its layer is off all the same (`livePlays`,
 * `effectsOf`, the post's effects); the marks do not count it. A play beyond a post whose time is up is dropped too, unless its card keeps (`keeps`: the keys of
 * the cards whose rules `keeps`) and it was not ended by an admin: it stays on the pages that hold a post it falls on, the only ended plays a page is given.
 */
export function markedPlays(plays: readonly CardPlay[], now: number, keeps: ReadonlySet<string> = NO_KEYS): readonly CardPlay[] {
  const marked = plays.filter((p) => !(p.reach && (p.reversed || (p.ends !== undefined && Date.parse(p.ends) <= now && !keeps.has(p.card)))));
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
  const falling = plays.filter((p) => !p.reversed && !p.untaken && fallsOn({ at: p.playedAt, ...(p.ends !== undefined ? { ends: p.ends } : {}) }, { at: post.createdAt }, keeps.has(p.card), at));
  return falling.length === plays.length ? plays : falling;
}

/** The soonest end still ahead among plays beyond a post, as an epoch, or null: when what is drawn changes next by itself. */
export function nextEnd(plays: readonly CardPlay[], now: number): number | null {
  let soonest: number | null = null;
  for (const p of plays) {
    if (!p.reach || p.ends === undefined) continue;
    const at = Date.parse(p.ends);
    if (at > now && (soonest === null || at < soonest)) soonest = at;
  }
  return soonest;
}

/** What a spring Act reveals: the set it ends and the card that was face down. */
function springOf(act: Act): { readonly set: Id; readonly card: string; readonly spring: Id; readonly at: string; readonly quadrant?: string } | null {
  if (act.kind !== 'spring' || typeof act.payload.set !== 'string' || typeof act.payload.card !== 'string') return null;
  return { set: act.payload.set, card: act.payload.card, spring: act.id, at: act.createdAt, ...(typeof act.payload.quadrant === 'string' ? { quadrant: act.payload.quadrant } : {}) };
}

/** The back a `take_back` Act ends, and when, or null for any other Act. */
const takeBackOf = (act: Act): { readonly set: Id; readonly at: string } | null =>
  act.kind === 'take_back' && typeof act.payload.set === 'string' ? { set: act.payload.set, at: act.createdAt } : null;

/** The play a `card_end` Act ends, or null for any other Act. */
const endOf = (act: Act): Id | null => (act.kind === 'card_end' && typeof act.targetActId === 'string' ? act.targetActId : null);

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
}
/** A surface play as the store holds it. */
export interface Surface extends SurfaceNow { readonly acts: readonly SurfaceAct[] | null }

const NONE: PostPlays = Object.freeze({ plays: Object.freeze([]), billed: Object.freeze([]), states: Object.freeze({}), released: new Set<Id>(), read: 0, faces: Object.freeze({}), surfaces: Object.freeze({}) });

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
 */
export function defaultView(rules: Pick<CardRules, 'name' | 'keeps'>, ui: Pick<CardUi, 'status' | 'summary' | 'describe'> | undefined, settings?: Settings, endsAt?: string, plays: readonly CardPlay[] = [], now?: number): CardView {
  const described = ui && settings ? ui.describe(settings) : '';
  const first = /^.*?[.!?](?=\s|$)/s.exec(described.trim())?.[0] ?? described.trim();
  return { progress: null, state: (typeof ui?.status === 'function' ? ui.status(plays) : ui?.status) ?? ui?.summary ?? (first || rules.name), ...(endsAt !== undefined ? { ends: rules.keeps === true && now !== undefined && Date.parse(endsAt) <= now ? keptEndedWords(endsAt) : endsWords(endsAt) } : {}), yours: false, controls: [], notes: {} };
}

export interface Plays {
  get(post: Id): PostPlays;
  /** Take in card Acts, and the `card_end` of a play (it marks its play reversed, or is held for when the play arrives); anything else is ignored. True when a play was new or ended. A play is its Act's id: the same again is the same play. */
  add(acts: readonly Act[]): boolean;
  /** Keep each play's newest saved state, by when it was saved; true when any was newer. A state for a play not here is kept for when it is. */
  setStates(states: Readonly<Record<Id, EffectState>>): boolean;
  /** Mark each of these plays reversed in place, as its `card_end` would (one not held yet is remembered, as an early `card_end` is); true when a play was marked or newly remembered. */
  setEnded(plays: readonly Id[]): boolean;
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
  const wanted = new Set<Id>();
  const issued = new Map<Id, number>();
  const taken = new Map<Id, number>();
  /* A spring that arrived before the back it reveals, kept for when it does. */
  const springs = new Map<Id, NonNullable<ReturnType<typeof springOf>>>();
  /* The backs their setters took back: a `take_back` that arrived before its back is kept here for when the back does. */
  const takenBacks = new Map<Id, string>();
  /* The plays an admin ended: a `card_end` that arrived before its play is kept here for when the play does. */
  const ended = new Set<Id>();
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
  const newer = (a: EffectState, b: EffectState) => Date.parse(a.savedAt) > Date.parse(b.savedAt);
  return {
    get(post) {
      const own = byPost.get(post);
      if (!own) return NONE;
      let snap = snapshots.get(post);
      if (!snap) {
        const plays = [...own.values()].sort(inPlayOrder);
        snap = {
          plays,
          billed: (order.get(post) ?? []).map((id) => own.get(id)!),
          states: Object.fromEntries(plays.filter((p) => states.has(p.id)).map((p) => [p.id, states.get(p.id)!])),
          released: new Set(plays.filter((p) => released.has(p.id)).map((p) => p.id)),
          read: reads.get(post) ?? 0,
          faces: Object.fromEntries(plays.filter((p) => faces.has(p.id)).map((p) => [p.id, faces.get(p.id)!])),
          surfaces: Object.fromEntries(plays.filter((p) => surfaces.has(p.id)).map((p) => [p.id, surfaces.get(p.id)!])),
        };
        snapshots.set(post, snap);
      }
      return snap;
    },
    add(acts) {
      const touched = new Set<Id>();
      for (const act of acts) {
        /* A spring reveals its back in place: the same play, keeping its place in the billing, so no mark moves. */
        const sprung = springOf(act);
        if (sprung) {
          springs.set(sprung.set, sprung);
          const post = postOf.get(sprung.set);
          const own = post === undefined ? undefined : byPost.get(post);
          const back = own?.get(sprung.set);
          if (own && back && !back.revealed) {
            own.set(back.id, { ...back, card: sprungKind(sprung.spring), revealed: { card: sprung.card, spring: sprung.spring, at: sprung.at, ...(sprung.quadrant !== undefined ? { quadrant: sprung.quadrant } : {}) } });
            touched.add(homeOf(back));
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
          const home = postOf.get(target);
          const own = home === undefined ? undefined : byPost.get(home);
          const was = own?.get(target);
          if (own && was && !was.reversed) {
            own.set(target, { ...was, reversed: true });
            touched.add(home!);
          }
          continue;
        }
        const found = playOf(act);
        if (!found) continue;
        const early = found.faceDown ? springs.get(found.id) : undefined;
        const withSpring = early ? { ...found, card: sprungKind(early.spring), revealed: { card: early.card, spring: early.spring, at: early.at, ...(early.quadrant !== undefined ? { quadrant: early.quadrant } : {}) } } : found;
        const takenAt = found.faceDown ? takenBacks.get(found.id) : undefined;
        const withTaken = takenAt ? { ...withSpring, takenBack: { at: takenAt } } : withSpring;
        const play = ended.has(found.id) ? { ...withTaken, reversed: true as const } : withTaken;
        const home = homeOf(play);
        const own = byPost.get(home) ?? new Map<Id, CardPlay>();
        /* A play already held is the same play, with one change it can learn: that it did not take (`untaken`, 0149), set in place so its place in the billing stays. */
        const held = own.get(play.id);
        if (held) {
          if (play.untaken && !held.untaken) { own.set(play.id, { ...held, untaken: true as const }); touched.add(home); }
          continue;
        }
        own.set(play.id, play);
        byPost.set(home, own);
        order.set(home, [...(order.get(home) ?? []), play.id]);
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
      }
      changed(touched);
      return remembered || touched.size > 0;
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
 * result as long as the limit may be cut (`KayfaApi.cardsOnMany`). A failed read leaves the posts
 * as they are drawn without it: a tag is missing, never a post.
 */
export async function readPlays(api: KayfaApi, plays: Plays, posts: readonly Id[], cards: ReadonlySet<string>): Promise<readonly Act[]> {
  if (posts.length === 0) return [];
  const acts = await api.cardsOnMany(posts, posts.length * PLAYS_PER_POST).catch((): readonly Act[] => []);
  plays.add(acts);
  await readEffects(api, plays, acts, cards);
  /* The plays' ends ride in the read for the store; they are no plays, so no tally, reaction or caster is read for one. */
  return acts.filter((a) => a.kind !== 'card_end');
}

/**
 * Take a screen document's plays, with their saved states and the reader's releases, into the store with no read (the forum-load plan,
 * Task 13): the document holds what `readPlays`, `readAbove` and `readEffects` would have asked for. `faces` are the reader's own card
 * backs' cards, by set. The states and releases are the document's for the cards the instance draws an effect for.
 */
export function hydrate(plays: Plays, acts: readonly Act[], states: Readonly<Record<Id, EffectState>>, releases: readonly Id[], faces: Readonly<Record<Id, string>> = {}, surfaces: Readonly<Record<Id, SurfaceNow>> = {}): void {
  plays.add(acts);
  plays.setStates(states);
  plays.setReleased(releases);
  plays.setFaces(faces);
  plays.setSurfaces(surfaces);
}

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
 * however many posts the page holds, each kept on its target. A failed read leaves them undrawn: a mark is missing, never a post.
 */
export async function readAbove(api: KayfaApi, plays: Plays, characters: readonly (Id | null)[], thread: Id | null, board: Id | null, cards: ReadonlySet<string>): Promise<readonly Act[]> {
  const authors = [...new Set(characters.filter((c): c is Id => c !== null))];
  if (authors.length === 0 && thread === null && board === null) return [];
  const above = await api.effectsAbove(authors, thread, board).catch(() => []);
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
const WITHOUT_EFFECTS: ReadonlySet<ActKind> = new Set<ActKind>(['card', 'unmask', 'announce', 'tally', 'reveal', 'move', 'move_end', 'move_keep', 'set', 'take_back', 'spring', 'update', 'card_end', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'infraction', 'ban', 'appeal', 'appeal_ruling', 'donation', 'draw', 'wash']);
export const holdsEffects = (kind: ActKind): boolean => !WITHOUT_EFFECTS.has(kind);
