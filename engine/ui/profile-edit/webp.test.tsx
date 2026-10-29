import { describe, expect, test } from 'vitest';
import { webpChunks, webpProblem, webpSize } from './webp.ts';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const chunk = (kind: string, data: number[]) => [...ascii(kind), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
const riff = (...chunks: number[][]) => {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return Uint8Array.from([...ascii('RIFF'), ...le32(body.length), ...body]);
};
/** A lossy picture chunk with just a key frame's header: enough for a reader of chunks. */
const vp8 = (w: number, h: number) => chunk('VP8 ', [0x10, 0, 0, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8, 0, 0]);
const vp8x = (flags: number, w: number, h: number) => chunk('VP8X', [flags, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);

describe('webpChunks', () => {
  test('lists a plain lossy WebP\'s one chunk', () => {
    const r = webpChunks(riff(vp8(256, 256)));
    expect(r).toMatchObject({ ok: true, chunks: [{ kind: 'VP8 ', size: 12 }], flags: null });
    expect(webpSize(riff(vp8(256, 384)))).toEqual({ width: 256, height: 384 });
  });

  test('lists an extended file\'s chunks in order, with the header\'s flags', () => {
    const bytes = riff(vp8x(0x08, 256, 256), vp8(256, 256), chunk('EXIF', [1, 2, 3, 4]));
    const r = webpChunks(bytes);
    expect(r).toMatchObject({ ok: true, flags: 0x08 });
    expect(r.ok && r.chunks.map((c) => c.kind)).toEqual(['VP8X', 'VP8 ', 'EXIF']);
  });

  test('says a file that is not a RIFF WebP is not one', () => {
    expect(webpChunks(Uint8Array.from(ascii('GIF89a......................')))).toMatchObject({ ok: false });
    expect(webpChunks(Uint8Array.from([1, 2, 3]))).toMatchObject({ ok: false });
  });
});

describe('webpProblem: nothing but pixels', () => {
  test('a WebP holding an EXIF chunk fires, by name', () => {
    const withExif = riff(vp8x(0x08, 256, 256), vp8(256, 256), chunk('EXIF', [0x49, 0x49, 0x2a, 0]));
    expect(webpProblem(withExif)).toBe('carries metadata (EXIF), which an avatar is sent without');
  });

  test('so do an XMP chunk, a color profile, an animation, the header\'s flags for them, and a chunk it does not know', () => {
    expect(webpProblem(riff(vp8x(0x04, 256, 256), vp8(256, 256), chunk('XMP ', [1, 2])))).toMatch(/XMP/u);
    expect(webpProblem(riff(vp8x(0x20, 256, 256), chunk('ICCP', [1, 2]), vp8(256, 256)))).toMatch(/ICCP/u);
    expect(webpProblem(riff(vp8x(0x20, 256, 256), vp8(256, 256)))).toMatch(/ICCP/u);
    expect(webpProblem(riff(vp8x(0x02, 256, 256), vp8(256, 256)))).toMatch(/animated/u);
    expect(webpProblem(riff(vp8(256, 256), chunk('JUNK', [1, 2])))).toMatch(/JUNK/u);
  });

  test('a clean file passes: a lone picture, or an extended header with only its alpha flag', () => {
    expect(webpProblem(riff(vp8(256, 256)))).toBeNull();
    expect(webpProblem(riff(vp8x(0x10, 256, 256), chunk('ALPH', [0, 1, 2, 3]), vp8(256, 256)))).toBeNull();
    expect(webpProblem(riff(vp8x(0, 256, 256), vp8(256, 256)))).toBeNull();
  });

  test('bytes after the RIFF\'s own length, or a size that says two things, fire', () => {
    const clean = riff(vp8(256, 256));
    expect(webpProblem(Uint8Array.from([...clean, 1, 2, 3, 4]))).toMatch(/outside its picture/u);
    expect(webpProblem(riff(vp8x(0, 300, 300), vp8(256, 256)))).toMatch(/two sizes/u);
    expect(webpProblem(Uint8Array.from(ascii('not a webp at all, not a webp at all')))).toBe('is not a WebP');
  });
});

describe('stripColorProfile: the canvas\'s own sRGB profile is dropped, and only that', async () => {
  const { stripColorProfile } = await import('./webp.ts');
  const { webpBytes } = await import('./fixtures.ts');

  test('a browser\'s canvas file with a color profile is refused as it is, and clean once the profile is dropped', () => {
    const canvasFile = webpBytes(256, 256, { icc: true });
    expect(webpProblem(canvasFile)).toMatch(/ICCP/u);
    const stripped = stripColorProfile(canvasFile);
    expect(webpProblem(stripped)).toBeNull();
    expect(webpSize(stripped)).toEqual({ width: 256, height: 256 });
    const read = webpChunks(stripped);
    expect(read.ok && read.chunks.map((c) => c.kind)).toEqual(['VP8X', 'VP8 ']);
    expect(read.ok && read.flags).toBe(0);
  });

  test('leaves a file without one as it was', () => {
    const plain = webpBytes(256, 256);
    expect(stripColorProfile(plain)).toEqual(plain);
  });

  test('does not clean up metadata: a file with EXIF still fires after it', () => {
    const both = stripColorProfile(webpBytes(256, 256, { icc: true, exif: true }));
    expect(webpProblem(both)).toMatch(/EXIF/u);
  });
});
