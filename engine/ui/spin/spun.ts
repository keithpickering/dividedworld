/**
 * Which threads were spun from an Act, for the line under it. A page of twenty posts asks in one
 * tick, so the asks go out as one `spunFromMany` read and not one read per post. What is remembered
 * is bounded (the last `SPUN_CACHE_SIZE` Acts asked about) and short-lived (`SPUN_TTL_MS`, so
 * another player's spin shows on a later visit); an Act no thread was spun from is remembered too,
 * and a read that failed is not.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, KayfaApi, ThreadSummary } from '../data/api.ts';

export const SPUN_CACHE_SIZE = 500;
export const SPUN_TTL_MS = 60_000;
const CHUNK = 100;

export interface SpunLoader {
  ask(act: Id): Promise<readonly ThreadSummary[]>;
  /** Forget an Act's answer, after a spin from it. */
  forget(act: Id): void;
}

function create(api: KayfaApi, now: () => number): SpunLoader {
  const cache = new Map<Id, { readonly at: number; readonly promise: Promise<readonly ThreadSummary[]> }>();
  const queue = new Map<Id, (t: readonly ThreadSummary[] | null) => void>();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const batch = [...queue];
    queue.clear();
    for (let i = 0; i < batch.length; i += CHUNK) {
      const part = batch.slice(i, i + CHUNK);
      let read: Promise<readonly ThreadSummary[]>;
      try { read = api.spunFromMany(part.map(([id]) => id)); } catch (e) { read = Promise.reject(e); }
      read.then((threads) => {
        for (const [id, resolve] of part) resolve(threads.filter((t) => t.originActId === id));
      }, () => { for (const [id, resolve] of part) { cache.delete(id); resolve(null); } });
    }
  }

  return {
    ask(act) {
      const had = cache.get(act);
      if (had && now() - had.at < SPUN_TTL_MS) return had.promise;
      let resolve!: (t: readonly ThreadSummary[] | null) => void;
      const promise = new Promise<readonly ThreadSummary[]>((r) => { resolve = (t) => r(t ?? []); });
      cache.delete(act);
      cache.set(act, { at: now(), promise });
      while (cache.size > SPUN_CACHE_SIZE) cache.delete(cache.keys().next().value!);
      queue.set(act, resolve);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      return promise;
    },
    forget(act) { cache.delete(act); },
  };
}

const loaders = new WeakMap<KayfaApi, SpunLoader>();
export function spunLoader(api: KayfaApi): SpunLoader {
  let l = loaders.get(api);
  if (!l) { l = create(api, Date.now); loaders.set(api, l); }
  return l;
}

/** The threads spun from an Act (none until they are read). */
export function useSpunInto(act: Id): readonly ThreadSummary[] {
  const { api } = useKayfa();
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  useEffect(() => {
    let live = true;
    void spunLoader(api).ask(act).then((t) => { if (live) setThreads(t); });
    return () => { live = false; };
  }, [api, act]);
  return threads;
}
