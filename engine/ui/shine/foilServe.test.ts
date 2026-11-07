import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Band } from './band.ts';
import type { FoilDraw, FromWorker } from './foilProtocol.ts';
import { serveFoils, type FoilScope } from './foilServe.ts';

/* The worker's side, run in Node: a fake scope the test posts messages to, and a fake OffscreenCanvas (the foil makes its own grid canvas and
 * sprite from the global one, as it does in a worker). Every canvas keeps a log of what was done to it and at what size. */
type Log = [string, ...unknown[]][];
const everything: Log = [];
const canvases: FakeOffscreen[] = [];
class FakeOffscreen {
  width: number; height: number;
  throwOnContext = false;
  readonly calls: Log = [];
  readonly name: string;
  readonly ctx: Record<string, unknown>;
  constructor(w: number, h: number) {
    this.width = w; this.height = h; this.name = `c${canvases.length}`;
    canvases.push(this);
    const note = (what: string) => () => { this.calls.push([what, this.width, this.height]); everything.push([`${this.name}.${what}`, this.width, this.height]); };
    const grad = { addColorStop: () => {} };
    this.ctx = {
      canvas: this, save: note('save'), restore: note('restore'), setTransform: note('setTransform'), translate: () => {}, rotate: () => {},
      clearRect: note('clearRect'), fillRect: () => {}, beginPath: () => {}, fill: () => {}, ellipse: () => {}, rect: () => {}, clip: note('clip'),
      createRadialGradient: () => grad,
      createImageData: (cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
      putImageData: () => {}, drawImage: note('drawImage'),
      getImageData: (_x: number, _y: number, gw: number, gh: number) => ({ width: gw, height: gh, data: new Uint8ClampedArray(gw * gh * 4).fill(7) }),
    };
  }
  getContext(): unknown { if (this.throwOnContext) throw new Error('no context for you'); return this.ctx; }
}

/* A scope that hands what the test posts to the listeners, and keeps what the worker posts back. */
function scopeOf() {
  const listeners: ((e: { data: unknown }) => void)[] = [];
  const unreadable: ((e: { data: unknown }) => void)[] = [];
  const out: FromWorker[] = [];
  const scope: FoilScope = { addEventListener: (t, fn) => { (t === 'message' ? listeners : unreadable).push(fn); }, postMessage: (m) => { out.push(m as FromWorker); } };
  return { scope, out, send: (data: unknown) => { for (const l of listeners) l({ data }); }, unreadable: () => { for (const l of unreadable) l({ data: null }); } };
}

const LIGHT_BAND: Band = { lo: 0.59, hi: 1 };
const spec = (seed = 's') => ({ seed, pattern: 'pearl' as const, palette: ['#ffb9be', '#ffc09f', '#fff2a0', '#a8e6a1', '#9fd3ff', '#d8c0ff'], stars: 4, glint: '#ffffff' });
const draw = (id: number, over: Partial<FoilDraw> = {}): FoilDraw =>
  ({ id, spec: spec(), key: 'light', box: { w: 90, h: 45 }, density: 2, light: { x: 0, y: 0 }, band: LIGHT_BAND, now: 100, idle: false, ...over });
const adopt = (send: (d: unknown) => void, id: number): FakeOffscreen => { const c = new FakeOffscreen(300, 150); send({ kind: 'adopt', id, canvas: c }); return c; };
/** Each foil draw on a canvas (it saves the context once), with the canvas's width at that moment. */
const drawn = (c: FakeOffscreen) => c.calls.filter((x) => x[0] === 'save').map((x) => x[1] as number);

beforeEach(() => {
  everything.length = 0; canvases.length = 0;
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreen;
});
afterEach(() => {
  delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  mock.restoreAll();
});

describe('the foil worker', () => {
  test('a frame sizes each canvas to round(box x density) and then draws it, in the same task', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    assert.equal(c.width, 300, 'adopting changes nothing');
    send({ kind: 'frame', t: 16, draws: [draw(1, { box: { w: 90.4, h: 44.6 }, density: 1.5 })] });
    assert.deepEqual([c.width, c.height], [136, 67]);
    const at = everything.findIndex((e) => e[0] === `${c.name}.drawImage`);
    assert.ok(at >= 0, 'the foil drew on the canvas');
    assert.deepEqual(everything[at]!.slice(1), [136, 67], 'the canvas was already at its size when the grid was drawn over it');
  });

  test('a canvas already at its size is not sized again (that would clear it), and a different box resizes it', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    const sizes: string[] = [];
    let w = 0;
    Object.defineProperty(c, 'width', { get: () => w, set(v: number) { sizes.push(`w${v}`); w = v; } });
    send({ kind: 'frame', t: 1, draws: [draw(1)] });
    send({ kind: 'frame', t: 2, draws: [draw(1)] });
    assert.deepEqual(sizes, ['w180'], 'sized once');
    send({ kind: 'frame', t: 3, draws: [draw(1, { box: { w: 120, h: 60 } })] });
    assert.deepEqual(sizes, ['w180', 'w240']);
    assert.deepEqual([c.width, c.height], [240, 120]);
    assert.equal(drawn(c).at(-1), 240, 'drawn at the new size, in the same message');
  });

  test('a draw\'s span reaches the foil: after a whole draw it is clipped, and a canvas sized in the same task, or a draw with no span, is whole', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    const clips = () => c.calls.filter((x) => x[0] === 'clip').length;
    const span = { top: 30, bottom: 60 };
    const tall = { w: 90, h: 450 };
    send({ kind: 'frame', t: 1, draws: [draw(1, { box: tall, span })] });
    assert.equal(clips(), 0, 'sized in this task: whole');
    send({ kind: 'frame', t: 2, draws: [draw(1, { box: tall, span })] });
    assert.equal(clips(), 1, 'the span is honored');
    send({ kind: 'frame', t: 3, draws: [draw(1, { box: tall })] });
    assert.equal(clips(), 1, 'a draw with no span (an older page) is whole');
    send({ kind: 'frame', t: 4, draws: [draw(1, { box: { w: 90, h: 460 }, span })] });
    assert.equal(clips(), 1, 'resized: whole');
  });

  test('a null band clears the canvas and draws no foil', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    send({ kind: 'frame', t: 1, draws: [draw(1, { band: null })] });
    assert.deepEqual([c.width, c.height], [180, 90], 'sized all the same');
    assert.ok(c.calls.some((x) => x[0] === 'clearRect'));
    assert.deepEqual(drawn(c), []);
  });

  test('a changed key lets the canvas\'s other foil go, once, and draws with the new one', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    send({ kind: 'frame', t: 1, draws: [draw(1)] });
    const grid = canvases.find((x) => x !== c && x.width === 30 && x.height === 15);
    assert.ok(grid, 'the first foil made its grid canvas (90 / 3 by 45 / 3 cells)');
    send({ kind: 'frame', t: 2, draws: [draw(1)] });
    assert.deepEqual([grid.width, grid.height], [30, 15], 'the same key keeps the foil');
    send({ kind: 'frame', t: 3, draws: [draw(1, { key: 'dark', spec: spec('other') })] });
    assert.deepEqual([grid.width, grid.height], [0, 0], 'the old key\'s foil released its buffers');
    assert.equal(drawn(c).length, 3);
  });

  test('free releases the canvas\'s foils and zeroes it; the next draw sizes it and draws fresh', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    send({ kind: 'frame', t: 1, draws: [draw(1)] });
    const grid = canvases.find((x) => x !== c && x.width === 30)!;
    send({ kind: 'free', id: 1 });
    assert.deepEqual([c.width, c.height, grid.width, grid.height], [0, 0, 0, 0]);
    send({ kind: 'frame', t: 2, draws: [draw(1)] });
    assert.deepEqual([c.width, c.height], [180, 90]);
    assert.equal(drawn(c).at(-1), 180, 'sized and drawn in the same task');
  });

  test('drop frees and forgets: the canvas is gone from the probe and a draw for it is ignored', () => {
    const { scope, send, out } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    adopt(send, 2);
    send({ kind: 'frame', t: 1, draws: [draw(1), draw(2)] });
    send({ kind: 'drop', id: 1 });
    assert.deepEqual([c.width, c.height], [0, 0]);
    send({ kind: 'frame', t: 2, draws: [draw(1), draw(2)] });
    assert.deepEqual([c.width, c.height], [0, 0], 'not drawn after it was dropped');
    send({ kind: 'probe', nonce: 5, ask: 'sizes' });
    assert.deepEqual(out.at(-1), { kind: 'probe', nonce: 5, ask: 'sizes', sizes: [{ id: 2, width: 180, height: 90 }] });
  });

  test('one canvas that throws costs only that canvas its frame, and says so', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const a = adopt(send, 1), b = adopt(send, 2);
    const err = mock.method(console, 'error', () => {});
    a.throwOnContext = true;
    send({ kind: 'frame', t: 1, draws: [draw(1), draw(2)] });
    assert.equal(err.mock.calls.length, 1);
    assert.deepEqual(drawn(a), []);
    assert.equal(drawn(b).length, 1, 'the next canvas was drawn');
    a.throwOnContext = false;
    send({ kind: 'frame', t: 2, draws: [draw(1), draw(2)] });
    assert.equal(drawn(a).length, 1, 'and the first draws again next frame');
  });

  test('messages it does not know, and draws for canvases it was never given, are ignored', () => {
    const { scope, send, out } = scopeOf();
    serveFoils(scope);
    for (const m of [null, undefined, 'hello', 4, {}, { kind: 'story', poison: 'x' }, { kind: 'frame' }, { kind: 'frame', t: 1, draws: 'no' }, { kind: 'adopt', id: 1 }, { kind: 'free', id: 99 }, { kind: 'drop', id: 99 }]) {
      assert.doesNotThrow(() => send(m));
    }
    assert.doesNotThrow(() => send({ kind: 'frame', t: 1, draws: [draw(42)] }));
    assert.deepEqual(out.filter((m) => (m as { kind: string }).kind !== 'ack'), []);
  });

  test('the probe reads back sizes, its own time per frame, and a canvas\'s pixels', () => {
    const { scope, send, out } = scopeOf();
    serveFoils(scope);
    adopt(send, 1);
    send({ kind: 'probe', nonce: 1, ask: 'work', n: 10 });
    assert.deepEqual(out.at(-1), { kind: 'probe', nonce: 1, ask: 'work', batches: 0, work: [] });
    for (let t = 1; t <= 3; t++) send({ kind: 'frame', t, draws: [draw(1)] });
    send({ kind: 'probe', nonce: 2, ask: 'work', n: 2 });
    const w = out.at(-1) as Extract<FromWorker, { ask: 'work' }>;
    assert.equal(w.batches, 3);
    assert.equal(w.work.length, 2);
    assert.ok(w.work.every((x) => Number.isFinite(x) && x >= 0));
    send({ kind: 'probe', nonce: 3, ask: 'pixels', id: 1 });
    const p = out.at(-1) as Extract<FromWorker, { ask: 'pixels' }>;
    assert.deepEqual([p.nonce, p.width, p.height, p.data?.length, p.data?.[0]], [3, 180, 90, 180 * 90 * 4, 7]);
    send({ kind: 'probe', nonce: 4, ask: 'pixels', id: 77 });
    assert.deepEqual(out.at(-1), { kind: 'probe', nonce: 4, ask: 'pixels', width: 0, height: 0, data: null });
  });

  test('hooks.frame wraps each batch and is told its time; the draws run inside it, and its own time counts in the ring', () => {
    const { scope, send, out } = scopeOf();
    const seen: string[] = [];
    let c: FakeOffscreen;
    serveFoils(scope, {
      frame: (t, run) => {
        seen.push(`before ${t} ${drawn(c).length}`);
        const until = performance.now() + 5;
        while (performance.now() < until) { /* busy */ }
        run();
        seen.push(`after ${t} ${drawn(c).length}`);
      },
    });
    c = adopt(send, 1);
    send({ kind: 'frame', t: 7, draws: [draw(1)] });
    send({ kind: 'frame', t: 8, draws: [draw(1)] });
    assert.deepEqual(seen, ['before 7 0', 'after 7 1', 'before 8 1', 'after 8 2']);
    send({ kind: 'probe', nonce: 1, ask: 'work', n: 5 });
    const w = out.at(-1) as Extract<FromWorker, { ask: 'work' }>;
    assert.ok(w.work.every((x) => x >= 5), `the hook's 5 ms is in the batch's time: ${w.work.join(', ')}`);
  });

  test('every batch is acknowledged once it is drawn (so the page keeps one in flight), even when a canvas threw, and never before the draws', () => {
    const { scope, send, out } = scopeOf();
    const seen: string[] = [];
    serveFoils(scope, { frame: (t, run) => { run(); seen.push(`ran ${t} acks ${out.filter((m) => (m as { kind: string }).kind === 'ack').length}`); } });
    const a = adopt(send, 1);
    const err = mock.method(console, 'error', () => {});
    a.throwOnContext = true;
    send({ kind: 'frame', t: 5, draws: [draw(1)] });
    assert.equal(err.mock.calls.length, 1);
    assert.deepEqual(out, [{ kind: 'ack' }]);
    a.throwOnContext = false;
    send({ kind: 'frame', t: 6, draws: [draw(1)] });
    assert.deepEqual(out, [{ kind: 'ack' }, { kind: 'ack' }]);
    assert.deepEqual(seen, ['ran 5 acks 0', 'ran 6 acks 1']);
    send({ kind: 'frame', t: 7, draws: [draw(404)] });
    assert.equal(out.length, 3, 'a batch of draws for unknown canvases is acknowledged too');
  });

  test('a free or drop that throws costs only that canvas, and says so; the worker lives on', () => {
    const { scope, send } = scopeOf();
    serveFoils(scope);
    const a = adopt(send, 1), b = adopt(send, 2);
    const err = mock.method(console, 'error', () => {});
    Object.defineProperty(a, 'width', { get: () => 5, set() { throw new Error('no resize'); } });
    assert.doesNotThrow(() => send({ kind: 'free', id: 1 }));
    assert.doesNotThrow(() => send({ kind: 'drop', id: 1 }));
    assert.equal(err.mock.calls.length, 2);
    assert.doesNotThrow(() => send({ kind: 'free', id: 2 }));
    assert.deepEqual([b.width, b.height], [0, 0]);
  });

  test('a pixels probe that throws is answered with null', () => {
    const { scope, send, out } = scopeOf();
    serveFoils(scope);
    const c = adopt(send, 1);
    send({ kind: 'frame', t: 1, draws: [draw(1)] });
    const err = mock.method(console, 'error', () => {});
    (c.ctx as { getImageData: () => never }).getImageData = () => { throw new Error('tainted'); };
    assert.doesNotThrow(() => send({ kind: 'probe', nonce: 9, ask: 'pixels', id: 1 }));
    assert.deepEqual(out.at(-1), { kind: 'probe', nonce: 9, ask: 'pixels', width: 0, height: 0, data: null });
    assert.equal(err.mock.calls.length, 1);
  });

  test('a message it cannot read is logged and acknowledged, so the page does not wait on it for good', () => {
    const { scope, out, unreadable } = scopeOf();
    serveFoils(scope);
    const err = mock.method(console, 'error', () => {});
    unreadable();
    assert.equal(err.mock.calls.length, 1);
    assert.deepEqual(out, [{ kind: 'ack' }]);
  });

  test('the server hands back a canvas by id, for a story\'s worker entry', () => {
    const { scope, send } = scopeOf();
    const served = serveFoils(scope);
    const c = adopt(send, 3);
    assert.equal(served.canvas(3), c);
    assert.equal(served.canvas(4), undefined);
    send({ kind: 'drop', id: 3 });
    assert.equal(served.canvas(3), undefined);
  });
});
