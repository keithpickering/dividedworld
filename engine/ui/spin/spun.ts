/**
 * Which threads were spun from an Act, for the line under it. A page of twenty posts asks in one
 * tick, so the asks go out as `spunFromMany` reads, `SPUN_CHUNK` Acts to a read and never one read
 * per post. A busy instance can have any number of spins from one Act, so every read is ordered and
 * limited (`SPUN_READ_LIMIT` rows to a read, well under PostgREST's row cap), and what is kept per
 * Act is only the first `SPUN_SHOWN` threads and how many more there are. A read that comes back
 * as long as its limit may have cut some Act's list short, so each Act in it is asked for alone
 * (`spunFrom`, up to `SPUN_FROM_MAX`); the rest of one Act's list is read the same way on demand.
 *
 * What is remembered is bounded (the last `SPUN_CACHE_SIZE` Acts asked about) and short-lived
 * (`SPUN_TTL_MS`, so another player's spin shows on a later visit); an Act no thread was spun from
 * is remembered too, and a read that failed is not.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { SPUN_FROM_MAX, type Id, type KayfaApi, type ThreadSummary } from '../data/api.ts';

export const SPUN_CACHE_SIZE = 500;
export const SPUN_TTL_MS = 60_000;
/** Acts asked about in one read. */
export const SPUN_CHUNK = 20;
/** Rows one read of a chunk may return. */
export const SPUN_READ_LIMIT = 400;
/** Threads listed under an Act before "and N more". */
export const SPUN_SHOWN = 5;

/** The threads spun from an Act as the line shows them. */
export interface Spun {
  /** The first `SPUN_SHOWN`, oldest first. */
  readonly threads: readonly ThreadSummary[];
  /** How many more there are; at least this many when `atLeast`. */
  readonly more: number;
  /** The read stopped at its limit, so there may be still more. */
  readonly atLeast: boolean;
}

const NONE: Spun = { threads: [], more: 0, atLeast: false };

const shape = (all: readonly ThreadSummary[], saturated: boolean): Spun => ({
  threads: all.slice(0, SPUN_SHOWN),
  more: Math.max(0, all.length - SPUN_SHOWN),
  atLeast: saturated,
});

export interface SpunLoader {
  ask(act: Id): Promise<Spun>;
  /** Forget an Act's answer, after a spin from it. */
  forget(act: Id): void;
  /** What is known of an Act right now, without asking: its read answer, or the one it had before it was asked about again; null if it has none. */
  peek(act: Id): Spun | null;
}

/* `value` is set when the read lands; `prior` is the answer the Act had before it was asked about again (past its time to live), shown meanwhile so a count never falls back to none. */
interface Entry { readonly at: number; readonly promise: Promise<Spun>; value?: Spun; readonly prior?: Spun }

export function createSpunLoader(api: KayfaApi, now: () => number): SpunLoader {
  const cache = new Map<Id, Entry>();
  const queue = new Map<Id, { readonly entry: Entry; readonly resolve: (s: Spun | null) => void }>();
  let scheduled = false;

  /* A failed read forgets only its own entry: one asked for again since is another read's. */
  const failed = (id: Id, entry: Entry) => { if (cache.get(id) === entry) cache.delete(id); };

  async function alone(id: Id): Promise<Spun> {
    const all = await api.spunFrom(id);
    return shape(all, all.length >= SPUN_FROM_MAX);
  }

  function flush() {
    scheduled = false;
    const batch = [...queue];
    queue.clear();
    for (let i = 0; i < batch.length; i += SPUN_CHUNK) {
      const part = batch.slice(i, i + SPUN_CHUNK);
      let read: Promise<readonly ThreadSummary[]>;
      try { read = api.spunFromMany(part.map(([id]) => id), SPUN_READ_LIMIT); } catch (e) { read = Promise.reject(e); }
      read.then(async (threads) => {
        if (threads.length >= SPUN_READ_LIMIT) {
          /* Cut at the limit: whose lists are whole is unknown, so each is read alone. */
          await Promise.all(part.map(async ([id, { entry, resolve }]) => {
            try { resolve(await alone(id)); } catch { failed(id, entry); resolve(null); }
          }));
          return;
        }
        for (const [id, { resolve }] of part) resolve(shape(threads.filter((t) => t.originActId === id), false));
      }).catch(() => { for (const [id, { entry, resolve }] of part) { failed(id, entry); resolve(null); } });
    }
  }

  return {
    ask(act) {
      const had = cache.get(act);
      if (had && now() - had.at < SPUN_TTL_MS) return had.promise;
      let resolve!: (s: Spun | null) => void;
      const prior = had?.value ?? had?.prior;
      const promise = new Promise<Spun>((r) => { resolve = (s) => { if (s) entry.value = s; r(s ?? NONE); }; });
      const entry: Entry = { at: now(), promise, ...(prior ? { prior } : {}) };
      cache.delete(act);
      cache.set(act, entry);
      while (cache.size > SPUN_CACHE_SIZE) cache.delete(cache.keys().next().value!);
      queue.set(act, { entry, resolve });
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      return promise;
    },
    forget(act) { cache.delete(act); },
    peek(act) {
      const had = cache.get(act);
      return had?.value ?? had?.prior ?? null;
    },
  };
}

const loaders = new WeakMap<KayfaApi, SpunLoader>();
export function spunLoader(api: KayfaApi): SpunLoader {
  let l = loaders.get(api);
  if (!l) { l = createSpunLoader(api, Date.now); loaders.set(api, l); }
  return l;
}

/** How many threads were spun from an Act, as far as the line knows: the ones it lists and the more it counts. */
export const spunCount = (spun: Spun): number => spun.threads.length + spun.more;

/**
 * Ask for the threads spun from these Acts and wait for them, through the same batched, chunked reads the line uses,
 * so a page's posts and plays cost `ceil(n / SPUN_CHUNK)` reads together and the lines drawn after find them read. An
 * Act whose read failed counts as none spun.
 */
export async function primeSpun(api: KayfaApi, ids: readonly Id[]): Promise<ReadonlyMap<Id, Spun>> {
  const loader = spunLoader(api);
  const wanted = [...new Set(ids)];
  const read = await Promise.all(wanted.map((id) => loader.ask(id)));
  return new Map(wanted.map((id, i) => [id, read[i]!]));
}

/** The threads spun from an Act (none until they are read). */
export function useSpunInto(act: Id): Spun {
  const { api } = useKayfa();
  const loader = spunLoader(api);
  /* What the loader already holds is there on the first frame (the page primed it), and a stale answer stays while it is read again. */
  const [spun, setSpun] = useState<{ readonly act: Id; readonly spun: Spun }>(() => ({ act, spun: loader.peek(act) ?? NONE }));
  useEffect(() => {
    let live = true;
    void loader.ask(act).then((s) => { if (live) setSpun({ act, spun: s }); });
    return () => { live = false; };
  }, [loader, act]);
  /* Another Act than the one the state holds: what is known of it, not the last Act's. */
  return spun.act === act ? spun.spun : loader.peek(act) ?? NONE;
}

/* The thread a player was just taken to by a spin: its ORIGIN box takes focus when it opens (once). */
let expected: Id | null = null;
export const expectOrigin = (thread: Id) => { expected = thread; };
export function takeOrigin(thread: Id): boolean {
  if (expected !== thread) return false;
  expected = null;
  return true;
}
