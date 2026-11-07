/* A .test.tsx because the cling layer reads the DOM (rects, the pointer query, the body) and needs jsdom. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokensOf, ratio } from '../contrast.ts';
import { POST_INK } from './band.ts';
import { cling, dropLoose, IDLE_MS, landAll, loose, MAX_CARRIED, MAX_LOOSE, makeFlakes, shake, SHAKE_SPEED, sweepLoose, burst, type Flakes } from './flakes.ts';

/* Divided World's glint (the engine may not import the instance, so the tests carry a copy). */
const GLINT = '#ffffff';
const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];

const light = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8')).light;

/* What the cling layer's context was told to draw. */
const drawn = { fills: new Set<string>(), strokes: new Set<string>(), alphas: [] as number[] };
const ops = { save: 0, restore: 0, fillRect: 0 };
const fakeCtx = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'save' || k === 'restore' || k === 'fillRect') return () => { ops[k]++; };
    return () => {};
  },
  set: (_t, k, v) => {
    if (k === 'fillStyle') drawn.fills.add(String(v));
    if (k === 'strokeStyle') drawn.strokes.add(String(v));
    if (k === 'globalAlpha') drawn.alphas.push(v as number);
    return true;
  },
});
let fine = true;
let reduceDevice = false;
let clock = 0;
/* What the page was asked: media queries made, listeners added and removed, rects measured. */
const asked = { matchMedia: 0, adds: 0, removes: 0, rects: 0, styles: 0 };
let queries: Array<{ q: string; ls: Set<(e: { matches: boolean }) => void> }> = [];
/** Each host's rect, so the pointer's target can be found without measuring (what the browser tells an event). */
let placed: Array<{ el: HTMLElement; left: number; top: number; w: number; h: number }> = [];
const elAt = (x: number, y: number): Element =>
  placed.find((p) => x >= p.left && x < p.left + p.w && y >= p.top && y < p.top + p.h)?.el ?? document.body;

function host(left: number, top: number, w = 300, h = 300): HTMLElement {
  const el = document.createElement('div');
  /* The board's tokens, as the page resolves them on a light board: the band each flake is lent against. */
  for (const k of ['--kb-bg', ...POST_INK]) el.style.setProperty(k, light[k]!);
  placed.push({ el, left, top, w, h });
  el.getBoundingClientRect = () => (asked.rects++, { left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} });
  document.body.append(el);
  return el;
}
function pointer(type: string, x: number, y: number, t?: number): PointerEvent {
  const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: type });
  Object.defineProperty(e, 'timeStamp', { value: t ?? (clock += 1) });
  Object.defineProperty(e, 'target', { value: elAt(x, y) });
  return e as PointerEvent;
}
const move = (x: number, y: number, type = 'mouse') => window.dispatchEvent(pointer(type, x, y));
const layer = () => document.querySelector('canvas[data-kb-shine="cling"]');

beforeEach(() => {
  vi.useFakeTimers();
  ops.save = 0; ops.restore = 0; ops.fillRect = 0;
  fine = true;
  reduceDevice = false;
  clock = 0;
  placed = []; queries = [];
  Object.assign(asked, { matchMedia: 0, adds: 0, removes: 0, rects: 0, styles: 0 });
  drawn.fills.clear(); drawn.strokes.clear(); drawn.alphas.length = 0;
  document.documentElement.setAttribute('data-kb-motion', 'full');
  vi.stubGlobal('matchMedia', (q: string) => {
    asked.matchMedia++;
    const ls = new Set<(e: { matches: boolean }) => void>();
    queries.push({ q, ls });
    return {
      get matches() { return q.includes('hover: hover') ? fine : q.includes('reduced-motion') ? reduceDevice : false; },
      addEventListener(_t: string, fn: (e: { matches: boolean }) => void) { asked.adds++; ls.add(fn); },
      removeEventListener(_t: string, fn: (e: { matches: boolean }) => void) { asked.removes++; ls.delete(fn); },
    };
  });
  const realStyle = window.getComputedStyle.bind(window);
  vi.stubGlobal('getComputedStyle', (el: Element) => (asked.styles++, realStyle(el)));
  document.elementFromPoint = (x: number, y: number) => elAt(x, y);
  window.matchMedia = globalThis.matchMedia;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx) as never;
});
afterEach(() => {
  cling.reset();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A sticky post at the left of the page, a plain one far to the right, and nothing between. */
function page() {
  const flakes = makeFlakes({ seed: 'sticky', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
  const a = host(0, 0), b = host(2000, 0);
  let landed = 0;
  cling.register(a, { sticky: true, flakes });
  cling.register(b, { landed: () => landed++ });
  return { a, b, landed: () => landed };
}
/** Sweeps the pointer over the sticky post until it carries all it can. */
function load() {
  for (let i = 0; i < 400; i++) { cling.over(pointer('mouse', 10 + (i % 2) * 120, 100)); move(10 + (i % 2) * 120, 100); }
}
/** Carries a load off the post onto the plain one, and steps time until all has landed. */
function carryOver(x = 2100) {
  load();
  for (let i = 0; i < 400 && cling.carried(); i++) move(x + (i % 2) * 120, 100);
  for (let t = 0; (cling.falling() || cling.carried()) && t < 10000; t += 16) cling.tick(t);
}

describe('the cling layer', () => {
  it('is made on the first pickup, page-fixed, aria-hidden and never a target', () => {
    page();
    expect(layer()).toBeNull();
    load();
    const c = layer() as HTMLCanvasElement;
    expect(c).not.toBeNull();
    expect(c.getAttribute('aria-hidden')).toBe('true');
    expect(c.style.pointerEvents).toBe('none');
    expect(c.style.position).toBe('fixed');
    expect(document.querySelectorAll('canvas[data-kb-shine="cling"]')).toHaveLength(1);
  });

  it('paints each carried and falling flake with one transform, not a save and restore', () => {
    page();
    carryOver();
    expect(ops.fillRect).toBeGreaterThan(100);
    expect(ops.save + ops.restore).toBeLessThanOrEqual(2);
  });

  it('is removed after IDLE_MS with nothing carried or falling, and not before', () => {
    page();
    carryOver();
    expect(cling.carried() + cling.falling()).toBe(0);
    cling.tick(20000);
    vi.advanceTimersByTime(IDLE_MS - 10);
    expect(layer()).not.toBeNull();
    vi.advanceTimersByTime(20);
    expect(layer()).toBeNull();
    expect(cling.active()).toBe(false);
  });

  it('stays while something is carried', () => {
    page();
    load();
    expect(cling.carried()).toBeGreaterThan(0);
    cling.tick(0);
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(layer()).not.toBeNull();
  });

  it('carries at most 26', () => {
    page();
    load();
    expect(cling.carried()).toBe(MAX_CARRIED);
    expect(MAX_CARRIED).toBe(26);
  });

  it('a touch or pen pointer, or a coarse device, picks nothing up', () => {
    page();
    for (let i = 0; i < 200; i++) { cling.over(pointer('touch', 10 + (i % 2) * 120, 100)); cling.over(pointer('pen', 10 + (i % 2) * 120, 100)); }
    fine = false;
    for (let i = 0; i < 200; i++) cling.over(pointer('mouse', 10 + (i % 2) * 120, 100));
    expect(cling.carried()).toBe(0);
    expect(layer()).toBeNull();
  });

  it('a plain host lends nothing, even to a mouse', () => {
    const { b } = page();
    void b;
    for (let i = 0; i < 200; i++) cling.over(pointer('mouse', 2010 + (i % 2) * 120, 100));
    expect(cling.carried()).toBe(0);
    expect(layer()).toBeNull();
  });

  it('picks nothing up under reduced motion', () => {
    page();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    load();
    expect(cling.carried()).toBe(0);
    expect(layer()).toBeNull();
  });

  it('a dropped flake lands on the registered host under it, and the host is told', () => {
    const { b, landed } = page();
    carryOver();
    expect(loose(b).length).toBeGreaterThan(0);
    expect(landed()).toBe(loose(b).length);
    for (const f of loose(b)) expect(f.x >= 0 && f.x < 300 && f.y >= 0 && f.y < 300).toBe(true);
  });

  it('a dropped flake over nothing fades and lands nowhere', () => {
    const { a, b } = page();
    load();
    for (let i = 0; i < 400 && cling.carried(); i++) move(1000 + (i % 2) * 120, 100);
    for (let t = 0; (cling.falling() || cling.carried()) && t < 10000; t += 16) cling.tick(t);
    expect(loose(a)).toHaveLength(0);
    expect(loose(b)).toHaveLength(0);
  });

  it('keeps at most 300 loose across the page, the oldest first to go', () => {
    const { b } = page();
    carryOver();
    const first = loose(b)[0];
    expect(first).toBeDefined();
    for (let n = 0; n < 40; n++) carryOver();
    expect(loose(b)).toHaveLength(MAX_LOOSE);
    expect(MAX_LOOSE).toBe(300);
    expect(loose(b)).not.toContain(first);
    sweepLoose();
    expect(loose(b)).toHaveLength(0);
  });

  it('paints only colors that hold 4.5:1 against every post ink on the light board, and draws no dark outline', () => {
    page();
    carryOver();
    const hex = [...drawn.fills].filter((c) => c.startsWith('#'));
    expect(hex.length).toBeGreaterThan(3);
    const bad = hex.flatMap((c) => POST_INK.filter((ink) => ratio(light[ink]!, c) < 4.5).map((ink) => `${c} on ${ink}`));
    expect(bad.slice(0, 5)).toEqual([]);
    expect([...drawn.strokes].filter((c) => c.startsWith('#000000'))).toEqual([]);
  });

  it('dropping a host frees its share of the 300 for the others', () => {
    const { b } = page();
    for (let n = 0; n < 40; n++) carryOver();
    expect(loose(b)).toHaveLength(MAX_LOOSE);
    dropLoose(b);
    expect(loose(b)).toHaveLength(0);
    for (let n = 0; n < 40; n++) carryOver();
    expect(loose(b)).toHaveLength(MAX_LOOSE);
    sweepLoose();
  });

  it('keeps the oldest-first cap of 300 across two hosts', () => {
    const { b } = page();
    const c = host(4000, 0);
    cling.register(c, {});
    carryOver();
    const oldest = loose(b)[0]!;
    for (let n = 0; n < 40; n++) carryOver();
    expect(loose(b)).toHaveLength(MAX_LOOSE);
    const bNewest = loose(b)[MAX_LOOSE - 1]!;
    for (let n = 0; n < 5; n++) carryOver(4100);
    expect(loose(c).length).toBeGreaterThan(0);
    expect(loose(b).length + loose(c).length).toBe(MAX_LOOSE);
    expect(loose(b)).not.toContain(oldest);
    expect(loose(b)).toContain(bNewest);
    expect(loose(b)[0]).not.toBe(oldest);
  });

  it('a pointer that left and came back elsewhere is not one huge move', () => {
    page();
    for (let i = 0; i < 40; i++) {
      cling.over(pointer('mouse', 10, 100, 1000 * (2 * i + 1)));
      cling.over(pointer('mouse', 250, 100, 1000 * (2 * i + 2)));
    }
    expect(cling.carried()).toBe(0);
    expect(layer()).toBeNull();
  });

  it('the fade of a flake with nowhere to land lowers its alpha', () => {
    page();
    load();
    for (let i = 0; i < 400 && cling.carried(); i++) move(1000 + (i % 2) * 120, 100);
    drawn.alphas.length = 0;
    const perTick: number[] = [];
    for (let t = 0; (cling.falling() || cling.carried()) && t < 10000; t += 16) {
      const before = drawn.alphas.length;
      cling.tick(t);
      const a = drawn.alphas.slice(before).filter((v) => v < 1);
      if (a.length) perTick.push(Math.min(...a));
    }
    expect(perTick.length).toBeGreaterThan(2);
    expect(perTick[perTick.length - 1]!).toBeLessThan(perTick[0]!);
    expect(Math.min(...perTick)).toBeLessThan(0.5);
  });

  it('switching to reduced motion while flakes are carried clears them on the next tick', () => {
    page();
    load();
    expect(cling.carried()).toBeGreaterThan(0);
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    cling.tick(0);
    expect(cling.carried()).toBe(0);
    expect(cling.falling()).toBe(0);
  });
});

describe('what the layer asks the page', () => {
  /** A page of 20 posts, the first sticky. */
  function crowd() {
    const flakes = makeFlakes({ seed: 'crowd', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    const hs = Array.from({ length: 20 }, (_, i) => host(i * 400, 0));
    cling.register(hs[0]!, { sticky: true, flakes });
    for (const h of hs.slice(1)) cling.register(h, {});
    return hs;
  }

  it('asks the browser about the pointer and motion once, not on every pointer move', () => {
    page();
    for (let i = 0; i < 10; i++) cling.over(pointer('mouse', 10 + (i % 2) * 120, 100));
    const early = asked.matchMedia;
    for (let i = 0; i < 1000; i++) { cling.over(pointer('mouse', 10 + (i % 2) * 120, 100)); move(10 + (i % 2) * 120, 100); }
    expect(asked.matchMedia).toBe(early);
    expect(early).toBeLessThanOrEqual(2);
  });

  it('measures no post on a pointer move, however many are registered', () => {
    crowd();
    load();
    expect(cling.carried()).toBeGreaterThan(0);
    for (let i = 0; i < 400; i++) move(500 + (i % 2) * 120, 100);
    expect(asked.rects).toBe(0);
  });

  it('measures at most the post a flake lands on, once, when it lands', () => {
    const hs = crowd();
    load();
    for (let i = 0; i < 400 && cling.carried(); i++) move(hs.length * 400 - 700 + (i % 2) * 120, 100);
    asked.rects = 0;
    let landed = 0;
    cling.register(hs[18]!, { landed: () => landed++ });
    for (let t = 0; (cling.falling() || cling.carried()) && t < 10000; t += 16) cling.tick(t);
    expect(landed).toBeGreaterThan(0);
    expect(asked.rects).toBeLessThanOrEqual(landed);
  });

  it('reads a board\'s computed style at most once per 100 ms of pickups', () => {
    page();
    for (let i = 0; i < 60; i++) cling.over(pointer('mouse', 10 + (i % 2) * 120, 100, 5000 + i));
    for (let i = 0; i < 60; i++) move(10 + (i % 2) * 120, 100);
    expect(cling.carried()).toBeGreaterThan(5);
    expect(asked.styles).toBeLessThanOrEqual(2);
  });

  it('follows the device when the pointer or motion query changes', () => {
    page();
    cling.over(pointer('mouse', 10, 100));
    fine = false;
    for (const q of queries.filter((x) => x.q.includes('hover: hover'))) for (const fn of q.ls) fn({ matches: false });
    load();
    expect(cling.carried()).toBe(0);
    fine = true;
    for (const q of queries.filter((x) => x.q.includes('hover: hover'))) for (const fn of q.ls) fn({ matches: true });
    document.documentElement.removeAttribute('data-kb-motion');
    for (const q of queries.filter((x) => x.q.includes('reduced-motion'))) for (const fn of q.ls) fn({ matches: true });
    load();
    expect(cling.carried()).toBe(0);
  });

  it('takes its listeners off again when it is reset', () => {
    page();
    load();
    expect(asked.adds).toBeGreaterThan(0);
    cling.reset();
    expect(asked.removes).toBe(asked.adds);
  });

  it('picks flakes up again right after the layer was disposed', () => {
    page();
    carryOver();
    cling.tick(20000);
    vi.advanceTimersByTime(IDLE_MS + 10);
    expect(cling.active()).toBe(false);
    load();
    expect(cling.active()).toBe(true);
    expect(cling.carried()).toBe(MAX_CARRIED);
  });
});

/**
 * A fast scroll shakes glitter off (the touch reader's way to move it, where a mouse picks it up): flakes leave the posts on screen,
 * fall on the page-fixed layer outside the post's box and land on whichever host is under them, or fade.
 */
describe('a fast scroll shakes glitter off', () => {
  /** A sticky post on screen whose burst is over, and one far off screen; the jsdom viewport is 1024 by 768. */
  function posts() {
    const f = makeFlakes({ seed: 'shook', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    landAll(f);
    const off = makeFlakes({ seed: 'away', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    landAll(off);
    const a = host(100, 100), far = host(100, 5000);
    let told = 0;
    cling.register(a, { sticky: true, flakes: f, landed: () => told++ });
    cling.register(far, { sticky: true, flakes: off });
    return { f, off, told: () => told };
  }

  it('sends copies of flakes on the post on screen into the falling layer and leaves the post as it was, so nothing repaints it', () => {
    const { f, told } = posts();
    const before = [...f.settled];
    const n = shake(SHAKE_SPEED * 2, 0);
    expect(n).toBeGreaterThan(0);
    expect(cling.falling()).toBe(n);
    expect(layer()).not.toBeNull();
    /* The post keeps every flake where it was, so its base layer's key (and paint) does not change, and it is not told to redraw. */
    expect(f.settled).toEqual(before);
    expect(told()).toBe(0);
  });

  it('throws them the way the page was moving: up the screen on a scroll down, then they fall and land or fade', () => {
    const { f } = posts();
    shake(SHAKE_SPEED * 2, 0);
    const start = cling.falling();
    cling.tick(0); cling.tick(16);
    for (let t = 32; cling.falling() && t < 20000; t += 16) cling.tick(t);
    expect(cling.falling()).toBe(0);
    /* What landed on the post it came from is loose there; the rest faded over nothing. */
    expect(loose(document.body.children[0]!).length).toBeLessThanOrEqual(start);
    expect(f.settled.length).toBe(f.total);
  });

  it('shakes nothing under its speed, under reduced motion, or off a post still bursting', () => {
    const { f } = posts();
    expect(shake(SHAKE_SPEED * 0.5, 0)).toBe(0);
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    expect(shake(SHAKE_SPEED * 3, 0)).toBe(0);
    document.documentElement.setAttribute('data-kb-motion', 'full');
    cling.reset();
    const flying: Flakes = makeFlakes({ seed: 'mid', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    burst(flying, 0);
    cling.register(host(100, 100), { sticky: true, flakes: flying });
    expect(flying.flying).toBeGreaterThan(0);
    expect(shake(SHAKE_SPEED * 3, 0)).toBe(0);
    expect(f.settled.length).toBe(f.total);
  });

  it('at most 8 off a post in a frame, and at most 160 falling across the page, however long the scroll', () => {
    posts();
    expect(shake(SHAKE_SPEED * 10, 0)).toBe(8);
    for (let i = 1; i < 100; i++) shake(SHAKE_SPEED * 10, i);
    expect(cling.falling()).toBe(160);
  });

  it('listens to the page\'s scroll only while a sticky post is registered', () => {
    const adds = vi.spyOn(window, 'addEventListener'), removes = vi.spyOn(window, 'removeEventListener');
    const off = cling.register(host(0, 0), { landed: () => {} });
    expect(adds.mock.calls.filter(([t]) => t === 'scroll')).toHaveLength(0);
    const sticky = cling.register(host(0, 400), { sticky: true, flakes: makeFlakes({ seed: 's', box: { w: 10, h: 10 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT }) });
    expect(adds.mock.calls.filter(([t]) => t === 'scroll')).toHaveLength(1);
    expect(adds.mock.calls.find(([t]) => t === 'scroll')![2]).toEqual({ passive: true });
    sticky();
    expect(removes.mock.calls.filter(([t]) => t === 'scroll')).toHaveLength(1);
    off();
  });
});
