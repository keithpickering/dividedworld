/**
 * Where glitter lands and how it lies (docs/plans/2026-11-11-shake-design.md sections 4 and 5): a post's cells, the page, the
 * Glitter Bomb's own surface, the tiles that draw what lies still, and the 300 across all of them. A .test.tsx because the landing
 * reads the DOM (rects, computed backgrounds, the body); `elementFromPoint` and rects are faked as flakes.test.tsx does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokensOf } from '../contrast.ts';
import { POST_INK } from './band.ts';
import { cling, landAll, loose, makeFlakes, MAX_AIR, MAX_LOOSE, shake, SHAKE_SPEED, type Flakes } from './flakes.ts';
import { landPage, landPost, probe } from './landing.ts';

const GLINT = '#ffffff';
const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];
const light = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8')).light;

/* What each tile's context was told: the fills of every draw, per canvas. */
const fills = new Map<HTMLCanvasElement, number>();
const fakeCtx = (canvas: HTMLCanvasElement) => new Proxy({}, {
  get: (_t, k) => {
    if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'fillRect') return () => { fills.set(canvas, (fills.get(canvas) ?? 0) + 1); };
    return () => {};
  },
  set: () => true,
});
let clock = 0;
let placed: Array<{ el: HTMLElement; left: number; top: number; w: number; h: number }> = [];
const asked = { styles: 0, froms: 0 };
const elAt = (x: number, y: number): Element =>
  placed.find((p) => x >= p.left && x < p.left + p.w && y >= p.top && y < p.top + p.h)?.el ?? document.body;

/** An element with a rect and the board's tokens (the band its flakes are lent against), placed so a pointer finds it. */
function box(left: number, top: number, w: number, h: number, parent: HTMLElement = document.body, track = true): HTMLElement {
  const el = document.createElement('div');
  for (const k of ['--kb-bg', ...POST_INK]) el.style.setProperty(k, light[k]!);
  if (track) placed.push({ el, left, top, w, h });
  el.getBoundingClientRect = () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} });
  parent.append(el);
  return el;
}
function pointer(type: string, x: number, y: number): PointerEvent {
  const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: type });
  Object.defineProperty(e, 'timeStamp', { value: (clock += 1) });
  Object.defineProperty(e, 'target', { value: elAt(x, y) });
  return e as PointerEvent;
}
const move = (x: number, y: number) => window.dispatchEvent(pointer('mouse', x, y));

/** A sticky host far off the screen that lends flakes, so a drop can be aimed. */
let source: HTMLElement;
function lend(): void {
  for (let i = 0; i < 400; i++) { cling.over(pointer('mouse', 5010 + (i % 2) * 120, 100)); move(5010 + (i % 2) * 120, 100); }
}
/** Picks up 26 and drops them in one move at (x, y): a move this far lets go of all of them. */
function drop(x: number, y: number): void {
  lend();
  move(x, y);
}
/** Steps time until nothing is carried or in the air (or `limit` ms), a frame at a time; returns the clock. */
function settle(t = 0, limit = 12000): number {
  const end = t + limit;
  for (; (cling.falling() || cling.carried()) && t < end; t += 16) cling.tick(t);
  return t;
}
/** Steps frames and returns how many draws each frame made. */
function stepDraws(t0: number, frames: number): { t: number; per: number[] } {
  const per: number[] = [];
  let t = t0;
  for (let i = 0; i < frames; i++, t += 16) { const was = probe.draws(); cling.tick(t); per.push(probe.draws() - was); }
  return { t, per };
}

/** A plain post: a hidden heading and four cells, each with a rect, as ActArticle lays it out. */
function post(): { article: HTMLElement; postbit: HTMLElement; meta: HTMLElement; main: HTMLElement; actions: HTMLElement } {
  const article = box(0, 0, 0, 0, document.body, false);
  const h = document.createElement('h2');
  h.className = 'kb-visually-hidden';
  article.append(h);
  const postbit = box(20, 100, 70, 300, article), meta = box(100, 100, 600, 30, article), main = box(100, 130, 600, 300, article), actions = box(100, 430, 600, 30, article);
  return { article, postbit, meta, main, actions };
}
const pageTiles = (): HTMLCanvasElement[] => [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-kb-landing="page"]')];
const cellTiles = (cell: Element): HTMLCanvasElement[] => [...cell.querySelectorAll<HTMLCanvasElement>('canvas[data-kb-landing="cell"]')];

class FakeObserver {
  static all: FakeObserver[] = [];
  seen = new Set<Element>();
  constructor(readonly cb: IntersectionObserverCallback) { FakeObserver.all.push(this); }
  observe(el: Element) { this.seen.add(el); }
  unobserve(el: Element) { this.seen.delete(el); }
  disconnect() { this.seen.clear(); }
  takeRecords() { return []; }
  /** Tells the page `el` is (or is not) in view. */
  static report(el: Element, isIntersecting: boolean): void {
    for (const o of FakeObserver.all) if (o.seen.has(el)) o.cb([{ target: el, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry], o as unknown as IntersectionObserver);
  }
}

class FakeResize {
  static all: FakeResize[] = [];
  seen = new Set<Element>();
  constructor(readonly cb: ResizeObserverCallback) { FakeResize.all.push(this); }
  observe(el: Element) { this.seen.add(el); }
  unobserve(el: Element) { this.seen.delete(el); }
  disconnect() { this.seen.clear(); }
  /** Tells the page `el` changed size. */
  static fire(el: Element): void {
    for (const o of FakeResize.all) if (o.seen.has(el)) o.cb([{ target: el } as ResizeObserverEntry], o as unknown as ResizeObserver);
  }
  static live(): number { return FakeResize.all.reduce((n, o) => n + o.seen.size, 0); }
}
const resize = (el: HTMLElement, w: number, h: number): void => {
  el.getBoundingClientRect = () => ({ left: 100, top: 130, right: 100 + w, bottom: 130 + h, width: w, height: h, x: 100, y: 130, toJSON() {} });
};

let outs: Array<() => void> = [];
const keep = (out: () => void): (() => void) => { outs.push(out); return out; };

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0; placed = []; outs = [];
  fills.clear(); FakeObserver.all = []; FakeResize.all = [];
  vi.stubGlobal('ResizeObserver', FakeResize);
  Object.assign(asked, { styles: 0, froms: 0 });
  document.documentElement.setAttribute('data-kb-motion', 'full');
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return q.includes('hover: hover'); },
    addEventListener() {}, removeEventListener() {},
  }));
  window.matchMedia = globalThis.matchMedia;
  const realStyle = window.getComputedStyle.bind(window);
  vi.stubGlobal('getComputedStyle', (el: Element) => (asked.styles++, realStyle(el)));
  document.elementFromPoint = (x: number, y: number) => elAt(x, y);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('scrollX', 0);
  vi.stubGlobal('devicePixelRatio', 1);
  HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement) { return fakeCtx(this); }) as never;
  const flakes: Flakes = makeFlakes({ seed: 'lend', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
  landAll(flakes);
  source = box(5000, 0, 300, 300);
  cling.register(source, { sticky: true, flakes });
});
afterEach(() => {
  for (const out of outs.splice(0)) out();
  probe.reset();
  cling.reset();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('where a flake lands', () => {
  it('a plain post\'s body takes it in the cell\'s own px and makes one tile; a second landing in that tile makes none and one draw a frame', () => {
    const { article, main, postbit } = post();
    keep(landPost(article));
    drop(300, 250);
    const first = stepDraws(0, 200);
    expect(cling.falling()).toBe(0);
    const n = loose(main).length;
    expect(n).toBeGreaterThan(5);
    expect(probe.landed()).toEqual({ effect: 0, cell: n, page: 0 });
    expect(loose(postbit)).toHaveLength(0);
    for (const f of loose(main)) expect(f.x >= 140 && f.x < 280 && f.y >= 80 && f.y < 200).toBe(true);
    expect(probe.tiles()).toEqual({ cell: 1, page: 0 });
    expect(cellTiles(main)).toHaveLength(1);
    expect(main.hasAttribute('data-kb-landed')).toBe(true);
    /* One draw in each frame that had a landing, never more. */
    expect(first.per.every((d) => d <= 1)).toBe(true);
    const drawn = probe.draws();
    expect(drawn).toBeGreaterThanOrEqual(1);
    drop(350, 280);
    const second = stepDraws(4000, 200);
    expect(loose(main).length).toBeGreaterThan(n);
    expect(probe.tiles()).toEqual({ cell: 1, page: 0 });
    expect(second.per.every((d) => d <= 1)).toBe(true);
    expect(probe.draws()).toBeGreaterThan(drawn);
    /* The tile's real size: main is 600 by 300, so its tile is the full 512 by 256 grid cell at its corner. */
    const tile = cellTiles(main)[0]!;
    expect([tile.style.width, tile.style.height, tile.style.left, tile.style.top]).toEqual(['512px', '256px', '0px', '0px']);
  });

  it('a bombed post\'s body goes to the Glitter Bomb\'s surface, not the cell', () => {
    const { article, main } = post();
    keep(landPost(article));
    const surface = box(100, 130, 600, 300, main, false);
    let told = 0;
    keep(cling.register(surface, { hit: main, landed: () => told++ }));
    drop(300, 250);
    settle();
    expect(loose(surface).length).toBeGreaterThan(5);
    expect(told).toBe(loose(surface).length);
    expect(loose(main)).toHaveLength(0);
    expect(probe.landed()).toEqual({ effect: loose(surface).length, cell: 0, page: 0 });
    expect(probe.tiles()).toEqual({ cell: 0, page: 0 });
  });

  it('a margin whose ground is the page\'s takes it in document px, the scroll added', () => {
    keep(landPage());
    vi.stubGlobal('scrollY', 1000);
    drop(900, 300);
    settle();
    const n = probe.landed().page;
    expect(n).toBeGreaterThan(5);
    expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: n });
    const tiles = pageTiles();
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    /* (900, 1300) in the document is tile column 1, row 5 (a 512 by 256 grid), and the tile stands at its own corner. */
    expect(tiles.some((t) => t.style.left === '512px' && t.style.top === '1280px')).toBe(true);
    for (const t of tiles) expect(t.parentElement).toBe(document.body);
  });

  it('over an element with its own ground it lands nowhere and is still in the air, and lands once it is over the page\'s ground', () => {
    keep(landPage());
    const banner = box(0, 0, 1024, 300);
    banner.style.backgroundColor = '#223344';
    drop(500, 30);
    const t = settle(0, 1500);
    expect(cling.falling()).toBeGreaterThan(5);
    expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: 0 });
    expect(pageTiles()).toHaveLength(0);
    expect(t).toBeGreaterThanOrEqual(1500);
    /* The bar goes (it is not under them any more): what is still falling lands on the page at the next check. */
    placed = [];
    banner.remove();
    settle(t);
    expect(cling.falling()).toBe(0);
    expect(probe.landed().page).toBeGreaterThan(5);
  });

  it('an element whose ancestor paints a ground is not the page\'s ground, however plain it is itself', () => {
    keep(landPage());
    const wrap = box(0, 0, 1024, 768, document.body, false);
    wrap.style.backgroundColor = 'rgb(10, 20, 30)';
    const leaf = box(0, 0, 1024, 768, wrap);
    drop(500, 300);
    settle(0, 3000);
    expect(leaf.isConnected).toBe(true);
    expect(probe.landed().page).toBe(0);
    expect(cling.falling()).toBeGreaterThan(5);
  });

  /* Landings come in bursts: 400 flakes in the air hit-test in a few frames' worth of checks, each over the same few elements. */
  it('reads an element\'s ground at most once a frame, however many flakes are over it', () => {
    keep(landPage());
    const flakes: Flakes = makeFlakes({ seed: 'shook', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    landAll(flakes);
    const posts = box(100, 100, 300, 300);
    keep(cling.register(posts, { sticky: true, flakes }));
    for (let i = 0; i < 10; i++) shake(-SHAKE_SPEED * 1.1, 0, 1);
    expect(cling.falling()).toBe(MAX_AIR);
    /* Under them now: a bar with a ground, two plain wrappers and a leaf, so the walk up passes three elements before it stops. */
    placed = [];
    const bar = box(0, 0, 1024, 768, document.body, false);
    bar.style.backgroundColor = 'rgb(10, 20, 30)';
    const mid = box(0, 0, 1024, 768, bar, false);
    const leaf = box(0, 0, 1024, 768, mid);
    expect(leaf.isConnected).toBe(true);
    let t = 0;
    for (; t < 1000; t += 16) cling.tick(t);
    let most = 0, total = 0;
    for (const end = t + 1000; t < end; t += 16) {
      asked.styles = 0;
      cling.tick(t);
      most = Math.max(most, asked.styles);
      total += asked.styles;
    }
    expect(cling.falling()).toBeGreaterThan(MAX_AIR * 0.9);
    expect(total).toBeGreaterThan(0);
    /* leaf, mid, bar: three reads for a frame's dozens of flakes (jsdom adds one of its own), never a walk a flake. */
    expect(most).toBeLessThanOrEqual(4);
  });

  it('under reduced motion nothing flies, so nothing lands', () => {
    const { article } = post();
    keep(landPost(article));
    keep(landPage());
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    drop(300, 250);
    drop(900, 300);
    settle();
    expect(cling.carried()).toBe(0);
    expect(cling.falling()).toBe(0);
    expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: 0 });
    expect(probe.tiles()).toEqual({ cell: 0, page: 0 });
  });
});

describe('the tiles', () => {
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', FakeObserver); });

  it('a tile out of view holds no backing store, is drawn again on return at the density, and a tile in view is not drawn when nothing landed', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    expect(probe.tiles().cell).toBe(1);
    /* Not seen yet: no backing store, nothing drawn. */
    expect(tile.width).toBe(0);
    expect(probe.draws()).toBe(0);
    FakeObserver.report(tile, true);
    expect(tile.width).toBe(512 * 2);
    expect(tile.height).toBe(256 * 2);
    expect(probe.draws()).toBe(1);
    FakeObserver.report(tile, false);
    expect(tile.width).toBe(0);
    expect(tile.height).toBe(0);
    expect(probe.draws()).toBe(1);
    FakeObserver.report(tile, true);
    expect(tile.width).toBe(512 * 2);
    expect(probe.draws()).toBe(2);
    /* Something stays on the pointer, so frames run; nothing lands, so nothing is drawn. */
    lend();
    expect(cling.carried()).toBeGreaterThan(0);
    const { per } = stepDraws(100000, 100);
    expect(per.every((d) => d === 0)).toBe(true);
    expect(probe.draws()).toBe(2);
  });

  it('a tile is as big as its cell where the cell is smaller than 512 by 256, so it never overflows the cell', () => {
    const { article, postbit } = post();
    keep(landPost(article));
    drop(50, 250);
    settle();
    const tile = cellTiles(postbit)[0]!;
    FakeObserver.report(tile, true);
    expect(tile.style.width).toBe('70px');
    expect(tile.style.height).toBe('256px');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.style.pointerEvents).toBe('none');
  });
});

describe('refit and re-attach', () => {
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', FakeObserver); });

  it('a cell that shrinks refits its tile to what is left of it and redraws it in view; one out of view is refit and not drawn', () => {
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    FakeObserver.report(tile, true);
    expect([tile.style.width, tile.style.height]).toEqual(['512px', '256px']);
    const draws = probe.draws();
    resize(main, 400, 150);
    FakeResize.fire(main);
    expect([tile.style.width, tile.style.height]).toEqual(['400px', '150px']);
    expect([tile.width, tile.height]).toEqual([400, 150]);
    expect(probe.draws()).toBeGreaterThan(draws);
    FakeObserver.report(tile, false);
    resize(main, 300, 100);
    const d2 = probe.draws();
    FakeResize.fire(main);
    expect([tile.style.width, tile.style.height]).toEqual(['300px', '100px']);
    expect(tile.width).toBe(0);
    expect(probe.draws()).toBe(d2);
  });

  it('a cell shrunk past all its glitter keeps its tile, and a cell that grows back has it drawn again', () => {
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    FakeObserver.report(tile, true);
    resize(main, 10, 10);
    FakeResize.fire(main);
    expect(tile.isConnected).toBe(true);
    expect(tile.style.width).toBe('10px');
    expect(tile.width).toBe(0);
    resize(main, 600, 300);
    FakeResize.fire(main);
    expect([tile.style.width, tile.width]).toEqual(['512px', 512]);
  });

  it('a window that narrows refits the page\'s tiles, and landPage\'s way out stops listening', () => {
    const add = vi.spyOn(window, 'addEventListener'), rem = vi.spyOn(window, 'removeEventListener');
    const out = keep(landPage());
    /* The page's own listeners: what landPage() itself handed addEventListener for 'resize', before anything else runs. */
    const resizes = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === 'resize').map((c) => c[1]);
    const ours = resizes(add);
    expect(ours.length).toBeGreaterThan(0);
    drop(300, 300);
    settle();
    const tile = pageTiles()[0]!;
    FakeObserver.report(tile, true);
    expect(tile.style.width).toBe('512px');
    vi.stubGlobal('innerWidth', 330);
    window.dispatchEvent(new Event('resize'));
    expect(tile.style.width).toBe('330px');
    expect(tile.width).toBe(330);
    expect(resizes(rem)).toEqual([]);
    out();
    /* Every listener the page added is the one it took away. */
    for (const l of ours) expect(resizes(rem)).toContain(l);
  });

  it('a zero or NaN rect gives a tile of a pixel, never a NaN size, and never throws', () => {
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    FakeObserver.report(tile, true);
    /* Each bad rect follows a real size, so a stale 1px cannot pass for the answer and a refused 'NaNpx' leaves 400px behind. */
    for (const [w, h] of [[NaN, NaN], [0, 0], [NaN, 0]] as const) {
      resize(main, 400, 150);
      FakeResize.fire(main);
      expect([tile.style.width, tile.style.height]).toEqual(['400px', '150px']);
      resize(main, w, h);
      expect(() => FakeResize.fire(main)).not.toThrow();
      expect([tile.style.width, tile.style.height]).toEqual(['1px', '1px']);
    }
  });

  it('a cell that resizes re-attaches a tile detached from it, though the observer has not spoken', () => {
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    /* Out of view, so refit's own draw (which attaches too) does not run: only refit's attach can bring it back. */
    FakeObserver.report(tile, false);
    main.textContent = 'replaced';
    expect(tile.isConnected).toBe(false);
    resize(main, 400, 150);
    expect(() => FakeResize.fire(main)).not.toThrow();
    expect(tile.parentElement).toBe(main);
    expect(tile.style.width).toBe('400px');
  });

  it('a tile React detached comes back to its cell when the observer next speaks, in view or not, and never throws', () => {
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    FakeObserver.report(tile, true);
    main.textContent = 'replaced';
    expect(tile.isConnected).toBe(false);
    expect(() => FakeObserver.report(tile, false)).not.toThrow();
    expect(tile.parentElement).toBe(main);
    main.textContent = 'again';
    expect(() => FakeObserver.report(tile, true)).not.toThrow();
    expect(tile.parentElement).toBe(main);
    expect(tile.width).toBe(512);
  });

  it('StrictMode\'s mount, cleanup, mount of landPost leaves one set of registrations and one tile', () => {
    const { article, main } = post();
    landPost(article)();
    expect(FakeResize.live()).toBe(0);
    const out = keep(landPost(article));
    expect(FakeResize.live()).toBe(4);
    drop(300, 250);
    settle();
    expect(cellTiles(main)).toHaveLength(1);
    expect(probe.tiles()).toEqual({ cell: 1, page: 0 });
    out();
    expect(FakeResize.live()).toBe(0);
    expect(probe.tiles()).toEqual({ cell: 0, page: 0 });
    drop(300, 250);
    settle();
    expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: 0 });
  });

  it('StrictMode\'s mount, cleanup, mount of landPage leaves one listener and no duplicate tiles', () => {
    const add = vi.spyOn(window, 'addEventListener'), rem = vi.spyOn(window, 'removeEventListener');
    const count = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === 'resize').length;
    landPage()();
    expect([count(add), count(rem)]).toEqual([1, 1]);
    const out = keep(landPage());
    expect(count(add)).toBe(2);
    drop(300, 300);
    settle();
    const n = pageTiles().length;
    expect(n).toBeGreaterThan(0);
    expect(new Set(pageTiles().map((t) => `${t.style.left},${t.style.top}`)).size).toBe(n);
    out();
    expect(pageTiles()).toHaveLength(0);
    expect(rem.mock.calls.filter((c) => c[0] === 'resize' && c[1] === add.mock.calls.filter((a) => a[0] === 'resize')[1]![1])).toHaveLength(1);
    expect(probe.landed().page).toBe(0);
  });
});

describe('the 300, and the way out', () => {
  /** Lands rounds of 26 on each of three surfaces: a plain cell, the page, and a Glitter Bomb's. */
  function threeKinds(rounds: number) {
    const { article, main } = post();
    const bomb = box(100, 500, 600, 200);
    const surface = box(100, 500, 600, 200, bomb, false);
    const outs = { post: keep(landPost(article)), page: keep(landPage()) };
    keep(cling.register(surface, { hit: bomb }));
    let t = 0;
    for (let i = 0; i < rounds; i++) { drop(300, 250); t = settle(t); }
    for (let i = 0; i < rounds; i++) { drop(900, 300); t = settle(t); }
    for (let i = 0; i < rounds; i++) { drop(300, 600); t = settle(t); }
    return { main, bomb, surface, outs, t };
  }

  it('keeps 300 across a cell, the page and an effect host, the oldest first, and redraws the tile of one it drops', () => {
    const k = threeKinds(5);
    const all = probe.landed();
    expect(all.cell + all.page + all.effect).toBe(MAX_LOOSE);
    expect(MAX_LOOSE).toBe(300);
    /* The cell was filled first, so it lost the most: the page and the effect keep their 130 and more. */
    expect(all.cell).toBeLessThan(all.page);
    expect(all.effect).toBeGreaterThan(0);
    expect(loose(k.surface).length).toBe(all.effect);
    /* A round on the effect alone dropped cell flakes: the cell's tile was drawn again with what is left, each frame a flake went. */
    const tile = cellTiles(k.main)[0];
    expect(tile).toBeDefined();
    const was = fills.get(tile!) ?? 0;
    const pages = pageTiles().map((t) => fills.get(t) ?? 0);
    expect(pages.length).toBeGreaterThan(0);
    const draws = probe.draws();
    const page = probe.landed().page;
    drop(300, 600);
    settle(k.t);
    /* The dropped flakes were the cell's: its own tile was redrawn, and the page's tiles (none of whose flakes went) were not. */
    expect(probe.landed().page).toBe(page);
    expect(fills.get(tile!)! - was).toBeGreaterThan(0);
    expect(pageTiles().map((t) => fills.get(t) ?? 0)).toEqual(pages);
    expect(probe.draws()).toBeGreaterThan(draws);
  });

  it('landPage\'s way out sweeps every loose flake and removes every tile of the page', () => {
    const k = threeKinds(1);
    expect(probe.landed().page).toBeGreaterThan(0);
    expect(pageTiles().length).toBeGreaterThan(0);
    k.outs.page();
    expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: 0 });
    expect(pageTiles()).toHaveLength(0);
    expect(probe.tiles()).toEqual({ cell: 0, page: 0 });
    expect(cellTiles(k.main)).toHaveLength(0);
    expect(k.main.hasAttribute('data-kb-landed')).toBe(false);
  });

  it('landPost\'s way out drops its cells\' glitter and tiles and lets go of the cells', () => {
    const { article, main, meta } = post();
    const out = landPost(article);
    drop(300, 250);
    settle();
    expect(probe.landed().cell).toBeGreaterThan(0);
    expect(cellTiles(main).length).toBe(1);
    out();
    expect(probe.landed().cell).toBe(0);
    expect(cellTiles(main)).toHaveLength(0);
    expect(main.hasAttribute('data-kb-landed')).toBe(false);
    expect(loose(main)).toHaveLength(0);
    expect(loose(meta)).toHaveLength(0);
    /* The cells are no longer landing places. */
    drop(300, 250);
    settle();
    expect(probe.landed().cell).toBe(0);
  });

  it('registers a post\'s element children but its visually hidden heading', () => {
    const { article, postbit, meta, main, actions } = post();
    keep(landPost(article));
    for (const [cell, x, y] of [[postbit, 50, 250], [meta, 300, 115], [main, 300, 250], [actions, 300, 445]] as const) {
      drop(x, y);
      settle();
      expect(loose(cell).length).toBeGreaterThan(0);
    }
  });

  it('a post taken apart by React under its tiles never throws: the tile comes back to its cell on the next draw', () => {
    const { article, main } = post();
    keep(landPost(article));
    drop(300, 250);
    settle();
    const tile = cellTiles(main)[0]!;
    main.textContent = 'replaced';
    expect(tile.isConnected).toBe(false);
    drop(310, 255);
    expect(() => settle(5000)).not.toThrow();
    expect(cellTiles(main)).toHaveLength(1);
  });
});
