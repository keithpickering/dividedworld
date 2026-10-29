/**
 * Where an Act is: its thread and seq, so a quote, a card or an origin can link to it. An Act on
 * the screen is found at once from the thread's own index; any other is read once, by id, and
 * remembered for the page. The link is never a guess.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, KayfaApi } from '../data/api.ts';

export interface Located { readonly thread: Id; readonly seq: number }

/** The thread's own index of the Acts on screen. */
export const ActIndex = createContext<(id: Id) => Located | undefined>(() => undefined);

const known = new WeakMap<KayfaApi, Map<Id, Promise<Located | null>>>();

function read(api: KayfaApi, id: Id): Promise<Located | null> {
  const cache = known.get(api) ?? new Map<Id, Promise<Located | null>>();
  known.set(api, cache);
  let p = cache.get(id);
  if (!p) {
    p = api.act(id).then((a) => (a && a.seq !== null ? { thread: a.thread, seq: a.seq } : null), () => null);
    cache.set(id, p);
  }
  return p;
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
    void read(api, id).then((l) => { if (live) setFound(l); });
    return () => { live = false; };
  }, [api, id, index]);
  return found;
}
