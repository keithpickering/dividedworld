/**
 * The dent's height map and its three images (docs/plans/2026-11-16-steel-chair-dent-plan.md, Task 1), the filter's parts, a dent's own
 * shape from its play's id, which dents overlap, and the hit zone a short post's throws aim at (owner's answers of 2026-11-15, see dent.ts).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { rng, throwOf } from './body.ts';
import {
  AXIS_MAX, AXIS_MIN, DENT_SCALE, FULL_DENT, HALF, LEAST_ZONE, LIGHT, RELIEF, SPREAD, capped, dentBend, dentHeight, dentImages, dentLight, dentPrimitives, dentShade, dentShape,
  dentsOverlap, filterTrusted, hitZone, zoneHeight, THROW_X, THROW_Y,
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
  test('its darkest pixel is 128 and flat metal is 255; every pixel at rho of 0.98 or more is 255', () => {
    for (const [w, h] of SIZES) for (const id of IDS) {
      const s = dentShade(mapOf(id, w, h), w, h);
      assert.equal(s.length, w * h * 4);
      let lo = 255, hi = 0;
      for (let i = 0; i < w * h; i++) {
        const g = 255 - s[i * 4 + 3]!;
        lo = Math.min(lo, g); hi = Math.max(hi, g);
        assert.ok(s[i * 4] === 0 && s[i * 4 + 1] === 0 && s[i * 4 + 2] === 0, 'black');
      }
      assert.equal(lo, 128, `${id}: darkest ${lo}`);
      assert.equal(hi, 255);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (uv(x, y, w, h).rho >= 0.98) assert.equal(255 - s[(y * w + x) * 4 + 3]!, 255, `${id} at ${x},${y}`);
    }
  });
  /* The point of the spread (owner, 2026-11-16): the dent fills its box as the approved mock's does. The pixels the shade darkens at all (by 5 of 255 or
     more) span at least 70% of the box's width and of its height, for every id. (The recipe before the spread, `SPREAD` 1, reaches 56% of the box.) */
  test('the shade reaches the box: pixels at 250 or less span at least 70% of its width and of its height, for every id', () => {
    const [w, h] = [160, 140] as const;
    for (const id of IDS) {
      const s = dentShade(mapOf(id, w, h), w, h);
      let x0: number = w, x1 = -1, y0: number = h, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (255 - s[(y * w + x) * 4 + 3]! <= 250) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      assert.ok((x1 - x0 + 1) / w >= 0.7 && (y1 - y0 + 1) / h >= 0.7, `${id}: shade spans ${(x1 - x0 + 1) / w} of the width, ${(y1 - y0 + 1) / h} of the height`);
    }
  });
  test('lit as a hollow: the upper left of the middle is darker than the lower right, for every id', () => {
    for (const id of IDS) {
      const [w, h] = [160, 140] as const;
      const s = dentShade(mapOf(id, w, h), w, h);
      const upperLeft = meanOver(w, h, (p) => p.u < -0.1 * SPREAD && p.v < -0.1 * SPREAD && p.rho < 0.5 * SPREAD, (i) => 255 - s[i * 4 + 3]!);
      const lowerRight = meanOver(w, h, (p) => p.u > 0.1 * SPREAD && p.v > 0.1 * SPREAD && p.rho < 0.5 * SPREAD, (i) => 255 - s[i * 4 + 3]!);
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
        assert.ok(l[i] === 255 && l[i + 1] === 255 && l[i + 2] === 255, 'white');
        assert.ok(l[i + 3]! <= 140, `${id}: ${l[i + 3]}`);
        top = Math.max(top, l[i + 3]!);
        if (p.rho < 1) { inside++; if (l[i + 3]! > 71) bright++; }
        if (p.rho >= 0.98) assert.equal(l[i + 3], 0, `${id} at ${x},${y}`);
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
    assert.deepEqual(Array.from(got).filter((_, i) => i % 4 === 3), expected);
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
    const a = dentImages('cache-twice', box, 1, undefined, toUrl);
    const b = dentImages('cache-twice', box, 1, undefined, toUrl);
    assert.equal(calls.length, 3);
    assert.deepEqual(a, b);
    assert.equal(new Set([a.bend, a.shade, a.light]).size, 3);
  });
  test('the key is play, size and density: another density is made again', () => {
    const { calls, toUrl } = counting();
    dentImages('cache-density', box, 1, undefined, toUrl);
    dentImages('cache-density', box, 2, undefined, toUrl);
    assert.equal(calls.length, 6);
  });
  test('after 32 other keys the first is made again', () => {
    const { calls, toUrl } = counting();
    dentImages('cache-first', box, 1, undefined, toUrl);
    for (let i = 0; i < 32; i++) dentImages(`cache-other-${i}`, box, 1, undefined, toUrl);
    const before = calls.length;
    dentImages('cache-first', box, 1, undefined, toUrl);
    assert.equal(calls.length, before + 3);
  });
  test("the bend is the box's size and the shade's and light's are the box's times the density", () => {
    const { calls, toUrl } = counting();
    dentImages('cache-sizes', { x: 3, y: 4, size: 150.4, width: 150.4, height: 120.6 }, 2, undefined, toUrl);
    assert.deepEqual(calls.map((c) => [c.w, c.h]), [[150, 121], [300, 242], [300, 242]]);
    assert.deepEqual(calls.map((c) => c.length), [150 * 121 * 4, 300 * 242 * 4, 300 * 242 * 4]);
  });
  test('a box that rounds to under 1 px on either side draws nothing: empty images, toUrl not called, nothing cached', () => {
    const { calls, toUrl } = counting();
    for (const [width, height] of [[0, 0], [0.4, 120], [120, 0.4]] as const) {
      const made = dentImages('cache-empty', { x: 0, y: 0, size: Math.max(width, height), width, height }, 1, undefined, toUrl);
      assert.deepEqual(made, { bend: '', shade: '', light: '' }, `${width} by ${height}`);
    }
    assert.equal(calls.length, 0);
    dentImages('cache-empty', box, 1, undefined, toUrl);
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
    const b = dentPrimitives([{ x: 100, y: 50 }], { width: 200, height: 300 })[0]!;
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
  test('a text box as tall as a dent or taller, whose zone of centers lies inside the area, is handed back unchanged', () => {
    const same = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => {
      for (const k of ['left', 'top', 'width', 'height'] as const) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} vs ${b[k]}`);
    };
    const tall = { left: 10, top: 90, width: 700, height: 160 };
    same(hitZone(tall, { width: 900, height: 400 }, dent), tall);
    const taller = { left: 10, top: 90, width: 700, height: 300 };
    same(hitZone(taller, { width: 900, height: 600 }, dent), taller);
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

/* ---------- the images carry their own alpha, the cap, and the room (docs/plans/2026-11-16-steel-chair-origin-plan.md, Task 1) ---------- */

const shadeGray = (px: Uint8ClampedArray) => Uint8Array.from({ length: px.length / 4 }, (_, i) => 255 - px[i * 4 + 3]!);
const lightGray = (px: Uint8ClampedArray) => Uint8Array.from({ length: px.length / 4 }, (_, i) => px[i * 4 + 3]!);
/** A dent of `play` at `w` by `h` px (density 1) with its box at `x`, `y`, as `capped` takes it. */
const dentAt = (play: string, x: number, y: number, w = 80, h = 80) => {
  const map = dentHeight(dentShape(play), w, h);
  return { box: { x, y, width: w, height: h }, width: w, height: h, shade: shadeGray(dentShade(map, w, h)), light: lightGray(dentLight(map, w, h)) };
};

describe('the shade and the light are alpha images', () => {
  const [w, h] = [96, 88];
  test('the shade is black with alpha 255 - g: flat is alpha 0 and the darkest is exactly 127', () => {
    for (const id of IDS.slice(0, 6)) {
      const s = dentShade(mapOf(id, w, h), w, h);
      let top = 0;
      for (let i = 0; i < w * h; i++) {
        assert.deepEqual([s[i * 4], s[i * 4 + 1], s[i * 4 + 2]], [0, 0, 0]);
        top = Math.max(top, s[i * 4 + 3]!);
      }
      assert.equal(top, 127, `${id}: the darkest alpha is ${top}`);
      assert.equal(s[3], 0, 'a corner is flat');
    }
  });
  test('the light is white with the old gray as its alpha: 0 where flat, at most 140, the glint over 71 at most 4%', () => {
    for (const id of IDS.slice(0, 6)) {
      const l = dentLight(mapOf(id, w, h), w, h);
      let top = 0, bright = 0, inside = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        assert.deepEqual([l[i], l[i + 1], l[i + 2]], [255, 255, 255]);
        top = Math.max(top, l[i + 3]!);
        if (uv(x, y, w, h).rho < 1) { inside++; if (l[i + 3]! > 71) bright++; }
      }
      assert.ok(top <= 140 && top >= 71, `${id}: ${top}`);
      assert.ok(bright <= 0.04 * inside);
      assert.equal(l[3], 0, 'a corner is flat');
    }
  });
  test('laid over a color, each is what the multiply and the screen gave, within half a level', () => {
    for (const id of IDS.slice(0, 4)) {
      const s = dentShade(mapOf(id, w, h), w, h), l = dentLight(mapOf(id, w, h), w, h);
      for (let i = 0; i < w * h; i += 7) {
        const g = 255 - s[i * 4 + 3]!, lv = l[i * 4 + 3]!;
        for (const c of [247, 30, 128]) {
          const shaded = c * (1 - s[i * 4 + 3]! / 255), multiplied = (c * g) / 255;
          assert.ok(Math.abs(shaded - multiplied) <= 0.5, `${id} shade over ${c}`);
          const lit = c + ((255 - c) * l[i * 4 + 3]!) / 255, screened = 255 - ((255 - c) * (255 - lv)) / 255;
          assert.ok(Math.abs(lit - screened) <= 0.5, `${id} light over ${c}`);
        }
      }
    }
  });
});

describe('capped: a dent over earlier ones takes the darker and the lighter, not the product', () => {
  /** The shades laid over white in arithmetic: the color left, out of 255. */
  const over = (grays: number[]) => grays.reduce((acc, g) => (acc * g) / 255, 255);
  test('two dents overlapping by half: the composite is min(g1, g2) within 2 levels, and outside the overlap the capped image is the uncapped one', () => {
    for (const [pa, pb] of [['cap-a', 'cap-b'], ['cap-c', 'cap-d'], ['cap-e', 'cap-f']] as const) {
      const a = dentAt(pa, 0, 0), b = dentAt(pb, 40, 0);
      const out = capped(b, [a]);
      assert.equal(out.shade.length, 80 * 80);
      let overlapSeen = 0;
      for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
        const i = y * 80 + x;
        if (x < 40) {
          const ga = a.shade[y * 80 + x + 40]!, la = a.light[y * 80 + x + 40]!;
          assert.ok(Math.abs(over([ga, out.shade[i]!]) - Math.min(ga, b.shade[i]!)) <= 2, `${pa} shade at ${x},${y}`);
          assert.ok(Math.abs(255 - ((255 - la) * (255 - out.light[i]!)) / 255 - Math.max(la, b.light[i]!)) <= 2, `${pa} light at ${x},${y}`);
          assert.ok(over([ga, out.shade[i]!]) >= 128 - 2, 'never below half the color');
          if (ga < 250 && b.shade[i]! < 250) overlapSeen++;
        } else {
          assert.equal(out.shade[i], b.shade[i], `${pa} shade outside at ${x},${y}`);
          assert.equal(out.light[i], b.light[i], `${pa} light outside at ${x},${y}`);
        }
      }
      assert.ok(overlapSeen > 20, 'the dents shade each other somewhere');
    }
  });
  test('three dents overlapping at one point: the third is capped against the first two', () => {
    const a = dentAt('cap-3a', 0, 0), b = dentAt('cap-3b', 30, 0), c = dentAt('cap-3c', 15, 0);
    const bc = capped(b, [a]);
    const cc = capped(c, [a, b]);
    let seen = 0;
    for (let y = 0; y < 80; y++) for (let x = 15; x < 65; x++) {
      // c's pixel x is a's pixel x + 15 and b's pixel x - 15 (all boxes sit on whole pixels)
      const ia = y * 80 + x + 15, ib = y * 80 + x - 15, ic = y * 80 + x;
      const ga = a.shade[ia]!, gb = b.shade[ib]!, gc = c.shade[ic]!;
      const comp = over([ga, bc.shade[ib]!, cc.shade[ic]!]);
      assert.ok(Math.abs(comp - Math.min(ga, gb, gc)) <= 2, `shade at ${x},${y}: ${comp} vs ${Math.min(ga, gb, gc)}`);
      assert.ok(comp >= 128 - 2);
      const la = a.light[ia]!, lb = b.light[ib]!, lc = c.light[ic]!;
      const screen = 255 - ((255 - la) * (255 - bc.light[ib]!) * (255 - cc.light[ic]!)) / 255 ** 2;
      assert.ok(Math.abs(screen - Math.max(la, lb, lc)) <= 2, `light at ${x},${y}`);
      if (ga < 250 && gb < 250 && gc < 250) seen++;
    }
    assert.ok(seen > 10, 'the three shade one another somewhere');
  });
  test('a dent that overlaps nothing is not corrected', () => {
    const a = dentAt('cap-far-a', 0, 0), b = dentAt('cap-far-b', 200, 0);
    const out = capped(b, [a]);
    assert.deepEqual(Array.from(out.shade), Array.from(b.shade));
    assert.deepEqual(Array.from(out.light), Array.from(b.light));
    const alone = capped(b, []);
    assert.deepEqual(Array.from(alone.shade), Array.from(b.shade));
  });
});

describe('capped: off the grid, at density 2, in unequal boxes, past an edge', () => {
  /** A dent whose grid is `density` times its box (so its pixels are smaller than the area's). */
  const dentAtD = (play: string, x: number, y: number, w: number, h: number, density: number) => {
    const gw = Math.round(w * density), gh = Math.round(h * density);
    const map = dentHeight(dentShape(play), gw, gh);
    return { box: { x, y, width: w, height: h }, width: gw, height: gh, shade: shadeGray(dentShade(map, gw, gh)), light: lightGray(dentLight(map, gw, gh)) };
  };
  /** The test's own bilinear read of a gray map at the area point (px, py): the earlier dent's own function, not `capped`'s code. */
  const readAt = (e: ReturnType<typeof dentAtD>, map: Uint8Array, px: number, py: number): number => {
    const gx = Math.min(e.width - 1, Math.max(0, ((px - e.box.x) / e.box.width) * e.width - 0.5));
    const gy = Math.min(e.height - 1, Math.max(0, ((py - e.box.y) / e.box.height) * e.height - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(e.width - 1, x0 + 1), y1 = Math.min(e.height - 1, y0 + 1), fx = gx - x0, fy = gy - y0;
    return (map[y0 * e.width + x0]! * (1 - fx) + map[y0 * e.width + x1]! * fx) * (1 - fy) + (map[y1 * e.width + x0]! * (1 - fx) + map[y1 * e.width + x1]! * fx) * fy;
  };
  const check = (label: string, own: ReturnType<typeof dentAtD>, earlier: ReturnType<typeof dentAtD>[]) => {
    const out = capped(own, earlier);
    const sx = own.box.width / own.width, sy = own.box.height / own.height;
    let worstShade = 0, worstLight = 0, inside = 0, shaded = 0;
    for (let y = 0; y < own.height; y++) for (let x = 0; x < own.width; x++) {
      const i = y * own.width + x, px = own.box.x + (x + 0.5) * sx, py = own.box.y + (y + 0.5) * sy;
      const hit = earlier.filter((e) => px >= e.box.x && px <= e.box.x + e.box.width && py >= e.box.y && py <= e.box.y + e.box.height);
      if (hit.length === 0) {
        assert.equal(out.shade[i], own.shade[i], `${label}: shade outside at ${x},${y}`);
        assert.equal(out.light[i], own.light[i], `${label}: light outside at ${x},${y}`);
        continue;
      }
      inside++;
      const m = Math.min(...hit.map((e) => readAt(e, e.shade, px, py))), big = Math.max(...hit.map((e) => readAt(e, e.light, px, py)));
      const comp = (m * out.shade[i]!) / 255, screen = 255 - ((255 - big) * (255 - out.light[i]!)) / 255;
      worstShade = Math.max(worstShade, Math.abs(comp - Math.min(m, own.shade[i]!)));
      worstLight = Math.max(worstLight, Math.abs(screen - Math.max(big, own.light[i]!)));
      if (m < 250 && own.shade[i]! < 250) shaded++;
    }
    assert.ok(inside > 0, `${label}: the dents overlap`);
    assert.ok(shaded > 10, `${label}: the dents shade each other somewhere (${shaded})`);
    assert.ok(worstShade <= 2, `${label}: the shade is off by ${worstShade}`);
    assert.ok(worstLight <= 2, `${label}: the light is off by ${worstLight}`);
    return { worstShade, worstLight };
  };
  test('a fractional offset (40.5, 13.25), where the bilinear read really interpolates', () => {
    for (const [pa, pb] of [['off-a', 'off-b'], ['off-c', 'off-d']] as const) check(pa, dentAtD(pb, 40.5, 13.25, 80, 80, 1), [dentAtD(pa, 0, 0, 80, 80, 1)]);
  });
  test('grids at density 2, the grid twice the box', () => {
    check('density 2', dentAtD('d2-b', 40.5, 13.25, 80, 80, 2), [dentAtD('d2-a', 0, 0, 80, 80, 2)]);
    check('own at 2, earlier at 1', dentAtD('d2-d', 37.25, 10.5, 80, 80, 2), [dentAtD('d2-c', 0, 0, 80, 80, 1)]);
  });
  test('two dents of different sizes in non-square boxes', () => {
    check('sizes', dentAtD('size-b', 50.5, 20, 70, 90, 1), [dentAtD('size-a', 0, 0, 100, 60, 1)]);
    check('sizes, small over large', dentAtD('size-d', 30.25, 5.5, 64, 48, 1), [dentAtD('size-c', 0, 0, 110, 120, 1)]);
  });
  test("a later dent that passes the earlier one's edge on two sides", () => {
    check('right and bottom', dentAtD('edge-b', 20.5, 25.25, 80, 80, 1), [dentAtD('edge-a', 0, 0, 80, 80, 1)]);
    check('left and top, density 2', dentAtD('edge-d', -25.5, -20.25, 80, 80, 2), [dentAtD('edge-c', 0, 0, 80, 80, 2)]);
  });
  test('two earlier dents, one off the grid, at once', () => {
    check('two earlier', dentAtD('two-c', 30.5, 12.75, 80, 80, 1), [dentAtD('two-a', 0, 0, 80, 80, 1), dentAtD('two-b', 55.25, 30, 70, 60, 2)]);
  });
});

describe('dentImages with earlier dents: the capped images and their cache', () => {
  const box = { x: 0, y: 0, size: 80, width: 80, height: 80 };
  const at = (x: number, y = 0) => ({ x, y, width: 80, height: 80 });
  /** An address that is the image's content (a hash of its bytes), so two images are equal exactly when their pixels are. */
  const hashing = () => {
    const calls: string[] = [];
    return {
      calls,
      toUrl: (px: Uint8ClampedArray, w: number, h: number) => {
        let a = 2166136261;
        for (let i = 0; i < px.length; i++) a = Math.imul(a ^ px[i]!, 16777619);
        const url = `${w}x${h}:${a >>> 0}`;
        calls.push(url);
        return url;
      },
    };
  };
  test('an intersecting earlier dent changes the shade and the light, and the bend is the kept one', () => {
    const { toUrl } = hashing();
    const alone = dentImages('ei-own', box, 1, [], toUrl);
    const over = dentImages('ei-own', box, 1, [{ play: 'ei-before', box: at(40) }], toUrl);
    assert.equal(over.bend, alone.bend);
    assert.notEqual(over.shade, alone.shade);
    assert.notEqual(over.light, alone.light);
  });
  test('an earlier dent that does not intersect leaves the kept images', () => {
    const { toUrl, calls } = hashing();
    const alone = dentImages('ei-far', box, 1, [], toUrl);
    const before = calls.length;
    // The bend, the shade and the light, and no capped pair beside them.
    assert.equal(before, 3, 'a dent alone makes its three images and no capped one');
    const far = dentImages('ei-far', box, 1, [{ play: 'ei-far-before', box: at(200) }], toUrl);
    assert.deepEqual(far, alone);
    assert.equal(calls.length, before, 'nothing new was made');
  });
  test('the same arrangement twice is one made image: a hit makes nothing', () => {
    const { toUrl, calls } = hashing();
    const a = dentImages('ei-twice', box, 1, [{ play: 'ei-twice-before', box: at(40) }], toUrl);
    const before = calls.length;
    const b = dentImages('ei-twice', box, 1, [{ play: 'ei-twice-before', box: at(40) }], toUrl);
    assert.equal(calls.length, before);
    assert.deepEqual(a, b);
  });
  test('another offset of the same earlier play, or another earlier play at the same offset, is another image', () => {
    const { toUrl } = hashing();
    const base = dentImages('ei-key', box, 1, [{ play: 'ei-key-before', box: at(40) }], toUrl);
    const moved = dentImages('ei-key', box, 1, [{ play: 'ei-key-before', box: at(41) }], toUrl);
    const other = dentImages('ei-key', box, 1, [{ play: 'ei-key-other', box: at(40) }], toUrl);
    assert.notEqual(moved.shade, base.shade);
    assert.notEqual(other.shade, base.shade);
    assert.notEqual(other.light, base.light);
  });
  test('the capped cache keeps at most 8: the ninth arrangement drops the first', () => {
    const { toUrl, calls } = hashing();
    const arrange = (k: number) => dentImages('ei-evict', box, 1, [{ play: 'ei-evict-before', box: at(20 + k) }], toUrl);
    for (let k = 0; k < 9; k++) arrange(k);
    let before = calls.length;
    arrange(8);
    assert.equal(calls.length, before, 'the newest is kept');
    arrange(1);
    assert.equal(calls.length, before, 'the second is kept');
    before = calls.length;
    arrange(0);
    assert.equal(calls.length, before + 2, 'the first is made again: its shade and its light');
  });
});

describe('dentPrimitives: the height a dent may land in', () => {
  const larger = (p: { width: number; height: number }) => Math.max(p.width, p.height);
  test('the larger axis is at most 160, at most 60% of the width and at most the height', () => {
    assert.equal(FULL_DENT, 160);
    assert.ok(Math.abs(larger(dentPrimitives([{ x: 300, y: 200 }], { width: 600, height: 400 })[0]!) - 160) < 1e-9);
    assert.ok(Math.abs(larger(dentPrimitives([{ x: 300, y: 30 }], { width: 600, height: 62 })[0]!) - 62) < 1e-9, '62 high');
    assert.ok(Math.abs(larger(dentPrimitives([{ x: 50, y: 200 }], { width: 100, height: 400 })[0]!) - 60) < 1e-9, '100 wide');
  });
  test('a dent with a shape keeps its proportions under the height limit', () => {
    for (let i = 0; i < 30; i++) {
      const shape = dentShape(`limit-${i}`);
      const p = dentPrimitives([{ x: 300, y: 30, shape }], { width: 600, height: 62 })[0]!;
      assert.ok(larger(p) <= 62 + 1e-9, `${p.width} by ${p.height}`);
      assert.ok(Math.abs(p.width / p.height - shape.rx / shape.ry) < 1e-9);
    }
  });
});

describe('hitZone: a tall text keeps the dent in the area too', () => {
  const dent = { width: 160, height: 160 };
  const corners = (b: { left: number; top: number; width: number; height: number }) =>
    THROW_X.flatMap((fx) => THROW_Y.map((fy) => ({ x: b.left + fx * b.width, y: b.top + fy * b.height })));
  const inside = (area: { width: number; height: number }, text: { left: number; top: number; width: number; height: number }) => {
    for (const t of corners(hitZone(text, area, dent))) {
      assert.ok(t.x - 80 >= -1e-9 && t.x + 80 <= area.width + 1e-9 && t.y - 80 >= -1e-9 && t.y + 80 <= area.height + 1e-9, `${t.x}, ${t.y} in ${area.width} by ${area.height}`);
    }
  };
  test('a text against the left border, the right border and the bottom', () => {
    inside({ width: 900, height: 400 }, { left: 0, top: 50, width: 300, height: 300 });
    inside({ width: 900, height: 400 }, { left: 600, top: 50, width: 300, height: 300 });
    inside({ width: 900, height: 300 }, { left: 100, top: 140, width: 500, height: 160 });
  });
  test('a text at the corner, and a text as wide as the area', () => {
    inside({ width: 900, height: 300 }, { left: 0, top: 0, width: 200, height: 200 });
    inside({ width: 900, height: 400 }, { left: 0, top: 0, width: 900, height: 400 });
  });
});

describe("zoneHeight: the area less the chairs' room, where that leaves a dent a place", () => {
  test('237 gives the full dent, 157 the least, below that the room is given up, 0 stays 0', () => {
    assert.equal(LEAST_ZONE, 80);
    assert.equal(zoneHeight(237), 160);
    assert.equal(zoneHeight(157), 80);
    assert.equal(zoneHeight(156), 156);
    assert.equal(zoneHeight(0), 0);
  });
});

describe('dentShape: the chair keeps its recorded dents (dent-record.json, taken before the objects)', () => {
  const record = JSON.parse(readFileSync(new URL('./dent-record.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  test('50 ids, with no object and with chair, equal the record', () => {
    const ids = Object.keys(record);
    assert.equal(ids.length, 50);
    for (const id of ids) {
      assert.deepEqual(dentShape(id), record[id], id);
      assert.deepEqual(dentShape(id, 'chair'), record[id], id);
    }
  });
});
