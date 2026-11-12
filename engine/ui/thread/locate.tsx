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
 * not, so the next render that wants it asks again. Characters are read the same way (`characterLoader`), so a page of quotes
 * names its authors in one `characters` call.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id, KayfaApi } from '../data/api.ts';

export interface Located { readonly thread: Id; readonly seq: number }

/** The thread's own index of the Acts on screen. */
export const ActIndex = createContext<(id: Id) => Located | undefined>(() => undefined);

/** What is kept of an Act read by id. */
export interface Known { readonly thread: Id; readonly seq: number | null; readonly character: Id | null; /** Any version of the post is hidden now (`Act.anyHidden`): a quote of it is emptied. */ readonly hidden: boolean }

/** How many Acts' answers are remembered. */
export const ACT_CACHE_SIZE = 500;
/** The most ids in one read, so an address stays short. */
const CHUNK = 100;

export interface ActLoader {
  /** The Act, or null when there is no such Act (or the read failed). */
  ask(id: Id): Promise<Known | null>;
}

/**
 * One batched, bounded loader: every id asked for in one tick goes in one read of at most CHUNK ids, and what is remembered is the
 * last ACT_CACHE_SIZE ids asked about. `readMany` answers the ids it found; one it left out is "not there", remembered as null.
 */
function createBatch<V>(readMany: (ids: readonly Id[]) => Promise<ReadonlyMap<Id, V>>): { ask(id: Id): Promise<V | null> } {
  const cache = new Map<Id, Promise<V | null>>();
  const queue = new Map<Id, { readonly promise: Promise<V | null>; readonly resolve: (k: V | null) => void }>();
  let scheduled = false;

  const remember = (id: Id, p: Promise<V | null>) => {
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
      const done = (answer: (id: Id) => V | null, failed: boolean) => {
        for (const [id, { promise, resolve }] of part) {
          if (failed && cache.get(id) === promise) cache.delete(id);
          resolve(answer(id));
        }
      };
      let read: Promise<ReadonlyMap<Id, V>>;
      try { read = readMany(part.map(([id]) => id)); } catch (e) { read = Promise.reject(e); }
      read.then((by) => done((id) => by.get(id) ?? null, false), () => done(() => null, true));
    }
  }

  return {
    ask(id) {
      const had = cache.get(id);
      if (had) { remember(id, had); return had; }
      let resolve!: (k: V | null) => void;
      const promise = new Promise<V | null>((r) => { resolve = r; });
      queue.set(id, { promise, resolve });
      remember(id, promise);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
      return promise;
    },
  };
}

const known = (a: Act): Known => ({ thread: a.thread, seq: a.seq, character: a.character, hidden: a.anyHidden === true });

const loaders = new WeakMap<KayfaApi, ActLoader>();
export function actLoader(api: KayfaApi): ActLoader {
  let l = loaders.get(api);
  if (!l) { l = createBatch<Known>(async (ids) => new Map((await api.actsById(ids)).map((a) => [a.id, known(a)]))); loaders.set(api, l); }
  return l;
}

export interface CharacterLoader {
  /** The character's public face, or null when it cannot be found: not debuted and no such character read the same, so the answer proves nothing private. */
  ask(id: Id): Promise<Character | null>;
}

const characterLoaders = new WeakMap<KayfaApi, CharacterLoader>();
export function characterLoader(api: KayfaApi): CharacterLoader {
  let l = characterLoaders.get(api);
  if (!l) { l = createBatch<Character>(async (ids) => new Map((await api.characters(ids)).map((c) => [c.id, c]))); characterLoaders.set(api, l); }
  return l;
}

/** undefined while it is being found, null when it cannot be found (not debuted and unknown alike). */
export function useCharacter(id: Id | null): Character | null | undefined {
  const { api } = useKayfa();
  const [found, setFound] = useState<Character | null | undefined>(id === null ? null : undefined);
  useEffect(() => {
    if (id === null) { setFound(null); return; }
    let live = true;
    setFound(undefined);
    void characterLoader(api).ask(id).then((c) => { if (live) setFound(c); });
    return () => { live = false; };
  }, [api, id]);
  return found;
}

/** What is known of an Act read by id (its author among it): undefined while it is being found, null when there is no such Act. */
export function useKnownAct(id: Id): Known | null | undefined {
  const { api } = useKayfa();
  const [found, setFound] = useState<Known | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void actLoader(api).ask(id).then((k) => { if (live) setFound(k); });
    return () => { live = false; };
  }, [api, id]);
  return found;
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
