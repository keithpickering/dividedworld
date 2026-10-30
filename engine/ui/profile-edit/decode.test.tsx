import { describe, expect, test, vi } from 'vitest';
import { bitmapIsAsked, fitsWithoutShrinking, MAX_PIXELS, NOT_A_PICTURE, planDecode, TOO_LARGE, webpFrom } from './decode.ts';

describe('opening a picture', () => {
  test('keeps a picture whose longest side is within 4096 as it is', () => {
    expect(planDecode({ width: 3000, height: 4096 })).toEqual({ kind: 'open', size: { width: 3000, height: 4096 }, shrunk: false });
  });

  test('shrinks a 48 megapixel photo to a longest side of 4096, its shape kept', () => {
    expect(planDecode({ width: 8000, height: 6000 })).toEqual({ kind: 'open', size: { width: 4096, height: 3072 }, shrunk: true });
    expect(planDecode({ width: 6000, height: 8000 })).toEqual({ kind: 'open', size: { width: 3072, height: 4096 }, shrunk: true });
  });

  test('says a picture with no size cannot be opened', () => {
    expect(planDecode({ width: 0, height: 0 })).toEqual({ kind: 'too-large' });
  });

  test('a path that cannot shrink as it decodes takes up to the cap and no more', () => {
    expect(fitsWithoutShrinking({ width: 8000, height: 6000 })).toBe(true);
    expect(fitsWithoutShrinking({ width: 20000, height: 10000 })).toBe(false);
    expect(MAX_PIXELS).toBe(64_000_000);
  });

  test('trusts a bitmap only if it came back the size it was asked for', () => {
    const asked = { width: 4096, height: 3072 };
    expect(bitmapIsAsked({ width: 4096, height: 3072 }, asked)).toBe(true);
    /* A browser that ignores resizeWidth and resizeHeight returns the whole 48 megapixel picture. */
    expect(bitmapIsAsked({ width: 8000, height: 6000 }, asked)).toBe(false);
    expect(bitmapIsAsked({ width: 4096, height: 3071 }, asked)).toBe(false);
    expect(bitmapIsAsked({ width: 0, height: 0 }, asked)).toBe(false);
  });

  test('the two failures are told apart in plain words', () => {
    expect(TOO_LARGE).toMatch(/too large to open here/u);
    expect(NOT_A_PICTURE).toMatch(/not a picture this browser can read/u);
    expect(TOO_LARGE).not.toBe(NOT_A_PICTURE);
    expect(TOO_LARGE).not.toMatch(/not a picture/u);
  });
});

describe('which WebP encoder', () => {
  test('the browser\'s own is used where it gave WebP, and the fallback never runs', async () => {
    const native = new Blob(['x'], { type: 'image/webp' });
    const fallback = vi.fn(async () => new Blob(['y'], { type: 'image/webp' }));
    expect(await webpFrom(native, fallback)).toBe(native);
    expect(fallback).not.toHaveBeenCalled();
  });

  test('the fallback runs where the browser gave a PNG, or nothing', async () => {
    const made = new Blob(['y'], { type: 'image/webp' });
    const fallback = vi.fn(async () => made);
    expect(await webpFrom(new Blob(['x'], { type: 'image/png' }), fallback)).toBe(made);
    expect(await webpFrom(null, fallback)).toBe(made);
    expect(fallback).toHaveBeenCalledTimes(2);
  });
});
