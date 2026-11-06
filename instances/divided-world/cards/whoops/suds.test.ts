/**
 * Whoops!'s suds (refinements plan Task 7). node:test with no DOM: a fake document makes the sprite
 * canvases and answers the motion setting, a fake requestAnimationFrame is stepped by hand, and every
 * canvas is a recorder, so what is checked is the pool, the loop and what is drawn on which canvas; the
 * look is the bench's and e2e/whoops.spec.ts's.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { probe, puff, register, unregister, wash } from './suds.ts';

interface Canvas { width: number; height: number; draws: number; clears: number; throwOnDraw: boolean; getContext(kind: string): unknown }
const canvas = (w = 400, h = 300): Canvas => {
  const cv: Canvas = {
    width: w, height: h, draws: 0, clears: 0, throwOnDraw: false,
    getContext() {
      const grad = { addColorStop() {} };
      return new Proxy({}, {
        get: (_t, name) => {
          if (name === 'drawImage') return () => { if (cv.throwOnDraw) throw new Error('draw'); cv.draws++; };
          if (name === 'clearRect') return () => { cv.clears++; };
          if (name === 'createRadialGradient' || name === 'createLinearGradient' || name === 'createConicGradient') return () => grad;
          return () => {};
        },
        set: () => true,
      });
    },
  };
  return cv;
};
const asCanvas = (c: Canvas) => c as unknown as HTMLCanvasElement;

let clock = 0;
let pending = new Map<number, (t: number) => void>();
let nextId = 1;
let reduced = false;
const realRandom = Math.random;
const glob = globalThis as Record<string, unknown>;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const set = (k: string, v: unknown) => { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v }); };

/** One frame, `ms` later. */
const tick = (ms = 16) => {
  clock += ms;
  const run = [...pending.values()];
  pending = new Map();
  for (const f of run) f(clock);
};
const seed = (a: number) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

beforeEach(() => {
  clock = 1000; pending = new Map(); nextId = 1; reduced = false;
  set('document', {
    createElement: () => canvas(),
    documentElement: { getAttribute: () => (reduced ? 'reduce' : 'full') },
    defaultView: null,
  });
  set('requestAnimationFrame', (f: (t: number) => void) => { pending.set(nextId, f); return nextId++; });
  set('cancelAnimationFrame', (id: number) => { pending.delete(id); });
  set('performance', { now: () => clock });
  Math.random = seed(7);
  probe.reset();
});
afterEach(() => {
  probe.reset();
  Math.random = realRandom;
  for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete glob[k]; }
});

const BOX = { w: 400, h: 300 };
const mount = () => { const host = {}, cv = canvas(); register(host, asCanvas(cv), BOX, 2, '#cc2222'); return { host, cv }; };
const A = { x: 20, y: 100 };
const B = { x: 180, y: 100 };

test('a wash over ink spawns bubbles, lather and, over enough travel, drips; off ink there are fewer drips', () => {
  const { host } = mount();
  wash(host, A, B, true);
  assert.ok(probe.count('bubble') >= 8, 'about one bubble per 16px of travel');
  assert.ok(probe.count('foam') >= 10, 'about one lather cluster per 8px');
  assert.equal(probe.count('run'), 1, 'two times 160 / 140 is past certain');
  unregister(host);
  /* Over short travel the chance is below one, so the two rates show in many washes; unregistering between them empties the pool. */
  let over = 0, off = 0;
  const short = { x: A.x + 49, y: A.y };
  for (let i = 0; i < 200; i++) {
    const { host: h } = mount();
    wash(h, A, short, true); over += probe.count('run'); unregister(h);
    const { host: g } = mount();
    wash(g, A, short, false); off += probe.count('run'); unregister(g);
  }
  assert.ok(over > off * 1.8, `over ink ${over} drips against off ink ${off}`);
  assert.ok(off > 0);
});

test('a puff is a short wash over ink', () => {
  const { host } = mount();
  puff(host, { x: 50, y: 50 });
  assert.ok(probe.size() > 0);
  assert.ok(probe.running());
});

test('under reduced motion nothing is spawned and no loop starts', () => {
  const { host } = mount();
  reduced = true;
  wash(host, A, B, true);
  puff(host, A);
  assert.equal(probe.size(), 0);
  assert.equal(probe.running(), false);
  assert.equal(pending.size, 0);
});

test('a wash for a host that never registered does nothing', () => {
  wash({}, A, B, true);
  assert.equal(probe.size(), 0);
  assert.equal(probe.running(), false);
});

test('the pool never passes 900, and lather is dropped first', () => {
  const { host } = mount();
  for (let i = 0; i < 60; i++) {
    wash(host, { x: 0, y: 10 }, { x: 400, y: 10 }, true);
    assert.ok(probe.size() <= 900);
  }
  assert.equal(probe.size(), 900);
  const bubbles = probe.count('bubble');
  assert.ok(bubbles > 0);
  for (let i = 0; i < 20; i++) wash(host, { x: 0, y: 10 }, { x: 400, y: 10 }, true);
  assert.equal(probe.size(), 900);
  assert.ok(probe.count('bubble') >= bubbles, 'bubbles were not the ones dropped while lather remained');
});

test('the loop stops when the pool and every sheen are empty, and starts again on the next wash', () => {
  const { host } = mount();
  assert.equal(probe.running(), false, 'nothing runs before the first wash');
  wash(host, A, B, true);
  assert.equal(probe.running(), true);
  assert.equal(pending.size, 1);
  for (let i = 0; i < 400 && probe.running(); i++) tick(50);
  assert.equal(probe.size(), 0);
  assert.equal(probe.running(), false);
  assert.equal(pending.size, 0, 'no frame is left asked for');
  wash(host, A, B, true);
  assert.equal(probe.running(), true);
  assert.equal(pending.size, 1);
});

test('the wet sheen keeps the loop going until it dries, about 3.5s after the last wash', () => {
  const { host } = mount();
  wash(host, A, A, true);
  let ms = 0;
  while (probe.running() && ms < 20000) { tick(50); ms += 50; }
  assert.ok(ms >= 3500, `ran ${ms}ms, the sheen lasts 3500`);
  assert.equal(probe.running(), false);
});

test('a host that unregisters drops its particles and its canvas is never drawn again', () => {
  const a = mount(), b = mount();
  wash(a.host, A, B, true);
  wash(b.host, A, B, true);
  const total = probe.size();
  tick();
  assert.ok(a.cv.draws > 0 && b.cv.draws > 0);
  unregister(a.host);
  assert.ok(probe.size() < total && probe.size() > 0);
  const drawn = a.cv.draws, cleared = a.cv.clears;
  for (let i = 0; i < 10; i++) tick();
  assert.equal(a.cv.draws, drawn);
  assert.equal(a.cv.clears, cleared);
  assert.ok(b.cv.draws > 0);
  wash(a.host, A, B, true);
  assert.equal(a.cv.draws, drawn, 'an unregistered host is washed for nothing');
});

test('a draw that throws once does not stop the loop', () => {
  const { host, cv } = mount();
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (e: unknown) => { errors.push(e); };
  try {
    wash(host, A, B, true);
    cv.throwOnDraw = true;
    tick();
    assert.equal(errors.length, 1);
    assert.equal(probe.running(), true);
    assert.equal(pending.size, 1, 'the next frame was asked for');
    cv.throwOnDraw = false;
    const drawn = cv.draws;
    tick();
    assert.ok(cv.draws > drawn, 'and it draws again');
  } finally { console.error = log; }
});

test('when everything is gone the canvas is cleared once and left alone', () => {
  const { host, cv } = mount();
  wash(host, A, B, true);
  for (let i = 0; i < 400 && probe.running(); i++) tick(50);
  const cleared = cv.clears;
  assert.ok(cleared > 0);
  tick(50);
  assert.equal(cv.clears, cleared);
});
