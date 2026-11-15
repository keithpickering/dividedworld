/**
 * The dent's displacement map and the filter's parts (docs/plans/2026-11-15-steel-chair-plan.md, Task 4).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DENT_SCALE, dentMap, dentMapUrl, dentPrimitives, filterTrusted } from './dent.ts';

const SIZE = 160;
const px = (m: Uint8ClampedArray, x: number, y: number) => { const i = (y * SIZE + x) * 4; return { r: m[i], g: m[i + 1], b: m[i + 2], a: m[i + 3] }; };

describe('dentMap', () => {
  const m = dentMap();
  test('is size by size RGBA and the scale is 26', () => {
    assert.equal(m.length, SIZE * SIZE * 4);
    assert.equal(DENT_SCALE, 26);
  });
  test('the center (a pixel from it, so within a few steps) and the rim are neutral', () => {
    const c = px(m, 80, 80);
    assert.ok(Math.abs(c.r - 128) <= 8);
    assert.ok(Math.abs(c.g - 128) <= 8);
    for (const [x, y] of [[0, 80], [159, 80], [80, 0], [80, 159], [0, 0], [159, 159]]) {
      const p = px(m, x, y);
      assert.deepEqual([p.r, p.g, p.b], [128, 128, 128]);
    }
  });
  /* The map's VECTOR points away from the center (the plan's direction). feDisplacementMap samples the source at P + scale·(C − 0.5), so
     on screen the words around the ring are drawn in toward the middle; the owner judges that look in review. */
  test("the map's vector points outward from the center all around the ring, with blue neutral", () => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      const p = px(m, Math.round(80 + dx * 80 * 0.35 - 0.5), Math.round(80 + dy * 80 * 0.35 - 0.5));
      if (Math.abs(dx) > 0.2) assert.equal(Math.sign(p.r - 128), Math.sign(dx));
      if (Math.abs(dy) > 0.2) assert.equal(Math.sign(p.g - 128), Math.sign(dy));
      assert.equal(p.b, 128);
    }
  });
  test('every pixel is opaque', () => {
    for (let i = 3; i < m.length; i += 4) assert.equal(m[i], 255);
  });
});

describe('dentMapUrl', () => {
  test('is empty where there is no document to draw a canvas on', () => {
    assert.equal(typeof document, 'undefined');
    assert.equal(dentMapUrl(), '');
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
  test('a dent is 160 px centered on its point, and never wider than 60% of the box', () => {
    const [a] = dentPrimitives([{ x: 300, y: 100 }], { width: 600, height: 300 });
    assert.deepEqual(a, { x: 220, y: 20, size: 160 });
    const [b] = dentPrimitives([{ x: 100, y: 50 }], { width: 200, height: 100 });
    assert.ok(Math.abs(b.size - 120) < 1e-6);
    assert.ok(Math.abs(b.x - 40) < 1e-6);
  });
  test('one primitive per dent, in order', () => {
    assert.deepEqual(dentPrimitives([{ x: 1, y: 2 }, { x: 3, y: 4 }], { width: 800, height: 400 }).map((p) => p.x + p.size / 2), [1, 3]);
  });
});
