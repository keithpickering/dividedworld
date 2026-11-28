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

/**
 * A card's place among the row's layers, outermost first (`InstanceUi.rowOrder`): its index, and -1 for a card the order does not list (the build refuses that, so it only
 * happens in a test), which sorts outside every listed one, as the latest play did before the order existed.
 */
export const rowRank = (order: readonly string[] | undefined, key: string): number => order?.indexOf(key) ?? -1;

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
  /** The cards whose covers are still shut for this reader, outermost first, one entry for each shut play: what a layer inside them is `covered` by (thread/fill.tsx). */
  readonly shutCards: readonly string[];
  /** The level an over-ink box stands at in this row while a fill layer is up (`overInkZ`). */
  readonly overZ: number;
  /** The `div.kb-row-cover` holding the card's `Cover`, to be drawn first inside the grid; null while none is shut. */
  readonly host: ReactNode;
}

/** The stacking of a row layer, the outermost highest, within the band above the post's own cells (5 and up) that fold.css gives a cover and a fill: a layer ranked outside another draws over it. */
export const rowZ = (order: readonly string[] | undefined, key: string): number => 5 + 2 * ((order?.length ?? 0) - rowRank(order, key));

/**
 * The level an over-ink box (the ORIGIN box, spin/Origin.tsx) stands at in the row's grid while a fill layer is up (`--kb-over-z`, thread/fold.css): over every layer, and under the cover that is drawn, if one is. Layers are two levels
 * apart, so the level just under a cover is over every layer ranked inside it and under every layer ranked outside it; with no cover it is over the topmost layer a card unranked in the order could have.
 */
export const overInkZ = (order: readonly string[] | undefined, cover: string | undefined): number => (cover === undefined ? rowZ(order, '') + 1 : rowZ(order, cover) - 1);

/**
 * Whether a post covers its row and the reader's state of it, for a thread's post. It covers while the post wears a live play, on its own reach, of a card that covers the row;
 * an admin's ending of one lowers `total` when the post next renders. The covers run outermost first in the instance's order (`InstanceUi.rowOrder`, `rowRank`), the latest play first
 * among plays of one card. The state is the set of play ids this reader has opened, in the page's memory: a play is shut until its id is in it, so a play ended after it was opened
 * leaves nothing shut, and a play landing later is shut however many the reader has opened. The
 * drawn cover is the latest play not yet opened; `open` adds its id and `encore` clears the set. While the host draws a Cover, every child of the grid but the host is made `inert`,
 * so nothing under it can be focused or pressed; only what the effect marked is lifted again.
 */
export function useRowCovering({ plays, actId, eligible, now, cards, grid, post, order }: {
  readonly plays: Plays; readonly actId: string; readonly eligible: boolean; readonly now: number; readonly cards: readonly CardUi[]; readonly grid: RefObject<HTMLElement | null>; readonly post: string;
  /** `InstanceUi.rowOrder`. */
  readonly order?: readonly string[] | undefined;
}): RowCovering {
  const own = usePlays(plays, actId).plays;
  /* Outermost first: by the instance's rank, and the latest play first among the plays of one card (the sort is stable, and the plays run latest first before it). */
  const covering = eligible ? livePlays(own, now).filter((p) => !p.reach && cards.find((c) => c.key === p.card)?.coversRow === true).reverse().sort((a, b) => rowRank(order, a.card) - rowRank(order, b.card)) : [];
  const total = covering.length;
  /* Ids of plays gone from `covering` are harmless: they are never looked up. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const stillShut = covering.filter((p) => !opened.has(p.id));
  const shut = stillShut.length;
  const next = stillShut[0];
  const open = useCallback(() => { if (next) setOpened((was) => new Set(was).add(next.id)); }, [next?.id]);
  const encore = useCallback(() => setOpened(new Set()), []);
  const rowCover = useMemo<RowCover | null>(() => (total > 0 ? { shut, total, open, encore } : null), [total, shut, open, encore]);
  const shown = next ? cards.find((c) => c.key === next.card) : undefined;
  const Cover = shown?.Cover;
  const same = shown ? stillShut.filter((p) => p.card === shown.key) : [];
  const drawn = Boolean(rowCover && Cover);
  /* Run after every render: a cell added to the grid while a Cover is drawn is made inert at the next one. */
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    const marked: Element[] = [];
    if (drawn) for (const el of g.children) if (!el.classList.contains('kb-row-cover') && !(el.classList.contains('kb-row-layer') && el.getAttribute('data-kb-covered') !== 'true') && !el.hasAttribute('inert')) { el.setAttribute('inert', ''); marked.push(el); }
    return () => { for (const el of marked) el.removeAttribute('inert'); };
  });
  const host = drawn && Cover && rowCover ? <div className="kb-row-cover" style={{ zIndex: rowZ(order, next!.card) }}><Cover plays={same} cover={rowCover} post={post} /></div> : null;
  return { covering: total > 0, shut, overZ: overInkZ(order, drawn ? next!.card : undefined), shutCards: stillShut.map((p) => p.card), rowCover, host };
}
