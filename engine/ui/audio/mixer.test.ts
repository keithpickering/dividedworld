import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createMixer, EDGE_MS } from './mixer.ts';
import * as mixerModule from './mixer.ts';
import type { SoundSlot } from './types.ts';

const finite = (n: number, what: string) => { if (!Number.isFinite(n)) throw new TypeError(`${what}: ${n} is not a finite number`); };
class FakeParam {
  cur = 1;
  log: string[] = [];
  targets: Array<[number, number, number]> = [];
  ramps: Array<[number, number]> = [];
  /** Like the real param, a non-finite value throws a TypeError. */
  get value(): number { return this.cur; }
  set value(v: number) { finite(v, 'value'); this.cur = v; }
  setValueAtTime(v: number, t: number) { finite(v, 'setValueAtTime'); this.cur = v; this.log.push(`set ${v} ${t}`); }
  cancelScheduledValues(t: number) { this.log.push(`cancel ${t}`); }
  linearRampToValueAtTime(v: number, t: number) { finite(v, 'linearRampToValueAtTime'); this.ramps.push([v, t]); this.log.push(`ramp ${v} ${t}`); }
  setTargetAtTime(v: number, t: number, c: number) { finite(v, 'setTargetAtTime'); this.targets.push([v, t, c]); this.log.push(`target ${v} ${t}`); }
}
type Ev = { type: 'set' | 'ramp' | 'target'; v: number; t: number; c: number; sched: number };
/**
 * A param that evaluates its timeline by the Web Audio spec's rules, for the cases the mixer uses: events ordered by time (ties in call order);
 * a ramp runs from the previous event's time and value to its own; a target approaches exponentially from the value where it starts;
 * cancelScheduledValues(t) drops every event at or after t (a ramp still in progress is dropped whole). `value` is the level last rendered, as
 * in a browser: it moves when the clock moves or an event is set, never when events are cancelled, so a read after a cancel is still the level heard.
 */
class EvalParam extends FakeParam {
  events: Ev[] = [];
  rendered = 1;
  clock: { currentTime: number };
  constructor(clock: { currentTime: number }) { super(); this.clock = clock; }
  override get value(): number { return this.rendered; }
  override set value(v: number) { finite(v, 'value'); this.push('set', v, this.clock.currentTime, 0); }
  push(type: Ev['type'], v: number, t: number, c: number) {
    this.events.push({ type, v, t, c, sched: this.clock.currentTime });
    this.render();
  }
  render() { this.rendered = this.at(this.clock.currentTime); }
  override setValueAtTime(v: number, t: number) { finite(v, 'setValueAtTime'); this.push('set', v, t, 0); }
  override linearRampToValueAtTime(v: number, t: number) { finite(v, 'linearRampToValueAtTime'); this.push('ramp', v, t, 0); }
  override setTargetAtTime(v: number, t: number, c: number) { finite(v, 'setTargetAtTime'); this.push('target', v, t, c); }
  override cancelScheduledValues(t: number) { this.events = this.events.filter((e) => e.t < t); }
  /** The level the param has at time `T`, by the timeline as it stands now. */
  at(T: number): number {
    type Seg = { start: number; to: number; t: number; c: number };
    const seg = (s: Seg, x: number) => (s.c === 0 ? s.start : s.to + (s.start - s.to) * Math.exp(-(x - s.t) / s.c));
    const evs = [...this.events].sort((a, b) => a.t - b.t);
    let cur: Seg = { start: 1, to: 1, t: -Infinity, c: 0 };
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]!;
      if (e.t > T) {
        if (e.type !== 'ramp') break;
        const t0 = i > 0 ? evs[i - 1]!.t : e.sched;
        const v0 = seg(cur, t0);
        return t0 >= e.t ? e.v : v0 + (e.v - v0) * ((T - t0) / (e.t - t0));
      }
      cur = e.type === 'target' ? { start: seg(cur, e.t), to: e.v, t: e.t, c: e.c } : { start: e.v, to: e.v, t: e.t, c: 0 };
    }
    return seg(cur, T);
  }
}
class FakeGain {
  gain: FakeParam;
  constructor(gain: FakeParam = new FakeParam()) { this.gain = gain; }
  disconnected = false;
  /** The node this gain was connected to: a bus gain's is the output. */
  to: unknown;
  connect(to?: unknown) { this.to = to; }
  disconnect() { this.disconnected = true; }
}
class FakeCompressor {
  threshold = { value: 0 };
  knee = { value: 0 };
  ratio = { value: 0 };
  attack = { value: 0 };
  release = { value: 0 };
  to: unknown;
  connect(to?: unknown) { this.to = to; }
  disconnect() {}
}
class FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  started = false;
  stoppedAt: number | undefined;
  stops = 0;
  disconnects = 0;
  onended: (() => void) | null = null;
  /** The node this source was connected to: its voice's gain. */
  to: unknown;
  connect(to?: unknown) { this.to = to; }
  disconnect() { this.disconnects += 1; }
  start() { this.started = true; }
  stop(when?: number) { this.stops += 1; this.stoppedAt = when ?? 0; }
}
class FakeContext {
  now = 10;
  /** True once a test wants every gain to evaluate its timeline (EvalParam). */
  timeline = false;
  evals: EvalParam[] = [];
  get currentTime() { return this.now; }
  set currentTime(t: number) { this.now = t; for (const p of this.evals) p.render(); }
  destination = {};
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  decoded = 0;
  failDecode = false;
  compressors: FakeCompressor[] = [];
  /** Set by a test to make the method throw; a test deletes the method itself for a context with none (an old WebKit). */
  throwCompressor = false;
  createDynamicsCompressor?: () => FakeCompressor = () => {
    if (this.throwCompressor) throw new Error('no compressor');
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
  };
  resume = mock.fn(async () => {});
  suspend = mock.fn(async () => {});
  createGain() {
    let p: FakeParam | undefined;
    if (this.timeline) { const e = new EvalParam(this); this.evals.push(e); p = e; }
    const g = new FakeGain(p);
    this.gains.push(g);
    return g;
  }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  /** Like the real one, it detaches the bytes it is given: handed the same ArrayBuffer twice, it rejects. */
  consumed = new WeakSet<ArrayBuffer>();
  async decodeAudioData(b: ArrayBuffer) {
    if (this.consumed.has(b)) throw new Error('DataCloneError: the ArrayBuffer is detached');
    this.consumed.add(b);
    this.decoded += 1;
    if (this.failDecode) throw new Error('bad audio');
    return { duration: 1.5 };
  }
}

const slot = (key: string, extra: Partial<SoundSlot> = {}): SoundSlot => ({ key, src: `/${key}.mp3`, bus: 'game', caption: key, ...extra });
const boo = slot('boo');
const cheer = slot('cheer');

let ctx: FakeContext;
/** The mixer's clock in milliseconds, which a test moves. */
let clock = 0;
let makeContext: ReturnType<typeof mock.fn<() => FakeContext>>;
let fetchBytes: ReturnType<typeof mock.fn<(src: string) => Promise<ArrayBuffer>>>;
function make() {
  ctx = new FakeContext();
  makeContext = mock.fn(() => ctx);
  fetchBytes = mock.fn(async (_src: string) => new ArrayBuffer(8));
  clock = 0;
  return createMixer({ makeContext, fetchBytes, now: () => clock } as never);
}
describe('mixer', () => {
  it('1. before unlock, play and loop return null and make no context', async () => {
    const m = make();
    m.setBus('game', { on: true, volume: 100 });
    assert.equal(await m.play(boo), null);
    assert.equal(await m.loop(boo), null);
    assert.equal(makeContext.mock.callCount(), 0);
    assert.equal(fetchBytes.mock.callCount(), 0);
    await m.unlock();
    assert.equal(makeContext.mock.callCount(), 1);
    await m.unlock();
    assert.equal(makeContext.mock.callCount(), 1);
    assert.ok(ctx.resume.mock.callCount() > 0);
  });

  it('2. an off bus returns null and fetches nothing; turned on later it fetches on first play', async () => {
    const m = make();
    await m.unlock();
    assert.equal(await m.play(boo), null);
    assert.equal(fetchBytes.mock.callCount(), 0);
    m.setBus('game', { on: true, volume: 50 });
    assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
    assert.equal(fetchBytes.mock.callCount(), 1);
    assert.equal(ctx.sources[0]?.started, true);
  });

  it('3. fetches and decodes once; a failure returns null and is retried; it never throws', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.play(boo);
    await m.play(boo);
    await Promise.all([m.play(cheer), m.play(cheer)]);
    assert.equal(fetchBytes.mock.callCount(), 2);
    assert.equal(ctx.decoded, 2);
    const bad = slot('bad');
    fetchBytes.mock.mockImplementationOnce(async () => { throw new Error('404'); });
    assert.equal(await m.play(bad), null);
    ctx.failDecode = true;
    assert.equal(await m.play(bad), null);
    ctx.failDecode = false;
    assert.deepEqual(await m.play(bad), { lengthMs: 1500 });
    assert.equal(fetchBytes.mock.calls.filter((c) => c.arguments[0] === '/bad.mp3').length, 3);
  });

  it('4. a bus gain is volume over 100; off sets 0 and stops its loops', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 40 });
    await m.play(boo);
    const busGain = ctx.gains[0]!;
    assert.ok(Math.abs((busGain.gain.value) - 0.4) < 1e-9);
    const h = await m.loop(slot('build', { loop: true }));
    assert.notEqual(h, null);
    const src = ctx.sources[ctx.sources.length - 1]!;
    assert.equal(src.loop, true);
    m.setBus('game', { on: false, volume: 40 });
    assert.equal(busGain.gain.targets.at(-1)![0], 0);
    assert.notEqual(src.stoppedAt, undefined);
    m.setBus('game', { on: true, volume: 100 });
    assert.equal(busGain.gain.targets.at(-1)![0], 1);
  });

  it('5. a sound in a group fades the group current out; other groups and none overlap', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.play(boo, { group: 'g', fadeMs: 500 });
    const first = ctx.sources[0]!;
    const firstVoice = ctx.gains[1]!;
    await m.play(cheer, { group: 'g', fadeMs: 500 });
    assert.ok(Math.abs(first.stoppedAt! - 10.5) < 1e-9);
    assert.deepEqual(firstVoice.gain.ramps.at(-1), [0, 10.5]);
    const second = ctx.sources[1]!;
    await m.play(boo, { group: 'h', fadeMs: 500 });
    await m.play(boo);
    assert.equal(second.stoppedAt, undefined);
  });

  it('6. a loop at gain 0 keeps its source but is silent; stop fades and disconnects', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    const h = (await m.loop(slot('build', { loop: true })))!;
    const src = ctx.sources[0]!;
    const voice = ctx.gains[1]!;
    h.setGain(0);
    assert.equal(voice.gain.targets.at(-1)![0], 0);
    assert.equal(src.stoppedAt, undefined);
    h.setGain(0.7);
    assert.ok(Math.abs((voice.gain.targets.at(-1)![0]) - 0.7) < 1e-9);
    h.stop(300);
    assert.ok(Math.abs(src.stoppedAt! - 10.3) < 1e-9);
    assert.deepEqual(voice.gain.ramps.at(-1), [0, 10.3]);
    src.onended?.();
    assert.equal(voice.disconnected, true);
  });

  it('7. suspend and resume call the context own', async () => {
    const m = make();
    await m.unlock();
    await m.suspend();
    assert.equal(ctx.suspend.mock.callCount(), 1);
    ctx.resume.mock.resetCalls();
    await m.resume();
    assert.equal(ctx.resume.mock.callCount(), 1);
  });

  it('8. a replaced voice has its pending ramps cancelled before its fade-out, and the new voice ramps in from 0', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    ctx.decodeAudioData = (async () => ({ duration: 4 })) as never; // long enough that a 2s fade-in is not clamped to half the file
    await m.play(boo, { group: 'g', fadeMs: 2000 });
    const oldVoice = ctx.gains[1]!;
    assert.deepEqual(oldVoice.gain.log.slice(0, 2), ['set 0 10', 'ramp 1 12']);
    ctx.currentTime = 10.5;
    await m.play(cheer, { group: 'g', fadeMs: 2000 });
    const log = oldVoice.gain.log;
    const cancel = log.indexOf('cancel 10.5');
    assert.ok(cancel > 1, 'cancelled after the fade-in was scheduled');
    assert.ok(log.indexOf('ramp 0 12.5') > cancel, 'fade-out ramps after the cancel');
    const newVoice = ctx.gains[2]!;
    assert.deepEqual(newVoice.gain.log.slice(0, 2), ['set 0 10.5', 'ramp 1 12.5']);
  });

  it('6b. a loop starts at gain 0, so it is silent until its owner raises it', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.loop(slot('build', { loop: true }));
    assert.equal(ctx.gains[1]!.gain.value, 0);
    assert.equal(ctx.sources[0]!.started, true);
  });

  it('6c. a loop cancelled before it resolves never starts a source and never replaces its group', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.loop(slot('build', { loop: true }), { group: 'g' });
    const first = ctx.sources[0]!;
    let cancelled = false;
    const pending = m.loop(slot('build2', { loop: true }), { group: 'g', cancelled: () => cancelled });
    cancelled = true;
    assert.equal(await pending, null);
    assert.equal(ctx.sources.length, 1, 'no second source was made');
    assert.equal(first.stoppedAt, undefined, 'the group\'s loop was not replaced');
  });

  it('9. setGain cancels what was scheduled before it targets', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    const h = (await m.loop(slot('build', { loop: true })))!;
    h.setGain(0.5);
    const log = ctx.gains[1]!.gain.log;
    assert.deepEqual(log.slice(-3), ['cancel 10', 'set 0 10', 'target 0.5 10']);
  });

  it('10c. a context running at once is unlocked though its resume() later rejects, with no unhandled rejection; a resume() returning nothing does not throw', async () => {
    const seen: unknown[] = [];
    const on = (e: unknown) => { seen.push(e); };
    process.on('unhandledRejection', on);
    try {
      const m = make();
      (ctx as { state?: string }).state = 'running';
      ctx.resume = mock.fn(() => Promise.reject(new Error('late refusal')));
      assert.equal(await m.unlock(), true);
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      assert.deepEqual(seen, [], 'the rejected resume is handled');
      const legacy = make();
      (ctx as { state?: string }).state = 'running';
      ctx.resume = mock.fn(() => undefined as unknown as Promise<void>);
      assert.equal(await legacy.unlock(), true);
    } finally { process.off('unhandledRejection', on); }
  });

  it('10b. two unlock() calls make one context and resume twice, and the first resolves true once the second resume resolves', async () => {
    const m = make();
    const resolvers: Array<() => void> = [];
    ctx.resume = mock.fn(() => new Promise<void>((r) => { resolvers.push(r); }));
    let first: boolean | undefined;
    const a = m.unlock().then((v) => { first = v; });
    const b = m.unlock();
    await Promise.resolve();
    assert.equal(makeContext.mock.callCount(), 1, 'one context');
    assert.equal(ctx.resume.mock.callCount(), 2, 'resume asked for each time');
    assert.equal(first, undefined, 'still waiting');
    resolvers[1]!();
    assert.equal(await b, true);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(first, true, 'the first is settled by the second resume');
  });

  it('10. a rejected resume leaves the mixer locked, and a later unlock can unlock it', async () => {
    const m = make();
    ctx.resume = mock.fn(async () => { throw new Error('blocked'); });
    m.setBus('game', { on: true, volume: 100 });
    assert.equal(await m.unlock(), false, 'a refused resume says it is still locked');
    assert.equal(await m.play(boo), null);
    assert.equal(await m.loop(boo), null);
    assert.equal(fetchBytes.mock.callCount(), 0);
    ctx.resume = mock.fn(async () => {});
    assert.equal(await m.unlock(), true, 'a resume that resolves says it is unlocked');
    assert.equal(makeContext.mock.callCount(), 1);
    assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
  });

  it('11. a stopped loop leaves its group, and a loop faded out by its group stops answering setGain', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    const l1 = (await m.loop(slot('build', { loop: true }), { group: 'g' }))!;
    const v1 = ctx.gains[1]!;
    l1.stop(0);
    await m.play(boo, { group: 'g', fadeMs: 100 });
    assert.ok(Math.abs(ctx.sources[0]!.stoppedAt! - 10.008) < 1e-9, 'the stopped loop is not stopped again by the group');
    assert.equal(v1.gain.log.filter((l) => l.startsWith('ramp')).length, 1, 'a loop has no ramp in, so its one ramp is the ramp out');
    const l2 = (await m.loop(slot('build2', { loop: true }), { group: 'g' }))!;
    const v2 = ctx.gains[3]!;
    await m.play(cheer, { group: 'g', fadeMs: 100 });
    const before = v2.gain.log.length;
    l2.setGain(0.9);
    assert.equal(v2.gain.log.length, before);
  });

  it('12. decodes with a legacy context whose decodeAudioData only calls its callbacks', async () => {
    const m = make();
    ctx.decodeAudioData = ((_b: ArrayBuffer, ok?: (b: { duration: number }) => void) => { ok?.({ duration: 2 }); }) as never;
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    assert.deepEqual(await m.play(boo), { lengthMs: 2000 });
    ctx.decodeAudioData = ((_b: ArrayBuffer, _ok?: unknown, fail?: (e: unknown) => void) => { fail?.(new Error('bad')); }) as never;
    assert.equal(await m.play(cheer), null);
  });

  it('13. a loop reports why it stopped: its bus going off, its group replacing it, or its own stop', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    const stops: string[] = [];
    const looping = slot('build', { loop: true });
    await m.loop(looping, { onStop: (r) => stops.push(`a:${r}`) });
    m.setBus('game', { on: false, volume: 100 });
    m.setBus('game', { on: true, volume: 100 });
    await m.loop(looping, { group: 'g', onStop: (r) => stops.push(`b:${r}`) });
    await m.loop(looping, { group: 'g' });
    const c = (await m.loop(looping, { onStop: (r) => stops.push(`c:${r}`) }))!;
    c.stop(0);
    c.stop(0);
    assert.deepEqual(stops, ['a:bus', 'b:replaced', 'c:stopped']);
  });

  const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;
  /** The `[value, time]` pairs a param was told with `set` (setValueAtTime) and `ramp` (linearRampToValueAtTime). */
  const marks = (g: FakeGain, kind: 'set' | 'ramp'): Array<[number, number]> => g.gain.log
    .filter((l) => l.startsWith(`${kind} `)).map((l) => l.split(' ').slice(1).map(Number) as [number, number]);
  const longer = (seconds: number) => { ctx.decodeAudioData = (async () => ({ duration: seconds })) as never; };
  const EDGE = EDGE_MS / 1000;

  it('14. a play in no group starts its voice at 0 and ramps to its level over EDGE_MS, never setting a level at the start', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.play(boo);
    const voice = ctx.gains[1]!;
    assert.equal(EDGE_MS, 8);
    assert.deepEqual(marks(voice, 'set')[0], [0, 10]);
    const rampIn = marks(voice, 'ramp')[0]!;
    assert.equal(rampIn[0], 1);
    assert.ok(near(rampIn[1], 10 + EDGE));
    assert.deepEqual(marks(voice, 'set').filter(([v, t]) => t === 10 && v !== 0), []);
  });

  it('15. a play with fadeMs 0 in a group ramps in over EDGE_MS, and the voice it replaces ramps out over EDGE_MS', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.play(boo, { group: 'g', fadeMs: 0 });
    const oldVoice = ctx.gains[1]!;
    await m.play(cheer, { group: 'g', fadeMs: 0 });
    const newVoice = ctx.gains[2]!;
    assert.ok(near(marks(newVoice, 'ramp')[0]![1], 10 + EDGE), 'the new voice ramps in');
    assert.ok(near(marks(oldVoice, 'ramp').at(-1)![1], 10 + EDGE), 'the old voice ramps out');
    assert.equal(marks(oldVoice, 'ramp').at(-1)![0], 0);
    assert.ok(near(ctx.sources[0]!.stoppedAt!, 10 + EDGE), 'and its source stops after the ramp, not at once');
  });

  it('16. a tail of 250ms of a 2-second buffer holds the level to 1.75s and ramps to 0 at 2s; a long, short or no tail is bounded', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(2);
    await m.play(boo, { tailMs: 250 });
    const v1 = ctx.gains[1]!;
    assert.ok(near(marks(v1, 'set').at(-1)![1], 11.75) && marks(v1, 'set').at(-1)![0] === 1);
    assert.deepEqual(marks(v1, 'ramp').at(-1), [0, 12]);
    await m.play(boo, { tailMs: 2 });
    await m.play(boo);
    for (const v of [ctx.gains[2]!, ctx.gains[3]!]) {
      assert.ok(near(marks(v, 'set').at(-1)![1], 12 - EDGE), 'a tail under EDGE_MS, or none, ramps over the last EDGE_MS');
      assert.deepEqual(marks(v, 'ramp').at(-1), [0, 12]);
    }
  });

  it('16b. a tail longer than the buffer never steps to a level at the start: it ramps up, then down to 0 at the end', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(2);
    await m.play(boo, { tailMs: 5000 });
    const v = ctx.gains[1]!;
    const rampIn = marks(v, 'ramp')[0]!;
    assert.equal(rampIn[0], 1);
    assert.deepEqual(marks(v, 'set').filter(([lv, t]) => lv !== 0 && t < rampIn[1] - 1e-9), [], 'no level is set before the ramp-in ends');
    assert.ok(marks(v, 'set').filter(([lv]) => lv !== 0).every(([, t]) => t >= rampIn[1] - 1e-9));
    assert.ok(rampIn[1] <= 11 + 1e-9, 'the ramp-in ends by the middle of the buffer');
    assert.deepEqual(marks(v, 'ramp').at(-1), [0, 12]);
  });

  it('16c. a buffer shorter than fade-in plus tail: the ramp-in ends by the middle, the tail starts there, and 0 is reached at the end', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(0.3);
    await m.play(boo, { group: 'g', fadeMs: 250, tailMs: 250 });
    const v = ctx.gains[1]!;
    const rampIn = marks(v, 'ramp')[0]!;
    assert.equal(rampIn[0], 1);
    assert.ok(rampIn[1] <= 10.15 + 1e-9, 'the ramp-in ends no later than the middle');
    assert.ok(near(marks(v, 'set').at(-1)![1], rampIn[1]) && marks(v, 'set').at(-1)![0] === 1, 'the tail starts at the ramp-in end');
    assert.deepEqual(marks(v, 'set').filter(([lv, t]) => lv !== 0 && t < rampIn[1] - 1e-9), []);
    assert.ok(near(marks(v, 'ramp').at(-1)![1], 10.3) && marks(v, 'ramp').at(-1)![0] === 0);
  });

  it('17. a voice replaced during its tail has the tail\'s ramp cancelled before its fade-out', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.play(boo, { group: 'g', fadeMs: 100, tailMs: 500 });
    const oldVoice = ctx.gains[1]!;
    ctx.currentTime = 11.2;
    await m.play(cheer, { group: 'g', fadeMs: 100 });
    const log = oldVoice.gain.log;
    const tailRamp = log.indexOf('ramp 0 11.5');
    const cancel = log.indexOf('cancel 11.2');
    assert.ok(tailRamp > -1 && cancel > tailRamp, 'cancelled after the tail was scheduled');
    assert.ok(log.findIndex((l, i) => i > cancel && l.startsWith('ramp 0 ') && Math.abs(Number(l.split(' ')[2]) - 11.3) < 1e-9) > cancel, 'the fade-out ramps after the cancel');
  });

  it('18. a slot\'s gain multiplies its level, and a loop\'s setGain clamps the caller\'s 0 to 1 before it multiplies', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    await m.play(slot('quiet', { gain: 0.5 }));
    assert.equal(marks(ctx.gains[1]!, 'ramp')[0]![0], 0.5);
    const h = (await m.loop(slot('build', { loop: true, gain: 0.5 })))!;
    h.setGain(0.4);
    assert.ok(near(ctx.gains[2]!.gain.targets.at(-1)![0], 0.2));
    const h4 = (await m.loop(slot('loud', { loop: true, gain: 4 })))!;
    h4.setGain(1);
    assert.equal(ctx.gains[3]!.gain.targets.at(-1)![0], 4);
    h4.setGain(7);
    assert.equal(ctx.gains[3]!.gain.targets.at(-1)![0], 4, 'the clamp is on the caller\'s value');
  });

  it('19. setBus on a bus whose node exists moves its gain with setTargetAtTime, never by setting value; the first busNode sets value', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 40 });
    await m.play(boo);
    const bus = ctx.gains[0]!;
    assert.ok(near(bus.gain.value, 0.4), 'the first busNode sets value');
    m.setBus('game', { on: true, volume: 80 });
    assert.ok(near(bus.gain.value, 0.4), 'value is not set again');
    assert.deepEqual(bus.gain.log.slice(-3), ['cancel 10', 'set 0.4 10', 'target 0.8 10']);
    assert.equal(bus.gain.targets.at(-1)![2], 0.015);
    m.setBus('game', { on: false, volume: 80 });
    assert.equal(bus.gain.targets.at(-1)![0], 0);
  });

  it('20. a slot with no gain is gain 1, and a gain that is not a finite number above 0 is read as 1', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    let i = 1;
    for (const g of [undefined, 0, -2, Number.NaN, Number.POSITIVE_INFINITY, '0.5' as unknown as number]) {
      await m.play(slot(`s${i}`, g === undefined ? {} : { gain: g }));
      assert.equal(marks(ctx.gains[i]!, 'ramp')[0]![0], 1, `gain ${String(g)}`);
      i += 1;
    }
  });

  it('21. a play replaced with less than the fade left ramps to 0 by its buffer\'s natural end, not past it', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(2);
    await m.play(boo, { group: 'g', fadeMs: 250 });
    const oldVoice = ctx.gains[1]!;
    ctx.currentTime = 11.9;
    await m.play(cheer, { group: 'g', fadeMs: 250 });
    assert.deepEqual(marks(oldVoice, 'ramp').at(-1), [0, 12], 'the ramp ends at the natural end, not at 12.15');
    assert.ok(near(ctx.sources[0]!.stoppedAt!, 12));
  });

  it('22. with less than EDGE_MS left, or the natural end already past, the fade-out still takes EDGE_MS and the source is stopped once', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(2);
    await m.play(boo, { group: 'g', fadeMs: 250 });
    ctx.currentTime = 11.998;
    await m.play(cheer, { group: 'g', fadeMs: 250 });
    assert.ok(near(marks(ctx.gains[1]!, 'ramp').at(-1)![1], 11.998 + EDGE), 'under EDGE_MS left: a ramp of EDGE_MS');
    assert.equal(ctx.sources[0]!.stops, 1);
    ctx.currentTime = 15;
    await m.play(boo, { group: 'g', fadeMs: 250 });
    assert.ok(near(marks(ctx.gains[2]!, 'ramp').at(-1)![1], 15 + EDGE), 'natural end past: a ramp of EDGE_MS, never zero or negative');
    assert.equal(ctx.sources[1]!.stops, 1);
  });

  it('23. a loop\'s fade-out is the full fade however long it has run, and a play with plenty left fades over the full fade', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(2);
    const h = (await m.loop(slot('build', { loop: true })))!;
    ctx.currentTime = 50;
    h.stop(250);
    assert.deepEqual(marks(ctx.gains[1]!, 'ramp').at(-1), [0, 50.25]);
    ctx.currentTime = 60;
    await m.play(boo, { group: 'g', fadeMs: 250 });
    ctx.currentTime = 60.1;
    await m.play(cheer, { group: 'g', fadeMs: 250 });
    assert.ok(near(marks(ctx.gains[2]!, 'ramp').at(-1)![1], 60.35));
  });

  it('24. a replaced voice stops once and disconnects once whichever of its natural end or its fade-out comes first; a bus going off stops no play, only loops', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(2);
    await m.play(boo, { group: 'g', fadeMs: 250 });
    ctx.currentTime = 11.9;
    await m.play(cheer, { group: 'g', fadeMs: 250 });
    const first = ctx.sources[0]!;
    first.onended?.();
    assert.deepEqual([first.stops, first.disconnects], [1, 1], 'replaced, then ended');
    const second = ctx.sources[1]!;
    second.onended?.();
    ctx.currentTime = 20;
    await m.play(boo, { group: 'g', fadeMs: 250 });
    assert.equal(second.stops, 0, 'a voice that ended before it was replaced is not stopped');
    m.setBus('game', { on: false, volume: 100 });
    assert.deepEqual(ctx.sources.map((s) => s.stops), [1, 0, 0]);
  });
  it('25. a loop\'s setGain(NaN) targets 0 and does not throw', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    const h = (await m.loop(slot('build', { loop: true })))!;
    assert.doesNotThrow(() => h.setGain(Number.NaN));
    assert.equal(ctx.gains[1]!.gain.targets.at(-1)![0], 0);
  });

  it('26. a loop\'s setGain(Infinity) and setGain of a non-number are not finite, so they read as 0 (Infinity does not clamp to 1), and do not throw', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    const h = (await m.loop(slot('build', { loop: true, gain: 2 })))!;
    for (const g of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0.5' as unknown as number, undefined as unknown as number]) {
      assert.doesNotThrow(() => h.setGain(g), String(g));
      assert.equal(ctx.gains[1]!.gain.targets.at(-1)![0], 0, `setGain(${String(g)})`);
    }
  });

  it('27. a bus volume that is not finite reads as 0, whether its node exists yet or not, and setBus does not throw', async () => {
    const m = make();
    await m.unlock();
    assert.doesNotThrow(() => m.setBus('game', { on: true, volume: Number.NaN }));
    await m.play(boo);
    const bus = ctx.gains[0]!;
    assert.equal(bus.gain.value, 0, 'the first busNode reads NaN as 0');
    m.setBus('game', { on: true, volume: 100 });
    for (const volume of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      assert.doesNotThrow(() => m.setBus('game', { on: true, volume }), String(volume));
      assert.equal(bus.gain.targets.at(-1)![0], 0, `volume ${String(volume)}`);
    }
  });

  const level = (g: FakeGain) => g.gain as EvalParam;
  const EPS = 1e-6;
  const make4 = async () => {
    const m = make();
    ctx.timeline = true;
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    longer(4);
    return m;
  };

  it('28. a voice replaced in the middle of its fade-in has no jump in the level heard, and reaches 0 by its fade-out\'s end', async () => {
    const m = await make4();
    await m.play(boo, { group: 'g', fadeMs: 2000 });
    const old = level(ctx.gains[1]!);
    ctx.currentTime = 10.5;
    const before = old.at(10.5 - EPS);
    assert.ok(near(before, 0.25, 1e-3), 'mid fade-in');
    await m.play(cheer, { group: 'g', fadeMs: 2000 });
    assert.ok(Math.abs(old.at(10.5 + EPS) - before) < 1e-3, `no jump: ${before} then ${old.at(10.5 + EPS)}`);
    assert.ok(near(old.at(12.5), 0) && near(old.at(13), 0), 'at 0 by the end of the fade-out');
  });

  it('29. a voice replaced in the middle of its tail has no jump in the level heard, and reaches 0 by its fade-out\'s end', async () => {
    const m = await make4();
    await m.play(boo, { group: 'g', fadeMs: 100, tailMs: 1000 });
    const old = level(ctx.gains[1]!);
    ctx.currentTime = 13.5;
    const before = old.at(13.5 - EPS);
    assert.ok(near(before, 0.5, 1e-3), 'mid tail');
    await m.play(cheer, { group: 'g', fadeMs: 100 });
    assert.ok(Math.abs(old.at(13.5 + EPS) - before) < 1e-3, `no jump: ${before} then ${old.at(13.5 + EPS)}`);
    assert.ok(near(old.at(13.6), 0) && near(old.at(14), 0), 'at 0 by the end of the fade-out');
  });

  it('30. a fresh play\'s level at its start time is 0, and it is at its level once the fade-in is done', async () => {
    const m = await make4();
    ctx.currentTime = 20;
    await m.play(boo, { tailMs: 500 });
    const v = level(ctx.gains[1]!);
    assert.equal(v.at(20), 0);
    assert.equal(v.value, 0, 'and so is the level read now');
    assert.ok(near(v.at(20 + EDGE), 1));
  });

  const flush = () => new Promise<void>((r) => setImmediate(r));

  it('31. warm before unlock fetches each src once and decodes nothing; unlock decodes each once, and a play then loads nothing more', async () => {
    const m = make();
    m.setBus('game', { on: true, volume: 100 });
    m.warm([boo, cheer]);
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 2);
    assert.equal(ctx.decoded, 0);
    await m.unlock();
    await flush();
    assert.equal(ctx.decoded, 2);
    assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
    assert.deepEqual(await m.play(cheer), { lengthMs: 1500 });
    assert.equal(fetchBytes.mock.callCount(), 2);
    assert.equal(ctx.decoded, 2);
  });

  it('32. warm after unlock fetches and decodes at once', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    m.warm([boo]);
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 1);
    assert.equal(ctx.decoded, 1);
    assert.equal(ctx.sources.length, 0, 'warm sounds nothing');
  });

  it('33. warm on an off bus fetches nothing; setBus on fetches it; off and on again fetches nothing more', async () => {
    const m = make();
    m.warm([boo]);
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 0);
    m.setBus('game', { on: true, volume: 100 });
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 1);
    m.setBus('game', { on: false, volume: 100 });
    m.setBus('game', { on: true, volume: 100 });
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 1);
  });

  it('34. two warms of one src, or a warm and a play together, fetch once and decode once', async () => {
    const m = make();
    m.setBus('game', { on: true, volume: 100 });
    m.warm([boo]);
    m.warm([boo]);
    await m.unlock();
    m.warm([boo]);
    const played = m.play(boo);
    m.warm([boo]);
    assert.deepEqual(await played, { lengthMs: 1500 });
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 1);
    assert.equal(ctx.decoded, 1);
  });

  it('35. a failed fetch through warm is forgotten: the next play fetches again and sounds', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    fetchBytes.mock.mockImplementationOnce(async () => { throw new Error('404'); });
    m.warm([boo]);
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 1);
    assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
    assert.equal(fetchBytes.mock.callCount(), 2);
  });

  it('36. a failed decode deletes both entries for the src: the next play fetches again and decodes again', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
    ctx.failDecode = true;
    m.warm([boo]);
    await flush();
    assert.equal(fetchBytes.mock.callCount(), 1);
    assert.equal(ctx.decoded, 1);
    ctx.failDecode = false;
    assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
    assert.equal(fetchBytes.mock.callCount(), 2);
    assert.equal(ctx.decoded, 2);
  });

  it('37. warm makes no context', async () => {
    const m = make();
    m.setBus('game', { on: true, volume: 100 });
    m.warm([boo]);
    await flush();
    assert.equal(makeContext.mock.callCount(), 0);
  });

  describe('lateMs', () => {
    /** A mixer whose decode waits on a gate, with a voice already sounding in group g. */
    const gated = async () => {
      const m = make();
      await m.unlock();
      m.setBus('game', { on: true, volume: 100 });
      await m.play(boo, { group: 'g', fadeMs: 100 });
      let open: () => void = () => {};
      const gate = new Promise<void>((r) => { open = r; });
      ctx.decodeAudioData = (async () => { await gate; return { duration: 1.5 }; }) as never;
      return { m, open };
    };

    it('38. a play that resolves after lateMs is null, starts no source, and leaves its group voice sounding', async () => {
      const { m, open } = await gated();
      const voice = ctx.sources[0]!.to as FakeGain;
      const rampsBefore = voice.gain.ramps.length;
      const logBefore = voice.gain.log.length;
      const pending = m.play(cheer, { group: 'g', fadeMs: 100, lateMs: 100 });
      clock = 150;
      open();
      assert.equal(await pending, null);
      assert.equal(ctx.sources.length, 1, 'no second source');
      assert.equal(ctx.sources[0]!.stoppedAt, undefined, 'the group voice was not stopped');
      assert.equal(voice.gain.ramps.length, rampsBefore, 'no fade-out ramp');
      assert.equal(voice.gain.log.length, logBefore, 'nothing was scheduled on its gain');
    });

    it('39. a play that resolves within lateMs sounds', async () => {
      const { m, open } = await gated();
      const pending = m.play(cheer, { group: 'g', fadeMs: 100, lateMs: 100 });
      clock = 50;
      open();
      assert.deepEqual(await pending, { lengthMs: 1500 });
      assert.equal(ctx.sources.length, 2);
    });

    it('40. a play with no lateMs sounds however late it resolves', async () => {
      const { m, open } = await gated();
      const pending = m.play(cheer, { group: 'g', fadeMs: 100 });
      clock = 1_000_000;
      open();
      assert.deepEqual(await pending, { lengthMs: 1500 });
      assert.equal(ctx.sources.length, 2);
    });

    it('41. a lateMs that is not finite (NaN, Infinity, -Infinity) is ignored: the play sounds however late', async () => {
      for (const lateMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const { m, open } = await gated();
        const pending = m.play(cheer, { group: 'g', fadeMs: 100, lateMs });
        clock = 1_000_000;
        open();
        assert.deepEqual(await pending, { lengthMs: 1500 }, String(lateMs));
        assert.equal(ctx.sources.length, 2);
      }
    });

    it('42. lateMs 0 with the file already decoded and the clock unmoved sounds', async () => {
      const m = make();
      await m.unlock();
      m.setBus('game', { on: true, volume: 100 });
      await m.play(boo);
      assert.deepEqual(await m.play(boo, { lateMs: 0 }), { lengthMs: 1500 });
      assert.equal(ctx.sources.length, 2);
    });

    it('46. lateMs 0 or less drops a play that had to wait at all', async () => {
      for (const lateMs of [0, -1]) {
        const { m, open } = await gated();
        const pending = m.play(cheer, { group: 'g', fadeMs: 100, lateMs });
        clock += 1;
        open();
        assert.equal(await pending, null, String(lateMs));
        assert.equal(ctx.sources.length, 1, 'no second source');
      }
    });
  });

  describe('warm, keys and bytes', () => {
    /** A fetch that waits on a gate, then hands a fresh ArrayBuffer. */
    const gatedFetch = () => {
      let open: () => void = () => {};
      const gate = new Promise<void>((r) => { open = r; });
      fetchBytes.mock.mockImplementation(async () => { await gate; return new ArrayBuffer(8); });
      return open;
    };

    it('43. two slots sharing a src on different buses are both remembered: turning the first bus on fetches the file', async () => {
      const m = make();
      m.setBus('game', { on: false, volume: 100 });
      m.setBus('interface', { on: false, volume: 100 });
      m.warm([slot('x', { bus: 'game' })]);
      m.warm([slot('x', { bus: 'interface' })]);
      m.setBus('game', { on: true, volume: 100 });
      await flush();
      assert.equal(fetchBytes.mock.callCount(), 1, 'x is fetched when the game bus is turned on');
    });

    it('44. a fetch still in flight when unlock runs: the warmed src is decoded exactly once after the fetch lands', async () => {
      const m = make();
      m.setBus('game', { on: true, volume: 100 });
      const open = gatedFetch();
      m.warm([boo]);
      await m.unlock();
      open();
      await flush();
      assert.equal(fetchBytes.mock.callCount(), 1);
      assert.equal(ctx.decoded, 1);
      assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
      assert.equal(ctx.decoded, 1);
    });

    it('45. a bus turned off and on while a warm\'s fetch is in flight fetches once in all', async () => {
      const m = make();
      m.setBus('game', { on: true, volume: 100 });
      const open = gatedFetch();
      m.warm([boo]);
      m.setBus('game', { on: false, volume: 100 });
      m.setBus('game', { on: true, volume: 100 });
      open();
      await flush();
      assert.equal(fetchBytes.mock.callCount(), 1);
      await m.unlock();
      await flush();
      assert.equal(fetchBytes.mock.callCount(), 1);
      assert.equal(ctx.decoded, 1);
    });
  });
  describe('voices and the limiter', () => {
    /** An unlocked mixer with the game bus on; `play` of one slot in group g with the given options, n times. */
    const unlocked = async () => {
      const m = make();
      await m.unlock();
      m.setBus('game', { on: true, volume: 100 });
      return m;
    };
    const stoppedAts = () => ctx.sources.map((s) => s.stoppedAt);

    it('47. with voices 3, three plays in a group start three sources and stop none', async () => {
      const m = await unlocked();
      for (let i = 0; i < 3; i++) await m.play(boo, { group: 'g', fadeMs: 100, voices: 3 });
      assert.equal(ctx.sources.length, 3);
      assert.deepEqual(stoppedAts(), [undefined, undefined, undefined]);
    });

    it('48. with voices 3, a fourth play stops the first source only, over max(fadeMs, EDGE_MS)', async () => {
      const m = await unlocked();
      for (let i = 0; i < 3; i++) await m.play(boo, { group: 'g', fadeMs: 100, voices: 3 });
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 3 });
      assert.equal(ctx.sources.length, 4);
      assert.ok(Math.abs(ctx.sources[0]!.stoppedAt! - (10 + Math.max(100, EDGE_MS) / 1000)) < 1e-9, 'the oldest fades out over the fade');
      assert.deepEqual(stoppedAts().slice(1), [undefined, undefined, undefined], 'the second, third and fourth are not stopped');
    });

    it('49. with voices 3, a voice that ended by itself leaves the pool, so a fourth play stops nothing', async () => {
      const m = await unlocked();
      for (let i = 0; i < 3; i++) await m.play(boo, { group: 'g', fadeMs: 100, voices: 3 });
      ctx.sources[0]!.onended?.();
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 3 });
      assert.equal(ctx.sources.length, 4);
      assert.deepEqual(stoppedAts(), [undefined, undefined, undefined, undefined]);
    });

    it('50. a voices that is NaN, 0, -1 or Infinity is read as 1, and 2.7 as 2', async () => {
      for (const voices of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
        const m = await unlocked();
        await m.play(boo, { group: 'g', fadeMs: 100, voices });
        await m.play(cheer, { group: 'g', fadeMs: 100, voices });
        assert.ok(ctx.sources[0]!.stoppedAt !== undefined, `voices ${voices}: the second play stops the first`);
      }
      const m = await unlocked();
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2.7 });
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2.7 });
      assert.deepEqual(stoppedAts(), [undefined, undefined], 'two fit under 2.7');
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 2.7 });
      assert.ok(ctx.sources[0]!.stoppedAt !== undefined, 'the third stops the first');
      assert.equal(ctx.sources[1]!.stoppedAt, undefined);
    });

    it('51. the cap is the newest play\'s: a play with voices 1 after three with voices 3 stops all three', async () => {
      const m = await unlocked();
      for (let i = 0; i < 3; i++) await m.play(boo, { group: 'g', fadeMs: 100, voices: 3 });
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 1 });
      assert.ok(ctx.sources.slice(0, 3).every((s) => s.stoppedAt !== undefined), 'all three stopped');
      assert.equal(ctx.sources[3]!.stoppedAt, undefined);
    });

    it('52. a late play into a full pool stops nothing', async () => {
      const m = await unlocked();
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      let open: () => void = () => {};
      const gate = new Promise<void>((r) => { open = r; });
      ctx.decodeAudioData = (async () => { await gate; return { duration: 1.5 }; }) as never;
      const pending = m.play(cheer, { group: 'g', fadeMs: 100, voices: 2, lateMs: 0 });
      clock = 50;
      open();
      assert.equal(await pending, null);
      assert.equal(ctx.sources.length, 2);
      assert.deepEqual(stoppedAts(), [undefined, undefined]);
    });

    it('53. a loop in a group stops every voice in it; it counts as a voice to later plays, and the cap stops it as a replaced loop', async () => {
      const m = await unlocked();
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      const onStop = mock.fn();
      await m.loop(slot('build', { loop: true }), { group: 'g', onStop });
      assert.ok(ctx.sources[0]!.stoppedAt !== undefined && ctx.sources[1]!.stoppedAt !== undefined, 'the loop stopped both plays');
      const loopSource = ctx.sources[2]!;
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 2 });
      assert.equal(loopSource.stoppedAt, undefined, 'a play with room leaves the loop sounding');
      assert.equal(onStop.mock.callCount(), 0);
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 2 });
      assert.ok(loopSource.stoppedAt !== undefined, 'the third voice stops the loop');
      assert.deepEqual(onStop.mock.calls.map((c) => c.arguments), [['replaced']]);
    });

    it('57. a smaller cap past a loop ends each voice once, and the pool holds only the new voice', async () => {
      const m = await unlocked();
      await m.loop(slot('build', { loop: true }), { group: 'g' });
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 3 });
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 3 });
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 1 });
      assert.deepEqual(ctx.sources.map((s) => s.stops), [1, 1, 1, 0], 'the loop and both plays end once');
      await m.play(cheer, { group: 'g', fadeMs: 100, voices: 3 });
      assert.deepEqual(ctx.sources.map((s) => s.stops), [1, 1, 1, 0, 0], 'the pool held one voice, so a cap of 3 ends nothing again');
    });

    it('58. a voice whose wrapped onended throws still leaves the pool', async () => {
      const m = await unlocked();
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      const first = ctx.sources[0]!;
      first.disconnect = () => { throw new Error('gone'); };
      assert.throws(() => first.onended?.());
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      await m.play(boo, { group: 'g', fadeMs: 100, voices: 2 });
      assert.deepEqual(ctx.sources.map((s) => s.stops), [0, 0, 0], 'the ended voice no longer counts toward the cap');
    });

    it('54. on the first play one compressor is made with the limiter values, connected to the destination, and the bus gain to it; a second bus makes no second', async () => {
      const m = await unlocked();
      m.setBus('interface', { on: true, volume: 100 });
      await m.play(boo);
      assert.equal(ctx.compressors.length, 1);
      const comp = ctx.compressors[0]!;
      const values = { threshold: comp.threshold.value, knee: comp.knee.value, ratio: comp.ratio.value, attack: comp.attack.value, release: comp.release.value };
      assert.deepEqual(values, { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 });
      assert.deepEqual(values, mixerModule.LIMITER, 'the exported LIMITER is those values');
      assert.equal(comp.to, ctx.destination);
      assert.equal(ctx.gains[0]!.to, comp, 'the game bus gain feeds the compressor');
      await m.play(slot('click', { bus: 'interface' }));
      assert.equal(ctx.compressors.length, 1, 'no second compressor');
      assert.equal(ctx.gains.find((g) => g !== ctx.gains[0] && g.to === comp) !== undefined, true, 'the interface bus feeds the same compressor');
    });

    for (const [name, arrange] of [
      ['55. a context with no createDynamicsCompressor', () => { delete ctx.createDynamicsCompressor; }],
      ['56. a createDynamicsCompressor that throws', () => { ctx.throwCompressor = true; }],
    ] as const) {
      it(`${name} connects the bus gain to the destination, and the play resolves`, async () => {
        const m = make();
        arrange();
        await m.unlock();
        m.setBus('game', { on: true, volume: 100 });
        assert.deepEqual(await m.play(boo), { lengthMs: 1500 });
        assert.equal(ctx.gains[0]!.to, ctx.destination);
        assert.equal(ctx.compressors.length, 0);
      });
    }
  });
});
