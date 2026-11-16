/**
 * tileLoop.ts (docs/plans/2026-11-16-effect-tiles-design.md, section 4): one requestAnimationFrame serves every tile layer on the page and stops
 * when no layer wants a frame, so an idle page costs nothing. The members here are stand-ins for layers: each is asked for a frame at the frame's
 * time and says whether it wants another. `requestAnimationFrame` is a queue the test flushes as one frame, and `performance.now` is stubbed so
 * the loop's own time in a frame is a number the test chose.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forget, join, probe, want, type LoopMember } from './tileLoop.ts';

let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
/** Runs the frame callbacks queued so far, as one frame at time `t`; what they queue waits for the next. */
const flush = (t = 16) => { const run = [...queue.values()]; queue.clear(); for (const f of run) f(t); };

/** A member that records the times it was served at, wants another frame while `more` is true, and holds `px` canvas px. */
function member(over: { more?: boolean; px?: number; during?: () => void } = {}): LoopMember & { seen: number[]; more: boolean; px: number } {
  const m = {
    seen: [] as number[], more: over.more ?? false, px: over.px ?? 0,
    frame(t: number) { m.seen.push(t); over.during?.(); return m.more; },
    pixels: () => m.px,
  };
  return m;
}

beforeEach(() => {
  queue = new Map(); nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { queue.set(nextId, f); return nextId++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
});
afterEach(() => { probe.reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the frame schedule', () => {
  test('two layers, one looping and one with a stale tile, are served by one requestAnimationFrame a frame', () => {
    const looping = member({ more: true });
    const stale = member();
    join(looping); join(stale);
    want(looping); want(stale);
    expect(queue.size).toBe(1);
    flush(10);
    expect(looping.seen).toEqual([10]);
    expect(stale.seen).toEqual([10]);
    expect(queue.size).toBe(1);
    flush(26);
    expect(looping.seen).toEqual([10, 26]);
    expect(stale.seen).toEqual([10]);
    expect(queue.size).toBe(1);
  });

  test('when neither wants a frame none is pending', () => {
    const a = member(), b = member();
    join(a); join(b);
    expect(queue.size).toBe(0);
    want(a); want(b);
    flush();
    expect(queue.size).toBe(0);
    expect(probe.running()).toBe(false);
  });

  test('a layer that asks for a frame during a frame is served in the next, not the same', () => {
    const late = member();
    const early = member({ during: () => { if (early.seen.length === 1) want(late); } });
    join(early); join(late);
    want(early);
    flush(10);
    expect(late.seen).toEqual([]);
    expect(queue.size).toBe(1);
    flush(26);
    expect(late.seen).toEqual([26]);
    expect(queue.size).toBe(0);
  });

  test('a layer asked twice before a frame is served once', () => {
    const a = member();
    join(a);
    want(a); want(a);
    flush();
    expect(a.seen).toHaveLength(1);
  });

  test('a layer that is forgotten is never served again, and the last one forgotten leaves no frame pending', () => {
    const a = member({ more: true }), b = member({ more: true });
    join(a); join(b);
    want(a); want(b);
    flush(1);
    forget(a);
    flush(2);
    expect(a.seen).toEqual([1]);
    expect(b.seen).toEqual([1, 2]);
    forget(b);
    expect(queue.size).toBe(0);
    expect(probe.running()).toBe(false);
  });

  test('a layer that throws costs only itself its frame', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = { frame: () => { throw new Error('no'); }, pixels: () => 0 };
    const good = member({ more: true });
    join(bad); join(good);
    want(bad); want(good);
    flush(1);
    flush(2);
    expect(good.seen).toEqual([1, 2]);
  });
});

describe('the probe', () => {
  test('work() returns the loop\'s own time in the last frames: the two reads of performance.now around the step, a ring of 600', () => {
    const a = member({ more: true });
    join(a);
    want(a);
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    a.frame = (t: number) => { a.seen.push(t); clock += 3; return true; };
    for (let i = 0; i < 3; i++) { clock += 100; flush(i); }
    expect(probe.frames()).toBe(3);
    expect(probe.work()).toEqual([3, 3, 3]);
    let cost = 0;
    a.frame = () => { clock += ++cost; return true; };
    for (let i = 0; i < 700; i++) flush(i);
    expect(probe.frames()).toBe(703);
    const all = probe.work();
    expect(all).toHaveLength(600);
    expect(all[0]).toBe(101);
    expect(all[599]).toBe(700);
    expect(probe.work(2)).toEqual([699, 700]);
  });

  test('held() is the canvas px every registered layer holds, by layer, in the order they joined', () => {
    const a = member({ px: 2_457_600 }), b = member({ px: 0 }), c = member({ px: 300 });
    join(a); join(b); join(c);
    expect(probe.held()).toEqual([2_457_600, 0, 300]);
    c.px = 1_000;
    forget(b);
    expect(probe.held()).toEqual([2_457_600, 1_000]);
  });

  test('reset() forgets every layer, cancels the pending frame and clears the count', () => {
    const a = member({ more: true });
    join(a); want(a);
    flush();
    expect(probe.frames()).toBe(1);
    probe.reset();
    expect(queue.size).toBe(0);
    expect(probe.held()).toEqual([]);
    expect(probe.frames()).toBe(0);
    expect(probe.work()).toEqual([]);
  });
});
