/**
 * Building a layer off the main thread (ink-field design section 5): buildLayer, the cost estimate, and the client that
 * sends heavy builds to one worker. Plain node: the client takes its worker and its frame clock as arguments, so a fake
 * worker that runs `serveBuilds` stands in for the browser's.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_MOST, denseGrid, splatInto, strokesInto } from './field.ts';
import { MAX_CANVAS_PX } from './paint.ts';
import { BOX_NS, QUICK_WORK, buildLayer, estimateWork, gridOf, layerKey, type BuildInput, type Built } from './build.ts';
import { IDLE_MS, createBuildClient } from './buildClient.ts';
import { serveBuilds, type BuildScope, type FromBuild, type ToBuild } from './buildWorker.ts';
import { makeSplat, type Box } from './splat.ts';
import { brushOf, type Stroke } from './scrub.ts';

const BOX: Box = { w: 120, h: 80 };
const pen = (points: [number, number][], extra: object = {}): Stroke => ({ tool: 'ink', color: 'black', ...brushOf(12, BOX), points, ...extra });
const wash = (points: [number, number][]): Stroke => ({ tool: 'wash', ...brushOf(16, BOX), points });
const SMALL: BuildInput = { seed: 7, color: '#202020', box: BOX, density: 1, strokes: [pen([[0.2, 0.3], [0.7, 0.5]], { drops: 2 }), wash([[0.3, 0.4], [0.5, 0.45]])] };
/** An input whose estimate is over QUICK_WORK without costing a test a second: a big box, density 1. */
const BIG_BOX: Box = { w: 700, h: 500 };
const BIG: BuildInput = { ...SMALL, box: BIG_BOX, strokes: [pen([[0.1, 0.1], [0.9, 0.9]])] };

type Listener = (e: { data?: FromBuild; message?: string }) => void;
/** A worker the test steers: it holds the messages it was sent and answers one at a time when told to. */
class FakeWorker {
  static made: FakeWorker[] = [];
  readonly received: ToBuild[] = [];
  readonly posted: FromBuild[] = [];
  readonly transfers: Transferable[][] = [];
  readonly listeners = new Map<string, Listener[]>();
  terminated = false;
  private readonly scope: BuildScope;
  constructor() {
    FakeWorker.made.push(this);
    this.scope = {
      onmessage: null,
      postMessage: (m, transfer = []) => {
        this.posted.push(m); this.transfers.push(transfer);
        /* A transfer detaches the sender's buffers, as a real worker's does; the page gets the same memory, moved. */
        const moved = m.kind === 'built' ? { ...m, built: { field: new Uint16Array(m.built.field), washed: new Uint8Array(m.built.washed), image: { ...m.built.image, data: new Uint8ClampedArray(m.built.image.data) } } } : m;
        for (const t of transfer) structuredClone(t, { transfer: [t] });
        this.later.push(() => this.emit('message', { data: moved }));
      },
    };
    serveBuilds(this.scope);
  }
  /** Answers not yet delivered to the page. */
  later: (() => void)[] = [];
  postMessage(m: ToBuild) { this.received.push(m); }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  terminate() { this.terminated = true; }
  emit(type: string, e: Parameters<Listener>[0]) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  /** The worker works through message number `n` (0-based) and its answer reaches the page. */
  answer(n: number) { this.scope.onmessage!({ data: this.received[n]! }); this.later.shift()!(); }
}
const frames: (() => void)[] = [];
const clientWith = (over: object = {}) => createBuildClient({ makeWorker: () => new FakeWorker(), nextFrame: (f: () => void) => { frames.push(f); }, ...over });
const reset = () => { FakeWorker.made = []; frames.length = 0; mock.timers.reset(); };
const same = (a: Built, b: Built) => {
  assert.deepEqual(a.field, b.field); assert.deepEqual(a.washed, b.washed);
  assert.equal(a.image.width, b.image.width); assert.equal(a.image.height, b.image.height);
  assert.deepEqual(a.image.data, b.image.data);
};

test('estimateWork: nanoseconds of work, the box plus each segment; the two inputs fall either side of QUICK_WORK', () => {
  assert.equal(QUICK_WORK, 15_000_000);
  assert.equal(estimateWork(BOX, 1, []), 120 * 80 * BOX_NS);
  assert.ok(estimateWork(SMALL.box, 1, SMALL.strokes) < QUICK_WORK);
  assert.ok(estimateWork(BIG.box, 1, BIG.strokes) > QUICK_WORK);
  assert.ok(estimateWork(BOX, 2, SMALL.strokes) > 3 * estimateWork(BOX, 1, SMALL.strokes), 'density squares the points');
  const more = [...SMALL.strokes, wash([[0.1, 0.1], [0.9, 0.9]])];
  assert.ok(estimateWork(BOX, 1, more) > estimateWork(BOX, 1, SMALL.strokes), 'a stroke adds work');
  assert.ok(estimateWork({ w: 390, h: 1000 }, 1.5, []) > QUICK_WORK, 'a long post at density 1.5 is heavy');
});

test('estimateWork is calibrated: a layer it calls light builds in under 3x the target, in Node', () => {
  const light: BuildInput = { ...SMALL, box: { w: 240, h: 240 }, strokes: [] };
  assert.ok(estimateWork(light.box, 1, light.strokes) < QUICK_WORK);
  buildLayer(light);
  const t = performance.now();
  buildLayer(light);
  const ms = performance.now() - t;
  assert.ok(ms < 3 * QUICK_WORK / 1e6, `${ms}ms for a layer called light`);
  const slow = { ...light, box: { w: 390, h: 1000 }, density: 1.5 };
  assert.ok(estimateWork(slow.box, slow.density, slow.strokes) > QUICK_WORK);
});

test('buildLayer refuses a density that makes more than MAX_CANVAS_PX', () => {
  const box = { w: 390, h: 2000 };
  assert.throws(() => buildLayer({ ...SMALL, box, density: 3, strokes: [] }), /MAX_CANVAS_PX|too many/);
  assert.ok(Math.ceil(390 * 2.5) * Math.ceil(2000 * 2.5) > MAX_CANVAS_PX);
  assert.throws(() => buildLayer({ ...SMALL, box, density: 2.5, strokes: [] }), /too many/);
});

test('layerKey names the play, box, density, and the strokes\' count and last point', () => {
  const k = layerKey('p1', BOX, 2, SMALL.strokes);
  assert.equal(k, 'p1|120x80|2|2|0.5,0.45');
  assert.notEqual(k, layerKey('p1', BOX, 2, SMALL.strokes.slice(0, 1)));
  assert.equal(layerKey('p1', BOX, 2, []), 'p1|120x80|2|0|-');
});

test('buildLayer: the splat and strokes through the field, shaded; the field is value x 4096 within 1/8192 of the float one', () => {
  const b = buildLayer(SMALL);
  const g = denseGrid(BOX, 1);
  splatInto(g, makeSplat(7), BOX); strokesInto(g, BOX, SMALL.strokes);
  assert.equal(b.field.length, 120 * 80);
  assert.deepEqual([b.image.width, b.image.height, b.image.data.length], [120, 80, 120 * 80 * 4]);
  let most = 0, ink = 0;
  for (let i = 0; i < g.values.length; i++) {
    const v = Math.min(FIELD_MOST, g.values[i]!);
    if (v < FIELD_MOST - 0.01) most = Math.max(most, Math.abs(b.field[i]! / 4096 - v));
    if (b.image.data[i * 4 + 3]! > 0) ink++;
  }
  assert.ok(most <= 1 / 8192, `rounding ${most}`);
  assert.ok(ink > 100, 'the picture has ink in it');
  assert.ok(b.washed.some((w) => w === 1), 'the wash is marked');
  const back = gridOf(b, BOX, 1);
  assert.ok(back.values instanceof Float32Array);
  for (let i = 0; i < g.values.length; i += 7) assert.ok(Math.abs(back.values[i]! - Math.min(FIELD_MOST, g.values[i]!)) <= 1 / 8192 + 1e-3 * (g.values[i]! >= FIELD_MOST ? 1 : 0));
  assert.deepEqual(back.washed, b.washed);
  assert.throws(() => gridOf(b, BIG_BOX, 1), /another box/);
});

test('the light path is taken under QUICK_WORK (no worker made, the answer at once); the worker above it', () => {
  reset();
  const c = clientWith();
  const got: Built[] = [];
  c.requestBuild('a', SMALL, (b) => got.push(b));
  assert.equal(got.length, 1, 'answered before requestBuild returned');
  assert.equal(FakeWorker.made.length, 0);
  same(got[0]!, buildLayer(SMALL));
  c.requestBuild('b', BIG, (b) => got.push(b));
  assert.equal(FakeWorker.made.length, 1);
  assert.equal(got.length, 1, 'not yet');
});

test('the worker\'s build is the main thread\'s, and the buffers arrive transferred and unused by the sender', () => {
  reset();
  const c = clientWith();
  const box: { got?: Built } = {};
  c.requestBuild('big', BIG, (b) => { box.got = b; });
  const w = FakeWorker.made[0]!;
  assert.deepEqual(w.received[0]!.kind, 'build');
  w.answer(0);
  const got = box.got!;
  assert.ok(got);
  same(got, buildLayer(BIG));
  const sent = (w.posted[0] as Extract<FromBuild, { kind: 'built' }>).built;
  assert.equal(w.transfers[0]!.length, 3, 'field, washed and image buffers transferred');
  assert.deepEqual([sent.field.byteLength, sent.washed.byteLength, sent.image.data.byteLength], [0, 0, 0], 'the worker\'s copies are detached');
  assert.ok(got.field.byteLength > 0 && got.field.buffer !== sent.field.buffer);
});

test('latest wins: a second request for a key replaces the waiting one, and the first\'s answer is dropped', () => {
  reset();
  const c = clientWith();
  const calls: string[] = [];
  c.requestBuild('k', BIG, () => calls.push('first'));
  const w = FakeWorker.made[0]!;
  c.requestBuild('k', BIG, () => calls.push('second'));
  c.requestBuild('k', { ...BIG, seed: 9 }, () => calls.push('third'));
  assert.equal(w.received.length, 1, 'one in flight for the key');
  w.answer(0);
  assert.deepEqual(calls, [], 'the first answer is stale');
  assert.equal(w.received.length, 2, 'the newest waiting one is sent now');
  assert.equal(w.received[1]!.input.seed, 9);
  w.answer(1);
  assert.deepEqual(calls, ['third']);
});

test('keys do not wait on each other', () => {
  reset();
  const c = clientWith();
  c.requestBuild('x', BIG, () => {}); c.requestBuild('y', BIG, () => {});
  assert.equal(FakeWorker.made[0]!.received.length, 2);
});

test('a post that left: its waiting build is dropped and its answer ignored', () => {
  reset();
  const c = clientWith();
  const calls: string[] = [];
  c.requestBuild('k', BIG, () => calls.push('in flight'));
  c.requestBuild('k', BIG, () => calls.push('waiting'));
  c.cancel('k');
  const w = FakeWorker.made[0]!;
  w.answer(0);
  assert.equal(calls.length, 0);
  assert.equal(w.received.length, 1, 'the waiting build was never sent');
  c.requestBuild('k', BIG, () => calls.push('back'));
  w.answer(1);
  assert.deepEqual(calls, ['back'], 'a key asked for again builds again');
});

test('the worker ends IDLE_MS after the last build, and a new one in the wait keeps it', () => {
  reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = clientWith();
  c.requestBuild('k', BIG, () => {});
  const w = FakeWorker.made[0]!;
  w.answer(0);
  mock.timers.tick(IDLE_MS - 1);
  assert.equal(w.terminated, false);
  c.requestBuild('k2', BIG, () => {});
  mock.timers.tick(IDLE_MS * 2);
  assert.equal(w.terminated, false, 'busy: no end while a build is out');
  w.answer(1);
  mock.timers.tick(IDLE_MS - 1);
  assert.equal(w.terminated, false);
  mock.timers.tick(1);
  assert.equal(w.terminated, true);
  c.requestBuild('k3', BIG, () => {});
  assert.equal(FakeWorker.made.length, 2, 'the next heavy build starts a new worker');
  reset();
});

test('no Worker, or one that fails to start: the build runs on the main thread in the next frame', () => {
  reset();
  for (const makeWorker of [null, () => { throw new Error('no worker'); }]) {
    const c = clientWith({ makeWorker });
    const got: Built[] = [];
    c.requestBuild('k', BIG, (b) => got.push(b));
    assert.equal(got.length, 0);
    assert.equal(frames.length, 1);
    frames.shift()!();
    assert.equal(got.length, 1);
    same(got[0]!, buildLayer(BIG));
  }
  const c = clientWith({ makeWorker: null });
  const calls: string[] = [];
  c.requestBuild('k', BIG, () => calls.push('one')); c.requestBuild('k', BIG, () => calls.push('two')); c.requestBuild('j', BIG, () => calls.push('gone')); c.cancel('j');
  while (frames.length) frames.shift()!();
  assert.deepEqual(calls, ['two'], 'latest wins and a cancel drops here too');
});

test('a worker that fails to load hands what it held to the main thread, next frame', () => {
  reset();
  const c = clientWith();
  const got: string[] = [];
  c.requestBuild('k', BIG, () => got.push('k')); c.requestBuild('k', BIG, () => got.push('k2'));
  FakeWorker.made[0]!.emit('error', { message: 'load failed' });
  assert.ok(FakeWorker.made[0]!.terminated);
  while (frames.length) frames.shift()!();
  assert.deepEqual(got, ['k2']);
});

test('the next-frame fallback builds one ask per frame, and a throwing onDone loses none of the rest', () => {
  reset();
  const c = clientWith({ makeWorker: null });
  const calls: string[] = [];
  const errors = mock.method(console, 'error', () => {});
  c.requestBuild('a', BIG, () => { calls.push('a'); throw new Error('boom'); });
  c.requestBuild('b', BIG, () => calls.push('b'));
  c.requestBuild('c', BIG, () => calls.push('c'));
  assert.equal(frames.length, 1);
  frames.shift()!();
  assert.deepEqual(calls, ['a'], 'one ask in a frame');
  assert.equal(frames.length, 1, 'the rest is scheduled');
  frames.shift()!();
  assert.deepEqual(calls, ['a', 'b']);
  frames.shift()!();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(frames.length, 0);
  errors.mock.restore();
});

test('a malformed message never kills the worker; it is answered failed', () => {
  const posted: FromBuild[] = [];
  const scope: BuildScope = { onmessage: null, postMessage: (m) => { posted.push(m); } };
  serveBuilds(scope);
  assert.doesNotThrow(() => scope.onmessage!({ data: null as unknown as ToBuild }));
  assert.doesNotThrow(() => scope.onmessage!({ data: { kind: 'build', id: 4 } as unknown as ToBuild }));
  assert.deepEqual(posted.map((m) => m.kind), ['failed'], 'one with an id is answered; one with nothing to answer is ignored');
  assert.equal(posted[0]!.id, 4);
});

test('a built reply with no built is treated as failed: the build runs on the main thread', () => {
  reset();
  const c = clientWith();
  const got: Built[] = [];
  c.requestBuild('k', BIG, (b) => got.push(b));
  FakeWorker.made[0]!.emit('message', { data: { kind: 'built', id: 1 } as unknown as FromBuild });
  assert.equal(got.length, 0);
  frames.shift()!();
  assert.equal(got.length, 1);
});

test('an error event after the worker has answered is not fatal; before it, it is', () => {
  reset();
  const c = clientWith();
  const got: string[] = [];
  const errors = mock.method(console, 'error', () => {});
  c.requestBuild('k', BIG, () => got.push('k'));
  const w = FakeWorker.made[0]!;
  w.answer(0);
  w.emit('error', { message: 'late' });
  assert.equal(w.terminated, false, 'a worker that has answered is kept');
  c.requestBuild('k2', BIG, () => got.push('k2'));
  assert.equal(w.received.length, 2, 'and still used');
  errors.mock.restore();
});
