/**
 * Hot Box's effect (docs/plans/2026-11-15-hot-box-plan.md, Task 4, reworked by docs/plans/2026-11-15-hot-box-fog-plan.md, Task 5; design
 * docs/plans/2026-11-15-hot-box-fog-design.md): smoke over a post that readers wave away. Read here, as a reader gets it: the fog's picture on each tile
 * (its alpha and color at a point of the content area), the words' `inert`, the in-body line, the live region, the views the Lens is given, and, under
 * forced colors, the words' mask, its rings and its sign. The page's clock is the backend's (`api.now()`), and here it is the faked `Date`, so the play's
 * end passes when the test says, and the fog's field steps by that clock once a frame.
 *
 * jsdom has no canvas, no frames and no resizing, so each is stubbed. The fog is worked out as bytes on a page-wide scratch canvas (`putImageData`) and
 * drawn from it onto a tile, scaled up a cell to a pixel (`drawImage`); each tile's recorder keeps its last draw with a copy of the bytes it was drawn
 * from, so `alphaAt` and `colorAt` answer in the box's px. The lines of a post are stubbed too (jsdom cannot measure a range), as three lines of an 800 by
 * 600 box, so a held sweep takes 2 seconds a line and 6 in all. The fog is driven toward the model with a 70 ms constant, so a test that looks at the
 * field lets about 400 ms of frames pass first (`settle`); under reduced motion and forced colors the picture is the model's at once.
 */
import { readFileSync } from 'node:fs';
import { act, cleanup } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps, KitControl } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { createFake } from '../../../../engine/ui/data/fake.ts';
import { makeTileLayer, mostTiles } from '../../../../engine/ui/cards/tiles.ts';
import { renderIn, testInstance } from '../../../../engine/ui/test-world.tsx';
import { SMOKE, fogAlpha, holeRadius, maskAlpha, strength } from './smoke.ts';
import { makeField, paintFog, stepField } from './fog.ts';
import { HotBoxEffect, SMOKED_WAY, WAVE_DESCRIBE, FOG_SHARE, forceFogLevel, nextWake, forgetScratch, resetFogLadder } from './Effect.tsx';

/* A post's lines, as shares of the box's height, as Whoops!'s `readLines` gives them; and what a painter's call costs, for the ladder. */
const { LINES, read, cost } = vi.hoisted(() => {
  const LINES = [
    { top: 0.1, bottom: 0.2, text: 'First line of the post.' },
    { top: 0.4, bottom: 0.5, text: 'Second line.' },
    { top: 0.7, bottom: 0.8, text: 'Third line.' },
  ];
  return { LINES, read: { lines: LINES as { top: number; bottom: number; text: string }[] }, cost: { ms: 0, perf: 0 } };
});
vi.mock('../../cards/whoops/lines.ts', () => ({ readLines: () => read.lines }));
/* The layer and the fog, each passed through and watched. */
vi.mock('../../../../engine/ui/cards/tiles.ts', async (orig) => {
  const real = await orig<typeof import('../../../../engine/ui/cards/tiles.ts')>();
  return { ...real, makeTileLayer: vi.fn(real.makeTileLayer) };
});
vi.mock('./fog.ts', async (orig) => {
  const real = await orig<typeof import('./fog.ts')>();
  return {
    ...real,
    stepField: vi.fn(real.stepField),
    makeField: vi.fn(real.makeField),
    paintFog: vi.fn((...a: Parameters<typeof real.paintFog>) => { cost.perf += cost.ms; return real.paintFog(...a); }),
  };
});

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const ENDS = NOW + 3 * DAY;
const iso = (t: number) => new Date(t).toISOString();
const BOX = { left: 0, top: 100, width: 800, height: 600 };
const HOST = { left: 0, top: 0, width: 800, height: 700 };
/** Time for a sweep: a line is the box's width at Whoops!'s pace, 400 px a second. */
const LINE_MS = 2000;
const SWEEP_MS = 3 * LINE_MS;
/** A moment's time: a day and a half into the play, so the smoke is neither full nor gone. */
const AT = NOW + 1.5 * DAY;
const moment = { at: AT } as const;

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-15T11:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'h1', card: 'hot-box', layer: 1, caster: 'c2', message: '', config: { color: 'teal' }, playedAt: iso(NOW), post: 'p1', ends: iso(ENDS), ...over });

/* ---------------------------------------------------------------------------------------------- the stubs ---- */

interface Fill { readonly style: unknown; readonly op: string; readonly rect: readonly number[] }
/** Bytes put on a canvas: its image's width and height and a copy of its RGBA. */
interface Put { readonly w: number; readonly h: number; readonly data: Uint8ClampedArray }
/** A scaled draw from a canvas: the bytes the source last held, the source rectangle, and where it landed in the box's px. */
interface Draw { readonly put: Put | null; readonly sw: number; readonly sh: number; readonly dx: number; readonly dy: number; readonly dw: number; readonly dh: number }
/** Each canvas's recorder: since it was last cleared, its flat fills, its draws and its arcs; the rows the layer clipped it to; the bytes last put on it; how many times it was cleared. */
interface Rec { fills: Fill[]; draws: Draw[]; arcs: { x: number; y: number; r: number }[]; clip: readonly number[] | null; put: Put | null; clears: number }
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

const recs = new WeakMap<HTMLCanvasElement, Rec>();
const ctxs = new WeakMap<HTMLCanvasElement, unknown>();

function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement) {
    contexts += 1;
    const known = ctxs.get(this);
    if (known) return known;
    const rec: Rec = { fills: [], draws: [], arcs: [], clip: null, put: null, clears: 0 };
    recs.set(this, rec);
    const ctx = {
      fillStyle: '' as unknown, globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
      setTransform: () => {}, save: () => {}, restore: () => {}, beginPath: () => {}, clip: () => {}, fill: () => {},
      rect: (...r: number[]) => { rec.clip = r; },
      arc: (x: number, y: number, r: number) => { rec.arcs.push({ x, y, r }); },
      clearRect: () => { rec.fills = []; rec.draws = []; rec.arcs = []; rec.clears += 1; },
      drawImage: (src: HTMLCanvasElement, ...a: number[]) => {
        if (a.length === 8) rec.draws.push({ put: recs.get(src)?.put ?? null, sw: a[2]!, sh: a[3]!, dx: a[4]!, dy: a[5]!, dw: a[6]!, dh: a[7]! });
      },
      fillRect: (...rect: number[]) => { rec.fills.push({ style: ctx.fillStyle, op: ctx.globalCompositeOperation, rect }); },
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { width: number; height: number; data: Uint8ClampedArray }) => { rec.put = { w: img.width, h: img.height, data: img.data.slice() }; },
    };
    ctxs.set(this, ctx);
    return ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
}

/** The IntersectionObserver the tests give a page: the area's (met) callback and the band stand-ins' callback, and the stand-ins it was asked to watch. */
let watch: ((entries: unknown[]) => void) | undefined;
let bandsWatch: ((entries: unknown[]) => void) | undefined;
let bandEls: Element[] = [];
let margins: unknown[] = [];
let watched: Element[] = [];
function stubObserver() {
  globalThis.IntersectionObserver = class {
    constructor(cb: (entries: unknown[]) => void, o?: { rootMargin?: string }) { margins.push(o); if (o?.rootMargin === '256px 0px') bandsWatch = cb; else watch = cb; }
    observe(el: Element) { if (el.classList.contains('kb-band')) bandEls.push(el); else watched.push(el); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
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
const runFrame = (t = 0) => { const due = [...frames.values()]; frames.clear(); for (const cb of due) cb(t); };
/** Lets `ms` pass in steps, a frame after each: timers fire in order, and the page renders between steps, as it does for a reader. */
function pass(ms: number, step = 100) {
  for (let left = ms; left > 0; left -= step) act(() => { vi.advanceTimersByTime(Math.min(step, left)); runFrame(); });
}
/** Time for the fog's field to reach the model, in frames 16 ms apart. */
const settle = (ms = 400) => pass(ms, 16);

/* ---------------------------------------------------------------------------------------------- the props ---- */

/**
 * `bare` is a post with no content area (the ORIGIN box), `nested` the area of an ORIGIN box inside the opening post's body, and `inPost` the thread's
 * post around the area (`article.kb-act`, holding the Hot Box mark as engine/ui/cards/Marks.tsx writes it) with a button outside the post beside it.
 */
/** Opens or shuts a curtain over the post set up last (the effect's `covered`), the way the engine does when a cover goes. */
let cover: (covered: boolean) => void = () => {};
function Covering({ props }: { props: EffectProps }) {
  const [covered, setCovered] = useState(props.covered);
  cover = setCovered;
  return <HotBoxEffect {...props} covered={covered} />;
}
function setup(over: Partial<EffectProps> = {}, strict = false, bare = false, nested = false, inPost = false) {
  const show = vi.fn<(view: CardView | null) => void>();
  const met = vi.fn();
  const save = vi.fn(async () => ({ ok: false as const, error: 'no' }));
  const release = vi.fn(async () => ({ ok: false as const, error: 'no' }));
  const props: EffectProps = {
    covered: false,
    post, plays: [play()], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false, moment: null,
    show, met, ink: NO_INK, holdScreen: () => {}, marks: null, save, release, nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p>The words of the post. <a href="https://example.com/">A link</a></p>, ...over,
  };
  const world = createFake({ instance: testInstance, now: () => Date.now() });
  const effect = <Covering props={props} />;
  /* In the thread the effect sits inside the post's content area; `bare` is a post with none (the ORIGIN box), where the area is the effect's own element. */
  const inArea = bare ? effect : nested
    ? <div className="kb-act-main" data-kb-content-area><div className="kb-origin" data-kb-over-ink=""><div className="kb-origin-area" data-kb-content-area><p data-kb-over-ink="" className="lifted">History</p>{effect}</div></div></div>
    : <div className="kb-act-main" data-kb-content-area>{effect}</div>;
  const page = inPost
    ? <div><article className="kb-act"><header><button type="button" className="kb-mark kb-meta-tile" data-kb-card="hot-box">Hot Box</button></header>{inArea}</article><button type="button" className="outside">Elsewhere</button></div>
    : inArea;
  const out = renderIn(world, strict ? <StrictMode>{page}</StrictMode> : page);
  return { show, met, save, release, props, ...out };
}
type Setup = ReturnType<typeof setup>;

const host = (s: Setup) => s.container.querySelector<HTMLElement>('.dw-hotbox')!;
const area = (s: Setup) => s.container.querySelector<HTMLElement>('.kb-act-main')!;
const words = (s: Setup) => s.container.querySelector<HTMLElement>('.dw-hotbox-words')!;
const way = (s: Setup) => s.container.querySelector<HTMLElement>('p.dw-hotbox-way');
/** The first tile's canvas, and every tile's. */
const canvas = (s: Setup) => s.container.querySelector<HTMLCanvasElement>('canvas.dw-hotbox-smoke');
const tiles = (s: Setup) => [...s.container.querySelectorAll<HTMLCanvasElement>('canvas.dw-hotbox-smoke')];
const recOf = (c: HTMLCanvasElement | null | undefined): Rec | undefined => (c ? recs.get(c) : undefined);
/** Frames asked for so far: "none" is none beyond what the mount asked. */
const asked = () => vi.mocked(window.requestAnimationFrame).mock.calls.length;
const readout = (s: Setup) => s.container.querySelector('[aria-live="polite"]')!.textContent;
const sign = (s: Setup) => s.container.querySelector('.dw-hotbox-sign');
const rings = (s: Setup) => [...s.container.querySelectorAll<HTMLElement>('.dw-hotbox-ring')];
const inert = (s: Setup) => words(s).hasAttribute('inert');
const views = (s: Setup): CardView[] => s.show.mock.calls.flatMap((c) => (c[0] ? [c[0]] : []));
const last = (s: Setup): CardView => views(s).at(-1)!;
const wave = (s: Setup): Extract<KitControl, { kind: 'hold' }> => last(s).controls[0] as Extract<KitControl, { kind: 'hold' }>;
/** The Lens's hold control, as the Lens drives it. */
const press = (s: Setup) => act(() => { wave(s).start(); });
const release = (s: Setup) => act(() => { wave(s).stop(); });

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

/* ---- what a tile was last drawn as, in the box's px ---- */

/** The RGBA of the fog's picture at (x, y) of the box, as the last draw on `rec` placed it (a cell is one pixel of the image), or null where it drew none. */
function pixelIn(rec: Rec | undefined, x: number, y: number): [number, number, number, number] | null {
  const d = rec?.draws.at(-1);
  if (!d?.put) return null;
  const col = Math.floor(((x - d.dx) / d.dw) * d.sw), row = Math.floor(((y - d.dy) / d.dh) * d.sh);
  if (col < 0 || row < 0 || col >= d.sw || row >= d.sh) return null;
  const i = (row * d.put.w + col) * 4;
  return [d.put.data[i]!, d.put.data[i + 1]!, d.put.data[i + 2]!, d.put.data[i + 3]!];
}
/** The tile whose rows hold `y` (the layer clips each to its own rows). */
const tileAt = (s: Setup, y: number) => tiles(s).map((c) => recs.get(c)).find((r) => r?.clip && y >= r.clip[1]! && y < r.clip[1]! + r.clip[3]!);
const colorAt = (s: Setup, x: number, y: number) => pixelIn(tileAt(s, y), x, y);
/** The fog's alpha (0 to 255) at a point of the box, or null where no fog is drawn. */
const alphaAt = (s: Setup, x: number, y: number) => colorAt(s, x, y)?.[3] ?? null;
/** The alpha of whole fog now: the model's `fogAlpha`, as a byte. */
const whole = (at = Date.now()) => Math.round(fogAlpha(strength(at, NOW, ENDS)) * 255);
/** Whether a tile drew any fog since it was last cleared. */
const drawn = (rec: Rec | undefined) => (rec?.draws.length ?? 0) > 0 || (rec?.fills.length ?? 0) > 0;
const picture = (s: Setup) => drawn(recOf(canvas(s)));
/** Every alpha of a tile's last picture, as a set. */
function alphas(rec: Rec | undefined): Set<number> {
  const out = new Set<number>();
  const put = rec?.draws.at(-1)?.put;
  if (put) for (let i = 3; i < put.data.length; i += 4) out.add(put.data[i]!);
  return out;
}
/** The mean alpha across the box's width at row `y`. */
function rowMean(s: Setup, y: number, w = AREA.width): number {
  let sum = 0, n = 0;
  for (let x = 2; x < w; x += 5) { sum += alphaAt(s, x, y) ?? 0; n++; }
  return sum / n;
}
/** The mean color of a tile's last picture, over the pixels with any fog. */
function meanColor(rec: Rec | undefined): [number, number, number] {
  const put = rec?.draws.at(-1)?.put;
  let r = 0, g = 0, b = 0, n = 0;
  if (put) for (let i = 0; i < put.data.length; i += 4) if (put.data[i + 3]! > 0) { r += put.data[i]!; g += put.data[i + 1]!; b += put.data[i + 2]!; n++; }
  return n === 0 ? [Number.NaN, Number.NaN, Number.NaN] : [r / n, g / n, b / n];
}
const near = (a: readonly number[], b: readonly number[], by: number) => a.every((v, i) => Math.abs(v - b[i]!) <= by);
const rgbVar = (s: Setup) => host(s).style.getPropertyValue('--dw-hotbox-rgb');

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
/** Where the mask's circles are, each place once (a clearing and the trail point it stands on are one hole). */
const holes = (s: Setup) => [...new Set(circleLayers(s).map((l) => `${l.x},${l.y}`))];
const rectLayers = (s: Setup) => layers(s).filter((l) => l.kind === 'rect');
const flat = (s: Setup) => layers(s).find((l) => l.kind === 'flat');

beforeEach(() => {
  observed = []; read.lines = LINES; contexts = 0; frames = new Map(); frameId = 0; forced = false; forcedListeners = []; sizeWatchers = []; sizes = BOX; AREA = BOX; OUTER = null;
  watch = undefined; bandsWatch = undefined; bandEls = []; margins = []; watched = [];
  cost.ms = 0; cost.perf = 0;
  /* The painter's cost is read from `performance.now`; here it moves only when a test moves it (`cost.perf`, which a call of the fog adds `cost.ms` to), never with how loaded the run is. */
  vi.spyOn(performance, 'now').mockImplementation(() => cost.perf);
  vi.mocked(makeTileLayer).mockClear();
  vi.mocked(stepField).mockClear();
  vi.mocked(paintFog).mockClear();
  vi.mocked(makeField).mockClear();
  forgetScratch();
  resetFogLadder();
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  stubCanvas();
  stubWindow();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
});

/* ================================================================================================ the tests ==== */

describe('which play', () => {
  test('a live play draws the tiles and inert words', () => {
    const s = setup();
    expect(canvas(s)).not.toBeNull();
    expect(canvas(s)).toHaveAttribute('aria-hidden', 'true');
    expect(canvas(s)).toHaveAttribute('data-kb-effect-ink');
    expect(inert(s)).toBe(true);
    expect(words(s)).toHaveTextContent('The words of the post.');
    expect(picture(s)).toBe(true);
  });

  test('no button is rendered inside the effect at all: the control is the Lens\'s', () => {
    const s = setup();
    expect(host(s).querySelector('button')).toBeNull();
    press(s);
    pass(SWEEP_MS);
    expect(host(s).querySelector('button')).toBeNull();
    expect(last(s).controls).toHaveLength(1);
  });

  test('the control\'s description is the plan\'s, and the hidden live region is polite', () => {
    const s = setup();
    expect(WAVE_DESCRIBE).toContain(`for ${SMOKE.waved / 1000} seconds.`);
    expect(wave(s).describe).toBe('Hold Space or Enter on this button to wave the smoke off line by line, at the pace of a hand. Let go and it rolls back in. Hold to the end and the post stays clear for 20 seconds.');
    expect(s.container.querySelector('[aria-live="polite"]')).toHaveClass('kb-visually-hidden');
  });

  test('an ended play draws the words alone and shows nothing', () => {
    const s = setup({ plays: [play({ ends: iso(NOW - 1000) })] });
    expect(canvas(s)).toBeNull();
    expect(s.container.querySelector('[inert]')).toBeNull();
    expect(s.container.querySelector('.dw-hotbox')).toBeNull();
    expect(way(s)).toBeNull();
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
    expect(way(s)).toBeNull();
    expect(s.container.querySelector('[inert]')).toBeNull();
    expect(s.show).toHaveBeenLastCalledWith(null);
  });

  test('a second Hot Box cast after the first ended draws the new play and not the old', () => {
    const s = setup({ plays: [play({ id: 'old', ends: iso(NOW - 1000), config: { color: 'red' } }), play({ id: 'new', config: { color: 'blue' } })] });
    expect(rgbVar(s)).toBe('0 0 255');
    const [r, g, b] = meanColor(recOf(canvas(s)));
    expect(b).toBeGreaterThan(r + 60);
    expect(b).toBeGreaterThan(g + 60);
  });
});

describe('the color of the smoke', () => {
  test.each([
    ['#rrggbb', '#32cd32', [50, 205, 50]],
    ['#rgb', '#fa0', [255, 170, 0]],
    ['a named color', 'teal', [0, 128, 128]],
    ['a named color in capitals', ' Teal ', [0, 128, 128]],
  ])('paints %s (%s) as that color: shaded, its mean near it', (_what, color, rgb) => {
    const s = setup({ plays: [play({ config: { color } })] });
    expect(rgbVar(s)).toBe(rgb.join(' '));
    expect(near(meanColor(recOf(canvas(s))), rgb, 40)).toBe(true);
    s.unmount();
  });

  test.each([['nope'], [''], [42], [undefined]])('only a color that cannot be read (%j) draws light gray', (color) => {
    const s = setup({ plays: [play({ config: { color } })] });
    expect(rgbVar(s)).toBe('211 211 211');
    expect(near(meanColor(recOf(canvas(s))), [211, 211, 211], 40)).toBe(true);
    s.unmount();
  });

  test('the fog is shaded: its picture takes many values of a channel, not one flat fill', () => {
    const s = setup();
    const put = recOf(canvas(s))!.draws.at(-1)!.put!;
    const greens = new Set<number>();
    for (let i = 0; i < put.data.length; i += 4) greens.add(put.data[i + 1]!);
    expect(greens.size).toBeGreaterThan(20);
  });
});

describe('the fog', () => {
  test.each([
    ['at landing', 0],
    ['half way', 1.5 * DAY],
    ['near the end', 3 * DAY - 60_000],
  ])('every pixel\'s alpha %s is fogAlpha\'s', (_when, after) => {
    vi.setSystemTime(NOW + after);
    const s = setup();
    expect(alphas(recOf(canvas(s)))).toEqual(new Set([whole(NOW + after)]));
    s.unmount();
  });

  test('is full as the play lands, and thins as the days pass', () => {
    const s = setup();
    expect(alphaAt(s, 400, 300)).toBe(Math.round(SMOKE.full * 255));
    act(() => { vi.setSystemTime(NOW + 2.5 * DAY); });
    pass(100, 50);
    expect(alphaAt(s, 400, 300)).toBe(whole());
    expect(alphaAt(s, 400, 300)).toBeLessThan(Math.round(SMOKE.full * 255));
  });

  test('covers the whole box: each tile\'s picture is drawn over all of its rows, border to border', () => {
    const s = setup();
    for (const c of tiles(s)) {
      const rec = recOf(c)!, d = rec.draws.at(-1)!, [, top, w, h] = rec.clip!;
      expect(d.dx).toBeLessThanOrEqual(0);
      expect(d.dx + d.dw).toBeGreaterThanOrEqual(w!);
      expect(d.dy).toBeLessThanOrEqual(top!);
      expect(d.dy + d.dh).toBeGreaterThanOrEqual(top! + h!);
    }
  });

  test('each tile is drawn at a density of 1 whatever the screen\'s: the fog is a cell to a pixel, scaled up smooth', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    try {
      const s = setup();
      expect(canvas(s)!.width).toBe(BOX.width);
      expect(canvas(s)!.height).toBe(512);
      expect(vi.mocked(makeTileLayer).mock.calls[0]![1].density).toBe(1);
      expect(ctxs.get(canvas(s)!)).toMatchObject({ imageSmoothingEnabled: true });
    } finally {
      delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
    }
  });

  test('is drawn again, resized, when the content area\'s box changes', () => {
    const s = setup();
    AREA = { ...BOX, width: 400, height: 300 };
    act(() => { for (const cb of sizeWatchers) cb(); });
    act(() => { runFrame(); });
    expect(canvas(s)!.width).toBe(400);
    expect(canvas(s)!.height).toBe(300);
    expect(canvas(s)!.style.width).toBe('400px');
    expect(canvas(s)!.style.height).toBe('300px');
    expect(alphaAt(s, 390, 290)).toBe(whole());
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

  test('the painter is given to the tiled layer once, asks for density 1, and with no pointer the field is never stepped into work, while the rest repaints at most 21 times a second', () => {
    const s = setup();
    expect(makeTileLayer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(makeTileLayer).mock.calls[0]![1]).toMatchObject({ density: 1, className: 'dw-hotbox-smoke', standIn: 'dw-hotbox-far' });
    pass(3000, 10);
    expect(makeTileLayer).toHaveBeenCalledTimes(1);
    /* A field at rest is not stepped at all: nothing is open and nothing is disturbed, so the call is not made. */
    expect(stepField).toHaveBeenCalledTimes(0);
    const rec = recOf(canvas(s))!;
    const before = rec.clears;
    pass(1000, 10);
    expect(rec.clears - before).toBeGreaterThan(10);
    expect(rec.clears - before).toBeLessThanOrEqual(21);
    expect(stepField).toHaveBeenCalledTimes(0);
  });

  test('only a post in view joins the page rest timer: out of view nothing marks it stale and no timer of the chain is pending; in view it repaints at most 21 times a second; out again it stops', () => {
    stubObserver();
    const s = setup();
    const rec = recOf(canvas(s))!;
    /* The mount's own render marks the tiles stale once; what follows is the rest chain's alone. */
    pass(100, 10);
    const out = vi.getTimerCount();
    const before = rec.clears;
    pass(2000, 10);
    expect(rec.clears).toBe(before);
    expect(vi.getTimerCount()).toBe(out);
    act(() => { watch!([{ target: area(s), isIntersecting: true, intersectionRatio: 1 }]); });
    expect(vi.getTimerCount()).toBe(out + 1);
    const inAt = rec.clears;
    pass(1000, 10);
    expect(rec.clears - inAt).toBeGreaterThan(10);
    expect(rec.clears - inAt).toBeLessThanOrEqual(21);
    act(() => { watch!([{ target: area(s), isIntersecting: false, intersectionRatio: 0 }]); });
    expect(vi.getTimerCount()).toBe(out);
    pass(100, 10);
    const outAt = rec.clears;
    pass(1000, 10);
    expect(rec.clears).toBe(outAt);
  });

  describe('a post of several held tiles at rest', () => {
    const inView = (s: Setup, on: boolean) => act(() => { watch!([{ target: area(s), isIntersecting: on, intersectionRatio: on ? 1 : 0 }]); });
    /* A tall window, so the layer holds at least three tiles. */
    const innerHeight = window.innerHeight;
    beforeEach(() => { window.innerHeight = 1400; });
    afterEach(() => { window.innerHeight = innerHeight; });
    const bigPost = () => {
      stubObserver();
      AREA = { ...BOX, height: 20_000 };
      const s = setup();
      inView(s, true);
      pass(300, 16);
      return s;
    };

    test('the rest repaints are spread: no frame paints more than one tile, and each held tile is painted 12 to 21 times in a second', () => {
      const s = bigPost();
      const recs_ = tiles(s).map((c) => recOf(c)!);
      expect(recs_.length).toBeGreaterThanOrEqual(3);
      const start = recs_.map((r) => r.clears);
      let most = 0;
      for (let i = 0; i < 62; i++) {
        const before = recs_.map((r) => r.clears);
        act(() => { vi.advanceTimersByTime(16); runFrame(); });
        most = Math.max(most, recs_.reduce((n, r, k) => n + r.clears - before[k]!, 0));
      }
      expect(most, 'tiles painted in the busiest frame').toBeLessThanOrEqual(1);
      recs_.forEach((r, k) => {
        expect(r.clears - start[k]!, `tile ${k}`).toBeGreaterThanOrEqual(12);
        expect(r.clears - start[k]!, `tile ${k}`).toBeLessThanOrEqual(21);
      });
    });

    test('leaving the view, or unmounting, leaves no timer of the stagger pending', () => {
      stubObserver();
      AREA = { ...BOX, height: 20_000 };
      const s = setup();
      pass(300, 16);
      const out = vi.getTimerCount();
      inView(s, true);
      /* Stop in the middle of a tick's run: the rest timer and the stagger's own timer are pending. */
      act(() => { vi.advanceTimersByTime(60); });
      expect(vi.getTimerCount(), 'the stagger is running').toBe(out + 2);
      inView(s, false);
      expect(vi.getTimerCount(), 'out of view').toBe(out);
      inView(s, true);
      act(() => { vi.advanceTimersByTime(60); });
      s.unmount();
      expect(vi.getTimerCount(), 'unmounted').toBe(0);
    });
  });

  test('fog at rest drifts: its picture moves from one rest frame to the next, its alpha never does', () => {
    const s = setup();
    pass(100, 50);
    const one = recOf(canvas(s))!.draws.at(-1)!.put!.data.slice();
    pass(2000, 50);
    const two = recOf(canvas(s))!.draws.at(-1)!.put!.data;
    expect(Buffer.from(two).equals(Buffer.from(one))).toBe(false);
    expect(alphas(recOf(canvas(s)))).toEqual(new Set([whole()]));
  });
});

describe('the pointer', () => {
  test('a mouse move clears the fog at the pointer, not far off, and it closes after the pointer leaves', () => {
    const s = setup();
    move(s, 300, 250);
    settle();
    expect(alphaAt(s, 300, 150)).toBe(0);
    expect(alphaAt(s, 700, 500)).toBe(whole());
    /* The clearing goes with the pointer. */
    move(s, 340, 270);
    settle();
    expect(alphaAt(s, 340, 170)).toBe(0);
    pass(2000, 50);
    expect(alphaAt(s, 340, 170)).toBe(0);
    leave(s);
    pass(SMOKE.roll / 2, 50);
    expect(alphaAt(s, 340, 170)).toBeGreaterThan(0);
    pass(SMOKE.roll / 2 + 3 * SMOKE.wake, 50);
    expect(alphas(tileAt(s, 170))).toEqual(new Set([whole()]));
  });

  test('a still pointer\'s clearing has the card\'s soft edge: clear at the core, thinned toward the rim, whole fog beyond it', () => {
    const s = setup();
    const r = holeRadius(BOX.width);
    move(s, 300, 250);
    settle();
    expect(alphaAt(s, 300, 150)).toBe(0);
    const rim = alphaAt(s, 300 + 0.9 * r, 150)!;
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(whole());
    expect(alphaAt(s, 300 + 1.2 * r, 150)).toBe(whole());
  });

  test('a pointer moved across the words leaves a trail: clear where it left 300 ms ago, and whole again after the wake', () => {
    const s = setup();
    for (let x = 100; x <= 700; x += 40) { move(s, x, 250); pass(16, 16); }
    /* x = 300 was passed at the sixth move; 300 ms from then. The trail holds that point 0.8 open, so the model lets the fog there be at most 0.2, which
       the fog's wispy edge draws as nothing: the field's own wake, without the trail, is still thicker than that. */
    pass(300 - 10 * 16, 16);
    expect(alphaAt(s, 300, 150)).toBe(0);
    pass(3 * SMOKE.wake, 16);
    expect(alphaAt(s, 300, 150)).toBe(whole());
  });

  test('a tile with something happening under it is painted again in the next frame, whichever tile of the post it is', () => {
    AREA = { ...BOX, height: 1200 };
    const s = setup();
    const second = recOf(tiles(s)[1])!;
    move(s, 300, 100 + 700);
    act(() => { vi.advanceTimersByTime(50); });
    for (let i = 0; i < 5; i++) {
      const before = second.clears;
      act(() => { runFrame(); });
      expect(second.clears, `frame ${i}`).toBe(before + 1);
    }
  });

  test('a mouse parked on the words is painted every frame while the clearing opens, and at the rest pace once it has settled, still clear', () => {
    const s = setup();
    const rec = recOf(canvas(s))!;
    move(s, 300, 250);
    act(() => { vi.advanceTimersByTime(16); });
    for (let i = 0; i < 4; i++) {
      const before = rec.clears;
      act(() => { vi.advanceTimersByTime(16); runFrame(); });
      expect(rec.clears, `frame ${i}`).toBe(before + 1);
    }
    pass(2000, 16);
    expect(alphaAt(s, 300, 150)).toBe(0);
    const before = rec.clears;
    pass(1000, 16);
    expect(rec.clears - before).toBeLessThanOrEqual(21);
    expect(alphaAt(s, 300, 150)).toBe(0);
  });

  test('a touch clears where it lands, holds touchHold, then closes over roll; a second touch replaces the first', () => {
    const s = setup();
    touch(s, 200, 300);
    settle();
    expect(alphaAt(s, 200, 200)).toBe(0);
    pass(SMOKE.touchHold - 500, 50);
    expect(alphaAt(s, 200, 200)).toBe(0);
    touch(s, 500, 400);
    settle();
    expect(alphaAt(s, 500, 300)).toBe(0);
    pass(SMOKE.touchHold - 400, 50);
    expect(alphaAt(s, 500, 300)).toBe(0);
    /* The first touch's place was let go when the second landed: its fog is back, from its rim in, within the wake. */
    expect(alphaAt(s, 200, 200)).toBe(whole());
    pass(SMOKE.roll / 2 + 100, 50);
    expect(alphaAt(s, 500, 300)).toBeGreaterThan(0);
    pass(SMOKE.roll + 2 * SMOKE.wake, 50);
    expect(alphas(recOf(canvas(s)))).toEqual(new Set([whole()]));
  });

  test('a moving finger moves its clearing and leaves a trail, and nothing is prevented', () => {
    const s = setup();
    const prevented = [touch(s, 200, 300), pointer(host(s), 'pointermove', 260, 420, 'touch')];
    pass(32, 16);
    prevented.push(pointer(host(s), 'pointermove', 420, 420, 'touch'));
    settle(300);
    expect(prevented).toEqual([false, false, false]);
    /* The clearing is where the finger is now; where it was is the trail, 300 ms on. */
    expect(alphaAt(s, 420, 320)).toBe(0);
    expect(alphaAt(s, 260, 320)).toBe(0);
    pass(3 * SMOKE.wake, 50);
    expect(alphaAt(s, 260, 320)).toBe(whole());
    expect(alphaAt(s, 420, 320)).toBe(0);
  });

  test('a pen is read as a mouse: it moves a clearing, opens one where it lands, and closes it on leave', () => {
    const s = setup();
    pointer(host(s), 'pointermove', 300, 250, 'pen');
    settle();
    expect(alphaAt(s, 300, 150)).toBe(0);
    pointer(area(s), 'pointerleave', 0, 0, 'pen');
    pass(SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphaAt(s, 300, 150)).toBe(whole());
    pointer(host(s), 'pointerdown', 120, 220, 'pen');
    settle();
    expect(alphaAt(s, 120, 120)).toBe(0);
    pointer(area(s), 'pointerleave', 0, 0, 'pen');
    pass(SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphaAt(s, 120, 120)).toBe(whole());
  });

  test('pointing at what the engine lifts over the ink closes the mouse clearing: what is beside it is not read for free', () => {
    const s = setup();
    const lifted = document.createElement('div');
    lifted.setAttribute('data-kb-over-ink', '');
    area(s).appendChild(lifted);
    move(s);
    settle();
    expect(alphaAt(s, 300, 150)).toBe(0);
    pointer(lifted, 'pointermove', 300, 250);
    pass(SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphaAt(s, 300, 150)).toBe(whole());
  });

  test('no handler calls preventDefault', () => {
    const s = setup();
    const prevented = [move(s), touch(s), leave(s), pointer(host(s), 'pointerdown', 5, 5), pointer(host(s), 'pointercancel', 5, 5, 'touch'), pointer(host(s), 'pointermove', 50, 50, 'touch')];
    for (const key of [' ', 'Enter']) {
      for (const type of ['keydown', 'keyup']) {
        const e = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
        act(() => { words(s).dispatchEvent(e); });
        prevented.push(e.defaultPrevented);
      }
    }
    expect(prevented.every((p) => p === false)).toBe(true);
  });
});

describe('what the field is given', () => {
  /** The last input `stepField` was called with, and the clearing in it nearest (x, y). */
  const lastInput = () => vi.mocked(stepField).mock.calls.at(-1)![2];
  const clearingAt = (x: number, y: number) => lastInput().clearings.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b));

  test('a mouse moved right gives its clearing a velocity along x, about the speed it moved at; still for 100 ms, none', () => {
    const s = setup();
    move(s, 200, 250);
    act(() => { vi.advanceTimersByTime(16); });
    move(s, 240, 250);
    act(() => { vi.advanceTimersByTime(16); });
    move(s, 280, 250);
    act(() => { runFrame(); });
    const c = clearingAt(280, 150);
    /* 80 px in 32 ms. */
    expect(c.vx!).toBeGreaterThan(2000);
    expect(c.vx!).toBeLessThan(3000);
    expect(Math.abs(c.vy ?? 0)).toBeLessThan(50);
    pass(100, 50);
    const rest = clearingAt(280, 150);
    expect(rest.vx ?? 0).toBe(0);
    expect(rest.vy ?? 0).toBe(0);
  });

  test('a touch bursts within 260 ms of landing and not after', () => {
    const s = setup();
    touch(s, 200, 300);
    act(() => { vi.advanceTimersByTime(100); runFrame(); });
    expect(clearingAt(200, 200).burst).toBe(true);
    pass(300, 50);
    expect(clearingAt(200, 200).burst).toBe(false);
  });

  test.each([
    [0, 5, 8],
    [1, 7, 8],
    [2, 10, 8],
    [3, 10, 4],
  ])('at rung %i the field is made with cells of %i px and a pointer step is given %i rounds', (level, cell, rounds) => {
    forceFogLevel(level);
    const s = setup();
    move(s, 300, 250);
    settle(100);
    expect(vi.mocked(makeField).mock.calls.at(-1)![2]).toBe(cell);
    expect(vi.mocked(stepField).mock.calls.at(-1)![2].rounds).toBe(rounds);
  });

  test('at rung 4 the field is not stepped and the fog is drawn from the model, open at the pointer', () => {
    forceFogLevel(4);
    const s = setup();
    move(s, 300, 250);
    settle(400);
    expect(stepField).toHaveBeenCalledTimes(0);
    const o = vi.mocked(paintFog).mock.calls.at(-1)![4];
    expect(o.direct).toBeDefined();
    expect(o.direct!.target(300, 150)).toBe(0);
    expect(o.direct!.target(700, 500)).toBeGreaterThan(0);
  });

  test('with full motion a swipe of 1.5 seconds sets the model timer fewer than 10 times: the trail is drawn by the frames, not woken for', () => {
    stubObserver();
    const s = setup();
    const set = vi.spyOn(globalThis, 'setTimeout');
    for (let i = 0; i < 94; i++) {
      move(s, 100 + i * 6, 250);
      pass(16, 16);
      /* Anything that renders the effect sets the model timer again, with the trail it has by then. */
      if (i === 10) act(() => { watch!([{ target: area(s), isIntersecting: true, intersectionRatio: 1 }]); });
    }
    /* The page's rest timer is 50 ms and its stagger's a frame (16 ms), neither the model's; anything else is the model's. */
    const model = set.mock.calls.filter((c) => c[1] !== 50 && c[1] !== 16);
    expect(model.length).toBeLessThan(10);
    expect(s.container).toBeTruthy();
  });
});

describe('the held sweep', () => {
  test('holding the Lens control starts the sweep: the Lens says it is waving, and lines reach the live region in order', () => {
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

  test('a start while a hold runs neither restarts the sweep nor stops it, and stop ends it', () => {
    const s = setup();
    press(s);
    pass(LINE_MS);
    expect(readout(s)).toBe('First line of the post.');
    press(s);
    pass(LINE_MS);
    expect(readout(s)).toBe('Second line.');
    release(s);
    expect(last(s).state).toBe('Smoke over the words');
  });

  test('a finished line stays clear while the hold lasts, across the box, and the clearing travels along the line', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2, 16);
    expect(alphaAt(s, BOX.width / 2, 0.15 * BOX.height)).toBe(0);
    expect(alphaAt(s, 400, 500)).toBe(whole());
    pass(LINE_MS / 2, 16);
    expect(alphaAt(s, 5, 90)).toBe(0);
    expect(alphaAt(s, 795, 90)).toBe(0);
    expect(rowMean(s, 90)).toBe(0);
    pass(LINE_MS, 50);
    expect(rowMean(s, 90)).toBe(0);
    expect(rowMean(s, 270)).toBe(0);
    expect(alphaAt(s, 400, 500)).toBe(whole());
  });

  test('letting go early restores the fog over roll and leaves the words inert', () => {
    const s = setup();
    press(s);
    pass(LINE_MS + 500, 50);
    expect(rowMean(s, 90)).toBe(0);
    release(s);
    expect(last(s).state).toBe('Smoke over the words');
    pass(SMOKE.roll / 2, 50);
    expect(rowMean(s, 90)).toBeGreaterThan(0);
    expect(rowMean(s, 90)).toBeLessThan(whole());
    pass(SMOKE.roll / 2 + 3 * SMOKE.wake, 50);
    for (const c of tiles(s)) expect(alphas(recOf(c))).toEqual(new Set([whole()]));
    expect(inert(s)).toBe(true);
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
    expect(picture(s)).toBe(false);
    release(s);
    pass(SMOKE.waved - 200);
    expect(inert(s)).toBe(false);
    expect(picture(s)).toBe(false);
    pass(200);
    expect(inert(s)).toBe(true);
    expect(last(s).state).toBe('Smoke over the words');
    pass(SMOKE.roll / 2, 50);
    expect(Math.max(...alphas(recOf(canvas(s))))).toBeLessThan(whole());
    pass(SMOKE.roll, 50);
    expect(alphas(recOf(canvas(s)))).toEqual(new Set([whole()]));
  });

  test('a link in the words can be focused after a finished sweep, not before', () => {
    const s = setup();
    const link = s.container.querySelector('a')!;
    expect(link.closest('[inert]')).not.toBeNull();
    press(s);
    pass(SWEEP_MS);
    expect(link.closest('[inert]')).toBeNull();
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

  test('focus on a link in the words moves to the post\'s Hot Box mark when the waved window ends, not before', () => {
    const s = setup({}, false, false, false, true);
    const link = s.container.querySelector('a')!;
    const mark = s.container.querySelector<HTMLElement>('button.kb-mark[data-kb-card="hot-box"]')!;
    press(s);
    pass(SWEEP_MS);
    release(s);
    act(() => { link.focus(); });
    expect(document.activeElement).toBe(link);
    pass(SMOKE.waved - 200);
    expect(document.activeElement).toBe(link);
    pass(300);
    expect(inert(s)).toBe(true);
    expect(document.activeElement).toBe(mark);
  });

  test('focus on a button outside the post is not moved when the waved window ends', () => {
    const s = setup({}, false, false, false, true);
    const outside = s.container.querySelector<HTMLElement>('button.outside')!;
    press(s);
    pass(SWEEP_MS);
    release(s);
    act(() => { outside.focus(); });
    pass(SMOKE.waved + SMOKE.roll);
    expect(inert(s)).toBe(true);
    expect(document.activeElement).toBe(outside);
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

  test('no frame and no rest timer runs while the post is waved, and frames resume when the smoke rolls back', () => {
    const s = setup();
    press(s);
    pass(SWEEP_MS);
    release(s);
    expect(inert(s)).toBe(false);
    act(() => { runFrame(); });
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

  test('a StrictMode mount and unmount leaves no timer and no frame pending', () => {
    const s = setup({}, true);
    move(s);
    pass(500, 50);
    s.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(frames.size).toBe(0);
  });

  test('the Lens\'s hold control drives the sweep: start and stop, and stop before a start does nothing', () => {
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

describe('the in-body line', () => {
  test('stands where the words are while they are smoked, hidden from sight and outside the inert words; gone in the waved window, and back after', () => {
    const s = setup();
    expect(way(s)).toHaveTextContent(SMOKED_WAY);
    expect(SMOKED_WAY).toBe('This post is under smoke. To read it, open Hot Box in the cards on this post and hold Wave the smoke.');
    expect(way(s)).toHaveClass('kb-visually-hidden');
    expect(way(s)!.closest('[inert]')).toBeNull();
    expect(words(s).contains(way(s))).toBe(false);
    expect(way(s)!.parentElement).toBe(host(s));
    press(s);
    pass(SWEEP_MS);
    expect(inert(s)).toBe(false);
    expect(way(s)).toBeNull();
    release(s);
    pass(SMOKE.waved);
    expect(inert(s)).toBe(true);
    expect(way(s)).toHaveTextContent(SMOKED_WAY);
  });

  test('is drawn in a moment as it is live', () => {
    const s = setup({ moment });
    expect(way(s)).toHaveTextContent(SMOKED_WAY);
  });
});

describe('the ladder', () => {
  const see = (s: Setup, isIntersecting: boolean) => act(() => { watch!([{ target: area(s), isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); });
  const level = (s: Setup) => Number(host(s).getAttribute('data-dw-fog-level'));

  test('a painter over budget steps the post down, 0 to 4, never back while in view; out of view and back it is at 0', () => {
    stubObserver();
    const s = setup();
    see(s, true);
    expect(level(s)).toBe(0);
    cost.ms = 40;
    const seen: number[] = [];
    for (let i = 0; i < 200; i++) { pass(50, 50); seen.push(level(s)); cost.perf += 1; }
    expect(seen.at(-1)).toBe(4);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    /* Over the budget at every rung, it ends on the last: it may skip rungs on the way (the next test), never go back. */
    expect(seen).toContain(0);
    /* A fast painter gives no rung back while the post is in view. */
    cost.ms = 0;
    pass(3000, 50);
    expect(level(s)).toBe(4);
    see(s, false);
    expect(level(s)).toBe(0);
    see(s, true);
    expect(level(s)).toBe(0);
  });

  /**
   * A painter that costs `ms` a frame at rung 0 and `FOG_SHARE[level]` of that at the post's rung, over `frames` frames. Returns the rung after each frame.
   * A frame paints every tile the layer holds, so a call of the fog costs its share of the frame's.
   */
  function drive(s: Setup, ms: number, frames: number): number[] {
    vi.mocked(paintFog).mockClear();
    pass(50, 50);
    const per = Math.max(1, vi.mocked(paintFog).mock.calls.length);
    const seen: number[] = [];
    for (let i = 0; i < frames; i++) {
      cost.ms = (ms * FOG_SHARE[level(s)]!) / per;
      pass(50, 50);
      seen.push(level(s));
    }
    return seen;
  }

  test('17 ms a frame at rung 0 is judged after 8 frames and goes straight to the first rung that fits (2), where it stays', () => {
    stubObserver();
    const s = setup();
    see(s, true);
    const seen = drive(s, 17, 200);
    expect(seen[5]).toBe(0);
    expect(seen[10]).toBe(2);
    expect(seen.at(-1)).toBe(2);
    expect(new Set(seen)).toEqual(new Set([0, 2]));
  });

  test('40 ms a frame goes straight to the last rung after 8 frames', () => {
    stubObserver();
    const s = setup();
    see(s, true);
    const seen = drive(s, 40, 200);
    expect(seen[5]).toBe(0);
    expect(seen[10]).toBe(4);
    expect(new Set(seen)).toEqual(new Set([0, 4]));
  });

  test('7 ms a frame, under the 8 ms budget, stays at 0', () => {
    stubObserver();
    const s = setup();
    see(s, true);
    expect(new Set(drive(s, 7, 200))).toEqual(new Set([0]));
  });

  test('a painter within budget keeps the post at 0', () => {
    stubObserver();
    const s = setup();
    see(s, true);
    cost.ms = 1;
    pass(6000, 50);
    expect(level(s)).toBe(0);
  });
});

describe('reduced motion', () => {
  beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });

  test('no frame is asked for: it draws once, and again when something changes', () => {
    const s = setup();
    expect(picture(s)).toBe(true);
    const drew = contexts, before = asked();
    press(s);
    pass(SWEEP_MS + SMOKE.waved + 5000);
    move(s);
    touch(s);
    expect(asked()).toBe(before);
    expect(contexts).toBeGreaterThan(drew);
    s.unmount();
  });

  test('the fog stands still: two pictures a second apart are the same', () => {
    const s = setup();
    const one = recOf(canvas(s))!.draws.at(-1)!.put!.data.slice();
    move(s, 300, 250);
    leave(s);
    pass(1000, 50);
    const two = recOf(canvas(s))!.draws.at(-1)!.put!.data;
    expect(Buffer.from(two).equals(Buffer.from(one))).toBe(true);
  });

  test('a mouse clearing and the trail it leaves are open or shut with no steps between: open at 749 ms, shut at 750', () => {
    const s = setup();
    move(s, 300, 250);
    expect(alphaAt(s, 300, 150)).toBe(0);
    leave(s);
    const seen = new Set<number>();
    for (let t = 0; t < 749; t += 1) { pass(1, 1); seen.add(alphaAt(s, 300, 150)!); }
    expect(alphaAt(s, 300, 150)).toBe(0);
    pass(1, 1);
    expect(alphaAt(s, 300, 150)).toBe(whole());
    expect([...seen]).toEqual([0]);
  });

  test('a touch clearing holds touchHold and then goes at once, never half closed', () => {
    const s = setup();
    touch(s);
    const seen = new Set<number>();
    for (let t = 0; t < SMOKE.touchHold + SMOKE.roll + 500; t += 100) {
      pass(100);
      seen.add(alphaAt(s, 200, 200)!);
      if (t < SMOKE.touchHold - 200) expect(alphaAt(s, 200, 200)).toBe(0);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, whole()]);
    expect(alphaAt(s, 200, 200)).toBe(whole());
  });

  test.each([['reduced', true], ['full', false]])('the sweep takes exactly as long (%s motion): the post is waved exactly when the sweep ends, and not before', (_m, reduced) => {
    if (!reduced) document.documentElement.setAttribute('data-kb-motion', 'full');
    const s = setup();
    press(s);
    pass(SWEEP_MS - 1, LINE_MS);
    expect(inert(s)).toBe(true);
    pass(1, 1);
    expect(inert(s)).toBe(false);
  });

  test('a held sweep clears each line as it finishes, with no clearing sliding along it', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2);
    expect(alphaAt(s, BOX.width / 2, 90)).toBe(whole());
    expect(rowMean(s, 90)).toBe(whole());
    pass(LINE_MS / 2);
    expect(rowMean(s, 90)).toBe(0);
    pass(LINE_MS);
    expect(rowMean(s, 90)).toBe(0);
    expect(rowMean(s, 270)).toBe(0);
  });

  test('the fog is drawn again when the strength has moved by a hundredth', () => {
    const s = setup();
    const before = alphaAt(s, 400, 300)!;
    pass(DAY / 2, DAY / 2);
    pass(1, 1);
    expect(alphaAt(s, 400, 300)).toBeLessThan(before);
    s.unmount();
  });
});

describe('forced colors: a hard circular mask', () => {
  beforeEach(() => { forced = true; });

  test('no frame is requested, and no canvas is drawn', () => {
    const s = setup();
    move(s);
    press(s);
    pass(3000);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(canvas(s)).toBeNull();
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

  test('a mouse move adds a hard-edged circle of holeRadius at the pointer, and a ring; both are gone once the clearing is half closed after the pointer leaves', () => {
    const s = setup();
    move(s, 300, 250);
    expect(holes(s)).toEqual(['300,150']);
    for (const c of circleLayers(s)) expect(c).toMatchObject({ r: holeRadius(BOX.width), alpha: 1, hard: true });
    expect(flat(s)).toBeDefined();
    expect(rings(s).length).toBeGreaterThan(0);
    for (const r of rings(s)) {
      expect(r).toHaveAttribute('aria-hidden', 'true');
      expect(r.style).toMatchObject({ left: '210px', top: '60px', width: '180px', height: '180px' });
    }
    leave(s);
    pass(SMOKE.roll / 2 - 100);
    expect(holes(s)).toEqual(['300,150']);
    for (const c of circleLayers(s)) expect(c).toMatchObject({ alpha: 1, hard: true });
    pass(200);
    expect(circleLayers(s)).toHaveLength(0);
    expect(rings(s)).toHaveLength(0);
    expect(flat(s)).toBeDefined();
  });

  test('a trail point younger than 750 ms is a hole in the mask, an older one is not', () => {
    const s = setup();
    move(s, 300, 250);
    pass(300, 50);
    move(s, 500, 250);
    expect(holes(s).sort()).toEqual(['300,150', '500,150']);
    pass(449, 449);
    expect(holes(s)).toContain('300,150');
    pass(1, 1);
    expect(holes(s)).toEqual(['500,150']);
    expect(rings(s).every((r) => r.style.left === '410px')).toBe(true);
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

  test('a touch\'s circle holds touchHold first, the next touch replaces it, and it is gone once half closed', () => {
    const s = setup();
    touch(s, 200, 300);
    pass(SMOKE.touchHold - 100);
    expect(holes(s)).toEqual(['200,200']);
    expect(circleLayers(s)[0]!.alpha).toBe(1);
    touch(s, 500, 400);
    expect(holes(s)).toEqual(['500,300']);
    pass(SMOKE.touchHold);
    expect(holes(s)).toEqual(['500,300']);
    pass(SMOKE.roll / 2 - 100);
    expect(holes(s)).toEqual(['500,300']);
    expect(circleLayers(s)[0]!.alpha).toBe(1);
    pass(200);
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
  });

  test('the words are inert, as on the canvas path, and the in-body line is not', () => {
    const s = setup();
    expect(inert(s)).toBe(true);
    expect(way(s)).toHaveTextContent(SMOKED_WAY);
    expect(way(s)!.closest('[inert]')).toBeNull();
  });

  test('stubbed not to match, the wrapper has no mask, no ring and no sign: the full effect is untouched', () => {
    forced = false;
    const s = setup();
    move(s);
    settle();
    expect(words(s).style.maskImage).toBe('');
    expect(words(s).getAttribute('style') ?? '').not.toContain('mask');
    expect(rings(s)).toHaveLength(0);
    expect(sign(s)).toBeNull();
    expect(alphaAt(s, 300, 150)).toBe(0);
    expect(alphaAt(s, 700, 500)).toBe(whole());
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
    const seen = new Set<number>();
    for (let t = 0; t < SMOKE.touchHold + SMOKE.roll; t += 100) { pass(100); for (const c of circleLayers(s)) seen.add(c.alpha); }
    expect([...seen]).toEqual([1]);
    expect(circleLayers(s)).toHaveLength(0);
    release(s);
    press(s);
    pass(SWEEP_MS - 1, 1);
    expect(inert(s)).toBe(true);
    pass(1, 1);
    expect(inert(s)).toBe(false);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  test('a moment is the flat layer at the strength then, and a pointer opens a circle and a ring as live', () => {
    const s = setup({ moment });
    expect(layers(s)).toHaveLength(1);
    expect(flat(s)!.alpha).toBeCloseTo(maskAlpha(strength(AT, NOW, ENDS)), 3);
    expect(flat(s)!.alpha).not.toBeCloseTo(maskAlpha(1), 2);
    move(s);
    pass(100, 50);
    expect(circleLayers(s).length).toBeGreaterThan(0);
    expect(rings(s).length).toBeGreaterThan(0);
    expect(host(s).querySelector('button')).toBeNull();
    expect(inert(s)).toBe(true);
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
    expect(tiles(s).map((c) => c.style.top)).toEqual(['50px', '562px']);
    expect(canvas(s)!.style).toMatchObject({ left: '-20px', top: '50px', width: '900px', height: '512px' });
    expect(tiles(s).map((c) => c.style.height)).toEqual(['512px', '188px']);
    expect(canvas(s)!.width).toBe(900);
    expect(canvas(s)!.height).toBe(512);
  });

  test('the fog covers that whole box', () => {
    const s = setup();
    for (const c of tiles(s)) {
      const d = recOf(c)!.draws.at(-1)!;
      expect(d.dx).toBeLessThanOrEqual(0);
      expect(d.dx + d.dw).toBeGreaterThanOrEqual(900);
    }
    expect(alphaAt(s, 1, 1)).toBe(whole());
    expect(alphaAt(s, 899, 699)).toBe(whole());
  });

  test('a clearing\'s radius comes from the area\'s width', () => {
    AREA = { left: 0, top: 50, width: 300, height: 300 };
    const s = setup();
    expect(canvas(s)!.width).toBe(300);
    expect(holeRadius(300)).toBeLessThan(holeRadius(800) - 20);
    move(s, 100, 200);
    settle();
    expect(alphaAt(s, 100, 150)).toBe(0);
    /* 80 px off: past this area's radius, inside an 800 px box's. */
    expect(alphaAt(s, 180, 150)).toBe(whole());
  });

  test('a mouse move at a point in the area outside the words opens a clearing there, in the area\'s coordinates', () => {
    const s = setup();
    move(s, OUTSIDE.x, OUTSIDE.y);
    settle();
    expect(alphaAt(s, 10, 10)).toBe(0);
    leave(s);
    pass(SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphaAt(s, 10, 10)).toBe(whole());
  });

  test('a touch anywhere in the area opens a clearing, but a press on what the engine lifts over the ink (the reactions row, a fold bar) opens none', () => {
    const s = setup();
    touch(s, 400, 400);
    settle();
    expect(alphaAt(s, 420, 350)).toBe(0);
    const lifted = document.createElement('div');
    lifted.setAttribute('data-kb-over-ink', '');
    area(s).appendChild(lifted);
    pass(SMOKE.touchHold + SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphaAt(s, 420, 350)).toBe(whole());
    pointer(lifted, 'pointerdown', 100, 100, 'touch');
    pointer(lifted, 'pointermove', 100, 100);
    settle();
    for (const c of tiles(s)) expect(alphas(recOf(c))).toEqual(new Set([whole()]));
  });

  test('the held sweep travels the words\' lines, offset into the area\'s coordinates', () => {
    const s = setup();
    press(s);
    pass(LINE_MS / 2, 16);
    /* Half way along the words' first line (60 to 120 in the words): across the words' 800 from the words' left, down the area by the words' top. */
    expect(alphaAt(s, 20 + 400, 50 + 90)).toBe(0);
    pass(LINE_MS / 2, 50);
    /* The finished line's rows, 110 to 170 of the area, are open. */
    expect(alphaAt(s, 30, 140)).toBe(0);
    expect(alphaAt(s, 790, 140)).toBe(0);
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
    pass(LINE_MS * 4, 50);
    expect(inert(s)).toBe(true);
    /* The hold really stopped: no line is announced, the post is never waved, and the fog is whole again. */
    expect(readout(s)).toBe('');
    expect(last(s).state).toBe('Smoke over the words');
    for (const c of tiles(s)) expect(alphas(recOf(c))).toEqual(new Set([whole()]));
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
    settle();
    expect(alphaAt(s, 320, 200)).toBe(0);
  });

  test('with no post body about it (the ORIGIN box) the area is the effect\'s own element', () => {
    const s = setup({}, false, true);
    expect(canvas(s)!.style).toMatchObject({ left: '0px', top: '0px', width: '800px', height: '512px' });
    pointer(host(s), 'pointermove', 300, 250);
    settle();
    expect(alphaAt(s, 300, 250)).toBe(0);
    pointer(host(s), 'pointerleave', 0, 0);
    pass(SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphaAt(s, 300, 250)).toBe(whole());
  });

  test('a moment fills the same area at the strength then, and a pointer on it clears the fog as live', () => {
    const s = setup({ moment });
    expect(canvas(s)!.style).toMatchObject({ left: '-20px', top: '50px', width: '900px', height: '512px' });
    expect(alphaAt(s, 1, 1)).toBe(whole(AT));
    pointer(area(s), 'pointermove', 100, 100);
    settle();
    expect(alphaAt(s, 100, 100)).toBe(0);
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
      expect(rings(s).length).toBeGreaterThan(0);
      expect(rings(s)[0]!.style).toMatchObject({ left: '-80px', top: '-80px', width: '180px', height: '180px' });
    });

    test('the mask\'s circle is in the words\' coordinates: the pointer at the area\'s (x, y) is the circle at (x - words left, y - words top)', () => {
      const s = setup();
      move(s, 320, 260);
      /* Area (340, 210) -> words (320, 160). */
      expect(holes(s)).toEqual(['320,160']);
      expect(circleLayers(s)[0]).toMatchObject({ r: holeRadius(900), hard: true });
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
    settle();
    expect(words(s).getAttribute('style') ?? '').not.toContain('mask');
    expect(rings(s)).toHaveLength(0);
    expect(sign(s)).toBeNull();
    expect(s.container.querySelector('.dw-hotbox-frame')).toBeNull();
    expect(alphaAt(s, 10, 10)).toBe(0);
  });
});

describe('what it tells the Lens', () => {
  test('its view, in the plan\'s words, with one hold control', () => {
    const s = setup();
    expect(last(s)).toMatchObject({
      state: 'Smoke over the words',
      ends: `Point at the words, or hold Wave the smoke, to read. ${endsWords(iso(ENDS), NOW)}.`,
      yours: true,
      notes: {},
    });
    expect(last(s).progress).toBeCloseTo(0, 2);
    expect(last(s).controls).toHaveLength(1);
    expect(last(s).controls[0]).toMatchObject({ kind: 'hold', label: 'Wave the smoke' });
    expect(wave(s).describe).toBe(WAVE_DESCRIBE);
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
    const inMoment = setup({ moment });
    for (const v of views(inMoment)) expect(viewProblems(v, { holds: false, covers: true })).toEqual([]);
  });

  test('is met once however often the post goes out of view and comes back', () => {
    stubObserver();
    const s = setup({}, true);
    const see = (isIntersecting: boolean) => act(() => { watch!([{ target: area(s), isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); });
    see(true);
    see(false);
    see(true);
    expect(s.met).toHaveBeenCalledTimes(1);
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
  beforeEach(() => { stubObserver(); });
  const see = (s: Setup, isIntersecting: boolean) => act(() => { watch!([{ target: area(s), isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]); });

  test('a covered post in view is not met; uncovered, it is met once, as if it had just scrolled in', () => {
    const s = setup({ covered: true });
    see(s, true);
    expect(s.met, 'a covered post is out of view').not.toHaveBeenCalled();
    act(() => { cover(false); });
    expect(s.met).toHaveBeenCalledTimes(1);
    act(() => { cover(true); });
    act(() => { cover(false); });
    expect(s.met, 'met once however often the curtain shuts').toHaveBeenCalledTimes(1);
  });

  test('met waits for the first sight of the post, and the fog is painted by the layer whether or not the post is reported in view', () => {
    const s = setup();
    expect(s.met).not.toHaveBeenCalled();
    /* Painted before it is seen (the commit's own paint); the rest timer's drift is for a post in view. */
    expect(picture(s)).toBe(true);
    see(s, true);
    expect(s.met).toHaveBeenCalledTimes(1);
    pass(100, 50);
    const one = recOf(canvas(s))!.draws.at(-1)!.put!.data.slice();
    pass(2000, 50);
    const two = recOf(canvas(s))!.draws.at(-1)!.put!.data;
    expect(Buffer.from(two).equals(Buffer.from(one))).toBe(false);
    see(s, false);
    see(s, true);
    expect(s.met).toHaveBeenCalledTimes(1);
  });

  test('with every tile released by the band watcher no frame is asked for, and painting resumes when a tile returns', () => {
    AREA = { ...BOX, height: 1600 };
    const s = setup();
    /* The post is in view: the rest timer repaints a tile that returns. */
    see(s, true);
    const nearBands = (...hold: number[]) => act(() => { bandsWatch!(bandEls.map((el, i) => ({ target: el, isIntersecting: hold.includes(i), intersectionRatio: hold.includes(i) ? 1 : 0 }))); runFrame(); });
    nearBands(0);
    nearBands();
    expect(tiles(s)).toHaveLength(0);
    act(() => { runFrame(); });
    expect(frames.size).toBe(0);
    const drew = contexts;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(frames.size).toBe(0);
    expect(contexts).toBe(drew);
    nearBands(1);
    expect(tiles(s)).toHaveLength(1);
    act(() => { runFrame(); });
    expect(contexts).toBeGreaterThan(drew);
    const again = contexts;
    act(() => { vi.advanceTimersByTime(100); runFrame(); });
    expect(contexts).toBeGreaterThan(again);
  });

  test('the element watched for met is the content area (the post body), and the host in an ORIGIN box', () => {
    const s = setup();
    expect(watched).toEqual([area(s)]);
    s.unmount();
    watched = [];
    const b = setup({}, false, true);
    expect(watched).toEqual([host(b)]);
  });

  test('the observers are given margins: the area\'s, so met is not late, and the tile layer\'s own', () => {
    setup();
    expect(margins).toContainEqual({ rootMargin: '200px 0px' });
    expect(margins).toContainEqual({ rootMargin: '256px 0px' });
  });
});

/*
 * The tile layer (engine/ui/cards/tiles.ts, docs/plans/2026-11-16-effect-tiles-design.md, sections 3 to 5): the smoke is drawn in tiles of 512 CSS px, held only near
 * the window, and each band's place has a stand-in marked far until a painted tile covers it. The box is 800 by 600 unless a test says so.
 */
describe('the tiles', () => {
  test('a box 800 by 600 holds two tiles, 512 and 88 tall, and the fog is painted in both', () => {
    const s = setup();
    expect(tiles(s)).toHaveLength(2);
    expect(tiles(s).map((c) => [c.width, c.height])).toEqual([[800, 512], [800, 88]]);
    expect(tiles(s).map((c) => c.style.top)).toEqual(['100px', '612px']);
    for (const c of tiles(s)) expect(alphas(recOf(c)), 'every tile is fogged').toEqual(new Set([whole()]));
    expect(rgbVar(s)).toBe('0 128 128');
  });

  test('a clearing at y = 500 is open in both tiles, and one at y = 100 only in the first', () => {
    const s = setup();
    const [a, b] = tiles(s).map((c) => recOf(c)!);
    /* The pointer is read from the area's corner, which is at page y 100. */
    move(s, 300, 100 + 500);
    settle();
    expect(pixelIn(a, 300, 500)![3]).toBe(0);
    expect(pixelIn(b, 300, 530)![3]).toBe(0);
    leave(s);
    pass(SMOKE.roll + 3 * SMOKE.wake, 50);
    expect(alphas(a)).toEqual(new Set([whole()]));
    expect(alphas(b)).toEqual(new Set([whole()]));
    move(s, 300, 100 + 100);
    settle();
    expect(pixelIn(a, 300, 100)![3]).toBe(0);
    expect(alphas(b)).toEqual(new Set([whole()]));
  });

  test('a box 800 by 20,000 at a screen density of 2 holds at most mostTiles(innerHeight) canvases, each 800 by 512: the fog asks for a density of 1', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    try {
      AREA = { ...BOX, height: 20_000 };
      const s = setup();
      expect(tiles(s).length).toBeGreaterThan(0);
      expect(tiles(s).length).toBeLessThanOrEqual(mostTiles(window.innerHeight));
      for (const c of tiles(s)) expect([c.width, c.height]).toEqual([800, 512]);
    } finally {
      delete (window as { devicePixelRatio?: unknown }).devicePixelRatio;
    }
  });

  test('before any observer report, a smoked post in view has its tiles painted in the commit that mounts it', () => {
    stubObserver();
    const s = setup();
    /* No observer has reported and no frame has run. */
    expect(tiles(s)).toHaveLength(2);
    for (const c of tiles(s)) expect(drawn(recOf(c)), 'painted').toBe(true);
    expect(s.met).not.toHaveBeenCalled();
  });

  test('a far band\'s stand-in carries the fog\'s color and alpha, and the alpha follows the strength', () => {
    /* The observer never reports: the post is out of view, so the page's 50 ms rest timer is not joined (it would tick 2.6 million times over these days); the strength tick, which is not the rest timer's, is what is read. */
    stubObserver();
    AREA = { ...BOX, height: 20_000 };
    const s = setup();
    const bands = [...host(s).querySelectorAll<HTMLElement>('.kb-band')];
    expect(bands.length).toBe(40);
    expect(bands.every((b) => b.classList.contains('dw-hotbox-far'))).toBe(true);
    expect(bands[0]!.getAttribute('data-kb-tile')).toBe('held');
    expect(bands[30]!.getAttribute('data-kb-tile')).toBe('far');
    expect(rgbVar(s)).toBe('0 128 128');
    expect(Number(host(s).style.getPropertyValue('--dw-hotbox-fog'))).toBeCloseTo(fogAlpha(strength(NOW, NOW, ENDS)), 3);
    const before = Number(host(s).style.getPropertyValue('--dw-hotbox-fog'));
    /* One jump of the clock and one frame: only that the days have passed matters, not the frames between. */
    pass(1.5 * DAY, 1.5 * DAY);
    const later = Number(host(s).style.getPropertyValue('--dw-hotbox-fog'));
    expect(later).toBeLessThan(before);
    expect(Math.abs(later - fogAlpha(strength(Date.now(), NOW, ENDS)))).toBeLessThan(0.02);
  });

  test('the stylesheet: the far mark has the fog\'s flat color and the held mark nothing; the host lets a finger\'s drag reach the effect; nothing in inert words is lifted; no in-post control', () => {
    const css = readFileSync('instances/divided-world/ui/hot-box/hot-box.css', 'utf8');
    const far = /\.dw-hotbox-far\[data-kb-tile="far"\]\s*\{([^}]*)\}/u.exec(css);
    expect(far, 'a rule for the far mark').not.toBeNull();
    expect(far![1]).toContain('background: rgb(var(--dw-hotbox-rgb) / var(--dw-hotbox-fog))');
    expect(far![1]).toContain('z-index: 1');
    expect(far![1]).toContain('pointer-events: none');
    expect(css).not.toMatch(/\[data-kb-tile="held"\][^{]*\{[^}]*background/u);
    const hostRule = /(?:^|\n)\.dw-hotbox\s*\{([^}]*)\}/u.exec(css);
    expect(hostRule![1]).toContain('touch-action: pan-y pinch-zoom');
    const under = /\.dw-hotbox-words\[inert\] \[data-kb-over-ink\]\s*\{([^}]*)\}/u.exec(css);
    expect(under, 'a rule for what is lifted inside inert words').not.toBeNull();
    expect(under![1]).toContain('z-index: 0');
    expect(css).not.toContain('dw-hotbox-wave');
  });

  test('a tile the band watcher reports gone is released, and one reported near is made and painted in the next frame', () => {
    stubObserver();
    AREA = { ...BOX, height: 1600 };
    const s = setup();
    expect(tiles(s)).toHaveLength(2);
    const [, second] = tiles(s);
    const nearBands = (...hold: number[]) => act(() => { bandsWatch!(bandEls.map((el, i) => ({ target: el, isIntersecting: hold.includes(i), intersectionRatio: hold.includes(i) ? 1 : 0 }))); runFrame(); });
    nearBands(0);
    expect(tiles(s)).toHaveLength(1);
    expect([second!.width, second!.height]).toEqual([0, 0]);
    expect(second!.isConnected).toBe(false);
    expect(host(s).querySelectorAll('.kb-band')[1]!.getAttribute('data-kb-tile')).toBe('far');
    nearBands(0, 1);
    expect(tiles(s)).toHaveLength(2);
    expect(drawn(recOf(tiles(s)[1])), 'not painted until the next frame').toBe(false);
    act(() => { runFrame(); });
    expect(drawn(recOf(tiles(s)[1]))).toBe(true);
    expect(host(s).querySelectorAll('.kb-band')[1]!.getAttribute('data-kb-tile')).toBe('held');
  });

  test('the layer survives a strength tick: the same canvases before and after the smoke has thinned', () => {
    /* The observer never reports: the post is out of view, so the page's 50 ms rest timer is not joined (it would tick 2.6 million times over these days); the strength tick, which is not the rest timer's, is what is read. */
    stubObserver();
    const s = setup();
    const before = tiles(s);
    const fogBefore = host(s).style.getPropertyValue('--dw-hotbox-fog');
    /* One jump of the clock and one frame: only that the smoke has thinned matters, not the frames between. */
    pass(1.5 * DAY, 1.5 * DAY);
    expect(host(s).style.getPropertyValue('--dw-hotbox-fog')).not.toBe(fogBefore);
    expect(tiles(s)).toHaveLength(before.length);
    tiles(s).forEach((c, i) => { expect(c).toBe(before[i]); expect(c.isConnected).toBe(true); });
  });

  test('in the waved window no frame is asked for and no fog is drawn', () => {
    const s = setup();
    press(s);
    pass(SWEEP_MS);
    release(s);
    pass(SMOKE.waved / 2);
    expect(frames.size).toBe(0);
    expect(picture(s)).toBe(false);
  });

  test('under forced colors there is no canvas and no stand-in', () => {
    forced = true;
    AREA = { ...BOX, height: 20_000 };
    const s = setup();
    expect(tiles(s)).toHaveLength(0);
    expect(s.container.querySelectorAll('.kb-band, [data-kb-tile], .dw-hotbox-far')).toHaveLength(0);
    expect(host(s).style.getPropertyValue('--dw-hotbox-fog')).toBe('');
    forced = false;
    act(() => { for (const l of forcedListeners) l(); });
    expect(tiles(s).length).toBeGreaterThan(0);
    forced = true;
    act(() => { for (const l of forcedListeners) l(); });
    expect(tiles(s)).toHaveLength(0);
    expect(s.container.querySelectorAll('.kb-band')).toHaveLength(0);
  });
});

describe('the scratch canvas', () => {
  test('a browser that gives it no 2D context is asked once, and each tile is filled flat in the fog\'s color, with a disc cut where a pointer is', () => {
    const made = vi.spyOn(document, 'createElement');
    const ctx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: unknown[]) {
      return this.classList.contains('dw-hotbox-smoke') ? (ctx as (...x: unknown[]) => unknown).apply(this, a) : null;
    } as unknown as HTMLCanvasElement['getContext'];
    try {
      const s = setup();
      const canvases = () => made.mock.calls.filter((c) => c[0] === 'canvas').length;
      const made0 = canvases();
      pass(200, 50);
      expect(canvases()).toBe(made0);
      /* The tiles' canvases are the layer's; what is left is the one scratch canvas. */
      expect(made0 - tiles(s).length).toBeLessThanOrEqual(1);
      const fill = recOf(canvas(s))!.fills.find((f) => f.op === 'source-over')!;
      expect(fill.style).toBe(`rgba(0, 128, 128, ${Number(fogAlpha(1).toFixed(4))})`);
      move(s, 300, 250);
      pass(50, 50);
      expect(recOf(canvas(s))!.arcs).toContainEqual({ x: 300, y: 150, r: holeRadius(BOX.width) });
    } finally {
      made.mockRestore();
      HTMLCanvasElement.prototype.getContext = ctx;
    }
  });
});

describe('a moment', () => {
  /* Today's clock is long past the play's end; the moment is a day and a half in. */
  const past = (over: Partial<EffectProps> = {}) => { vi.setSystemTime(NOW + 4 * DAY); const s = setup({ moment, ...over }); expect(s.container.querySelector('.dw-hotbox'), 'the smoke is drawn in the moment').not.toBeNull(); return s; };

  test('a play whose end is behind the clock is drawn at the strength it had at the moment: neither full nor gone, and the clock moving changes nothing', () => {
    const s = past();
    expect(canvas(s)).not.toBeNull();
    expect(host(s)).not.toBeNull();
    const a = whole(AT);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(Math.round(SMOKE.full * 255));
    expect(alphas(recOf(canvas(s)))).toEqual(new Set([a]));
    act(() => { vi.setSystemTime(NOW + 7 * DAY); });
    pass(200, 50);
    expect(alphas(recOf(canvas(s)))).toEqual(new Set([a]));
    expect(host(s)).not.toBeNull();
  });

  test('the way out says "Ends" at the moment, though the page\'s clock is past the end', () => {
    const s = past();
    expect(last(s).ends).toBe(`Point at the words, or hold Wave the smoke, to read. ${endsWords(iso(ENDS), AT)}.`);
    expect(last(s).ends).toContain('Ends ');
    expect(last(s).ends).not.toContain('Ended');
  });

  test('the standing play is the one up at the moment: the first whose end is after it', () => {
    const s = past({ plays: [play({ id: 'a', ends: iso(NOW + DAY), config: { color: 'red' } }), play({ id: 'b', config: { color: 'blue' } })] });
    expect(rgbVar(s)).toBe('0 0 255');
  });

  test('pointing clears smoke locally', () => {
    const s = past();
    move(s, 300, 250);
    settle();
    expect(alphaAt(s, 300, 150)).toBe(0);
    expect(alphaAt(s, 700, 500)).toBe(whole(AT));
  });

  test('the Lens hold sweeps and opens the waved window', () => {
    const s = past();
    expect(last(s).controls).toHaveLength(1);
    press(s);
    pass(LINE_MS);
    expect(readout(s)).toBe('First line of the post.');
    pass(SWEEP_MS - LINE_MS);
    expect(inert(s)).toBe(false);
    expect(last(s)).toMatchObject({ state: 'Waved clear for you' });
    release(s);
  });

  test('the words are inert while smoked, with the way-line standing in them', () => {
    const s = past();
    expect(inert(s)).toBe(true);
    expect(way(s)).toHaveTextContent(SMOKED_WAY);
    expect(s.container.querySelector('[aria-live]')).not.toBeNull();
    expect(last(s)).toMatchObject({ state: 'Smoke over the words' });
  });

  test('the waved window ending with focus in the words, in a post with no Hot Box mark, leaves focus where it is', () => {
    const s = past();
    const link = s.container.querySelector('a')!;
    press(s);
    pass(SWEEP_MS);
    release(s);
    act(() => { link.focus(); });
    expect(document.activeElement).toBe(link);
    pass(SMOKE.waved + 200);
    expect(inert(s)).toBe(true);
    expect(document.activeElement).toBe(link);
  });

  test('a moment sets no thinning wake: a finite end leaves the same pending timers as no end, and the wake itself is none where fixed and one where live', () => {
    const timers = (over: Partial<EffectProps>) => { const s = setup(over); pass(100, 50); const n = vi.getTimerCount(); s.unmount(); return n; };
    vi.setSystemTime(NOW + 4 * DAY);
    expect(timers({ moment })).toBe(timers({ moment, plays: [play({ ends: undefined })] }));
    const m = { mouse: null, touch: null, rest: [], trail: [], moves: [], mover: null, sweep: null, said: 0, wavedAt: null };
    const o = { reduced: false, animate: false, frames: true, playedAt: NOW, ends: ENDS };
    expect(nextWake(m, AT, { ...o, fixed: false })).not.toBeNull();
    expect(nextWake(m, AT, { ...o, fixed: true })).toBeNull();
  });

  test('save, release and met are never called, even with the post in view', () => {
    stubObserver();
    const s = past();
    act(() => { watch!([{ target: area(s), isIntersecting: true, intersectionRatio: 1 }]); });
    move(s); touch(s);
    press(s);
    pass(SWEEP_MS + 100);
    release(s);
    expect(s.met).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
    expect(s.release).not.toHaveBeenCalled();
  });
});

describe('nobody is special', () => {
  test('two readers who differ only in reader.author and reader.caster get the same smoke', () => {
    const a = setup({ reader: { author: false, caster: false } });
    const same = (html: string) => html.replace(/(id|aria-describedby)="[^"]*"/gu, '');
    const htmlA = same(a.container.innerHTML);
    const bytesA = recOf(canvas(a))!.draws.at(-1)!.put!.data.slice();
    a.unmount();
    const b = setup({ reader: { author: true, caster: true } });
    expect(same(b.container.innerHTML)).toBe(htmlA);
    expect(Buffer.from(recOf(canvas(b))!.draws.at(-1)!.put!.data).equals(Buffer.from(bytesA))).toBe(true);
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
    settle();
    expect(alphas(recOf(canvas(s))), 'History is its own').toEqual(new Set([whole()]));
    pointer(host(s), 'pointermove', 300, 250);
    settle();
    expect(alphaAt(s, 290, 210), 'the byline clears').toBe(0);
  });

  test('with the effect on an outer body, a press inside a nested lifted box opens none', () => {
    /* The opening post's own Hot Box: its body holds the ORIGIN box, lifted whole. */
    const s = setup();
    const box = document.createElement('div');
    box.setAttribute('data-kb-over-ink', '');
    const inBox = document.createElement('p');
    box.appendChild(inBox);
    outer(s).appendChild(box);
    pointer(inBox, 'pointerdown', 100, 100, 'touch');
    pointer(inBox, 'pointermove', 100, 100);
    settle();
    expect(alphas(recOf(canvas(s))), 'the box is not this effect').toEqual(new Set([whole()]));
  });
});
