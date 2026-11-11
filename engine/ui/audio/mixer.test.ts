import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createMixer } from './mixer.ts';
import type { SoundSlot } from './types.ts';

class FakeParam {
  value = 1;
  targets: Array<[number, number, number]> = [];
  ramps: Array<[number, number]> = [];
  setValueAtTime(v: number, _t: number) { this.value = v; }
  linearRampToValueAtTime(v: number, t: number) { this.ramps.push([v, t]); }
  setTargetAtTime(v: number, t: number, c: number) { this.targets.push([v, t, c]); }
}
class FakeGain {
  gain = new FakeParam();
  disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
}
class FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  started = false;
  stoppedAt: number | undefined;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() { this.started = true; }
  stop(when?: number) { this.stoppedAt = when ?? 0; }
}
class FakeContext {
  currentTime = 10;
  destination = {};
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  decoded = 0;
  failDecode = false;
  resume = mock.fn(async () => {});
  suspend = mock.fn(async () => {});
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  async decodeAudioData(_b: ArrayBuffer) {
    this.decoded += 1;
    if (this.failDecode) throw new Error('bad audio');
    return { duration: 1.5 };
  }
}

const slot = (key: string, extra: Partial<SoundSlot> = {}): SoundSlot => ({ key, src: `/${key}.mp3`, bus: 'game', caption: key, ...extra });
const boo = slot('boo');
const cheer = slot('cheer');

let ctx: FakeContext;
let makeContext: ReturnType<typeof mock.fn<() => FakeContext>>;
let fetchBytes: ReturnType<typeof mock.fn<(src: string) => Promise<ArrayBuffer>>>;
function make() {
  ctx = new FakeContext();
  makeContext = mock.fn(() => ctx);
  fetchBytes = mock.fn(async (_src: string) => new ArrayBuffer(8));
  return createMixer({ makeContext, fetchBytes } as never);
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
    assert.equal(busGain.gain.value, 0);
    assert.notEqual(src.stoppedAt, undefined);
    m.setBus('game', { on: true, volume: 100 });
    assert.equal(busGain.gain.value, 1);
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
});
