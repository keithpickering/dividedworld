/* A .test.tsx because the client reads the DOM (a canvas element's transferControlToOffscreen); `test:engine` runs .test.ts under plain node. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Band } from './band.ts';
import { adoptFoil, foilProbe, offscreenFoils, setFoilWorker } from './foilClient.ts';
import type { FromWorker } from './foilProtocol.ts';

/* A worker the test can watch: what it was sent (with the transfer list), whether it was ended, and answers to probes. */
class FakeWorker {
  static made: FakeWorker[] = [];
  readonly sent: { message: Record<string, unknown>; transfer: unknown[] }[] = [];
  terminated = false;
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  answers: Partial<Record<string, (m: Record<string, unknown>) => FromWorker>> = {};
  constructor(readonly url?: unknown, readonly options?: unknown) { FakeWorker.made.push(this); }
  postMessage(message: Record<string, unknown>, transfer: unknown[] = []) {
    this.sent.push({ message, transfer });
    const reply = message.kind === 'probe' ? this.answers[message.ask as string]?.(message) : undefined;
    if (reply) queueMicrotask(() => this.emit('message', { data: reply }));
  }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener() {}
  terminate() { this.terminated = true; }
  emit(type: string, e: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  of(kind: string) { return this.sent.filter((s) => s.message.kind === kind); }
}
class FakeOffscreen { constructor(readonly of: HTMLCanvasElement) {} }

const proto = HTMLCanvasElement.prototype as unknown as { transferControlToOffscreen?: () => unknown };
let transfers = 0;
const supported = () => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
  proto.transferControlToOffscreen = function (this: HTMLCanvasElement) { transfers++; return new FakeOffscreen(this); };
};
const BAND: Band = { lo: 0.59, hi: 1 };
const spec = { seed: 's', pattern: 'pearl' as const, palette: ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'], stars: 4, glint: '#ffffff' };
const drawArgs = (t = 16) => [spec, 'light', { w: 90, h: 45 }, 2, { x: 0.1, y: -0.2 }, BAND, t, false] as const;
const flushMicrotasks = () => Promise.resolve().then(() => undefined);

beforeEach(() => { FakeWorker.made = []; transfers = 0; setFoilWorker(() => new FakeWorker() as unknown as Worker); });
afterEach(() => {
  foilProbe.reset();
  setFoilWorker(null);
  delete proto.transferControlToOffscreen;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the foil client', () => {
  it('offscreenFoils is true only where Worker, OffscreenCanvas and transferControlToOffscreen are all present', () => {
    expect(offscreenFoils(), 'jsdom has none of them').toBe(false);
    supported();
    expect(offscreenFoils()).toBe(true);
    expect(FakeWorker.made, 'asking makes no worker').toHaveLength(0);
    vi.stubGlobal('Worker', undefined);
    expect(offscreenFoils(), 'no Worker').toBe(false);
    supported();
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(offscreenFoils(), 'no OffscreenCanvas').toBe(false);
    supported();
    delete proto.transferControlToOffscreen;
    expect(offscreenFoils(), 'no transferControlToOffscreen').toBe(false);
  });

  it('adopting transfers the canvas once, starts the worker then, and posts adopt with the canvas in the transfer list', () => {
    supported();
    const cv = document.createElement('canvas');
    expect(FakeWorker.made).toHaveLength(0);
    adoptFoil(cv);
    expect(transfers).toBe(1);
    expect(FakeWorker.made).toHaveLength(1);
    const [adopt] = FakeWorker.made[0]!.of('adopt');
    expect(adopt!.message).toMatchObject({ kind: 'adopt', id: foilProbe.idOf(cv) });
    const sent = adopt!.message.canvas as FakeOffscreen;
    expect(sent).toBeInstanceOf(FakeOffscreen);
    expect(sent.of).toBe(cv);
    expect(adopt!.transfer).toEqual([sent]);
    adoptFoil(document.createElement('canvas'));
    expect(FakeWorker.made, 'one worker serves every canvas').toHaveLength(1);
  });

  it('adopting the same element twice throws, and so does adopting it again after it was dropped (a transferred canvas cannot be transferred again)', () => {
    supported();
    const cv = document.createElement('canvas');
    const h = adoptFoil(cv);
    expect(() => adoptFoil(cv)).toThrow(/already/u);
    expect(transfers).toBe(1);
    h.drop();
    expect(() => adoptFoil(cv)).toThrow(/already/u);
  });

  it('a frame\'s draws go in one frame message, posted in a microtask after the first', async () => {
    supported();
    const a = adoptFoil(document.createElement('canvas')), b = adoptFoil(document.createElement('canvas'));
    const w = FakeWorker.made[0]!;
    a.draw(...drawArgs(16));
    b.draw(...drawArgs(16));
    expect(w.of('frame'), 'nothing is posted inside the loop\'s step').toHaveLength(0);
    await flushMicrotasks();
    expect(w.of('frame')).toHaveLength(1);
    const m = w.of('frame')[0]!.message as { t: number; draws: { id: number; spec: unknown; key: string; box: unknown; density: number; light: unknown; band: unknown; now: number; idle: boolean }[] };
    expect(m.t).toBe(16);
    expect(m.draws.map((d) => d.id)).toEqual([...w.of('adopt').map((x) => x.message.id as number)]);
    expect(m.draws[0]).toEqual({ id: m.draws[0]!.id, spec, key: 'light', box: { w: 90, h: 45 }, density: 2, light: { x: 0.1, y: -0.2 }, band: BAND, now: 16, idle: false });
    a.draw(...drawArgs(32));
    await flushMicrotasks();
    expect(w.of('frame')).toHaveLength(2);
    expect((w.of('frame')[1]!.message as { t: number }).t).toBe(32);
  });

  it('free posts free; a draw still waiting for its microtask is not sent after it (it would size the freed canvas again)', async () => {
    supported();
    const a = adoptFoil(document.createElement('canvas')), b = adoptFoil(document.createElement('canvas'));
    const w = FakeWorker.made[0]!;
    a.draw(...drawArgs());
    b.draw(...drawArgs());
    a.free();
    expect(w.of('free')).toHaveLength(1);
    await flushMicrotasks();
    const m = w.of('frame')[0]!.message as { draws: { id: number }[] };
    expect(m.draws).toHaveLength(1);
    expect(m.draws[0]!.id).not.toBe(w.of('free')[0]!.message.id);
    b.free();
    await flushMicrotasks();
    expect(w.of('frame'), 'a batch that emptied is not posted').toHaveLength(1);
  });

  it('drop posts drop, and the last drop ends the worker; the next canvas starts a new one', async () => {
    supported();
    const a = adoptFoil(document.createElement('canvas')), b = adoptFoil(document.createElement('canvas'));
    const first = FakeWorker.made[0]!;
    a.draw(...drawArgs());
    a.drop();
    expect(first.of('drop')).toHaveLength(1);
    expect(first.terminated).toBe(false);
    await flushMicrotasks();
    expect(first.of('frame'), 'a dropped canvas\'s waiting draw is not sent').toHaveLength(0);
    a.drop();
    a.free();
    a.draw(...drawArgs());
    expect(first.of('drop'), 'a handle already dropped does nothing more').toHaveLength(1);
    b.drop();
    expect(first.terminated).toBe(true);
    expect(foilProbe.worker()).toBeNull();
    adoptFoil(document.createElement('canvas'));
    expect(FakeWorker.made).toHaveLength(2);
    expect(FakeWorker.made[1]!.terminated).toBe(false);
  });

  it('a worker error is logged, with its words readable', () => {
    supported();
    adoptFoil(document.createElement('canvas'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    FakeWorker.made[0]!.emit('error', { message: 'it broke', filename: 'foilWorker.js', lineno: 3, preventDefault() {} });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]!.join(' '))).toContain('it broke');
  });

  it('the probe reads the worker back: ids, sizes by canvas, its time per frame, and a canvas\'s pixels', async () => {
    supported();
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    expect(await foilProbe.sizes(), 'no worker, no sizes').toEqual(new Map());
    adoptFoil(a); adoptFoil(b);
    const w = FakeWorker.made[0]!;
    const ida = foilProbe.idOf(a)!, idb = foilProbe.idOf(b)!;
    expect(ida).not.toBe(idb);
    expect(foilProbe.idOf(document.createElement('canvas'))).toBeUndefined();
    expect(foilProbe.worker()).toBe(w);
    w.answers.sizes = (m) => ({ kind: 'probe', nonce: m.nonce as number, ask: 'sizes', sizes: [{ id: ida, width: 180, height: 90 }, { id: idb, width: 0, height: 0 }, { id: 999, width: 5, height: 5 }] });
    w.answers.work = (m) => ({ kind: 'probe', nonce: m.nonce as number, ask: 'work', batches: 9, work: [1, 2, 3] });
    w.answers.pixels = (m) => ({ kind: 'probe', nonce: m.nonce as number, ask: 'pixels', width: 2, height: 1, data: new Uint8ClampedArray(8).fill(m.id as number) });
    expect(await foilProbe.sizes()).toEqual(new Map([[a, { w: 180, h: 90 }], [b, { w: 0, h: 0 }]]));
    expect(await foilProbe.work(3)).toEqual({ batches: 9, work: [1, 2, 3] });
    expect(w.of('probe').at(-1)!.message).toMatchObject({ ask: 'work', n: 3 });
    const px = await foilProbe.pixels(b);
    expect(px).toMatchObject({ width: 2, height: 1 });
    expect(px!.data[0]).toBe(idb);
    expect(await foilProbe.pixels(document.createElement('canvas'))).toBeNull();
  });

  it('the default worker is the bundled foilWorker module', () => {
    supported();
    setFoilWorker(null);
    adoptFoil(document.createElement('canvas'));
    const w = FakeWorker.made[0]!;
    expect(String(w.url)).toMatch(/foilWorker\.ts/u);
    expect(w.options).toEqual({ type: 'module' });
  });
});
