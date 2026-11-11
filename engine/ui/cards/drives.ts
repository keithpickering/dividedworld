/**
 * The gifts of the drives on a page, read for them all together and kept per api (docs/plans/2026-11-03-jimmy-wails-plan.md, Task 5), as
 * the tails of a page are (tails.ts). A drive watched is read in one `api.driveGifts` call with every other watched in the same tick (a page
 * of posts renders in one commit, so its effects all run before the next microtask), in chunks of at most `DRIVES_PER_READ`, which is what the
 * server holds a call to: never one request per drive ("Weigh a design at the scale of a busy instance"). A page with no drive card is
 * never read.
 *
 * Live: the thread's channel sends a gift as its `donation` Act (the same Act on every reader's screen), which adds to its drive's total,
 * count and latest gifts without a read. Every gift is kept by its id, so the giver's own answer (`add`) and the broadcast of the same gift
 * are one gift. A gift heard before the first read lands is held, and applied after it only if the read did not already count it: it
 * is newer than every gift the read returned. A read that fails is tried again after `backoff`, at most `REPEAT_TRIES` times.
 *
 * Nothing here depends on who is reading: a total, a count and the gifts' characters are the same for every reader (drive_gifts), so no
 * request, event or timing proves a private fact.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { spanMs, type CardRules } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Act, DriveGift, Id, KayfaApi } from '../data/api.ts';
import { backoff, REPEAT_TRIES } from './tails.ts';
import type { CardPlay } from './types.ts';

/** The most drives one read asks about: what `drive_gifts` holds a call to. */
export const DRIVES_PER_READ = 100;

/** What the page knows of one drive's gifts. */
export interface Gifts {
  /** The first read has landed: the numbers are the drive's, and not yet zeros for want of a read. */
  readonly loaded: boolean;
  readonly total: number;
  readonly count: number;
  /** Newest first by (time, id), the order the wall is read in. */
  readonly gifts: readonly DriveGift[];
}

export interface DriveStore {
  /** Watch a drive of a thread: read it now if nobody was watching it, and hear its gifts. Returns the way to stop. */
  watch(drive: Id, thread: Id): () => void;
  get(drive: Id): Gifts;
  subscribe(drive: Id, listener: () => void): () => void;
  /** Add a gift the reader's own answer carried: counted once, whether or not the broadcast of it has been heard. */
  add(drive: Id, gift: DriveGift): void;
  /** Read the page of a drive's wall after the oldest gift shown, and append it. */
  more(drive: Id): Promise<void>;
}

interface Held {
  state: Gifts;
  /** Every gift id counted or held, so a gift heard twice, or answered and then heard, counts once. */
  seen: Set<Id>;
  /** Gifts heard before the first read landed. */
  heard: DriveGift[];
  watching: number;
  tries: number;
  paging: boolean;
}

const UNREAD: Gifts = Object.freeze({ loaded: false, total: 0, count: 0, gifts: Object.freeze([]) as readonly DriveGift[] });
const stores = new WeakMap<KayfaApi, DriveStore>();

/** Newest first by (time, id), the order of the wall (the server's keyset). */
const newer = (a: DriveGift, b: DriveGift): number => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** A gift from the Act that announced it, or null for an Act that is no gift. */
export function giftOf(act: Act): { readonly drive: Id; readonly gift: DriveGift } | null {
  const amount = act.payload.amount;
  if (act.kind !== 'donation' || act.targetActId === null || typeof amount !== 'number') return null;
  return { drive: act.targetActId, gift: { id: act.id, character: act.character, name: null, amount, at: act.createdAt } };
}

/** A card's drive rules, by the card's key. */
export type DriveRules = ReadonlyMap<string, NonNullable<CardRules['drive']>>;

/** One drive of a card on a post, as the plays make it: the plays still up, in play order, and when it closes (epoch ms). */
export interface PlayedDrive {
  readonly id: Id;
  readonly card: string;
  readonly plays: readonly CardPlay[];
  readonly closes: number;
  readonly open: boolean;
}

/**
 * Which plays make a drive, and what a drive is of them. This is the ONE place on the client that says so, as `drive_plays` and `place_cast`
 * are the one place on the server (supabase/migrations/0152_drives.sql); the owner's question #447 (does an ended play still hold its drive?)
 * changes this function and drive_plays and nothing else. A drive's plays are its card's plays on the post that are not caught and not ended
 * (an admin's end, `reversed`; a refund, `untaken`; a passed `ends`), and a play at the post, not beyond it (`reach`); a card back is no play
 * (`faceDown`). A play's drive is the one its payload names, or its own id when it names none. A drive closes `lasts` after its latest play
 * still up, and is open while that is ahead of `now`. Drives come in the order each was first played.
 */
export function drivesOfPlays(plays: readonly CardPlay[], rules: DriveRules, now: number): readonly PlayedDrive[] {
  const grouped = new Map<Id, CardPlay[]>();
  for (const p of plays) {
    if (!rules.has(p.card) || p.caught !== undefined || p.reversed || p.untaken || p.faceDown || p.reach) continue;
    if (p.ends !== undefined && Date.parse(p.ends) <= now) continue;
    const id = p.drive ?? p.id;
    grouped.set(id, [...(grouped.get(id) ?? []), p]);
  }
  return [...grouped].map(([id, own]) => {
    const closes = Math.max(...own.map((p) => Date.parse(p.playedAt))) + spanMs(rules.get(own[0]!.card)!.lasts);
    return { id, card: own[0]!.card, plays: own, closes, open: closes > now };
  });
}

export function driveStore(api: KayfaApi): DriveStore {
  const had = stores.get(api);
  if (had) return had;
  const held = new Map<Id, Held>();
  const threads = new Map<Id, { count: number; off: () => void }>();
  const listeners = new Map<Id, Set<() => void>>();
  const queue = new Set<Id>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let scheduled = false;

  const notify = (drive: Id) => { for (const l of [...(listeners.get(drive) ?? [])]) l(); };

  /*
   * A gift heard on the channel (or answered to the reader) is an Act, which carries its giver's id and no name; a giver's name is public, so it is
   * read from `characters` the way the thread names a live poster, once for each giver however many gifts, and set on every gift of theirs held. A read
   * that fails leaves the name null, and the wall falls back to the thread's own naming.
   */
  const known = new Map<Id, string>();
  const asked = new Set<Id>();
  const naming = new Set<Id>();
  let namingScheduled = false;
  const named = (gift: DriveGift): DriveGift => (gift.name === null && gift.character !== null && known.has(gift.character) ? { ...gift, name: known.get(gift.character)! } : gift);
  function learn(gift: DriveGift) {
    if (gift.name !== null && gift.character !== null) known.set(gift.character, gift.name);
  }
  function nameUnknown() {
    namingScheduled = false;
    const ids = [...naming];
    naming.clear();
    let read: Promise<readonly { readonly id: Id; readonly name: string }[]>;
    try { read = api.characters(ids); } catch (e) { read = Promise.reject(e); }
    read.then((rows) => {
      for (const r of rows) known.set(r.id, r.name);
      for (const [drive, own] of held) {
        const before = own.state.gifts;
        const after = before.map(named);
        own.heard = own.heard.map(named);
        if (after.some((g, i) => g !== before[i])) { own.state = { ...own.state, gifts: after }; notify(drive); }
      }
    }, () => { /* the names stay null */ });
  }
  /** A gift with no name yet: its giver's name is asked for, once. */
  function wantName(gift: DriveGift) {
    if (gift.name !== null || gift.character === null || known.has(gift.character) || asked.has(gift.character)) return;
    asked.add(gift.character);
    naming.add(gift.character);
    if (!namingScheduled) { namingScheduled = true; queueMicrotask(nameUnknown); }
  }

  /** A counted gift: the numbers move and the gift takes its place in the wall. */
  function count(own: Held, gift: DriveGift) {
    own.state = { loaded: true, total: own.state.total + gift.amount, count: own.state.count + 1, gifts: [...own.state.gifts, gift].sort(newer) };
  }
  function addGift(drive: Id, heard: DriveGift) {
    const own = held.get(drive);
    if (!own || own.seen.has(heard.id)) return;
    own.seen.add(heard.id);
    const gift = named(heard);
    wantName(gift);
    if (!own.state.loaded) { own.heard.push(gift); return; }
    count(own, gift);
    notify(drive);
  }

  function flush() {
    scheduled = false;
    const drives = [...queue];
    queue.clear();
    for (let i = 0; i < drives.length; i += DRIVES_PER_READ) {
      const chunk = drives.slice(i, i + DRIVES_PER_READ);
      const done = (rows: Awaited<ReturnType<KayfaApi['driveGifts']>> | null) => {
        for (const id of chunk) {
          const own = held.get(id);
          if (!own || own.state.loaded) continue;
          const row = rows?.find((r) => r.id === id);
          if (!row) {
            /* A read that failed leaves the drive unread, and is asked again after a wait, a handful of times. */
            if (own.watching > 0 && own.tries + 1 < REPEAT_TRIES) {
              const wait = backoff(own.tries++);
              const timer = setTimeout(() => { timers.delete(timer); if ((held.get(id)?.watching ?? 0) > 0) refresh(id); }, wait);
              timers.add(timer);
            }
            continue;
          }
          own.tries = 0;
          for (const g of row.gifts) learn(g);
          const newest = row.gifts[0];
          own.state = { loaded: true, total: row.total, count: row.count, gifts: row.gifts };
          for (const g of row.gifts) own.seen.add(g.id);
          /* A gift heard before this read is in it unless it is newer than everything the read returned. */
          for (const g of own.heard.sort(newer).reverse()) if (!newest || newer(g, newest) < 0) count(own, named(g));
          own.heard = [];
          notify(id);
        }
      };
      let read: ReturnType<KayfaApi['driveGifts']>;
      try { read = api.driveGifts(chunk); } catch (e) { read = Promise.reject(e); }
      read.then(done, () => done(null));
    }
  }
  const refresh = (drive: Id) => {
    queue.add(drive);
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  };

  /* One subscription per thread however many drives watch it; let go a tick after the last watch ends, so a watch renewed in the same commit never closes and reopens the channel. */
  const hear = (thread: Id) => {
    let t = threads.get(thread);
    if (!t) {
      t = {
        count: 0,
        off: api.subscribeThread(thread, {
          onAct(act) {
            const heard = giftOf(act);
            if (heard) addGift(heard.drive, heard.gift);
          },
        }),
      };
      threads.set(thread, t);
    }
    t.count += 1;
    const mine = t;
    return () => {
      mine.count -= 1;
      queueMicrotask(() => {
        if (mine.count === 0 && threads.get(thread) === mine) { threads.delete(thread); mine.off(); }
      });
    };
  };

  const store: DriveStore = {
    watch(drive, thread) {
      const own = held.get(drive) ?? { state: UNREAD, seen: new Set<Id>(), heard: [], watching: 0, tries: 0, paging: false };
      held.set(drive, own);
      const release = hear(thread);
      own.watching += 1;
      if (!own.state.loaded) refresh(drive);
      let on = true;
      return () => {
        if (!on) return;
        on = false;
        own.watching -= 1;
        release();
        if (own.watching === 0) {
          /* Unwatched, the numbers stop being kept live, so the next watch reads them again. */
          held.delete(drive);
        }
      };
    },
    get: (drive) => held.get(drive)?.state ?? UNREAD,
    subscribe(drive, listener) {
      const set = listeners.get(drive) ?? new Set();
      listeners.set(drive, set.add(listener));
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(drive) === set) listeners.delete(drive);
      };
    },
    add: addGift,
    async more(drive) {
      const own = held.get(drive);
      if (!own || own.paging || !own.state.loaded) return;
      const last = own.state.gifts[own.state.gifts.length - 1];
      if (!last || own.state.gifts.length >= own.state.count) return;
      own.paging = true;
      try {
        const page = await api.driveGiftsPage(drive, { at: last.at, id: last.id });
        const now = held.get(drive);
        if (now !== own) return;
        for (const g of page.gifts) learn(g);
        const fresh = page.gifts.filter((g) => !own.seen.has(g.id));
        for (const g of fresh) own.seen.add(g.id);
        /* These are older gifts the total already holds: they join the wall and move no number. */
        own.state = { ...own.state, gifts: [...own.state.gifts, ...fresh].sort(newer) };
        notify(drive);
      } catch { /* the wall stays as it was, and `more` still says there are older gifts */ } finally { own.paging = false; }
    },
  };
  stores.set(api, store);
  return store;
}

/**
 * The gifts of the drives on a post (its card's), redrawn when they are read or change: zeros, `loaded: false`, until the first read lands.
 * One watch per drive however many posts ask, and the page's drives are one read (`DRIVES_PER_READ` to a call).
 */
export function useDriveGifts(thread: Id, drives: readonly Id[]): ReadonlyMap<Id, Gifts> {
  const { api } = useKayfa();
  const store = driveStore(api);
  const key = drives.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids are what `key` says; a new array of the same ids is no change
  const ids = useMemo(() => drives, [key]);
  /* Only the ids that came or went are watched or let go: a drive that stays keeps its numbers and its loaded pages. */
  const offs = useRef(new Map<Id, () => void>());
  useEffect(() => {
    const held = offs.current;
    for (const [d, off] of held) if (!ids.includes(d)) { off(); held.delete(d); }
    for (const d of ids) if (!held.has(d)) held.set(d, store.watch(d, thread));
  }, [store, thread, ids]);
  /* Everything is let go when the page leaves, or moves to another thread, whose watches are not these. */
  useEffect(() => () => { for (const off of offs.current.values()) off(); offs.current.clear(); }, [store, thread]);
  const subscribe = useMemo(() => (l: () => void) => { const offs = ids.map((d) => store.subscribe(d, l)); return () => { for (const off of offs) off(); }; }, [store, ids]);
  /* A snapshot must be stable between changes: one string of the numbers drives it, and the map is built from the store's own rows. */
  const snapshot = useSyncExternalStore(subscribe, () => ids.map((d) => store.get(d)).map((g) => `${g.loaded}:${g.total}:${g.count}:${g.gifts.length}:${g.gifts[0]?.id ?? ''}:${g.gifts.filter((x) => x.name !== null).length}`).join('|'));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `snapshot` says when a row changed
  return useMemo(() => new Map(ids.map((d) => [d, store.get(d)] as const)), [store, ids, snapshot]);
}
