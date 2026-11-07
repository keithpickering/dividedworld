/**
 * The field's rasters (field.ts): one set of `blob:` URLs shared by every window, held per field,
 * width class and device pixel ratio, and given back when any of those changes or the last window
 * is gone. A long session of crossings must not grow memory, so these count every URL made and
 * every URL revoked: at any moment the live ones are exactly the set the cache holds.
 *
 * jsdom has no canvas, so the rasterizer here is a stand-in that makes a URL the way the real one
 * does (`URL.createObjectURL`), and `URL`'s two functions are mocked to count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldLayer } from '../types.ts';
import { createRasters, fieldLayerSvg, GRACE_MS, rasterize, rasterSize, type Rasterize } from './field.ts';

const layer = (seed: number, travel = 100): FieldLayer => ({ alpha: [0, 0, 0, 1, 0], frequency: [0.01, 0.02], octaves: 2, seed, blur: 5, drift: { seconds: 30, travel } });
const WIDE = [layer(1, 80), layer(2, 120), layer(3, 160)];
const NARROW = [layer(4, 40), layer(5, 60)];
const VIEW = { width: 1440, height: 900 };

let made: string[];
let revoked: string[];
let n: number;

beforeEach(() => {
  made = []; revoked = []; n = 0;
  vi.stubGlobal('URL', Object.assign(function URL() {}, {
    createObjectURL: vi.fn(() => { const u = `blob:test/${n++}`; made.push(u); return u; }),
    revokeObjectURL: vi.fn((u: string) => { revoked.push(u); }),
  }));
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const raster = (): Rasterize => vi.fn(async () => URL.createObjectURL(new Blob()));
const live = () => made.filter((u) => !revoked.includes(u));
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };

describe('the raster cache', () => {
  it('rasterizes each layer once, at the viewport plus the layer\'s travel, and says so', async () => {
    const r = raster();
    const rasters = createRasters(r);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    expect(r).toHaveBeenCalledTimes(3);
    expect(r).toHaveBeenNthCalledWith(1, WIDE[0], { width: 1520, height: 900 }, 1);
    expect(r).toHaveBeenNthCalledWith(3, WIDE[2], { width: 1600, height: 900 }, 1);
    expect(rasters.get().urls).toEqual(['blob:test/0', 'blob:test/1', 'blob:test/2']);
    expect(rasters.get().key).toBe(rasters.keyOf(WIDE, 1));
  });

  it('is shared: a second window for the same field makes nothing', async () => {
    const r = raster();
    const rasters = createRasters(r);
    rasters.acquire(WIDE, 1, VIEW);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    expect(r).toHaveBeenCalledTimes(3);
    expect(made).toHaveLength(3);
  });

  it('revokes every URL when the width class changes, and keeps only the new class\'s', async () => {
    const rasters = createRasters(raster());
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    const wide = [...made];
    rasters.acquire(NARROW, 1, { width: 390, height: 844 });
    await settle();
    expect(revoked).toEqual(wide);
    expect(live()).toHaveLength(2);
    expect(rasters.get().urls).toEqual(live());
  });

  it('revokes the first set when a second, different layers array is asked for at the same size and ratio', async () => {
    const rasters = createRasters(raster());
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    const first = [...made];
    rasters.acquire([layer(9), layer(10)], 1, VIEW);
    await settle();
    expect(revoked).toEqual(first);
    expect(live()).toHaveLength(2);
  });

  it('revokes every URL when the device pixel ratio changes (a zoom, or a window moved to another screen)', async () => {
    const r = raster();
    const rasters = createRasters(r);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    const first = [...made];
    rasters.acquire(WIDE, 2, VIEW);
    await settle();
    expect(revoked).toEqual(first);
    expect(r).toHaveBeenLastCalledWith(WIDE[2], { width: 1600, height: 900 }, 2);
    expect(live()).toHaveLength(3);
  });

  it('caps the ratio at 2: a ratio of 3 is the same raster as 2, and the key says so', () => {
    const rasters = createRasters(raster());
    expect(rasters.keyOf(WIDE, 3)).toBe(rasters.keyOf(WIDE, 2));
    expect(rasters.keyOf(WIDE, 1)).not.toBe(rasters.keyOf(WIDE, 2));
  });

  it('gives the rasters back a grace after the last window is gone, not at once: a crossing swaps one window for another', async () => {
    const rasters = createRasters(raster());
    const off = rasters.acquire(WIDE, 1, VIEW);
    await settle();
    off();
    expect(revoked).toEqual([]);
    /* The crossing's new window comes before the grace ends: nothing is made again, nothing is lost. */
    const on = rasters.acquire(WIDE, 1, VIEW);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(made).toHaveLength(3);
    expect(revoked).toEqual([]);
    on();
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(revoked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(revoked).toHaveLength(3);
    expect(rasters.get().urls).toEqual([]);
  });

  it('holds while any window of several is left', async () => {
    const rasters = createRasters(raster());
    const a = rasters.acquire(WIDE, 1, VIEW);
    const b = rasters.acquire(WIDE, 1, VIEW);
    await settle();
    a();
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(revoked).toEqual([]);
    b();
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(revoked).toHaveLength(3);
  });

  it('a release called twice counts once', async () => {
    const rasters = createRasters(raster());
    const a = rasters.acquire(WIDE, 1, VIEW);
    const b = rasters.acquire(WIDE, 1, VIEW);
    await settle();
    a(); a();
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(revoked).toEqual([]);
    b();
  });

  it('revokes a URL that arrives after its field was given up, so a slow raster cannot leak', async () => {
    const finish: ((u: string) => void)[] = [];
    const slow: Rasterize = vi.fn(() => new Promise<string>((res) => { finish.push(res); }));
    const rasters = createRasters(slow);
    rasters.acquire(WIDE, 1, VIEW);
    rasters.acquire(NARROW, 1, { width: 390, height: 844 });
    /* The first layer of the wide set answers now: nobody wants it. */
    finish[0]!(URL.createObjectURL(new Blob()));
    await settle();
    expect(revoked).toEqual(['blob:test/0']);
    expect(rasters.get().urls.filter((u) => u !== null)).toEqual([]);
  });

  it('a layer that cannot be rasterized stays undrawn, and the others are drawn', async () => {
    const some: Rasterize = vi.fn(async (l) => { if (l.seed === 2) throw new Error('no canvas'); return URL.createObjectURL(new Blob()); });
    const rasters = createRasters(some);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    expect(rasters.get().urls).toEqual(['blob:test/0', null, 'blob:test/1']);
  });

  it('keeps the raster, stretched, through a small resize, and rasterizes again, debounced, past a stretch the eye would see', async () => {
    const r = raster();
    const rasters = createRasters(r);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    const first = [...made];
    rasters.resize({ width: 1400, height: 880 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(r).toHaveBeenCalledTimes(3);
    /* A drag: only the last size, once the window has been still. */
    rasters.resize({ width: 1000, height: 900 });
    rasters.resize({ width: 900, height: 900 });
    await vi.advanceTimersByTimeAsync(100);
    expect(r).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r).toHaveBeenCalledTimes(6);
    expect(r).toHaveBeenLastCalledWith(WIDE[2], { width: 1060, height: 900 }, 1);
    /* The old URLs go once the new are in, so no frame is without smoke, and none stays. */
    expect(revoked).toEqual(first);
    expect(live()).toHaveLength(3);
  });

  it('keeps the old raster until the new one is whole: a resize never shows the ground in between', async () => {
    let calls = 0;
    const gate: { open: () => void } = { open: () => {} };
    const waiting = new Promise<void>((res) => { gate.open = res; });
    const r: Rasterize = vi.fn(async () => { if (calls++ >= 3) await waiting; return URL.createObjectURL(new Blob()); });
    const rasters = createRasters(r);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    rasters.resize({ width: 800, height: 900 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(rasters.get().urls).toEqual(['blob:test/0', 'blob:test/1', 'blob:test/2']);
    expect(revoked).toEqual([]);
    gate.open();
    await settle();
    expect(revoked).toEqual(['blob:test/0', 'blob:test/1', 'blob:test/2']);
    expect(rasters.get().urls).toEqual(['blob:test/3', 'blob:test/4', 'blob:test/5']);
  });

  it('keeps a layer\'s old raster, and does not revoke it, when that layer fails in a resize rebuild', async () => {
    let calls = 0;
    const r: Rasterize = vi.fn(async (l) => { if (calls++ >= 3 && l.seed === 2) throw new Error('no memory'); return URL.createObjectURL(new Blob()); });
    const rasters = createRasters(r);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    expect(rasters.get().urls).toEqual(['blob:test/0', 'blob:test/1', 'blob:test/2']);
    rasters.resize({ width: 800, height: 900 });
    await vi.advanceTimersByTimeAsync(1000);
    /* The layer that failed is still the old one, still live; the others are new, and their old ones are given back. */
    expect(rasters.get().urls).toEqual(['blob:test/3', 'blob:test/1', 'blob:test/4']);
    expect(revoked).toEqual(['blob:test/0', 'blob:test/2']);
    expect(live()).toEqual(['blob:test/1', 'blob:test/3', 'blob:test/4']);
  });

  it('does not grow over many crossings: the live URLs are the field\'s, however often a window comes and goes', async () => {
    const rasters = createRasters(raster());
    for (let i = 0; i < 50; i++) {
      const off = rasters.acquire(WIDE, 1, VIEW);
      await vi.advanceTimersByTimeAsync(50);
      off();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(made).toHaveLength(3);
    expect(live()).toHaveLength(3);
  });

  it('subscribers hear each change, and a snapshot is the same object until one', async () => {
    const rasters = createRasters(raster());
    const heard = vi.fn();
    const stop = rasters.subscribe(heard);
    const before = rasters.get();
    expect(rasters.get()).toBe(before);
    rasters.acquire(WIDE, 1, VIEW);
    await settle();
    expect(heard).toHaveBeenCalled();
    expect(rasters.get()).not.toBe(before);
    stop();
  });
});

describe('the raster\'s size', () => {
  it('is the size in CSS pixels times the ratio capped at 2, and never past the pixel budget of 2 million', () => {
    expect(rasterSize({ width: 1440, height: 900 }, 1)).toEqual({ width: 1440, height: 900, scale: 1 });
    expect(rasterSize({ width: 390, height: 844 }, 3)).toEqual({ width: 780, height: 1688, scale: 2 });
    const capped = rasterSize({ width: 1440, height: 900 }, 3);
    expect(capped.width * capped.height).toBeLessThanOrEqual(2_000_000);
    expect(capped.scale).toBeGreaterThan(1);
    expect(capped.scale).toBeLessThan(2);
    const huge = rasterSize({ width: 3840, height: 2160 }, 2);
    expect(huge.width * huge.height).toBeLessThanOrEqual(2_000_000);
    expect(huge.scale).toBeGreaterThan(0);
  });
});

describe('the real rasterizer', () => {
  /* jsdom has no canvas: an image that decodes and a canvas the test hands out stand in, to hold what happens when the canvas fails. */
  const stage = (canvas: object) => {
    vi.stubGlobal('Image', class { src = ''; decode = async () => {}; });
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLCanvasElement);
  };

  it('throws a named error when the canvas gives no 2d context, and gives back the SVG\'s own URL', async () => {
    stage({ getContext: () => null, width: 0, height: 0 });
    await expect(rasterize(layer(1), VIEW, 1)).rejects.toThrow('no 2d context');
    expect(revoked).toEqual(['blob:test/0']);
  });

  it('draws the image to the canvas at the raster\'s pixels and returns the PNG\'s URL, the SVG\'s revoked', async () => {
    const drawImage = vi.fn();
    stage({ getContext: () => ({ drawImage }), toBlob: (done: (b: Blob) => void) => done(new Blob()), width: 0, height: 0 });
    const url = await rasterize(layer(1), VIEW, 1);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1440, 900);
    expect(url).toBe('blob:test/1');
    expect(revoked).toEqual(['blob:test/0']);
  });

  it('draws the SVG fieldLayerSvg returns, so the mail bake and the page draw a layer one way', async () => {
    stage({ getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (b: Blob) => void) => done(new Blob()), width: 0, height: 0 });
    const blobs: Blob[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation((b) => { blobs.push(b as Blob); return `blob:test/${blobs.length - 1}`; });
    const l = layer(7);
    await rasterize(l, VIEW, 1);
    const drawn = await blobs[0]!.text();
    expect(drawn).toContain('<feTurbulence');
    expect(drawn).toBe(fieldLayerSvg(l, VIEW, rasterSize(VIEW, 1)));
  });
});
