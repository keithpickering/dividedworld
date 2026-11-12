/* A .test.tsx because the light reads the DOM (a canvas, observers, the loop's rAF) and needs jsdom. The image loads and the canvas context are stood in. */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { light as pageLight } from '../shine/light.ts';
import { probe } from '../shine/loop.ts';

const lit = vi.hoisted(() => ({ calls: [] as { rows: { top: number; bottom: number } | undefined; w: number; h: number }[] }));
vi.mock('../shine/relief.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../shine/relief.ts')>();
  return { ...real, lightRelief: vi.fn((relief, light, out, rows) => { lit.calls.push({ rows, w: relief.w, h: relief.h }); real.lightRelief(relief, light, out, rows); }) };
});
import { PackLight } from './packLight.ts';

/* A fake rAF the test flushes by hand, and a fake IntersectionObserver and ResizeObserver it drives. */
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
const frames = (n: number) => { for (let i = 1; i <= n; i++) { const run = [...queue.values()]; queue.clear(); for (const cb of run) cb(i * 16); } };
let observers: { cb: IntersectionObserverCallback; seen: Set<Element> }[] = [];
class FakeObserver {
  readonly entry = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>() };
  constructor(cb: IntersectionObserverCallback) { this.entry.cb = cb; observers.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); }
  takeRecords() { return []; }
}
const see = (el: Element, isIntersecting: boolean) => act(() => { for (const o of observers) if (o.seen.has(el)) o.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], o as unknown as IntersectionObserver); });
let resizes: { cb: () => void; watching: Set<Element> }[] = [];
class FakeResize {
  readonly entry = { cb: undefined as unknown as () => void, watching: new Set<Element>() };
  constructor(cb: () => void) { this.entry.cb = cb; resizes.push(this.entry); }
  observe(el: Element) { this.entry.watching.add(el); }
  unobserve(el: Element) { this.entry.watching.delete(el); }
  disconnect() { this.entry.watching.clear(); }
}

/* The images: each loads on a microtask unless its address is in `broken`. `loads` is every address asked for. */
let loads: string[] = [];
let broken = new Set<string>();
class FakeImage {
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) { loads.push(url); queueMicrotask(() => (broken.has(url) ? this.onerror?.() : this.onload?.())); }
}
/* The canvas context: it reads transparent-black pixels, which makeRelief decodes to a relief facing the viewer. */
let noContext = false;
const ctx = { drawImage: vi.fn(), getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: vi.fn() };
let size = { w: 270, h: 420 };

beforeEach(() => {
  queue = new Map(); nextId = 1; observers = []; resizes = []; loads = []; broken = new Set(); noContext = false; lit.calls = []; size = { w: 270, h: 420 };
  ctx.putImageData.mockClear(); ctx.drawImage.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('ResizeObserver', FakeResize);
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, toJSON: () => ({}) }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => (noContext ? null : ctx)) as never);
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
});
afterEach(() => {
  cleanup();
  probe.reset(); pageLight.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
});

/* Each test has relief addresses of its own: the page caches a decode by address. */
let n = 0;
const fresh = () => `/relief-${++n}.webp`;
const settle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const canvas = () => document.querySelector('canvas.kb-pack-light') as HTMLCanvasElement;
const mount = async (relief: string, part: 'whole' | 'opened' | 'top' = 'whole') => {
  const view = render(<PackLight picture="/pack.webp" relief={relief} part={part} />);
  await settle();
  return view;
};

describe('the pack\'s light', () => {
  test('a relief that loads registers one quiet host with the loop, and a frame draws it once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(fresh());
    see(canvas(), true);
    frames(5);
    expect(lit.calls).toHaveLength(1);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    /* Quiet: it is never the shiny post in view (the shine tip). */
    const { watchShinyInView } = await import('../shine/loop.ts');
    const seen: (HTMLCanvasElement | null)[] = [];
    const stop = watchShinyInView((c) => seen.push(c));
    stop();
    expect(seen).toEqual([null]);
  });

  test('two packs with the same relief at the same size load it once', async () => {
    const url = fresh();
    render(<><PackLight picture="/pack.webp" relief={url} part="whole" /><PackLight picture="/pack.webp" relief={url} part="whole" /></>);
    await settle();
    expect(loads.filter((u) => u === url)).toHaveLength(1);
    expect(document.querySelectorAll('canvas.kb-pack-light')).toHaveLength(2);
    for (const c of document.querySelectorAll('canvas.kb-pack-light')) see(c, true);
    frames(3);
    expect(lit.calls).toHaveLength(2);
  });

  test('a relief that fails to load registers nothing, warns once with its address, and throws nothing', async () => {
    const url = fresh();
    broken.add(url);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<><PackLight picture="/pack.webp" relief={url} part="whole" /><PackLight picture="/pack.webp" relief={url} part="whole" /></>);
    await settle();
    for (const c of document.querySelectorAll('canvas.kb-pack-light')) see(c, true);
    frames(3);
    expect(lit.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(url);
  });

  test('a picture that cannot load while the relief can still gives a light, with no tint', async () => {
    broken.add('/pack.webp');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(fresh());
    see(canvas(), true);
    frames(3);
    expect(lit.calls).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a canvas with no 2D context registers nothing and throws nothing', async () => {
    noContext = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(fresh());
    see(canvas(), true);
    frames(3);
    expect(lit.calls).toHaveLength(0);
  });

  test('unmounting unregisters; a host told hidden has a 0 by 0 canvas, and the next draw sizes it again', async () => {
    const view = await mount(fresh());
    const c = canvas();
    see(c, true);
    frames(3);
    expect(c.width).toBe(270);
    see(c, false);
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
    see(c, true);
    frames(3);
    expect(c.width).toBe(270);
    expect(c.height).toBe(420);
    expect(lit.calls).toHaveLength(2);
    view.unmount();
    see(c, true);
    frames(3);
    expect(lit.calls).toHaveLength(2);
  });

  test('part top and part opened hand lightRelief their rows; a whole pack hands none', async () => {
    for (const [part, rows] of [['top', { top: 0, bottom: Math.round(0.14 * 420) }], ['opened', { top: Math.round(0.09 * 420), bottom: 420 }], ['whole', undefined]] as const) {
      lit.calls = [];
      const view = await mount(fresh(), part);
      see(canvas(), true);
      frames(3);
      expect(lit.calls.at(-1)!.rows).toEqual(rows);
      view.unmount();
      probe.reset();
    }
  });

  test('the canvas is never sized past 540 by 840, and a resized box is registered again at its new size', async () => {
    size = { w: 900, h: 1400 };
    vi.stubGlobal('devicePixelRatio', 2);
    await mount(fresh());
    see(canvas(), true);
    frames(3);
    expect([canvas().width, canvas().height]).toEqual([540, 840]);
    size = { w: 100, h: 150 };
    await act(async () => { for (const r of resizes) r.cb(); });
    await settle();
    see(canvas(), true);
    frames(3);
    expect([canvas().width, canvas().height]).toEqual([200, 300]);
  });
});
