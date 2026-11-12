/**
 * Feelin' Fab's effect on the foil (docs/plans/2026-11-06-shine-plan.md, Task 9; the design's sections 1, 3, 5 and 6): the count of
 * Feelin' Fabs up on the post picks the grade of holographic foil drawn on a canvas under the words (one pearl, two bands, three
 * prism), seeded from public ids only. The palette is the board's, chosen by the band the board leaves free; the loop (the page's
 * one animation loop) draws it in view and not otherwise, and a play's moment draws it once at rest. The foil itself and the band are
 * tested in the engine; here the foil is a spy, so what the Effect hands it is what is read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ratio, tokensOf } from '../../../../engine/ui/contrast.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { bandFor, bandOf, POST_INK } from '../../../../engine/ui/shine/band.ts';
import { light as pageLight, REST } from '../../../../engine/ui/shine/light.ts';
import { probe, SPAN_MARGIN } from '../../../../engine/ui/shine/loop.ts';
import { foilProbe, IDLE_MS, setFoilWorker } from '../../../../engine/ui/shine/foilClient.ts';

/* The foil is a spy that remembers how it was made; the band is the root's board, as bandFor would read it from the tokens. */
const made = vi.hoisted(() => [] as { opts: { seed: string; pattern: string; palette: readonly string[]; stars: number; glint: string }; draw: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }[]);
vi.mock('../../../../engine/ui/shine/foil.ts', () => ({
  makeFoil: vi.fn((opts) => {
    const f = { opts, draw: vi.fn(), release: vi.fn() };
    made.push(f);
    return f;
  }),
}));
const bandState = vi.hoisted(() => ({ throws: false }));
vi.mock('../../../../engine/ui/shine/band.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../engine/ui/shine/band.ts')>();
  return {
    ...real,
    bandFor: vi.fn((el: Element) => {
      window.getComputedStyle(el); /* the real bandFor reads the tokens through getComputedStyle; the spy counts that cost */
      if (bandState.throws) throw new Error('shine band: not a hex color');
      const board = document.documentElement.getAttribute('data-kb-mode') === 'dark' ? 'dark' : 'light';
      if (document.documentElement.getAttribute('data-kb-effects') === 'bright') return { lo: 0, hi: 1, board, bright: true };
      return board === 'dark' ? { lo: 0, hi: 0.048, board, bright: false } : { lo: 0.59, hi: 1, board, bright: false };
    }),
  };
});
import { FAB_BRIGHT, FAB_GLINT, FAB_STOPS, FeelinFabEffect } from './Effect.tsx';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-02T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const playOf = (n: number): CardPlay => ({ id: `f${n}`, card: 'feelin-fab', layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-11-02T12:00:00Z', post: 'p1' });
const props = (level: number): EffectProps => ({
  post, plays: Array.from({ length: level }, (_, i) => playOf(i + 1)), states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
  show: () => {}, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
  children: <p data-kb-words>Hello there.</p>,
});
const box = () => document.querySelector('[data-kb-fab]') as HTMLElement;
const canvas = () => box().querySelector('canvas') as HTMLCanvasElement;
const foils = () => made;
const draws = () => made.reduce((n, f) => n + f.draw.mock.calls.length, 0);

/* A fake rAF the test flushes by hand, a fake IntersectionObserver and ResizeObserver it drives, and a 300 x 120 layout (read through getBoundingClientRect). */
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
const flush = (t: number) => { const run = [...queue.values()]; queue.clear(); for (const cb of run) cb(t); };
const frames = (n: number, from = 0, step = 16) => { for (let i = 1; i <= n; i++) flush(from + i * step); };
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
let size = { w: 300, h: 120 };
const ctx = { clearRect: vi.fn() };

beforeEach(() => {
  made.length = 0; bandState.throws = false;
  queue = new Map(); nextId = 1; observers = []; resizes = []; size = { w: 300, h: 120 };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('ResizeObserver', FakeResize);
  vi.stubGlobal('devicePixelRatio', 1.5);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, toJSON: () => ({}) }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  document.documentElement.setAttribute('data-kb-motion', 'full');
  document.documentElement.removeAttribute('data-kb-mode');
  document.documentElement.removeAttribute('data-kb-effects');
});
afterEach(() => {
  cleanup();
  probe.reset(); pageLight.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.removeAttribute('data-kb-mode');
  document.documentElement.removeAttribute('data-kb-effects');
});

describe("Feelin' Fab", () => {
  test('the layout: a canvas under the words, hidden from assistive tech, and the words above it', () => {
    render(<FeelinFabEffect {...props(2)} />);
    expect(box()).toHaveAttribute('data-kb-level', '2');
    const c = box().querySelector(':scope > canvas.dw-fab-foil');
    expect(c).toHaveAttribute('aria-hidden', 'true');
    expect(box().querySelector('.dw-fab-words')).toHaveTextContent('Hello there.');
    const order = [...box().children].map((el) => el.className);
    expect(order.indexOf('dw-fab-foil')).toBeLessThan(order.indexOf('dw-fab-words'));
  });

  test('the level picks the grade and the starbursts: one pearl with 4, two bands with 8, three prism with 10', () => {
    const seen: [string, number][] = [];
    for (const level of [1, 2, 3]) {
      made.length = 0;
      const r = render(<FeelinFabEffect {...props(level)} />);
      void see(canvas(), true);
      frames(2);
      expect(made).toHaveLength(1);
      seen.push([made[0]!.opts.pattern, made[0]!.opts.stars]);
      r.unmount();
    }
    expect(seen).toEqual([['pearl', 4], ['bands', 8], ['prism', 10]]);
  });

  test('a level is the number of Feelin\' Fabs up, and never more than three', () => {
    render(<FeelinFabEffect {...props(5)} />);
    expect(box()).toHaveAttribute('data-kb-level', '3');
    void see(canvas(), true);
    frames(2);
    expect(made[0]!.opts.pattern).toBe('prism');
  });

  test('the seed is public ids only: the post and the plays, so every reader sees the same foil', () => {
    const seedOf = (p: EffectProps) => {
      made.length = 0;
      const r = render(<FeelinFabEffect {...p} />);
      void see(canvas(), true); frames(2);
      const seed = made[0]!.opts.seed;
      r.unmount();
      return seed;
    };
    const first = seedOf(props(2));
    expect(first).toBe('p1:f1,f2');
    expect(seedOf(props(2))).toBe(first);
    expect(seedOf(props(3))).not.toBe(first);
    /* Nothing private reaches it: not the caster, the reader, nor the author's character. */
    expect(first).not.toMatch(/c1|c2/u);
  });

  test('the foil is handed the instance\'s glint and the palette of the board the band says: light pastels, dark deep colors', () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(2);
    expect(FAB_GLINT).toBe('#ffffff');
    expect(made).toHaveLength(1);
    expect(made[0]!.opts.glint).toBe(FAB_GLINT);
    expect(made[0]!.opts.palette).toEqual(FAB_STOPS.light);
    cleanup(); made.length = 0;
    document.documentElement.setAttribute('data-kb-mode', 'dark');
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(2);
    expect(made).toHaveLength(1);
    expect(made[0]!.opts.palette).toEqual(FAB_STOPS.dark);
  });

  test('it draws in view and not before, with the band, the light and the box handed to the foil', () => {
    render(<FeelinFabEffect {...props(1)} />);
    frames(3);
    expect(draws()).toBe(0);
    void see(canvas(), true);
    frames(2);
    expect(draws()).toBeGreaterThanOrEqual(1);
    const [c, boxArg, density, , band] = made[0]!.draw.mock.calls[0]!;
    expect(c).toBe(ctx);
    expect(boxArg).toEqual({ w: 300, h: 120 });
    expect(density).toBe(1.5);
    expect(band).toEqual({ lo: 0.59, hi: 1, board: 'light', bright: false });
  });

  test('the canvas is sized to the box at the density the loop returns, and its CSS size is the box, placed inline (engine/ui/cards/body.ts)', () => {
    size = { w: 301, h: 119 };
    render(<FeelinFabEffect {...props(1)} />);
    expect(canvas().width).toBe(Math.round(301 * 1.5));
    expect(canvas().height).toBe(Math.round(119 * 1.5));
    /* With no post body around it (no thread here) the box is the host's own, from its top-left. */
    expect([canvas().style.left, canvas().style.top, canvas().style.width, canvas().style.height]).toEqual(['0px', '0px', '301px', '119px']);
    vi.stubGlobal('devicePixelRatio', 5);
    cleanup();
    render(<FeelinFabEffect {...props(1)} />);
    expect(canvas().width).toBe(Math.round(301 * 2));
  });

  /* Issue #304: a body bigger than the words is redrawn at the share of the rate that changes as much screen a second as the words'
     box did (engine/ui/cards/body.ts `paintShare`), and a draw redraws only the rows the loop says are on screen. */
  const inBody = (w: number, h: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-act-main') ? w : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-act-main') ? h : 0; });
  };
  test('in a post body four times its words\' area, the foil is redrawn at a quarter of the rate; with no body, at the full rate', () => {
    inBody(300, 480);
    const r = render(<div className="kb-act-main"><FeelinFabEffect {...props(1)} /></div>);
    expect(probe.share(box())).toBe(0.25);
    r.unmount();
    render(<FeelinFabEffect {...props(1)} />);
    expect(probe.share(box())).toBe(1);
  });

  test('a draw hands the foil the rows the loop says are on screen; the first draw is whole', () => {
    size = { w: 300, h: 2000 };
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true);
    frames(6);
    const calls = made.flatMap((f) => f.draw.mock.calls);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]![7] ?? null, 'the first draw is whole').toBeNull();
    expect(calls.slice(1).some((c) => c[7] !== null && typeof c[7] === 'object'), 'a later draw redraws a span').toBe(true);
    for (const c of calls.slice(1)) if (c[7]) expect(c[7]).toEqual({ top: 0, bottom: window.innerHeight + SPAN_MARGIN });
  });

  test('a resize registers again at the new size, and the post is redrawn', () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(2);
    expect(resizes).toHaveLength(1);
    expect(resizes[0]!.watching.has(box())).toBe(true);
    const before = draws();
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    expect(canvas().width).toBe(300);
    expect(canvas().height).toBe(120);
    void see(canvas(), true); frames(2, 100);
    expect(draws()).toBeGreaterThan(before);
    const last = made[0]!.draw.mock.calls.at(-1)!;
    expect(last[1]).toEqual({ w: 200, h: 80 });
  });

  test('a resize repaints at once with the held light and band, before the loop\'s in-view callback', () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(2);
    const before = draws();
    const lastLight = made[0]!.draw.mock.calls.at(-1)![3];
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    /* No in-view callback, no frame: the canvas was cleared by the resize, so it is painted in the same task. */
    expect(draws()).toBe(before + 1);
    const call = made[0]!.draw.mock.calls.at(-1)!;
    expect(call[1]).toEqual({ w: 200, h: 80 });
    expect(call[3]).toEqual(lastLight);
    expect(call[4]).toEqual({ lo: 0.59, hi: 1, board: 'light', bright: false });
  });

  test('a resize before anything was drawn has no light to repaint with, and waits for the loop', () => {
    render(<FeelinFabEffect {...props(1)} />);
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    expect(draws()).toBe(0);
  });

  test('the box is measured by getBoundingClientRect, fractions included, and the backing store is round(box x density)', () => {
    size = { w: 300.4, h: 119.6 };
    render(<FeelinFabEffect {...props(1)} />);
    expect(canvas().width).toBe(Math.round(300.4 * 1.5));
    expect(canvas().height).toBe(Math.round(119.6 * 1.5));
    void see(canvas(), true); frames(2);
    expect(made[0]!.draw.mock.calls[0]![1]).toEqual({ w: 300.4, h: 119.6 });
  });

  test('unmounting unregisters: nothing is drawn after, and the observers let go', () => {
    const r = render(<FeelinFabEffect {...props(2)} />);
    const host = box();
    void see(canvas(), true); frames(2);
    expect(probe.draws(host)).toBeGreaterThanOrEqual(1);
    const after = draws();
    r.unmount();
    expect(probe.draws(host)).toBe(0);
    frames(5, 200);
    expect(draws()).toBe(after);
    expect(resizes.every((o) => o.watching.size === 0)).toBe(true);
    expect(probe.running()).toBe(false);
  });

  test('unmounting disconnects the mode observer and removes the color-scheme listener it added', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const queries = new Map<string, { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }>();
    vi.stubGlobal('matchMedia', (q: string) => {
      if (!queries.has(q)) queries.set(q, { addEventListener: vi.fn(), removeEventListener: vi.fn() });
      return { matches: false, media: q, ...queries.get(q)! };
    });
    const r = render(<FeelinFabEffect {...props(1)} />);
    const scheme = queries.get('(prefers-color-scheme: dark)')!;
    expect(scheme.addEventListener).toHaveBeenCalledTimes(1);
    /* The one watching the board's mode on the root (the loop keeps observers of its own). */
    const at = observe.mock.calls.findIndex(([, o]) => (o as MutationObserverInit | undefined)?.attributeFilter?.includes('data-kb-mode'));
    expect(at).toBeGreaterThanOrEqual(0);
    const mine = observe.mock.contexts[at];
    expect(disconnect.mock.contexts).not.toContain(mine);
    r.unmount();
    expect(disconnect.mock.contexts).toContain(mine);
    expect(scheme.removeEventListener).toHaveBeenCalledTimes(1);
    expect(scheme.removeEventListener.mock.calls[0]).toEqual(scheme.addEventListener.mock.calls[0]);
  });

  test('a StrictMode mount (mount, cleanup, mount) leaves one registration, one resize watch and no leaked foil', () => {
    const r = render(<StrictMode><FeelinFabEffect {...props(1)} /></StrictMode>);
    const host = box();
    expect([...observers].reduce((n, o) => n + o.seen.size, 0)).toBe(1);
    expect(resizes.reduce((n, o) => n + o.watching.size, 0)).toBe(1);
    void see(canvas(), true); frames(2);
    expect(probe.draws(host)).toBeGreaterThanOrEqual(1);
    expect(made).toHaveLength(1);
    expect(made[0]!.release).not.toHaveBeenCalled();
    r.unmount();
    expect([...observers].reduce((n, o) => n + o.seen.size, 0)).toBe(0);
    expect(resizes.reduce((n, o) => n + o.watching.size, 0)).toBe(0);
    expect(made.every((f) => f.release.mock.calls.length >= 1)).toBe(true);
    frames(3, 500);
    expect(probe.running()).toBe(false);
  });

  test('a post that leaves view releases the foil\'s buffers, and draws fresh when it returns', () => {
    render(<FeelinFabEffect {...props(1)} />);
    const c = canvas();
    void see(c, true); frames(2);
    expect(made).toHaveLength(1);
    expect(made[0]!.release).not.toHaveBeenCalled();
    void see(c, false);
    expect(made[0]!.release).toHaveBeenCalledTimes(1);
    const before = draws();
    frames(4, 100);
    expect(draws()).toBe(before);
    void see(c, true); frames(2, 300);
    expect(draws()).toBe(before + 1);
  });

  test('a post out of view also frees its own backing store, and sizes it again with a draw when it returns', () => {
    render(<FeelinFabEffect {...props(1)} />);
    const c = canvas();
    void see(c, true); frames(2);
    expect(c.width).toBe(450);
    expect(c.height).toBe(180);
    void see(c, false);
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
    const before = draws();
    frames(4, 100);
    void see(c, true); frames(2, 300);
    expect(c.width).toBe(450);
    expect(c.height).toBe(180);
    expect(draws()).toBe(before + 1);
  });

  test('a resize while out of view keeps the backing store freed, and the return sizes it to the new box', () => {
    render(<FeelinFabEffect {...props(1)} />);
    const c = canvas();
    void see(c, true); frames(2);
    void see(c, false);
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    expect(c.width).toBe(0);
    const before = draws();
    frames(4, 100);
    void see(c, true); frames(2, 300);
    expect(c.width).toBe(300);
    expect(c.height).toBe(120);
    expect(draws()).toBe(before + 1);
  });

  test('the other board\'s foil is released once at a board change, not on every draw, and its reference dropped', async () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(20);
    expect(made).toHaveLength(1);
    const light = made[0]!;
    expect(light.release).not.toHaveBeenCalled();
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'dark'); await Promise.resolve(); });
    frames(40, 1000);
    expect(made).toHaveLength(2);
    expect(light.release).toHaveBeenCalledTimes(1);
    expect(made[1]!.release).not.toHaveBeenCalled();
    /* Back again: a new light foil is made (the old reference is gone), and the dark one is released once. */
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'light'); await Promise.resolve(); });
    frames(40, 3000);
    expect(made).toHaveLength(3);
    expect(light.release).toHaveBeenCalledTimes(1);
    expect(made[1]!.release).toHaveBeenCalledTimes(1);
  });

  test('a play\'s moment (still) draws once at the rest light and registers nothing that moves', () => {
    const r = render(<FeelinFabEffect {...props(3)} still />);
    const host = box();
    expect(draws()).toBe(1);
    expect(made[0]!.opts.pattern).toBe('prism');
    const call = made[0]!.draw.mock.calls[0]!;
    expect(call[3]).toEqual(REST);
    expect(call[1]).toEqual({ w: 300, h: 120 });
    expect(canvas().width).toBe(450);
    void see(canvas(), true);
    frames(10);
    expect(probe.draws(host)).toBe(0);
    expect(probe.running()).toBe(false);
    expect(draws()).toBe(1);
    r.unmount();
  });

  test('reduced motion draws the post once, at the rest light, and the loop stops', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<FeelinFabEffect {...props(2)} />);
    void see(canvas(), true);
    frames(10);
    expect(draws()).toBe(1);
    expect(made[0]!.draw.mock.calls[0]![3]).toEqual(REST);
    expect(made[0]!.draw.mock.calls[0]![6]).toBe(false);
    expect(probe.running()).toBe(false);
  });

  test('switching the board re-reads the band: the other board\'s palette, with the other board\'s band, even when nothing is running', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<FeelinFabEffect {...props(2)} />);
    void see(canvas(), true); frames(3);
    expect(made[0]!.opts.palette).toEqual(FAB_STOPS.light);
    const settled = draws();
    expect(settled).toBe(1);
    /* Reduced motion drew it once and the loop stopped: the switch alone must redraw. */
    expect(probe.running()).toBe(false);
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'dark'); await Promise.resolve(); });
    frames(3, 200);
    expect(draws()).toBe(settled + 1);
    const dark = made.find((f) => f.opts.palette === FAB_STOPS.dark);
    expect(dark).toBeDefined();
    expect(dark!.draw.mock.calls.at(-1)![4]).toEqual({ lo: 0, hi: 0.048, board: 'dark', bright: false });
    expect(made.find((f) => f.opts.palette === FAB_STOPS.light)!.release).toHaveBeenCalled();
    expect(probe.running()).toBe(false);
  });

  test('while shimmer runs, the band is read when the board changes and not on every draw, and a switch is still never missed', async () => {
    const styles = vi.spyOn(window, 'getComputedStyle');
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(30);
    expect(draws()).toBeGreaterThan(5);
    expect(styles.mock.calls.length).toBeLessThanOrEqual(1);
    expect(made[0]!.opts.palette).toEqual(FAB_STOPS.light);
    const before = styles.mock.calls.length;
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'dark'); await Promise.resolve(); });
    frames(30, 1000);
    expect(styles.mock.calls.length).toBe(before + 1);
    expect(made.some((f) => f.opts.palette === FAB_STOPS.dark && f.draw.mock.calls.length > 0)).toBe(true);
  });

  test('a band that could not be read is tried again when the board changes, not on every draw', async () => {
    bandState.throws = true;
    const styles = vi.spyOn(window, 'getComputedStyle');
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); frames(10);
    expect(draws()).toBe(0);
    expect(styles.mock.calls.length).toBeLessThanOrEqual(1);
    bandState.throws = false;
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'dark'); await Promise.resolve(); });
    frames(5, 500);
    expect(made.some((f) => f.opts.palette === FAB_STOPS.dark && f.draw.mock.calls.length > 0)).toBe(true);
  });

  test('a moment (still) redraws with the other board\'s palette when the board switches, too', async () => {
    render(<FeelinFabEffect {...props(1)} still />);
    expect(made[0]!.opts.palette).toEqual(FAB_STOPS.light);
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'dark'); await Promise.resolve(); });
    expect(made.some((f) => f.opts.palette === FAB_STOPS.dark && f.draw.mock.calls.length === 1)).toBe(true);
    expect(probe.running()).toBe(false);
  });

  test('a board whose tokens do not parse draws nothing rather than throwing, and the post still reads', () => {
    bandState.throws = true;
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true);
    frames(3);
    expect(draws()).toBe(0);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(box().querySelector('.dw-fab-words')).toHaveTextContent('Hello there.');
  });

  test('the stylesheet: the canvas fills the post under the words and takes no pointer; the words keep their shadow; no gradient, keyframe or color', () => {
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    const rule = (selector: string) => { const at = css.indexOf(`${selector} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
    expect(rule('.dw-fab-foil')).toMatch(/position:\s*absolute/u);
    expect(rule('.dw-fab-foil')).toMatch(/pointer-events:\s*none/u);
    expect(rule('.dw-fab-foil')).toMatch(/width:\s*100%/u);
    expect(rule('.dw-fab-foil')).toMatch(/z-index:\s*0/u);
    expect(rule('.dw-fab-words')).toMatch(/z-index:\s*1/u);
    expect(rule('.dw-fab-words')).toMatch(/text-shadow:/u);
    /* The one place a color is named: the bright ink and its outline, which the engine's thread.css reads (--kb-bright-ink, --kb-bright-outline). */
    const bare = css.replace(/--kb-bright-(?:ink|outline):\s*#[0-9a-f]{6};/giu, '');
    expect(bare).not.toMatch(/gradient|@keyframes|animation|data-kb-running|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
  });

  test('no style element is ever created: the foil is a canvas', () => {
    const before = document.querySelectorAll('style').length;
    render(<><FeelinFabEffect {...props(1)} /><FeelinFabEffect {...props(2)} /></>);
    expect(document.querySelectorAll('style')).toHaveLength(before);
  });
});

/* Brighter effects (docs/plans/2026-11-08-brighter-effects-design.md, section 1): with `data-kb-effects="bright"` on the root the band is the
   free one, the foil is drawn from FAB_BRIGHT on both boards and the post body asks for the bright ink; with it off nothing is as it was. */
describe("Feelin' Fab, bright", () => {
  const bodyOfPost = () => document.querySelector('.kb-act-main') as HTMLElement;
  const inBody = (level = 1) => render(<div className="kb-act-main"><FeelinFabEffect {...props(level)} /></div>);
  const effects = (on: boolean) => act(async () => { if (on) document.documentElement.setAttribute('data-kb-effects', 'bright'); else document.documentElement.removeAttribute('data-kb-effects'); await Promise.resolve(); });

  test('FAB_BRIGHT is the bench\'s six full-saturation stops, red to violet', () => {
    expect(FAB_BRIGHT).toEqual(['#ff1f2d', '#ff8a00', '#ffe600', '#19d43c', '#1a8cff', '#9a2bff']);
  });

  test.each(['light', 'dark'] as const)('marked, the foil is drawn from FAB_BRIGHT on the %s board and the body carries the bright ink', (board) => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    if (board === 'dark') document.documentElement.setAttribute('data-kb-mode', 'dark');
    inBody();
    void see(canvas(), true); frames(2);
    expect(made).toHaveLength(1);
    expect(made[0]!.opts.palette).toEqual(FAB_BRIGHT);
    expect(made[0]!.draw.mock.calls[0]![4]).toEqual({ lo: 0, hi: 1, board, bright: true });
    expect(bodyOfPost()).toHaveAttribute('data-kb-bright-ink');
  });

  test('unmarked, the foil is drawn from FAB_STOPS as today and the body carries no mark', () => {
    inBody();
    void see(canvas(), true); frames(2);
    expect(made[0]!.opts.palette).toEqual(FAB_STOPS.light);
    expect(bodyOfPost()).not.toHaveAttribute('data-kb-bright-ink');
  });

  test('the mark goes when the post unmounts', () => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    const r = inBody();
    const body = bodyOfPost();
    expect(body).toHaveAttribute('data-kb-bright-ink');
    r.unmount();
    expect(body).not.toHaveAttribute('data-kb-bright-ink');
  });

  test('a post mounted standard and then switched to bright takes the bright palette and mark, and back again: neither mode keeps the other\'s foil, band or mark', async () => {
    inBody();
    void see(canvas(), true); frames(10);
    const standard = made[0]!;
    expect(standard.opts.palette).toEqual(FAB_STOPS.light);
    await effects(true);
    frames(10, 1000);
    expect(made).toHaveLength(2);
    expect(made[1]!.opts.palette).toEqual(FAB_BRIGHT);
    expect(made[1]!.draw.mock.calls.at(-1)![4]).toEqual({ lo: 0, hi: 1, board: 'light', bright: true });
    expect(standard.release).toHaveBeenCalledTimes(1);
    expect(bodyOfPost()).toHaveAttribute('data-kb-bright-ink');
    await effects(false);
    frames(10, 3000);
    expect(made).toHaveLength(3);
    expect(made[2]!.opts.palette).toEqual(FAB_STOPS.light);
    expect(made[2]!.draw.mock.calls.at(-1)![4]).toEqual({ lo: 0.59, hi: 1, board: 'light', bright: false });
    expect(made[1]!.release).toHaveBeenCalledTimes(1);
    expect(bodyOfPost()).not.toHaveAttribute('data-kb-bright-ink');
  });

  test('turning it on while the loop sleeps (reduced motion) redraws once, bright', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    inBody();
    void see(canvas(), true); frames(3);
    const settled = draws();
    await effects(true);
    frames(3, 200);
    expect(draws()).toBe(settled + 1);
    expect(made.at(-1)!.opts.palette).toEqual(FAB_BRIGHT);
    expect(probe.running()).toBe(false);
  });

  test('a moment (still) draws bright once and redraws when the mark changes', async () => {
    render(<div className="kb-act-main"><FeelinFabEffect {...props(1)} still /></div>);
    expect(made.at(-1)!.opts.palette).toEqual(FAB_STOPS.light);
    await effects(true);
    expect(made.at(-1)!.opts.palette).toEqual(FAB_BRIGHT);
    expect(bodyOfPost()).toHaveAttribute('data-kb-bright-ink');
  });

  test('a takeover that moves the words to another body while bright is on unmarks the old body and marks the new one', () => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    render(<><div className="kb-act-main" id="a"><FeelinFabEffect {...props(1)} /></div><div className="kb-act-main" id="b" /></>);
    const a = document.getElementById('a')!, b = document.getElementById('b')!;
    expect(a).toHaveAttribute('data-kb-bright-ink');
    b.appendChild(box());
    act(() => { for (const o of resizes) o.cb(); });
    expect(a).not.toHaveAttribute('data-kb-bright-ink');
    expect(b).toHaveAttribute('data-kb-bright-ink');
    a.appendChild(box());
  });

  test.each([['reduced motion', () => document.documentElement.setAttribute('data-kb-motion', 'reduce'), true], ['out of view', () => {}, false]] as const)('turning it off while the loop sleeps (%s) clears the mark', async (_name, setUp, inView) => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    setUp();
    render(<div className="kb-act-main"><FeelinFabEffect {...props(1)} /></div>);
    void see(canvas(), true); frames(3);
    if (!inView) { void see(canvas(), false); frames(3, 100); }
    expect(bodyOfPost()).toHaveAttribute('data-kb-bright-ink');
    await effects(false);
    expect(bodyOfPost()).not.toHaveAttribute('data-kb-bright-ink');
  });

  test('a band that cannot be read paints nothing and asks for no ink', () => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bandState.throws = true;
    inBody();
    expect(bodyOfPost()).not.toHaveAttribute('data-kb-bright-ink');
  });

  test('with no body (the ORIGIN box, a view of its own) there is nothing to mark and the foil is still bright', () => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    render(<FeelinFabEffect {...props(1)} place="origin" />);
    void see(canvas(), true); frames(2);
    expect(made[0]!.opts.palette).toEqual(FAB_BRIGHT);
    expect(document.querySelector('[data-kb-bright-ink]')).toBeNull();
  });

  test('the root watch also names data-kb-effects, and no other attribute; unrelated root changes read no band', async () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    inBody();
    const mine = observe.mock.calls.find(([, o]) => (o as MutationObserverInit | undefined)?.attributeFilter?.includes('data-kb-mode'));
    expect((mine![1] as MutationObserverInit).attributeFilter).toEqual(['data-kb-mode', 'data-kb-effects']);
    void see(canvas(), true); frames(3);
    const reads = vi.mocked(bandFor).mock.calls.length;
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); document.documentElement.setAttribute('data-kb-text', '2'); await Promise.resolve(); });
    expect(vi.mocked(bandFor).mock.calls.length).toBe(reads);
  });

  test('the stylesheet gives the ink and the outline to the foil\'s host, and the words wear them where only the host is painted', () => {
    const css = read('fab.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    /* thread.css reads both on the post body, which is an ANCESTOR of .dw-fab, and custom properties inherit downward only: they must be declared at the root. */
    expect(css).toMatch(/:root\s*\{[^}]*--kb-bright-ink:\s*#ffffff;[^}]*--kb-bright-outline:\s*#000000;/u);
    expect(css.match(/\.dw-fab\s*\{[^}]*\}/u)![0]).not.toMatch(/--kb-bright-/u);
    expect(css).toMatch(/:root\[data-kb-effects="bright"\]\s+\.dw-fab:not\(\[data-kb-bleed\]\)\s+>\s+\.dw-fab-words\s*\{[^}]*color:\s*var\(--kb-bright-ink\)[^}]*text-shadow:[^}]*var\(--kb-bright-outline\)/u);
    expect(css).toMatch(/\.kb-act-main\[data-kb-bright-ink\]\s+\.dw-fab-words\s*\{[^}]*text-shadow:\s*inherit/u);
  });
});

describe("Feelin' Fab's palettes", () => {
  const tokens = tokensOf(read('../../../../engine/ui/tokens.css'), read('../theme.css'));

  test('each palette passes alone: every stop holds 4.5:1 against every post ink on its boards, and sits in the band bandOf leaves free (to its rounding margin)', () => {
    const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
    /* bandOf moves each bound inward by its MARGIN so 8-bit rounding cannot cross it; a palette stop is a hex, so the margin is not owed. */
    const MARGIN = 0.004;
    for (const [board, modes] of [['light', ['light', 'light (chosen)']], ['dark', ['dark', 'dark (device)']]] as const) {
      for (const mode of modes) {
        const band = bandOf(tokens[mode]);
        for (const stop of FAB_STOPS[board]) {
          for (const ink of POST_INK) expect(ratio(tokens[mode][ink]!, stop), `${mode}: ${stop} against ${ink}`).toBeGreaterThanOrEqual(4.5);
          const l = luminance(stop);
          expect(l, `${mode}: ${stop}`).toBeGreaterThanOrEqual(band.lo - MARGIN);
          expect(l, `${mode}: ${stop}`).toBeLessThanOrEqual(band.hi + MARGIN);
        }
      }
    }
  });

  test('the band tells the boards apart the way the Effect reads it: dark only where the band tops out under 0.5', () => {
    expect(bandOf(tokens.light).hi).toBeGreaterThanOrEqual(0.5);
    expect(bandOf(tokens.dark).hi).toBeLessThan(0.5);
    expect(FAB_STOPS.light).toHaveLength(6);
    expect(FAB_STOPS.dark).toHaveLength(6);
  });
});

/* Where the browser can draw in a worker, the foil is drawn there: the canvas is handed over, and the loop's draw callback posts. */
describe("Feelin' Fab drawing in a worker", () => {
  class FakeWorker {
    static made: FakeWorker[] = [];
    readonly sent: Record<string, unknown>[] = [];
    terminated = false;
    constructor() { FakeWorker.made.push(this); }
    private readonly listeners: ((e: unknown) => void)[] = [];
    /* A worker that answers each batch, as foilServe does: after the draws, in a microtask. */
    postMessage(message: Record<string, unknown>) {
      this.sent.push(message);
      if (message.kind === 'frame') queueMicrotask(() => { for (const l of this.listeners) l({ data: { kind: 'ack' } }); });
    }
    addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'message') this.listeners.push(fn); }
    terminate() { this.terminated = true; }
    of(kind: string) { return this.sent.filter((m) => m.kind === kind); }
  }
  type Sent = { t: number; draws: { id: number; spec: { seed: string; pattern: string; palette: readonly string[]; stars: number; glint: string }; key: string; box: { w: number; h: number }; density: number; light: { x: number; y: number }; band: { lo: number; hi: number; board: string; bright: boolean } | null; now: number; idle: boolean }[] };
  const proto = HTMLCanvasElement.prototype as unknown as { transferControlToOffscreen?: () => unknown };
  let transferred: HTMLCanvasElement[] = [];
  const worker = () => FakeWorker.made[0]!;
  const posted = (): Sent[] => worker().of('frame') as unknown as Sent[];
  /* Two hops: a batch is posted in a microtask and acknowledged in the next. */
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
  /* Frames one at a time, with the microtask between them that the browser gives: a frame's draws are posted before the next frame runs. */
  const run = async (n: number, from = 0, step = 16) => { for (let i = 1; i <= n; i++) { flush(from + i * step); await tick(); } };
  const pageContexts = () => vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length;

  beforeEach(() => {
    FakeWorker.made = []; transferred = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    proto.transferControlToOffscreen = function (this: HTMLCanvasElement) { transferred.push(this); return { of: this }; };
    setFoilWorker(() => new FakeWorker() as unknown as Worker);
  });
  afterEach(() => {
    foilProbe.reset();
    setFoilWorker(null);
    delete proto.transferControlToOffscreen;
  });

  test('a post hands its canvas to the worker once and posts its draws, and the page never gets a context from it', async () => {
    render(<FeelinFabEffect {...props(2)} />);
    expect(transferred).toEqual([canvas()]);
    expect(worker().of('adopt')).toHaveLength(1);
    void see(canvas(), true);
    await run(2);
    expect(made, 'no foil is made on the page').toHaveLength(0);
    expect(pageContexts(), 'the page does not draw, size or clear a transferred canvas').toBe(0);
    expect(posted().length).toBeGreaterThanOrEqual(1);
    const d = posted()[0]!.draws[0]!;
    expect(d.id).toBe(foilProbe.idOf(canvas()));
    /* With no post body (no thread here) the box is the words', so the foil keeps its 3px cell; the key is the board and the cell. */
    expect(d.spec).toEqual({ seed: 'p1:f1,f2', pattern: 'bands', palette: FAB_STOPS.light, stars: 8, glint: FAB_GLINT, cell: 3 });
    expect(d.key).toBe('light:3');
    expect(d.box).toEqual({ w: 300, h: 120 });
    expect(d.density).toBe(1.5);
    expect(d.band).toEqual({ lo: 0.59, hi: 1, board: 'light', bright: false });
    expect(d.idle).toBe(false);
    expect(posted()[0]!.t).toBe(d.now);
    expect(probe.draws(box())).toBeGreaterThanOrEqual(1);
  });

  test('on the dark board the draw carries the dark palette, its key and its band', async () => {
    document.documentElement.setAttribute('data-kb-mode', 'dark');
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true);
    await run(2);
    const d = posted()[0]!.draws[0]!;
    expect([d.key, d.spec.palette, d.band]).toEqual(['dark:3', FAB_STOPS.dark, { lo: 0, hi: 0.048, board: 'dark', bright: false }]);
  });

  test('bright, the draw carries FAB_BRIGHT, its own key and the free band; switching back makes the standard spec again', async () => {
    document.documentElement.setAttribute('data-kb-effects', 'bright');
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true);
    await run(2);
    const d = posted()[0]!.draws[0]!;
    expect([d.key, d.spec.palette, d.band]).toEqual(['bright:3', FAB_BRIGHT, { lo: 0, hi: 1, board: 'light', bright: true }]);
    await act(async () => { document.documentElement.removeAttribute('data-kb-effects'); await Promise.resolve(); });
    await run(40, 1000);
    const back = posted().at(-1)!.draws[0]!;
    expect([back.key, back.spec.palette, back.band]).toEqual(['light:3', FAB_STOPS.light, { lo: 0.59, hi: 1, board: 'light', bright: false }]);
  });

  test('a board whose tokens cannot be read posts a draw with no band, which clears the canvas and leaves the words bare', async () => {
    bandState.throws = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true);
    await run(2);
    expect(posted()[0]!.draws[0]!.band).toBeNull();
    log.mockRestore();
  });

  test('every post in one frame is in one frame message', async () => {
    render(<><FeelinFabEffect {...props(1)} /><FeelinFabEffect {...props(2)} /></>);
    for (const c of document.querySelectorAll('canvas')) void see(c, true);
    await run(1);
    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.draws).toHaveLength(2);
  });

  test('leaving view frees the canvas in the worker; coming back posts a draw again', async () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); await run(2);
    const before = posted().length;
    void see(canvas(), false);
    expect(worker().of('free')).toEqual([{ kind: 'free', id: foilProbe.idOf(canvas()) }]);
    await run(3);
    expect(posted()).toHaveLength(before);
    void see(canvas(), true); await run(2, 100);
    expect(posted().length).toBeGreaterThan(before);
  });

  test('a resize repaints at once from the held light and band, with the new box, posted in the same task\'s microtask', async () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); await run(2);
    const lastLight = posted().at(-1)!.draws[0]!.light;
    const before = posted().length;
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    await tick();
    expect(posted()).toHaveLength(before + 1);
    const d = posted().at(-1)!.draws[0]!;
    expect([d.box, d.light, d.band]).toEqual([{ w: 200, h: 80 }, lastLight, { lo: 0.59, hi: 1, board: 'light', bright: false }]);
    expect(pageContexts()).toBe(0);
  });

  test('a resize while out of view posts nothing: the canvas stays freed until the loop draws it', async () => {
    render(<FeelinFabEffect {...props(1)} />);
    void see(canvas(), true); await run(2);
    void see(canvas(), false);
    const before = posted().length;
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    await tick();
    expect(posted()).toHaveLength(before);
  });

  test('unmounting drops the canvas; the last drop ends the worker after its idle grace, and a post mounted meanwhile uses the same one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const one = render(<FeelinFabEffect {...props(1)} />);
      expect(foilProbe.idOf(canvas())).toBeDefined();
      one.unmount();
      expect(worker().of('drop')).toHaveLength(1);
      expect(worker().terminated, 'in its grace').toBe(false);
      const two = render(<div><FeelinFabEffect key="a" {...props(1)} /><FeelinFabEffect key="b" {...props(2)} /></div>);
      expect(FakeWorker.made, 'the next page\'s posts did not start a new worker').toHaveLength(1);
      const ida = foilProbe.idOf(document.querySelectorAll('canvas')[0]!);
      two.rerender(<div><FeelinFabEffect key="b" {...props(2)} /></div>);
      expect(worker().of('drop').at(-1)).toEqual({ kind: 'drop', id: ida });
      vi.advanceTimersByTime(IDLE_MS * 2);
      expect(worker().terminated, 'a canvas is still adopted').toBe(false);
      two.unmount();
      vi.advanceTimersByTime(IDLE_MS);
      expect(worker().terminated).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  test('a play\'s moment (still) never adopts: it is drawn once, at rest, on the page, with no worker', () => {
    render(<FeelinFabEffect {...props(3)} still />);
    expect(transferred).toEqual([]);
    expect(FakeWorker.made).toHaveLength(0);
    expect(draws()).toBe(1);
    expect(canvas().width).toBe(450);
  });

  test('a change of level gives the post a new canvas element (a transferred one cannot be handed over again), and lets the old go', async () => {
    const r = render(<FeelinFabEffect {...props(1)} />);
    const first = canvas();
    void see(first, true); await run(2);
    r.rerender(<FeelinFabEffect {...props(2)} />);
    const second = canvas();
    expect(second).not.toBe(first);
    expect(transferred).toEqual([first, second]);
    expect(worker().of('drop')).toHaveLength(1);
    expect(worker().terminated, 'the worker is kept through the swap').toBe(false);
    void see(second, true); await run(2, 100);
    expect(worker().of('frame').at(-1)).toMatchObject({ draws: [{ spec: { pattern: 'bands' } }] });
  });

  test('a worker that cannot start leaves the post drawing on the page, as it always did', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    setFoilWorker(() => { throw new Error('no worker for you'); });
    render(<FeelinFabEffect {...props(2)} />);
    expect(transferred).toEqual([]);
    expect(canvas().width).toBe(450);
    void see(canvas(), true);
    frames(2);
    expect(made).toHaveLength(1);
    expect(draws()).toBeGreaterThanOrEqual(1);
    expect(log).toHaveBeenCalled();
  });

  test('reduced motion posts one draw, at the rest light, and the loop stops', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<FeelinFabEffect {...props(2)} />);
    void see(canvas(), true);
    await run(10);
    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.draws[0]!.light).toEqual(REST);
    expect(probe.running()).toBe(false);
  });

  test('the header says the foil is drawn in a worker where the browser can, and how a transferred canvas is handled', () => {
    const src = read('./Effect.tsx');
    expect(src).toMatch(/worker/iu);
    expect(src).toMatch(/OffscreenCanvas|offscreen/iu);
    expect(src).toMatch(/key=/u);
  });
});
