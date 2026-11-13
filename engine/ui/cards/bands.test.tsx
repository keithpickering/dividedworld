/**
 * bands.ts (docs/plans/2026-11-12-whoops-followups-design.md, section 1): a tall box is cut into bands of a fixed height, one empty element
 * each, watched on one shared observer, and the page hears which bands are near, at most once a frame. The tests fake IntersectionObserver
 * as inView.test.tsx does, and requestAnimationFrame with a queue the test flushes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bandsOf, watchBands as watch } from './bands.ts';

type Fake = { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; seen: Set<Element>; disconnected: boolean };
let made: Fake[] = [];
class FakeObserver {
  readonly entry: Fake = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>(), disconnected: false };
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.entry.cb = cb; this.entry.opts = opts; made.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); this.entry.disconnected = true; }
  takeRecords() { return []; }
}

/** Every watcher made, stopped after each test: inView.ts keeps its observers across tests until the last element is unwatched. */
const open: { stop(): void }[] = [];
const watchBands: typeof watch = (...args) => { const w = watch(...args); open.push(w); return w; };

let frames: FrameRequestCallback[] = [];
/** Runs the frame callbacks queued so far, as one frame. */
const flush = () => { const run = frames; frames = []; for (const f of run) f(0); };
const mark = (els: Element[], on: boolean) => made[0]!.cb(els.map((target) => ({ target, isIntersecting: on, intersectionRatio: on ? 1 : 0 }) as unknown as IntersectionObserverEntry), {} as IntersectionObserver);

beforeEach(() => {
  made = []; frames = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { for (const w of open.splice(0)) w.stop(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

const box = (h: number) => ({ left: 5, top: 7, w: 300, h });

describe('bands', () => {
  test('bandsOf cuts a box top to bottom, the last band what is left, and a box of no height has none', () => {
    expect(bandsOf(1300, 512)).toEqual([{ top: 0, h: 512 }, { top: 512, h: 512 }, { top: 1024, h: 276 }]);
    expect(bandsOf(512, 512)).toEqual([{ top: 0, h: 512 }]);
    expect(bandsOf(0, 512)).toEqual([]);
  });

  test('a 20,000px box makes 40 placed elements on one shared observer, and marking 3 to 6 reports them once', () => {
    const host = document.createElement('div');
    const seen: number[][] = [];
    watchBands(host, box(20000), 500, '100% 0px', (near) => seen.push(near));
    const els = [...host.querySelectorAll<HTMLElement>('.kb-band')];
    expect(els).toHaveLength(40);
    expect(made).toHaveLength(1);
    expect(made[0]!.opts).toEqual({ rootMargin: '100% 0px' });
    expect(made[0]!.seen.size).toBe(40);
    expect(els[2]!.getAttribute('aria-hidden')).toBe('true');
    expect(els[2]!.style.cssText).toContain('position: absolute');
    expect(els[2]!.style.top).toBe('1007px');
    expect(els[2]!.style.left).toBe('5px');
    expect(els[2]!.style.width).toBe('300px');
    expect(els[2]!.style.height).toBe('500px');
    for (const el of els.slice(3, 7)) mark([el], true);
    expect(seen).toEqual([]);
    flush();
    expect(seen).toEqual([[3, 4, 5, 6]]);
    flush();
    expect(seen).toHaveLength(1);
  });

  test('the last band is placed as tall as what is left', () => {
    const host = document.createElement('div');
    watchBands(host, box(1300), 512, '0px', () => {});
    const els = host.querySelectorAll<HTMLElement>('.kb-band');
    expect(els[2]!.style.height).toBe('276px');
  });

  test('update with a shorter box removes the elements past it and reports a near set without them', () => {
    const host = document.createElement('div');
    const seen: number[][] = [];
    const w = watchBands(host, box(2000), 500, '0px', (near) => seen.push(near));
    const els = [...host.querySelectorAll<HTMLElement>('.kb-band')];
    mark(els.slice(1, 4), true);
    flush();
    expect(seen).toEqual([[1, 2, 3]]);
    w.update(box(1200));
    expect(host.querySelectorAll('.kb-band')).toHaveLength(3);
    expect(made[0]!.seen.size).toBe(3);
    flush();
    expect(seen).toEqual([[1, 2, 3], [1, 2]]);
    expect(host.querySelectorAll<HTMLElement>('.kb-band')[2]!.style.height).toBe('200px');
  });

  test('update with a taller box adds elements', () => {
    const host = document.createElement('div');
    const w = watchBands(host, box(500), 500, '0px', () => {});
    w.update(box(1500));
    expect(host.querySelectorAll('.kb-band')).toHaveLength(3);
    expect(made[0]!.seen.size).toBe(3);
  });

  test('stop removes every element and unobserves each, and a frame already asked for reports nothing', () => {
    const host = document.createElement('div');
    const seen: number[][] = [];
    const w = watchBands(host, box(1500), 500, '0px', (near) => seen.push(near));
    mark([...host.querySelectorAll('.kb-band')], true);
    w.stop();
    expect(host.querySelectorAll('.kb-band')).toHaveLength(0);
    expect(made[0]!.seen.size).toBe(0);
    flush();
    expect(seen).toEqual([]);
  });

  test('update after stop places nothing and watches nothing', () => {
    const host = document.createElement('div');
    const w = watchBands(host, box(1500), 500, '0px', () => {});
    w.stop();
    w.update(box(2500));
    expect(host.querySelectorAll('.kb-band')).toHaveLength(0);
    expect(made[0]!.seen.size).toBe(0);
  });

  test('a band takes no pointer events', () => {
    const host = document.createElement('div');
    watchBands(host, box(1500), 500, '0px', () => {});
    for (const el of host.querySelectorAll<HTMLElement>('.kb-band')) expect(el.style.pointerEvents).toBe('none');
  });

  test('nothing near is not reported at the start, and a near set that empties is reported as empty', () => {
    const host = document.createElement('div');
    const seen: number[][] = [];
    const w = watchBands(host, box(1500), 500, '0px', (near) => seen.push(near));
    flush();
    expect(seen).toEqual([]);
    const els = [...host.querySelectorAll('.kb-band')];
    mark([els[2]!], true);
    flush();
    expect(seen).toEqual([[2]]);
    w.update(box(1000));
    flush();
    expect(seen).toEqual([[2], []]);
    mark([els[0]!], true);
    flush();
    mark([els[0]!], false);
    flush();
    expect(seen).toEqual([[2], [], [0], []]);
  });

  test('with no IntersectionObserver every band is near', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const host = document.createElement('div');
    const seen: number[][] = [];
    watchBands(host, box(1500), 500, '0px', (near) => seen.push(near));
    flush();
    expect(seen).toEqual([[0, 1, 2]]);
    expect(made).toHaveLength(0);
  });
});
