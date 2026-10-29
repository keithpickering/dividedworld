/**
 * Where an Act is: its thread and seq, so a quote, a card or an origin can link to it. An Act on
 * the screen is found at once from the thread's own index; any other is read by id, and the link
 * is never a guess.
 *
 * The reads are batched: every id asked for in one tick of the page (a page of twenty quotes
 * renders in one commit, so its effects all run before the next microtask) goes in one
 * `actsById` call, and so does the author of each Act a tally lands on from another page. What is
 * remembered is bounded, to the last `ACT_CACHE_SIZE` Acts asked about, the least recently asked
 * forgotten first, so a long session on a busy instance holds a few hundred small records and not
 * every Act it ever met. An answer is remembered when the read succeeded, "no such Act" included
 * (an Act that is not there now is not asked about again on every render); a read that failed is
 * not, so the next render that wants it asks again.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, KayfaApi } from '../data/api.ts';

export interface Located { readonly thread: Id; readonly seq: number }

/** The thread's own index of the Acts on screen. */
export const ActIndex = createContext<(id: Id) => Located | undefined>(() => undefined);

/** What is kept of an Act read by id. */
export interface Known { readonly thread: Id; readonly seq: number | null; readonly character: Id | null }

/** How many Acts' answers are remembered. */
export const ACT_CACHE_SIZE = 500;
/** The most ids in one read, so an address stays short. */
const CHUNK = 100;

export interface ActLoader {
  /** The Act, or null when there is no such Act (or the read failed). */
  ask(id: Id): Promise<Known | null>;
}

function createLoader(api: KayfaApi): ActLoader {
  const cache = new Map<Id, Promise<Known | null>>();
  const queue = new Map<Id, { readonly promise: Promise<Known | null>; readonly resolve: (k: Known | null) => void }>();
  let scheduled = false;

  const remember = (id: Id, p: Promise<Known | null>) => {
    cache.delete(id);
    cache.set(id, p);
    while (cache.size > ACT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
  };

  function flush() {
    scheduled = false;
    const batch = [...queue];
    queue.clear();
    for (let i = 0; i < batch.length; i += CHUNK) {
      const part = batch.slice(i, i + CHUNK);
      const done = (answer: (id: Id) => Known | null, failed: boolean) => {
        for (const [id, { promise, resolve }] of part) {
          if (failed && cache.get(id) === promise) cache.delete(id);
          resolve(answer(id));
        }
      };
      let read: Promise<readonly Act[]>;
      try { read = api.actsById(part.map(([id]) => id)); } catch (e) { read = Promise.reject(e); }
      read.then((acts) => {
        const by = new Map(acts.map((a) => [a.id, a]));
        done((id) => { const a = by.get(id); return a ? { thread: a.thread, seq: a.seq, character: a.character } : null; }, false);
      }, () => done(() => null, true));
    }
  }

  return {
    ask(id) {
      const had = cache.get(id);
      if (had) { remember(id, had); return had; }
      let resolve!: (k: Known | null) => void;
      const promise = new Promise<Known | null>((r) => { resolve = r; });
      queue.set(id, { promise, resolve });
      remember(id, promise);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      return promise;
    },
  };
}

const loaders = new WeakMap<KayfaApi, ActLoader>();
export function actLoader(api: KayfaApi): ActLoader {
  let l = loaders.get(api);
  if (!l) { l = createLoader(api); loaders.set(api, l); }
  return l;
}

/** undefined while it is being found, null when there is no such Act (or it is no place in a thread). */
export function useLocated(id: Id | null): Located | null | undefined {
  const { api } = useKayfa();
  const index = useContext(ActIndex);
  const [found, setFound] = useState<Located | null | undefined>(() => (id === null ? null : index(id)));
  useEffect(() => {
    if (id === null) { setFound(null); return; }
    const here = index(id);
    if (here) { setFound(here); return; }
    let live = true;
    void actLoader(api).ask(id).then((k) => { if (live) setFound(k && k.seq !== null ? { thread: k.thread, seq: k.seq } : null); });
    return () => { live = false; };
  }, [api, id, index]);
  return found;
}
