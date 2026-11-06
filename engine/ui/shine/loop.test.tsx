/* A .test.tsx because the loop reads the DOM (rects, IntersectionObserver, rAF) and needs jsdom; `test:engine` runs .test.ts under plain node. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { light, lightAt, REST } from './light.ts';
import { setTiltPreference, tiltState } from './tilt.ts';
import { probe, register, unregister, wake, watchShinyInView, type ShineFrame } from './loop.ts';

/* A fake rAF: frames run only when the test flushes one, at the time it names. */
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
let asked = 0;
const flush = (t: number) => {
  const run = [...queue.values()];
  queue.clear();
  for (const cb of run) cb(t);
};
const frames = (n: number, from = 0, step = 16) => { for (let i = 1; i <= n; i++) flush(from + i * step); };

/* A fake IntersectionObserver the test drives by hand. */
let observers: FakeObserver[] = [];
class FakeObserver {
  readonly seen = new Set<Element>();
  constructor(readonly cb: IntersectionObserverCallback) { observers.push(this); }
  observe(el: Element) { this.seen.add(el); }
  unobserve(el: Element) { this.seen.delete(el); }
  disconnect() { this.seen.clear(); }
  takeRecords() { return []; }
}
const see = (el: Element, isIntersecting: boolean) => {
  for (const o of observers) if (o.seen.has(el)) o.cb([{ target: el, isIntersecting } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
};

const canvas = () => document.createElement('canvas');
const BOX = { w: 100, h: 50 };
const still = () => document.documentElement.setAttribute('data-kb-motion', 'reduce');
const shimmer = () => document.documentElement.setAttribute('data-kb-motion', 'full');

beforeEach(() => {
  queue = new Map(); nextId = 1; asked = 0; observers = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { asked++; const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
});
afterEach(() => {
  probe.reset();
  light.reset();
  document.documentElement.removeAttribute('data-kb-motion');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the loop and the tilt probe', () => {
  it('a shiny page runs the probe while a host is registered, and lets it go with the last one', () => {
    vi.useFakeTimers();
    vi.stubGlobal('DeviceOrientationEvent', function DeviceOrientationEvent() {});
    try {
      setTiltPreference('on');
      expect(vi.getTimerCount()).toBe(0);
      const a = {}, b = {};
      register(a, canvas(), BOX, 1, () => false);
      expect(vi.getTimerCount()).toBe(1);
      register(b, canvas(), BOX, 1, () => false);
      unregister(a);
      expect(vi.getTimerCount()).toBe(1);
      unregister(b);
      expect(vi.getTimerCount()).toBe(0);
      register(a, canvas(), BOX, 1, () => false);
      vi.advanceTimersByTime(1100);
      expect(tiltState()).toBe('unsupported');
      probe.reset();
    } finally { setTiltPreference('off'); vi.useRealTimers(); }
  });
});

describe('the shine loop', () => {
  it('asks for no frame while no host is in view', () => {
    shimmer();
    const c = canvas();
    register({}, c, BOX, 1, () => false);
    expect(asked).toBe(0);
    expect(probe.running()).toBe(false);
    see(c, false);
    expect(asked).toBe(0);
  });

  it('draws a still light once and stops the loop', () => {
    still();
    const host = {}, c = canvas(), seen: ShineFrame[] = [];
    register(host, c, BOX, 1, (f) => { seen.push(f); return false; });
    see(c, true);
    expect(probe.running()).toBe(true);
    frames(5);
    expect(seen).toHaveLength(1);
    expect(probe.draws(host)).toBe(1);
    expect(seen[0]!.moved).toBe(true);
    expect(probe.running()).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('keeps the loop running under shimmer, drawing about every second frame', () => {
    shimmer();
    const host = {}, c = canvas(), seen: ShineFrame[] = [];
    register(host, c, BOX, 1, (f) => { seen.push(f); return false; });
    see(c, true);
    frames(20);
    expect(probe.running()).toBe(true);
    expect(probe.frames()).toBe(20);
    expect(probe.draws(host)).toBeGreaterThanOrEqual(9);
    expect(probe.draws(host)).toBeLessThanOrEqual(12);
    expect(seen.some((f) => f.idle)).toBe(true);
  });

  it('draws every frame while the host reports something in flight, then settles', () => {
    still();
    const host = {}, c = canvas();
    let left = 6;
    register(host, c, BOX, 1, () => --left > 0);
    see(c, true);
    frames(10);
    expect(probe.draws(host)).toBe(6);
    expect(probe.running()).toBe(false);
    wake(host);
    expect(probe.running()).toBe(true);
    frames(2, 1000);
    expect(probe.draws(host)).toBe(7);
  });

  it('a host whose draw throws does not stop the others, or the loop', () => {
    shimmer();
    const bad = {}, good = {}, cb = canvas(), cg = canvas();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    register(bad, cb, BOX, 1, () => { throw new Error('boom'); });
    register(good, cg, BOX, 1, () => false);
    see(cb, true); see(cg, true);
    frames(6);
    expect(err).toHaveBeenCalled();
    expect(probe.draws(bad)).toBeGreaterThan(1);
    expect(probe.draws(good)).toBeGreaterThan(1);
    expect(probe.running()).toBe(true);
  });

  it('unregister mid-frame is safe: the host is not drawn again, and neither is one dropped before its turn', () => {
    shimmer();
    const a = {}, b = {}, ca = canvas(), cb = canvas();
    let bDraws = 0;
    let aDraws = 0;
    register(a, ca, BOX, 1, () => { aDraws++; unregister(b); unregister(a); return false; });
    register(b, cb, BOX, 1, () => { bDraws++; return false; });
    see(ca, true); see(cb, true);
    expect(() => frames(4)).not.toThrow();
    expect(bDraws).toBe(0);
    /* a drew once, in the frame that unregistered it, and never again: its own count (probe.draws is 0 for any unregistered host). */
    expect(aDraws).toBe(1);
    expect(probe.running()).toBe(false);
  });

  it('a host out of view is not drawn and is told once; back in view it draws again', () => {
    shimmer();
    const host = {}, c = canvas();
    const hidden = vi.fn();
    register(host, c, BOX, 1, () => false, { hidden });
    see(c, true);
    frames(4);
    const before = probe.draws(host);
    see(c, false);
    expect(hidden).toHaveBeenCalledTimes(1);
    frames(6, 100);
    expect(probe.draws(host)).toBe(before);
    expect(probe.running()).toBe(false);
    see(c, true);
    frames(1, 200);
    expect(probe.draws(host)).toBe(before + 1);
  });

  it('caps density at 2, attaches the light on register and detaches it on unregister', () => {
    const add = vi.spyOn(window, 'addEventListener'), rem = vi.spyOn(window, 'removeEventListener');
    const host = {};
    expect(register(host, canvas(), BOX, 3, () => false)).toBe(2);
    expect(register(host, canvas(), BOX, 1.5, () => false)).toBe(1.5);
    expect(add.mock.calls.some((x) => x[0] === 'pointermove')).toBe(true);
    unregister(host);
    expect(rem.mock.calls.some((x) => x[0] === 'pointermove')).toBe(true);
  });

  it('probe.work() records the loop\'s own time in each frame, the last 600, oldest first', () => {
    shimmer();
    let now = 0, k = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const host = {}, c = canvas();
    /* A draw that returns true is in flight, so it is drawn in every frame; frame k's draw takes k ms of the clock. */
    register(host, c, BOX, 1, () => { now += k; return true; });
    see(c, true);
    const run = (frame: number) => { k = frame; flush(frame * 16); };
    for (let i = 1; i <= 5; i++) run(i);
    expect(probe.work()).toEqual([1, 2, 3, 4, 5]);
    expect(probe.work(2)).toEqual([4, 5]);
    for (let i = 6; i <= 700; i++) run(i);
    const w = probe.work();
    expect(w).toHaveLength(600);
    expect(w[0]).toBe(101);
    expect(w[599]).toBe(700);
    probe.reset();
    expect(probe.work()).toEqual([]);
    clock.mockRestore();
  });

  it('probe.reset() returns a fresh page', () => {
    shimmer();
    const host = {}, c = canvas();
    register(host, c, BOX, 1, () => false);
    see(c, true);
    frames(3);
    expect(probe.running()).toBe(true);
    probe.reset();
    expect(probe.running()).toBe(false);
    expect(probe.frames()).toBe(0);
    expect(probe.draws(host)).toBe(0);
    expect(queue.size).toBe(0);
    expect(observers.every((o) => o.seen.size === 0)).toBe(true);
  });

  /* MutationObserver delivers in a microtask. */
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));

  it('reduced motion turned off at runtime restarts a stopped loop, with the host still in view', async () => {
    still();
    const host = {}, c = canvas(), seen: ShineFrame[] = [];
    register(host, c, BOX, 1, (f) => { seen.push(f); return false; });
    see(c, true);
    frames(5);
    expect(probe.running()).toBe(false);
    const before = probe.draws(host);
    shimmer();
    await settle();
    expect(probe.running()).toBe(true);
    frames(10, 1000);
    expect(probe.draws(host)).toBeGreaterThan(before + 3);
    expect(seen.some((f) => f.idle)).toBe(true);
  });

  it('reduced motion turned on mid-session redraws once at REST, then the loop stops', async () => {
    shimmer();
    const host = {}, c = canvas(), seen: ShineFrame[] = [];
    register(host, c, BOX, 1, (f) => { seen.push(f); return false; });
    see(c, true);
    frames(8);
    expect(probe.running()).toBe(true);
    const before = probe.draws(host);
    still();
    await settle();
    frames(6, 1000);
    expect(probe.draws(host)).toBe(before + 1);
    expect(seen.at(-1)!.light).toEqual(REST);
    expect(probe.running()).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('stops listening for motion changes when the last host unregisters, and on reset', () => {
    const watch = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const a = {}, b = {};
    register(a, canvas(), BOX, 1, () => false);
    register(b, canvas(), BOX, 1, () => false);
    unregister(a);
    expect(watch).not.toHaveBeenCalled();
    unregister(b);
    expect(watch).toHaveBeenCalledTimes(1);
    register(a, canvas(), BOX, 1, () => false);
    probe.reset();
    expect(watch).toHaveBeenCalledTimes(2);
  });

  it('a light change under 0.004 skips a non-idle frame; one over it draws', () => {
    /* Idle draws land only on even frames, so an odd frame is a non-idle one: it draws only if the eased light moved by
       more than MOVED. The host's rect (its scroll place) is what moves the light, and the test sets it by hand. With
       the rect still, drift moves the light under 0.003 a frame, so odd frames must skip. */
    shimmer();
    let top = 300;
    const host = {}, c = canvas(), seen: { f: ShineFrame; n: number }[] = [];
    c.getBoundingClientRect = () => ({ top, height: 50, left: 0, width: 100, bottom: top + 50, right: 100, x: 0, y: top, toJSON: () => ({}) });
    register(host, c, BOX, 1, (f) => { seen.push({ f, n: probe.frames() }); return false; });
    see(c, true);
    let t = 0;
    const tick = () => flush((t += 16));
    for (let i = 0; i < 400; i++) tick();
    expect(seen[0]!.n).toBe(1);
    expect(seen.slice(1).every((s) => s.f.idle && !s.f.moved && s.n % 2 === 0)).toBe(true);

    /* Measured: the idle drift's largest single-frame step at 16ms frames is about 0.002 and the eased light follows it
       more softly, so every odd frame sits under MOVED = 0.004 with 2x to spare. A MOVED of 0.003 could not be told apart
       here: drift alone reaches 0.002, and a rect step is the only thing that crosses (the cases below). */
    let worst = 0;
    for (let k = 1; k <= 400; k++) {
      const a = lightAt(light.input(), { top: 300, height: 50 }, { height: window.innerHeight }, k * 16, 0);
      const b = lightAt(light.input(), { top: 300, height: 50 }, { height: window.innerHeight }, (k + 1) * 16, 0);
      worst = Math.max(worst, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
    }
    expect(worst).toBeGreaterThan(0.0015);
    expect(worst).toBeLessThan(0.0025);
    top += 0.1; /* about 0.0001 of light once eased: under MOVED */
    const small = seen.length;
    for (let i = 0; i < 6; i++) tick();
    expect(seen.slice(small).every((s) => s.f.idle && s.n % 2 === 0)).toBe(true);

    while (probe.frames() % 2 === 1) tick(); /* the next frame to run is an odd one */
    top += 100; /* about 0.06 of light once eased: over MOVED */
    const big = seen.length;
    tick();
    expect(seen).toHaveLength(big + 1);
    expect(seen[big]!.f.moved).toBe(true);
    expect(seen[big]!.f.idle).toBe(false);
    expect(seen[big]!.n % 2).toBe(1);
  });

  it('a light still easing toward its target keeps the loop alive until it settles, then stops', () => {
    /* Shimmer first, so the host's eased light sits away from REST; then reduced motion is switched on and the frames
       run before the MutationObserver's microtask, so no reset happens: the target is REST, the eased light is not,
       and nothing but `settling` asks for the next frame. */
    shimmer();
    let top = 600;
    const host = {}, c = canvas(), seen: ShineFrame[] = [];
    c.getBoundingClientRect = () => ({ top, height: 50, left: 0, width: 100, bottom: top + 50, right: 100, x: 0, y: top, toJSON: () => ({}) });
    register(host, c, BOX, 1, (f) => { seen.push(f); return false; });
    see(c, true);
    let t = 0;
    const tick = () => flush((t += 16));
    for (let i = 0; i < 6; i++) tick();
    expect(Math.abs(seen.at(-1)!.light.y - REST.y)).toBeGreaterThan(0.5);
    still();
    let n = 0;
    while (probe.running() && n < 200) { tick(); n++; }
    expect(n).toBeGreaterThan(10); /* eased over many frames, not one */
    expect(n).toBeLessThan(200);
    expect(probe.running()).toBe(false);
    const last = seen.at(-1)!.light;
    expect(Math.abs(last.x - REST.x) + Math.abs(last.y - REST.y)).toBeLessThan(0.002);
    const draws = probe.draws(host);
    for (let i = 0; i < 4; i++) tick();
    expect(probe.draws(host)).toBe(draws);
  });

  it('a host back in view starts from its own light now, not the one it eased to before it left', () => {
    shimmer();
    let top = 100;
    const host = {}, c = canvas(), seen: ShineFrame[] = [];
    c.getBoundingClientRect = () => ({ top, height: 50, left: 0, width: 100, bottom: top + 50, right: 100, x: 0, y: top, toJSON: () => ({}) });
    register(host, c, BOX, 1, (f) => { seen.push(f); return false; }, { phase: 0 });
    see(c, true);
    let t = 0;
    const tick = () => flush((t += 16));
    for (let i = 0; i < 6; i++) tick();
    see(c, false);
    top = 700;
    see(c, true);
    const before = seen.length;
    tick();
    expect(seen).toHaveLength(before + 1);
    const want = lightAt(light.input(), { top, height: 50 }, { height: window.innerHeight }, t, 0);
    expect(seen[before]!.light).toEqual(want);
  });

  it('reports the first registered host that is in view, and changes when that set changes', () => {
    const a = {}, b = {}, ca = canvas(), cb = canvas();
    const heard: (HTMLCanvasElement | null)[] = [];
    const stop = watchShinyInView((c) => heard.push(c));
    register(a, ca, BOX, 1, () => false);
    register(b, cb, BOX, 1, () => false);
    expect(heard).toEqual([null]); /* both registered, neither seen yet */
    see(cb, true);
    expect(heard.at(-1), 'the first registered host is out of view: the second is the one in view').toBe(cb);
    see(ca, true);
    expect(heard.at(-1), 'both in view: the first registered').toBe(ca);
    see(ca, false);
    expect(heard.at(-1)).toBe(cb);
    see(cb, false);
    expect(heard.at(-1)).toBeNull();
    stop();
    unregister(a); unregister(b);
  });
});
