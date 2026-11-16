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
import { bandsOf, watchBands, type BandWatch } from './bands.ts';
import { bodyBox, bodyOf, sameBox, type BodyBox } from './body.ts';
import { forget, join, want, type LoopMember } from './tileLoop.ts';
import type { EffectPlace } from './types.ts';

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
 * cap), which keeps `ceil(w * d) * ceil(TILE_PX * d)` at or under `MAX_TILE_PIXELS`. A density that is not a positive finite number is 1. A width
 * that is not finite is not lowered: such a box has no canvas.
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

/**
 * The layer (design sections 2, 4 and 5). An effect hands `makeTileLayer` a painter that draws in the box's own CSS px coordinates and never
 * sizes a canvas: the layer finds the box, cuts it into tiles of `TILE_PX`, holds a canvas only for each tile near the view, releases a tile
 * that leaves, and sets the density. It reads a box, the window and the frame's time, nothing of a post and nothing private; time is never read
 * here (tools/check-one-clock.mjs): the frame's timestamp is the only clock.
 *
 * The first tiles are found from the box and the window in the layout pass that makes the layer and painted in it (section 5), because an
 * IntersectionObserver answers a frame or more late and an effect that hides words must not show them in that gap; the observer
 * (`watchBands`, which also lays a stand-in element over each tile's place) keeps the set after that. A tile the observer reports new is made
 * at once and painted in the next frame, so a stand-in marked `far` covers its place until a painted tile does. Where the browser has no
 * IntersectionObserver `bands.ts` counts every tile near; the layer ignores that and holds the tiles `nearTiles` names from the window on each
 * scroll frame, so the figure of section 3 holds there too.
 *
 * The frames are not the layer's: it joins the page's one schedule (tileLoop.ts) and asks it for a frame when it has a loop on, a stale or new tile or a scroll to follow, and requests none of its own.
 *
 * Every canvas is placed inline (the effect's stylesheet places nothing), appended after its tile's stand-in so it covers it, in the host: the
 * effect keeps its own layer at its own depth among the post's elements. The context a painter is handed has been cleared, transformed to the
 * box's coordinates and clipped to the tile's rows, so a painter that fills the whole box fills only the tile.
 */

/** What a painter is handed for one canvas of one tile. `ctx` is already transformed so that its coordinates are the box's CSS px. */
export interface TileDraw {
  readonly ctx: CanvasRenderingContext2D;
  /** Which of the layer's canvases for this tile (0 is the lowest). */
  readonly sheet: number;
  /** The tile: its index, its offset from the box's top and its height, CSS px. */
  readonly index: number; readonly top: number; readonly h: number;
  /** The whole box, CSS px, and the density the tile is drawn at. */
  readonly box: { readonly w: number; readonly h: number }; readonly density: number;
  /** The frame's time (a `requestAnimationFrame` timestamp), or null for a paint outside a frame. */
  readonly frame: number | null;
}
export interface TileLayerOptions {
  /**
   * Where the post is shown. The box is the nearest content area either way (`bodyOf`: the thread's body, the ORIGIN box's area), or the host's
   * own where there is none, so the place changes nothing the layer does; it says where the effect asked for its layer.
   */
  readonly place: EffectPlace;
  /** Canvases a tile holds, lowest first; default 1. */
  readonly sheets?: number;
  /** A density to draw at, at most the layer's own. */
  readonly density?: number;
  /** A class for each canvas (the effect's stylesheet places nothing: the layer sets the box inline). */
  readonly className?: string;
  /** A class for each band's stand-in, which carries `data-kb-tile="far"` until a painted tile covers it and `"held"` after. */
  readonly standIn?: string;
  readonly paint: (draw: TileDraw) => void;
  /** Told the box whenever it changes, and once at the start (before `makeTileLayer` returns, so before the effect holds the layer). */
  readonly onBox?: (box: BodyBox, body: HTMLElement | null) => void;
}
export interface TileLayer {
  /** The every-frame way: on, the painter is called for each held tile each frame. */
  loop(on: boolean): void;
  /** The kept way: a part of the box (CSS px, default all of it) is stale; its held tiles are painted in the next frame. */
  stale(rect?: { readonly top: number; readonly bottom: number }): void;
  /** Paints every held tile now, outside a frame (after a commit that must not show a bare frame). */
  paintNow(): void;
  /** The held tiles' canvases, for an effect that draws straight into them between paints (step 2's scrub). */
  held(): readonly { readonly index: number; readonly top: number; readonly h: number; readonly density: number; readonly sheets: readonly HTMLCanvasElement[] }[];
  /** Measures again (a takeover moved the words with no change of size). */
  measure(): void;
  stop(): void;
}

interface Tile {
  readonly index: number;
  top: number; h: number; density: number;
  readonly sheets: HTMLCanvasElement[];
  /** Made, or marked stale, and not painted since: the next frame paints it. */
  dirty: boolean;
  /** Painted at least once, so its stand-in is marked held. */
  painted: boolean;
}

/** The layer over `host` (an absolutely positioned layer's parent, as `placeLayer` assumes): see the header. */
export function makeTileLayer(host: HTMLElement, options: TileLayerOptions): TileLayer {
  const sheetCount = Math.max(1, Math.floor(options.sheets ?? 1));
  const tiles = new Map<number, Tile>();
  let body = bodyOf(host);
  let box = bodyBox(host, body);
  let cut = bandsOf(box.h, TILE_PX);
  let standIns: HTMLElement[] = [];
  let looping = false;
  let stopped = false;
  let scrollDue = false;
  const hasObserver = typeof IntersectionObserver !== 'undefined';

  const densityNow = () => tileDensity(box.w, typeof window === 'undefined' ? 1 : window.devicePixelRatio, options.density);
  /** The window in the box's px: the box's top is 0. */
  const view = () => {
    const top = host.getBoundingClientRect().top + box.top;
    return { top: -top, bottom: window.innerHeight - top };
  };

  const mark = (i: number) => {
    const el = standIns[i];
    if (el && options.standIn) el.setAttribute('data-kb-tile', tiles.get(i)?.painted ? 'held' : 'far');
  };

  /** Runs a change to the watcher's elements and takes up the ones it made: they are `.kb-band`s of the host that were not there before, in order. */
  const claim = (change: () => void) => {
    const before = new Set(host.querySelectorAll('.kb-band'));
    change();
    standIns = standIns.filter((e) => e.isConnected);
    for (const e of host.querySelectorAll<HTMLElement>('.kb-band')) {
      if (before.has(e)) continue;
      if (options.standIn) e.classList.add(options.standIn);
      standIns.push(e);
    }
    standIns.forEach((_, i) => mark(i));
  };

  /** Places a tile's canvases, sizing one only when its size differs (assigning a size clears a canvas); true when any was cleared by it. */
  const place = (tile: Tile): boolean => {
    let cleared = false;
    const w = Math.ceil(box.w * tile.density), h = Math.ceil(tile.h * tile.density);
    for (const c of tile.sheets) {
      if (c.width !== w) { c.width = w; cleared = true; }
      if (c.height !== h) { c.height = h; cleared = true; }
      c.style.left = `${box.left}px`;
      c.style.top = `${box.top + tile.top}px`;
      c.style.width = `${box.w}px`;
      c.style.height = `${tile.h}px`;
    }
    return cleared;
  };

  const make = (index: number): Tile => {
    const band = cut[index]!;
    const tile: Tile = { index, top: band.top, h: band.h, density: densityNow(), sheets: [], dirty: true, painted: false };
    let after: Element | null = standIns[index] ?? null;
    for (let s = 0; s < sheetCount; s++) {
      const c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      c.setAttribute('data-kb-effect-ink', '');
      if (options.className) c.className = options.className;
      c.style.position = 'absolute';
      c.style.pointerEvents = 'none';
      if (after) after.after(c); else host.appendChild(c);
      after = c;
      tile.sheets.push(c);
    }
    place(tile);
    tiles.set(index, tile);
    return tile;
  };

  /* A canvas's memory is freed with its size, not when the page gets to the element. */
  const release = (tile: Tile) => {
    for (const c of tile.sheets) { c.width = 0; c.height = 0; c.remove(); }
    tiles.delete(tile.index);
    mark(tile.index);
  };

  const paint = (tile: Tile, frame: number | null) => {
    tile.dirty = false;
    tile.sheets.forEach((c, sheet) => {
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const d = tile.density;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.setTransform(d, 0, 0, d, 0, -tile.top * d);
      ctx.beginPath();
      ctx.rect(0, tile.top, box.w, tile.h);
      ctx.clip();
      /* A painter that throws costs its tile its paint, never the other tiles or the schedule. */
      try { options.paint({ ctx, sheet, index: tile.index, top: tile.top, h: tile.h, box: { w: box.w, h: box.h }, density: d, frame }); } catch (err) { console.error(err); }
      ctx.restore();
    });
    tile.painted = true;
    mark(tile.index);
  };

  const frame = (t: number): boolean => {
    if (stopped) return false;
    if (scrollDue) { scrollDue = false; follow(false); }
    for (const tile of [...tiles.values()]) if (looping || tile.dirty) paint(tile, t);
    return looping;
  };
  const self: LoopMember = { frame, pixels: () => { let px = 0; for (const t of tiles.values()) for (const c of t.sheets) px += c.width * c.height; return px; } };

  /** Holds the tiles in `near` and no others; a tile made is painted by the next frame (asked for here unless the caller paints it itself). */
  function hold(near: readonly number[], ask: boolean): void {
    const keep = new Set(near.filter((i) => i < cut.length));
    for (const tile of [...tiles.values()]) if (!keep.has(tile.index)) release(tile);
    let made = false;
    for (const i of keep) if (!tiles.has(i)) { make(i); made = true; mark(i); }
    if (made && ask) want(self);
  }
  /** Where there is no observer: the tiles the window names. */
  function follow(ask: boolean): void {
    const v = view();
    hold(nearTiles(box.h, v.top, v.bottom), ask);
  }

  const onNear = (near: number[]) => { if (!stopped && hasObserver) hold(near, true); };

  let watcher: BandWatch | null = null;
  const resizer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
  let watched: HTMLElement | null = null;

  function measure(): void {
    if (stopped) return;
    const found = bodyOf(host);
    const next = bodyBox(host, found);
    if (found === body && sameBox(next, box)) return;
    const sized = Math.abs(next.w - box.w) >= 0.01 || Math.abs(next.h - box.h) >= 0.01;
    if (found !== body && resizer) {
      if (watched) resizer.unobserve(watched);
      if (found) { resizer.observe(found); watched = found; } else watched = null;
    }
    body = found;
    box = next;
    options.onBox?.(box, body);
    cut = bandsOf(box.h, TILE_PX);
    claim(() => watcher?.update(box));
    for (const tile of [...tiles.values()]) {
      const band = cut[tile.index];
      if (!band) { release(tile); continue; }
      tile.top = band.top; tile.h = band.h; tile.density = densityNow();
      /* A canvas given a new size is blank, and a resize is delivered before the frame is painted, so it is painted here. */
      if (place(tile) || sized) paint(tile, null);
    }
    if (!hasObserver) follow(true);
  }

  const onScroll = () => { scrollDue = true; want(self); };

  options.onBox?.(box, body);
  join(self);
  claim(() => { watcher = watchBands(host, box, TILE_PX, `${TILE_NEAR_PX}px 0px`, onNear); });
  follow(false);
  for (const tile of tiles.values()) paint(tile, null);
  if (resizer) {
    resizer.observe(host);
    if (body) { resizer.observe(body); watched = body; }
  }
  if (!hasObserver) window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  return {
    loop(on) {
      if (stopped) return;
      looping = on;
      if (on) want(self);
    },
    stale(rect) {
      if (stopped) return;
      let any = false;
      for (const tile of tiles.values()) {
        if (rect && !(tile.top < rect.bottom && tile.top + tile.h > rect.top)) continue;
        tile.dirty = true;
        any = true;
      }
      if (any) want(self);
    },
    paintNow() {
      if (stopped) return;
      for (const tile of [...tiles.values()]) paint(tile, null);
    },
    held: () => [...tiles.values()].map((t) => ({ index: t.index, top: t.top, h: t.h, density: t.density, sheets: t.sheets })),
    measure,
    stop() {
      if (stopped) return;
      stopped = true;
      resizer?.disconnect();
      if (!hasObserver) window.removeEventListener('scroll', onScroll, { capture: true });
      for (const tile of [...tiles.values()]) release(tile);
      watcher?.stop();
      standIns = [];
      forget(self);
    },
  };
}
