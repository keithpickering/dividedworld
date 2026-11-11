/**
 * Where glitter lands and how it lies (docs/plans/2026-11-11-shake-design.md sections 4 and 5). A flake that settles after its flight
 * lands on a post's cell, on the page, or on a Glitter Bomb's own surface (that one is the effect's, in
 * `instances/divided-world/ui/glitter-bomb/`, and the engine only knows it as a host that draws its own loose glitter). This file is
 * the first two, and how what lies there is drawn:
 *
 * - `landPost(article)` registers each of a post's cells (its element children but a visually hidden heading) as a landing place of
 *   the `cell` rank, so a Glitter Bomb on the body wins the body (docs/plans/2026-11-11-shake-plan.md, task 1). Its way out lets go of
 *   them and drops their glitter and tiles.
 * - `landPage()` makes the thread screen's own page a landing place, in document px, wherever the ground under the point is the page's
 *   (`groundOf`) and no registered host is there. Its way out sweeps every loose flake on the page and removes the page's tiles.
 * - Tiles: a canvas of at most `TILE_W` by `TILE_H` CSS px of a surface's own px, made where the first flake lands in that cell of the
 *   grid, `aria-hidden`, taking no pointer. A post cell's tiles are placed in the cell, under its content, and the page's in the body,
 *   under the frame (the stacking is CSS: `engine/ui/thread/thread.css` and `engine/ui/base.css`). A tile is watched with `watchInView`:
 *   out of view its backing store is zero, and on return it is sized at the density and drawn again. Landed glitter lies still, so a tile
 *   is drawn when a flake lands on it (every landing of a frame together, once, at the frame's end) and when it returns to view, and by
 *   nothing else: no tile is registered with the loop.
 *
 * Units: a flake's `x, y` are CSS px in its surface's own space (the cell's top left, or the document's). Nothing here reads who owns a
 * post or who reacted. Engine code: it names no card and no instance.
 */
import { cling, drawFlake, dropLoose, loose, looseEntries, setLanding, sweepLoose, type Landing, type LooseFlake } from './flakes.ts';
import { watchInView } from './inView.ts';
import { MAX_DENSITY } from './loop.ts';

export const TILE_W = 512;
export const TILE_H = 256;
/** A flake's square reaches this far past its center (a flake is at most 3.4 px across, and a px more for the smoothing). */
const REACH = 4;

interface Tile {
  readonly s: Surface; readonly tx: number; readonly ty: number; readonly canvas: HTMLCanvasElement;
  inView: boolean; stop: () => void;
}
interface Surface {
  readonly kind: 'cell' | 'page'; readonly host: object; readonly el: HTMLElement | null;
  readonly tiles: Map<string, Tile>;
}

const surfaces = new Map<object, Surface>();
/** The tiles a landing in this frame has marked: each in view is drawn once at the frame's end. */
const marked = new Set<Tile>();
let draws = 0;
/** The page surface's host, and how many screens hold it live. */
const pageHost = {};
let pageHolds = 0;
let onResize: (() => void) | null = null;
/** Whether an element's point is the page's ground, per element, for the frame being run. */
let ground = new Map<Element, boolean>();

const density = (): number => Math.min(MAX_DENSITY, Math.max(1, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
const key = (tx: number, ty: number): string => `${tx},${ty}`;

/* ------------------------------------------------------------- the ground ---- */

/** Whether an element paints a ground of its own: a background color that is not fully transparent, or a background image. */
function paintsGround(el: Element): boolean {
  const st = getComputedStyle(el);
  const c = st.backgroundColor.trim().toLowerCase();
  if (c && c !== 'transparent' && !/^rgba?\([^)]*[,/]\s*0(\.0+)?\)$/u.test(c) && !/\/\s*0(\.0+)?\)$/u.test(c)) return true;
  const img = st.backgroundImage;
  return !!img && img !== 'none';
}

/**
 * Whether the point an element was found at is the page's ground: the walk up from it reaches `body` without passing an element
 * that paints a ground of its own (the body's own propagates to the canvas, which is what the page's tiles lie over). Each element is
 * read once a frame and the answer kept for every element the walk passed, so a burst of hundreds of flakes over a few elements is a
 * few reads, not a walk apiece.
 */
function groundOf(el: Element): boolean {
  const passed: Element[] = [];
  let answer = true;
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e === document.body || e === document.documentElement) break;
    const had = ground.get(e);
    if (had !== undefined) { answer = had; break; }
    passed.push(e);
    if (paintsGround(e)) { answer = false; break; }
  }
  for (const e of passed) ground.set(e, answer);
  return answer;
}

/* ------------------------------------------------------------- the tiles ---- */

/** A surface's size in its own px: a cell's box, the document's. */
function sizeOf(s: Surface): { w: number; h: number } {
  const fin = (n: number): number => (Number.isFinite(n) ? n : 0);
  if (s.el) { const r = s.el.getBoundingClientRect(); return { w: fin(r.width), h: fin(r.height) }; }
  const de = document.documentElement;
  /* The client width, not the window's: a tile past the scrollbar's edge would make the page scroll sideways. */
  return { w: fin(de.clientWidth || innerWidth), h: fin(Math.max(de.scrollHeight, innerHeight, window.scrollY + innerHeight)) };
}

/** The tiles of a surface's grid a flake's square touches. */
function tilesOf(f: LooseFlake): Array<[number, number]> {
  const x0 = Math.max(0, Math.floor((f.x - REACH) / TILE_W)), x1 = Math.max(0, Math.floor((f.x + REACH) / TILE_W));
  const y0 = Math.max(0, Math.floor((f.y - REACH) / TILE_H)), y1 = Math.max(0, Math.floor((f.y + REACH) / TILE_H));
  const out: Array<[number, number]> = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push([tx, ty]);
  return out;
}

function removeTile(t: Tile): void {
  t.stop();
  marked.delete(t);
  t.canvas.width = 0; t.canvas.height = 0;
  t.canvas.remove();
  t.s.tiles.delete(key(t.tx, t.ty));
  if (!t.s.tiles.size && t.s.el) t.s.el.removeAttribute('data-kb-landed');
}

function removeTiles(s: Surface): void {
  for (const t of [...s.tiles.values()]) removeTile(t);
}

/** Puts a tile's canvas where it stands (inside its cell, or in the body), again if something under it took it away. */
function attach(t: Tile): void {
  try {
    const into = t.s.el ?? document.body;
    if (t.canvas.parentElement !== into) into.append(t.canvas);
  } catch { /* a cell taken apart under it: the next call puts it back */ }
}

/** Sizes the tile's box to what is left of its surface from its corner, and its backing store to that at the density. */
function fit(t: Tile): { w: number; h: number } {
  const size = sizeOf(t.s);
  const w = Math.max(1, Math.min(TILE_W, Math.ceil(size.w - t.tx * TILE_W))), h = Math.max(1, Math.min(TILE_H, Math.ceil(size.h - t.ty * TILE_H)));
  const st = t.canvas.style;
  st.position = 'absolute'; st.left = `${t.tx * TILE_W}px`; st.top = `${t.ty * TILE_H}px`; st.width = `${w}px`; st.height = `${h}px`; st.pointerEvents = 'none';
  return { w, h };
}

/**
 * Draws a tile from the flakes that lie in it. A tile left with none is taken away, unless `keep` (a refit: the surface may grow
 * back over its flakes, so the tile stays and holds no backing store).
 */
function draw(t: Tile, keep = false): void {
  attach(t);
  const { w, h } = fit(t);
  const d = density();
  const x0 = t.tx * TILE_W, y0 = t.ty * TILE_H;
  const mine = loose(t.s.host).filter((f) => f.x + REACH >= x0 && f.x - REACH < x0 + w && f.y + REACH >= y0 && f.y - REACH < y0 + h) as LooseFlake[];
  if (!mine.length) {
    if (keep) { t.canvas.width = 0; t.canvas.height = 0; } else removeTile(t);
    return;
  }
  /* Sizing the backing store clears it. */
  t.canvas.width = Math.ceil(w * d); t.canvas.height = Math.ceil(h * d);
  const c = t.canvas.getContext('2d');
  draws++;
  if (!c) return;
  for (const f of mine) if (f.band) drawFlake(c, f, f.x - x0, f.y - y0, f.ph ?? 0, f.band, d);
}

/** A surface changed size: every tile is fitted to what is left of it, and one in view is drawn again. */
function refit(s: Surface): void {
  for (const t of [...s.tiles.values()]) {
    attach(t);
    fit(t);
    if (t.inView) draw(t, true);
  }
}

function makeTile(s: Surface, tx: number, ty: number): Tile {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.kbLanding = s.kind;
  canvas.width = 0; canvas.height = 0;
  const t: Tile = { s, tx, ty, canvas, inView: false, stop: () => {} };
  s.tiles.set(key(tx, ty), t);
  /* Marked before it is watched: a browser with no observer says "in view" at once, and the frame's end draws it. */
  marked.add(t);
  attach(t);
  fit(t);
  t.stop = watchInView(canvas, (inView) => {
    if (s.tiles.get(key(tx, ty)) !== t) return;
    /* A tile React took out of its cell is seen as out of view; it is put back so the observer can see it return. */
    attach(t);
    t.inView = inView;
    if (!inView) { canvas.width = 0; canvas.height = 0; return; }
    /* Back in view, or seen for the first time: drawn from its flakes unless this frame's landings are about to draw it. */
    if (!marked.has(t)) draw(t);
  });
  return t;
}

/** Marks the tiles a flake touches (made where there are none yet, if `make`). */
function mark(s: Surface, f: LooseFlake, make: boolean): void {
  for (const [tx, ty] of tilesOf(f)) {
    const had = s.tiles.get(key(tx, ty));
    if (had) marked.add(had);
    else if (make) makeTile(s, tx, ty);
    if (make && s.el) s.el.setAttribute('data-kb-landed', '');
  }
}

/** The end of a frame that moved flakes: every marked tile in view is drawn once, and the next frame reads its grounds afresh. */
function frameEnd(): void {
  ground = new Map();
  if (!marked.size) return;
  const these = [...marked];
  marked.clear();
  for (const t of these) if (t.inView && t.s.tiles.get(key(t.tx, t.ty)) === t) draw(t);
}

/* ------------------------------------------------------------ the hooks ---- */

const hooks: Landing = {
  page: null,
  ground: groundOf,
  dropped(host, f) { const s = surfaces.get(host); if (s) mark(s, f, false); },
  frameEnd,
};
let hooked = 0;
function hold(): void { if (hooked++ === 0) setLanding(hooks); }
function release(): void { if (--hooked === 0) { setLanding(null); marked.clear(); ground = new Map(); } }

/* ----------------------------------------------------------------- API ---- */

/**
 * Registers a post's cells as landing places. Called when the post mounts; the way out is for when it unmounts. A cell the post adds
 * later is not one (the cells are read once).
 */
export function landPost(article: HTMLElement): () => void {
  const mine: Array<{ cell: HTMLElement; s: Surface; off: () => void }> = [];
  for (const child of Array.from(article.children)) {
    if (!(child instanceof HTMLElement) || child.classList.contains('kb-visually-hidden')) continue;
    const s: Surface = { kind: 'cell', host: child, el: child, tiles: new Map() };
    surfaces.set(child, s);
    const off = cling.register(child, { rank: 'cell', landed: () => { const l = loose(child); const f = l[l.length - 1]; if (f) mark(s, f as LooseFlake, true); } });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => refit(s)); ro.observe(child); }
    mine.push({ cell: child, s, off: () => { off(); ro?.disconnect(); } });
  }
  hold();
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    for (const { cell, s, off } of mine) {
      off();
      dropLoose(cell);
      removeTiles(s);
      surfaces.delete(cell);
      cell.removeAttribute('data-kb-landed');
    }
    release();
  };
}

/**
 * The thread screen's page as a landing place, in document px, and the screen's way out of its glitter: the way out sweeps every
 * loose flake on the page and removes every tile. Glitter ends when the reader leaves the thread.
 */
export function landPage(): () => void {
  if (pageHolds++ === 0) {
    const s: Surface = { kind: 'page', host: pageHost, el: null, tiles: new Map() };
    surfaces.set(pageHost, s);
    onResize = () => refit(s);
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
    hooks.page = { host: pageHost, landed: () => { const l = loose(pageHost); const f = l[l.length - 1]; if (f) mark(s, f as LooseFlake, true); } };
  }
  hold();
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    if (--pageHolds === 0) {
      if (onResize) window.removeEventListener('resize', onResize);
      onResize = null;
      sweepLoose();
      for (const s of surfaces.values()) removeTiles(s);
      surfaces.delete(pageHost);
      hooks.page = null;
    }
    release();
  };
}

/** For tests and stories: what is live now and what has been drawn. */
export const probe = {
  /** Live tiles, by the kind of surface they lie on. */
  tiles(): { cell: number; page: number } {
    const out = { cell: 0, page: 0 };
    for (const s of surfaces.values()) out[s.kind] += s.tiles.size;
    return out;
  },
  /** Tile draws so far. */
  draws: (): number => draws,
  /** Loose flakes by the kind of surface they lie on: an effect's own surface, a post cell, or the page. */
  landed(): { effect: number; cell: number; page: number } {
    const out = { effect: 0, cell: 0, page: 0 };
    for (const e of looseEntries()) out[surfaces.get(e.host)?.kind ?? 'effect']++;
    return out;
  },
  /** For tests only: forget every surface and tile, and the count of draws. */
  reset(): void {
    for (const s of surfaces.values()) removeTiles(s);
    surfaces.clear();
    marked.clear();
    ground = new Map();
    if (onResize) window.removeEventListener('resize', onResize);
    onResize = null;
    draws = 0; pageHolds = 0; hooked = 0; hooks.page = null;
    setLanding(null);
  },
};
