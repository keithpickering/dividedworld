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
import type { Act, ActKind, EffectState, Id, KayfaApi } from '../data/api.ts';
import type { InstanceUi } from '../types.ts';
import type { CardRules } from '../../rules/cards.ts';
import type { Settings } from '../../rules/types.ts';
import type { CardPlay, CardUi, CardView, KitControl } from './types.ts';

/** More than any card stacks on one post; a page of posts asks for this many plays per post at most. */
export const PLAYS_PER_POST = 8;

/** A card play, from its card Act; null for any other Act, or a card Act with no card in it. */
export function playOf(act: Act): CardPlay | null {
  if (act.kind !== 'card' || act.targetActId === null || typeof act.payload.card !== 'string') return null;
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
    post: act.targetActId,
  };
}

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
}

const NONE: PostPlays = Object.freeze({ plays: Object.freeze([]), billed: Object.freeze([]), states: Object.freeze({}), released: new Set<Id>(), read: 0 });

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
  return a.progress === b.progress && a.state === b.state && a.ends === b.ends && a.yours === b.yours && a.report === b.report
    && sameEntries(a.notes, b.notes) && a.controls.length === b.controls.length && a.controls.every((c, i) => sameControl(c, b.controls[i]!));
}

/**
 * The engine's view for a card with no effect, or before its effect has said anything: its State is the card's `summary`,
 * else the first sentence of what `describe` says under `settings`, else (no settings to describe under) its name; no
 * edge, no notch, no controls.
 */
export function defaultView(rules: Pick<CardRules, 'name'>, ui: Pick<CardUi, 'summary' | 'describe'> | undefined, settings?: Settings): CardView {
  const described = ui && settings ? ui.describe(settings) : '';
  const first = /^.*?[.!?](?=\s|$)/s.exec(described.trim())?.[0] ?? described.trim();
  return { progress: null, state: ui?.summary ?? (first || rules.name), yours: false, controls: [], notes: {} };
}

export interface Plays {
  get(post: Id): PostPlays;
  /** Take in card Acts (anything else is ignored); true when a play was new. A play is its Act's id: the same again is the same play. */
  add(acts: readonly Act[]): boolean;
  /** Keep each play's newest saved state, by when it was saved; true when any was newer. A state for a play not here is kept for when it is. */
  setStates(states: Readonly<Record<Id, EffectState>>): boolean;
  /** The reader released themselves from these plays. */
  setReleased(plays: readonly Id[]): boolean;
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
  /**
   * @deprecated Going with the notes: the panel that reads them is removed in Task 4 and Whoops! moves to `CardView.notes` in Task 6.
   * The card's line about a play's state on this screen (design, section 4), or null; never saved or sent. */
  note(play: Id): string | null;
  /**
   * @deprecated Going with `note` (Tasks 4 and 6).
   * Set or clear (null) a play's line. It wakes the play's post and leaves the post's snapshot as it was, so a note
   * written while an effect runs draws only what reads it (`useNote`), never the effects or the post's words.
   */
  setNote(play: Id, line: string | null): void;
  subscribe(post: Id, listener: () => void): () => void;
}

export function createPlays(): Plays {
  const byPost = new Map<Id, Map<Id, CardPlay>>();
  const postOf = new Map<Id, Id>();
  const states = new Map<Id, EffectState>();
  const released = new Set<Id>();
  /* Each post's billing order, by play id: set by a read of its page, with a play that arrives later appended. */
  const order = new Map<Id, readonly Id[]>();
  const notes = new Map<Id, string>();
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
        };
        snapshots.set(post, snap);
      }
      return snap;
    },
    add(acts) {
      const touched = new Set<Id>();
      for (const act of acts) {
        const play = playOf(act);
        if (!play) continue;
        const own = byPost.get(play.post) ?? new Map<Id, CardPlay>();
        if (own.has(play.id)) continue;
        own.set(play.id, play);
        byPost.set(play.post, own);
        order.set(play.post, [...(order.get(play.post) ?? []), play.id]);
        postOf.set(play.id, play.post);
        touched.add(play.post);
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
    note: (play) => notes.get(play) ?? null,
    setNote(play, line) {
      if ((notes.get(play) ?? null) === line) return;
      if (line === null) notes.delete(play); else notes.set(play, line);
      const post = postOf.get(play);
      if (post !== undefined) for (const l of [...(listeners.get(post) ?? [])]) l();
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

/** @deprecated Going with the notes (Tasks 4 and 6). A play's note (`Plays.note`): what reads it is drawn again when it changes, and nothing else is. */
export function useNote(plays: Plays, post: Id, play: Id): string | null {
  return useSyncExternalStore((l) => plays.subscribe(post, l), () => plays.note(play));
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
  return acts;
}

/**
 * The kinds of Act drawn as a plain line or a System post, with no card effect around them. The thread's post (its
 * default case draws the words in `PostEffects`) and the ORIGIN box both ask `holdsEffects`, so the kinds that wear an
 * effect and the kinds that hold its slot are one list.
 */
const WITHOUT_EFFECTS: ReadonlySet<ActKind> = new Set<ActKind>(['card', 'unmask', 'tally', 'reveal']);
export const holdsEffects = (kind: ActKind): boolean => !WITHOUT_EFFECTS.has(kind);
