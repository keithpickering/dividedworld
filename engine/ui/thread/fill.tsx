/**
 * A post wearing a live play of a card that fills the row (`CardUi.fillsRow`) has the card's `Effect` drawn over its whole row, in a `div.kb-row-layer` inside the row's grid
 * (as `kb-row-cover` is), instead of around the words. The layers are in the instance's order (`InstanceUi.rowOrder`, outermost first, `rowRank`), so the outermost is drawn last,
 * on top; each is `covered` while a cover ranked outside it is still shut for this reader. A fill makes nothing inert, but a layer a shut cover covers is marked
 * (`data-kb-covered`) so that the cover's own `inert` reaches it (cover.tsx).
 *
 * This hook owns the layers' elements and says which cards have one; `PostEffects` (cards/Effects.tsx) mounts each card's `Effect` into its element (a portal), given the
 * `EffectProps` a post's effect is given, so the layer is the card's however the post's other effects nest. Where a post has no row (the ORIGIN box, the front door, a
 * moment, History) there is no `RowFillCtx` and the effect wraps the words as any other.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { actsOnPost, livePlays, usePlays, type Plays } from '../cards/plays.ts';
import type { CardUi } from '../cards/types.ts';
import { rowRank, rowZ, type RowCovering } from './cover.tsx';

/** What a post's effects are given of the row's layers: the element a card's effect is drawn into, and whether a shut cover is outside it. */
export interface RowFill {
  /** The layer element of a card that fills the row, once it is in the page; null until then, and for a card with no live play here. */
  readonly host: (card: string) => HTMLElement | null;
  /** Whether a cover ranked outside the card is still shut for this reader. */
  readonly covered: (card: string) => boolean;
}

export const RowFillCtx = createContext<RowFill | null>(null);

/** The post's row layers; null where a post is drawn with no row of its own. */
export const useRowFill = (): RowFill | null => useContext(RowFillCtx);

/** What a post draws with its fills: the context for its effects, and the layers drawn in the grid. */
export interface RowFilling {
  readonly value: RowFill;
  /** The `div.kb-row-layer`s, innermost first so the outermost is on top; null while no card has a live play here. */
  readonly layers: ReactNode;
}

/** The post's fill layers for a thread's post: one for each card that fills the row and has a live play on the post's own reach, in `order`'s ranks. */
export function useRowFilling({ plays, actId, eligible, now, cards, order, covering }: {
  readonly plays: Plays; readonly actId: string; readonly eligible: boolean; readonly now: number; readonly cards: readonly CardUi[];
  /** `InstanceUi.rowOrder`. */
  readonly order: readonly string[] | undefined; readonly covering: RowCovering;
}): RowFilling {
  const own = usePlays(plays, actId).plays;
  const filling = eligible ? livePlays(own, now).filter((p) => actsOnPost(p) && cards.find((c) => c.key === p.card)?.fillsRow === true) : [];
  /* Outermost first, one entry for each card. */
  const keys = [...new Set(filling.map((p) => p.card))].sort((a, b) => rowRank(order, a) - rowRank(order, b));
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map());
  /* One callback ref for each card, kept: a new one on each render would be called with null and the element again, and the state set each time would render again. */
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const ref = (key: string) => {
    let held = refs.current.get(key);
    if (!held) {
      held = (el) => setHosts((was) => {
        if ((was.get(key) ?? null) === el) return was;
        const next = new Map(was);
        if (el) next.set(key, el); else next.delete(key);
        return next;
      });
      refs.current.set(key, held);
    }
    return held;
  };
  const shut = covering.shutCards;
  const coveredBy = useCallback((key: string) => shut.some((c) => rowRank(order, c) < rowRank(order, key)), [shut, order]);
  const live = keys.join('\n');
  const value = useMemo<RowFill>(() => ({ host: (card) => (live.split('\n').includes(card) ? hosts.get(card) ?? null : null), covered: coveredBy }), [hosts, coveredBy, live]);
  const layers = keys.length === 0 ? null : [...keys].reverse().map((key) => (
    <div key={key} ref={ref(key)} className="kb-row-layer" style={{ zIndex: rowZ(order, key) }} data-kb-card={key} data-kb-covered={coveredBy(key) ? 'true' : undefined} />
  ));
  return { value, layers };
}
