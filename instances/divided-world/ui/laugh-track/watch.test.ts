/**
 * The page's one watcher (docs/plans/2026-11-12-laugh-track-band-plan.md, Tasks 4), over a fake observer, fake frames and fake listeners, under
 * plain node: a place in the reading band for the dwell, added up a frame at a time, is earned and fires once, in page order and spaced by the
 * airtime, and one flung past does not; an earned place keeps its turn for `holdMs` after leaving the band and never outlives its registration;
 * a fire holds the murmur for the take's length or the airtime; the nearest place of a kind, on whichever post, wins its kind's murmur; the page
 * holds one observer, a scroll, a pointermove and a resize listener however many places it has; frames run only while something moves or waits;
 * and the loops stop when the last place of a kind goes.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { __inspect, forgetVoice, register, type PlaceSpec, type Voice } from './watch.ts';

type Rect = { top: number; bottom: number; left: number; right: number };
const rect = (top: number, bottom = top + 20): Rect => ({ top, bottom, left: 10, right: 90 });
interface FakeEl { rects: Rect[]; order: number; getClientRects(): Rect[]; compareDocumentPosition(other: FakeEl): number }
/* `order` is the element's place in the document, whatever order its place registered in: following is 4 and preceding is 2, as the DOM says. */
let nextOrder = 0;
const el = (...rects: Rect[]): FakeEl => ({
  rects, order: nextOrder++,
  getClientRects() { return this.rects; },
  compareDocumentPosition(other: FakeEl) { return other.order > this.order ? 4 : 2; },
});
const inDocumentAt = (e: FakeEl, order: number): FakeEl => { e.order = order; return e; };

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
/** Runs a frame at each time from `from` to `to`, `every` ms apart, whenever one was asked for: a frame adds at most 100ms, so the clock moves in small steps. */
const play = (from: number, to: number, every = 50) => { for (let t = from; t <= to; t += every) step(t); };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const emit = (type: string, e: unknown = {}) => { for (const f of [...(listeners.get(type) ?? [])]) f(e); };
const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
const saved = { ...globalThis } as Record<string, unknown>;
/* Every registration a test makes is let go after it: the watcher is the page's, and the next test starts from an empty page. */
let registered: (() => void)[] = [];

beforeEach(() => {
  frames = []; listeners = new Map(); FakeObserver.all = []; current = null; fontSize = '16px'; nextOrder = 0;
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

/* The line is at (900 - 76) * 40% = 329.6, the band 34% of the 824px above the HUD round it (189.52 to 469.68), and the reach 12rem = 192px. */
const SCREEN = { line: 40, band: 34, dwellMs: 400, reachRem: 12, murmurMost: 35, fadeMs: 250, airMs: 1200, holdMs: 4000 };
const BAND_BOTTOM = 329.6 + (824 * 34) / 200;
interface FakeVoice { kind: string; gains: number[]; stops: number[]; dead: boolean }
interface Made { voices: FakeVoice[]; fires: number; order: string[]; answer?: () => void | Promise<{ lengthMs: number } | null> }
const made = (): Made => ({ voices: [], fires: 0, order: [] });
/* The engine's mixer puts every build-up loop in one group: a loop made while another lives ends it ("replaced"), and a dead loop ignores its gain. */
let current: FakeVoice | null = null;
const voiceFor = (log: Made) => (k: string): Voice => {
  if (current && !current.dead) current.dead = true;
  const v: FakeVoice = { kind: k, gains: [], stops: [], dead: false };
  current = v; log.voices.push(v);
  return { setGain: (g) => { if (!v.dead) v.gains.push(g); }, stop: (f) => { v.stops.push(f); v.dead = true; if (current === v) current = null; } };
};
function place(log: Made, kind: string, e: FakeEl, extra: Partial<PlaceSpec> = {}, name = kind, screen = SCREEN) {
  const spec: PlaceSpec = {
    els: () => [e as unknown as Element], kind, screen,
    voice: voiceFor(log),
    fire: () => { log.fires++; log.order.push(name); return log.answer?.(); },
    ...extra,
  };
  const off = register(spec);
  registered.push(off);
  FakeObserver.all.at(-1)!.see(e);
  return off;
}

const IN = (): Rect => rect(320, 340);
const OUT = (): Rect => rect(600, 620);

test('a place anywhere in the band for the dwell fires once; one outside it, however long, does not', () => {
  const log = made(); const top = el(rect(200, 220)); const low = el(rect(450, 460)); const outside = el(OUT());
  place(log, 'boo', top, {}, 'top'); place(log, 'cheer', outside, {}, 'outside');
  play(1000, 1350);
  assert.equal(log.fires, 0);
  step(1400);
  assert.deepEqual(log.order, ['top']);
  play(1450, 9000);
  assert.deepEqual(log.order, ['top'], 'once, and never the place outside the band');
  const log2 = made();
  place(log2, 'boo', low, {}, 'low');
  play(10000, 10400);
  assert.deepEqual(log2.order, ['low'], 'the band is 189.52 to 469.68, and the middle of a box in it counts');
});

test('dwell adds up: 250ms in the band, a frame out of it (still near), 200ms in it again, fires', () => {
  const log = made(); const e = el(IN());
  place(log, 'boo', e);
  play(1000, 1250);
  e.rects = [OUT()]; emit('scroll'); step(1300);
  assert.equal(log.fires, 0);
  e.rects = [IN()]; emit('scroll');
  play(1350, 1450);
  assert.equal(log.fires, 0, '250 and 100 is not yet 400');
  step(1500);
  assert.equal(log.fires, 1);
});

test('a place that leaves the reach starts from nothing when it returns', () => {
  const log = made(); const e = el(IN());
  place(log, 'boo', e);
  play(1000, 1300);
  FakeObserver.all[0]!.see(e, false);
  step(1350);
  FakeObserver.all[0]!.see(e, true);
  play(1400, 1700);
  assert.equal(log.fires, 0, 'what it had added is gone');
  play(1750, 1900);
  assert.equal(log.fires, 1);
});

test('a fling: a place in the band for 200ms in all fires nothing', () => {
  const log = made(); const e = el(IN());
  place(log, 'boo', e);
  play(1000, 1200);
  e.rects = [rect(900)]; emit('scroll'); play(1250, 1300);
  e.rects = [rect(100)]; emit('scroll'); play(1350, 1400);
  play(1450, 9000);
  assert.equal(log.fires, 0);
});

test('one frame adds at most 100ms: a 5-second gap with the place in the band adds 100ms', () => {
  const log = made(); const e = el(IN());
  place(log, 'boo', e);
  step(1000);
  step(6000);
  assert.equal(log.fires, 0, 'a tab that slept earns nothing');
  play(6050, 6250);
  assert.equal(log.fires, 0, '100 and 250 is 350');
  step(6300);
  assert.equal(log.fires, 1);
});

test('three places earned in one frame fire in document order, an airtime apart, whatever order they registered in', () => {
  const log = made();
  const third = inDocumentAt(el(IN()), 30); const first = inDocumentAt(el(rect(300, 310)), 10); const second = inDocumentAt(el(rect(340, 350)), 20);
  place(log, 'boo', third, {}, 'third'); place(log, 'boo', first, {}, 'first'); place(log, 'boo', second, {}, 'second');
  play(1000, 1350);
  assert.deepEqual(log.order, []);
  step(1400);
  assert.deepEqual(log.order, ['first'], 'the first at once');
  play(1450, 2550);
  assert.deepEqual(log.order, ['first'], 'the second waits the airtime');
  step(2600);
  assert.deepEqual(log.order, ['first', 'second']);
  play(2650, 3750);
  assert.deepEqual(log.order, ['first', 'second']);
  step(3800);
  assert.deepEqual(log.order, ['first', 'second', 'third']);
});

test('places on two posts queue in page order, the earlier post\'s first', () => {
  const a = made(); const b = made();
  const later = inDocumentAt(el(IN()), 50); const earlier = inDocumentAt(el(rect(330, 350)), 5);
  place(a, 'boo', later, {}, 'later'); place(b, 'boo', earlier, {}, 'earlier');
  play(1000, 1400);
  assert.equal(b.fires, 1);
  assert.equal(a.fires, 0);
  play(1450, 2600);
  assert.equal(a.fires, 1);
});

const LONG_AIR = { ...SCREEN, airMs: 3000, holdMs: 1000 };

test('an earned place that leaves the band while it waits fires when its turn comes inside holdMs; past holdMs it is unearned and earns again', () => {
  const log = made();
  const first = inDocumentAt(el(IN()), 1); const waits = inDocumentAt(el(rect(330, 350)), 2); const lapses = inDocumentAt(el(rect(300, 310)), 3);
  place(log, 'boo', first, {}, 'first', LONG_AIR); place(log, 'boo', waits, {}, 'waits', SCREEN); place(log, 'boo', lapses, {}, 'lapses', LONG_AIR);
  play(1000, 1400);
  assert.deepEqual(log.order, ['first']);
  assert.equal(__inspect().earned, 2);
  /* The second left at 1450 and its turn is 3000ms after the first's fire, within its own 4000ms; the third's 1000ms runs out first. */
  waits.rects = [OUT()]; lapses.rects = [OUT()]; emit('scroll');
  play(1450, 2450);
  assert.equal(__inspect().earned, 2, 'within holdMs of leaving both still hold their turn');
  play(2500, 2600);
  assert.equal(__inspect().earned, 1, 'the third lapsed, by itself');
  play(2650, 4400);
  assert.deepEqual(log.order, ['first', 'waits'], 'the second fired in its turn, and the lapsed one did not');
  lapses.rects = [IN()]; emit('scroll');
  play(5000, 5700);
  assert.deepEqual(log.order, ['first', 'waits', 'lapses'], 'read again, it earns again and fires');
});

test('an earned place that stays in the band waits as long as its turn takes: holdMs counts only from leaving', () => {
  const log = made();
  const first = inDocumentAt(el(IN()), 1); const stays = inDocumentAt(el(rect(330, 350)), 2);
  place(log, 'boo', first, {}, 'first', LONG_AIR); place(log, 'boo', stays, {}, 'stays', LONG_AIR);
  play(1000, 1400);
  play(1450, 4350);
  assert.deepEqual(log.order, ['first']);
  assert.equal(__inspect().earned, 1);
  step(4400);
  assert.deepEqual(log.order, ['first', 'stays']);
});

test('an earned place the observer drops from the reach keeps its turn, and lapses holdMs after it left', () => {
  const log = made();
  const first = inDocumentAt(el(IN()), 1); const gone = inDocumentAt(el(rect(330, 350)), 2); const lost = inDocumentAt(el(rect(300, 310)), 3);
  place(log, 'boo', first, {}, 'first', SCREEN); place(log, 'boo', gone, {}, 'gone', SCREEN); place(log, 'boo', lost, {}, 'lost', { ...SCREEN, airMs: 1200, holdMs: 1000 });
  play(1000, 1400);
  FakeObserver.all[0]!.see(gone, false); FakeObserver.all[0]!.see(lost, false);
  play(1450, 2650);
  assert.deepEqual(log.order, ['first', 'gone'], 'the dropped place fired in its turn; the one with a short hold lapsed');
  assert.equal(__inspect().earned, 0);
});

test('a place unregistered while earned never fires and never holds the queue', () => {
  const log = made();
  const first = inDocumentAt(el(IN()), 1); const second = inDocumentAt(el(rect(330, 350)), 2); const third = inDocumentAt(el(rect(300, 310)), 3);
  place(log, 'boo', first, {}, 'first'); const offSecond = place(log, 'boo', second, {}, 'second'); place(log, 'boo', third, {}, 'third');
  play(1000, 1400);
  assert.deepEqual(log.order, ['first']);
  offSecond();
  assert.equal(__inspect().earned, 1);
  play(1450, 2650);
  assert.deepEqual(log.order, ['first', 'third'], 'the third fires in the second\'s turn');
});

test('a place refreshed while earned with other pieces leaves the queue; one refreshed with the same pieces keeps its turn', () => {
  const log = made();
  const first = inDocumentAt(el(IN()), 1); const kept = inDocumentAt(el(rect(330, 350)), 2); const redrawn = inDocumentAt(el(rect(300, 310)), 3);
  let drawn: FakeEl = redrawn;
  place(log, 'boo', first, {}, 'first');
  const offKept = place(log, 'boo', kept, {}, 'kept');
  const offRedrawn = place(log, 'boo', redrawn, { els: () => [drawn as unknown as Element] }, 'redrawn');
  play(1000, 1400);
  assert.equal(__inspect().earned, 2);
  offKept.refresh();
  assert.equal(__inspect().earned, 2, 'the same pieces keep the turn');
  drawn = el(rect(300, 310));
  offRedrawn.refresh();
  assert.equal(__inspect().earned, 1, 'drawn again, it is not the words that were read');
  play(1450, 4000);
  assert.deepEqual(log.order, ['first', 'kept']);
});

test('the nearest place of the page decides the one murmur, whichever kind and post', () => {
  const a = made(); const b = made();
  const far = el(rect(640, 660)); const near = el(rect(600, 620)); const other = el(rect(620, 640));
  place(a, 'boo', far); place(b, 'boo', near); place(b, 'laugh', other);
  step(1000);
  const all = [...a.voices, ...b.voices];
  assert.equal(all.length, 1, 'one loop for the page');
  assert.equal(all[0]!.kind, 'boo');
  assert.equal(all[0]!.dead, false);
  const expected = (35 / 100) * (1 - (610 - BAND_BOTTOM) / 192);
  assert.ok(Math.abs(all[0]!.gains.at(-1)! - expected) < 1e-9, `the nearer place sets the gain: ${all[0]!.gains.at(-1)}`);
});

test('laugh and boo both near: exactly one live loop, of the nearer place\'s kind, and it is never made twice', () => {
  const log = made(); const laugh = el(rect(580, 600)); const boo = el(rect(650, 670));
  place(log, 'laugh', laugh); place(log, 'boo', boo);
  step(1000); emit('scroll'); step(1100); emit('scroll'); step(1200);
  assert.deepEqual(log.voices.map((v) => v.kind), ['laugh']);
  assert.equal(log.voices.filter((v) => !v.dead).length, 1);
  assert.ok(log.voices[0]!.gains.at(-1)! > 0);
});

test('the nearer place changing kind stops the old loop with the fade and makes the new kind\'s', () => {
  const log = made(); const laugh = el(rect(580, 600)); const boo = el(rect(650, 670));
  place(log, 'laugh', laugh); place(log, 'boo', boo);
  step(1000);
  laugh.rects = [rect(900, 920)]; boo.rects = [rect(520, 540)]; emit('scroll'); step(1100);
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

test('a fire stops the live murmur with the fade, and a place that is near afterward gets a fresh loop once the airtime is past', () => {
  const log = made(); const e = el(IN()); const f = el(OUT());
  const off1 = place(log, 'boo', e); const off2 = place(log, 'boo', f);
  step(1000);
  assert.equal(log.voices.length, 1);
  play(1050, 1400);
  assert.equal(log.fires, 1);
  assert.deepEqual(log.voices[0]!.stops, [250], 'the fire fades the murmur over fadeMs');
  assert.equal(log.voices.length, 1, 'no loop is made in the frame of the fire');
  play(1450, 2550);
  assert.equal(log.voices.length, 1, 'nor in the airtime after it, when the play did not sound');
  step(2600);
  assert.equal(log.voices.length, 2, 'the next near place makes a fresh loop');
  assert.equal(log.voices[1]!.dead, false);
  assert.ok(log.voices[1]!.gains.at(-1)! > 0);
  off1();
  assert.deepEqual(log.voices[1]!.stops, [], 'one place going leaves the other\'s murmur');
  off2();
  assert.deepEqual(log.voices[1]!.stops, [250], 'the last place going stops the loop with the fade');
});

test('the last unfired place firing leaves no loop to leak', () => {
  const log = made(); const e = el(IN());
  place(log, 'laugh', e);
  play(1000, 1400);
  assert.equal(log.fires, 1);
  assert.deepEqual(log.voices.map((v) => v.stops), [[250]]);
  assert.equal(log.voices.filter((v) => !v.dead).length, 0);
  assert.equal(frames.length, 0, 'and nothing waits');
});

test('two posts share the one voice: one going leaves it, and the last one stops it', () => {
  const a = made(); const b = made();
  const offA = place(a, 'boo', el(rect(540))); const offB = place(b, 'boo', el(rect(560)));
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
    const e = { getClientRects(): Rect[] { if (!isNear) throw new Error(`place ${n} is far and was measured`); nearMeasured++; return [rect(600 + n * 30)]; } };
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

test('frames run while the page scrolls or a place adds dwell or waits its turn, and stop when none does', () => {
  const log = made(); const e = el(IN()); const f = el(rect(330, 350)); const rest = el(OUT());
  place(log, 'cheer', e, {}, 'e'); place(log, 'cheer', f, {}, 'f');
  assert.equal(frames.length, 1, 'a place seen is looked at once');
  step(1000);
  assert.equal(frames.length, 1, 'places in the band ask for the next frame');
  play(1050, 1350);
  assert.equal(frames.length, 1);
  step(1400);
  assert.equal(log.order.length, 1, 'one fired, the other is earned and waits its turn');
  play(1450, 2550);
  assert.equal(frames.length, 1, 'a place waiting its turn asks for frames');
  step(2600);
  assert.equal(log.order.length, 2);
  assert.equal(frames.length, 0, 'nothing waits');
  place(log, 'cheer', rest, {}, 'rest');
  step(4000);
  assert.equal(frames.length, 0, 'a place near but out of the band, no hold, no queue: a still page asks for none');
  emit('scroll');
  assert.equal(frames.length, 1, 'a scroll wakes one');
  step(4100);
  assert.equal(frames.length, 0, 'and it rests again');
});

test('a take that answers with its length holds the murmur until its tail begins, then the nearest unfired place gets a loop', async () => {
  const log = made(); const e = el(IN()); const f = el(OUT());
  log.answer = () => Promise.resolve({ lengthMs: 2000 });
  place(log, 'cheer', e); place(log, 'boo', f);
  play(1000, 1400);
  await flush();
  assert.equal(log.fires, 1);
  assert.equal(log.voices.length, 1, 'only the murmur before the fire');
  play(1450, 3100);
  assert.equal(log.voices.length, 1, 'no loop is made until 1750ms after the fire');
  assert.equal(frames.length, 1, 'frames run through the hold');
  step(3150);
  assert.equal(log.voices.length, 2);
  assert.equal(log.voices[1]!.kind, 'boo');
  assert.ok(log.voices[1]!.gains.at(-1)! > 0, 'and it is raised');
  step(3200);
  assert.equal(frames.length, 0, 'once the hold is past a still page asks for none');
});

test('a play that answers null, or nothing, holds the murmur for the airtime and no longer', async () => {
  for (const answer of [() => Promise.resolve(null), () => undefined]) {
    const log = made(); log.answer = answer;
    const e = el(IN()); const f = el(OUT());
    const offs = [place(log, 'cheer', e), place(log, 'boo', f)];
    play(1000, 1400);
    await flush();
    play(1450, 2550);
    assert.equal(log.voices.length, 1);
    step(2600);
    assert.equal(log.voices.length, 2, 'the airtime is 1200ms');
    for (const off of offs) off();
    frames = [];
    await flush();
  }
});

test('a take that answers late, after the hold is over, does not hold the murmur again', async () => {
  const log = made(); const e = el(IN()); const f = el(OUT());
  let answer: (v: { lengthMs: number } | null) => void = () => {};
  log.answer = () => new Promise((resolve) => { answer = resolve; });
  place(log, 'cheer', e); place(log, 'boo', f);
  play(1000, 2600);
  assert.equal(log.voices.length, 2, 'the airtime passed and the murmur came back');
  const before = log.voices[1]!.gains.length;
  answer({ lengthMs: 9000 });
  await flush();
  play(2650, 3000);
  assert.ok(log.voices[1]!.gains.slice(before).every((g) => g > 0), 'it is not silenced');
  assert.equal(log.voices[1]!.dead, false);
});

test('a second fire during the hold moves the hold to the second take\'s own end', async () => {
  const log = made();
  const a = inDocumentAt(el(IN()), 1); const b = inDocumentAt(el(rect(330, 350)), 2); const c = inDocumentAt(el(OUT()), 3);
  const takes = [{ lengthMs: 9000 }, { lengthMs: 2000 }];
  let firstAnswer: (v: { lengthMs: number } | null) => void = () => {};
  log.answer = () => { const n = log.fires; return n === 1 ? new Promise((resolve) => { firstAnswer = resolve; }) : Promise.resolve(takes[1]!); };
  place(log, 'cheer', a, {}, 'a'); place(log, 'cheer', b, {}, 'b'); place(log, 'boo', c, {}, 'c');
  play(1000, 1400);
  firstAnswer(takes[0]!);
  await flush();
  assert.equal(log.fires, 1);
  play(1450, 2600);
  await flush();
  assert.equal(log.fires, 2, 'the second fires in the hold of the first (9000 less the fade)');
  const voices = log.voices.length;
  play(2650, 4300);
  assert.equal(log.voices.length, voices, 'held until the second take\'s own tail, 2600 + 1750');
  step(4350);
  assert.equal(log.voices.length, voices + 1);
  assert.equal(log.voices.at(-1)!.kind, 'boo');
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
  play(1000, 2600);
  assert.equal(log.fires, 2);
  assert.equal(__inspect().elements, 0, 'a fired place is no longer looked up by its pieces');
  assert.ok(!FakeObserver.all[0]!.observed.has(a) && !FakeObserver.all[0]!.observed.has(b), 'and no longer observed');
  assert.equal(__inspect().unfired, 0);
  offA();
  assert.equal(__inspect().places, 1);
  offB();
  assert.deepEqual(__inspect(), { places: 0, elements: 0, near: 0, earned: 0, unfired: 0, murmuring: false, listening: false });
});

test('the counter of unfired places follows a fire and an unregister', () => {
  const log = made(); const a = el(rect(320, 340)); const b = el(rect(700, 720));
  const offA = place(log, 'boo', a); place(log, 'boo', b);
  assert.equal(__inspect().unfired, 2);
  play(1000, 1400);
  assert.equal(__inspect().unfired, 1);
  offA();
  assert.equal(__inspect().unfired, 1, 'a fired place going does not count twice');
});

test('Game sounds toggled off and on: the dead loop is let go, and the next near frame makes a fresh one that sounds', () => {
  const log = made(); const e = el(rect(600, 620));
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

test('airMs 0: a take that answers right after its fire still holds the murmur until its own tail', async () => {
  const log = made(); const zero = { ...SCREEN, airMs: 0 };
  log.answer = () => Promise.resolve({ lengthMs: 4000 });
  place(log, 'cheer', el(IN()), {}, 'e', zero); place(log, 'boo', el(OUT()), {}, 'f', zero);
  play(1000, 1400);
  await flush();
  assert.equal(log.fires, 1);
  play(1450, 5100);
  assert.equal(log.voices.length, 1, 'no loop is made until 3750ms after the fire (4000 less the 250 fade)');
  step(5150);
  assert.equal(log.voices.length, 2);
  assert.ok(log.voices[1]!.gains.at(-1)! > 0);
});

test('a late answer that arrives before any tick has run past the airtime still holds the murmur', async () => {
  const log = made();
  let answer: (v: { lengthMs: number } | null) => void = () => {};
  log.answer = () => new Promise((resolve) => { answer = resolve; });
  place(log, 'cheer', el(IN())); place(log, 'boo', el(OUT()));
  play(1000, 2550);
  assert.equal(log.voices.length, 1);
  answer({ lengthMs: 4000 });
  await flush();
  play(2600, 5100);
  assert.equal(log.voices.length, 1, 'held to 1400 + 3750');
  step(5150);
  assert.equal(log.voices.length, 2);
});

test('a screen whose airMs is missing or NaN still fires a queue of two, spaced by the default 1200ms', () => {
  for (const airMs of [undefined, Number.NaN, -5]) {
    const log = made(); const bad = { ...SCREEN, airMs: airMs as unknown as number };
    const a = inDocumentAt(el(IN()), 1); const b = inDocumentAt(el(rect(330, 350)), 2);
    const offs = [place(log, 'boo', a, {}, 'a', bad), place(log, 'boo', b, {}, 'b', bad)];
    play(1000, 1400);
    assert.deepEqual(log.order, ['a']);
    play(1450, 2550);
    assert.deepEqual(log.order, ['a'], 'the default airtime is not skipped');
    step(2600);
    assert.deepEqual(log.order, ['a', 'b'], `airMs ${airMs}`);
    for (const off of offs) off();
    frames = [];
  }
});

test('a screen whose holdMs is NaN uses the default 4000ms: a waiting place that left lapses', () => {
  const log = made(); const bad = { ...SCREEN, airMs: 9000, holdMs: Number.NaN };
  const first = inDocumentAt(el(IN()), 1); const waits = inDocumentAt(el(rect(330, 350)), 2);
  place(log, 'boo', first, {}, 'first', bad); place(log, 'boo', waits, {}, 'waits', bad);
  play(1000, 1400);
  waits.rects = [OUT()]; emit('scroll'); step(1450);
  step(5450);
  assert.equal(__inspect().earned, 1, 'exactly the default hold keeps the turn');
  step(5451);
  assert.equal(__inspect().earned, 0, '1ms past loses it');
});

test('an answer whose lengthMs is NaN or negative holds the murmur for the airtime, as no answer does', async () => {
  for (const lengthMs of [Number.NaN, -1, undefined as unknown as number]) {
    const log = made(); log.answer = () => Promise.resolve({ lengthMs });
    const offs = [place(log, 'cheer', el(IN())), place(log, 'boo', el(OUT()))];
    play(1000, 1400);
    await flush();
    play(1450, 2550);
    assert.equal(log.voices.length, 1);
    step(2600);
    assert.equal(log.voices.length, 2, `lengthMs ${lengthMs}`);
    for (const off of offs) off();
    frames = [];
    await flush();
  }
});

test('a fire that throws leaves the place fired, the queue going, frames asked for and the murmur held for the airtime', () => {
  const log = made();
  log.answer = () => { if (log.fires === 1) throw new Error('boom'); };
  const a = inDocumentAt(el(IN()), 1); const b = inDocumentAt(el(rect(330, 350)), 2); const c = el(OUT());
  place(log, 'boo', a, {}, 'a'); place(log, 'boo', b, {}, 'b'); place(log, 'boo', c, {}, 'c');
  step(1000);
  assert.equal(log.voices.length, 1);
  play(1050, 1400);
  assert.deepEqual(log.order, ['a']);
  assert.equal(__inspect().unfired, 2);
  assert.equal(frames.length, 1, 'frames are still asked for');
  play(1450, 2550);
  assert.deepEqual(log.order, ['a']);
  assert.equal(log.voices.length, 1, 'held for the airtime');
  step(2600);
  assert.deepEqual(log.order, ['a', 'b'], 'the queue goes on');
});

test('a fire whose promise rejects leaves the place fired, the queue going, the murmur held for the airtime, and no unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => { unhandled.push(e); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const log = made();
    log.answer = () => (log.fires === 1 ? Promise.reject(new Error('no take')) : undefined);
    const a = inDocumentAt(el(IN()), 1); const b = inDocumentAt(el(rect(330, 350)), 2); const c = el(OUT());
    place(log, 'boo', a, {}, 'a'); place(log, 'boo', b, {}, 'b'); place(log, 'boo', c, {}, 'c');
    step(1000);
    play(1050, 1400);
    await flush();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log.order, ['a']);
    play(1450, 2550);
    assert.equal(log.voices.length, 1, 'held for the airtime');
    step(2600);
    assert.deepEqual(log.order, ['a', 'b']);
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('holdMs exactly keeps the turn; 1ms past loses it', () => {
  const log = made();
  const first = inDocumentAt(el(IN()), 1); const waits = inDocumentAt(el(rect(330, 350)), 2);
  place(log, 'boo', first, {}, 'first', LONG_AIR); place(log, 'boo', waits, {}, 'waits', LONG_AIR);
  play(1000, 1400);
  waits.rects = [OUT()]; emit('scroll'); step(1450);
  step(2450);
  assert.equal(__inspect().earned, 1, 'left at 1450, holdMs 1000: at 2450 it keeps its turn');
  step(2451);
  assert.equal(__inspect().earned, 0, 'at 2451 it is lost');
});

test('holdMs 0: an earned place that leaves the band keeps its turn for that frame only', () => {
  const log = made(); const zero = { ...SCREEN, airMs: 3000, holdMs: 0 };
  const first = inDocumentAt(el(IN()), 1); const waits = inDocumentAt(el(rect(330, 350)), 2);
  place(log, 'boo', first, {}, 'first', zero); place(log, 'boo', waits, {}, 'waits', zero);
  play(1000, 1400);
  assert.equal(__inspect().earned, 1);
  waits.rects = [OUT()]; emit('scroll'); step(1450);
  assert.equal(__inspect().earned, 1, 'the frame it left still holds');
  step(1451);
  assert.equal(__inspect().earned, 0, 'the next does not');
});

test('the last place going mid-hold, then a new registration: the old fire\'s stale answer holds nothing, and the new page starts clean', async () => {
  const log = made();
  let answer: (v: { lengthMs: number } | null) => void = () => {};
  log.answer = () => new Promise((resolve) => { answer = resolve; });
  const off = place(log, 'cheer', el(IN()), {}, 'old');
  play(1000, 1400);
  assert.equal(log.fires, 1);
  off();
  assert.equal(__inspect().listening, false);
  const fresh = made();
  place(fresh, 'boo', el(OUT()), {}, 'murmur');
  step(2000);
  assert.equal(fresh.voices.length, 1, 'no airtime of the old page holds the new one');
  answer({ lengthMs: 9000 });
  await flush();
  emit('scroll'); step(2050);
  assert.ok(fresh.voices[0]!.gains.at(-1)! > 0, 'the stale answer does not silence it');
  assert.equal(fresh.voices[0]!.dead, false);
  const quick = made();
  place(quick, 'boo', el(IN()), {}, 'quick');
  play(2100, 2550);
  assert.equal(quick.fires, 1, 'and nothing waits the old airtime before the new page fires');
});

test('a place that fired and was unregistered while its answer is pending: the take\'s hold still applies', async () => {
  const log = made();
  let answer: (v: { lengthMs: number } | null) => void = () => {};
  log.answer = () => new Promise((resolve) => { answer = resolve; });
  const offA = place(log, 'cheer', el(IN()), {}, 'a'); place(log, 'boo', el(OUT()), {}, 'b');
  play(1000, 1400);
  offA();
  answer({ lengthMs: 2000 });
  await flush();
  play(1450, 3100);
  assert.equal(log.voices.length, 1, 'held until 1400 + 1750');
  step(3150);
  assert.equal(log.voices.length, 2);
});

test('pieces drawn again while a place is still adding dwell lose what it had added', () => {
  const log = made(); let drawn = el(IN());
  const off = place(log, 'boo', drawn, { els: () => [drawn as unknown as Element] });
  play(1000, 1250);
  drawn = el(IN());
  off.refresh();
  FakeObserver.all[0]!.see(drawn);
  play(1300, 1600);
  assert.equal(log.fires, 0, 'the 250ms before the redraw is gone');
  play(1650, 1700);
  assert.equal(log.fires, 1, 'it earns again from nothing');
});
