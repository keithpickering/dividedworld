/**
 * Building a layer off the main thread (ink-field design section 5): buildLayer, the cost estimate, and the client that
 * sends heavy builds to one worker. Plain node: the client takes its worker and its frame clock as arguments, so a fake
 * worker that runs `serveBuilds` stands in for the browser's.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_MOST, denseGrid, splatInto, strokesInto } from './field.ts';
import { BAND_MOST_PX, BOX_NS, QUICK_MS, buildLayer, estimateWork, gridOf, layerKey, type BuildInput, type Built } from './build.ts';
import { IDLE_MS, createBuildClient } from './buildClient.ts';
import { serveBuilds, type BuildScope, type FromBuild, type ToBuild } from './buildWorker.ts';
import { makeSplat, type Box } from './splat.ts';
import { brushOf, type Stroke } from './scrub.ts';

const BOX: Box = { w: 120, h: 80 };
const pen = (points: [number, number][], extra: object = {}): Stroke => ({ tool: 'ink', color: 'black', ...brushOf(12, BOX), points, ...extra });
const wash = (points: [number, number][]): Stroke => ({ tool: 'wash', ...brushOf(16, BOX), points });
const SMALL: BuildInput = { seed: 7, color: '#202020', box: BOX, density: 1, strokes: [pen([[0.2, 0.3], [0.7, 0.5]], { drops: 2 }), wash([[0.3, 0.4], [0.5, 0.45]])] };
/** An input whose estimate is over QUICK_MS without costing a test a second: a big box, density 1. */
const BIG_BOX: Box = { w: 700, h: 500 };
const BIG: BuildInput = { ...SMALL, box: BIG_BOX, strokes: [pen([[0.1, 0.1], [0.9, 0.9]])] };

type Listener = (e: { data?: FromBuild; message?: string }) => void;
/** A worker the test steers: it holds the messages it was sent and answers one at a time when told to. */
class FakeWorker {
  static made: FakeWorker[] = [];
  /** The clock its builds are timed by (performance.now where left unset). */
  static now: (() => number) | undefined;
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
        const moved = m.kind === 'built' ? { ...m, built: { ...m.built, field: new Uint16Array(m.built.field), washed: new Uint8Array(m.built.washed), image: { ...m.built.image, data: new Uint8ClampedArray(m.built.image.data) } } } : m;
        for (const t of transfer) structuredClone(t, { transfer: [t] });
        this.later.push(() => this.emit('message', { data: moved }));
      },
    };
    serveBuilds(this.scope, FakeWorker.now);
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
const reset = () => { FakeWorker.made = []; FakeWorker.now = undefined; frames.length = 0; mock.timers.reset(); };
const same = (a: Built, b: Built) => {
  assert.deepEqual(a.field, b.field); assert.deepEqual(a.washed, b.washed);
  assert.equal(a.image.width, b.image.width); assert.equal(a.image.height, b.image.height);
  assert.deepEqual(a.image.data, b.image.data);
};

test('estimateWork: nanoseconds of work, the box plus each segment; the two inputs fall either side of QUICK_MS', () => {
  assert.equal(QUICK_MS, 12);
  const quick = QUICK_MS * 1e6;
  assert.equal(estimateWork(BOX, 1, []), 120 * 80 * BOX_NS);
  assert.ok(estimateWork(SMALL.box, 1, SMALL.strokes) < quick);
  assert.ok(estimateWork(BIG.box, 1, BIG.strokes) > quick);
  assert.ok(estimateWork(BOX, 2, SMALL.strokes) > 3 * estimateWork(BOX, 1, SMALL.strokes), 'density squares the points');
  const more = [...SMALL.strokes, wash([[0.1, 0.1], [0.9, 0.9]])];
  assert.ok(estimateWork(BOX, 1, more) > estimateWork(BOX, 1, SMALL.strokes), 'a stroke adds work');
  assert.ok(estimateWork({ w: 390, h: 1000 }, 1.5, []) > quick, 'a long post at density 1.5 is heavy');
});

/** A 390 x 1,400 post at density 1 and the band of 512 rows from row 512, with strokes above it, in it and across its edge. */
const TALL: Box = { w: 390, h: 1400 };
const MID = { row0: 512, rows: 512 };
const tallPen = (points: [number, number][]): Stroke => ({ tool: 'ink', color: 'black', ...brushOf(12, TALL), points });
const tallWash = (points: [number, number][]): Stroke => ({ tool: 'wash', ...brushOf(16, TALL), points });

test('estimateWork for a band: its own cells, and a stroke counts only the part of its reach inside the band\'s rows', () => {
  const cells = 390 * 512 * BOX_NS;
  assert.equal(estimateWork(TALL, 1, [], MID), cells);
  const above = [tallPen([[0.1, 0.02], [0.9, 0.1]]), tallWash([[0.1, 0.05], [0.9, 0.12]])];
  assert.equal(estimateWork(TALL, 1, above, MID), cells, 'strokes no row of the band reaches add nothing');
  assert.ok(estimateWork(TALL, 1, above) > estimateWork(TALL, 1, []), 'the whole post counts them');
  const below = [tallPen([[0.1, 0.9], [0.9, 0.95]])];
  assert.equal(estimateWork(TALL, 1, below, MID), cells);
  const inside = [tallPen([[0.1, 0.45], [0.9, 0.55]]), tallWash([[0.1, 0.5], [0.9, 0.5]])];
  const inBand = estimateWork(TALL, 1, inside, MID) - cells;
  assert.ok(inBand > 0, 'a stroke inside the band adds work');
  const across = [tallPen([[0.1, 0.34], [0.9, 0.36]])];
  const whole = estimateWork(TALL, 1, across) - 390 * 1400 * BOX_NS, part = estimateWork(TALL, 1, across, MID) - cells;
  assert.ok(part > 0 && part < whole, `a stroke across the edge counts a part (${part} of ${whole})`);
  assert.ok(estimateWork(TALL, 1, inside, { row0: 0, rows: 512 }) < estimateWork(TALL, 1, inside, MID), 'the same strokes cost a band they do not reach less');
});

test('estimateWork is calibrated: the largest band it calls light builds in under 2.5x the target, in Node (fastest of 5)', () => {
  // The most rows of a 390 wide post the estimate still calls light: if the box's weight were set too low, this band
  // would be taller and its real build slower, so the bound catches an underestimate of about 2.5x or more.
  const quick = QUICK_MS * 1e6;
  let rows = Math.floor(quick / (390 * BOX_NS));
  while (estimateWork(TALL, 1, [], { row0: 400, rows }) >= quick) rows--;
  const light: BuildInput = { ...SMALL, box: TALL, strokes: [], band: { row0: 400, rows } };
  buildLayer(light);
  let ms = Infinity;
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    buildLayer(light);
    ms = Math.min(ms, performance.now() - t);
  }
  // The fastest of five runs is the build's cost without a GC pause or a busy neighbor.
  assert.ok(ms < 2.5 * QUICK_MS, `${ms}ms for a 390 x ${rows} band called light`);
});

test('buildLayer refuses a band of more than BAND_MOST_PX points, and a band outside the lattice', () => {
  assert.equal(BAND_MOST_PX, 2_000_000);
  const box = { w: 390, h: 2000 };
  assert.throws(() => buildLayer({ ...SMALL, box, density: 3, strokes: [] }), /too many/, 'a whole post of 7M points');
  assert.throws(() => buildLayer({ ...SMALL, box, density: 2.5, strokes: [], band: { row0: 0, rows: 2052 } }), /too many/);
  assert.doesNotThrow(() => buildLayer({ ...SMALL, box, density: 2.5, strokes: [], band: { row0: 0, rows: 2051 } }), 'the cap is on the band, not the post');
  assert.throws(() => buildLayer({ ...SMALL, band: { row0: 70, rows: 20 } }), /outside/);
  assert.throws(() => buildLayer({ ...SMALL, band: { row0: -1, rows: 20 } }), /outside/);
});

test('layerKey names the play, box, density, the band\'s first row, the strokes\' count and last point, and the requester', () => {
  const k = layerKey('p1', BOX, 2, SMALL.strokes);
  assert.equal(k, 'p1|120x80|2|0|2|0.5,0.45|0');
  assert.notEqual(k, layerKey('p1', BOX, 2, SMALL.strokes.slice(0, 1)));
  assert.equal(layerKey('p1', BOX, 2, []), 'p1|120x80|2|0|0|-|0');
  assert.equal(layerKey('p1', BOX, 2, SMALL.strokes, 512, 3), 'p1|120x80|2|512|2|0.5,0.45|3');
  assert.notEqual(layerKey('p1', BOX, 2, SMALL.strokes, 512), layerKey('p1', BOX, 2, SMALL.strokes, 1024), 'each band has its own key');
  assert.notEqual(layerKey('p1', BOX, 2, SMALL.strokes, 0, 1), layerKey('p1', BOX, 2, SMALL.strokes, 0, 2), 'each requester has its own key');
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

test('a build reports ms from the injected clock, read once before the work and once after', () => {
  const reads = [100, 107.5];
  const b = buildLayer(SMALL, () => reads.shift()!);
  assert.equal(b.ms, 7.5);
  assert.equal(reads.length, 0, 'two reads');
  assert.ok(buildLayer(SMALL).ms >= 0, 'performance.now by default');
});

test('a band\'s field and washed marks carry one apron row each side, clipped to the lattice; its image does not', () => {
  const whole = buildLayer(SMALL);
  const cols = 120;
  for (const [row0, rows, above, below] of [[40, 20, 1, 1], [0, 20, 0, 1], [60, 20, 1, 0], [0, 80, 0, 0], [30, 1, 1, 1]] as const) {
    const input = { ...SMALL, band: { row0, rows } };
    const b = buildLayer(input);
    const held = rows + above + below;
    const label = `band ${row0}+${rows}`;
    assert.deepEqual(b.apron, { above, below }, label);
    assert.equal(b.field.length, cols * held, label);
    assert.equal(b.washed.length, cols * held, label);
    assert.deepEqual([b.image.width, b.image.height, b.image.data.length], [cols, rows, cols * rows * 4], label);
    for (let i = 0; i < cols * held; i++) {
      const at = (row0 - above) * cols + i;
      if (b.field[i] !== whole.field[at] || b.washed[i] !== whole.washed[at]) assert.fail(`${label}: field or washed differs from the whole's at index ${i}`);
    }
    for (let i = 0; i < cols * rows * 4; i++) if (b.image.data[i] !== whole.image.data[row0 * cols * 4 + i]) assert.fail(`${label}: image byte ${i} differs`);
    const grid = gridOf(b, BOX, 1, { row0, rows });
    assert.deepEqual([grid.cols, grid.rows, grid.row0], [cols, held, row0 - above], label);
    assert.throws(() => gridOf(b, BOX, 1, { row0, rows: rows + 1 }), /another box/, label);
    assert.throws(() => gridOf(b, BIG_BOX, 1, { row0, rows }), /another box/, label);
  }
});

test('the light path is taken under QUICK_MS of estimated work (no worker made, the answer at once); the worker above it', () => {
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

test('a late error while a build is out is fatal: the ask is rebuilt on the main thread, never left waiting', () => {
  reset();
  const c = clientWith();
  const got: string[] = [];
  const errors = mock.method(console, 'error', () => {});
  c.requestBuild('k', BIG, () => got.push('k'));
  const w = FakeWorker.made[0]!;
  w.answer(0);
  c.requestBuild('k2', BIG, () => got.push('k2'));
  w.emit('error', { message: 'crashed mid-build' });
  assert.equal(w.terminated, true, 'a worker that faults with a build out is let go');
  while (frames.length) frames.shift()!();
  assert.deepEqual(got, ['k', 'k2'], 'the build that was out is answered from the main thread');
  errors.mock.restore();
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

/** A client whose clock makes each main-thread build take `took.ms` (the clock is read twice a build). */
function pacedClient(over: object = {}) {
  const took = { ms: 0 };
  let reads = 0;
  const c = clientWith({ now: () => (reads++ % 2 === 0 ? 0 : took.ms), ...over });
  /** Builds `input` on the main thread as if it took `ratio` times its estimate. */
  const feed = (input: BuildInput, ratio: number) => {
    took.ms = (ratio * estimateWork(input.box, input.density, input.strokes, input.band)) / 1e6;
    c.requestBuild(`feed${reads}`, input, () => {});
  };
  return { c, feed };
}
/** About 1.04ms of estimated work: over the 1ms below which a build teaches the pace nothing, and light up to a pace of 11. */
const TEACH: BuildInput = { ...SMALL, box: { w: 56, h: 56 }, strokes: [] };
/** Estimated at about 4ms and about 20ms. */
const FOUR_MS: BuildInput = { ...SMALL, box: { w: 110, h: 110 }, strokes: [] };
const TWENTY_MS: BuildInput = { ...SMALL, box: { w: 246, h: 246 }, strokes: [] };

test('the pace starts at 1 and moves toward measured over estimated: 0.8 of it and 0.2 of the ratio', () => {
  reset();
  const { c, feed } = pacedClient();
  assert.equal(c.pace!(), 1);
  feed(TEACH, 3);
  assert.ok(Math.abs(c.pace!() - 1.4) < 1e-9, `${c.pace!()}`);
  feed(TEACH, 3);
  assert.ok(Math.abs(c.pace!() - 1.72) < 1e-9, `${c.pace!()}`);
  feed(TEACH, 0.5);
  assert.ok(Math.abs(c.pace!() - (0.8 * 1.72 + 0.1)) < 1e-9, 'a quicker build lowers it');
});

test('the pace stays within 0.25 and 8, and a build estimated under 1ms does not move it', () => {
  reset();
  const { c, feed } = pacedClient();
  for (let i = 0; i < 60; i++) { feed(TEACH, 1000); assert.ok(c.pace!() <= 8, `${c.pace!()} past 8`); }
  assert.equal(c.pace!(), 8);
  for (let i = 0; i < 80; i++) { feed(TEACH, 0); assert.ok(c.pace!() >= 0.25, `${c.pace!()} under 0.25`); }
  assert.equal(c.pace!(), 0.25);
  feed({ ...TEACH, box: { w: 10, h: 10 } }, 1000);
  assert.equal(c.pace!(), 0.25, 'about 33 microseconds of estimated work teaches nothing');
});

test('with the pace at 4 a band estimated at 4ms goes to the worker; at 0.5 one estimated at 20ms is built at once', () => {
  reset();
  assert.ok(estimateWork(FOUR_MS.box, 1, []) > 3.9e6 && estimateWork(FOUR_MS.box, 1, []) < 4.1e6);
  assert.ok(estimateWork(TWENTY_MS.box, 1, []) > 19.9e6 && estimateWork(TWENTY_MS.box, 1, []) < 20.1e6);
  const slow = pacedClient();
  for (let i = 0; i < 80; i++) slow.feed(TEACH, 4);
  assert.ok(Math.abs(slow.c.pace!() - 4) < 0.01);
  const got: Built[] = [];
  slow.c.requestBuild('four', FOUR_MS, (b) => got.push(b));
  assert.equal(FakeWorker.made.length, 1, 'about 16ms at this pace: the worker');
  assert.equal(got.length, 0);
  const quick = pacedClient();
  for (let i = 0; i < 80; i++) quick.feed(TEACH, 0.5);
  assert.ok(Math.abs(quick.c.pace!() - 0.5) < 0.01);
  quick.c.requestBuild('twenty', TWENTY_MS, (b) => got.push(b));
  assert.equal(FakeWorker.made.length, 1, 'about 10ms at this pace: no new worker');
  assert.equal(got.length, 1, 'built before requestBuild returned');
});

test('a build the worker made teaches the pace too, from the ms it reports', () => {
  reset();
  const ms = (3 * estimateWork(BIG.box, 1, BIG.strokes)) / 1e6;
  let reads = 0;
  FakeWorker.now = () => (reads++ % 2 === 0 ? 0 : ms);
  const c = clientWith();
  c.requestBuild('big', BIG, () => {});
  FakeWorker.made[0]!.answer(0);
  assert.ok(Math.abs(c.pace!() - 1.4) < 1e-9, `${c.pace!()}`);
});

test('the worker\'s build carries ms from its own injected clock', () => {
  const posted: FromBuild[] = [];
  const scope: BuildScope = { onmessage: null, postMessage: (m) => { posted.push(m); } };
  const reads = [5, 13];
  serveBuilds(scope, () => reads.shift()!);
  scope.onmessage!({ data: { kind: 'build', id: 1, input: SMALL } });
  const m = posted[0] as Extract<FromBuild, { kind: 'built' }>;
  assert.equal(m.built.ms, 8);
});

test('two requesters with identical inputs each hear their own onDone, and one\'s cancel leaves the other\'s build out', () => {
  reset();
  const c = clientWith();
  const a = c.requester!(), b = c.requester!();
  assert.notEqual(a, b);
  const keyOf = (who: number) => layerKey('p1', BIG.box, 1, BIG.strokes, 0, who);
  assert.notEqual(keyOf(a), keyOf(b));
  const calls: string[] = [];
  c.requestBuild(keyOf(a), BIG, () => calls.push('a'));
  c.requestBuild(keyOf(b), BIG, () => calls.push('b'));
  const w = FakeWorker.made[0]!;
  assert.equal(w.received.length, 2, 'neither replaced the other');
  w.answer(0); w.answer(1);
  assert.deepEqual(calls, ['a', 'b']);
  calls.length = 0;
  c.requestBuild(keyOf(a), BIG, () => calls.push('a'));
  c.requestBuild(keyOf(b), BIG, () => calls.push('b'));
  c.cancel(keyOf(a));
  w.answer(2); w.answer(3);
  assert.deepEqual(calls, ['b'], 'a left; b is still built and heard');
});
