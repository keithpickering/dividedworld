/**
 * tiles.ts, the layer (docs/plans/2026-11-16-effect-tiles-design.md, sections 2, 4 and 5): a canvas effect hands the layer a painter and the layer
 * finds the box, cuts it into tiles, holds a canvas only for the tiles near the view, and runs the frames. jsdom has no layout, no canvas and no
 * observers, so the test stubs what the layer reads: `getBoundingClientRect` and the `client*` sizes of the host and of a `.kb-act-main` body,
 * `getContext` (a recording context), `requestAnimationFrame` (a queue the test flushes as one frame), `ResizeObserver` and
 * `IntersectionObserver` (as bands.test.tsx fakes it). The view is the window's `innerHeight` and the host's top.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bandsOf } from './bands.ts';
import { MAX_TILE_PIXELS, TILE_NEAR_PX, TILE_PX, makeTileLayer, mostTiles, nearTiles, tileDensity, type TileDraw, type TileLayer, type TileLayerOptions } from './tiles.ts';

/* ---- the stubs ---- */

type FakeIO = { cb: IntersectionObserverCallback };
let observers: FakeIO[] = [];
class FakeObserver {
  readonly entry: FakeIO;
  constructor(cb: IntersectionObserverCallback) { this.entry = { cb }; observers.push(this.entry); }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

let resizers: FakeResize[] = [];
class FakeResize {
  disconnected = false;
  readonly seen = new Set<Element>();
  constructor(readonly cb: ResizeObserverCallback) { resizers.push(this); }
  observe(el: Element) { this.seen.add(el); }
  unobserve(el: Element) { this.seen.delete(el); }
  disconnect() { this.disconnected = true; this.seen.clear(); }
}
/** Delivers a ResizeObserver report to every observer that has not been disconnected. */
const fireResize = () => { for (const r of resizers) if (!r.disconnected) r.cb([], r as unknown as ResizeObserver); };

let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
/** Runs the frame callbacks queued so far, as one frame at time `t`; what they queue waits for the next. */
const flush = (t = 16) => { const run = [...queue.values()]; queue.clear(); for (const f of run) f(t); };

/** A recording context: each call is a string, and the canvas keeps one context. */
type Ctx = CanvasRenderingContext2D & { calls: string[] };
const contexts = new WeakMap<HTMLCanvasElement, Ctx>();
function fakeContext(): Ctx {
  const calls: string[] = [];
  const rec = (name: string) => (...args: unknown[]) => { calls.push(`${name}(${args.join(',')})`); };
  return { calls, setTransform: rec('setTransform'), clearRect: rec('clearRect'), save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'), rect: rec('rect'), clip: rec('clip'), fillRect: rec('fillRect') } as unknown as Ctx;
}

/** The layout the test sets: the host's rect and the body's (or none: an effect painting only its host). */
interface Layout { host: { left: number; top: number; width: number; height: number }; body: { left: number; top: number; w: number; h: number } | null }
let layout: Layout;

function scene(): { host: HTMLElement; body: HTMLElement | null } {
  const host = document.createElement('div');
  host.getBoundingClientRect = () => { const h = layout.host; return { left: h.left, top: h.top, width: h.width, height: h.height, right: h.left + h.width, bottom: h.top + h.height, x: h.left, y: h.top, toJSON() {} }; };
  if (!layout.body) { document.body.appendChild(host); return { host, body: null }; }
  const body = document.createElement('div');
  body.className = 'kb-act-main';
  body.setAttribute('data-kb-content-area', '');
  body.getBoundingClientRect = () => { const b = layout.body!; return { left: b.left, top: b.top, width: b.w, height: b.h, right: b.left + b.w, bottom: b.top + b.h, x: b.left, y: b.top, toJSON() {} }; };
  for (const [k, f] of [['clientLeft', () => 0], ['clientTop', () => 0], ['clientWidth', () => layout.body!.w], ['clientHeight', () => layout.body!.h]] as const) Object.defineProperty(body, k, { get: f, configurable: true });
  body.appendChild(host);
  document.body.appendChild(body);
  return { host, body };
}

const open: TileLayer[] = [];
let painted: TileDraw[] = [];
/** Makes a layer on a fresh scene, painting into `painted`; every layer is stopped after the test. */
function make(over: Partial<TileLayerOptions> = {}): { layer: TileLayer; host: HTMLElement; body: HTMLElement | null } {
  const s = scene();
  const layer = makeTileLayer(s.host, { place: 'thread', paint: (d) => painted.push(d), ...over });
  open.push(layer);
  return { layer, ...s };
}
/** Scrolls the page so the host's top is `view` px above the window's: the body moves with it, so the box's place in the host stays. */
const scrollTo = (view: number) => { const was = layout.body ? layout.body.top - layout.host.top : 0; layout.host.top = -view; if (layout.body) layout.body.top = -view + was; };
const tall = (h: number, over: Partial<Layout> = {}) => { layout = { host: { left: 0, top: 0, width: 400, height: h + 40 }, body: { left: 10, top: 20, w: 300, h }, ...over }; };

/** Stand-ins' places, and the observer told which are near (indexes of the host's bands). */
const bandEls = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(':scope > .kb-band')];
const report = (host: HTMLElement, near: number[]) => {
  const els = bandEls(host);
  observers[0]!.cb(els.map((target, i) => ({ target, isIntersecting: near.includes(i), intersectionRatio: near.includes(i) ? 1 : 0 }) as unknown as IntersectionObserverEntry), {} as IntersectionObserver);
};
const canvases = (host: HTMLElement) => [...host.querySelectorAll<HTMLCanvasElement>(':scope > canvas')];
const indexes = (layer: TileLayer) => layer.held().map((t) => t.index);

beforeEach(() => {
  observers = []; resizers = []; queue = new Map(); nextId = 1; painted = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('ResizeObserver', FakeResize);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { queue.set(nextId, f); return nextId++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('devicePixelRatio', 2);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let c = contexts.get(this);
    if (!c) { c = fakeContext(); contexts.set(this, c); }
    return c as unknown as RenderingContext;
  } as never);
  tall(3000);
});
afterEach(() => { for (const l of open.splice(0)) l.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

/* ---- the box ---- */

describe('the box', () => {
  test('in the thread it is the body\'s padding box from the host\'s corner, elsewhere the host\'s own, and onBox is told at once', () => {
    const told: [unknown, unknown][] = [];
    const a = make({ onBox: (b, body) => told.push([b, body]) });
    expect(told).toEqual([[{ left: 10, top: 20, w: 300, h: 3000 }, a.body]]);

    layout = { host: { left: 0, top: 0, width: 400, height: 900 }, body: null };
    const own: unknown[] = [];
    make({ onBox: (b, body) => own.push([b, body]) });
    expect(own).toEqual([[{ left: 0, top: 0, w: 400, h: 900 }, null]]);
  });

  test('onBox is told again when a ResizeObserver report changes the box, and not when it changes nothing', () => {
    const told: unknown[] = [];
    make({ onBox: (b) => told.push(b) });
    fireResize();
    expect(told).toHaveLength(1);
    layout.body!.h = 3500;
    fireResize();
    expect(told).toHaveLength(2);
    expect(told[1]).toEqual({ left: 10, top: 20, w: 300, h: 3500 });
    layout.body!.h = 3500.004;
    fireResize();
    expect(told).toHaveLength(2);
  });
});

/* ---- the first tiles ---- */

describe('the first tiles', () => {
  test('are the ones nearTiles names for the box and the window, held and painted before makeTileLayer returns, with no frame and no report', () => {
    const { layer } = make();
    expect(indexes(layer)).toEqual(nearTiles(3000, -20, 780));
    expect(indexes(layer)).toEqual([0, 1, 2]);
    expect(painted.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(painted.every((d) => d.frame === null)).toBe(true);
  });

  test('a box wholly out of view holds none', () => {
    scrollTo(-5000);
    const { layer, host } = make();
    expect(layer.held()).toEqual([]);
    expect(painted).toEqual([]);
    expect(canvases(host)).toEqual([]);
  });
});

/* ---- a held tile's canvas ---- */

describe('a held tile\'s canvas', () => {
  test('is ceil(w * d) by ceil(h * d), placed inline at the tile\'s offset in the box, hidden, marked as ink, classed, and takes no pointer', () => {
    tall(1300);
    const { host, layer } = make({ className: 'ink' });
    const cs = canvases(host);
    expect(cs).toHaveLength(3);
    const d = tileDensity(300, 2);
    expect([cs[0]!.width, cs[0]!.height]).toEqual([Math.ceil(300 * d), Math.ceil(512 * d)]);
    expect([cs[2]!.width, cs[2]!.height]).toEqual([Math.ceil(300 * d), Math.ceil(276 * d)]);
    expect(cs[1]!.style.left).toBe('10px');
    expect(cs[1]!.style.top).toBe('532px');
    expect(cs[1]!.style.width).toBe('300px');
    expect(cs[1]!.style.height).toBe('512px');
    expect(cs[2]!.style.height).toBe('276px');
    expect(cs[1]!.style.pointerEvents).toBe('none');
    expect(cs[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(cs[1]!.hasAttribute('data-kb-effect-ink')).toBe(true);
    expect(cs[1]!.classList.contains('ink')).toBe(true);
    expect(layer.held().map((t) => [t.index, t.top, t.h, t.density])).toEqual([[0, 0, 512, 2], [1, 512, 512, 2], [2, 1024, 276, 2]]);
  });

  test('with sheets: 2 a tile holds two, lowest first, and the painter is called for each', () => {
    tall(1300);
    const { host, layer } = make({ sheets: 2 });
    const t = layer.held()[1]!;
    expect(t.sheets).toHaveLength(2);
    expect(canvases(host)).toHaveLength(6);
    expect(t.sheets[0]!.compareDocumentPosition(t.sheets[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(painted.filter((d) => d.index === 1).map((d) => d.sheet)).toEqual([0, 1]);
  });
});

describe('the painter\'s context', () => {
  test('has been given setTransform(d, 0, 0, d, 0, -top * d) and a clip to the tile\'s rows, in that order, so a painter that fills the whole box fills only the tile', () => {
    const logs: Record<number, string[]> = {};
    const drawn: Record<number, TileDraw> = {};
    make({ paint: (d) => { drawn[d.index] = d; logs[d.index] = [...(d.ctx as Ctx).calls]; d.ctx.fillRect(0, 0, d.box.w, d.box.h); } });
    const log = logs[1]!;
    const move = log.indexOf('setTransform(2,0,0,2,0,-1024)');
    const rect = log.indexOf('rect(0,512,300,512)');
    const clip = log.indexOf('clip()');
    expect(move).toBeGreaterThanOrEqual(0);
    expect(rect).toBeGreaterThan(move);
    expect(clip).toBeGreaterThan(rect);
    expect(logs[2]).toContain('rect(0,1024,300,512)');
    const given = drawn[1]!;
    expect(given.box).toEqual({ w: 300, h: 3000 });
    expect(given.density).toBe(2);
    expect([given.top, given.h]).toEqual([512, 512]);
  });
});

/* ---- holding and releasing ---- */

describe('holding and releasing', () => {
  test('a tile the watcher reports gone is sized 0 by 0 and removed; one reported new is made and painted in the next frame', () => {
    const { layer, host } = make();
    const gone = layer.held()[0]!.sheets[0]!;
    painted = [];
    report(host, [1, 2, 3]);
    flush(33);
    expect(indexes(layer)).toEqual([1, 2, 3]);
    expect([gone.width, gone.height]).toEqual([0, 0]);
    expect(gone.isConnected).toBe(false);
    expect(canvases(host)).toHaveLength(3);
    expect(painted).toEqual([]);
    flush(50);
    expect(painted.map((d) => [d.index, d.frame])).toEqual([[3, 50]]);
    flush(66);
    expect(painted).toHaveLength(1);
  });

  test('no canvas of the layer is ever over MAX_TILE_PIXELS and never more than mostTiles are held, over a box 1,200 by 40,000 walked top to bottom at a screen density of 2 and of 3', () => {
    const nearView = (view: number) => bandsOf(40000, TILE_PX).flatMap((b, i) => (b.top + b.h >= view - 20 - TILE_NEAR_PX && b.top <= view - 20 + 800 + TILE_NEAR_PX ? [i] : []));
    for (const screen of [2, 3]) {
      vi.stubGlobal('devicePixelRatio', screen);
      tall(40000, { body: { left: 0, top: 20, w: 1200, h: 40000 } });
      layout.body!.w = 1200;
      const { layer, host } = make();
      let widest = 0;
      for (let view = 0; view <= 40000; view += 400) {
        scrollTo(view);
        report(host, nearView(view));
        flush();
        flush();
        expect(layer.held().length).toBeLessThanOrEqual(mostTiles(800));
        for (const c of canvases(host)) { expect(c.width * c.height).toBeLessThanOrEqual(MAX_TILE_PIXELS); widest = Math.max(widest, c.width * c.height); }
        expect(canvases(host).length).toBe(layer.held().length);
      }
      expect(widest).toBe(MAX_TILE_PIXELS);
      layer.stop();
      expect(canvases(host)).toEqual([]);
    }
  });
});

describe('the stand-ins', () => {
  test('carry the standIn class and data-kb-tile="far" until the tile is painted, then "held", and "far" again when it is released', () => {
    const { layer, host } = make({ standIn: 'fog' });
    const els = bandEls(host);
    expect(els).toHaveLength(6);
    expect(els.every((e) => e.classList.contains('fog'))).toBe(true);
    expect(els.map((e) => e.getAttribute('data-kb-tile'))).toEqual(['held', 'held', 'held', 'far', 'far', 'far']);
    report(host, [1, 2, 3]);
    flush();
    expect(bandEls(host).map((e) => e.getAttribute('data-kb-tile'))).toEqual(['far', 'held', 'held', 'far', 'far', 'far']);
    flush();
    expect(bandEls(host).map((e) => e.getAttribute('data-kb-tile'))).toEqual(['far', 'held', 'held', 'held', 'far', 'far']);
    expect(indexes(layer)).toEqual([1, 2, 3]);
  });

  test('are as bands.ts leaves them where there is no standIn', () => {
    const { host } = make();
    for (const e of bandEls(host)) {
      expect(e.className).toBe('kb-band');
      expect(e.hasAttribute('data-kb-tile')).toBe(false);
    }
  });
});

/* ---- the two ways ---- */

describe('painting', () => {
  test('loop(true) paints every held tile every frame with the frame\'s time, and loop(false) stops it, leaving no frame pending', () => {
    const { layer } = make();
    painted = [];
    layer.loop(true);
    flush(100);
    expect(painted.map((d) => [d.index, d.frame])).toEqual([[0, 100], [1, 100], [2, 100]]);
    flush(116);
    expect(painted).toHaveLength(6);
    layer.loop(false);
    flush(132);
    expect(painted).toHaveLength(6);
    expect(queue.size).toBe(0);
  });

  test('an idle layer with nothing stale requests no frame', () => {
    make();
    flush();
    expect(queue.size).toBe(0);
  });

  test('stale({ top, bottom }) paints only the held tiles those rows cross, once, and stale() all of them', () => {
    const { layer } = make();
    flush();
    painted = [];
    layer.stale({ top: 600, bottom: 700 });
    expect(queue.size).toBe(1);
    flush(40);
    expect(painted.map((d) => [d.index, d.frame])).toEqual([[1, 40]]);
    flush(56);
    expect(painted).toHaveLength(1);
    expect(queue.size).toBe(0);
    layer.stale({ top: 500, bottom: 520 });
    flush(72);
    expect(painted.slice(1).map((d) => d.index)).toEqual([0, 1]);
    painted = [];
    layer.stale();
    flush(88);
    expect(painted.map((d) => d.index)).toEqual([0, 1, 2]);
  });

  test('paintNow paints every held tile at once, outside a frame, and asks for none', () => {
    const { layer } = make();
    flush();
    painted = [];
    layer.paintNow();
    expect(painted.map((d) => [d.index, d.frame])).toEqual([[0, null], [1, null], [2, null]]);
    expect(queue.size).toBe(0);
  });
});

/* ---- a changing box ---- */

describe('a resize', () => {
  test('that changes the box re-places and repaints the held tiles and re-cuts the bands', () => {
    const { layer, host } = make();
    expect(bandEls(host)).toHaveLength(6);
    painted = [];
    layout.body!.h = 1300;
    fireResize();
    expect(bandEls(host)).toHaveLength(3);
    expect(painted.map((d) => [d.index, d.frame, d.box.h])).toEqual([[0, null, 1300], [1, null, 1300], [2, null, 1300]]);
    const last = layer.held()[2]!;
    expect([last.h, last.sheets[0]!.height, last.sheets[0]!.style.height]).toEqual([276, 552, '276px']);
  });

  test('that changes only the box\'s offset re-places and does not repaint', () => {
    const { host } = make();
    painted = [];
    layout.body!.left = 30;
    layout.body!.top = 50;
    fireResize();
    expect(painted).toEqual([]);
    for (const c of canvases(host)) expect(c.style.left).toBe('30px');
    expect(canvases(host)[1]!.style.top).toBe('562px');
    for (const e of bandEls(host)) expect(e.style.left).toBe('30px');
  });
});

describe('stop', () => {
  test('releases every canvas, removes the stand-ins, stops the observers and leaves no frame pending; a late report does nothing', () => {
    const told: unknown[] = [];
    const { layer, host } = make({ standIn: 'fog', onBox: (b) => told.push(b) });
    const cs = canvases(host);
    layer.loop(true);
    painted = [];
    layer.stop();
    for (const c of cs) { expect([c.width, c.height]).toEqual([0, 0]); expect(c.isConnected).toBe(false); }
    expect(bandEls(host)).toEqual([]);
    expect(resizers.every((r) => r.disconnected)).toBe(true);
    expect(queue.size).toBe(0);
    layer.stop();
    layout.body!.h = 900;
    fireResize();
    report(host, [0, 1]);
    flush();
    flush();
    expect(told).toHaveLength(1);
    expect(painted).toEqual([]);
    expect(host.children).toHaveLength(0);
    expect(layer.held()).toEqual([]);
  });
});

describe('where there is no IntersectionObserver', () => {
  test('every tile counts as near to the watcher, and the layer holds only the tiles nearTiles names from the window, on each scroll frame', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    tall(40000);
    const { layer, host } = make();
    expect(indexes(layer)).toEqual([0, 1, 2]);
    flush();
    flush();
    expect(indexes(layer)).toEqual([0, 1, 2]);
    expect(bandEls(host)).toHaveLength(79);

    scrollTo(20000);
    painted = [];
    window.dispatchEvent(new Event('scroll'));
    expect(queue.size).toBe(1);
    flush(200);
    const want = nearTiles(40000, 19980, 20780);
    expect(indexes(layer)).toEqual(want);
    expect(want.length).toBeLessThanOrEqual(mostTiles(800));
    expect(canvases(host)).toHaveLength(want.length);
    expect(painted.map((d) => [d.index, d.frame])).toEqual(want.map((i) => [i, 200]));
    flush(216);
    expect(queue.size).toBe(0);
  });
});
