/**
 * The tails of the posts on a page, read for them all together and kept per api (docs/plans/2026-11-07-you-were-saying-design.md, sections
 * 3, 4 and 15). A post with a play of a card that writes (`CardRules.writes`) is watched, and every post watched in one tick of the page (a
 * page of posts renders in one commit, so its effects all run before the next microtask) is read in one `api.tails` call, in chunks of at
 * most `TAILS_PER_READ`, which is what the server holds a call to: never one request per post ("Weigh a design at the scale of a busy
 * instance"). A post none of whose plays writes is never watched, so a page with no writing play costs no request.
 *
 * Every row of every version is kept, so the live post (`resolveWritten`, mode `current`), its History and a moment all read the one answer.
 * The thread's `card_text` event names a play and a version and nothing else: the play is mapped to the post that holds it among those
 * watched, and that one post is read again; a play the page does not hold is ignored. A post edited since it was read, or given a new
 * play, is read again by its next watch, since an edit queues a new generation that no event announces until it is made.
 *
 * An event can be missed (a post watched, left and come back to after the text came; a channel that dropped; a read that failed), so the first
 * watch of a post nobody is watching always reads, and while a watched post holds a waiting row, or its last read failed, the page reads those
 * posts again on one slow timer: one batched call for all of them, `POLL_FIRST` after the last read and backing off to `POLL_LAST`, stopped as
 * soon as none is left to ask about or nothing is watched, and held while the document is hidden. Its cost is bounded by the pages that are
 * showing a waiting cursor, and a regeneration waits for edits to settle by design, so a waiting row can last a minute or two.
 * The rows of posts nobody watches are kept for a remount in the same navigation, and dropped oldest first beyond `HELD_POSTS`.
 *
 * Nothing here depends on who is reading: the rows are the same for every reader (post_tails), so no request, event or timing proves a private fact.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, KayfaApi, Tail } from '../data/api.ts';

/** The most posts one read asks about: what `post_tails` holds a call to. */
export const TAILS_PER_READ = 200;
/** How long after a read a waiting (or failed) post is asked about again, and the most that wait grows to (it doubles each time). */
export const POLL_FIRST = 5_000;
export const POLL_LAST = 30_000;
/** The wait before try number `attempt` (0 for the first) after a read failed: `POLL_FIRST`, doubling, never past `POLL_LAST`. The one policy for every read this file's readers repeat. */
export const backoff = (attempt: number): number => Math.min(POLL_FIRST * 2 ** attempt, POLL_LAST);
/** The most tries of a read the page repeats on its own before it waits for the next event. */
export const REPEAT_TRIES = 5;
/** The most posts whose rows the store keeps once nobody watches them. */
export const HELD_POSTS = 500;

export interface TailStore {
  /**
   * Watch a post for the plays on it that write: read its tails now if nobody was watching it, or it has not been read for this edit
   * (`stamp`, the post's `editedAt`; a stamp no newer than the one held is the same edit, so a moment naming an older version never
   * invalidates the live post's read) and these plays, and again whenever the thread announces one of the plays' texts. Returns the way to stop. No plays, no watch.
   */
  watch(post: Pick<Act, 'id' | 'thread'>, plays: readonly Id[], stamp: string | null): () => void;
  /** Every row the post has, oldest version first; empty until the first read lands (and where no play has one). */
  rows(post: Id): readonly Tail[];
  subscribe(post: Id, listener: () => void): () => void;
}

interface Held {
  rows: readonly Tail[];
  /** What the latest read asked for: the plays it knew and the post's edit then; a watch that adds to either reads again. */
  asked: { readonly plays: ReadonlySet<Id>; readonly stamp: string | null } | null;
  /** The number of the newest read whose answer was kept: an older read that lands later is dropped. */
  applied: number;
  /** The watches on the post now. */
  watching: number;
  /** The latest read of the post failed and none has landed since. */
  failed: boolean;
}

const NONE: readonly Tail[] = Object.freeze([]);
const stores = new WeakMap<KayfaApi, TailStore>();

export function tailStore(api: KayfaApi): TailStore {
  const had = stores.get(api);
  if (had) return had;
  const held = new Map<Id, Held>();
  const listeners = new Map<Id, Set<() => void>>();
  const watchers = new Set<{ readonly post: Id; readonly thread: Id; readonly plays: readonly Id[] }>();
  const threads = new Map<Id, { count: number; off: () => void }>();
  const queue = new Set<Id>();
  let scheduled = false;
  let reads = 0;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollDelay = POLL_FIRST;
  let listening = false;

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  /** The posts watched that hold a waiting row or whose last read failed: what the timer asks about. */
  const unsettled = (): Id[] => [...held].filter(([, h]) => h.watching > 0 && (h.failed || h.rows.some((r) => r.waiting))).map(([id]) => id);
  const onVisibility = () => {
    if (visible()) { syncPoll(); return; }
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
  };
  function stopPoll() {
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    pollDelay = POLL_FIRST;
    if (listening) { document.removeEventListener('visibilitychange', onVisibility); listening = false; }
  }
  function syncPoll() {
    if (unsettled().length === 0) { stopPoll(); return; }
    if (!listening && typeof document !== 'undefined') { document.addEventListener('visibilitychange', onVisibility); listening = true; }
    if (pollTimer === null && visible()) pollTimer = setTimeout(tick, pollDelay);
  }
  function tick() {
    pollTimer = null;
    if (!visible()) return;
    const ids = unsettled();
    if (ids.length === 0) { stopPoll(); return; }
    for (const id of ids) refresh(id);
    pollDelay = Math.min(pollDelay * 2, POLL_LAST);
    syncPoll();
  }
  /** Let go of the oldest posts nobody watches, past `HELD_POSTS`. */
  function evict() {
    for (const [id, h] of held) {
      if (held.size <= HELD_POSTS) return;
      if (h.watching === 0) held.delete(id);
    }
  }

  const notify = (post: Id) => { for (const l of [...(listeners.get(post) ?? [])]) l(); };

  function flush() {
    scheduled = false;
    const posts = [...queue];
    queue.clear();
    for (let i = 0; i < posts.length; i += TAILS_PER_READ) {
      const chunk = posts.slice(i, i + TAILS_PER_READ);
      const number = ++reads;
      const done = (rows: readonly Tail[] | null) => {
        for (const id of chunk) {
          const own = held.get(id);
          if (!own) continue;
          /* A read that failed leaves the post as it was and is asked again by the timer, the next watch or an event. */
          if (rows === null) { if (own.applied < number) { own.asked = null; own.failed = true; } continue; }
          if (number < own.applied) continue;
          own.applied = number;
          own.failed = false;
          own.rows = rows.filter((r) => r.post === id);
          notify(id);
        }
        syncPoll();
      };
      let read: Promise<readonly Tail[]>;
      try { read = api.tails(chunk); } catch (e) { read = Promise.reject(e); }
      read.then(done, () => done(null));
    }
  }
  const refresh = (post: Id) => {
    queue.add(post);
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  };

  /* One subscription per thread however many posts watch it; let go a tick after the last watch ends, so a watch renewed in the same commit never closes and reopens the channel. */
  const hear = (thread: Id) => {
    let t = threads.get(thread);
    if (!t) {
      t = {
        count: 0,
        off: api.subscribeThread(thread, {
          onText(play) {
            const owner = [...watchers].find((w) => w.thread === thread && w.plays.includes(play));
            if (owner) refresh(owner.post);
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

  const store: TailStore = {
    watch(post, plays, stamp) {
      if (plays.length === 0) return () => {};
      const watcher = { post: post.id, thread: post.thread, plays: [...plays] };
      watchers.add(watcher);
      const release = hear(post.thread);
      const own = held.get(post.id) ?? { rows: NONE, asked: null, applied: 0, watching: 0, failed: false };
      /* Most recently watched last, so `evict` drops the longest-forgotten first. */
      held.delete(post.id);
      held.set(post.id, own);
      const unwatched = own.watching === 0;
      own.watching += 1;
      const askedBefore = own.asked;
      const same = askedBefore !== null && (stamp === null || (askedBefore.stamp !== null && stamp <= askedBefore.stamp));
      if (unwatched || !same || !plays.every((p) => askedBefore!.plays.has(p))) {
        const newest = askedBefore?.stamp != null && (stamp === null || askedBefore.stamp > stamp) ? askedBefore.stamp : stamp;
        own.asked = { plays: new Set([...(askedBefore?.plays ?? []), ...plays]), stamp: newest };
        refresh(post.id);
      }
      evict();
      syncPoll();
      let on = true;
      return () => {
        if (!on) return;
        on = false;
        watchers.delete(watcher);
        own.watching -= 1;
        release();
        syncPoll();
      };
    },
    rows: (post) => held.get(post)?.rows ?? NONE,
    subscribe(post, listener) {
      const set = listeners.get(post) ?? new Set();
      listeners.set(post, set.add(listener));
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(post) === set) listeners.delete(post);
      };
    },
  };
  stores.set(api, store);
  return store;
}

/**
 * The tails of a post, for the plays on it that write (empty where there are none, and the post is then never read), redrawn when they are
 * read or read again. Empty until the first read lands.
 */
export function useTails(post: Pick<Act, 'id' | 'thread' | 'editedAt'>, plays: readonly Id[]): readonly Tail[] {
  const { api } = useKayfa();
  const store = tailStore(api);
  const key = plays.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids are what `key` says; a new array of the same ids is no change
  const ids = useMemo(() => plays, [key]);
  useEffect(() => store.watch(post, ids, post.editedAt), [store, post.id, post.thread, post.editedAt, ids]);
  return useSyncExternalStore((l) => store.subscribe(post.id, l), () => store.rows(post.id));
}
