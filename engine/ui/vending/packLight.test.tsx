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
import { PackLight, RESIZE_DEBOUNCE_MS } from './packLight.ts';

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
let holding = false;
/* Addresses whose load is held open until `release()` is called. */
let held = new Map<string, () => void>();
class FakeImage {
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    loads.push(url);
    const settle = () => (broken.has(url) ? this.onerror?.() : this.onload?.());
    if (url.startsWith('/relief-') && holding) held.set(`${url}#${held.size}`, settle);
    else queueMicrotask(settle);
  }
}
/* The canvas context: it reads transparent-black pixels, which makeRelief decodes to a relief facing the viewer. */
let noContext = false;
let visibleNoContext = false;
let unreadable = false;
const ctx = { drawImage: vi.fn(), getImageData: (_x: number, _y: number, w: number, h: number) => (unreadable ? (() => { throw new DOMException('tainted', 'SecurityError'); })() : { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: vi.fn() };
let size = { w: 270, h: 420 };

beforeEach(() => {
  queue = new Map(); nextId = 1; observers = []; resizes = []; loads = []; broken = new Set(); held = new Map(); holding = false; noContext = false; visibleNoContext = false; unreadable = false; lit.calls = []; size = { w: 270, h: 420 };
  ctx.putImageData.mockClear(); ctx.drawImage.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('ResizeObserver', FakeResize);
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, toJSON: () => ({}) }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((function (this: HTMLCanvasElement) { return noContext || (visibleNoContext && this.classList.contains('kb-pack-light')) ? null : ctx; }) as never);
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  probe.reset(); pageLight.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
});

/* Each test has relief addresses of its own: the page caches a decode by address. */
let n = 0;
const fresh = () => `/relief-${++n}.webp`;
const settle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const resize = async (w: number, h: number) => {
  size = { w, h };
  await act(async () => { for (const r of resizes) r.cb(); vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS); });
  await settle();
};
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    size = { w: 900, h: 1400 };
    vi.stubGlobal('devicePixelRatio', 2);
    await mount(fresh());
    see(canvas(), true);
    frames(3);
    expect([canvas().width, canvas().height]).toEqual([540, 840]);
    await resize(100, 150);
    see(canvas(), true);
    frames(3);
    /* A 2:3 box at density 2 is 200 by 300; the largest 540:840 shape inside it is 193 by 300 (9/14 of 300 is 192.86). */
    expect([canvas().width, canvas().height]).toEqual([193, 300]);
  });

  test('a 2:3 box gets the bitmap\'s 9:14 shape, so object-fit: contain lays it exactly over the picture', async () => {
    size = { w: 300, h: 450 };
    await mount(fresh());
    see(canvas(), true);
    frames(3);
    expect([canvas().width, canvas().height]).toEqual([289, 450]);
    expect(canvas().width / canvas().height).toBeCloseTo(540 / 840, 2);
  });

  test('a relief is dropped once its last pack unmounts, and two mounted at once load it once', async () => {
    const url = fresh();
    const a = render(<><PackLight picture="/pack.webp" relief={url} part="whole" /><PackLight picture="/pack.webp" relief={url} part="top" /></>);
    await settle();
    expect(loads.filter((u) => u === url)).toHaveLength(1);
    a.unmount();
    await mount(url);
    expect(loads.filter((u) => u === url)).toHaveLength(2);
  });

  test('one of two packs unmounting keeps the decode for the other', async () => {
    const url = fresh();
    const a = render(<PackLight picture="/pack.webp" relief={url} part="whole" />);
    await settle();
    const b = render(<PackLight picture="/pack.webp" relief={url} part="whole" />);
    await settle();
    a.unmount();
    b.unmount();
    expect(loads.filter((u) => u === url)).toHaveLength(1);
    const c = render(<PackLight picture="/pack.webp" relief={url} part="whole" />);
    await settle();
    expect(loads.filter((u) => u === url)).toHaveLength(2);
    c.unmount();
  });

  test('a light that changes size lets go of its old size', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const url = fresh();
    await mount(url);
    await resize(100, 150);
    expect(loads.filter((u) => u === url)).toHaveLength(2);
    await resize(270, 420);
    /* The first size was dropped when the light moved on, so coming back to it decodes it again. */
    expect(loads.filter((u) => u === url)).toHaveLength(3);
  });

  test('a relief address that failed is not requested again at another size, and warns once in total', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const url = fresh();
    broken.add(url);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(url);
    await resize(100, 150);
    await resize(200, 300);
    render(<PackLight picture="/pack.webp" relief={url} part="top" />);
    await settle();
    expect(loads.filter((u) => u === url)).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('during a pending load after a box change, the old registration still draws', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const url = fresh();
    await mount(url);
    see(canvas(), true);
    frames(3);
    const before = lit.calls.length;
    expect(before).toBeGreaterThan(0);
    holding = true;
    await resize(100, 150);
    expect(held.size).toBe(1);
    /* Scrolled away and back, the pack still draws, from the old size's relief. */
    see(canvas(), false);
    see(canvas(), true);
    frames(3);
    expect(lit.calls.length).toBeGreaterThan(before);
    expect(lit.calls.at(-1)!.w).toBe(270);
    for (const go of held.values()) go();
    await settle();
  });

  test('fifty box changes inside the debounce window cause one load', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const url = fresh();
    await mount(url);
    expect(loads.filter((u) => u === url)).toHaveLength(1);
    for (let i = 0; i < 50; i++) {
      size = { w: 100 + i, h: 160 + i };
      await act(async () => { for (const r of resizes) r.cb(); vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS - 1); });
    }
    expect(loads.filter((u) => u === url)).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS); });
    await settle();
    expect(loads.filter((u) => u === url)).toHaveLength(2);
  });

  test('a load that resolves after the pack unmounted registers nothing and throws nothing', async () => {
    holding = true;
    const url = fresh();
    const view = render(<PackLight picture="/pack.webp" relief={url} part="whole" />);
    await settle();
    const c = canvas();
    view.unmount();
    holding = false;
    await act(async () => { for (const go of held.values()) go(); });
    await settle();
    see(c, true);
    frames(3);
    expect(lit.calls).toHaveLength(0);
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  test('a box changed while a load is pending registers only the newest size, once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    holding = true;
    const url = fresh();
    render(<PackLight picture="/pack.webp" relief={url} part="whole" />);
    await settle();
    /* The first size's load is held. Change the box twice more, releasing each load in turn, the oldest last. */
    await resize(100, 150);
    await resize(135, 210);
    expect(held.size).toBe(3);
    holding = false;
    const order = [...held.values()];
    await act(async () => { order[2]!(); order[1]!(); order[0]!(); });
    await settle();
    see(canvas(), true);
    frames(3);
    expect(lit.calls).toHaveLength(1);
    expect(lit.calls[0]).toMatchObject({ w: 135, h: 210 });
  });

  test('a relief the browser will not hand pixels for (SecurityError) warns once with its address, registers nothing, and throws nothing', async () => {
    unreadable = true;
    const url = fresh();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(url);
    see(canvas(), true);
    frames(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(url);
    expect(lit.calls).toHaveLength(0);
    expect(document.querySelector('canvas.kb-pack-light')).not.toBeNull();
  });

  test('a visible canvas with no 2D context (the scratch canvas works) draws nothing and throws nothing into the loop', async () => {
    visibleNoContext = true;
    const ask = vi.mocked(HTMLCanvasElement.prototype.getContext);
    /* The loop catches a throwing draw and reports it, so a throw shows as an error report. */
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(fresh());
    see(canvas(), true);
    ask.mockClear();
    expect(() => frames(3)).not.toThrow();
    /* The draw did run and ask the visible canvas for its context. */
    expect(ask).toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
    expect(lit.calls).toHaveLength(0);
  });
});
