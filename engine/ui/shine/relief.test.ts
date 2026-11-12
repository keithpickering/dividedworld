import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_GRID } from './band.ts';
import { lightRelief, makeRelief } from './relief.ts';

/** A w by h RGBA picture, every pixel from `f(x, y)`. Normals are encoded as the relief file has them: green up is high. */
const picture = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(f(x, y), (y * w + x) * 4);
  return a;
};
const FLAT: [number, number, number, number] = [128, 128, 255, 255];
const lit = (r: ReturnType<typeof makeRelief>, light: { x: number; y: number }, rows?: { top: number; bottom: number }) => {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  lightRelief(r, light, out, rows);
  return out;
};
const A = (out: Uint8ClampedArray, w: number, x: number, y: number) => out[(y * w + x) * 4 + 3]!;

describe('relief light', () => {
  test('a flat relief under a centered light is brightest at the center and falls off to each edge', () => {
    const w = 33, h = 33;
    const out = lit(makeRelief(picture(w, h, () => FLAT), null, w, h), { x: 0, y: 0 });
    const c = A(out, w, 16, 16);
    assert.ok(c > 0);
    for (let i = 16; i > 0; i--) {
      assert.ok(A(out, w, i, 16) >= A(out, w, i - 1, 16), `row falls off left at ${i}`);
      assert.ok(A(out, w, 16, i) >= A(out, w, 16, i - 1), `column falls off up at ${i}`);
      assert.ok(A(out, w, 32 - i, 16) >= A(out, w, 32 - i + 1, 16), `row falls off right at ${32 - i}`);
      assert.ok(A(out, w, 16, 32 - i) >= A(out, w, 16, 32 - i + 1), `column falls off down at ${32 - i}`);
    }
    assert.ok(c > A(out, w, 0, 16) && c > A(out, w, 32, 16) && c > A(out, w, 16, 0) && c > A(out, w, 16, 32));
  });

  test('a pixel leaning toward the light is brighter than one leaning away, on both axes', () => {
    // Encoded: green high leans up the screen, red high leans right.
    const w = 2, h = 2;
    const lean = (r: number, g: number): [number, number, number, number] => [r, g, 255, 255];
    const up = lean(128, 160), down = lean(128, 96), right = lean(160, 128), left = lean(96, 128);
    // The same pixel with each lean, so position cannot tell them apart.
    const at = (px: [number, number, number, number], light: { x: number; y: number }) =>
      A(lit(makeRelief(picture(w, h, () => px), null, w, h), light), w, 1, 1);
    assert.ok(at(up, { x: 0, y: -1 }) > at(down, { x: 0, y: -1 }), 'light above: leaning up is brighter');
    assert.ok(at(down, { x: 0, y: 1 }) > at(up, { x: 0, y: 1 }), 'light below: leaning down is brighter');
    assert.ok(at(left, { x: -1, y: 0 }) > at(right, { x: -1, y: 0 }), 'light left: leaning left is brighter');
    assert.ok(at(right, { x: 1, y: 0 }) > at(left, { x: 1, y: 0 }), 'light right: leaning right is brighter');
  });

  test('a pixel with alpha 0 in the relief is alpha 0 in the output at every light of the grid', () => {
    const w = 8, h = 8;
    const r = makeRelief(picture(w, h, (x) => (x < 4 ? [128, 128, 255, 0] : FLAT)), null, w, h);
    for (const light of LIGHT_GRID) {
      const out = lit(r, light);
      for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) assert.equal(A(out, w, x, y), 0);
    }
  });

  test('with rows, pixels outside are alpha 0 and pixels inside equal the unrestricted draw', () => {
    const w = 8, h = 8;
    const r = makeRelief(picture(w, h, (x, y) => [100 + x * 10, 90 + y * 10, 220, 255]), null, w, h);
    const light = { x: 0.3, y: -0.4 };
    const all = lit(r, light), part = lit(r, light, { top: 2, bottom: 5 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (y >= 2 && y < 5) assert.deepEqual([...part.subarray(i, i + 4)], [...all.subarray(i, i + 4)]);
        else assert.equal(part[i + 3], 0);
      }
    }
  });

  test('with no tint the color is white; with a tint it is tint * 0.6 + 120, clamped', () => {
    const w = 2, h = 1;
    const white = lit(makeRelief(picture(w, h, () => FLAT), null, w, h), { x: 0, y: 0 });
    assert.deepEqual([...white.subarray(0, 3)], [255, 255, 255]);
    const tint = picture(w, h, (x) => (x === 0 ? [0, 100, 255, 255] : [10, 20, 30, 255]));
    const out = lit(makeRelief(picture(w, h, () => FLAT), tint, w, h), { x: 0, y: 0 });
    assert.deepEqual([...out.subarray(0, 3)], [120, 180, 255]);
    assert.deepEqual([...out.subarray(4, 7)], [126, 132, 138]);
  });

  test('a normal encoded as (128, 128, 128) lights as one facing the viewer and writes no NaN', () => {
    const w = 3, h = 3;
    const zero = lit(makeRelief(picture(w, h, () => [128, 128, 128, 255]), null, w, h), { x: 0.2, y: 0.1 });
    const flat = lit(makeRelief(picture(w, h, () => FLAT), null, w, h), { x: 0.2, y: 0.1 });
    // (128, 128, 255) is itself a hair off straight, so the bytes agree to within a few levels, not exactly.
    zero.forEach((v, i) => assert.ok(Math.abs(v - flat[i]!) <= 3, `byte ${i}: ${v} vs ${flat[i]}`));
    const exact = lit(makeRelief(picture(w, h, () => [127.5, 127.5, 127.5, 255]), null, w, h), { x: 0, y: 0 });
    assert.ok(exact.every((v) => !Number.isNaN(v)));
    assert.ok(zero.some((v) => v > 0));
  });

  test('two calls with the same light write the same bytes', () => {
    const w = 6, h = 6;
    const r = makeRelief(picture(w, h, (x, y) => [60 + x * 20, 70 + y * 20, 230, 255]), null, w, h);
    assert.deepEqual([...lit(r, { x: -0.5, y: 0.6 })], [...lit(r, { x: -0.5, y: 0.6 })]);
  });
});
