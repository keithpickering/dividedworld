/**
 * Glitter Bomb's effect on the flakes (docs/plans/2026-11-06-shine-plan.md, Task 10; the design's sections 2, 3, 5, 6 and 8): the
 * character's posts glitter while the card is up. Three canvases go around the words: under them the settled flakes unlit, painted
 * only when what they depend on changes, and over that what the light changes; over the words the burst; none takes the pointer; the burst fires once per mount, the first time the post is 40% in view, and never
 * under reduced motion or `still`; the flakes are seeded from public ids only; a post out of view gives its flakes back and builds
 * them again, landed, when it returns. The flakes themselves are the engine's (their tests are there); here the engine's functions
 * are spies over the real ones, so what the Effect hands them and when is what is read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { light as pageLight } from '../../../../engine/ui/shine/light.ts';
import { probe } from '../../../../engine/ui/shine/loop.ts';
import { boardStoryIds } from '../../../../e2e/board-stories.ts';

const spies = vi.hoisted(() => ({ clingOver: vi.fn(), clingRegister: vi.fn(), clingUnregister: vi.fn() }));
vi.mock('../../../../engine/ui/shine/flakes.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../engine/ui/shine/flakes.ts')>();
  return {
    ...real,
    makeFlakes: vi.fn(real.makeFlakes),
    burst: vi.fn(real.burst),
    stepBurst: vi.fn(real.stepBurst),
    drawBurst: vi.fn(real.drawBurst),
    release: vi.fn(real.release),
    landAll: vi.fn(real.landAll),
    dropLoose: vi.fn(real.dropLoose),
    cling: {
      ...real.cling,
      register: (host: HTMLElement, options: unknown) => { spies.clingRegister(host, options); return () => spies.clingUnregister(host); },
      over: spies.clingOver,
    },
  };
});
vi.mock('../../../../engine/ui/shine/band.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../engine/ui/shine/band.ts')>();
  return { ...real, bandFor: vi.fn(() => ({ lo: 0.59, hi: 1 })) };
});
import { bandFor } from '../../../../engine/ui/shine/band.ts';
import * as flakesModule from '../../../../engine/ui/shine/flakes.ts';
import { GLITTER_GLINT, GLITTER_HOLO, GLITTER_INKS, GlitterBombEffect } from './Effect.tsx';

const makeFlakes = vi.mocked(flakesModule.makeFlakes);
const burst = vi.mocked(flakesModule.burst);
const drawBurst = vi.mocked(flakesModule.drawBurst);
const release = vi.mocked(flakesModule.release);
const landAll = vi.mocked(flakesModule.landAll);
const dropLoose = vi.mocked(flakesModule.dropLoose);

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-01T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const play: CardPlay = { id: 'g1', card: 'glitter-bomb', layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-01T12:00:00Z', post: 'p1', reach: 'character', on: 'c1', ends: '2099-01-01T00:00:00Z' };
const props = (still = false): EffectProps => ({
  post, plays: [play], states: {}, released: new Set(), reader: { author: false, caster: false }, place: 'thread', reach: 'character', still,
  show: () => {}, met: () => {}, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey',
  children: <p data-kb-words>Hello there.</p>,
});
const box = () => document.querySelector('[data-kb-glitter]') as HTMLElement;
const under = () => box().querySelector('canvas.dw-glitter-under') as HTMLCanvasElement;
const flash = () => box().querySelector('canvas.dw-glitter-flash') as HTMLCanvasElement;
const over = () => box().querySelector('canvas.dw-glitter-over') as HTMLCanvasElement;

let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
const flush = (t: number) => { const run = [...queue.values()]; queue.clear(); for (const cb of run) cb(t); };
const frames = (n: number, from = 0, step = 16) => { for (let i = 1; i <= n; i++) flush(from + i * step); };
let observers: { cb: IntersectionObserverCallback; seen: Set<Element>; opts?: IntersectionObserverInit }[] = [];
class FakeObserver {
  readonly entry = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>(), opts: undefined as IntersectionObserverInit | undefined };
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.entry.cb = cb; this.entry.opts = opts; observers.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); }
  takeRecords() { return []; }
}
/** The post comes into view with `ratio` of it showing (0 is out of view): the loop's any-overlap observer and the burst's 40% one hear it. */
const see = (ratio: number, fill?: number) => act(() => {
  const geometry = fill === undefined ? {} : { intersectionRect: { height: fill * 800 }, rootBounds: { height: 800 } };
  for (const o of observers) for (const el of o.seen) o.cb([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio, ...geometry } as IntersectionObserverEntry], o as unknown as IntersectionObserver);
});
let resizes: { cb: () => void; watching: Set<Element> }[] = [];
class FakeResize {
  readonly entry = { cb: undefined as unknown as () => void, watching: new Set<Element>() };
  constructor(cb: () => void) { this.entry.cb = cb; resizes.push(this.entry); }
  observe(el: Element) { this.entry.watching.add(el); }
  unobserve(el: Element) { this.entry.watching.delete(el); }
  disconnect() { this.entry.watching.clear(); }
}
let size = { w: 300, h: 120 };

/* A canvas context that takes any call, so the engine's real drawing runs. */
const gradient = { addColorStop: () => {} };
const ctx = new Proxy({} as Record<string, unknown>, {
  get: (t, k: string) => (k in t ? t[k] : k.startsWith('create') ? () => gradient : () => {}),
  set: (t, k: string, v) => { t[k] = v; return true; },
});

beforeEach(() => {
  queue = new Map(); nextId = 1; observers = []; resizes = []; size = { w: 300, h: 120 };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('ResizeObserver', FakeResize);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, toJSON: () => ({}) }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  document.documentElement.setAttribute('data-kb-motion', 'full');
  document.documentElement.removeAttribute('data-kb-mode');
  vi.mocked(bandFor).mockReset();
  vi.mocked(bandFor).mockImplementation(() => ({ lo: 0.59, hi: 1 }));
  for (const f of [makeFlakes, burst, drawBurst, release, landAll, dropLoose, flakesModule.stepBurst as ReturnType<typeof vi.fn>]) f.mockClear();
  Object.values(spies).forEach((s) => s.mockClear());
  flakesModule.burstProbe.reset();
});
afterEach(() => {
  cleanup();
  probe.reset(); pageLight.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.removeAttribute('data-kb-mode');
});

const lastFlakes = () => makeFlakes.mock.results.at(-1)!.value as flakesModule.Flakes;

describe('Glitter Bomb', () => {
  test('the layout: the base and the lit canvas below the words and the over canvas above them, hidden from assistive tech, none taking the pointer', () => {
    render(<GlitterBombEffect {...props()} />);
    expect(box().querySelector('[data-kb-words]')).toHaveTextContent('Hello there.');
    for (const c of [under(), flash(), over()]) expect(c).toHaveAttribute('aria-hidden', 'true');
    const css = read('glitter.css').replace(/\/\*[\s\S]*?\*\//gu, '');
    /* Every block whose selector list names the class, together. */
    const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].filter(([, sel]) => sel!.split(',').some((x) => x.trim() === selector)).map(([, , body]) => body).join(';');
    const z = (selector: string) => Number(/z-index:\s*(-?\d+)/u.exec(rule(selector))?.[1]);
    for (const s of ['.dw-glitter-under', '.dw-glitter-flash', '.dw-glitter-over']) {
      expect(rule(s), s).toMatch(/pointer-events:\s*none/u);
      expect(rule(s), s).toMatch(/position:\s*absolute/u);
    }
    expect(z('.dw-glitter-under')).toBeLessThan(z('.dw-glitter-words'));
    expect(z('.dw-glitter-flash')).toBeLessThan(z('.dw-glitter-words'));
    expect(z('.dw-glitter-words')).toBeLessThan(z('.dw-glitter-over'));
    /* The same order in the document: the canvases on one surface (placed over the box the post paints) before the words; the old layer and its alpha are gone. */
    const order = [...box().children].map((el) => el.className);
    expect(order).toEqual(['dw-glitter-surface', 'dw-glitter-words']);
    expect([...box().querySelector('.dw-glitter-surface')!.children].map((el) => el.className)).toEqual(['dw-glitter-under', 'dw-glitter-flash', 'dw-glitter-over']);
    expect(rule('.dw-glitter-surface')).toMatch(/pointer-events:\s*none/u);
    expect(rule('.dw-glitter-surface')).not.toMatch(/z-index/u);
    expect(box().querySelector('.dw-glint, .dw-glitter-sparkle')).toBeNull();
    expect(css).not.toMatch(/twinkle|opacity/u);
  });

  test('the inks are the seven rainbow inks then silver three times, and the glint is a #rrggbb', () => {
    expect(GLITTER_INKS).toEqual(['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec']);
    expect(GLITTER_HOLO).toBe(7);
    expect(GLITTER_GLINT).toMatch(/^#[0-9a-f]{6}$/u);
  });

  test('the seed is public ids only: the play and the post', () => {
    render(<GlitterBombEffect {...props()} />);
    see(1);
    frames(2);
    expect(makeFlakes).toHaveBeenCalledTimes(1);
    const opts = makeFlakes.mock.calls[0]![0];
    expect(opts.seed).toBe('g1:p1');
    expect(opts.inks).toEqual(GLITTER_INKS);
    expect(opts.holo).toBe(GLITTER_HOLO);
    expect(opts.glint).toBe(GLITTER_GLINT);
    expect(JSON.stringify(opts.seed)).not.toMatch(/c1|c2/u);
    expect(read('Effect.tsx')).not.toMatch(/\.character|\.caster|owner|\.on\b/u);
  });

  test('before the post is 40% in view the flakes sit settled; the burst fires the first time it is, and once per mount', () => {
    render(<GlitterBombEffect {...props()} />);
    see(0.2);
    frames(3);
    const first = lastFlakes();
    expect(burst).not.toHaveBeenCalled();
    expect(first.fired).toBe(false);
    see(0.5);
    frames(2, 100);
    expect(burst.mock.calls.filter(([f]) => f === first)).toHaveLength(1);
    expect(first.fired).toBe(true);
    expect(first.flying).toBeGreaterThan(0);
    frames(10, 200);
    expect(drawBurst).toHaveBeenCalled();
    /* It lands, and leaving and coming back at 40% again does not fire it a second time. */
    frames(140, 300);
    expect(first.flying).toBe(0);
    see(0.1); see(0.9); frames(5, 3000);
    expect(burst.mock.calls.filter(([f]) => f === first)).toHaveLength(1);
    expect(burst.mock.calls.filter(([f]) => f !== first && f.flying > 0)).toHaveLength(0);
  });

  test('a post taller than 2.5 viewports still bursts: its visible height fills 40% of the viewport though its own ratio stays 0.3', () => {
    render(<GlitterBombEffect {...props()} />);
    see(0.1, 0.1);
    frames(3);
    const first = lastFlakes();
    expect(first.fired).toBe(false);
    see(0.3, 0.5);
    frames(2, 100);
    expect(burst.mock.calls.filter(([f]) => f === first)).toHaveLength(1);
    expect(first.flying).toBeGreaterThan(0);
  });

  test('the burst second observer is at 40%', () => {
    render(<GlitterBombEffect {...props()} />);
    expect(observers.some((o) => Array.isArray(o.opts?.threshold) && o.opts.threshold.includes(0.4) && o.seen.has(box()))).toBe(true);
  });

  test('under reduced motion there is no burst: every flake is placed at once, and nothing is drawn over the words', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    render(<GlitterBombEffect {...props()} />);
    see(1);
    frames(3);
    const f = lastFlakes();
    expect(f.flying).toBe(0);
    expect(f.settled.length).toBe(f.total);
    expect(drawBurst).not.toHaveBeenCalled();
    expect(flakesModule.burstProbe.inFlight()).toBe(0);
  });

  test('a play\'s moment (still) draws every flake landed at rest, with no burst and no cling, and registers nothing that moves', () => {
    render(<GlitterBombEffect {...props(true)} />);
    const f = lastFlakes();
    expect(f.flying).toBe(0);
    expect(f.settled.length).toBe(f.total);
    expect(landAll).toHaveBeenCalledWith(f);
    expect(burst).not.toHaveBeenCalled();
    expect(drawBurst).not.toHaveBeenCalled();
    expect(spies.clingRegister).not.toHaveBeenCalled();
    fireEvent.pointerMove(box(), { clientX: 10, clientY: 10, pointerType: 'mouse' });
    expect(spies.clingOver).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
    see(1); frames(3);
    expect(probe.draws(box())).toBe(0);
  });

  test('the surface is sticky for cling, the host hands the pointer to it, and unmounting unregisters it, leaves the loop and drops the loose flakes', () => {
    const r = render(<GlitterBombEffect {...props()} />);
    see(1);
    frames(2);
    const el = box();
    /* What cling knows is the surface the glitter paints (the post's whole body in a thread, the host here, where there is none). */
    const face = el.querySelector<HTMLElement>('.dw-glitter-surface')!;
    expect(spies.clingRegister).toHaveBeenCalled();
    const [host, options] = spies.clingRegister.mock.calls.at(-1)! as [HTMLElement, { sticky?: boolean; flakes?: unknown }];
    expect(host).toBe(face);
    expect(options.sticky).toBe(true);
    expect(options.flakes).toBe(lastFlakes());
    fireEvent.pointerMove(el, { clientX: 10, clientY: 10, pointerType: 'mouse' });
    expect(spies.clingOver).toHaveBeenCalledTimes(1);
    flakesModule.loose(face).push({ ...lastFlakes().settled[0]! });
    expect(flakesModule.loose(face)).toHaveLength(1);
    r.unmount();
    expect(spies.clingUnregister).toHaveBeenCalledWith(face);
    expect(flakesModule.loose(face)).toHaveLength(0);
    expect(dropLoose).toHaveBeenCalledWith(face);
    expect(release).toHaveBeenCalled();
    expect(observers.every((o) => o.seen.size === 0)).toBe(true);
    const drawsBefore = probe.draws(el);
    frames(5, 500);
    expect(probe.draws(el)).toBe(drawsBefore);
  });

  test('out of view the flakes are released and dropped, and a return builds them again from the seed, landed, with no second burst', () => {
    render(<GlitterBombEffect {...props()} />);
    see(1);
    frames(2);
    const first = lastFlakes();
    expect(first.fired).toBe(true);
    expect(first.flying).toBeGreaterThan(0);
    expect(flakesModule.burstProbe.inFlight()).toBeGreaterThan(0);
    see(0);
    expect(release).toHaveBeenCalledWith(first);
    expect(flakesModule.burstProbe.inFlight()).toBe(0);
    expect(spies.clingUnregister).toHaveBeenCalled();
    see(1);
    frames(3, 1000);
    expect(makeFlakes).toHaveBeenCalledTimes(2);
    const again = lastFlakes();
    expect(again).not.toBe(first);
    expect(again.flying).toBe(0);
    expect(again.settled.length).toBe(again.total);
    expect(again.total).toBe(first.total);
    expect(again.settled.map((x) => [x.x, x.y])).toEqual(expect.arrayContaining(first.settled.slice(0, 20).map((x) => [x.x, x.y])));
    expect(landAll).toHaveBeenCalledWith(again);
    expect(burst.mock.calls.filter(([f]) => f === again)).toHaveLength(0);
    expect(flakesModule.burstProbe.inFlight()).toBe(0);
    expect((spies.clingRegister.mock.calls.at(-1)![1] as { flakes: unknown }).flakes).toBe(again);
  });
});

describe('Glitter Bomb holds its band and frees its canvases', () => {
  test('the base is painted when the board, the size or the settled count changes, never for a light that only moved; the lit layer every draw', async () => {
    const real = await vi.importActual<typeof import('../../../../engine/ui/shine/flakes.ts')>('../../../../engine/ui/shine/flakes.ts');
    const based: ReturnType<typeof vi.fn>[] = [], lit: ReturnType<typeof vi.fn>[] = [];
    makeFlakes.mockImplementation((o) => { const f = real.makeFlakes(o); based.push(vi.spyOn(f, 'drawBase')); lit.push(vi.spyOn(f, 'drawLit')); return f; });
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(200);
    expect(lastFlakes().flying, 'the burst has landed').toBe(0);
    const b = based.at(-1)!, l = lit.at(-1)!;
    const bases = b.mock.calls.length, lits = l.mock.calls.length;
    expect(bases).toBeGreaterThanOrEqual(1);
    /* The shimmer moves the light on every second frame. */
    frames(20, 4000);
    expect(l.mock.calls.length).toBeGreaterThanOrEqual(lits + 8);
    expect(b, 'a moving light paints no base').toHaveBeenCalledTimes(bases);
    vi.mocked(bandFor).mockImplementation(() => (document.documentElement.getAttribute('data-kb-mode') === 'dark' ? { lo: 0, hi: 0.048 } : { lo: 0.59, hi: 1 }));
    await act(async () => { document.documentElement.setAttribute('data-kb-mode', 'dark'); await Promise.resolve(); });
    frames(2, 5000);
    expect(b, 'a board change paints the base again').toHaveBeenCalledTimes(bases + 1);
  });

  const boardChange = (mode: string) => act(async () => { document.documentElement.setAttribute('data-kb-mode', mode); await Promise.resolve(); });

  test('the band is read in setup and when the board changes, never per draw', async () => {
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(40);
    expect(probe.draws(box())).toBeGreaterThan(10);
    expect(vi.mocked(bandFor).mock.calls.length).toBeLessThanOrEqual(1);
    const before = vi.mocked(bandFor).mock.calls.length;
    const draws = probe.draws(box());
    await boardChange('dark');
    frames(10, 1000);
    expect(vi.mocked(bandFor).mock.calls.length).toBe(before + 1);
    expect(probe.draws(box())).toBeGreaterThan(draws);
  });

  test('a band that could not be read is tried again at the board change, not on every draw, and nothing is drawn meanwhile', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(bandFor).mockImplementation(() => { throw new Error('not a hex color'); });
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(10);
    expect(makeFlakes).not.toHaveBeenCalled();
    expect(vi.mocked(bandFor).mock.calls.length).toBeLessThanOrEqual(1);
    vi.mocked(bandFor).mockImplementation(() => ({ lo: 0.59, hi: 1 }));
    await boardChange('dark');
    frames(5, 500);
    expect(makeFlakes).toHaveBeenCalledTimes(1);
  });

  test('a moment (still) redraws when the board changes, with one more read', async () => {
    render(<GlitterBombEffect {...props(true)} />);
    const before = vi.mocked(bandFor).mock.calls.length;
    await boardChange('dark');
    expect(vi.mocked(bandFor).mock.calls.length).toBe(before + 1);
  });

  test('the box is measured by getBoundingClientRect, fractions included, and the backing store is round(box x density)', () => {
    size = { w: 300.4, h: 119.6 };
    vi.stubGlobal('devicePixelRatio', 1.5);
    render(<GlitterBombEffect {...props()} />);
    for (const c of [under(), flash()]) {
      expect(c.width).toBe(Math.round(300.4 * 1.5));
      expect(c.height).toBe(Math.round(119.6 * 1.5));
    }
    see(1); frames(2);
    expect(makeFlakes.mock.calls[0]![0].box).toEqual({ w: 300.4, h: 119.6 });
  });

  test('the over canvas is sized only while a burst runs, zeroed when it ends, and never sized for still', () => {
    render(<GlitterBombEffect {...props()} />);
    expect(over().width).toBe(0);
    see(0.2); frames(3);
    expect(over().width).toBe(0);
    see(0.5); frames(3, 100);
    expect(lastFlakes().flying).toBeGreaterThan(0);
    expect(over().width).toBe(300);
    expect(over().height).toBe(120);
    frames(160, 300);
    expect(lastFlakes().flying).toBe(0);
    expect(over().width).toBe(0);
    expect(over().height).toBe(0);
    expect(under().width).toBe(300);
    cleanup();
    render(<GlitterBombEffect {...props(true)} />);
    expect(over().width).toBe(0);
    expect(under().width).toBe(300);
  });

  test('out of view every backing store is freed, and the return sizes the canvases under the words again (the over one only if a burst runs)', () => {
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(3);
    expect(under().width).toBe(300);
    expect(flash().width).toBe(300);
    expect(over().width).toBe(300);
    see(0);
    for (const c of [under(), flash(), over()]) { expect(c.width).toBe(0); expect(c.height).toBe(0); }
    frames(4, 100);
    see(1); frames(3, 1000);
    for (const c of [under(), flash()]) { expect(c.width).toBe(300); expect(c.height).toBe(120); }
    expect(over().width).toBe(0);
  });

  test('a resize while out of view keeps the backing stores freed, and the return sizes to the new box', () => {
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(3);
    see(0);
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    expect(under().width).toBe(0);
    expect(flash().width).toBe(0);
    see(1); frames(3, 1000);
    for (const c of [under(), flash()]) { expect(c.width).toBe(200); expect(c.height).toBe(80); }
  });

  test('a resize repaints the under canvas at once with the held light and band, before any frame', async () => {
    const real = await vi.importActual<typeof import('../../../../engine/ui/shine/flakes.ts')>('../../../../engine/ui/shine/flakes.ts');
    const drawn: ReturnType<typeof vi.fn>[] = [];
    const based: ReturnType<typeof vi.fn>[] = [];
    makeFlakes.mockImplementation((o) => { const f = real.makeFlakes(o); drawn.push(vi.spyOn(f, 'drawLit')); based.push(vi.spyOn(f, 'drawBase')); return f; });
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(3);
    const lastLight = drawn[0]!.mock.calls.at(-1)![1];
    const reads = vi.mocked(bandFor).mock.calls.length;
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    /* No frame has run: the resize cleared the canvas, so it is painted in the same task, from the held light and band. */
    expect(drawn).toHaveLength(2);
    expect(makeFlakes.mock.calls.at(-1)![0].box).toEqual({ w: 200, h: 80 });
    const call = drawn[1]!.mock.calls.at(-1)!;
    expect(call[1]).toEqual(lastLight);
    expect(call[2]).toEqual({ lo: 0.59, hi: 1 });
    expect(based[1]!).toHaveBeenCalledTimes(1);
    expect(under().width).toBe(200);
    expect(flash().width).toBe(200);
    expect(vi.mocked(bandFor).mock.calls.length).toBe(reads + 1);
  });

  test('a resize before anything was drawn has no light to repaint with, and waits for the loop', () => {
    render(<GlitterBombEffect {...props()} />);
    size = { w: 200, h: 80 };
    act(() => resizes[0]!.cb());
    expect(makeFlakes).not.toHaveBeenCalled();
  });

  test('once the burst has fired the 40% watcher is stopped: no more threshold callbacks are handled', () => {
    render(<GlitterBombEffect {...props()} />);
    const mine = observers.find((o) => Array.isArray(o.opts?.threshold) && o.opts.threshold.includes(0.4))!;
    see(0.5); frames(3);
    expect(burst).toHaveBeenCalledTimes(1);
    expect(mine.seen.has(box())).toBe(false);
  });

  test('reduced motion turned on mid-burst lands what is in the air at rest and frees the over canvas', async () => {
    render(<GlitterBombEffect {...props()} />);
    see(1); frames(3);
    const f = lastFlakes();
    expect(f.flying).toBeGreaterThan(0);
    expect(over().width).toBe(300);
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); await Promise.resolve(); });
    frames(3, 200);
    expect(release).toHaveBeenCalledWith(f);
    expect(f.flying).toBe(0);
    expect(f.settled.length).toBe(f.total);
    expect(flakesModule.burstProbe.inFlight()).toBe(0);
    expect(over().width).toBe(0);
    expect(over().height).toBe(0);
  });
});

describe('Glitter Bomb teardown', () => {
  test('unmounting disconnects the resize and mode observers and removes the color-scheme listener it added', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const queries = new Map<string, { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }>();
    vi.stubGlobal('matchMedia', (q: string) => {
      if (!queries.has(q)) queries.set(q, { addEventListener: vi.fn(), removeEventListener: vi.fn() });
      return { matches: false, media: q, ...queries.get(q)! };
    });
    const r = render(<GlitterBombEffect {...props()} />);
    const scheme = queries.get('(prefers-color-scheme: dark)')!;
    expect(scheme.addEventListener).toHaveBeenCalledTimes(1);
    expect(resizes.reduce((n, o) => n + o.watching.size, 0)).toBe(1);
    const at = observe.mock.calls.findIndex(([, o]) => (o as MutationObserverInit | undefined)?.attributeFilter?.includes('data-kb-mode'));
    expect(at).toBeGreaterThanOrEqual(0);
    const mine = observe.mock.contexts[at];
    expect(disconnect.mock.contexts).not.toContain(mine);
    r.unmount();
    expect(disconnect.mock.contexts).toContain(mine);
    expect(resizes.every((o) => o.watching.size === 0)).toBe(true);
    expect(scheme.removeEventListener).toHaveBeenCalledTimes(1);
    expect(scheme.removeEventListener.mock.calls[0]).toEqual(scheme.addEventListener.mock.calls[0]);
  });

  test('a StrictMode mount (mount, cleanup, mount) leaves one registration, one resize watch, one 40% watch and no leaked flakes', () => {
    const r = render(<StrictMode><GlitterBombEffect {...props()} /></StrictMode>);
    const host = box();
    expect(observers.reduce((n, o) => n + o.seen.size, 0)).toBe(2);
    expect(resizes.reduce((n, o) => n + o.watching.size, 0)).toBe(1);
    see(1); frames(3);
    expect(probe.draws(host)).toBeGreaterThanOrEqual(1);
    r.unmount();
    expect(observers.reduce((n, o) => n + o.seen.size, 0)).toBe(0);
    expect(resizes.reduce((n, o) => n + o.watching.size, 0)).toBe(0);
    expect(flakesModule.burstProbe.inFlight()).toBe(0);
    frames(3, 500);
    expect(probe.running()).toBe(false);
  });

  test('the story\'s window.__kbShineDraws hook is removed on unmount', async () => {
    const src = read('Glitter.board.stories.tsx');
    expect(src).toMatch(/window\.__kbShineDraws = /u);
    expect(src).toMatch(/delete window\.__kbShineDraws/u);
  });
});

describe('the board stories', () => {
  test('the story seeds its play before the page mounts (e2e/glitter.spec.ts proves the glitter shows)', () => {
    const src = read('Glitter.board.stories.tsx');
    expect(src).toMatch(/thread && ready \? <LoadedThread/u);
    expect(src).toMatch(/setReady\(true\)/u);
  });

  test('the Glitter Bomb stories show the light and the dark board, and the still one, and are listed', () => {
    const src = read('Glitter.board.stories.tsx');
    expect(src).toMatch(/title: 'Boards\/09 Glitter Bomb'/u);
    expect(src).toMatch(/export const Light: Story = \{[^}]*mode: 'light'/u);
    expect(src).toMatch(/export const Dark: Story = \{[^}]*mode: 'dark'/u);
    expect(src).toMatch(/export const Still: Story = \{[^}]*reduced: true/u);
    expect(src).toMatch(/data-kb-glitter/u);
    expect(boardStoryIds()).toEqual(expect.arrayContaining(['boards-09-glitter-bomb--light', 'boards-09-glitter-bomb--dark', 'boards-09-glitter-bomb--still']));
  });
});
