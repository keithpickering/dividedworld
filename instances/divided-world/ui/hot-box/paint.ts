/**
 * What every fog painter on the page shares, moved out of `Effect.tsx` unchanged when Steel Chair's puff came to paint Hot Box's fog (docs/plans/2026-11-23-steel-chair-objects-design.md,
 * section 4): whether the reader's system is in forced colors, and the one small scratch canvas the fog's bytes reach a tile through.
 */
import { useSyncExternalStore } from 'react';

/* -------------------------------------------------------------------------------- forced colors ---- */

const FORCED = '(forced-colors: active)';
/* One media query and one listener for every smoked post on the page: made with the first reader of it, dropped with the last. */
const forcedReaders = new Set<() => void>();
let forcedQuery: MediaQueryList | undefined;
const forcedChanged = () => { for (const read of [...forcedReaders]) read(); };
function subscribeForced(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (forcedReaders.size === 0) {
    forcedQuery = window.matchMedia?.(FORCED);
    forcedQuery?.addEventListener?.('change', forcedChanged);
  }
  forcedReaders.add(onChange);
  return () => {
    forcedReaders.delete(onChange);
    if (forcedReaders.size === 0) {
      forcedQuery?.removeEventListener?.('change', forcedChanged);
      forcedQuery = undefined;
    }
  };
}
/** The shared query once anyone subscribes; before that (a first render) one is asked for, and not kept. */
const forcedNow = (): boolean => typeof window !== 'undefined' && ((forcedQuery ?? window.matchMedia?.(FORCED))?.matches ?? false);

/** Whether the reader's system is in forced colors, kept current as it changes. (`engine/ui` has no hook for it.) */
export function useForcedColors(): boolean {
  return useSyncExternalStore(subscribeForced, forcedNow, () => false);
}

/* -------------------------------------------------------------------------------- the scratch ---- */

/**
 * The fog is worked out as bytes, a cell to a pixel, and reaches a tile through one small canvas the whole page shares: the bytes are put on it and it is
 * drawn onto the tile, scaled up smooth. It is as wide as the widest field and as tall as a tile's rows (a few hundred px by about a hundred), never the
 * size of a post. A browser that gives it no 2D context has none, and the tile is filled flat instead.
 */
interface Scratch { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D; readonly images: Map<string, ImageData> }
let scratch: Scratch | null | undefined;
export function scratchFor(w: number, h: number): { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D; readonly img: ImageData } | null {
  if (scratch === undefined) {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    const ctx = canvas?.getContext?.('2d') ?? null;
    scratch = canvas && ctx ? { canvas, ctx, images: new Map() } : null;
  }
  if (!scratch || w <= 0 || h <= 0) return null;
  /* Grown, never shrunk: assigning a size clears a canvas, and the bytes put on it each time cover what is drawn from it. */
  if (scratch.canvas.width < w) scratch.canvas.width = w;
  if (scratch.canvas.height < h) scratch.canvas.height = h;
  const key = `${w}x${h}`;
  let img = scratch.images.get(key);
  if (!img) {
    /* A post's tiles are of two heights at most; a few sizes are kept so two posts in view do not make their bytes again every frame. */
    if (scratch.images.size >= 8) scratch.images.clear();
    img = scratch.ctx.createImageData(w, h);
    scratch.images.set(key, img);
  }
  return { canvas: scratch.canvas, ctx: scratch.ctx, img };
}
/** For tests: the scratch canvas is the page's, and a test must start with none. */
export function forgetScratch(): void { scratch = undefined; }

