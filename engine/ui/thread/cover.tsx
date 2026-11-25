/**
 * The state of a post's covers for this reader, and the presses that change it, given to a card that covers the row
 * (`CardUi.coversRow`; `EffectProps.cover`). A cover is the card's `Cover`, which the engine mounts over a post's whole row
 * (`div.kb-row-cover`, inside the row's grid) for each live play of the card on the post's own reach; the reader opens them one
 * at a time, outermost first, and Encore shuts them all again. The state is the reader's own, in the page's memory.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { livePlays, usePlays, type Plays } from '../cards/plays.ts';
import type { CardUi, CoverProps, RowCover } from '../cards/types.ts';

export type { CoverProps, RowCover };

export const RowCoverCtx = createContext<RowCover | null>(null);

/** The post's covers for this reader; null where a post is drawn with no row of its own. */
export const useRowCover = (): RowCover | null => useContext(RowCoverCtx);

/** True while any cover over this post is shut for this reader. A card's `Effect` may provide it where there is no row (`CoveredCtx.Provider`). */
export const CoveredCtx = createContext(false);

export const useCovered = (): boolean => useContext(CoveredCtx);

/** What a post draws with its covers: whether it is covered, the reader's state, and the host drawn over the row while any is shut. */
export interface RowCovering {
  readonly covering: boolean;
  readonly shut: number;
  readonly rowCover: RowCover | null;
  /** The `div.kb-row-cover` holding the card's `Cover`, to be drawn first inside the grid; null while none is shut. */
  readonly host: ReactNode;
}

/**
 * Whether a post covers its row and the reader's state of it, for a thread's post. It covers while the post wears a live play, on its own reach, of a card that covers the row;
 * an admin's ending of one lowers `total` when the post next renders. The state is the number this reader has opened, never more than `total`: it is clamped as `total` falls, so a
 * play ended after the reader opened it leaves nothing shut, never a count below none, and a play landing later raises `total` above it, so the new cover is shut. While any is
 * shut, every child of the grid but the host is made `inert`, so nothing under the cover can be focused or pressed.
 */
export function useRowCovering({ plays, actId, eligible, now, cards, grid, post }: {
  readonly plays: Plays; readonly actId: string; readonly eligible: boolean; readonly now: number; readonly cards: readonly CardUi[]; readonly grid: RefObject<HTMLElement | null>; readonly post: string;
}): RowCovering {
  const own = usePlays(plays, actId).plays;
  /* Latest first: the outermost cover is the latest play. */
  const covering = eligible ? livePlays(own, now).filter((p) => !p.reach && cards.find((c) => c.key === p.card)?.coversRow === true).reverse() : [];
  const total = covering.length;
  const [kept, setKept] = useState(0);
  if (kept > total) setKept(total);
  const opened = Math.min(kept, total);
  const shut = total - opened;
  const open = useCallback(() => setKept((was) => was + 1), []);
  const encore = useCallback(() => setKept(0), []);
  const rowCover = useMemo<RowCover | null>(() => (total > 0 ? { shut, total, open, encore } : null), [total, shut, open, encore]);
  const shown = shut > 0 ? cards.find((c) => c.key === covering[opened]?.card) : undefined;
  const Cover = shown?.Cover;
  const same = shown ? covering.filter((p) => p.card === shown.key) : [];
  /* Run after every render: a cell added to the grid while a cover is shut is made inert at the next one. */
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    const marked: Element[] = [];
    if (shut > 0) for (const el of g.children) if (!el.classList.contains('kb-row-cover') && !el.hasAttribute('inert')) { el.setAttribute('inert', ''); marked.push(el); }
    return () => { for (const el of marked) el.removeAttribute('inert'); };
  });
  const host = shut > 0 && rowCover && Cover ? <div className="kb-row-cover"><Cover plays={same} cover={rowCover} post={post} /></div> : null;
  return { covering: total > 0, shut, rowCover, host };
}
