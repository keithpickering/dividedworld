/**
 * The page's one watcher (docs/plans/2026-11-11-laugh-track-plan.md, Task 13), over a fake observer, fake frames and fake listeners, under
 * plain node: a place resting on the line for the dwell fires once and one flung past does not; the nearest place of a kind, on whichever
 * post, wins its kind's murmur; the page holds one observer, a scroll, a pointermove and a resize listener however many places it has; frames run only while something
 * moves or waits; and the loops stop when the last place of a kind goes.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { __inspect, forgetVoice, register, type PlaceSpec, type Voice } from './watch.ts';

type Rect = { top: number; bottom: number; left: number; right: number };
const rect = (top: number, bottom = top + 20): Rect => ({ top, bottom, left: 10, right: 90 });
interface FakeEl { rects: Rect[]; getClientRects(): Rect[] }
const el = (...rects: Rect[]): FakeEl => ({ rects, getClientRects() { return this.rects; } });

class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<unknown>();
  disconnected = false;
  readonly cb: (entries: { target: unknown; isIntersecting: boolean }[]) => void;
  readonly options: { rootMargin?: string };
  constructor(cb: (entries: { target: unknown; isIntersecting: boolean }[]) => void, options: { rootMargin?: string }) { this.cb = cb; this.options = options; FakeObserver.all.push(this); }
  observe(e: unknown) { this.observed.add(e); }
  unobserve(e: unknown) { this.observed.delete(e); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
  see(target: unknown, isIntersecting = true) { this.cb([{ target, isIntersecting }]); }
}

let frames: ((t: number) => void)[];
let fontSize = '16px';
let listeners: Map<string, Set<(e: unknown) => void>>;
const step = (t: number) => { const run = frames; frames = []; for (const f of run) f(t); };
const emit = (type: string, e: unknown = {}) => { for (const f of [...(listeners.get(type) ?? [])]) f(e); };
const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
const saved = { ...globalThis } as Record<string, unknown>;
/* Every registration a test makes is let go after it: the watcher is the page's, and the next test starts from an empty page. */
let registered: (() => void)[] = [];

beforeEach(() => {
  frames = []; listeners = new Map(); FakeObserver.all = []; current = null; fontSize = '16px';
  const g = globalThis as unknown as Record<string, unknown>;
  g.IntersectionObserver = FakeObserver;
  g.requestAnimationFrame = (f: (t: number) => void) => { frames.push(f); return frames.length; };
  g.cancelAnimationFrame = () => { frames = []; };
  g.window = {
    innerHeight: 900,
    addEventListener(type: string, f: (e: unknown) => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(f); },
    removeEventListener(type: string, f: (e: unknown) => void) { listeners.get(type)?.delete(f); },
  };
  g.getComputedStyle = () => ({ fontSize });
  g.document = {
    documentElement: { style: { getPropertyValue: () => '76px' } },
    addEventListener(type: string, f: (e: unknown) => void) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(f); },
    removeEventListener(type: string, f: (e: unknown) => void) { listeners.get(type)?.delete(f); },
  };
});
afterEach(() => {
  for (const off of registered.splice(0)) off();
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'window', 'getComputedStyle', 'document']) { if (k in saved) g[k] = saved[k]; else delete g[k]; }
});

/* The line is at (900 - 76) * 40% = 329.6, and the reach 12rem = 192px. */
const SCREEN = { line: 40, dwellMs: 400, reachRem: 12, murmurMost: 35, fadeMs: 250 };
interface FakeVoice { kind: string; gains: number[]; stops: number[]; dead: boolean }
interface Made { voices: FakeVoice[]; fires: number }
const made = (): Made => ({ voices: [], fires: 0 });
/* The engine's mixer puts every build-up loop in one group: a loop made while another lives ends it ("replaced"), and a dead loop ignores its gain. */
let current: FakeVoice | null = null;
const voiceFor = (log: Made) => (k: string): Voice => {
  if (current && !current.dead) current.dead = true;
  const v: FakeVoice = { kind: k, gains: [], stops: [], dead: false };
  current = v; log.voices.push(v);
  return { setGain: (g) => { if (!v.dead) v.gains.push(g); }, stop: (f) => { v.stops.push(f); v.dead = true; if (current === v) current = null; } };
};
function place(log: Made, kind: string, e: FakeEl, extra: Partial<PlaceSpec> = {}) {
  const spec: PlaceSpec = {
    els: () => [e as unknown as Element], kind, screen: SCREEN,
    voice: voiceFor(log),
    fire: () => { log.fires++; },
    ...extra,
  };
  const off = register(spec);
  registered.push(off);
  FakeObserver.all.at(-1)!.see(e);
  return off;
}

test('a place resting on the line for the dwell fires once', () => {
  const log = made(); const e = el(rect(320, 340));
  place(log, 'boo', e);
  step(1000); step(1300); step(1399);
  assert.equal(log.fires, 0);
  step(1401);
  assert.equal(log.fires, 1);
  step(1500); step(2000);
  assert.equal(log.fires, 1);
});

test('a place flung past the line fires nothing', () => {
  const log = made(); const e = el(rect(320, 340));
  place(log, 'boo', e);
  step(1000);
  e.rects = [rect(500)]; emit('scroll'); step(1200);
  e.rects = [rect(100)]; emit('scroll'); step(1500);
  step(2500);
  assert.equal(log.fires, 0);
});

test('a place that leaves the line and comes back starts its dwell again', () => {
  const log = made(); const e = el(rect(320, 340));
  place(log, 'boo', e);
  step(1000);
  e.rects = [rect(600)]; emit('scroll'); step(1300);
  e.rects = [rect(320, 340)]; emit('scroll'); step(1500);
  step(1800);
  assert.equal(log.fires, 0);
  step(1901);
  assert.equal(log.fires, 1);
});

test('the nearest place of the page decides the one murmur, whichever kind and post', () => {
  const a = made(); const b = made();
  const far = el(rect(500, 520)); const near = el(rect(400, 420)); const other = el(rect(480, 500));
  place(a, 'boo', far); place(b, 'boo', near); place(b, 'laugh', other);
  step(1000);
  const all = [...a.voices, ...b.voices];
  assert.equal(all.length, 1, 'one loop for the page');
  assert.equal(all[0]!.kind, 'boo');
  assert.equal(all[0]!.dead, false);
  const expected = (35 / 100) * (1 - (400 - 329.6) / 192);
  assert.ok(Math.abs(all[0]!.gains.at(-1)! - expected) < 1e-9, `the nearer place sets the gain: ${all[0]!.gains.at(-1)}`);
});

test('laugh and boo both near: exactly one live loop, of the nearer place\'s kind, and it is never made twice', () => {
  const log = made(); const laugh = el(rect(380, 400)); const boo = el(rect(450, 470));
  place(log, 'laugh', laugh); place(log, 'boo', boo);
  step(1000); emit('scroll'); step(1100); emit('scroll'); step(1200);
  assert.deepEqual(log.voices.map((v) => v.kind), ['laugh']);
  assert.equal(log.voices.filter((v) => !v.dead).length, 1);
  assert.ok(log.voices[0]!.gains.at(-1)! > 0);
});

test('the nearer place changing kind stops the old loop with the fade and makes the new kind\'s', () => {
  const log = made(); const laugh = el(rect(380, 400)); const boo = el(rect(450, 470));
  place(log, 'laugh', laugh); place(log, 'boo', boo);
  step(1000);
  laugh.rects = [rect(600, 620)]; boo.rects = [rect(340, 360)]; emit('scroll'); step(1100);
  assert.deepEqual(log.voices.map((v) => v.kind), ['laugh', 'boo']);
  assert.deepEqual(log.voices[0]!.stops, [250]);
  assert.equal(log.voices.filter((v) => !v.dead).length, 1);
  assert.equal(log.voices[1]!.dead, false);
  assert.ok(log.voices[1]!.gains.at(-1)! > 0, 'the new loop is heard');
});

test('a place past the reach makes no loop at all, so nothing is fetched for it', () => {
  const log = made();
  place(log, 'boo', el(rect(800)));
  step(1000);
  assert.equal(log.voices.length, 0);
});

test('a fine pointer near a place swells its murmur, and a touch does nothing', () => {
  const log = made(); const e = el(rect(700, 720));
  place(log, 'cheer', e);
  step(1000);
  assert.equal(log.voices.length, 0);
  emit('pointermove', { pointerType: 'touch', clientX: 50, clientY: 710 });
  assert.equal(frames.length, 0, 'a touch does not wake the frames');
  emit('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 730 });
  step(1100);
  assert.ok(log.voices[0]!.gains.at(-1)! > 0.3, `${log.voices[0]?.gains.at(-1)}`);
});

test('a fire stops the live murmur with the fade, and a place that is near afterward gets a fresh loop', () => {
  const log = made(); const e = el(rect(320, 340)); const f = el(rect(400, 420));
  const off1 = place(log, 'boo', e); const off2 = place(log, 'boo', f);
  step(1000);
  assert.equal(log.voices.length, 1);
  step(1401);
  assert.equal(log.fires, 1);
  assert.deepEqual(log.voices[0]!.stops, [250], 'the fire fades the murmur over fadeMs');
  assert.equal(log.voices.length, 1, 'no loop is made in the frame of the fire');
  emit('scroll'); step(1500);
  assert.equal(log.voices.length, 2, 'the next near place makes a fresh loop');
  assert.equal(log.voices[1]!.dead, false);
  assert.ok(log.voices[1]!.gains.at(-1)! > 0);
  off1();
  assert.deepEqual(log.voices[1]!.stops, [], 'one place going leaves the other\'s murmur');
  off2();
  assert.deepEqual(log.voices[1]!.stops, [250], 'the last place going stops the loop with the fade');
});

test('the last unfired place firing leaves no loop to leak', () => {
  const log = made(); const e = el(rect(320, 340));
  place(log, 'laugh', e);
  step(1000); step(1401);
  assert.equal(log.fires, 1);
  assert.deepEqual(log.voices.map((v) => v.stops), [[250]]);
  assert.equal(log.voices.filter((v) => !v.dead).length, 0);
});

test('two posts share the one voice: one going leaves it, and the last one stops it', () => {
  const a = made(); const b = made();
  const offA = place(a, 'boo', el(rect(340))); const offB = place(b, 'boo', el(rect(360)));
  step(1000);
  const v = [...a.voices, ...b.voices][0]!;
  assert.equal(a.voices.length + b.voices.length, 1);
  offA();
  assert.deepEqual(v.stops, []);
  step(1100);
  assert.ok(v.gains.at(-1)! > 0);
  offB();
  assert.deepEqual(v.stops, [250]);
});

test('a busy page: 1,200 places cost one observer and three listeners, no frame while still, and a frame measures only the places near', () => {
  const offs: (() => void)[] = [];
  const log = made();
  let nearMeasured = 0;
  const els: { getClientRects(): Rect[] }[] = [];
  for (let post = 0; post < 40; post++) for (let i = 0; i < 30; i++) {
    const n = post * 30 + i;
    const isNear = n < 6;
    /* A far place's box is never asked for: measuring one is a failure. */
    const e = { getClientRects(): Rect[] { if (!isNear) throw new Error(`place ${n} is far and was measured`); nearMeasured++; return [rect(300 + n * 30)]; } };
    els.push(e);
    offs.push(register({ els: () => [e] as unknown as Element[], kind: 'laugh', screen: SCREEN, voice: () => ({ setGain() {}, stop() {} }), fire: () => { log.fires++; } }));
    registered.push(offs.at(-1)!);
  }
  assert.equal(FakeObserver.all.length, 1);
  assert.equal(count(), 3);
  assert.deepEqual([...listeners.keys()].sort(), ['pointermove', 'resize', 'scroll']);
  assert.equal(FakeObserver.all[0]!.options.rootMargin, '192px 0px');
  assert.equal(__inspect().unfired, 1200);
  assert.equal(frames.length, 0, 'nothing is near, so nothing is looked at');
  for (let n = 0; n < 6; n++) FakeObserver.all[0]!.see(els[n]);
  step(1000);
  assert.equal(nearMeasured, 6, 'one frame measures the six near places and no other');
  while (frames.length) step(1000);
  nearMeasured = 0;
  step(2000); step(3000);
  assert.equal(frames.length, 0, 'a still page asks for no frame');
  assert.equal(nearMeasured, 0);
  emit('scroll'); step(4000);
  assert.equal(nearMeasured, 6, 'a scrolling frame measures the near places alone');
  assert.equal(__inspect().unfired, 1200);
  for (const off of offs) off();
  assert.equal(count(), 0, 'the listeners go with the last place');
  assert.equal(FakeObserver.all[0]!.disconnected, true);
});

test('frames run while the page scrolls or a place waits out its dwell, and stop when neither is so', () => {
  const log = made(); const e = el(rect(320, 340));
  place(log, 'cheer', e);
  assert.equal(frames.length, 1, 'a place seen is looked at once');
  step(1000);
  assert.equal(frames.length, 1, 'a place resting on the line asks for the next frame');
  step(1100); step(1300);
  assert.equal(frames.length, 1);
  step(1401);
  assert.equal(log.fires, 1);
  assert.equal(frames.length, 0, 'fired: nothing waits');
  emit('scroll');
  assert.equal(frames.length, 1, 'a scroll wakes one');
  step(1500);
  assert.equal(frames.length, 0, 'and it rests again');
});

test('a place nowhere near the viewport is never measured', () => {
  const log = made(); let measured = 0;
  const e = { getClientRects() { measured++; return [rect(5000)]; } };
  registered.push(register({ els: () => [e as unknown as Element], kind: 'boo', screen: SCREEN, voice: () => ({ setGain() {}, stop() {} }), fire: () => { log.fires++; } }));
  step(1000); emit('scroll'); step(1100);
  assert.equal(measured, 0);
});

test('a page with no observer registers nothing and binds nothing', () => {
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
  const off = register({ els: () => [], kind: 'boo', screen: SCREEN, voice: () => ({ setGain() {}, stop() {} }), fire() {} });
  assert.equal(count(), 0);
  assert.equal(frames.length, 0);
  off(); off.refresh();
});

test('a place that fired lets go of its pieces, and a post whose places all fired and went leaves the watcher holding nothing', () => {
  const log = made(); const a = el(rect(320, 340)); const b = el(rect(325, 345));
  const offA = place(log, 'boo', a); const offB = place(log, 'cheer', b);
  assert.equal(__inspect().elements, 2);
  step(1000); step(1401);
  assert.equal(log.fires, 2);
  assert.equal(__inspect().elements, 0, 'a fired place is no longer looked up by its pieces');
  assert.ok(!FakeObserver.all[0]!.observed.has(a) && !FakeObserver.all[0]!.observed.has(b), 'and no longer observed');
  assert.equal(__inspect().unfired, 0);
  offA();
  assert.equal(__inspect().places, 1);
  offB();
  assert.deepEqual(__inspect(), { places: 0, elements: 0, near: 0, unfired: 0, murmuring: false, listening: false });
});

test('the counter of unfired places follows a fire and an unregister', () => {
  const log = made(); const a = el(rect(320, 340)); const b = el(rect(700, 720));
  const offA = place(log, 'boo', a); place(log, 'boo', b);
  assert.equal(__inspect().unfired, 2);
  step(1000); step(1401);
  assert.equal(__inspect().unfired, 1);
  offA();
  assert.equal(__inspect().unfired, 1, 'a fired place going does not count twice');
});

test('Game sounds toggled off and on: the dead loop is let go, and the next near frame makes a fresh one that sounds', () => {
  const log = made(); const e = el(rect(400, 420));
  place(log, 'boo', e);
  step(1000);
  assert.equal(log.voices.length, 1);
  /* The mixer ended the loop when its bus went off: the handle is dead and ignores its gain. */
  log.voices[0]!.dead = true; current = null;
  emit('scroll'); step(1100);
  assert.equal(log.voices.length, 1, 'without the signal the watcher keeps the dead handle');
  forgetVoice();
  assert.deepEqual(log.voices[0]!.stops, [0], 'the dead loop is let go (its held caption released)');
  assert.equal(__inspect().murmuring, false);
  assert.equal(frames.length, 1, 'and a frame is woken');
  step(1200);
  assert.equal(log.voices.length, 2, 'the next near frame makes a fresh loop');
  assert.equal(log.voices[1]!.dead, false);
  assert.ok(log.voices[1]!.gains.at(-1)! > 0, 'and it sounds');
});

test('a resize reads the root font size again, rebuilds the observer\'s reach if it changed, and wakes a frame', () => {
  const log = made(); const e = el(rect(400, 420));
  place(log, 'boo', e);
  step(1000);
  assert.equal(frames.length, 0);
  const first = FakeObserver.all[0]!;
  assert.equal(first.options.rootMargin, '192px 0px');
  emit('resize');
  assert.equal(FakeObserver.all.length, 1, 'the same size rebuilds nothing');
  assert.equal(frames.length, 1, 'but wakes a frame');
  step(1100);
  fontSize = '20px';
  emit('resize');
  assert.equal(FakeObserver.all.length, 2, 'a new size rebuilds the observer');
  const second = FakeObserver.all[1]!;
  assert.equal(second.options.rootMargin, '240px 0px');
  assert.equal(first.disconnected, true);
  assert.ok(second.observed.has(e), 'the places\' pieces are observed again');
  assert.equal(frames.length, 1);
  assert.equal(count(), 3, 'still one listener of each');
});
