/**
 * Hot Box's effect (docs/plans/2026-11-15-hot-box-plan.md, Task 4; design, section 2.2): smoke over a post that readers wave away. Read here, as a
 * reader gets it: the canvas's calls (the fog's color and alpha, the clearings cut out of it), the words' `inert`, the live region, the views the Lens is
 * given, and, under forced colors, the words' mask, its rings and its sign. The page's clock is the backend's (`api.now()`), and here it is the faked
 * `Date`, so the play's end passes when the test says. jsdom has no canvas, no frames and no resizing, so each is stubbed; the lines of a post are
 * stubbed too (jsdom cannot measure a range), as three lines of an 800 by 600 box, so a held sweep takes 2 seconds a line and 6 in all.
 */
import { act, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps, KitControl } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { createFake } from '../../../../engine/ui/data/fake.ts';
import { renderIn, testInstance } from '../../../../engine/ui/test-world.tsx';
import { SMOKE, fogAlpha, holeRadius, maskAlpha, puffs, strength } from './smoke.ts';
import { HotBoxEffect, WAVE_DESCRIBE, forgetSprites } from './Effect.tsx';

/* A post's lines, as shares of the box's height, as Whoops!'s `readLines` gives them. */
const { LINES, read } = vi.hoisted(() => {
  const LINES = [
    { top: 0.1, bottom: 0.2, text: 'First line of the post.' },
    { top: 0.4, bottom: 0.5, text: 'Second line.' },
    { top: 0.7, bottom: 0.8, text: 'Third line.' },
  ];
  return { LINES, read: { lines: LINES as { top: number; bottom: number; text: string }[] } };
});
vi.mock('../../cards/whoops/lines.ts', () => ({ readLines: () => read.lines }));

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const ENDS = NOW + 3 * DAY;
const iso = (t: number) => new Date(t).toISOString();
const BOX = { left: 0, top: 100, width: 800, height: 600 };
const HOST = { left: 0, top: 0, width: 800, height: 700 };
/** Time for a sweep: a line is the box's width at Whoops!'s pace, 400 px a second. */
const LINE_MS = 2000;
const SWEEP_MS = 3 * LINE_MS;

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-15T11:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'h1', card: 'hot-box', layer: 1, caster: 'c2', message: '', config: { color: 'teal' }, playedAt: iso(NOW), post: 'p1', ends: iso(ENDS), ...over });

/* ---------------------------------------------------------------------------------------------- the stubs ---- */

interface Fill { readonly style: unknown; readonly op: string; readonly rect: readonly number[] }
interface Gradient { readonly x1: number; readonly y1: number; readonly r1: number; readonly stops: [number, string][] }
let fills: Fill[] = [];
/** The images drawn onto the canvas (the puffs' sprites) since it was last cleared, and every radial gradient made. */
let draws: unknown[][] = [];
let gradients = 0;
let observed: Element[] = [];
let contexts = 0;
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let forced = false;
let forcedListeners: (() => void)[] = [];
let sizeWatchers: (() => void)[] = [];
let sizes = BOX;
/** The post's content area (`.kb-act-main`, border to border), which the smoke fills; the words' box above is inside it. By default the two are the same box. */
let AREA = BOX;
/** The opening post's body around an ORIGIN box's area (`nested` in `setup`): the box is 900 by 700 there, the area is `AREA`. Null where the area is the post's own body. */
let OUTER: typeof BOX | null = null;

function stubCanvas() {
  const ctx = {
    fillStyle: '' as unknown, globalAlpha: 1, globalCompositeOperation: 'source-over',
    setTransform: () => {}, save: () => {}, restore: () => {}, beginPath: () => {},
    clearRect: () => { fills = []; draws = []; },
    drawImage: (...args: unknown[]) => { draws.push(args); },
    fillRect: (...rect: number[]) => { fills.push({ style: ctx.fillStyle, op: ctx.globalCompositeOperation, rect }); },
    createRadialGradient: (_x0: number, _y0: number, _r0: number, x1: number, y1: number, r1: number): Gradient => {
      gradients += 1;
      const g: Gradient = { x1, y1, r1, stops: [] };
      return Object.assign(g, { addColorStop: (at: number, color: string) => { g.stops.push([at, color]); } });
    },
  };
  HTMLCanvasElement.prototype.getContext = (() => { contexts += 1; return ctx; }) as unknown as HTMLCanvasElement['getContext'];
}

function stubWindow() {
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  window.cancelAnimationFrame = vi.fn((id: number) => { frames.delete(id); });
  window.matchMedia = vi.fn((query: string) => ({
    media: query, onchange: null, dispatchEvent: () => true, addListener: () => {}, removeListener: () => {},
    get matches() { return query.includes('forced-colors') ? forced : false; },
    addEventListener: (_t: string, l: () => void) => { if (query.includes('forced-colors')) forcedListeners.push(l); },
    removeEventListener: (_t: string, l: () => void) => { forcedListeners = forcedListeners.filter((x) => x !== l); },
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class { constructor(cb: () => void) { sizeWatchers.push(cb); } observe(el: Element) { observed.push(el); } unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const r = this.classList.contains('dw-hotbox-words') ? sizes : this.classList.contains('dw-hotbox') ? HOST : this.classList.contains('kb-act-main') ? (OUTER ?? AREA) : this.classList.contains('kb-origin-area') ? AREA : { left: 0, top: 0, width: 0, height: 0 };
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
  };
  /* The area's padding box, as the engine's `bodyBox` reads it. */
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { const r = this.classList.contains('kb-act-main') ? (OUTER ?? AREA) : this.classList.contains('kb-origin-area') ? AREA : null; return r ? r.width : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { const r = this.classList.contains('kb-act-main') ? (OUTER ?? AREA) : this.classList.contains('kb-origin-area') ? AREA : null; return r ? r.height : 0; } });
}

/** Runs the frames asked for so far (each asks for the next), as a browser's next frame would. */
const runFrame = () => { const due = [...frames.values()]; frames.clear(); for (const cb of due) cb(0); };
/** Lets `ms` pass in steps, a frame after each: timers fire in order, and the page renders between steps, as it does for a reader. */
function pass(ms: number, step = 100) {
  for (let left = ms; left > 0; left -= step) act(() => { vi.advanceTimersByTime(Math.min(step, left)); runFrame(); });
}

/* ---------------------------------------------------------------------------------------------- the props ---- */

function setup(over: Partial<EffectProps> = {}, strict = false, bare = false, nested = false) {
  const show = vi.fn<(view: CardView | null) => void>();
  const met = vi.fn();
  const save = vi.fn(async () => ({ ok: false as const, error: 'no' }));
  const release = vi.fn(async () => ({ ok: false as const, error: 'no' }));
  const props: EffectProps = {
    post, plays: [play()], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false,
    show, met, ink: NO_INK, holdScreen: () => {}, marks: null, save, release, nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p>The words of the post. <a href="https://example.com/">A link</a></p>, ...over,
  };
  const world = createFake({ instance: testInstance, now: () => Date.now() });
  const effect = <HotBoxEffect {...props} />;
  /* In the thread the effect sits inside the post's content area; `bare` is a post with none (the ORIGIN box), where the area is the effect's own element. */
  const inArea = bare ? effect : nested
    ? <div className="kb-act-main" data-kb-content-area><div className="kb-origin" data-kb-over-ink=""><div className="kb-origin-area" data-kb-content-area><p data-kb-over-ink="" className="lifted">History</p>{effect}</div></div></div>
    : <div className="kb-act-main" data-kb-content-area>{effect}</div>;
  const out = renderIn(world, strict ? <StrictMode>{inArea}</StrictMode> : inArea);
  return { show, met, save, release, props, ...out };
}
type Setup = ReturnType<typeof setup>;

const host = (s: Setup) => s.container.querySelector<HTMLElement>('.dw-hotbox')!;
const area = (s: Setup) => s.container.querySelector<HTMLElement>('.kb-act-main')!;
const words = (s: Setup) => s.container.querySelector<HTMLElement>('.dw-hotbox-words')!;
const canvas = (s: Setup) => s.container.querySelector<HTMLCanvasElement>('canvas.dw-hotbox-smoke');
const button = (s: Setup) => s.container.querySelector<HTMLButtonElement>('button.dw-hotbox-wave');
const readout = (s: Setup) => s.container.querySelector('[aria-live="polite"]')!.textContent;
const sign = (s: Setup) => s.container.querySelector('.dw-hotbox-sign');
const rings = (s: Setup) => [...s.container.querySelectorAll<HTMLElement>('.dw-hotbox-ring')];
const inert = (s: Setup) => words(s).hasAttribute('inert');
const views = (s: Setup): CardView[] => s.show.mock.calls.flatMap((c) => (c[0] ? [c[0]] : []));
const last = (s: Setup): CardView => views(s).at(-1)!;
const wave = (s: Setup): Extract<KitControl, { kind: 'hold' }> => last(s).controls[0] as Extract<KitControl, { kind: 'hold' }>;

/** A pointer event as a browser gives one: returns whether a listener prevented its default. */
function pointer(el: Element, type: string, x: number, y: number, pointerType = 'mouse'): boolean {
  const e = new PointerEvent(type, { bubbles: type !== 'pointerleave', cancelable: true, clientX: x, clientY: y, pointerType, pointerId: 1 });
  act(() => { el.dispatchEvent(e); });
  return e.defaultPrevented;
}
const move = (s: Setup, x = 300, y = 250) => pointer(host(s), 'pointermove', x, y);
/* The pointer is read on the content area, and a leave does not bubble, so it is sent to the area. */
const leave = (s: Setup) => pointer(area(s), 'pointerleave', 0, 0);
const touch = (s: Setup, x = 200, y = 300) => pointer(host(s), 'pointerdown', x, y, 'touch');
const press = (s: Setup) => pointer(button(s)!, 'pointerdown', 10, 10);
const release = (s: Setup) => pointer(button(s)!, 'pointerup', 10, 10);

/* What the canvas was last drawn as. */
const rgba = (style: unknown) => { const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(String(style)); return m ? { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: Number(m[4]) } : null; };
const fog = () => { const f = fills.find((x) => x.op === 'source-over' && typeof x.style === 'string'); return f ? rgba(f.style) : null; };
const circles = () => fills.filter((f) => f.op === 'destination-out' && typeof f.style === 'object').map((f) => f.style as Gradient);
const rectCuts = () => fills.filter((f) => f.op === 'destination-out' && typeof f.style === 'string');
const circleAlpha = (g: Gradient) => rgba(g.stops[0]![1])!.a;

/* What the words' mask is, layer by layer. */
interface Layer { readonly kind: 'flat' | 'circle' | 'rect'; readonly alpha: number; readonly r?: number; readonly x?: number; readonly y?: number; readonly hard?: boolean; readonly top?: number; readonly height?: number }
function layers(s: Setup): Layer[] {
  const style = words(s).style;
  const images = style.maskImage ? style.maskImage.split(/,\s(?=(?:linear|radial)-gradient)/u) : [];
  const sizes = style.maskSize ? style.maskSize.split(', ') : [];
  const positions = style.maskPosition ? style.maskPosition.split(', ') : [];
  return images.map((img, i): Layer => {
    const circle = /radial-gradient\(circle ([\d.]+)px at (-?[\d.]+)px (-?[\d.]+)px, rgba\(0, 0, 0, ([\d.]+)\) ([\d.]+)px, rgba\(0, 0, 0, 0\) ([\d.]+)px\)/u.exec(img);
    if (circle) return { kind: 'circle', r: Number(circle[1]), x: Number(circle[2]), y: Number(circle[3]), alpha: Number(circle[4]), hard: circle[5] === circle[1] && circle[6] === circle[1] };
    const flat = /linear-gradient\(rgba\(0, 0, 0, ([\d.]+)\), rgba\(0, 0, 0, ([\d.]+)\)\)/u.exec(img)!;
    const height = /([\d.]+)px/u.exec(sizes[i] ?? '');
    if (height) return { kind: 'rect', alpha: Number(flat[1]), height: Number(height[1]), top: Number(/([\d.]+)px$/u.exec(positions[i] ?? '')?.[1] ?? Number.NaN) };
    return { kind: 'flat', alpha: Number(flat[1]) };
  });
}
const circleLayers = (s: Setup) => layers(s).filter((l) => l.kind === 'circle');
const rectLayers = (s: Setup) => layers(s).filter((l) => l.kind === 'rect');
const flat = (s: Setup) => layers(s).find((l) => l.kind === 'flat');

beforeEach(() => {
  fills = []; draws = []; gradients = 0; observed = []; read.lines = LINES; contexts = 0; frames = new Map(); frameId = 0; forced = false; forcedListeners = []; sizeWatchers = []; sizes = BOX; AREA = BOX; OUTER = null;
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  stubCanvas();
  stubWindow();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-kb-motion');
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
});

/* ================================================================================================ the tests ==== */

describe('which play', () => {
  test('a live play draws the canvas, the button and inert words', () => {
    const s = setup();
    expect(canvas(s)).not.toBeNull();
    expect(canvas(s)).toHaveAttribute('aria-hidden', 'true');
    expect(canvas(s)).toHaveAttribute('data-kb-effect-ink');
    expect(button(s)).toHaveTextContent('Wave the smoke');
    expect(button(s)).toHaveAttribute('type', 'button');
    expect(button(s)).toHaveAttribute('data-kb-over-ink');
    expect(inert(s)).toBe(true);
    expect(words(s)).toHaveTextContent('The words of the post.');
    expect(fog()).not.toBeNull();
  });

  test('the button has a description, and the hidden live region is polite', () => {
    const s = setup();
    const described = document.getElementById(button(s)!.getAttribute('aria-describedby')!);
    expect(WAVE_DESCRIBE).toContain(`for ${SMOKE.waved / 1000} seconds.`);
    expect(described).toHaveTextContent('Hold Space or Enter on this button to wave the smoke off line by line, at the pace of a hand. Let go and it rolls back in. Hold to the end and the post stays clear for 20 seconds.');
    expect(s.container.querySelector('[aria-live="polite"]')).toHaveClass('kb-visually-hidden');
  });

  test('an ended play draws the words alone and shows nothing', () => {
    const s = setup({ plays: [play({ ends: iso(NOW - 1000) })] });
    expect(canvas(s)).toBeNull();
    expect(button(s)).toBeNull();
    expect(s.container.querySelector('[inert]')).toBeNull();
    expect(s.container.querySelector('.dw-hotbox')).toBeNull();
    expect(s.container).toHaveTextContent('The words of the post.');
    expect(views(s)).toEqual([]);
    expect(s.show).toHaveBeenLastCalledWith(null);
    expect(s.met).not.toHaveBeenCalled();
  });

  test('when the clock passes ends the smoke is gone without a reload', () => {
    const s = setup({ plays: [play({ ends: iso(NOW + 10_000) })] });
    expect(canvas(s)).not.toBeNull();
    pass(9_000, 1000);
    expect(canvas(s)).not.toBeNull();
    pass(2_000, 1000);
    expect(canvas(s)).toBeNull();
    expect(button(s)).toBeNull();
    expect(s.container.querySelector('[inert]')).toBeNull();
    expect(s.show).toHaveBeenLastCalledWith(null);
  });

  test('a second Hot Box cast after the first ended draws the new play and not the old', () => {
    const s = setup({ plays: [play({ id: 'old', ends: iso(NOW - 1000), config: { color: 'red' } }), play({ id: 'new', config: { color: 'blue' } })] });
    expect(fog()!.rgb).toEqual([0, 0, 255]);
  });
});

describe('the color of the smoke', () => {
  test.each([
    ['#rrggbb', '#32cd32', [50, 205, 50]],
    ['#rgb', '#fa0', [255, 170, 0]],
    ['a named color', 'teal', [0, 128, 128]],
    ['a named color in capitals', ' Teal ', [0, 128, 128]],
  ])('fills the canvas with %s (%s) as that color', (_what, color, rgb) => {
    const s = setup({ plays: [play({ config: { color } })] });
    expect(fog()!.rgb).toEqual(rgb);
    s.unmount();
  });

  test.each([['nope'], [''], [42], [undefined]])('only a color that cannot be read (%j) draws light gray', (color) => {
    const s = setup({ plays: [play({ config: { color } })] });
    expect(fog()!.rgb).toEqual([211, 211, 211]);
    s.unmount();
  });
});

describe('the fog', () => {
  test.each([
    ['at landing', 0],
    ['half way', 1.5 * DAY],
    ['near the end', 3 * DAY - 60_000],
  ])('its alpha %s is fogAlpha\'s', (_when, after) => {
    vi.setSystemTime(NOW + after);
    const s = setup();
    expect(fog()!.a).toBeCloseTo(fogAlpha(strength(NOW + after, NOW, ENDS)), 3);
    s.unmount();
  });

  test('is full as the play lands, and thins as the days pass', () => {
    const s = setup();
    expect(fog()!.a).toBeCloseTo(SMOKE.full, 3);
    act(() => { vi.setSystemTime(NOW + 2.5 * DAY); runFrame(); });
    expect(fog()!.a).toBeCloseTo(fogAlpha(strength(NOW + 2.5 * DAY, NOW, ENDS)), 3);
    expect(fog()!.a).toBeLessThan(SMOKE.full);
  });

  test('draws puffs over the fog, and the canvas is sized to the words at the screen\'s density, never over twice it', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const s = setup();
    expect(draws.length).toBeGreaterThan(20);
    expect(canvas(s)!.width).toBe(BOX.width * 2);
    expect(canvas(s)!.height).toBe(BOX.height * 2);
    delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
    s.unmount();
  });

  test('is drawn again, resized, when the content area\'s box changes', () => {
    const s = setup();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    AREA = { ...BOX, width: 400, height: 300 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    act(() => { runFrame(); });
    expect(canvas(s)!.width).toBe(400);
    expect(canvas(s)!.height).toBe(300);
    expect(canvas(s)!.style.width).toBe('400px');
    expect(canvas(s)!.style.height).toBe('300px');
    delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
  });

  test('watches the host and the content area as well as the words, so a move of the words without a resize is measured', () => {
    const s = setup();
    expect(observed).toContain(words(s));
    expect(observed).toContain(host(s));
    expect(observed).toContain(area(s));
  });

  test('is placed where the content area is: a shift of its top without a resize is followed when the watchers fire', () => {
    const s = setup();
    expect(canvas(s)!.style.top).toBe('100px');
    AREA = { ...BOX, top: 150 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    expect(canvas(s)!.style.top).toBe('150px');
  });

  test('later frames make no gradient but for each open clearing: the puffs are drawn from sprites', () => {
    const s = setup();
    act(() => { runFrame(); });
    const before = gradients;
    act(() => { runFrame(); runFrame(); });
    expect(gradients).toBe(before);
    expect(draws.length).toBeGreaterThan(20);
    move(s);
    act(() => { runFrame(); });
    const open = gradients;
    act(() => { runFrame(); });
    expect(gradients - open).toBe(1);
  });

  test('the canvas gives its backing store up out of view and is sized again in view', () => {
    let watch: ((entries: unknown[]) => void) | undefined;
    globalThis.IntersectionObserver = class { constructor(cb: (entries: unknown[]) => void) { watch = cb; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
      const s = setup();
      const see = (isIntersecting: boolean) => act(() => { watch!([{ target: area(s), isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); });
      see(true);
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([800, 600]);
      see(false);
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([0, 0]);
      act(() => { runFrame(); });
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([0, 0]);
      see(true);
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([800, 600]);
      expect(fog()).not.toBeNull();
    } finally {
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
      delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
    }
  });
});

describe('the pointer', () => {
  test('a mouse move opens a clearing at the pointer, and it closes roll after the pointer leaves', () => {
    const s = setup();
    expect(circles()).toHaveLength(0);
    move(s, 300, 250);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 300, y1: 150, r1: holeRadius(BOX.width) });
    expect(circleAlpha(circles()[0]!)).toBe(1);
    /* The clearing goes with the pointer: one clearing, moved. */
    move(s, 340, 270);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 340, y1: 170 });
    pass(2000);
    expect(circles()).toHaveLength(1);
    leave(s);
    pass(SMOKE.roll / 2);
    expect(circles()).toHaveLength(1);
    expect(circleAlpha(circles()[0]!)).toBeCloseTo(0.5, 1);
    pass(SMOKE.roll / 2 + 100);
    expect(circles()).toHaveLength(0);
  });

  test('the clearing is cut with the card\'s soft edge: open at the core, fog again at the rim', () => {
    const s = setup();
    move(s);
    act(() => { runFrame(); });
    const stops = circles()[0]!.stops.map(([at, c]) => [at, rgba(c)!.a] as const);
    expect(stops[0]).toEqual([0, 1]);
    expect(stops.at(-1)).toEqual([1, 0]);
    expect(stops.some(([at, a]) => at > 0.5 && at < 1 && a === 1)).toBe(true);
  });

  test('a touch opens a clearing where it lands, holds it touchHold, then closes it over roll; a second touch replaces the first', () => {
    const s = setup();
    touch(s, 200, 300);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 200, y1: 200 });
    pass(SMOKE.touchHold - 100);
    expect(circleAlpha(circles()[0]!)).toBe(1);
    touch(s, 500, 400);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 500, y1: 300 });
    pass(SMOKE.touchHold);
    expect(circleAlpha(circles()[0]!)).toBe(1);
    pass(SMOKE.roll / 2 + 100);
    expect(circleAlpha(circles()[0]!)).toBeLessThan(1);
    pass(SMOKE.roll);
    expect(circles()).toHaveLength(0);
  });

  test('a touch that moves opens nothing more: the page\'s scroll is never taken', () => {
    const s = setup();
    touch(s, 200, 300);
    pointer(host(s), 'pointermove', 260, 420, 'touch');
    act(() => { runFrame(); });
    expect(circles()[0]).toMatchObject({ x1: 200, y1: 200 });
  });

  test('a pen is read as a mouse: it moves a clearing, opens one where it lands, and closes it on leave', () => {
    const s = setup();
    pointer(host(s), 'pointermove', 300, 250, 'pen');
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 300, y1: 150 });
    pointer(area(s), 'pointerleave', 0, 0, 'pen');
    pass(SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
    pointer(host(s), 'pointerdown', 120, 220, 'pen');
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 120, y1: 120 });
    pointer(area(s), 'pointerleave', 0, 0, 'pen');
    pass(SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
  });

  test('pointing at the wave button closes the mouse clearing: the first line is not read for free', () => {
    const s = setup();
    move(s);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    pointer(button(s)!, 'pointermove', 10, 10);
    pass(SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
    move(s);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    pointer(button(s)!, 'pointerdown', 10, 10);
    release(s);
    pass(SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
  });

  test('no handler calls preventDefault', () => {
    const s = setup();
    const prevented = [
      move(s), touch(s), leave(s), pointer(host(s), 'pointerdown', 5, 5), pointer(host(s), 'pointercancel', 5, 5, 'touch'),
      press(s), release(s), pointer(button(s)!, 'pointerleave', 0, 0), pointer(button(s)!, 'pointercancel', 0, 0),
    ];
    for (const key of [' ', 'Enter']) {
      for (const type of ['keydown', 'keyup']) {
        const e = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
        act(() => { button(s)!.dispatchEvent(e); });
        prevented.push(e.defaultPrevented);
      }
    }
    expect(prevented.every((p) => p === false)).toBe(true);
  });
});

describe('the held sweep', () => {
  test('holding the button with the pointer starts the sweep: the Lens says it is waving, and lines reach the live region in order', () => {
    const s = setup();
    expect(readout(s)).toBe('');
    press(s);
    expect(last(s).state).toBe('Waving it away');
    pass(LINE_MS - 100);
    expect(readout(s)).toBe('');
    pass(100);
    expect(readout(s)).toBe('First line of the post.');
    pass(LINE_MS);
    expect(readout(s)).toBe('Second line.');
    pass(LINE_MS - 100);
    expect(readout(s)).toBe('Second line.');
    expect(last(s).state).toBe('Waving it away');
    pass(100);
    expect(readout(s)).toBe('Third line.');
  });

  test('holding Space or Enter starts it too, but not on auto-repeat, and key up stops it', () => {
    const s = setup();
    for (const key of [' ', 'Enter']) {
      act(() => { button(s)!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
      expect(last(s).state).toBe('Waving it away');
      pass(LINE_MS);
      expect(readout(s)).toBe('First line of the post.');
      /* Auto-repeat neither restarts the sweep nor stops it. */
      act(() => { button(s)!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, repeat: true })); });
      pass(LINE_MS);
      expect(readout(s)).toBe('Second line.');
      act(() => { button(s)!.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); });
      expect(last(s).state).toBe('Smoke over the words');
      pass(SMOKE.roll + 100);
    }
  });

  test('a finished line stays clear while the hold lasts: one rectangle for each, and the clearing travels along the line', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2);
    expect(circles()).toHaveLength(1);
    expect(circles()[0]!.x1).toBeCloseTo(BOX.width / 2, 0);
    expect(circles()[0]!.y1).toBeCloseTo(0.15 * BOX.height, 0);
    expect(rectCuts()).toHaveLength(0);
    pass(LINE_MS / 2);
    expect(rectCuts()).toHaveLength(1);
    expect(rectCuts()[0]!.rect).toEqual([0, 60, 800, 60]);
    pass(LINE_MS);
    expect(rectCuts()).toHaveLength(2);
  });

  test('letting go early restores the fog over roll and leaves the words inert', () => {
    const s = setup();
    press(s);
    pass(LINE_MS + 500);
    expect(rectCuts()).toHaveLength(1);
    release(s);
    expect(last(s).state).toBe('Smoke over the words');
    pass(SMOKE.roll / 2);
    expect(rectCuts()).toHaveLength(1);
    expect(rgba(rectCuts()[0]!.style)!.a).toBeLessThan(1);
    pass(SMOKE.roll / 2 + 100);
    expect(rectCuts()).toHaveLength(0);
    expect(circles()).toHaveLength(0);
    expect(inert(s)).toBe(true);
    expect(fog()!.a).toBeCloseTo(fogAlpha(strength(Date.now(), NOW, ENDS)), 3);
    /* Nothing more is read out once the hold is over, and the post never becomes waved. */
    pass(SWEEP_MS);
    expect(readout(s)).toBe('First line of the post.');
    expect(inert(s)).toBe(true);
  });

  test('holding to the end removes inert for waved, draws no fog, and then restores both', () => {
    const s = setup();
    press(s);
    pass(SWEEP_MS - 100);
    expect(inert(s)).toBe(true);
    pass(100);
    expect(inert(s)).toBe(false);
    expect(last(s)).toMatchObject({ state: 'Waved clear for you', yours: false });
    expect(fills).toEqual([]);
    release(s);
    pass(SMOKE.waved - 200);
    expect(inert(s)).toBe(false);
    expect(fills).toEqual([]);
    pass(200);
    expect(inert(s)).toBe(true);
    expect(last(s).state).toBe('Smoke over the words');
    pass(SMOKE.roll / 2);
    expect(fog()!.a).toBeLessThan(fogAlpha(strength(Date.now(), NOW, ENDS)));
    pass(SMOKE.roll);
    expect(fog()!.a).toBeCloseTo(fogAlpha(strength(Date.now(), NOW, ENDS)), 2);
  });

  test('a link in the words can be focused after a finished sweep, not before', () => {
    const s = setup();
    const link = s.container.querySelector('a')!;
    expect(link.closest('[inert]')).not.toBeNull();
    press(s);
    pass(SWEEP_MS);
    expect(link.closest('[inert]')).toBeNull();
  });

  test('blur stops the hold', () => {
    const s = setup();
    act(() => { button(s)!.focus(); });
    press(s);
    pass(LINE_MS + 100);
    act(() => { button(s)!.blur(); });
    expect(last(s).state).toBe('Smoke over the words');
    pass(SWEEP_MS * 2);
    expect(inert(s)).toBe(true);
    expect(readout(s)).toBe('First line of the post.');
  });

  test('unmounting mid-hold stops it, and stop is safe to call again or without a start', () => {
    const s = setup();
    const control = wave(s);
    press(s);
    pass(LINE_MS + 100);
    const calls = s.show.mock.calls.length;
    s.unmount();
    expect(s.show).toHaveBeenLastCalledWith(null);
    const after = s.show.mock.calls.length;
    expect(after).toBeGreaterThan(calls - 1);
    act(() => { vi.advanceTimersByTime(SWEEP_MS * 2); });
    expect(s.show.mock.calls.length).toBe(after);
    expect(() => { control.stop(); control.stop(); }).not.toThrow();
  });

  test('a release handled before the late timer for the last line still waves the post', () => {
    const s = setup();
    press(s);
    act(() => { vi.setSystemTime(NOW + SWEEP_MS + 500); });
    release(s);
    expect(last(s).state).toBe('Waved clear for you');
    expect(inert(s)).toBe(false);
    expect(readout(s)).toBe('First line of the post. Second line. Third line.');
  });

  test('focus inside the words moves to the button when the waved window ends, not before', () => {
    const s = setup();
    const link = s.container.querySelector('a')!;
    press(s);
    pass(SWEEP_MS);
    release(s);
    act(() => { link.focus(); });
    expect(document.activeElement).toBe(link);
    pass(SMOKE.waved - 200);
    expect(document.activeElement).toBe(link);
    pass(300);
    expect(inert(s)).toBe(true);
    expect(document.activeElement).toBe(button(s));
  });

  test('focus on the button stays there through a full hold', () => {
    const s = setup();
    act(() => { button(s)!.focus(); });
    press(s);
    pass(SWEEP_MS + 500);
    expect(inert(s)).toBe(false);
    expect(document.activeElement).toBe(button(s));
    release(s);
    pass(SMOKE.waved + SMOKE.roll);
    expect(document.activeElement).toBe(button(s));
  });

  test('a box that reflows mid-hold releases the hold', () => {
    const s = setup();
    press(s);
    pass(LINE_MS + 500);
    expect(last(s).state).toBe('Waving it away');
    sizes = { ...BOX, width: 400 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    expect(last(s).state).toBe('Smoke over the words');
    pass(SWEEP_MS * 2);
    expect(inert(s)).toBe(true);
  });

  test('a context menu on the button is swallowed and the hold survives it; the words\' own context menu is left alone', () => {
    const s = setup();
    press(s);
    pass(500);
    const onButton = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { button(s)!.dispatchEvent(onButton); });
    expect(onButton.defaultPrevented).toBe(true);
    expect(last(s).state).toBe('Waving it away');
    pass(LINE_MS);
    expect(readout(s)).toBe('First line of the post.');
    const onWords = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { words(s).dispatchEvent(onWords); });
    expect(onWords.defaultPrevented).toBe(false);
  });

  test('no frame is requested while the post is waved, and frames resume when the smoke rolls back', () => {
    const s = setup();
    press(s);
    pass(SWEEP_MS);
    release(s);
    expect(inert(s)).toBe(false);
    const asked = () => vi.mocked(window.requestAnimationFrame).mock.calls.length;
    const before = asked();
    pass(SMOKE.waved - 1000);
    expect(asked()).toBe(before);
    expect(frames.size).toBe(0);
    pass(1200);
    expect(inert(s)).toBe(true);
    expect(asked()).toBeGreaterThan(before);
  });

  test('a post whose lines cannot be read is swept as one block, and read out whole', () => {
    read.lines = [];
    const s = setup();
    press(s);
    pass(LINE_MS - 100);
    expect(inert(s)).toBe(true);
    pass(100);
    expect(inert(s)).toBe(false);
    expect(readout(s)).toBe(words(s).textContent);
    expect(readout(s)).toContain('The words of the post.');
  });

  test('forced colors turning on mid-hold carries the sweep over to the mask, and it ends as it would have', () => {
    const s = setup();
    press(s);
    pass(LINE_MS + 500);
    forced = true;
    act(() => { for (const l of forcedListeners) l(); });
    expect(last(s).state).toBe('Waving it away');
    expect(sign(s)).not.toBeNull();
    expect(rectLayers(s)).toHaveLength(1);
    pass(SWEEP_MS - LINE_MS - 500 - 100);
    expect(inert(s)).toBe(true);
    pass(100);
    expect(inert(s)).toBe(false);
    expect(words(s).style.maskImage).toBe('');
    forced = false;
    act(() => { for (const l of forcedListeners) l(); runFrame(); });
    expect(sign(s)).toBeNull();
    expect(last(s).state).toBe('Waved clear for you');
  });

  test('after unmount no timer and no frame is left pending', () => {
    const s = setup();
    move(s);
    press(s);
    pass(LINE_MS + 100);
    s.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
  });

  test('the Lens\'s hold control is the button\'s: start and stop drive the same sweep, and stop before a start does nothing', () => {
    const s = setup();
    act(() => { wave(s).stop(); });
    expect(last(s).state).toBe('Smoke over the words');
    act(() => { wave(s).start(); });
    expect(last(s).state).toBe('Waving it away');
    pass(SWEEP_MS);
    expect(inert(s)).toBe(false);
    act(() => { wave(s).stop(); wave(s).stop(); });
    expect(last(s).state).toBe('Waved clear for you');
  });
});

describe('reduced motion', () => {
  beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });

  test('no frame loop runs: it draws once, and again when something changes', () => {
    const s = setup();
    expect(fog()).not.toBeNull();
    const drawn = contexts;
    press(s);
    pass(SWEEP_MS + SMOKE.waved + 5000);
    move(s);
    touch(s);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(contexts).toBeGreaterThan(drawn);
    s.unmount();
  });

  test('a mouse clearing appears and goes with no steps between', () => {
    const s = setup();
    move(s);
    expect(circles()).toHaveLength(1);
    expect(circleAlpha(circles()[0]!)).toBe(1);
    leave(s);
    pass(100);
    expect(circles()).toHaveLength(0);
  });

  test('a touch clearing holds touchHold and then goes at once, never half closed', () => {
    const s = setup();
    touch(s);
    const seen = new Set<number>();
    for (let t = 0; t < SMOKE.touchHold + SMOKE.roll + 500; t += 100) {
      pass(100);
      for (const g of circles()) seen.add(circleAlpha(g));
      if (t < SMOKE.touchHold - 200) expect(circles()).toHaveLength(1);
    }
    expect([...seen]).toEqual([1]);
    expect(circles()).toHaveLength(0);
  });

  test.each([['reduced', true], ['full', false]])('the sweep takes exactly as long (%s motion): the post is waved exactly when the sweep ends, and not before', (_m, reduced) => {
    if (!reduced) document.documentElement.setAttribute('data-kb-motion', 'full');
    const s = setup();
    press(s);
    pass(SWEEP_MS - 1, 1);
    expect(inert(s)).toBe(true);
    pass(1, 1);
    expect(inert(s)).toBe(false);
  });

  test('a held sweep clears each line as it finishes, with no clearing sliding along it', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2);
    expect(circles()).toHaveLength(0);
    expect(rectCuts()).toHaveLength(0);
    pass(LINE_MS / 2);
    expect(rectCuts()).toHaveLength(1);
    pass(LINE_MS);
    expect(rectCuts()).toHaveLength(2);
  });

  test('the fog is drawn again when the strength has moved by a hundredth', () => {
    const s = setup();
    const before = fog()!.a;
    pass(DAY / 2, DAY / 2);
    pass(1, 1);
    expect(fog()!.a).toBeLessThan(before);
    s.unmount();
  });
});

describe('forced colors: a hard circular mask', () => {
  beforeEach(() => { forced = true; });

  test('no frame is requested, and the canvas is never drawn', () => {
    const s = setup();
    move(s);
    press(s);
    pass(3000);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(fog()).toBeNull();
    expect(contexts).toBe(0);
    s.unmount();
  });

  test.each([
    ['at landing', 0],
    ['half way', 1.5 * DAY],
    ['near the end', 3 * DAY - 60_000],
  ])('the words\' mask holds the flat layer at maskAlpha(strength) %s', (_when, after) => {
    vi.setSystemTime(NOW + after);
    const s = setup();
    expect(layers(s)).toHaveLength(1);
    expect(flat(s)!.alpha).toBeCloseTo(maskAlpha(strength(NOW + after, NOW, ENDS)), 3);
    expect(words(s).style.getPropertyValue('-webkit-mask-image')).toBe(words(s).style.maskImage);
    s.unmount();
  });

  test('a mouse move adds a hard-edged circle of holeRadius at the pointer, and a ring; both are gone roll after the pointer leaves', () => {
    const s = setup();
    move(s, 300, 250);
    expect(circleLayers(s)).toHaveLength(1);
    expect(circleLayers(s)[0]).toMatchObject({ r: holeRadius(BOX.width), x: 300, y: 150, alpha: 1, hard: true });
    expect(flat(s)).toBeDefined();
    expect(rings(s)).toHaveLength(1);
    expect(rings(s)[0]).toHaveAttribute('aria-hidden', 'true');
    expect(rings(s)[0]!.style).toMatchObject({ left: '210px', top: '60px', width: '180px', height: '180px' });
    leave(s);
    pass(SMOKE.roll / 2);
    expect(circleLayers(s)).toHaveLength(1);
    expect(circleLayers(s)[0]!.alpha).toBeCloseTo(0.5, 1);
    expect(circleLayers(s)[0]!.hard).toBe(true);
    pass(SMOKE.roll / 2 + 100);
    expect(circleLayers(s)).toHaveLength(0);
    expect(rings(s)).toHaveLength(0);
    expect(flat(s)).toBeDefined();
  });

  test('pointing at the wave button closes the circle and its ring', () => {
    const s = setup();
    move(s);
    expect(circleLayers(s)).toHaveLength(1);
    pointer(button(s)!, 'pointermove', 10, 10);
    pass(SMOKE.roll + 100);
    expect(circleLayers(s)).toHaveLength(0);
    expect(rings(s)).toHaveLength(0);
  });

  test('the frame is placed where the content area is, and follows it when forced colors turn on and shift it', () => {
    forced = false;
    const s = setup();
    expect(s.container.querySelector('.dw-hotbox-frame')).toBeNull();
    AREA = { ...BOX, top: 140 };
    forced = true;
    act(() => { for (const l of forcedListeners) l(); });
    expect(s.container.querySelector<HTMLElement>('.dw-hotbox-frame')!.style.top).toBe('140px');
  });

  test('a touch\'s circle holds touchHold first, and the next touch replaces it', () => {
    const s = setup();
    touch(s, 200, 300);
    pass(SMOKE.touchHold - 100);
    expect(circleLayers(s)).toHaveLength(1);
    expect(circleLayers(s)[0]!.alpha).toBe(1);
    touch(s, 500, 400);
    expect(circleLayers(s)).toHaveLength(1);
    expect(circleLayers(s)[0]).toMatchObject({ x: 500, y: 300 });
    pass(SMOKE.touchHold);
    expect(circleLayers(s)[0]!.alpha).toBe(1);
    pass(SMOKE.roll / 2 + 100);
    expect(circleLayers(s)[0]!.alpha).toBeLessThan(1);
    pass(SMOKE.roll);
    expect(circleLayers(s)).toHaveLength(0);
    expect(rings(s)).toHaveLength(0);
  });

  test('the held sweep adds a rectangle for each finished line and takes exactly as long as on the canvas path', () => {
    const s = setup();
    press(s);
    pass(LINE_MS - 1, 1);
    expect(rectLayers(s)).toHaveLength(0);
    pass(1, 1);
    expect(rectLayers(s)).toHaveLength(1);
    expect(rectLayers(s)[0]).toMatchObject({ top: 60, height: 60, alpha: 1 });
    pass(LINE_MS);
    expect(rectLayers(s)).toHaveLength(2);
    expect(readout(s)).toBe('Second line.');
    pass(LINE_MS - 1, 1);
    expect(inert(s)).toBe(true);
    pass(1, 1);
    expect(inert(s)).toBe(false);
  });

  test('letting go early rolls the finished lines closed over roll', () => {
    const s = setup();
    press(s);
    pass(LINE_MS + 200);
    release(s);
    pass(SMOKE.roll / 2);
    expect(rectLayers(s)).toHaveLength(1);
    expect(rectLayers(s)[0]!.alpha).toBeLessThan(1);
    pass(SMOKE.roll / 2 + 100);
    expect(rectLayers(s)).toHaveLength(0);
    expect(inert(s)).toBe(true);
  });

  test('waved removes the mask for waved, and then it is back', () => {
    const s = setup();
    press(s);
    pass(SWEEP_MS);
    expect(words(s).style.maskImage).toBe('');
    expect(words(s).style.getPropertyValue('-webkit-mask-image')).toBe('');
    release(s);
    pass(SMOKE.waved - 200);
    expect(words(s).style.maskImage).toBe('');
    pass(200);
    expect(inert(s)).toBe(true);
    pass(SMOKE.roll + 200);
    expect(flat(s)!.alpha).toBeCloseTo(maskAlpha(strength(Date.now(), NOW, ENDS)), 2);
  });

  test('the sign shows the view\'s state and its way out, and follows the state', () => {
    const s = setup();
    expect(sign(s)).toHaveTextContent(last(s).state);
    expect(sign(s)).toHaveTextContent(last(s).ends!);
    press(s);
    expect(sign(s)).toHaveTextContent('Waving it away');
    pass(SWEEP_MS);
    expect(sign(s)).toHaveTextContent('Waved clear for you');
    expect(sign(s)!.parentElement).toBe(host(s));
    expect(words(s).previousElementSibling).toBe(sign(s));
  });

  test('the words are inert, as on the canvas path, and the button is never inert', () => {
    const s = setup();
    expect(inert(s)).toBe(true);
    expect(button(s)!.closest('[inert]')).toBeNull();
  });

  test('stubbed not to match, the wrapper has no mask, no ring and no sign: the full effect is untouched', () => {
    forced = false;
    const s = setup();
    move(s);
    act(() => { runFrame(); });
    expect(words(s).style.maskImage).toBe('');
    expect(words(s).getAttribute('style') ?? '').not.toContain('mask');
    expect(rings(s)).toHaveLength(0);
    expect(sign(s)).toBeNull();
    expect(fog()).not.toBeNull();
    expect(circles()).toHaveLength(1);
    expect(circleAlpha(circles()[0]!)).toBe(1);
    expect(circles()[0]!.stops.at(-2)![0]).toBeLessThan(1);
  });

  test('the mode is followed as it changes: forced on mid-view takes the canvas away, off brings it back', () => {
    forced = false;
    const s = setup();
    expect(sign(s)).toBeNull();
    forced = true;
    act(() => { for (const l of forcedListeners) l(); });
    expect(sign(s)).not.toBeNull();
    expect(layers(s)).toHaveLength(1);
    forced = false;
    act(() => { for (const l of forcedListeners) l(); runFrame(); });
    expect(sign(s)).toBeNull();
    expect(words(s).style.maskImage).toBe('');
  });

  test('reduced motion: a circle appears and goes with no steps between, and the sweep takes as long', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const s = setup();
    touch(s);
    const alphas = new Set<number>();
    for (let t = 0; t < SMOKE.touchHold + SMOKE.roll; t += 100) { pass(100); for (const c of circleLayers(s)) alphas.add(c.alpha); }
    expect([...alphas]).toEqual([1]);
    expect(circleLayers(s)).toHaveLength(0);
    release(s);
    press(s);
    pass(SWEEP_MS - 1, 1);
    expect(inert(s)).toBe(true);
    pass(1, 1);
    expect(inert(s)).toBe(false);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  test('a moment (still) is the flat layer alone, drawn once: no ring, no circle on a pointer, no button', () => {
    const s = setup({ still: true });
    expect(layers(s)).toHaveLength(1);
    expect(flat(s)!.alpha).toBeCloseTo(maskAlpha(1), 3);
    move(s);
    touch(s);
    expect(layers(s)).toHaveLength(1);
    expect(rings(s)).toHaveLength(0);
    expect(button(s)).toBeNull();
    expect(inert(s)).toBe(false);
  });
});

/* ---------------------------------------------------------------------------- the content area is the container ---- */

/*
 * The owner, 2026-11-15: the smoke fills the whole post content area, as Whoops!'s ink and Feelin' Fab's foil do (the post body, `.kb-act-main`, border
 * to border: engine/ui/cards/body.ts), and that area is its container. The words' box is smaller and offset inside it: here the area is 900 by 700 at
 * left -20, top 50, and the words (800 by 600, at 0, 100 in the page) stand 20 right of and 50 below the area's corner.
 */
const WIDE = { left: -20, top: 50, width: 900, height: 700 };
/** A point of the area that is outside the words' box: the area's (10, 10), in page px. */
const OUTSIDE = { x: -10, y: 60 };

describe('the content area is the container', () => {
  beforeEach(() => { AREA = WIDE; });

  test('the canvas is sized and placed to the content area\'s box, not the words\'', () => {
    const s = setup();
    expect(canvas(s)!.style).toMatchObject({ left: '-20px', top: '50px', width: '900px', height: '700px' });
    expect(canvas(s)!.width).toBe(900);
    expect(canvas(s)!.height).toBe(700);
  });

  test('the fog covers that whole box', () => {
    setup();
    const f = fills.find((x) => x.op === 'source-over' && typeof x.style === 'string')!;
    expect(f.rect).toEqual([0, 0, 900, 700]);
  });

  test('puffs and a clearing\'s radius come from the area\'s width and height', () => {
    AREA = { left: 0, top: 50, width: 400, height: 300 };
    const s = setup();
    expect(puffs(1, 400, 300).length).not.toBe(puffs(1, 800, 600).length);
    expect(draws).toHaveLength(puffs(1, 400, 300).length);
    expect(holeRadius(400)).not.toBe(holeRadius(800));
    move(s, 100, 150);
    act(() => { runFrame(); });
    expect(circles()[0]).toMatchObject({ r1: holeRadius(400) });
  });

  test('a mouse move at a point in the area outside the words opens a clearing there, in the area\'s coordinates', () => {
    const s = setup();
    move(s, OUTSIDE.x, OUTSIDE.y);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
    expect(circles()[0]).toMatchObject({ x1: 10, y1: 10, r1: holeRadius(900) });
    leave(s);
    pass(SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
  });

  test('a touch anywhere in the area opens a clearing, but a press on what the engine lifts over the ink (the reactions row, a fold bar) opens none', () => {
    const s = setup();
    touch(s, 400, 400);
    act(() => { runFrame(); });
    expect(circles()[0]).toMatchObject({ x1: 420, y1: 350 });
    const lifted = document.createElement('div');
    lifted.setAttribute('data-kb-over-ink', '');
    area(s).appendChild(lifted);
    pass(SMOKE.touchHold + SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
    pointer(lifted, 'pointerdown', 100, 100, 'touch');
    pointer(lifted, 'pointermove', 100, 100);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(0);
  });

  test('the held sweep travels the words\' lines, offset into the area\'s coordinates', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2);
    /* Half way along the words' first line (60 to 120 in the words): across the words' 800 from the words' left, down the area by the words' top. */
    expect(circles()[0]).toMatchObject({ x1: 20 + 400, y1: 50 + 90 });
    pass(LINE_MS / 2);
    expect(rectCuts()).toHaveLength(1);
    expect(rectCuts()[0]!.rect).toEqual([20, 110, 800, 60]);
    expect(inert(s)).toBe(true);
  });

  test('words that move in the area let go of a held sweep', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2);
    expect(last(s).state).toBe('Waving it away');
    sizes = { ...BOX, top: 130 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    expect(last(s).state).toBe('Smoke over the words');
    pass(LINE_MS * 4);
    expect(inert(s)).toBe(true);
    /* The hold really stopped: no line is announced, the post is never waved, and the finished-line cuts roll shut. */
    expect(readout(s)).toBe('');
    expect(last(s).state).toBe('Smoke over the words');
    expect(rectCuts()).toHaveLength(0);
    expect(circles()).toHaveLength(0);
  });

  test('a sub-pixel shift of the words mid-hold keeps the hold, and a 5 px shift lets it go', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2);
    sizes = { ...BOX, top: BOX.top + 0.3, height: BOX.height + 0.2 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    expect(last(s).state).toBe('Waving it away');
    sizes = { ...BOX, top: BOX.top + 5 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    expect(last(s).state).toBe('Smoke over the words');
  });

  test('after unmount, and after the play ends, a pointer move on the content area opens nothing and throws nothing, and its listeners are all removed', () => {
    const adds: string[] = [], removes: string[] = [];
    const realAdd = EventTarget.prototype.addEventListener, realRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
      if (type.startsWith('pointer') && (this as Element).classList?.contains('kb-act-main')) adds.push(type);
      return (realAdd as (...a: unknown[]) => void).call(this, type, ...rest);
    } as never;
    EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
      if (type.startsWith('pointer') && (this as Element).classList?.contains('kb-act-main')) removes.push(type);
      return (realRemove as (...a: unknown[]) => void).call(this, type, ...rest);
    } as never;
    try {
      const moveOn = (el: Element) => expect(() => el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 300, clientY: 250, pointerType: 'mouse', pointerId: 1 }))).not.toThrow();
      const s = setup({ plays: [play({ ends: iso(NOW + 10_000) })] });
      const a = area(s);
      expect(adds.sort()).toEqual(['pointerdown', 'pointerleave', 'pointermove']);
      pass(11_000, 1000);
      expect(canvas(s)).toBeNull();
      expect(removes.sort()).toEqual(adds.sort());
      const shows = s.show.mock.calls.length;
      moveOn(a);
      expect(s.show.mock.calls.length).toBe(shows);
      expect(vi.getTimerCount()).toBe(0);
      adds.length = 0; removes.length = 0;
      const t = setup();
      const b = area(t);
      expect(adds).toHaveLength(3);
      t.unmount();
      expect(removes.sort()).toEqual(adds.sort());
      moveOn(b);
      expect(vi.getTimerCount()).toBe(0);
      expect(frames.size).toBe(0);
    } finally {
      EventTarget.prototype.addEventListener = realAdd;
      EventTarget.prototype.removeEventListener = realRemove;
    }
  });

  test('the observers and listeners follow the post body when its node is replaced', () => {
    const s = setup();
    const fresh = document.createElement('div');
    fresh.className = 'kb-act-main';
    fresh.setAttribute('data-kb-content-area', '');
    s.container.appendChild(fresh);
    fresh.appendChild(host(s));
    act(() => { for (const cb of sizeWatchers) cb(); });
    expect(observed).toContain(fresh);
    pointer(fresh, 'pointermove', 300, 250);
    act(() => { runFrame(); });
    expect(circles()).toHaveLength(1);
  });

  test('with no post body about it (the ORIGIN box) the area is the effect\'s own element', () => {
    const s = setup({}, false, true);
    expect(canvas(s)!.style).toMatchObject({ left: '0px', top: '0px', width: '800px', height: '700px' });
    pointer(host(s), 'pointermove', 300, 250);
    act(() => { runFrame(); });
    expect(circles()[0]).toMatchObject({ x1: 300, y1: 250 });
    pointer(host(s), 'pointerleave', 0, 0);
    pass(SMOKE.roll + 100);
    expect(circles()).toHaveLength(0);
  });

  test('a moment fills the same area, drawn once, with no handler', () => {
    const s = setup({ still: true });
    expect(canvas(s)!.style).toMatchObject({ left: '-20px', top: '50px', width: '900px', height: '700px' });
    expect(fills.find((x) => x.op === 'source-over' && typeof x.style === 'string')!.rect).toEqual([0, 0, 900, 700]);
    const before = [...fills];
    pointer(area(s), 'pointermove', 100, 100);
    pass(500);
    expect(fills).toEqual(before);
  });

  describe('under forced colors', () => {
    beforeEach(() => { forced = true; });

    test('the frame that outlines the post is the content area\'s box, not the words\'', () => {
      const s = setup();
      const frame = s.container.querySelector<HTMLElement>('.dw-hotbox-frame')!;
      expect(frame.style).toMatchObject({ left: '-20px', top: '50px', width: '900px', height: '700px' });
      expect(words(s).style.maskImage).not.toBe('');
    });

    test('the frame takes the engine\'s ink level, so another card\'s ink cannot cover the outline and rings', () => {
      const s = setup();
      expect(s.container.querySelector('.dw-hotbox-frame')).toHaveAttribute('data-kb-effect-ink');
    });

    test('a ring may be anywhere in the area, outside the words\' box too', () => {
      const s = setup();
      move(s, OUTSIDE.x, OUTSIDE.y);
      expect(rings(s)).toHaveLength(1);
      expect(rings(s)[0]!.style).toMatchObject({ left: '-80px', top: '-80px', width: '180px', height: '180px' });
    });

    test('the mask\'s circle is in the words\' coordinates: the pointer at the area\'s (x, y) is the circle at (x - words left, y - words top)', () => {
      const s = setup();
      move(s, 320, 260);
      /* Area (340, 210) -> words (320, 160). */
      expect(circleLayers(s)).toHaveLength(1);
      expect(circleLayers(s)[0]).toMatchObject({ x: 320, y: 160, r: holeRadius(900), hard: true });
      expect(rings(s)[0]!.style).toMatchObject({ left: '250px', top: '120px' });
    });

    test('the mask\'s circle for a point outside the words has negative words coordinates', () => {
      const s = setup();
      move(s, OUTSIDE.x, OUTSIDE.y);
      expect(circleLayers(s)[0]).toMatchObject({ x: -10, y: -40 });
    });

    test('the sweep\'s rectangles are in the words\' coordinates', () => {
      const s = setup();
      press(s);
      pass(LINE_MS);
      expect(rectLayers(s)).toHaveLength(1);
      expect(rectLayers(s)[0]).toMatchObject({ top: 60, height: 60, alpha: 1 });
    });
  });

  test('with forced colors off none of the mask, ring, sign or frame exists', () => {
    const s = setup();
    move(s, OUTSIDE.x, OUTSIDE.y);
    act(() => { runFrame(); });
    expect(words(s).getAttribute('style') ?? '').not.toContain('mask');
    expect(rings(s)).toHaveLength(0);
    expect(sign(s)).toBeNull();
    expect(s.container.querySelector('.dw-hotbox-frame')).toBeNull();
    expect(circles()).toHaveLength(1);
  });
});

describe('what it tells the Lens', () => {
  test('its view, in the plan\'s words, with one hold control', () => {
    const s = setup();
    expect(last(s)).toMatchObject({
      state: 'Smoke over the words',
      ends: `Point at the words, or hold Wave the smoke, to read. ${endsWords(iso(ENDS))}.`,
      yours: true,
      notes: {},
    });
    expect(last(s).progress).toBeCloseTo(0, 2);
    expect(last(s).controls).toHaveLength(1);
    expect(last(s).controls[0]).toMatchObject({ kind: 'hold', label: 'Wave the smoke' });
    expect(wave(s).describe).toBe(document.getElementById(button(s)!.getAttribute('aria-describedby')!)!.textContent);
  });

  test('progress is how far the smoke has thinned', () => {
    vi.setSystemTime(NOW + 2.5 * DAY);
    const s = setup();
    expect(last(s).progress).toBeCloseTo(1 - strength(NOW + 2.5 * DAY, NOW, ENDS), 2);
    expect(last(s).progress).toBeGreaterThan(0.8);
  });

  test('equal views cost nothing: a clearing opening does not tell the Lens again', () => {
    const s = setup();
    const calls = s.show.mock.calls.filter((c) => c[0]).length;
    move(s);
    touch(s);
    pass(1000);
    expect(s.show.mock.calls.filter((c) => c[0]).length).toBe(calls);
  });

  test('every view shown passes viewProblems, and no state runs over six words', () => {
    const s = setup();
    press(s);
    pass(LINE_MS);
    release(s);
    pass(SMOKE.roll);
    press(s);
    pass(SWEEP_MS + SMOKE.waved + SMOKE.roll);
    expect(new Set(views(s).map((v) => v.state))).toEqual(new Set(['Smoke over the words', 'Waving it away', 'Waved clear for you']));
    for (const v of views(s)) {
      expect(viewProblems(v, { holds: false, covers: true })).toEqual([]);
      expect(v.state.split(/\s+/u).length).toBeLessThanOrEqual(6);
    }
    const still = setup({ still: true });
    for (const v of views(still)) expect(viewProblems(v, { holds: false, covers: true })).toEqual([]);
  });

  test('is met once however often the post goes out of view and comes back', () => {
    let watch: ((entries: unknown[]) => void) | undefined;
    globalThis.IntersectionObserver = class { constructor(cb: (entries: unknown[]) => void) { watch = cb; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
    try {
      const s = setup({}, true);
      const see = (isIntersecting: boolean) => act(() => { watch!([{ target: area(s), isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); });
      see(true);
      see(false);
      see(true);
      expect(s.met).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    }
  });

  test('is met once, the first time the smoke is drawn in view', () => {
    const s = setup();
    expect(s.met).toHaveBeenCalledTimes(1);
    pass(5000);
    move(s);
    expect(s.met).toHaveBeenCalledTimes(1);
  });
});

describe('in view', () => {
  let watch: ((entries: unknown[]) => void) | undefined;
  beforeEach(() => {
    watch = undefined;
    globalThis.IntersectionObserver = class { constructor(cb: (entries: unknown[]) => void) { watch = cb; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => { delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver; });
  const see = (s: Setup, isIntersecting: boolean) => act(() => { watch!([{ target: area(s), isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); });

  test('the loop runs only while the post is in view, and met waits for the first sight of it', () => {
    const s = setup();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(s.met).not.toHaveBeenCalled();
    see(s, true);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    expect(s.met).toHaveBeenCalledTimes(1);
    see(s, false);
    const asked = vi.mocked(window.requestAnimationFrame).mock.calls.length;
    act(() => { runFrame(); runFrame(); });
    expect(vi.mocked(window.requestAnimationFrame).mock.calls.length).toBe(asked);
    expect(frames.size).toBe(0);
    see(s, true);
    expect(frames.size).toBe(1);
    expect(s.met).toHaveBeenCalledTimes(1);
  });

  test('before the observer has reported, the canvas is kept and fogged: the words are never bare while it is unknown', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    try {
      const s = setup();
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([800, 600]);
      expect(fog()!.a).toBeCloseTo(SMOKE.full, 3);
      expect(s.met).not.toHaveBeenCalled();
      expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    } finally {
      delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
    }
  });

  test('only a reported "out of view" releases the canvas, and the report of "in view" restores and fogs it in the same commit', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    try {
      const s = setup();
      see(s, false);
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([0, 0]);
      const before = contexts;
      see(s, true);
      expect([canvas(s)!.width, canvas(s)!.height]).toEqual([800, 600]);
      expect(fog()!.a).toBeCloseTo(fogAlpha(strength(Date.now(), NOW, ENDS)), 3);
      /* Painted by the layout effect of the commit that restored it, and again by the loop's first frame: two draws, no animation frame having run. */
      expect(contexts - before).toBeGreaterThanOrEqual(2);
      expect(frames.size).toBe(1);
    } finally {
      delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
    }
  });

  test('the element watched is the content area (the post body), and the host in an ORIGIN box', () => {
    const targets: Element[] = [];
    globalThis.IntersectionObserver = class { constructor(cb: (entries: unknown[]) => void) { watch = cb; } observe(el: Element) { targets.push(el); } unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
    const s = setup();
    expect(targets).toEqual([area(s)]);
    s.unmount();
    targets.length = 0;
    const b = setup({}, false, true);
    expect(targets).toEqual([host(b)]);
  });

  test('the observer is given a margin, so the canvas is back before the post shows', () => {
    const options: unknown[] = [];
    globalThis.IntersectionObserver = class { constructor(cb: (entries: unknown[]) => void, o?: unknown) { watch = cb; options.push(o); } observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
    setup();
    expect(options).toEqual([{ rootMargin: '200px 0px' }]);
  });
});

describe('the puffs\' sprites', () => {
  test('a browser that gives an offscreen canvas no 2D context is asked once for each sprite, not every frame', () => {
    forgetSprites();
    const made = vi.spyOn(document, 'createElement');
    const ctx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: unknown[]) {
      return this.classList.contains('dw-hotbox-smoke') ? (ctx as (...x: unknown[]) => unknown).apply(this, a) : null;
    } as unknown as HTMLCanvasElement['getContext'];
    try {
      setup();
      const canvases = () => made.mock.calls.filter((c) => c[0] === 'canvas').length;
      const first = canvases();
      act(() => { runFrame(); runFrame(); runFrame(); });
      act(() => { runFrame(); runFrame(); });
      expect(canvases()).toBe(first);
      expect(first).toBeLessThanOrEqual(3);
      expect(gradients).toBeGreaterThan(0);
    } finally {
      made.mockRestore();
      HTMLCanvasElement.prototype.getContext = ctx;
      forgetSprites();
    }
  });
});

describe('a moment (still)', () => {
  test('nothing is inert, no button or handler exists, no frame is requested, and nothing is met', () => {
    const s = setup({ still: true });
    expect(s.container.querySelector('[inert]')).toBeNull();
    expect(button(s)).toBeNull();
    expect(s.container.querySelector('[aria-live]')).toBeNull();
    expect(canvas(s)).not.toBeNull();
    expect(fog()).not.toBeNull();
    const before = [...fills];
    move(s); touch(s); leave(s);
    pass(SMOKE.touchHold + SMOKE.roll);
    expect(circles()).toHaveLength(0);
    expect(fills).toEqual(before);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(s.met).not.toHaveBeenCalled();
    expect(s.show).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'Smoke over the words', controls: [] }));
  });

  test('draws the fog and the puffs as they stood: full, whatever the clock says', () => {
    vi.setSystemTime(NOW + 2.5 * DAY);
    const s = setup({ still: true, plays: [play({ ends: iso(NOW + DAY) })] });
    expect(fog()!.a).toBeCloseTo(SMOKE.full, 3);
    expect(draws.length).toBeGreaterThan(20);
    expect(s.container.querySelector('.dw-hotbox')).not.toBeNull();
  });
});

describe('nobody is special', () => {
  test('two readers who differ only in reader.author and reader.caster get the same smoke', () => {
    const a = setup({ reader: { author: false, caster: false } });
    /* The ids React hands out differ by render; nothing else may. */
    const same = (html: string) => html.replace(/(id|aria-describedby)="[^"]*"/gu, '');
    const htmlA = same(a.container.innerHTML); const fogA = fills.length;
    a.unmount();
    const b = setup({ reader: { author: true, caster: true } });
    expect(same(b.container.innerHTML)).toBe(htmlA);
    expect(fills.length).toBe(fogA);
    /* The views are equal but for their controls' functions, which are each render's own. */
    const plain = (x: Setup) => views(x).map((v) => ({ ...v, controls: v.controls.map((c) => ({ kind: c.kind, label: c.label })) }));
    expect(plain(b)).toEqual(plain(a));
  });

  test('it never reads who wrote the post or cast the card, and never saves, releases or holds the screen', () => {
    const reads: string[] = [];
    const reader = { get author() { reads.push('author'); return false; }, get caster() { reads.push('caster'); return false; } };
    const holdScreen = vi.fn();
    const s = setup({ reader, holdScreen });
    move(s); touch(s);
    press(s);
    pass(SWEEP_MS + 100);
    release(s);
    expect(reads).toEqual([]);
    expect(s.save).not.toHaveBeenCalled();
    expect(s.release).not.toHaveBeenCalled();
    expect(holdScreen).not.toHaveBeenCalled();
  });
});

/*
 * A spun thread's ORIGIN box (docs/plans/2026-11-15-origin-box-effects-design.md, sections 2, 4 and 6): the effect is in the box's area, which is inside
 * the opening post's body. The nearest marked area is the effect's: the smoke, the pointer and the press test are the area's, and what the engine lifts
 * over the ink is the area's own only where it is inside it.
 */
describe("in the ORIGIN box, inside the opening post's body", () => {
  const BOXAREA = { left: 10, top: 40, width: 600, height: 300 };
  beforeEach(() => { AREA = BOXAREA; OUTER = { left: 0, top: 0, width: 900, height: 700 }; });
  const inner = (s: Setup) => s.container.querySelector<HTMLElement>('.kb-origin-area')!;
  const outer = (s: Setup) => s.container.querySelector<HTMLElement>('.kb-act-main')!;
  const lifted = (s: Setup) => s.container.querySelector<HTMLElement>('.lifted')!;

  test('the smoke canvas is the area box, not the opening post body', () => {
    const s = setup({}, false, false, true);
    expect(canvas(s)!.style, 'the canvas is placed over the area').toMatchObject({ left: '10px', top: '40px', width: '600px', height: '300px' });
    expect(canvas(s)!.width).toBe(600);
    expect(canvas(s)!.height).toBe(300);
  });

  test('the pointer listeners are on the area and not on the outer body', () => {
    const adds: [Element, string][] = [];
    const realAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
      if (type.startsWith('pointer') && this instanceof Element && this.hasAttribute('data-kb-content-area')) adds.push([this, type]);
      return (realAdd as (...a: unknown[]) => void).call(this, type, ...rest);
    } as never;
    try {
      const s = setup({}, false, false, true);
      expect(adds.filter(([el]) => el === inner(s)).map(([, t]) => t).sort(), 'on the area').toEqual(['pointerdown', 'pointerleave', 'pointermove']);
      expect(adds.filter(([el]) => el === outer(s)), 'not on the outer body').toHaveLength(0);
    } finally { EventTarget.prototype.addEventListener = realAdd; }
  });

  test('a press on a lifted element inside the area opens no clearing, and a press on the byline (unlifted, in the area) opens one', () => {
    const s = setup({}, false, false, true);
    pointer(lifted(s), 'pointerdown', 100, 100, 'touch');
    pointer(lifted(s), 'pointermove', 100, 100);
    act(() => { runFrame(); });
    expect(circles(), 'History is its own').toHaveLength(0);
    pointer(host(s), 'pointermove', 300, 250);
    act(() => { runFrame(); });
    expect(circles(), 'the byline clears').toHaveLength(1);
  });

  test('with the effect on an outer body, a press inside a nested lifted box opens none', () => {
    /* The opening post's own Hot Box: its body holds the ORIGIN box, lifted whole. */
    const s = setup();
    const box = document.createElement('div');
    box.setAttribute('data-kb-over-ink', '');
    const words = document.createElement('p');
    box.appendChild(words);
    outer(s).appendChild(box);
    pointer(words, 'pointerdown', 100, 100, 'touch');
    pointer(words, 'pointermove', 100, 100);
    act(() => { runFrame(); });
    expect(circles(), 'the box is not this effect').toHaveLength(0);
  });
});
