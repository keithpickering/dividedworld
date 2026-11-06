/* A .test.tsx because the cling layer reads the DOM (rects, the pointer query, the body) and needs jsdom. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cling, IDLE_MS, loose, MAX_CARRIED, MAX_LOOSE, makeFlakes, sweepLoose } from './flakes.ts';

const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];

const fakeCtx = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
let fine = true;

function host(left: number, top: number, w = 300, h = 300): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} });
  document.body.append(el);
  return el;
}
function pointer(type: string, x: number, y: number): PointerEvent {
  const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: type });
  return e as PointerEvent;
}
const move = (x: number, y: number, type = 'mouse') => window.dispatchEvent(pointer(type, x, y));
const layer = () => document.querySelector('canvas[data-kb-shine="cling"]');

beforeEach(() => {
  vi.useFakeTimers();
  fine = true;
  document.documentElement.setAttribute('data-kb-motion', 'full');
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('hover: hover') ? fine : false, addEventListener() {}, removeEventListener() {} }));
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
  const flakes = makeFlakes({ seed: 'sticky', box: { w: 300, h: 300 }, inks: GLITTER, holo: 7, density: 70 });
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
function carryOver() {
  load();
  for (let i = 0; i < 400 && cling.carried(); i++) move(2100 + (i % 2) * 120, 100);
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
});
