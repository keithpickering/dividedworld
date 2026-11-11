import { describe, expect, test } from 'vitest';
import { CropError, type Picture, type PictureIo } from '../profile-edit/crops.ts';
import { webpBlob } from '../profile-edit/fixtures.ts';
import { webpSize } from '../profile-edit/webp.ts';
import { trophyArt, TROPHY_ART } from './trophy-art.ts';

/** An io that "decodes" any file as a picture of the size given and "encodes" a WebP of the size asked, padded as the test needs. */
function io(natural: { width: number; height: number }, o: { pad?: (quality: number) => number; icc?: boolean; fail?: boolean } = {}): PictureIo & { readonly asked: { width: number; height: number }[]; released: number } {
  const asked: { width: number; height: number }[] = [];
  const made = {
    asked, released: 0,
    async loadFile(): Promise<Picture> {
      if (o.fail) throw new CropError('That file is not a picture this browser can read.');
      return { ...natural, url: 'blob:x', source: {} as CanvasImageSource, release: () => { made.released += 1; } };
    },
    async loadUrl(): Promise<Picture> { throw new Error('not used'); },
    async encode(_p: Picture, _cut: unknown, out: { width: number; height: number }, quality: number) {
      asked.push(out);
      return webpBlob(out.width, out.height, { pad: o.pad?.(quality) ?? 0, icc: o.icc });
    },
  };
  return made;
}
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('a trophy\'s picture, from a file', () => {
  test('a large picture is drawn down to 48 on its longest side, its shape kept, and sent as a WebP', async () => {
    const i = io({ width: 400, height: 200 });
    const blob = await trophyArt(i, new File(['x'], 'a.png'));
    expect(i.asked).toEqual([{ width: 48, height: 24 }]);
    expect(webpSize(await bytes(blob))).toEqual({ width: 48, height: 24 });
    expect(i.released).toBe(1);
  });

  test('a picture already small is not made bigger', async () => {
    const i = io({ width: 16, height: 40 });
    await trophyArt(i, new File(['x'], 'a.png'));
    expect(i.asked).toEqual([{ width: 16, height: 40 }]);
  });

  test('a browser\'s color profile is dropped, since the server refuses it', async () => {
    const blob = await trophyArt(io({ width: 48, height: 48 }, { icc: true }), new File(['x'], 'a.png'));
    expect(webpSize(await bytes(blob))).toEqual({ width: 48, height: 48 });
    expect(new TextDecoder('latin1').decode(await bytes(blob))).not.toContain('ICCP');
  });

  test('a file over the size limit is encoded again at a lower quality until it fits', async () => {
    const tried: number[] = [];
    const i = io({ width: 48, height: 48 }, { pad: (q) => { tried.push(q); return q > 0.7 ? TROPHY_ART.bytes : 0; } });
    const blob = await trophyArt(i, new File(['x'], 'a.png'));
    expect((await bytes(blob)).length).toBeLessThanOrEqual(TROPHY_ART.bytes);
    expect(tried.length).toBeGreaterThan(1);
  });

  test('a picture that never fits says so in words and sends nothing', async () => {
    await expect(trophyArt(io({ width: 48, height: 48 }, { pad: () => TROPHY_ART.bytes }), new File(['x'], 'a.png'))).rejects.toThrow('The picture is too large even at the lowest quality (16 KB at most), so nothing was sent. Choose a simpler picture.');
  });

  test('a file that is no picture says so in the browser\'s words, and nothing is released twice', async () => {
    await expect(trophyArt(io({ width: 1, height: 1 }, { fail: true }), new File(['x'], 'a.txt'))).rejects.toThrow('That file is not a picture this browser can read.');
  });
});
