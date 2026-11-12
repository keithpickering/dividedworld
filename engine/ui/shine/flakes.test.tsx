/* A .test.tsx because the cling layer reads the DOM (rects, the pointer query, the body) and needs jsdom. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokensOf, ratio } from '../contrast.ts';
import { POST_INK } from './band.ts';
import { cling, dropLoose, DRAG, GRAVITY, HANG_S, IDLE_MS, landAll, loose, MAX_AIR, MAX_CARRIED, MAX_LOOSE, makeFlakes, shake, SHAKE_PER_FLICK, SHAKE_SPEED, SPRAY, sweepLoose, THROW, burst, type Flakes } from './flakes.ts';

/* Divided World's glint (the engine may not import the instance, so the tests carry a copy). */
const GLINT = '#ffffff';
const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];

const light = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8')).light;

/* What the cling layer's context was told to draw. */
const drawn = { fills: new Set<string>(), strokes: new Set<string>(), alphas: [] as number[], at: [] as Array<[number, number]> };
let lastAt: [number, number] = [0, 0];
const ops = { save: 0, restore: 0, fillRect: 0, cleared: 0 };
const fakeCtx = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'clearRect') return (_x: number, _y: number, w: number, h: number) => { ops.cleared += Math.abs(w * h); };
    if (k === 'setTransform') return (_a: number, _b: number, _c: number, _d: number, e: number, f: number) => { lastAt = [e, f]; };
    if (k === 'fillRect') return () => { ops.fillRect++; drawn.at.push(lastAt); };
    if (k === 'save' || k === 'restore') return () => { ops[k]++; };
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
  ops.save = 0; ops.restore = 0; ops.fillRect = 0; ops.cleared = 0;
  fine = true;
  reduceDevice = false;
  clock = 0;
  placed = []; queries = [];
  Object.assign(asked, { matchMedia: 0, adds: 0, removes: 0, rects: 0, styles: 0 });
  drawn.fills.clear(); drawn.strokes.clear(); drawn.alphas.length = 0; drawn.at.length = 0;
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
  /* Hosts here sit far to the right; a flake that leaves the viewport's sides is gone, so the viewport is made wide. */
  beforeEach(() => { vi.stubGlobal('innerWidth', 8000); });
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

  /*
   * Issue #399. A host may take no pointer: Glitter Bomb registers the surface its canvases stand on, which has `pointer-events:
   * none` and holds nothing a pointer hits, so the pointer is over it only as the post's body, the element it is laid on. That body
   * is named as the host's `hit`; a flake picked up over it wears the surface's inks, and one that lands on it is in the surface's px.
   */
  it('a host that takes no pointer is picked up from and landed on through its hit, in the host\'s own px', () => {
    let surfaceMeasured = 0;
    const surfaceOn = (left: number, top: number): { body: HTMLElement; surface: HTMLElement } => {
      const body = host(left, top);
      const surface = document.createElement('div');
      for (const k of ['--kb-bg', ...POST_INK]) surface.style.setProperty(k, light[k]!);
      /* The body's padding box, inside its 2 px border. */
      surface.getBoundingClientRect = () => (surfaceMeasured++, { left: left + 2, top: top + 2, right: left + 298, bottom: top + 298, width: 296, height: 296, x: left + 2, y: top + 2, toJSON() {} });
      body.append(surface);
      return { body, surface };
    };
    const a = surfaceOn(0, 0), b = surfaceOn(2000, 0);
    const flakes = makeFlakes({ seed: 'sticky', box: { w: 296, h: 296 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    let landed = 0;
    cling.register(a.surface, { sticky: true, flakes, hit: a.body });
    cling.register(b.surface, { landed: () => landed++, hit: b.body });
    carryOver();
    expect(loose(b.surface).length).toBeGreaterThan(0);
    expect(loose(b.body)).toHaveLength(0);
    expect(landed).toBe(loose(b.surface).length);
    /* In the surface's px: each landing measures the surface it lands on, never the body it was hit-tested through. */
    expect(surfaceMeasured).toBe(landed);
    for (const f of loose(b.surface)) expect(f.x >= -2 && f.x < 298 && f.y >= -2 && f.y < 298).toBe(true);
  });

  it('a host that takes no pointer, registered with no hit, picks nothing up (the pointer is never over it)', () => {
    const body = host(0, 0);
    const surface = document.createElement('div');
    body.append(surface);
    const flakes = makeFlakes({ seed: 'sticky', box: { w: 296, h: 296 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    cling.register(surface, { sticky: true, flakes });
    load();
    expect(cling.carried()).toBe(0);
  });

  it('unregistering a host lets go of its hit, and a hit reregistered for a new host belongs to that host', () => {
    const body = host(0, 0);
    const first = document.createElement('div'), second = document.createElement('div');
    for (const s of [first, second]) { for (const k of ['--kb-bg', ...POST_INK]) s.style.setProperty(k, light[k]!); body.append(s); }
    const flakes = makeFlakes({ seed: 'sticky', box: { w: 296, h: 296 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    const off = cling.register(first, { sticky: true, flakes, hit: body });
    off();
    load();
    expect(cling.carried()).toBe(0);
    const offFirst = cling.register(first, { sticky: true, flakes, hit: body });
    cling.register(second, { sticky: true, flakes, hit: body });
    /* The first's way out, taken after the second took the hit, leaves the second's. */
    offFirst();
    load();
    expect(cling.carried()).toBeGreaterThan(0);
  });

  /* Issue #412's findings, and a hit's one owner (docs/plans/2026-11-11-shake-design.md section 4). */
  describe('a hit has one owner at a time', () => {
    const inked = (el: HTMLElement): HTMLElement => { for (const k of ['--kb-bg', ...POST_INK]) el.style.setProperty(k, light[k]!); return el; };
    /* A surface over its hit, as Glitter Bomb's face lies over the body it paints: the hit's box is its own, so a flake lands in it. */
    const child = (body: HTMLElement): HTMLElement => {
      const el = inked(document.createElement('div'));
      el.getBoundingClientRect = () => body.getBoundingClientRect();
      body.append(el);
      return el;
    };
    const mk = () => makeFlakes({ seed: 'sticky', box: { w: 296, h: 296 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    /** A pointer sweep over the page at x: how much of a host's glitter it picks up. */
    const sweepAt = (x: number): number => {
      for (let i = 0; i < 400; i++) { const px = x + 10 + (i % 2) * 120; cling.over(pointer('mouse', px, 100)); move(px, 100); }
      return cling.carried();
    };
    /** Carries a load off a sticky post at the left and drops it at x, and steps time until all has landed. */
    const source = () => cling.register(host(0, 0), { sticky: true, flakes: mk() });

    it('N1: a host registered again with a new hit no longer holds the old one', () => {
      const x = host(0, 0), y = host(1000, 0);
      const s = child(x);
      const flakes = mk();
      cling.register(s, { sticky: true, flakes, hit: x });
      cling.register(s, { sticky: true, flakes, hit: y });
      expect(sweepAt(0)).toBe(0);
      expect(sweepAt(1000)).toBeGreaterThan(0);
    });

    it('N2: a host disconnected without unregistering lets go of its hit on the next tick', () => {
      const { b, landed } = page();
      b.remove();
      cling.tick(0);
      carryOver();
      expect(loose(b)).toHaveLength(0);
      expect(landed()).toBe(0);
    });

    it('N3: the second of two effect hosts owns a hit, and its way out hands the hit back to the first', () => {
      const flakes = mk();
      source();
      const x = host(2000, 0);
      const s1 = child(x), s2 = child(x);
      const off1 = cling.register(s1, { flakes, hit: x });
      const off2 = cling.register(s2, { flakes, hit: x });
      carryOver(2100);
      expect(loose(s2).length).toBeGreaterThan(0);
      expect(loose(s1)).toHaveLength(0);
      off2();
      sweepLoose();
      carryOver(2100);
      expect(loose(s1).length).toBeGreaterThan(0);
      /* Registered again, then the first's way out taken: the second keeps the hit. */
      sweepLoose();
      cling.register(s2, { flakes, hit: x });
      off1();
      carryOver(2100);
      expect(loose(s2).length).toBeGreaterThan(0);
      expect(loose(s1)).toHaveLength(0);
    });

    it.each([['effect first', true], ['cell first', false]])('a cell host and an effect host name one hit: the effect owns it, %s', (_n, effectFirst) => {
      source();
      const x = host(2000, 0);
      const effect = child(x), cell = child(x);
      const regs = [() => cling.register(effect, { hit: x }), () => cling.register(cell, { rank: 'cell', hit: x })];
      if (!effectFirst) regs.reverse();
      for (const r of regs) r();
      carryOver(2100);
      expect(loose(effect).length).toBeGreaterThan(0);
      expect(loose(cell)).toHaveLength(0);
    });
  });

  it('a dropped flake over nothing lands nowhere and leaves the screen', () => {
    const { a, b } = page();
    load();
    for (let i = 0; i < 400 && cling.carried(); i++) move(1000 + (i % 2) * 120, 100);
    for (let t = 0; (cling.falling() || cling.carried()) && t < 30000; t += 16) cling.tick(t);
    expect(cling.falling()).toBe(0);
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
  beforeEach(() => { vi.stubGlobal('innerWidth', 8000); });
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
 * fly the way the page was moving, settle through air drag and land on whichever host is under them, or leave the screen
 * (docs/plans/2026-11-11-shake-design.md section 3). Nothing in the air fades.
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
    return { f, off, a, told: () => told };
  }
  /** Where each flake was drawn by one tick, in the order the layer holds them. */
  function placesAt(t: number): Array<[number, number]> {
    drawn.at.length = 0;
    cling.tick(t);
    return [...drawn.at];
  }
  /** A frame long enough to shake a good many off at once (a scroll's distance is its speed times this). */
  const LONG_FRAME = 0.4;
  const median = (xs: number[]): number => [...xs].sort((p, q) => p - q)[xs.length >> 1]!;

  it('sends copies of flakes on the post on screen into the falling layer and leaves the post as it was, so nothing repaints it', () => {
    const { f, told } = posts();
    const before = [...f.settled];
    const n = shake(SHAKE_SPEED * 2, 0, LONG_FRAME);
    expect(n).toBeGreaterThan(0);
    expect(cling.falling()).toBe(n);
    expect(layer()).not.toBeNull();
    /* The post keeps every flake where it was, so its base layer's key (and paint) does not change, and it is not told to redraw. */
    expect(f.settled).toEqual(before);
    expect(told()).toBe(0);
  });

  it('throws them the way the page was moving, at about half its speed: up the screen on a scroll down, sprayed both ways', () => {
    posts();
    const v = SHAKE_SPEED * 2;
    shake(v, 0, LONG_FRAME);
    const first = placesAt(0), next = placesAt(16);
    expect(next.length).toBe(first.length);
    expect(first.length).toBeGreaterThan(20);
    const dy = first.map((p, i) => (next[i]![1] - p[1]) / 0.016), dx = first.map((p, i) => (next[i]![0] - p[0]) / 0.016);
    /* Each leaves at THROW x (0.6 to 1.4) of v, up the screen, and a frame of drag takes about a tenth off. */
    expect(median(dy)).toBeLessThan(-v * THROW * 0.7);
    expect(median(dy)).toBeGreaterThan(-v * THROW * 1.1);
    expect(Math.min(...dy)).toBeGreaterThan(-v * THROW * 1.4);
    /* Sideways: up to SPRAY of |v| either way (a flutter of 35 px a second on top), both ways. */
    expect(Math.max(...dx)).toBeGreaterThan(v * SPRAY * 0.3);
    expect(Math.min(...dx)).toBeLessThan(-v * SPRAY * 0.3);
    expect(Math.max(...dx.map(Math.abs))).toBeLessThan(v * SPRAY + 60);
  });

  it('throws them down the screen on a scroll up', () => {
    posts();
    const v = -SHAKE_SPEED * 2;
    shake(v, 0, LONG_FRAME);
    const first = placesAt(0), next = placesAt(16);
    const dy = first.map((p, i) => (next[i]![1] - p[1]) / 0.016);
    expect(median(dy)).toBeGreaterThan(-v * THROW * 0.7);
    expect(median(dy)).toBeLessThan(-v * THROW * 1.1);
  });

  it('draws nothing in the air below full alpha: the fade is gone', () => {
    posts();
    shake(SHAKE_SPEED * 2, 0, LONG_FRAME);
    drawn.alphas.length = 0;
    let t = 0;
    for (; cling.falling() && t < 60000; t += 16) cling.tick(t);
    expect(cling.falling()).toBe(0);
    expect(drawn.alphas.length).toBeGreaterThan(100);
    expect(drawn.alphas.filter((a) => a < 1)).toEqual([]);
  });

  it('drag settles a flake to between 60 and 80 px a second within a second', () => {
    posts();
    shake(SHAKE_SPEED * 2, 0, LONG_FRAME);
    /* The settling speed the constants name: gravity against drag. */
    expect(GRAVITY / DRAG).toBeGreaterThan(60);
    expect(GRAVITY / DRAG).toBeLessThan(80);
    let t = 0;
    for (; t < 1000; t += 16) cling.tick(t);
    /* A pair of frames with the same flakes in the air (a flake landing in the second would shift the list). */
    let speeds: number[] = [];
    for (; t < 3000 && !speeds.length; t += 16) {
      const a = placesAt(t), b = placesAt(t + 16);
      t += 16;
      if (a.length === b.length && a.length > 5) speeds = a.map((p, i) => (b[i]![1] - p[1]) / 0.016);
    }
    expect(speeds.length).toBeGreaterThan(5);
    expect(median(speeds)).toBeGreaterThan(60);
    expect(median(speeds)).toBeLessThan(80);
  });

  /*
   * The count follows the scroll's distance, not the clock (docs/plans/2026-11-11-shake-design.md section 3): a ~130 px post crosses a
   * ~1,000 px view in 1,130 px of scrolling, and a full flick sheds SHAKE_PER_FLICK off it over that pass whatever the frame rate.
   */
  const PASS_PX = 1130;
  /** Scrolls `px` at `v` a second as frames of `hz`, a shake each, and returns what was shaken off the one post on screen. */
  function scrolled(v: number, px: number, hz: number): number {
    const frames = Math.round(px / (Math.abs(v) / hz));
    let n = 0;
    for (let i = 0; i < frames; i++) n += shake(v, i * 1000 / hz, 1 / hz);
    return n;
  }

  it('sheds about 40 off a post over its whole pass through the view at twice the threshold, and 40% of that at the threshold', () => {
    posts();
    const n = scrolled(SHAKE_SPEED * 2, PASS_PX, 60);
    expect(n).toBeGreaterThanOrEqual(30);
    expect(n).toBeLessThanOrEqual(50);
    expect(SHAKE_PER_FLICK).toBe(40);
    cling.reset();
    posts();
    const slow = scrolled(SHAKE_SPEED, PASS_PX, 60);
    expect(slow).toBeGreaterThanOrEqual(SHAKE_PER_FLICK * 0.4 * 0.6);
    expect(slow).toBeLessThanOrEqual(SHAKE_PER_FLICK * 0.4 * 1.4);
  });

  it('sheds the same for the same distance at 60 Hz and at 144 Hz', () => {
    posts();
    const a = scrolled(SHAKE_SPEED * 2, PASS_PX, 60);
    cling.reset();
    posts();
    const b = scrolled(SHAKE_SPEED * 2, PASS_PX, 144);
    expect(a).toBeGreaterThanOrEqual(30);
    expect(b).toBeGreaterThanOrEqual(30);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(6);
  });

  it('a fling of 4 frames sheds as many as the same distance in 30 frames, and twice the distance sheds twice as many', () => {
    const v = SHAKE_SPEED * 2, px = 4 * (v / 60);
    posts();
    const few = scrolled(v, px, 60);
    cling.reset();
    posts();
    const many = scrolled(v, px, 60 * 30 / 4);
    expect(few).toBeGreaterThanOrEqual(5);
    expect(Math.abs(few - many)).toBeLessThanOrEqual(3);
    cling.reset();
    posts();
    const twice = scrolled(v, px * 2, 60);
    expect(twice).toBeGreaterThanOrEqual(few * 1.5);
    expect(twice).toBeLessThanOrEqual(few * 2.6);
  });

  it('keeps at most 400 in the air, however long the scroll', () => {
    posts();
    for (let i = 0; i < 400; i++) shake(SHAKE_SPEED * 10, i, 0.05);
    expect(cling.falling()).toBe(MAX_AIR);
    expect(MAX_AIR).toBe(400);
  });

  it('shakes nothing under its speed, under reduced motion, or off a post still bursting', () => {
    const { f } = posts();
    expect(shake(SHAKE_SPEED * 0.5, 0, LONG_FRAME)).toBe(0);
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    expect(shake(SHAKE_SPEED * 3, 0, LONG_FRAME)).toBe(0);
    document.documentElement.setAttribute('data-kb-motion', 'full');
    cling.reset();
    const flying: Flakes = makeFlakes({ seed: 'mid', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70, glint: GLINT });
    burst(flying, 0);
    cling.register(host(100, 100), { sticky: true, flakes: flying });
    expect(flying.flying).toBeGreaterThan(0);
    expect(shake(SHAKE_SPEED * 3, 0, LONG_FRAME)).toBe(0);
    expect(f.settled.length).toBe(f.total);
  });

  it('a flake does not land before its hang, and after it lands on the host under it', () => {
    const { a, told } = posts();
    /* A gentle flick up throws them down the screen, so many are still over the post when their hang is up. */
    shake(-SHAKE_SPEED * 1.1, 0, 1);
    const start = cling.falling();
    expect(start).toBeGreaterThan(20);
    let t = 0;
    /* The shortest hang is 0.6 of HANG_S: nothing is on the post before it. */
    for (; t < HANG_S * 0.6 * 1000 - 20; t += 16) cling.tick(t);
    expect(loose(a)).toHaveLength(0);
    expect(told()).toBe(0);
    for (; cling.falling() && t < 60000; t += 16) cling.tick(t);
    expect(cling.falling()).toBe(0);
    expect(loose(a).length).toBeGreaterThan(0);
    expect(told()).toBe(loose(a).length);
    for (const fl of loose(a)) expect(fl.x >= 0 && fl.x < 300 && fl.y >= 0 && fl.y < 300).toBe(true);
  });

  /*
   * The cost of a flake in the air over nothing to land on (docs/plans/2026-11-11-shake-design.md section 4): once past its hang it
   * asks the browser what is under it, and a hit test is a layout-tree walk. Up to 400 flakes asking every frame is 24,000 hit tests
   * a second; each flake asks at most every CHECK_S instead, so a place that comes under it catches it within that.
   */
  it('hit-tests a flake past its hang about every 100 ms, not every frame, and still lands it within one interval of a place coming under it', () => {
    posts();
    for (let i = 0; i < 12; i++) shake(-SHAKE_SPEED * 1.1, 0, 1);
    expect(cling.falling()).toBe(MAX_AIR);
    /* Nothing to land on: the posts are gone from under them. */
    placed = [];
    let t = 0;
    for (; t < 1000; t += 16) cling.tick(t);
    expect(cling.falling()).toBe(MAX_AIR);
    const asks = vi.fn((x: number, y: number) => elAt(x, y));
    document.elementFromPoint = asks;
    for (const end = t + 1000; t < end; t += 16) cling.tick(t);
    expect(cling.falling()).toBeGreaterThan(MAX_AIR * 0.9);
    expect(asks.mock.calls.length).toBeGreaterThan(MAX_AIR * 5);
    /* 400 flakes over 60 frames, every frame: 24,000. Every 100 ms: about 4,000. */
    expect(asks.mock.calls.length).toBeLessThan(MAX_AIR * 60 / 4);
    /* A place comes under them all: within one interval (and a frame) every one of them has landed on it. */
    /* Reaching 10 px past the view each way, where a flake is not yet culled: the edge itself is not a landing place the browser can find. */
    const under = host(0, -10, 1024, 788);
    let told = 0;
    cling.register(under, { landed: () => told++ });
    const air = cling.falling();
    let frames = 0;
    for (; cling.falling() && frames < 20; frames++, t += 16) cling.tick(t);
    expect(cling.falling()).toBe(0);
    expect(frames).toBeLessThanOrEqual(Math.ceil(100 / 16) + 1);
    /* All but any that left past the bottom in those frames. */
    expect(told).toBeGreaterThan(air * 0.95);
    expect(loose(under).length).toBeGreaterThan(0);
  });

  it('a flake 10 px past the bottom or the sides is gone: none is drawn out there, and all leave', () => {
    posts();
    /* Thrown down the screen at up to 1.4 x 0.55 x 11,000 px a second: the first frames carry many past the bottom. */
    shake(-SHAKE_SPEED * 5, 0, LONG_FRAME);
    const start = cling.falling();
    expect(start).toBeGreaterThan(20);
    let left = 0;
    for (let t = 0; cling.falling() && t < 60000; t += 16) {
      const before = cling.falling();
      for (const [x, y] of placesAt(t)) {
        expect(y).toBeLessThanOrEqual(innerHeight + 10);
        expect(x >= -10 && x <= innerWidth + 10).toBe(true);
      }
      left += before - cling.falling();
    }
    expect(cling.falling()).toBe(0);
    /* Some of them left rather than landed: the post took fewer than were shaken. */
    expect(loose(document.body.children[0]!).length).toBeLessThan(start);
    expect(left).toBe(start);
  });

  it('a flake 10 px above the top is gone, as one past the bottom is: none is drawn up there, and none comes back down', () => {
    posts();
    /* Thrown up the screen at 0.6 to 1.4 x 0.55 x 4,400 px a second from a post 100 to 400 px down: many are over the top in a few frames. */
    shake(SHAKE_SPEED * 2, 0, LONG_FRAME);
    const start = cling.falling();
    expect(start).toBeGreaterThan(20);
    let prev = start;
    for (let t = 0; cling.falling() && t < 60000; t += 16) {
      for (const [, y] of placesAt(t)) expect(y).toBeGreaterThanOrEqual(-10);
      expect(cling.falling()).toBeLessThanOrEqual(prev);
      prev = cling.falling();
    }
    expect(cling.falling()).toBe(0);
    /* Some left over the top rather than landing: the post took fewer than were shaken. */
    expect(loose(document.body.children[0]!).length).toBeLessThan(start);
  });

  /* The layer covers the viewport; a frame that cleared all of it rastered the whole screen on every frame of a fast scroll
     (e2e/shine.spec.ts's raster share, p95 4.5 against its bound of 1.5). It clears only the squares it drew in last time. */
  it('a frame of falling glitter clears only where it drew the frame before, not the whole layer', () => {
    posts();
    shake(SHAKE_SPEED * 3, 0, LONG_FRAME);
    const c = layer() as HTMLCanvasElement;
    const whole = c.width * c.height;
    expect(whole).toBeGreaterThan(500_000);
    cling.tick(0);
    ops.cleared = 0;
    let frames = 0;
    for (let t = 16; cling.falling() && t < 60000; t += 16) { cling.tick(t); frames++; }
    expect(frames).toBeGreaterThan(10);
    /* Each frame clears a few px square per flake it drew the frame before: on average under 1% of the layer, where it was all of it. */
    expect(ops.cleared / frames).toBeLessThan(whole * 0.01);
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
