/**
 * The dent's height map and its three images (docs/plans/2026-11-16-steel-chair-dent-plan.md, Task 1), the filter's parts, a dent's own
 * shape from its play's id, which dents overlap, and the hit zone a short post's throws aim at (owner's answers of 2026-11-15, see dent.ts).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rng, throwOf } from './body.ts';
import {
  AXIS_MAX, AXIS_MIN, DENT_SCALE, HALF, LIGHT, RELIEF, SPREAD, dentBend, dentHeight, dentImages, dentLight, dentPrimitives, dentShade, dentShape, dentsOverlap, filterTrusted,
  hitZone, THROW_X, THROW_Y,
} from './dent.ts';

const IDS = Array.from({ length: 20 }, (_, i) => `height-play-${i}`);
const SIZES = [[160, 140], [120, 160]] as const;
/** The maps are built once per id and size for the whole file (nothing here changes a map). */
const mapCache = new Map<string, Float32Array>();
const mapOf = (id: string, w: number, h: number): Float32Array => {
  const key = `${id}|${w}|${h}`;
  let m = mapCache.get(key);
  if (!m) { m = dentHeight(dentShape(id), w, h); mapCache.set(key, m); }
  return m;
};
/** A pixel's box coordinates: u and v run -1 to 1 across the box, sampled at the pixel's center. */
const uv = (x: number, y: number, w: number, h: number) => {
  const u = ((x + 0.5) / w) * 2 - 1, v = ((y + 0.5) / h) * 2 - 1;
  return { u, v, rho: Math.hypot(u, v) };
};
/** The mean of `pick` over the pixels `where` accepts. */
const meanOver = (w: number, h: number, where: (p: { u: number; v: number; rho: number }) => boolean, pick: (i: number) => number) => {
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (where(uv(x, y, w, h))) { sum += pick(y * w + x); n++; }
  return sum / n;
};

describe('the scale', () => {
  test('is the one this build ships', () => assert.equal(DENT_SCALE, 14));
});

describe('dentHeight: a height map, pressed in with a lip', () => {
  test('the same id gives the same array, with width times height values', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const a = mapOf(id, w, h);
      assert.equal(a.length, w * h);
      assert.deepEqual(a, dentHeight(dentShape(id), w, h));
    }
  });
  test('every sample at rho of 0.98 or more is exactly 0', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const m = mapOf(id, w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (uv(x, y, w, h).rho >= 0.98) assert.equal(m[y * w + x], 0, `${id} at ${x},${y}`);
    }
  });
  test('the lowest sample lies within rho of min(0.6 times the spread, 0.9)', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const m = mapOf(id, w, h);
      let low = 0, at = 0;
      for (let i = 0; i < m.length; i++) if (m[i]! < low) { low = m[i]!; at = i; }
      const p = uv(at % w, Math.floor(at / w), w, h);
      assert.ok(p.rho < Math.min(0.6 * SPREAD, 0.9), `${id} at ${w} by ${h}: the lowest is at rho ${p.rho}`);
    }
  });
  test('the middle is pressed in: its mean is below 0 and below the mean of the ring around it, which has a lip', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const m = mapOf(id, w, h);
      const middle = meanOver(w, h, (p) => p.rho < 0.3 * SPREAD, (i) => m[i]!);
      const ring = meanOver(w, h, (p) => p.rho > 0.5 * SPREAD && p.rho < Math.min(0.7 * SPREAD, 0.98), (i) => m[i]!);
      assert.ok(middle < 0 && middle < ring, `${id}: middle ${middle}, ring ${ring}`);
    }
  });
  test('the lip: the highest sample is clearly above 0 and lies at a box rho of 0.5 to 0.95', () => {
    // Measured over these ids and sizes: the highest sample is at least 0.041 and lies at rho 0.669 to 0.796 (the floor and the band are looser).
    for (const [w, h] of SIZES) for (const id of IDS) {
      const m = mapOf(id, w, h);
      let top = -Infinity, at = 0;
      for (let i = 0; i < m.length; i++) if (m[i]! > top) { top = m[i]!; at = i; }
      const p = uv(at % w, Math.floor(at / w), w, h);
      assert.ok(top >= 0.02, `${id} at ${w} by ${h}: the highest sample is ${top}`);
      assert.ok(p.rho >= 0.5 && p.rho <= 0.95, `${id} at ${w} by ${h}: the highest sample is at rho ${p.rho}`);
    }
  });
});

describe('dentShade: lit from the upper left, in front', () => {
  test('its darkest pixel is 128 (within 1) and flat metal is 255; every pixel at rho of 0.98 or more is 255', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const s = dentShade(mapOf(id, w, h), w, h);
      assert.equal(s.length, w * h * 4);
      let lo = 255, hi = 0;
      for (let i = 0; i < w * h; i++) {
        lo = Math.min(lo, s[i * 4]!); hi = Math.max(hi, s[i * 4]!);
        assert.ok(s[i * 4] === s[i * 4 + 1] && s[i * 4] === s[i * 4 + 2] && s[i * 4 + 3] === 255, 'gray and opaque');
      }
      assert.ok(Math.abs(lo - 128) <= 1, `${id}: darkest ${lo}`);
      assert.equal(hi, 255);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (uv(x, y, w, h).rho >= 0.98) assert.equal(s[(y * w + x) * 4], 255, `${id} at ${x},${y}`);
    }
  });
  /* The point of the spread (owner, 2026-11-16): the dent fills its box as the approved mock's does. The pixels the shade darkens at all (by 5 of 255 or
     more) span at least 70% of the box's width and of its height, for every id. (The recipe before the spread, `SPREAD` 1, reaches 56% of the box.) */
  test('the shade reaches the box: pixels at 250 or less span at least 70% of its width and of its height, for every id', () => {
    const [w, h] = [160, 140] as const;
    for (const id of IDS) {
      const s = dentShade(mapOf(id, w, h), w, h);
      let x0: number = w, x1 = -1, y0: number = h, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (s[(y * w + x) * 4]! <= 250) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      assert.ok((x1 - x0 + 1) / w >= 0.7 && (y1 - y0 + 1) / h >= 0.7, `${id}: shade spans ${(x1 - x0 + 1) / w} of the width, ${(y1 - y0 + 1) / h} of the height`);
    }
  });
  test('lit as a hollow: the upper left of the middle is darker than the lower right, for every id', () => {
    for (const id of IDS) {
      const [w, h] = [160, 140] as const;
      const s = dentShade(mapOf(id, w, h), w, h);
      const upperLeft = meanOver(w, h, (p) => p.u < -0.1 * SPREAD && p.v < -0.1 * SPREAD && p.rho < 0.5 * SPREAD, (i) => s[i * 4]!);
      const lowerRight = meanOver(w, h, (p) => p.u > 0.1 * SPREAD && p.v > 0.1 * SPREAD && p.rho < 0.5 * SPREAD, (i) => s[i * 4]!);
      assert.ok(upperLeft < lowerRight, `${id}: upper left ${upperLeft}, lower right ${lowerRight}`);
    }
  });
});

describe('dentLight: a soft sheen and a small glint', () => {
  test('every byte is at most 140, the bytes over 71 are at most 4% of the pixels inside the circle, and the rim is dark', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const l = dentLight(mapOf(id, w, h), w, h);
      assert.equal(l.length, w * h * 4);
      let inside = 0, bright = 0, top = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, p = uv(x, y, w, h);
        assert.ok(l[i] === l[i + 1] && l[i] === l[i + 2] && l[i + 3] === 255, 'gray and opaque');
        assert.ok(l[i]! <= 140, `${id}: ${l[i]}`);
        top = Math.max(top, l[i]!);
        if (p.rho < 1) { inside++; if (l[i]! > 71) bright++; }
        if (p.rho >= 0.98) assert.equal(l[i], 0, `${id} at ${x},${y}`);
      }
      assert.ok(bright <= 0.04 * inside, `${id}: ${bright} of ${inside} are over 71`);
      assert.ok(top >= 71, `${id}: the largest byte is ${top}, there is no light`);
    }
  });
});

describe('dentLight: the last resort', () => {
  /* A map that is one tilted plane facing the halfway vector, with a slight bowl: every sample is near the glint's peak at any exponent, so the
     samples over 71 are far more than 4% however large P grows and the fallback is reached. The expected bytes are stated here on their own:
     the glint at P = 40 · 1.5^8 (eight multiplications, no ninth), scaled to 71, summed with the sheen and held to 140. */
  test('after eight multiplications of P the glint is scaled to 71 at that P', () => {
    const [w, h] = [64, 64];
    const m = new Float32Array(w * h);
    const relief = RELIEF * SPREAD;
    const slopeU = -HALF[0] / HALF[2] / relief, slopeV = -HALF[1] / HALF[2] / relief;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * 2 - 1, v = ((y + 0.5) / h) * 2 - 1;
      m[y * w + x] = slopeU * u + slopeV * v + 0.2 * (u * u + v * v);
    }
    const lam = new Float64Array(w * h), spec = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      const hu = (m[y * w + x1]! - m[y * w + x0]!) / ((x1 - x0) * (2 / w)), hv = (m[y1 * w + x]! - m[y0 * w + x]!) / ((y1 - y0) * (2 / h));
      const len = Math.hypot(relief * hu, relief * hv, 1), nx = -relief * hu / len, ny = -relief * hv / len, nz = 1 / len;
      lam[y * w + x] = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      spec[y * w + x] = nx * HALF[0] + ny * HALF[1] + nz * HALF[2];
    }
    const soft = Array.from(lam, (l) => Math.max(0, l - LIGHT[2]));
    const softScale = 71 / 255 / Math.max(...soft);
    const P = 40 * 1.5 ** 8, floor = HALF[2] ** P;
    const glint = Array.from(spec, (s) => Math.max(0, s ** P - floor) / (1 - floor));
    const glintScale = 71 / 255 / Math.max(...glint);
    const expected = Array.from(soft, (s, i) => Math.round(255 * Math.min(140 / 255, s * softScale + glint[i]! * glintScale)));
    const got = dentLight(m, w, h);
    let inside = 0, bright = 0;
    for (let i = 0; i < w * h; i++) {
      const { rho } = uv(i % w, Math.floor(i / w), w, h);
      if (rho < 1) { inside++; if (expected[i]! > 71) bright++; }
    }
    assert.ok(bright > 0.04 * inside, 'the map is one the glint cannot be made small on');
    assert.deepEqual(Array.from(got).filter((_, i) => i % 4 === 0), expected);
  });
});

describe('dentBend: the slope, pointing uphill', () => {
  test('blue is 128 and alpha 255 everywhere; the rim is neutral; the largest offset is 73 to 75', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const b = dentBend(mapOf(id, w, h), w, h);
      assert.equal(b.length, w * h * 4);
      let peak = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        assert.equal(b[i + 2], 128); assert.equal(b[i + 3], 255);
        peak = Math.max(peak, Math.abs(b[i]! - 128), Math.abs(b[i + 1]! - 128));
        if (uv(x, y, w, h).rho >= 0.98) assert.deepEqual([b[i], b[i + 1]], [128, 128], `${id} at ${x},${y}`);
      }
      assert.ok(peak >= 73 && peak <= 75, `${id}: the largest offset is ${peak}`);
    }
  });
  /* The vector points uphill, away from the bowl's floor (see the comment above dentBend): feDisplacementMap samples the source at
     P + scale·(C - 0.5), so on screen the words around the ring are drawn in toward the middle. */
  test('points outward on the whole: in 16 sectors of the ring, the mean dot with the outward direction is positive in at least 12', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const b = dentBend(mapOf(id, w, h), w, h);
      const sum = new Array<number>(16).fill(0), n = new Array<number>(16).fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = uv(x, y, w, h);
        if (!(p.rho > 0.25 * SPREAD && p.rho < 0.6 * SPREAD)) continue;
        const k = Math.min(15, Math.floor(((Math.atan2(p.v, p.u) + Math.PI) / (2 * Math.PI)) * 16));
        const i = (y * w + x) * 4;
        sum[k]! += ((b[i]! - 128) * p.u + (b[i + 1]! - 128) * p.v) / p.rho; n[k]!++;
      }
      const positive = sum.filter((s, k) => s / n[k]! > 0).length;
      assert.ok(positive >= 12, `${id} at ${w} by ${h}: ${positive} of 16 sectors point outward`);
    }
  });
});

describe('dentImages: three images a dent, made once a play', () => {
  const box = { x: 0, y: 0, size: 160, width: 160, height: 140 };
  const counting = () => {
    const calls: { w: number; h: number; length: number }[] = [];
    return { calls, toUrl: (px: Uint8ClampedArray, w: number, h: number) => { calls.push({ w, h, length: px.length }); return `data:${calls.length}`; } };
  };
  test('the same key twice calls toUrl three times, not six', () => {
    const { calls, toUrl } = counting();
    const a = dentImages('cache-twice', box, 1, toUrl);
    const b = dentImages('cache-twice', box, 1, toUrl);
    assert.equal(calls.length, 3);
    assert.deepEqual(a, b);
    assert.equal(new Set([a.bend, a.shade, a.light]).size, 3);
  });
  test('the key is play, size and density: another density is made again', () => {
    const { calls, toUrl } = counting();
    dentImages('cache-density', box, 1, toUrl);
    dentImages('cache-density', box, 2, toUrl);
    assert.equal(calls.length, 6);
  });
  test('after 32 other keys the first is made again', () => {
    const { calls, toUrl } = counting();
    dentImages('cache-first', box, 1, toUrl);
    for (let i = 0; i < 32; i++) dentImages(`cache-other-${i}`, box, 1, toUrl);
    const before = calls.length;
    dentImages('cache-first', box, 1, toUrl);
    assert.equal(calls.length, before + 3);
  });
  test("the bend is the box's size and the shade's and light's are the box's times the density", () => {
    const { calls, toUrl } = counting();
    dentImages('cache-sizes', { x: 3, y: 4, size: 150.4, width: 150.4, height: 120.6 }, 2, toUrl);
    assert.deepEqual(calls.map((c) => [c.w, c.h]), [[150, 121], [300, 242], [300, 242]]);
    assert.deepEqual(calls.map((c) => c.length), [150 * 121 * 4, 300 * 242 * 4, 300 * 242 * 4]);
  });
  test('a box that rounds to under 1 px on either side draws nothing: empty images, toUrl not called, nothing cached', () => {
    const { calls, toUrl } = counting();
    for (const [width, height] of [[0, 0], [0.4, 120], [120, 0.4]] as const) {
      const made = dentImages('cache-empty', { x: 0, y: 0, size: Math.max(width, height), width, height }, 1, toUrl);
      assert.deepEqual(made, { bend: '', shade: '', light: '' }, `${width} by ${height}`);
    }
    assert.equal(calls.length, 0);
    dentImages('cache-empty', box, 1, toUrl);
    assert.equal(calls.length, 3, 'a real box under the same play is still made');
  });
  test('is empty for each image where there is no document (the default toUrl)', () => {
    assert.equal(typeof document, 'undefined');
    assert.deepEqual(dentImages('cache-none', box, 1), { bend: '', shade: '', light: '' });
  });
});

describe('filterTrusted', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
  const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1';
  test('trusts Chrome and Firefox, not Safari or any iOS browser', () => {
    assert.equal(filterTrusted({ userAgent: chrome, supportsFilterUrl: true }), true);
    assert.equal(filterTrusted({ userAgent: firefox, supportsFilterUrl: true }), true);
    assert.equal(filterTrusted({ userAgent: safari, supportsFilterUrl: true }), false);
    assert.equal(filterTrusted({ userAgent: iosChrome, supportsFilterUrl: true }), false);
  });
  test('not where the browser cannot take a url() filter', () => {
    assert.equal(filterTrusted({ userAgent: chrome, supportsFilterUrl: false }), false);
  });
});

describe('dentPrimitives', () => {
  test('a round dent is 160 px centered on its point, and never wider than 60% of the box', () => {
    const a = dentPrimitives([{ x: 300, y: 100 }], { width: 600, height: 300 })[0]!;
    assert.deepEqual(a, { x: 220, y: 20, size: 160, width: 160, height: 160 });
    const b = dentPrimitives([{ x: 100, y: 50 }], { width: 200, height: 100 })[0]!;
    assert.ok(Math.abs(b.size - 120) < 1e-6);
    assert.ok(Math.abs(b.x - 40) < 1e-6);
  });
  test('one primitive per dent, in order', () => {
    assert.deepEqual(dentPrimitives([{ x: 1, y: 2 }, { x: 3, y: 4 }], { width: 800, height: 400 }).map((p) => p.x + p.size / 2), [1, 3]);
  });
  test("a shaped dent's axes follow its shape, the larger one never wider than 60% of the box, centered on its point", () => {
    for (const width of [200, 400, 900]) {
      for (let i = 0; i < 50; i++) {
        const shape = dentShape(`play-${i}`);
        const p = dentPrimitives([{ x: 500, y: 90, shape }], { width, height: 300 })[0]!;
        assert.ok(Math.max(p.width, p.height) <= 0.6 * width + 1e-9, `${p.width} by ${p.height} in a box ${width} wide`);
        assert.ok(Math.max(p.width, p.height) <= 160 + 1e-9);
        assert.ok(Math.abs(p.x + p.width / 2 - 500) < 1e-9 && Math.abs(p.y + p.height / 2 - 90) < 1e-9);
        assert.ok(Math.abs(p.width / p.height - shape.rx / shape.ry) < 1e-9, 'the aspect is the shape');
        assert.equal(p.size, Math.max(p.width, p.height));
      }
    }
  });
});

describe('dentShape: each dent its own shape, from the play id alone', () => {
  test('the same id gives the same shape, every time', () => {
    for (const id of ['sc1', 'sc2', 'sc3']) assert.deepEqual(dentShape(id), dentShape(id));
  });
  test('three ids give three shapes that differ', () => {
    const [a, b, c] = ['sc1', 'sc2', 'sc3'].map(dentShape) as [ReturnType<typeof dentShape>, ReturnType<typeof dentShape>, ReturnType<typeof dentShape>];
    for (const [p, q] of [[a, b], [a, c], [b, c]] as const) {
      assert.notDeepEqual(p, q);
      assert.notDeepEqual(p.crumple, q.crumple);
      assert.notDeepEqual(p.waves, q.waves);
    }
  });
  test('every field stays in its stated range over many ids, with 2 to 4 lobes', () => {
    assert.equal(AXIS_MIN, 0.85);
    assert.equal(AXIS_MAX, 1.15);
    const counts = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const s = dentShape(`some-play-id-${i}-${i * 7919}`);
      for (const v of [s.rx, s.ry]) assert.ok(v >= AXIS_MIN && v <= AXIS_MAX, `axis ${v}`);
      assert.ok(s.turn >= 0 && s.turn < 360, `turn ${s.turn}`);
      assert.equal(s.waves.length, 3);
      for (const w of s.waves) assert.ok(w.amp >= -0.1 && w.amp <= 0.1 && w.phase >= 0 && w.phase < 2 * Math.PI, `wave ${w.amp} ${w.phase}`);
      assert.ok(s.lobes.length >= 2 && s.lobes.length <= 4, `${s.lobes.length} lobes`);
      counts.add(s.lobes.length);
      for (const l of s.lobes) {
        assert.ok(Math.hypot(l.u, l.v) <= 0.3 + 1e-9, `lobe at ${l.u}, ${l.v}`);
        assert.ok(l.radius >= 0.12 && l.radius <= 0.22 && l.depth >= 0.3 && l.depth <= 0.6, `lobe ${l.radius} ${l.depth}`);
      }
      assert.equal(s.crumple.length, 81);
      for (const v of s.crumple) assert.ok(v >= -0.5 && v <= 0.5, `crumple ${v}`);
      assert.ok(!('outline' in s));
    }
    assert.deepEqual([...counts].sort(), [2, 3, 4]);
  });
  test('and they spread: over 500 ids the turns cover every quarter and the first axis passes 1 both ways', () => {
    const shapes = Array.from({ length: 500 }, (_, i) => dentShape(`id-${i}`));
    for (let q = 0; q < 4; q++) assert.ok(shapes.some((s) => Math.floor(s.turn / 90) === q), `quarter ${q}`);
    assert.ok(shapes.some((s) => s.rx > 1.1) && shapes.some((s) => s.rx < 0.9));
  });
});

describe('dentsOverlap: footprints that intersect', () => {
  const at = (x: number, y: number, width = 100, height = 100) => ({ x: x - width / 2, y: y - height / 2, width, height });
  test('two round dents overlap when their centers are closer than the sum of the radii', () => {
    assert.equal(dentsOverlap(at(0, 0), at(99, 0)), true);
    assert.equal(dentsOverlap(at(0, 0), at(101, 0)), false);
    assert.equal(dentsOverlap(at(0, 0), at(70, 70)), true);
    assert.equal(dentsOverlap(at(0, 0), at(72, 72)), false);
  });
  test('an ellipse reaches farther along its long axis', () => {
    assert.equal(dentsOverlap(at(0, 0, 160, 60), at(120, 0, 160, 60)), true);
    assert.equal(dentsOverlap(at(0, 0, 160, 60), at(0, 70, 160, 60)), false);
  });
  test('a dent overlaps itself and the test is symmetric', () => {
    assert.equal(dentsOverlap(at(5, 5), at(5, 5)), true);
    assert.equal(dentsOverlap(at(0, 0, 120, 80), at(100, 30)), dentsOverlap(at(100, 30), at(0, 0, 120, 80)));
  });
});

describe('hitZone: a short text box grows so that dents can land off the line', () => {
  const dent = { width: 160, height: 160 };
  const area = { width: 900, height: 240 };
  /** Where throwOf's target can fall in a box: 15% to 85% across, 15% to 60% down. */
  const zone = (b: { left: number; top: number; width: number; height: number }) => ({
    x0: b.left + THROW_X[0] * b.width, x1: b.left + THROW_X[1] * b.width, y0: b.top + THROW_Y[0] * b.height, y1: b.top + THROW_Y[1] * b.height,
  });
  test("throwOf's own inset is the one the zone arithmetic assumes (15 to 85 across, 15 to 60 down), over 2000 throws", () => {
    const box = { left: 30, top: 40, width: 500, height: 200 };
    const z = zone(box);
    const r = rng(7);
    let lowX = Infinity, highY = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const t = throwOf(r, box).target;
      assert.ok(t.x >= z.x0 - 1e-9 && t.x <= z.x1 + 1e-9 && t.y >= z.y0 - 1e-9 && t.y <= z.y1 + 1e-9);
      lowX = Math.min(lowX, t.x); highY = Math.max(highY, t.y);
    }
    assert.ok(lowX < z.x0 + 5 && highY > z.y1 - 5, 'the zone is reached, not just bounded');
  });
  test('a text box as tall as a dent or taller is handed back unchanged', () => {
    const tall = { left: 10, top: 8, width: 700, height: 160 };
    assert.deepEqual(hitZone(tall, area, dent), tall);
    const taller = { left: 10, top: 8, width: 700, height: 300 };
    assert.deepEqual(hitZone(taller, { width: 900, height: 400 }, dent), taller);
  });
  test('a one-line box grows: a dent may land a full diameter beside or below the line, its circle inside the area', () => {
    const line = { left: 300, top: 100, width: 80, height: 18 };
    const big = { width: 900, height: 400 };
    const z = zone(hitZone(line, big, dent));
    /* Across: a diameter (160) beyond the line on each side. Down: from the radius above the line (as before) to a diameter below it. */
    assert.ok(Math.abs(z.x0 - 140) < 1e-9 && Math.abs(z.x1 - 540) < 1e-9, `across ${z.x0} to ${z.x1}`);
    assert.ok(Math.abs(z.y0 - 80) < 1e-9 && Math.abs(z.y1 - 278) < 1e-9, `down ${z.y0} to ${z.y1}`);
    /* So a dent may lie wholly beside the line (its right rim left of the text), and wholly below it. */
    assert.ok(z.x0 + 80 <= line.left && z.x1 - 80 >= line.left + line.width);
    assert.ok(z.y1 - 80 >= line.top + line.height);
  });
  test('a one-line box near a border is held to the area: the circle stays inside', () => {
    const line = { left: 10, top: 9, width: 80, height: 18 };
    const z = zone(hitZone(line, area, dent));
    for (const [v, lo, hi] of [[z.x0, 80, 820], [z.x1, 80, 820], [z.y0, 80, 160], [z.y1, 80, 160]] as const) assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${v} outside ${lo}..${hi}`);
    assert.ok(Math.abs(z.x0 - 80) < 1e-9 && Math.abs(z.x1 - 250) < 1e-9, `across ${z.x0} to ${z.x1}`);
  });
  test('every dent a one-line post can throw lies inside the area when the area is large enough', () => {
    const line = { left: 10, top: 9, width: 80, height: 18 };
    const grown = hitZone(line, area, dent);
    const r = rng(11);
    for (let i = 0; i < 500; i++) {
      const t = throwOf(r, grown).target;
      assert.ok(t.x - 80 >= -1e-6 && t.x + 80 <= area.width + 1e-6 && t.y - 80 >= -1e-6 && t.y + 80 <= area.height + 1e-6, `${t.x}, ${t.y}`);
    }
  });
  test('in an area too small for a dent, the zone is its middle', () => {
    const z = zone(hitZone({ left: 10, top: 9, width: 80, height: 18 }, { width: 900, height: 100 }, dent));
    assert.ok(Math.abs(z.y0 - 50) < 1e-6 && Math.abs(z.y1 - 50) < 1e-6);
  });
  test('a short wide line still spreads sideways within the area', () => {
    const z = zone(hitZone({ left: 10, top: 9, width: 800, height: 18 }, { width: 900, height: 300 }, dent));
    assert.ok(z.x0 >= 80 - 1e-9 && z.x1 <= 820 + 1e-9 && z.x1 > z.x0);
  });
});
