/**
 * The boards the forum has, read once for the screens that name them: the search form's board field, the spin form's
 * board field and the spun-thread lines (docs/plans/2026-11-25-spin-board-plan.md). Boot's list when the page booted
 * with one, else one read of `api.boards()`.
 */
import { useEffect, useState } from 'react';
import { useBoot } from './boot.tsx';
import { useKayfa } from './context.tsx';
import type { BoardSummary, Id, KayfaApi } from './data/api.ts';

/**
 * The fallback read, shared: every instance mounted in the same moment (a board's rows each name a board) waits on one in-flight `api.boards()` per
 * `api`, so N instances make one request. It is dropped when it settles, so a later mount reads fresh.
 */
const reading = new WeakMap<object, Promise<readonly BoardSummary[]>>();
function readBoards(api: KayfaApi): Promise<readonly BoardSummary[]> {
  let p = reading.get(api);
  if (p === undefined) {
    p = api.boards().finally(() => { reading.delete(api); });
    reading.set(api, p);
  }
  return p;
}

export function useBoards(): readonly BoardSummary[] {
  const { api } = useKayfa();
  const boot = useBoot();
  const [read, setRead] = useState<readonly BoardSummary[]>([]);
  useEffect(() => {
    if (boot) return;
    let live = true;
    void readBoards(api).then((b) => { if (live) setRead(b); }, () => {});
    return () => { live = false; };
  }, [api, boot]);
  return boot ? boot.boards : read;
}

/** A lookup over the same list: a board id to its name, null when the list does not hold the id. */
export function useBoardName(): (id: Id) => string | null {
  const boards = useBoards();
  return (id) => boards.find((b) => b.id === id)?.name ?? null;
}
