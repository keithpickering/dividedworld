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
type Rel = ReturnType<typeof makeRelief>;
/** A buffer full of 255 first, so a byte the draw does not write shows as 255 and not as a fresh buffer's 0. */
const lit = (r: Rel, light: { x: number; y: number }, rows?: { top: number; bottom: number }) => {
  const out = new Uint8ClampedArray(r.w * r.h * 4).fill(255);
  lightRelief(r, light, out, rows);
  return out;
};
const px = (out: Uint8ClampedArray, i: number) => [...out.subarray(i * 4, i * 4 + 4)];
/** The formula straight from the bench, written out plainly, to hold the optimized draw to. */
const reference = (r: Rel, light: { x: number; y: number }) => {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  const aspect = r.h / r.w;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      if (r.alpha[i] === 0) continue;
      let d = [light.x * 1.3 - (2 * x / r.w - 1), light.y * 1.3 * aspect - (2 * y / r.h - 1) * aspect, 0.9];
      const dl = Math.hypot(d[0]!, d[1]!, d[2]!);
      d = d.map((v) => v / dl);
      let hv = [d[0]!, d[1]!, d[2]! + 1];
      const hl = Math.hypot(hv[0]!, hv[1]!, hv[2]!);
      hv = hv.map((v) => v / hl);
      const s = Math.max(0, r.normals[i * 3]! * hv[0]! + r.normals[i * 3 + 1]! * hv[1]! + r.normals[i * 3 + 2]! * hv[2]!);
      const spec = Math.min(1, Math.pow(s, 48) * 0.9 + Math.pow(s, 16) * 0.12);
      out.set([r.color[i * 3]!, r.color[i * 3 + 1]!, r.color[i * 3 + 2]!, spec * r.alpha[i]! * 255], i * 4);
    }
  }
  return out;
};
/** A repeatable pseudo-random picture: normals leaning up to about 0.5 either way, alpha 255 but for a few holes. */
const noise = (w: number, h: number, seed: number) => {
  let st = seed >>> 0;
  const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  return picture(w, h, () => [128 + (rnd() - 0.5) * 128, 128 + (rnd() - 0.5) * 128, 190 + rnd() * 65, rnd() < 0.05 ? 0 : 255]);
};
const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);
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

  test('a pixel with alpha 0 in the relief is four zeros in the output at every light of the grid, however it faces the light', () => {
    const w = 8, h = 8;
    // The transparent half has the very normals the lit half has, facing the light strongly: only its alpha makes it dark.
    const r = makeRelief(picture(w, h, (x) => (x < 4 ? [128, 128, 255, 0] : FLAT)), null, w, h);
    let bright = 0;
    for (const light of LIGHT_GRID) {
      const out = lit(r, light);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < 4; x++) assert.deepEqual(px(out, y * w + x), [0, 0, 0, 0]);
        for (let x = 4; x < w; x++) bright = Math.max(bright, A(out, w, x, y));
      }
    }
    assert.ok(bright > 200, 'the opaque twin of a transparent pixel does light up, so the zeros come from its alpha');
  });

  test('the output alpha is times the relief\'s own alpha', () => {
    const w = 2, h = 2;
    const at = (a: number) => A(lit(makeRelief(picture(w, h, () => [128, 128, 255, a]), null, w, h), { x: 0, y: 0 }), w, 1, 1);
    assert.ok(at(255) > 250);
    assert.ok(Math.abs(at(128) - (at(255) * 128) / 255) <= 1, `${at(128)} is about half of ${at(255)}`);
  });

  test('a pixel whose normal faces away from the light has alpha 0, however sharply it faces away', () => {
    const w = 2, h = 2;
    const at = (n: [number, number, number, number]) => A(lit(makeRelief(picture(w, h, () => n), null, w, h), { x: 0, y: 0 }), w, 1, 1);
    assert.ok(at([128, 128, 255, 255]) > 250, 'facing it: lit');
    assert.equal(at([128, 128, 0, 255]), 0, 'straight away from the light');
    assert.equal(at([128, 128, 40, 255]), 0, 'mostly away from the light');
  });

  test('the highlight is capped at the relief\'s own alpha: a normal on the half vector under alpha 128 gives 128', () => {
    // A 2 by 2 relief's pixel (1, 1) sits at the middle, so a light at the middle has the half vector straight out at it.
    // s is 1 there, and the two lobes sum to 1.02.
    const w = 2, h = 2;
    const out = lit(makeRelief(picture(w, h, () => [128, 128, 255, 128]), null, w, h), { x: 0, y: 0 });
    assert.equal(A(out, w, 1, 1), 128);
  });

  test('a stored normal is unit length: an encoded normal and a shorter copy of it light the same', () => {
    const w = 2, h = 2;
    const at = (n: [number, number, number, number]) => A(lit(makeRelief(picture(w, h, () => n), null, w, h), { x: 0.5, y: 0 }), w, 1, 1);
    // Off axis toward a light at x = 0.5, the second about half as long.
    const long = at([169, 128, 255, 255]), short = at([148, 128, 191, 255]);
    assert.ok(long > 200, `lit: ${long}`);
    assert.ok(Math.abs(long - short) <= 3, `${long} vs ${short}`);
  });

  test('a relief that is not square is lit as the formula says on both axes', () => {
    const w = 6, h = 12;
    const r = makeRelief(noise(w, h, 7), null, w, h);
    let bright = 0;
    for (const light of LIGHT_GRID) {
      const want = reference(r, light), got = lit(r, light);
      assert.ok(maxDiff(want, got) <= 1, `light ${light.x}, ${light.y}: off by ${maxDiff(want, got)}`);
      bright += want.filter((v, i) => i % 4 === 3 && v > 100).length;
    }
    assert.ok(bright > 20, 'the case has bright pixels to be wrong about');
  });

  test('a 540 by 840 relief is drawn within one level of the formula at several lights', () => {
    const w = 540, h = 840;
    const r = makeRelief(noise(w, h, 11), null, w, h);
    for (const light of [{ x: 0, y: 0 }, { x: -0.7, y: 0.5 }, { x: 0.9, y: -0.8 }]) {
      assert.ok(maxDiff(reference(r, light), lit(r, light)) <= 1, `light ${light.x}, ${light.y}`);
    }
  });

  test('with rows, pixels outside are four zeros and pixels inside equal the unrestricted draw, whatever the buffer held', () => {
    const w = 8, h = 8;
    const r = makeRelief(picture(w, h, (x, y) => [100 + x * 10, 90 + y * 10, 220, 255]), null, w, h);
    const light = { x: 0.3, y: -0.4 };
    const all = lit(r, light);
    const out = new Uint8ClampedArray(w * h * 4).fill(255);
    const check = (top: number, bottom: number) => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          assert.deepEqual(px(out, i), y >= top && y < bottom ? px(all, i) : [0, 0, 0, 0], `pixel ${x}, ${y} after rows ${top}..${bottom}`);
        }
      }
    };
    lightRelief(r, light, out, { top: 2, bottom: 5 });
    check(2, 5);
    // The same buffer, other rows: what the first call drew is gone.
    lightRelief(r, light, out, { top: 5, bottom: 7 });
    check(5, 7);
    lightRelief(r, light, out, { top: -3, bottom: 99 });
    check(0, h);
  });

  test('a fractional bound draws the rows it touches: top floored, bottom ceiled', () => {
    const w = 8, h = 8;
    const r = makeRelief(picture(w, h, (x, y) => [100 + x * 10, 90 + y * 10, 220, 255]), null, w, h);
    const light = { x: 0.3, y: -0.4 };
    const all = lit(r, light), part = lit(r, light, { top: 1.5, bottom: 4.2 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        assert.deepEqual(px(part, i), y >= 1 && y < 5 ? px(all, i) : [0, 0, 0, 0], `pixel ${x}, ${y}`);
      }
    }
    const sliver = lit(r, light, { top: 3.2, bottom: 3.6 });
    assert.deepEqual(px(sliver, 3 * w), px(all, 3 * w), 'a sliver inside one row draws that row');
  });

  test('with no tint the color is white; with a tint it is tint * 0.6 + 120, clamped', () => {
    const w = 2, h = 1;
    const white = lit(makeRelief(picture(w, h, () => FLAT), null, w, h), { x: 0, y: 0 });
    assert.deepEqual([...white.subarray(0, 3)], [255, 255, 255]);
    const tint = picture(w, h, (x) => (x === 0 ? [0, 100, 255, 255] : [10, 20, 30, 255]));
    const out = lit(makeRelief(picture(w, h, () => FLAT), tint, w, h), { x: 0, y: 0 });
    assert.deepEqual([...out.subarray(0, 3)], [120, 180, 255]);
    assert.deepEqual([...out.subarray(4, 7)], [126, 132, 138]);
    // 255 * 0.6 + 120 is 273: it is 255, in the relief and in the output, in every channel.
    const hot = makeRelief(picture(w, h, () => FLAT), picture(w, h, () => [255, 255, 255, 255]), w, h);
    assert.deepEqual([...hot.color.subarray(0, 3)], [255, 255, 255]);
    assert.deepEqual([...lit(hot, { x: 0, y: 0 }).subarray(0, 3)], [255, 255, 255]);
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
