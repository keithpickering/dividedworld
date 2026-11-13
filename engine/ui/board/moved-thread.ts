/**
 * The names a `moveThread` sentence needs and its params lack: the thread's title and the board it left, read once for a page (see `movedThreadNames`). Apart from move-words.ts so
 * that file stays pure, which the node runner tests.
 */
import { useEffect, useState } from 'react';
import type { MoveNames } from '../../system/moves.ts';
import { useKayfa } from '../context.tsx';
import type { BoardName, KayfaApi } from '../data/api.ts';

/**
 * The title of the thread a `moveThread` moved and the board it left, read once for the move (`act` when it has landed, else the thread it will move): null until read, for another
 * kind, and when the thread cannot be read, so a sentence says "a thread" rather than guess.
 */
export function useMovedThread(kind: string, params: Readonly<Record<string, unknown>>, act: string | null | undefined, boards: readonly BoardName[]): Pick<MoveNames, 'thread' | 'source' | 'sourceId'> | null {
  const { api } = useKayfa();
  const thread = kind === 'moveThread' && typeof params['thread'] === 'string' ? params['thread'] : null;
  const key = thread === null ? null : `${act ?? ''}|${thread}`;
  /* The answer is kept with the move it was read for, so a sentence handed another move shows nothing of the one before while the next is read. */
  const [got, setGot] = useState<{ readonly key: string; readonly title: string; readonly left: string | null } | null>(null);
  useEffect(() => {
    if (thread === null || key === null) return;
    let live = true;
    setGot(null);
    void movedThreadNames(api, { thread, act: act ?? null }).then((r) => { if (live && r) setGot({ key, ...r }); });
    return () => { live = false; };
  }, [api, thread, act, key]);
  if (got === null || got.key !== key || got.title === '') return null;
  const left = got.left === null ? undefined : boards.find((b) => b.id === got.left)?.name;
  return { thread: got.title, ...(left !== undefined && got.left !== null ? { source: left, sourceId: got.left } : {}) };
}

/** The most items one `moveThreadNames` call carries (the server reads that many). */
const NAMES_PER_CALL = 50;
interface Batch { readonly items: Map<string, { thread: string; act: string | null }>; readonly waiting: Map<string, ((r: { title: string; left: string | null } | null) => void)[]> }
const batches = new WeakMap<object, Batch>();

/**
 * The names of a moved thread, asked for by every sentence of a page in the same tick and read with one `moveThreadNames` call (and one more for each further 50), not one for a row:
 * a page of the queue or the log draws a sentence per move. A failed read answers null, and the sentence says "a thread".
 */
function movedThreadNames(api: KayfaApi, item: { thread: string; act: string | null }): Promise<{ title: string; left: string | null } | null> {
  const key = item.act ?? item.thread;
  let batch = batches.get(api);
  if (!batch) {
    batch = { items: new Map(), waiting: new Map() };
    batches.set(api, batch);
    const mine = batch;
    queueMicrotask(() => setTimeout(() => {
      batches.delete(api);
      const all = [...mine.items.values()];
      for (let i = 0; i < all.length; i += NAMES_PER_CALL) {
        const chunk = all.slice(i, i + NAMES_PER_CALL);
        api.moveThreadNames(chunk).then(
          (got) => { for (const c of chunk) for (const done of mine.waiting.get(c.act ?? c.thread) ?? []) done(got[c.act ?? c.thread] ?? null); },
          () => { for (const c of chunk) for (const done of mine.waiting.get(c.act ?? c.thread) ?? []) done(null); },
        );
      }
    }, 0));
  }
  batch.items.set(key, item);
  return new Promise((resolve) => { batch.waiting.set(key, [...(batch.waiting.get(key) ?? []), resolve]); });
}
