import { describe, expect, test } from 'vitest';
import { CropError, cutAvatar, LIMITS, type Picture, type PictureIo, type Rect } from './crops.ts';
import { webpBlob, type WebpOptions } from './fixtures.ts';
import type { Size } from './frames.ts';
import { webpProblem } from './webp.ts';
import { bytesOf } from './crops.ts';

const picture = (width: number, height: number): Picture => ({ width, height, url: 'blob:x', source: {} as CanvasImageSource, release: () => {} });

/** An encoder that asks nothing of a canvas: it records what was asked and answers with a hand-made WebP of that size. */
function recorder(shape: (out: Size, quality: number) => { size?: Size; options?: WebpOptions } = () => ({})) {
  const calls: { cut: Rect; out: Size; quality: number }[] = [];
  const io: PictureIo = {
    loadFile: () => Promise.reject(new Error('not used')),
    loadUrl: () => Promise.reject(new Error('not used')),
    encode(_p, cut, out, quality) {
      calls.push({ cut, out, quality });
      const made = shape(out, quality);
      const size = made.size ?? out;
      return Promise.resolve(webpBlob(size.width, size.height, made.options));
    },
  };
  return { io, calls };
}

describe('cutting an avatar', () => {
  test('cuts the portrait from the picture at 256 to 512 wide and the square from inside the portrait at 256 by 256', async () => {
    const { io, calls } = recorder();
    const got = await cutAvatar(io, picture(800, 2000), { portrait: { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }, square: { x: 0, y: 0, w: 1, h: 0.5 } });
    expect(got.portrait).toBeInstanceOf(Blob);
    /* 400 by 800 pixels of the picture, sent as 400 by 800. */
    expect(calls[0]).toMatchObject({ cut: { x: 200, y: 200, width: 400, height: 800 }, out: { width: 400, height: 800 } });
    /* The top half of that, by the full width: 400 by 400 pixels of the picture, sent at 256 square. */
    expect(calls[1]).toMatchObject({ cut: { x: 200, y: 200, width: 400, height: 400 }, out: { width: 256, height: 256 } });
  });

  test('a recrop cuts the square alone from the stored portrait and sends no portrait', async () => {
    const { io, calls } = recorder();
    const got = await cutAvatar(io, picture(400, 800), { portrait: null, square: { x: 0, y: 0.25, w: 1, h: 0.5 } });
    expect(got.portrait).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cut: { x: 0, y: 200, width: 400, height: 400 }, out: { width: 256, height: 256 } });
  });

  test('refuses a portrait frame taller than 2:1 before cutting anything', async () => {
    const { io, calls } = recorder();
    await expect(cutAvatar(io, picture(400, 2000), { portrait: { x: 0, y: 0, w: 1, h: 0.45 }, square: { x: 0, y: 0, w: 1, h: 0.2 } })).rejects.toThrow('A portrait can be at most twice as tall as it is wide');
    expect(calls).toEqual([]);
  });

  test('the files it hands on carry no EXIF chunk, nor anything but their picture', async () => {
    const { io } = recorder();
    const got = await cutAvatar(io, picture(800, 1000), { portrait: { x: 0, y: 0, w: 1, h: 1 }, square: { x: 0, y: 0, w: 1, h: 0.8 } });
    for (const blob of [got.square, got.portrait!]) expect(webpProblem(await bytesOf(blob))).toBeNull();
  });

  test('refuses to hand on a file that carries EXIF, and says nothing was sent', async () => {
    const { io } = recorder(() => ({ options: { exif: true } }));
    const run = cutAvatar(io, picture(800, 1000), { portrait: { x: 0, y: 0, w: 1, h: 1 }, square: { x: 0, y: 0, w: 1, h: 0.8 } });
    await expect(run).rejects.toThrow(CropError);
    await expect(run).rejects.toThrow('carries metadata (EXIF)');
    await expect(run).rejects.toThrow('nothing was sent');
  });

  test('refuses a file that is not a WebP (a browser that cannot encode one falls back to PNG)', async () => {
    const io: PictureIo = { loadFile: () => Promise.reject(new Error('x')), loadUrl: () => Promise.reject(new Error('x')), encode: () => Promise.resolve(new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])], { type: 'image/png' })) };
    await expect(cutAvatar(io, picture(400, 400), { portrait: null, square: { x: 0, y: 0, w: 1, h: 1 } })).rejects.toThrow('did not make a WebP');
  });

  test('refuses a file that came out at another size than asked', async () => {
    const { io } = recorder((out) => ({ size: { width: out.width + 1, height: out.height } }));
    await expect(cutAvatar(io, picture(400, 400), { portrait: null, square: { x: 0, y: 0, w: 1, h: 1 } })).rejects.toThrow('different size');
  });

  test('lowers the quality until the file fits the server\'s bound, and gives up in words if it never does', async () => {
    const big = recorder((_o, q) => ({ options: { pad: q > 0.7 ? LIMITS.square + 10 : 10 } }));
    await cutAvatar(big.io, picture(400, 400), { portrait: null, square: { x: 0, y: 0, w: 1, h: 1 } });
    expect(big.calls.map((c) => c.quality)).toEqual([0.92, 0.8, 0.65]);
    const never = recorder(() => ({ options: { pad: LIMITS.square + 10 } }));
    await expect(cutAvatar(never.io, picture(400, 400), { portrait: null, square: { x: 0, y: 0, w: 1, h: 1 } })).rejects.toThrow('too large to send');
  });
});

describe('a browser\'s canvas', () => {
  test('writes an sRGB color profile into its WebP; it is dropped so the server takes the file, and nothing else is', async () => {
    const { io } = recorder(() => ({ options: { icc: true } }));
    const got = await cutAvatar(io, picture(800, 1000), { portrait: { x: 0, y: 0, w: 1, h: 1 }, square: { x: 0, y: 0, w: 1, h: 0.8 } });
    for (const blob of [got.square, got.portrait!]) expect(webpProblem(await bytesOf(blob))).toBeNull();
    const withExif = recorder(() => ({ options: { icc: true, exif: true } }));
    await expect(cutAvatar(withExif.io, picture(800, 1000), { portrait: null, square: { x: 0, y: 0, w: 1, h: 1 } })).rejects.toThrow('carries metadata (EXIF)');
  });
});
