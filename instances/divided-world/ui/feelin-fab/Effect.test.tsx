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
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ratio, tokensOf } from '../../../../engine/ui/contrast.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { bandOf, POST_INK } from '../../../../engine/ui/shine/band.ts';
import { light as pageLight, REST } from '../../../../engine/ui/shine/light.ts';
import { probe } from '../../../../engine/ui/shine/loop.ts';

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
      return document.documentElement.getAttribute('data-kb-mode') === 'dark' ? { lo: 0, hi: 0.048 } : { lo: 0.59, hi: 1 };
    }),
  };
});
import { FAB_GLINT, FAB_STOPS, FeelinFabEffect } from './Effect.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.resolve(here, p), 'utf8');

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-02T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const playOf = (n: number): CardPlay => ({ id: `f${n}`, card: 'feelin-fab', layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-11-02T12:00:00Z', post: 'p1' });
const props = (level: number): EffectProps => ({
  post, plays: Array.from({ length: level }, (_, i) => playOf(i + 1)), states: {}, released: new Set(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
  show: () => {}, met: () => {}, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey',
  children: <p data-kb-words>Hello there.</p>,
});
const box = () => document.querySelector('[data-kb-fab]') as HTMLElement;
const canvas = () => box().querySelector('canvas') as HTMLCanvasElement;
const foils = () => made;
const draws = () => made.reduce((n, f) => n + f.draw.mock.calls.length, 0);

/* A fake rAF the test flushes by hand, a fake IntersectionObserver and ResizeObserver it drives, and a 300 x 120 layout. */
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
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => size.w);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => size.h);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  document.documentElement.setAttribute('data-kb-motion', 'full');
  document.documentElement.removeAttribute('data-kb-mode');
});
afterEach(() => {
  cleanup();
  probe.reset(); pageLight.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.removeAttribute('data-kb-mode');
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
    expect(band).toEqual({ lo: 0.59, hi: 1 });
  });

  test('the canvas is sized to the box at the density the loop returns, and its CSS size is the box (the stylesheet\'s 100%)', () => {
    size = { w: 301, h: 119 };
    render(<FeelinFabEffect {...props(1)} />);
    expect(canvas().width).toBe(Math.round(301 * 1.5));
    expect(canvas().height).toBe(Math.round(119 * 1.5));
    expect(canvas().style.width).toBe('');
    vi.stubGlobal('devicePixelRatio', 5);
    cleanup();
    render(<FeelinFabEffect {...props(1)} />);
    expect(canvas().width).toBe(Math.round(301 * 2));
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

  test('a post that leaves view releases the foil\'s buffers, and draws fresh when it returns', () => {
    render(<FeelinFabEffect {...props(1)} />);
    const c = canvas();
    void see(c, true); frames(2);
    expect(made.every((f) => f.release.mock.calls.length === 0)).toBe(true);
    void see(c, false);
    expect(made.some((f) => f.release.mock.calls.length > 0)).toBe(true);
    const before = draws();
    frames(4, 100);
    expect(draws()).toBe(before);
    void see(c, true); frames(2, 300);
    expect(draws()).toBe(before + 1);
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
    expect(dark!.draw.mock.calls.at(-1)![4]).toEqual({ lo: 0, hi: 0.048 });
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
    expect(css).not.toMatch(/gradient|@keyframes|animation|data-kb-running|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
  });

  test('no style element is ever created: the foil is a canvas', () => {
    const before = document.querySelectorAll('style').length;
    render(<><FeelinFabEffect {...props(1)} /><FeelinFabEffect {...props(2)} /></>);
    expect(document.querySelectorAll('style')).toHaveLength(before);
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
