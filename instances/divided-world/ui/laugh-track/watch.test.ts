/**
 * The page's one watcher (docs/plans/2026-11-12-laugh-track-point-plan.md, Task 2), over a fake observer, fake frames, a fake clock and fake
 * listeners, under plain node: a place is told its nearness to the reading line (and the mouse, which counts double) when the number moves
 * by 0.02 or more and always at exactly 0 or 1; a pinned place has nearness 1 wherever it is; nothing the reader does by waiting fires
 * anything; `quiet` holds the one murmur at nothing for a reaction; the nearest place of the page, of any kind, wins the murmur; the page
 * holds one observer, a scroll, a pointermove and a resize listener however many places it has; frames run only while something moves or
 * is owed; and the loop stops when the last place goes.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { __inspect, forgetVoice, QUIET_MS, quiet, register, type PlaceSpec, type Voice } from './watch.ts';

type Rect = { top: number; bottom: number; left: number; right: number };
const rect = (top: number, bottom = top + 20): Rect => ({ top, bottom, left: 10, right: 90 });
interface FakeEl { rects: Rect[]; getClientRects(): Rect[] }
const el = (...rects: Rect[]): FakeEl => ({ rects, getClientRects() { return this.rects; } });
const close = (actual: number | undefined, expected: number, what = ''): void => assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${what} ${actual} is not ${expected}`);

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
/** The clock `performance.now()` reads: a frame at time t is at t, as the browser's frames are. */
let clock = 0;
const step = (t: number) => { clock = t; const run = frames; frames = []; for (const f of run) f(t); };
/** Runs a frame at each time from `from` to `to`, `every` ms apart, whenever one was asked for. */
const play = (from: number, to: number, every = 50) => { for (let t = from; t <= to; t += every) step(t); };
/** Runs frames at `t` until none is asked for; a watcher that keeps asking is a failure on an assertion, not a hang. */
const drain = (t: number, limit = 100) => { for (let n = 0; frames.length; n++) { if (n >= limit) assert.fail(`the watcher still asks for frames after ${limit}`); step(t); } };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const emit = (type: string, e: unknown = {}) => { for (const f of [...(listeners.get(type) ?? [])]) f(e); };
const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
const saved = { ...globalThis } as Record<string, unknown>;
const savedPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
/* Every registration a test makes is let go after it: the watcher is the page's, and the next test starts from an empty page. */
let registered: (() => void)[] = [];

beforeEach(() => {
  frames = []; listeners = new Map(); FakeObserver.all = []; current = null; fontSize = '16px'; clock = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
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
  if (savedPerformance) Object.defineProperty(globalThis, 'performance', savedPerformance); else delete (globalThis as Record<string, unknown>).performance;
});

/* The line is at (900 - 76) * 40% = 329.6, and the reach 12rem = 192px. */
const LINE = 329.6;
const SCREEN = { line: 40, reachRem: 12, murmurMost: 35, fadeMs: 250 };
interface FakeVoice { kind: string; gains: number[]; stops: number[]; dead: boolean }
interface Made { voices: FakeVoice[]; told: number[]; calls: string[] }
const made = (): Made => ({ voices: [], told: [], calls: [] });
/* The engine's mixer puts every build-up loop in one group: a loop made while another lives ends it ("replaced"), and a dead loop ignores its gain. */
let current: FakeVoice | null = null;
const voiceFor = (log: Made) => (k: string): Voice => {
  if (current && !current.dead) current.dead = true;
  const v: FakeVoice = { kind: k, gains: [], stops: [], dead: false };
  current = v; log.voices.push(v);
  return { setGain: (g) => { if (!v.dead) { v.gains.push(g); log.calls.push(`gain ${g}`); } }, stop: (f) => { v.stops.push(f); v.dead = true; if (current === v) current = null; } };
};
function place(log: Made, kind: string, e: FakeEl, extra: Partial<PlaceSpec> = {}, screen = SCREEN, seen = true) {
  const spec: PlaceSpec = {
    els: () => [e as unknown as Element], kind, screen,
    voice: voiceFor(log),
    near: (n) => { log.told.push(n); log.calls.push(`near ${n}`); },
    ...extra,
  };
  const off = register(spec);
  registered.push(off);
  if (seen) FakeObserver.all.at(-1)!.see(e);
  return off;
}
const lastGain = (log: Made): number | undefined => log.voices.at(-1)?.gains.at(-1);
const AT_LINE = (): Rect => rect(320, 340);

test('a place at the line is told near(1), half the reach away near(0.5), and one past the reach near(0) once', () => {
  const a = made(); const b = made(); const c = made();
  place(a, 'boo', el(AT_LINE()));
  place(b, 'boo', el(rect(LINE + 96, LINE + 116)));
  const past = el(rect(600, 620));
  place(c, 'boo', past);
  step(1000);
  assert.deepEqual(a.told, [1]);
  assert.equal(b.told.length, 1); close(b.told[0], 0.5, 'half the reach');
  assert.deepEqual(c.told, [0]);
  emit('scroll'); step(1100); emit('scroll'); step(1200);
  assert.deepEqual(c.told, [0], 'told 0 once, and not again while it stays there');
  assert.deepEqual(a.told, [1]);
});

test('near is told only when the number moved by 0.02 or more, and always for exactly 0 or 1', () => {
  const log = made(); const e = el(AT_LINE());
  place(log, 'boo', e);
  step(1000);
  assert.deepEqual(log.told, [1]);
  /* 192px of reach: 0.02 is 3.84px. */
  const moveTo = (distance: number, t: number) => { e.rects = [rect(LINE + distance, LINE + distance + 20)]; emit('scroll'); step(t); };
  moveTo(2, 1100);
  assert.equal(log.told.length, 1, '2px is 0.0104: not told');
  moveTo(4, 1200);
  assert.equal(log.told.length, 2, '4px is 0.0208 from the last told: told');
  close(log.told[1], 1 - 4 / 192);
  moveTo(6, 1300);
  assert.equal(log.told.length, 2, '0.0104 from the last told, not from the one before: not told');
  moveTo(8, 1400);
  assert.equal(log.told.length, 3, 'drift adds up against the last told');
  /* A first nearness of 0.99 and then exactly 1: a change under 0.02 that is told because it is 1. */
  const b = made(); const f = el(rect(LINE + 1.92, LINE + 21.92));
  place(b, 'boo', f);
  step(2000);
  close(b.told[0], 0.99);
  f.rects = [AT_LINE()]; emit('scroll'); step(2100);
  assert.deepEqual(b.told.map((n) => Math.round(n * 100)), [99, 100], 'exactly 1 is always told');
  /* And exactly 0 the same way: 0.01 and then the reach. */
  const z = made(); const g = el(rect(LINE + 190.08, LINE + 210.08));
  place(z, 'boo', g);
  step(3000);
  close(z.told[0], 0.01);
  g.rects = [rect(LINE + 192, LINE + 212)]; emit('scroll'); step(3100);
  assert.deepEqual(z.told.map((n) => Math.round(n * 100)), [1, 0], 'exactly 0 is always told');
});

test('the mouse over a place far from the line gives it nearness 1; a quarter of the reach away, 0.5; a touch changes nothing', () => {
  const log = made(); const e = el(rect(700, 720));
  place(log, 'cheer', e);
  step(1000);
  assert.deepEqual(log.told, [0]);
  emit('pointermove', { pointerType: 'touch', clientX: 50, clientY: 710 });
  assert.equal(frames.length, 0, 'a touch does not wake the frames');
  emit('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 710 });
  step(1100);
  assert.deepEqual(log.told, [0, 1], 'on the place: 1');
  emit('pointermove', { pointerType: 'mouse', clientX: 50, clientY: 652 });
  step(1200);
  close(log.told.at(-1), 0.5, 'a quarter of the reach (48px) is 96px, half the reach');
  const before = log.told.length;
  emit('pointermove', { pointerType: 'touch', clientX: 50, clientY: 710 });
  step(1300);
  assert.equal(log.told.length, before);
});

test('a place the observer drops from the reach is told near(0)', () => {
  const log = made(); const e = el(AT_LINE());
  place(log, 'boo', e);
  step(1000);
  assert.deepEqual(log.told, [1]);
  FakeObserver.all[0]!.see(e, false);
  assert.equal(frames.length, 1, 'the drop asks for a frame');
  step(1100);
  assert.deepEqual(log.told, [1, 0]);
  assert.equal(__inspect().near, 0);
});

test('a pinned place is told near(1) and raises the loop at murmurMost wherever it is; unpinned it returns to its measured nearness', () => {
  const log = made(); const other = made();
  const pinned = el(rect(5000, 5020)); const nearby = el(rect(LINE + 96, LINE + 116));
  const off = place(log, 'boo', pinned, {}, SCREEN, false);
  place(other, 'cheer', nearby);
  step(1000);
  assert.deepEqual(log.told, [], 'not near and not pinned: nothing to tell');
  assert.equal(frames.length, 0);
  off.pin(true);
  assert.equal(frames.length, 1, 'a pinned place whose nearness is not told asks for a frame');
  step(1100);
  assert.deepEqual(log.told, [1]);
  assert.equal(frames.length, 0, 'told, it asks for no more');
  assert.equal(__inspect().pinned, 1);
  assert.equal(other.voices[0]?.kind, 'cheer', 'the measured place had the loop while nothing was pinned');
  assert.deepEqual(other.voices[0]!.stops, [250], 'and the pinned place\'s kind took it over');
  assert.equal(log.voices[0]?.kind, 'boo', 'the pinned place\'s loop is the one');
  assert.equal([...log.voices, ...other.voices].filter((v) => !v.dead).length, 1);
  close(lastGain(log), 0.35, 'at murmurMost');
  off.pin(false);
  step(1200);
  assert.deepEqual(log.told, [1, 0], 'unpinned and not near: back to 0');
  assert.equal(__inspect().pinned, 0);
  assert.equal(other.voices.at(-1)?.kind, 'cheer', 'the measured place takes the loop back');
  /* A near place pinned and unpinned goes back to its measured nearness. */
  const back = made(); const mid = el(rect(LINE + 96, LINE + 116));
  const offMid = place(back, 'boo', mid);
  step(2000);
  close(back.told[0], 0.5);
  offMid.pin(true); step(2100);
  assert.deepEqual(back.told.map((n) => Math.round(n * 100)), [50, 100]);
  offMid.pin(false); step(2200);
  assert.deepEqual(back.told.map((n) => Math.round(n * 100)), [50, 100, 50]);
});

test('no amount of time at the line fires anything: the only calls are near and the loop\'s gain', () => {
  const log = made(); const e = el(AT_LINE());
  const spec: PlaceSpec = { els: () => [e as unknown as Element], kind: 'boo', screen: SCREEN, voice: voiceFor(log), near: (n) => log.calls.push(`near ${n}`) };
  assert.deepEqual(Object.keys(spec).sort(), ['els', 'kind', 'near', 'screen', 'voice']);
  registered.push(register(spec));
  FakeObserver.all[0]!.see(e);
  for (let t = 1000; t <= 61000; t += 100) { emit('scroll'); step(t); }
  assert.ok(log.calls.length > 0);
  assert.ok(log.calls.every((c) => /^(near|gain) /.test(c)), log.calls.join(', '));
  assert.deepEqual(log.calls, ['near 1', 'gain 0.35']);
  assert.equal(__inspect().near, 1, 'and it is still there, unreacted to');
});

test('quiet(undefined) holds the loop at 0 for 1200ms and then raises it', () => {
  const log = made(); const e = el(AT_LINE());
  place(log, 'boo', e);
  step(1000);
  close(lastGain(log), 0.35);
  quiet(undefined, 250);
  assert.equal(QUIET_MS, 1200);
  assert.equal(lastGain(log), 0, 'at once');
  assert.equal(__inspect().quietUntil, 2200);
  const before = log.voices[0]!.gains.length;
  play(1050, 2150);
  assert.ok(log.voices[0]!.gains.slice(before).every((g) => g === 0), 'held at nothing');
  assert.equal(log.voices.length, 1);
  step(2200);
  close(lastGain(log), 0.35, 'then raised');
});

test('quiet with a take\'s length resolved 400ms later holds until 400 + (3000 - 250)ms after the call; a second quiet voids the first\'s late answer', async () => {
  const log = made(); const e = el(AT_LINE());
  place(log, 'boo', e);
  step(1000);
  let resolve: (v: { lengthMs: number } | null) => void = () => {};
  clock = 1000;
  quiet(new Promise((r) => { resolve = r; }), 250);
  play(1050, 1400);
  clock = 1400; resolve({ lengthMs: 3000 });
  await flush();
  assert.equal(__inspect().quietUntil, 1400 + 2750);
  const before = log.voices[0]!.gains.length;
  play(1450, 4100);
  assert.ok(log.voices[0]!.gains.slice(before).every((g) => g === 0), 'held past the 1200ms, to the tail');
  step(4150);
  close(lastGain(log), 0.35, 'the tail begins: raised');
  /* Later quiets: an earlier quiet's late answer counts for nothing, however long its take. */
  let lateA: (v: { lengthMs: number } | null) => void = () => {};
  let lateB: (v: { lengthMs: number } | null) => void = () => {};
  clock = 5000; quiet(new Promise((r) => { lateA = r; }), 250);
  clock = 5050; quiet(new Promise((r) => { lateB = r; }), 250);
  clock = 5100; quiet(undefined, 250);
  assert.equal(__inspect().quietUntil, 5100 + QUIET_MS);
  const held = log.voices[0]!.gains.length;
  clock = 5200; lateA({ lengthMs: 90000 }); lateB({ lengthMs: 90000 });
  await flush();
  assert.equal(__inspect().quietUntil, 6300, 'the late answers of earlier quiets changed nothing');
  play(5250, 6250);
  assert.ok(log.voices[0]!.gains.slice(held).every((g) => g === 0), 'held at nothing for the last quiet');
  step(6300);
  close(lastGain(log), 0.35, 'raised when the last quiet alone ends, not held for the late answers');
});

test('quiet with { lengthMs: NaN }, null, a non-positive length or a rejection holds for 1200ms; a rejection is reported once', async () => {
  const g = globalThis as { reportError?: (e: unknown) => void };
  const savedReport = g.reportError;
  const reported: unknown[] = [];
  g.reportError = (e) => { reported.push(e); };
  try {
    const boom = new Error('no take');
    const answers: (() => Promise<{ lengthMs: number } | null>)[] = [
      () => Promise.resolve({ lengthMs: Number.NaN }), () => Promise.resolve(null), () => Promise.resolve({ lengthMs: 0 }),
      () => Promise.resolve({ lengthMs: -5 }), () => Promise.reject(boom),
    ];
    for (const answer of answers) {
      const log = made(); const e = el(AT_LINE());
      const off = place(log, 'boo', e);
      step(1000);
      quiet(answer(), 250);
      await flush();
      assert.equal(__inspect().quietUntil, 1000 + QUIET_MS);
      const before = log.voices[0]!.gains.length;
      play(1050, 2150);
      assert.ok(log.voices[0]!.gains.slice(before).every((x) => x === 0));
      step(2200);
      close(lastGain(log), 0.35, 'raised again after 1200');
      off(); frames = []; await flush();
    }
    assert.deepEqual(reported, [boom], 'the rejection is reported once');
  } finally { if (savedReport) g.reportError = savedReport; else delete g.reportError; }
});

test('while quiet, places are still told their nearness', () => {
  const log = made(); const e = el(AT_LINE());
  place(log, 'boo', e);
  step(1000);
  quiet(undefined, 250);
  e.rects = [rect(LINE + 96, LINE + 116)]; emit('scroll'); step(1100);
  assert.equal(log.told.length, 2);
  close(log.told[1], 0.5, 'the mark does not wait for the sound');
  assert.equal(lastGain(log), 0);
});

test('frames: a still page with nothing near, nothing pinned and no quiet asks for none; a quiet with a place near keeps them until it ends', () => {
  const log = made(); const unseen = el(AT_LINE());
  place(log, 'boo', unseen, {}, SCREEN, false);
  assert.equal(frames.length, 0, 'a registered place nobody has seen asks for nothing');
  emit('pointermove', { pointerType: 'touch', clientX: 1, clientY: 1 });
  assert.equal(frames.length, 0);
  const far = el(rect(800, 820));
  place(log, 'boo', far);
  assert.equal(frames.length, 1, 'a place seen is looked at once');
  step(1000);
  assert.equal(frames.length, 0, 'and a still page rests');
  const e = el(AT_LINE());
  place(log, 'boo', e);
  step(1100);
  assert.equal(frames.length, 0, 'a place near with no quiet running asks for none');
  quiet(undefined, 250);
  assert.equal(frames.length, 1);
  for (let t = 1150; t < 2300; t += 50) { step(t); assert.equal(frames.length, 1, `at ${t} the hold is running`); }
  step(2300);
  assert.equal(frames.length, 0, 'when it ends the page rests again');
});

test('refresh after a place\'s pieces were drawn again tells the new pieces\' nearness next frame, even where the number did not change', () => {
  const log = made(); let drawn = el(AT_LINE());
  const off = place(log, 'boo', drawn, { els: () => [drawn as unknown as Element] });
  step(1000);
  assert.deepEqual(log.told, [1]);
  off.refresh();
  emit('scroll'); step(1050);
  assert.deepEqual(log.told, [1], 'the same pieces owe nothing');
  drawn = el(AT_LINE());
  off.refresh();
  assert.equal(frames.length, 1, 'redrawn pieces ask for a frame');
  FakeObserver.all[0]!.see(drawn);
  step(1100);
  assert.deepEqual(log.told, [1, 1], 'told again: the old pieces\' marks are gone with them');
  assert.ok(FakeObserver.all[0]!.observed.has(drawn));
});

test('after the last place is unregistered the loop is stopped, quiet\'s state is cleared, and a later page starts clean', async () => {
  const log = made(); const e = el(AT_LINE());
  const off = place(log, 'boo', e);
  step(1000);
  let answer: (v: { lengthMs: number } | null) => void = () => {};
  quiet(new Promise((r) => { answer = r; }), 250);
  assert.equal(__inspect().quietUntil, 2200);
  off();
  assert.deepEqual(log.voices[0]!.stops, [250], 'the loop stops with the fade');
  assert.deepEqual(__inspect(), { places: 0, elements: 0, near: 0, pinned: 0, murmuring: false, listening: false, quietUntil: 0 });
  assert.equal(frames.length, 0);
  const fresh = made();
  clock = 1500;
  place(fresh, 'cheer', el(AT_LINE()));
  step(1600);
  close(lastGain(fresh), 0.35, 'no hold of the old page keeps the new one quiet');
  clock = 1700; answer({ lengthMs: 9000 });
  await flush();
  assert.equal(__inspect().quietUntil, 0, 'the old page\'s answer changes nothing');
  quiet(undefined, 250);
  assert.equal(lastGain(fresh), 0);
});

test('the nearest place of the page decides the one murmur, whichever kind and post', () => {
  const a = made(); const b = made();
  const far = el(rect(480, 500)); const nearest = el(rect(400, 420)); const other = el(rect(420, 440));
  place(a, 'boo', far); place(b, 'boo', nearest); place(b, 'laugh', other);
  step(1000);
  const all = [...a.voices, ...b.voices];
  assert.equal(all.length, 1, 'one loop for the page');
  assert.equal(all[0]!.kind, 'boo');
  assert.equal(all[0]!.dead, false);
  close(all[0]!.gains.at(-1), 0.35 * (1 - (400 - LINE) / 192), 'the nearer place sets the gain');
});

test('laugh and boo both near: exactly one live loop, of the nearer place\'s kind, and it is never made twice', () => {
  const log = made(); const laugh = el(rect(400, 420)); const boo = el(rect(480, 500));
  place(log, 'laugh', laugh); place(log, 'boo', boo);
  step(1000); emit('scroll'); step(1100); emit('scroll'); step(1200);
  assert.deepEqual(log.voices.map((v) => v.kind), ['laugh']);
  assert.equal(log.voices.filter((v) => !v.dead).length, 1);
  assert.ok(log.voices[0]!.gains.at(-1)! > 0);
});

test('the nearer place changing kind stops the old loop with the fade and makes the new kind\'s', () => {
  const log = made(); const laugh = el(rect(400, 420)); const boo = el(rect(480, 500));
  place(log, 'laugh', laugh); place(log, 'boo', boo);
  step(1000);
  laugh.rects = [rect(900, 920)]; boo.rects = [rect(380, 400)]; emit('scroll'); step(1100);
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
  assert.deepEqual(log.told, [0]);
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

test('two posts share the one voice: one going leaves it, and the last one stops it', () => {
  const a = made(); const b = made();
  const offA = place(a, 'boo', el(rect(440))); const offB = place(b, 'boo', el(rect(460)));
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
  let nearMeasured = 0;
  const els: { getClientRects(): Rect[] }[] = [];
  for (let post = 0; post < 40; post++) for (let i = 0; i < 30; i++) {
    const n = post * 30 + i;
    const isNear = n < 6;
    /* A far place's box is never asked for: measuring one is a failure. */
    const e = { getClientRects(): Rect[] { if (!isNear) throw new Error(`place ${n} is far and was measured`); nearMeasured++; return [rect(600 + n * 30)]; } };
    els.push(e);
    offs.push(register({ els: () => [e] as unknown as Element[], kind: 'laugh', screen: SCREEN, voice: () => ({ setGain() {}, stop() {} }), near() {} }));
    registered.push(offs.at(-1)!);
  }
  assert.equal(FakeObserver.all.length, 1);
  assert.equal(count(), 3);
  assert.deepEqual([...listeners.keys()].sort(), ['pointermove', 'resize', 'scroll']);
  assert.equal(FakeObserver.all[0]!.options.rootMargin, '192px 0px');
  assert.equal(__inspect().places, 1200);
  assert.equal(frames.length, 0, 'nothing is near, so nothing is looked at');
  for (let n = 0; n < 6; n++) FakeObserver.all[0]!.see(els[n]);
  step(1000);
  assert.equal(nearMeasured, 6, 'one frame measures the six near places and no other');
  drain(1000);
  nearMeasured = 0;
  step(2000); step(3000);
  assert.equal(frames.length, 0, 'a still page asks for no frame');
  assert.equal(nearMeasured, 0);
  emit('scroll'); step(4000);
  assert.equal(nearMeasured, 6, 'a scrolling frame measures the near places alone');
  assert.equal(__inspect().places, 1200);
  for (const off of offs) off();
  assert.equal(count(), 0, 'the listeners go with the last place');
  assert.equal(FakeObserver.all[0]!.disconnected, true);
});

test('a place nowhere near the viewport is never measured', () => {
  let measured = 0;
  const e = { getClientRects() { measured++; return [rect(5000)]; } };
  registered.push(register({ els: () => [e as unknown as Element], kind: 'boo', screen: SCREEN, voice: () => ({ setGain() {}, stop() {} }), near() {} }));
  step(1000); emit('scroll'); step(1100);
  assert.equal(measured, 0);
});

test('a page with no observer registers nothing and binds nothing', () => {
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
  const off = register({ els: () => [], kind: 'boo', screen: SCREEN, voice: () => ({ setGain() {}, stop() {} }), near() {} });
  assert.equal(count(), 0);
  assert.equal(frames.length, 0);
  off(); off.refresh(); off.pin(true);
});

test('unregistering a place lets go of its pieces, its pin and the observer, and a registered place counts once', () => {
  const log = made(); const a = el(rect(320, 340)); const b = el(rect(325, 345));
  const offA = place(log, 'boo', a); const offB = place(log, 'cheer', b);
  offA.pin(true);
  assert.equal(__inspect().elements, 2);
  assert.equal(__inspect().pinned, 1);
  offA();
  assert.equal(__inspect().places, 1);
  assert.equal(__inspect().pinned, 0);
  assert.ok(!FakeObserver.all[0]!.observed.has(a), 'no longer observed');
  offA();
  assert.equal(__inspect().places, 1, 'a second unregister changes nothing');
  offA.pin(true);
  assert.equal(__inspect().pinned, 0, 'a pin after it is gone does nothing');
  offB();
  assert.deepEqual(__inspect(), { places: 0, elements: 0, near: 0, pinned: 0, murmuring: false, listening: false, quietUntil: 0 });
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
  const log = made(); const e = el(rect(600, 620));
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
