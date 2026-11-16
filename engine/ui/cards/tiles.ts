/**
 * The tile layer's arithmetic (docs/plans/2026-11-16-effect-tiles-design.md, section 3). A canvas effect on a post paints a layer of tiles,
 * not one canvas as tall as the body: a tile is 512 CSS px tall (the last of a box is what is left) and is drawn at a density of at most 2.
 *
 * The figure: the board's column is at most 1,200 px wide (`--kb-board-max`, e2e/board-width.spec.ts), so the largest tile is 1,200 by
 * 512 CSS px, which at a density of 2 is 2,400 by 1,024 canvas px, exactly 2,457,600. That is under the 4,000,000 px past which a canvas
 * fails silently on iOS (instances/divided-world/cards/whoops/paint.ts), at every width. Where a box is somehow wider than 1,200 px the
 * density is lowered until the tile is 2,400 px across, so the figure holds whatever the layout. An effect may ask for a lower density
 * and never a higher one. A tile is held while it lies within 256 px of the viewport, above or below.
 *
 * Where each number comes from: `TILE_PX` is Whoops!'s band (`BAND_PX`), so its ink moves onto the layer without a change to its lattice;
 * `MAX_TILE_DENSITY` is the densest screen worth drawing for (a tile at 3 would pass the cap at full width); `MAX_TILE_WIDTH_PX` is the
 * board's column; `MAX_TILE_PIXELS` is the product 2,400 * 1,024, not a free number; `TILE_NEAR_PX` is half a tile, the margin the band
 * watcher (bands.ts) is given.
 *
 * Everything in this top part is pure: no DOM, no time, nothing of an instance. The layer itself comes after it.
 */
import { bandsOf } from './bands.ts';

/** A tile's height in CSS px. */
export const TILE_PX = 512;
/** A tile is held while it lies within this many CSS px of the view, above or below. */
export const TILE_NEAR_PX = 256;
/** The most a tile is ever drawn at, canvas px per CSS px. */
export const MAX_TILE_DENSITY = 2;
/** The widest the board's column is, CSS px; a wider box has its density lowered to keep the figure. */
export const MAX_TILE_WIDTH_PX = 1200;
/** The most canvas px one tile has: (1,200 * 2) * (512 * 2). */
export const MAX_TILE_PIXELS = 2_457_600;

/** A positive finite number, or 1. */
function sane(d: number): number {
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/**
 * The density a tile of a box `w` CSS px wide is drawn at: the least of `MAX_TILE_DENSITY`, the screen's density and what the effect asked
 * for (`undefined` is no ask); for `w` over 1,200 it is lowered so that `ceil(w * density)` is at most 2,400 (`MAX_TILE_WIDTH_PX` at the
 * cap), which keeps `ceil(w * d) * ceil(TILE_PX * d)` at or under `MAX_TILE_PIXELS`. A density that is not a positive finite number is 1.
 */
export function tileDensity(w: number, screen: number, ask?: number): number {
  let d = Math.min(MAX_TILE_DENSITY, sane(screen), ask === undefined ? Infinity : sane(ask));
  const across = MAX_TILE_WIDTH_PX * MAX_TILE_DENSITY;
  if (Number.isFinite(w) && w > MAX_TILE_WIDTH_PX && Math.ceil(w * d) > across) {
    d = across / w;
    /* A quotient can round up past the bound once multiplied back; step down until it does not. */
    while (Math.ceil(w * d) > across) d *= 1 - Number.EPSILON * 4;
  }
  return d;
}

/** The most tiles one layer holds in a window `viewportH` CSS px tall: the near range is the window and a margin each side. */
export function mostTiles(viewportH: number): number {
  return Math.ceil((viewportH + 2 * TILE_NEAR_PX) / TILE_PX) + 1;
}

/**
 * The indexes of the tiles of `bandsOf(boxH, TILE_PX)` that lie within `TILE_NEAR_PX` of the view. The box's top is 0 and the view
 * (`viewTop` to `viewBottom`) is in the box's px. A tile just `TILE_NEAR_PX` away counts, as an observer's margin counts a touching edge;
 * a box of no height has none.
 */
export function nearTiles(boxH: number, viewTop: number, viewBottom: number): number[] {
  const out: number[] = [];
  const from = viewTop - TILE_NEAR_PX;
  const to = viewBottom + TILE_NEAR_PX;
  bandsOf(boxH, TILE_PX).forEach((t, i) => {
    if (t.top + t.h >= from && t.top <= to) out.push(i);
  });
  return out;
}
