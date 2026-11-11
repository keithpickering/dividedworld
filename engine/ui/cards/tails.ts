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
 * Nothing here depends on who is reading: the rows are the same for every reader (post_tails), so no request, event or timing proves a private fact.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, KayfaApi, Tail } from '../data/api.ts';

/** The most posts one read asks about: what `post_tails` holds a call to. */
export const TAILS_PER_READ = 200;

export interface TailStore {
  /**
   * Watch a post for the plays on it that write: read its tails now if it has not been read for this edit (`stamp`, the post's `editedAt`)
   * and these plays, and again whenever the thread announces one of the plays' texts. Returns the way to stop. No plays, no watch.
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
          /* A read that failed leaves the post as it was and is asked again by the next watch or event. */
          if (rows === null) { if (own.applied < number) own.asked = null; continue; }
          if (number < own.applied) continue;
          own.applied = number;
          own.rows = rows.filter((r) => r.post === id);
          notify(id);
        }
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
      const own = held.get(post.id) ?? { rows: NONE, asked: null, applied: 0 };
      held.set(post.id, own);
      const fresh = own.asked !== null && own.asked.stamp === stamp && plays.every((p) => own.asked!.plays.has(p));
      if (!fresh) {
        own.asked = { plays: new Set([...(own.asked?.plays ?? []), ...plays]), stamp };
        refresh(post.id);
      }
      return () => { watchers.delete(watcher); release(); };
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
