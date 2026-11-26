/**
 * The extinguisher's puff (Puff.tsx; docs/plans/2026-11-23-steel-chair-objects-design.md, section 4): that its layer is made when it starts and is gone when it ends, that it never
 * makes the words inert or sets a live region, that a pointer over the area opens a clearing in its field, that it steps its field over the whole box with the front as its floor,
 * that it draws nothing under reduced motion and forced colors, and that it takes its rungs from the page's ladder. jsdom has no layout, so the content area is a stub (600 by 400)
 * and the frames are the test's own, a queue it drains with a clock it advances.
 */
import { act, cleanup } from '@testing-library/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTileLayer } from '../../../../engine/ui/cards/tiles.ts';
import { createFake } from '../../../../engine/ui/data/fake.ts';
import { renderIn, testInstance } from '../../../../engine/ui/test-world.tsx';
import { FOG, emptyField, fogAt, stepField, type FogField } from '../hot-box/fog.ts';
import { FOG_BUDGET_MS, forceFogLevel, ladder, resetFogLadder, spend } from '../hot-box/ladder.ts';
import { holeRadius } from '../hot-box/smoke.ts';
import { PUFF, puffDone } from './puff.ts';
import { Puff, STEP_MARGIN, forgetScratch, type PuffProps } from './Puff.tsx';

vi.mock('../../../../engine/ui/cards/tiles.ts', async (orig) => {
  const real = await orig<typeof import('../../../../engine/ui/cards/tiles.ts')>();
  return { ...real, makeTileLayer: vi.fn(real.makeTileLayer) };
});
vi.mock('../hot-box/fog.ts', async (orig) => {
  const real = await orig<typeof import('../hot-box/fog.ts')>();
  return { ...real, stepField: vi.fn(real.stepField), emptyField: vi.fn(real.emptyField) };
});

const NOW = Date.parse('2026-11-25T12:00:00Z');
const AREA = { left: 0, top: 0, width: 600, height: 400 };
const SPOUT = { x: 500, y: 350 };
const TOTAL = PUFF.billowMs + PUFF.holdMs + PUFF.fadeMs;

let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let forced = false;
let clock = 0;
/** How far the window is scrolled over the area, CSS px: a canvas's rect is its place in the area less this. */
let scrolled = 0;
const rects = new WeakMap<HTMLCanvasElement, { clears: number; draws: number; spans: [number, number][]; quality: string[] }>();

function stubWindow() {
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  window.cancelAnimationFrame = vi.fn((id: number) => { frames.delete(id); });
  window.matchMedia = vi.fn((query: string) => ({
    media: query, onchange: null, dispatchEvent: () => true, addListener: () => {}, removeListener: () => {},
    get matches() { return query.includes('forced-colors') ? forced : false; },
    addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = AREA.top - scrolled, r = { ...AREA, top };
    return { ...r, x: AREA.left, y: top, right: AREA.width, bottom: top + AREA.height, toJSON: () => r } as DOMRect;
  };
  HTMLCanvasElement.prototype.getBoundingClientRect = function (this: HTMLCanvasElement) {
    const top = (Number.parseFloat(this.style.top) || 0) - scrolled, height = Number.parseFloat(this.style.height) || 0, r = { left: 0, top, width: AREA.width, height };
    return { ...r, x: 0, y: top, right: AREA.width, bottom: top + height, toJSON: () => r } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return AREA.width; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return AREA.height; } });
  HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement) {
    const rec = rects.get(this) ?? { clears: 0, draws: 0, spans: [], quality: [] };
    rects.set(this, rec);
    const ctx = {
      imageSmoothingQuality: 'low',
      setTransform: () => {}, save: () => {}, restore: () => {}, beginPath: () => {}, clip: () => {}, fill: () => {}, rect: () => {}, arc: () => {}, fillRect: () => {},
      clearRect: () => { rec.clears += 1; }, drawImage: (...a: number[]) => { rec.draws += 1; rec.quality.push(ctx.imageSmoothingQuality); rec.spans.push([a[6]!, a[6]! + a[8]!]); }, putImageData: () => {},
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    };
    return ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
}

/** Lets `ms` pass in frames 16 ms apart: timers fire in order and each frame is run, as a browser's would be. */
function pass(ms: number) {
  for (let left = ms; left > 0; left -= 16) {
    clock += 16;
    act(() => { vi.advanceTimersByTime(16); const due = [...frames.values()]; frames.clear(); for (const cb of due) cb(clock); });
  }
}

/** A content area with some words and the host the puff's layer is made on. */
function Harness(props: Omit<PuffProps, 'host'>) {
  const ref = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(ref.current); }, []);
  return (
    <div className="kb-act-main" data-kb-content-area>
      <div ref={ref} className="dw-chair">
        <p>The words of the post. <a href="https://example.com/">A link</a></p>
        {host ? <Puff host={host} {...props} /> : null}
      </div>
    </div>
  );
}

function setup(over: Partial<PuffProps> = {}) {
  const done = vi.fn();
  const world = createFake({ instance: testInstance, now: () => Date.now() });
  const out = renderIn(world, <Harness place="thread" spout={SPOUT} done={done} {...over} />);
  return { done, ...out };
}
const canvases = (c: HTMLElement) => [...c.querySelectorAll<HTMLCanvasElement>('canvas.dw-chair-puff')];
const lastStep = () => vi.mocked(stepField).mock.calls.at(-1)!;
const fieldNow = (): FogField => lastStep()[0];

beforeEach(() => {
  frames = new Map(); frameId = 0; forced = false; clock = 0; scrolled = 0; AREA.height = 400;
  vi.mocked(makeTileLayer).mockClear(); vi.mocked(stepField).mockClear(); vi.mocked(emptyField).mockClear();
  forgetScratch();
  resetFogLadder();
  vi.spyOn(performance, 'now').mockImplementation(() => 0);
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  stubWindow();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (HTMLCanvasElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
});

describe('its layer', () => {
  test('is made when the puff starts, on the engine\'s tile layer over the content area, and is gone after puffDone', () => {
    const s = setup();
    expect(makeTileLayer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(makeTileLayer).mock.calls[0]![1]).toMatchObject({ density: 1, className: 'dw-chair-puff' });
    pass(100);
    expect(canvases(s.container).length).toBeGreaterThan(0);
    expect(canvases(s.container)[0]).toHaveAttribute('aria-hidden', 'true');
    pass(TOTAL - 100 - 200);
    expect(s.done).not.toHaveBeenCalled();
    expect(canvases(s.container).length).toBeGreaterThan(0);
    expect(puffDone(TOTAL - 1)).toBe(false);
    pass(300);
    expect(s.done).toHaveBeenCalledTimes(1);
    expect(canvases(s.container)).toHaveLength(0);
  });

  test('it is over on the timer alone, with no frame to end it', () => {
    const s = setup();
    act(() => { vi.advanceTimersByTime(TOTAL + 50); });
    expect(s.done).toHaveBeenCalledTimes(1);
    expect(canvases(s.container)).toHaveLength(0);
  });

  test('an unmount takes the layer with it, and tells nobody', () => {
    const s = setup();
    pass(200);
    s.unmount();
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });
});

describe('the words', () => {
  test('are never inert, and the puff sets no live region and adds no control or element of its own but its tiles', () => {
    const s = setup();
    for (let i = 0; i < 6; i++) {
      pass(TOTAL / 6);
      expect(s.container.querySelector('[inert]')).toBeNull();
      expect(s.container.querySelector('[aria-live]')).toBeNull();
      expect(s.container.querySelector('button')).toBeNull();
    }
    expect(s.container.querySelector('a')).not.toBeNull();
  });

  test('a canvas takes no pointer, so a press on a link under the puff is the link\'s', () => {
    const s = setup();
    pass(100);
    for (const c of canvases(s.container)) expect(c.style.pointerEvents).toBe('none');
  });
});

describe('its field', () => {
  test('starts empty, steps the whole box, and is fog inside the front and none outside it, with the fill fast', () => {
    setup();
    pass(48);
    const first = vi.mocked(emptyField).mock.calls[0]!;
    expect(first.slice(0, 2)).toEqual([AREA.width, AREA.height]);
    const field = fieldNow();
    expect(lastStep()[2].whole).toBe(true);
    expect(fogAt(field, 20, 20).d, 'the far corner is not reached yet').toBeLessThan(0.05);
    pass(PUFF.billowMs + 200);
    expect(fogAt(fieldNow(), 20, 20).d, 'the far corner is whole fog once the front has passed').toBeGreaterThan(0.95);
    expect(fogAt(fieldNow(), 300, 200).d).toBeGreaterThan(0.95);
  });

  test('steps only the rows the window shows and a margin of them, not every row of the tiles the layer holds', () => {
    /* A tall post: 5,000 px, the window's top at 1,500 of it. The layer holds the tiles within 256 px of the window (three or four of 512 px); a frame's step is for what is seen. */
    AREA.height = 5000;
    scrolled = 1500;
    window.scrollY = 1500;
    setup({ spout: { x: 300, y: 2500 } });
    pass(PUFF.billowMs + 100);
    const view = lastStep()[2].view!;
    const held = vi.mocked(makeTileLayer).mock.results[0]!.value.held() as { top: number; h: number }[];
    expect(held.length, 'the layer holds more than the window').toBeGreaterThan(Math.ceil(window.innerHeight / 512));
    expect(view.top).toBeGreaterThanOrEqual(1500 - STEP_MARGIN);
    expect(view.bottom).toBeLessThanOrEqual(1500 + window.innerHeight + STEP_MARGIN);
    expect(view.bottom, 'and it reaches the window\'s bottom edge').toBeGreaterThanOrEqual(1500 + window.innerHeight);
    expect(view.top, 'and its top edge').toBeLessThanOrEqual(1500);
  });

  test('draws only the rows it stepped: a held tile that lies outside them is left clear, and a tile at the window draws no further than the margin past it', () => {
    /* The window's top at 1,600 of a 5,000 px post, 768 tall: it shows 1,600 to 2,368, the step is for 1,504 to 2,464, and the layer holds tiles out to 256 px past the window, among them one that begins at 2,560. */
    AREA.height = 5000;
    scrolled = 1600;
    window.scrollY = 1600;
    const s = setup({ spout: { x: 300, y: 2000 } });
    pass(PUFF.billowMs + 200);
    const view = lastStep()[2].view!;
    const held = vi.mocked(makeTileLayer).mock.results[0]!.value.held() as { top: number; h: number; sheets: HTMLCanvasElement[] }[];
    const away = held.filter((t) => t.top >= view.bottom || t.top + t.h <= view.top);
    expect(away.length, 'the layer holds a tile outside the stepped rows').toBeGreaterThan(0);
    for (const t of away) expect(rects.get(t.sheets[0]!)!.draws, `the tile at ${t.top} is outside the rows stepped and is drawn from stale rows`).toBe(0);
    const near = held.filter((t) => t.top < view.bottom && t.top + t.h > view.top);
    expect(near.length).toBeGreaterThan(0);
    for (const t of near) {
      const rec = rects.get(t.sheets[0]!)!;
      expect(rec.draws).toBeGreaterThan(0);
      for (const [from, to] of rec.spans.slice(-1)) { expect(from).toBeGreaterThanOrEqual(view.top - 20); expect(to).toBeLessThanOrEqual(view.bottom + 20); }
    }
    s.unmount();
  });

  test('the jet runs for jetMs and no longer', () => {
    setup();
    pass(64);
    expect(lastStep()[2].jet).toMatchObject({ x: SPOUT.x, y: SPOUT.y });
    pass(PUFF.jetMs);
    expect(lastStep()[2].jet).toBeUndefined();
  });

  test('a pointer over the area opens a clearing: the density under it drops', () => {
    const s = setup();
    pass(PUFF.billowMs + 300);
    const area = s.container.querySelector<HTMLElement>('.kb-act-main')!;
    const x = 200, y = 150;
    expect(fogAt(fieldNow(), x, y).d).toBeGreaterThan(0.95);
    const at = (px: number, py: number) => act(() => { area.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: px, clientY: py, pointerType: 'mouse', pointerId: 1 })); });
    at(x, y);
    pass(300);
    expect(lastStep()[2].clearings.length).toBeGreaterThan(0);
    expect(lastStep()[2].radius).toBe(holeRadius(AREA.width));
    expect(fogAt(fieldNow(), x, y).d, 'the fog under the pointer is cleared').toBeLessThan(0.2);
    expect(fogAt(fieldNow(), 450, 330).d, 'and elsewhere it is not').toBeGreaterThan(0.9);
  });

  test('the pointer is read passively and never prevented', () => {
    const s = setup();
    pass(50);
    const area = s.container.querySelector<HTMLElement>('.kb-act-main')!;
    const e = new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, pointerType: 'mouse', pointerId: 1 });
    act(() => { area.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('where it draws nothing', () => {
  test('under reduced motion no layer is made, and it ends at once', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const s = setup();
    pass(100);
    expect(makeTileLayer).not.toHaveBeenCalled();
    expect(canvases(s.container)).toHaveLength(0);
    expect(s.done).toHaveBeenCalledTimes(1);
  });

  test('under forced colors no layer is made, and it ends at once', () => {
    forced = true;
    const s = setup();
    pass(100);
    expect(makeTileLayer).not.toHaveBeenCalled();
    expect(canvases(s.container)).toHaveLength(0);
    expect(s.done).toHaveBeenCalledTimes(1);
  });
});

describe('the page\'s ladder', () => {
  test('the puff joins it as a transient rung and leaves it with its layer', () => {
    setup();
    expect([...ladder.rungs].filter((r) => r.transient)).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(TOTAL + 50); });
    expect(ladder.rungs.size).toBe(1);
  });

  test('it starts at a rung below Hot Box\'s, and over the budget it steps down to the last rung, drawn from the model with no field', () => {
    setup();
    pass(PUFF.billowMs + 100);
    expect(vi.mocked(emptyField).mock.calls[0]![2], 'it starts in 10 px cells').toBe(10);
    expect(lastStep()[2].rounds).toBe(FOG.rounds);
    /* The frames cost three times the budget: the page's mean is over it. */
    for (let i = 0; i < 12; i++) { spend('x:0', 1000 + i, FOG_BUDGET_MS * 3); spend('x:0', 1000 + i, 0); }
    pass(48);
    const stepped = vi.mocked(stepField).mock.calls.length;
    pass(100);
    expect(vi.mocked(stepField).mock.calls.length, 'no field is stepped at the last rung').toBe(stepped);
    expect(canvases(document.body).length, 'and it is still drawn').toBeGreaterThan(0);
  });

  test('a puff that stepped down leaves the page at that rung, so the next one starts there and is not over the budget again until its first judgment', () => {
    const first = setup();
    pass(PUFF.billowMs + 100);
    for (let i = 0; i < 12; i++) { spend('x:0', 1000 + i, FOG_BUDGET_MS * 3); spend('x:0', 1000 + i, 0); }
    pass(48);
    act(() => { vi.advanceTimersByTime(TOTAL + 50); });
    expect(first.done).toHaveBeenCalledTimes(1);
    first.unmount();
    vi.mocked(stepField).mockClear();
    vi.mocked(emptyField).mockClear();
    setup();
    pass(PUFF.billowMs + 100);
    expect(vi.mocked(stepField).mock.calls.length, 'the new puff is at the last rung, drawn with no field').toBe(0);
  });

  test('the owner-approved smoothing is kept at the rungs that draw the fog from a field of cells, and the last two, which are for a slow device, scale it with the cheaper filter', () => {
    setup();
    pass(PUFF.billowMs + 100);
    const qualities = () => canvases(document.body).flatMap((c) => rects.get(c)?.quality ?? []);
    expect(new Set(qualities()), 'at its start rung').toEqual(new Set(['high']));
    forceFogLevel(3);
    pass(100);
    expect(qualities().slice(-1)[0], 'at rung 3').toBe('low');
  });

  test('a field made again at another rung starts from the puff as it stands, not empty', () => {
    setup();
    pass(PUFF.billowMs + 100);
    vi.mocked(emptyField).mockClear();
    forceFogLevel(0);
    pass(50);
    const again = vi.mocked(emptyField).mock.calls.at(-1);
    expect(again, 'a field was made again').toBeDefined();
    expect(again![2], 'at the new cell').toBe(5);
    expect(again![3]!.seed, 'seeded from the front').toBeTypeOf('function');
    expect(again![3]!.seed!(300, 200), 'whole inside it').toBe(1);
  });
});
