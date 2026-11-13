/**
 * Whoops!'s suds (refinements plan Task 7). node:test with no DOM: a fake document makes the sprite
 * canvases and answers the motion setting, a fake requestAnimationFrame is stepped by hand, and every
 * canvas is a recorder, so what is checked is the pool, the loop and what is drawn on which canvas; the
 * look is the bench's and e2e/whoops.spec.ts's.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { probe, puff, register, unregister, wash } from './suds.ts';

interface Drawn { x: number; y: number; w: number }
interface Canvas { width: number; height: number; draws: number; clears: number; throwOnDraw: boolean; tf: number[]; drawn: Drawn[]; getContext(kind: string): unknown }
const canvas = (w = 400, h = 300): Canvas => {
  const cv: Canvas = {
    width: w, height: h, draws: 0, clears: 0, throwOnDraw: false, tf: [1, 0, 0, 1, 0, 0], drawn: [],
    getContext() {
      const grad = { addColorStop() {} };
      return new Proxy({}, {
        get: (_t, name) => {
          if (name === 'drawImage') {
            return (_img: unknown, x: number, y: number, w: number) => {
              if (cv.throwOnDraw) throw new Error('draw');
              cv.draws++;
              /* Where it lands on the canvas, in canvas px: the transform set last applied to the destination's corner. */
              cv.drawn.push({ x: cv.tf[4]! + cv.tf[0]! * x, y: cv.tf[5]! + cv.tf[3]! * y, w });
            };
          }
          if (name === 'setTransform') return (...a: number[]) => { cv.tf = a; };
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
let made: Canvas[] = [];
/** The sheen canvases made so far: the ones not the sprites' (sprites are 64, 32 and 24x36 px or smaller). */
const sheens = () => made.filter((c) => c.width * c.height > 64 * 64);
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
  made = [];
  set('document', {
    createElement: () => { const c = canvas(); made.push(c); return c; },
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

test('the wet sheen is held to 4M canvas px on a very tall box, and is let go once it has dried', () => {
  const host = {}, cv = canvas(390 * 2, 20000 * 2);
  register(host, asCanvas(cv), { w: 390, h: 20000 }, 2);
  wash(host, { x: 10, y: 100 }, { x: 200, y: 100 }, true);
  const [sheen] = sheens();
  assert.ok(sheen, 'a sheen canvas was made');
  assert.ok(sheen.width * sheen.height <= 4_000_000, `${sheen.width}x${sheen.height}`);
  for (let i = 0; i < 400 && probe.running(); i++) tick(50);
  assert.equal(probe.sheens(), 0, 'the dried host holds no sheen canvas');
});

test('a sheen on a small box keeps the screen\'s density, so it is not blurry', () => {
  const { host } = mount();
  wash(host, A, B, true);
  const [sheen] = sheens();
  assert.equal(sheen!.width, BOX.w * 2);
  assert.equal(sheen!.height, BOX.h * 2);
});

test('registering a host with a new box or density drops the old sheen', () => {
  const { host, cv } = mount();
  wash(host, A, B, true);
  assert.equal(probe.sheens(), 1);
  register(host, asCanvas(cv), { w: 500, h: 300 }, 2, '#cc2222');
  assert.equal(probe.sheens(), 0, 'a new box');
  wash(host, A, B, true);
  assert.equal(sheens().at(-1)!.width, 1000);
  register(host, asCanvas(cv), { w: 500, h: 300 }, 1, '#cc2222');
  assert.equal(probe.sheens(), 0, 'a new density');
  wash(host, A, B, true);
  register(host, asCanvas(cv), { w: 500, h: 300 }, 1, '#cc2222');
  assert.equal(probe.sheens(), 1, 'the same box and density keeps it');
});

test('the tinted sprites are keyed by the ink\'s color and held to 16', () => {
  const { host } = mount();
  for (const ink of ['#CC2222', '#cc2222', '#c22']) { register(host, asCanvas(canvas()), BOX, 2, ink); wash(host, A, B, true); }
  assert.equal(probe.tints(), 1, 'one color spelled three ways');
  for (let i = 0; i < 40; i++) { register(host, asCanvas(canvas()), BOX, 2, `#${(i + 16).toString(16)}0${(i + 16).toString(16)}0ff`); wash(host, A, B, true); }
  assert.ok(probe.tints() <= 16, `${probe.tints()} kept`);
});

test('a very long move spawns no more than a 400px one does', () => {
  const { host } = mount();
  wash(host, { x: 0, y: 10 }, { x: 400, y: 10 }, true);
  const ref = probe.size();
  unregister(host);
  const again = mount();
  wash(again.host, { x: 0, y: 10 }, { x: 20000, y: 10 }, true);
  assert.ok(probe.size() <= 400 / 8 + 400 / 16 + 1 + 12, `${probe.size()} spawned`);
  assert.ok(ref > 0);
});

/** The sprites a canvas was drawn (not the wet sheen, which is the box's width). */
const sprites = (c: Canvas) => c.drawn.filter((d) => d.w < 60);

test('a host registered with a span offset draws each particle at its box position less that offset', () => {
  const host = {}, cv = canvas(390 * 2, 2048 * 2);
  register(host, asCanvas(cv), { w: 390, h: 20000 }, 2, '#cc2222', 1536);
  wash(host, { x: 100, y: 1800 }, { x: 200, y: 1800 }, true);
  tick(16);
  const got = sprites(cv);
  assert.ok(got.length > 0, 'something was drawn');
  /* The wash is at box y 1800, which is 264 CSS px (528 canvas px) down the span; the spread of a brush's lather is under 60px. */
  for (const d of got) assert.ok(d.y > (264 - 60) * 2 && d.y < (264 + 60) * 2, `drawn at canvas y ${d.y}`);
});

test('a particle outside the span is not drawn and throws nothing', () => {
  const errors: unknown[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const host = {}, cv = canvas(390 * 2, 2048 * 2);
    register(host, asCanvas(cv), { w: 390, h: 20000 }, 2, '#cc2222', 1536);
    wash(host, { x: 100, y: 100 }, { x: 200, y: 100 }, true);
    wash(host, { x: 100, y: 9000 }, { x: 200, y: 9000 }, true);
    assert.ok(probe.size() > 0, 'the particles exist');
    tick(16);
    tick(16);
    assert.equal(sprites(cv).length, 0, 'nothing outside the span is drawn');
    assert.deepEqual(errors, []);
  } finally { console.error = realError; }
});

test('what is in the air survives a re-register with another offset, and is drawn at the new one', () => {
  const host = {}, cv = canvas(390 * 2, 2048 * 2);
  register(host, asCanvas(cv), { w: 390, h: 20000 }, 2, '#cc2222', 1536);
  wash(host, { x: 100, y: 2300 }, { x: 200, y: 2300 }, true);
  const n = probe.size();
  assert.ok(n > 0);
  register(host, asCanvas(cv), { w: 390, h: 20000 }, 2, '#cc2222', 2048);
  assert.equal(probe.size(), n, 'the pool is kept');
  cv.drawn.length = 0;
  tick(16);
  const got = sprites(cv);
  assert.ok(got.length > 0);
  for (const d of got) assert.ok(d.y > (252 - 60) * 2 && d.y < (252 + 60) * 2, `drawn at canvas y ${d.y}`);
});

/** A span of 2048 CSS px from box y 1536 at density 2, in a very tall box; the cull's margin is a little under 60px. */
const TOP = 1536, SPAN = 2048;
const spanned = () => { const host = {}, cv = canvas(390 * 2, SPAN * 2); register(host, asCanvas(cv), { w: 390, h: 20000 }, 2, '#cc2222', TOP); return { host, cv }; };
const washAt = (y: number, ms = 16) => {
  const { host, cv } = spanned();
  wash(host, { x: 100, y }, { x: 200, y }, true);
  tick(ms);
  return sprites(cv).length;
};

test('a wash a little outside the span, above or below it, is still drawn, and one well outside is not', () => {
  assert.ok(washAt(TOP - 30) > 0, 'just above the span (inside the margin)');
  assert.ok(washAt(TOP + SPAN + 30) > 0, 'just below the span (inside the margin, at density 2)');
  assert.equal(washAt(TOP - 100), 0, 'well above the span');
  assert.equal(washAt(TOP + SPAN + 100), 0, 'well below the span: its canvas px would still be inside the canvas height');
});

test('a drip is drawn when any of its run is in the span, and not when all of it is outside', () => {
  /* Math.random at 0 makes one drip (start `to.y + 5.25`, speed 8, pull 10) and, over a move this short, no lather or bubble. */
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const y0 = (y: number) => y - 15 * 0.35;
    const dripAt = (start: number, ms: number) => {
      const { host, cv } = spanned();
      wash(host, { x: 100, y: y0(start) }, { x: 100, y: y0(start) }, true);
      assert.equal(probe.count('run'), 1, 'one drip');
      tick(ms);
      const n = sprites(cv).length;
      probe.reset();
      return n;
    };
    const lo = TOP - 48, hi = TOP + SPAN + 48;
    /* y0 + 8*0.7 + 5*0.49 = y0 + 8.05 */
    assert.ok(dripAt(lo - 6, 700) > 0, 'starts above the margin and runs into it');
    assert.ok(dripAt(hi - 2, 700) > 0, 'starts inside the span and runs out of it');
    assert.equal(dripAt(lo - 100, 700), 0, 'wholly above the span');
    assert.equal(dripAt(hi + 100, 700), 0, 'wholly below the span, though inside the canvas height in canvas px');
  } finally { Math.random = realRandom; }
});
