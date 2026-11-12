import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createMixer } from './mixer.ts';
import type { SoundSlot } from './types.ts';

class FakeParam {
  value = 1;
  log: string[] = [];
  targets: Array<[number, number, number]> = [];
  ramps: Array<[number, number]> = [];
  setValueAtTime(v: number, t: number) { this.value = v; this.log.push(`set ${v} ${t}`); }
  cancelScheduledValues(t: number) { this.log.push(`cancel ${t}`); }
  linearRampToValueAtTime(v: number, t: number) { this.ramps.push([v, t]); this.log.push(`ramp ${v} ${t}`); }
  setTargetAtTime(v: number, t: number, c: number) { this.targets.push([v, t, c]); this.log.push(`target ${v} ${t}`); }
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

  it('8. a replaced voice has its pending ramps cancelled before its fade-out, and the new voice ramps in from 0', async () => {
    const m = make();
    await m.unlock();
    m.setBus('game', { on: true, volume: 100 });
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
    assert.deepEqual(newVoice.gain.log, ['set 0 10.5', 'ramp 1 12.5']);
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
    assert.equal(ctx.sources[0]!.stoppedAt, 10, 'the stopped loop is not stopped again by the group');
    assert.equal(v1.gain.log.filter((l) => l.startsWith('ramp')).length, 1);
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
});
