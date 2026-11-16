/**
 * The dent's displacement map and the filter's parts (docs/plans/2026-11-15-steel-chair-plan.md, Task 4), a dent's own shape and turn from its
 * play's id, which dents overlap, and the hit zone a short post's throws aim at (owner's answers of 2026-11-15, see dent.ts).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rng, throwOf } from './body.ts';
import {
  AXIS_MAX, AXIS_MIN, DENT_SCALE, dentMap, dentMapUrl, dentPrimitives, dentShape, dentsOverlap, filterTrusted, hitZone, THROW_X, THROW_Y,
} from './dent.ts';

const SIZE = 160;
const px = (m: Uint8ClampedArray, x: number, y: number) => { const i = (y * SIZE + x) * 4; return { r: m[i]!, g: m[i + 1]!, b: m[i + 2]!, a: m[i + 3]! }; };

describe('dentMap', () => {
  const m = dentMap();
  test('is size by size RGBA and the scale is the one this build ships', () => {
    assert.equal(m.length, SIZE * SIZE * 4);
    assert.equal(DENT_SCALE, 14);
  });
  test('the center (a pixel from it, so within a few steps) and the rim are neutral', () => {
    const c = px(m, 80, 80);
    assert.ok(Math.abs(c.r - 128) <= 8);
    assert.ok(Math.abs(c.g - 128) <= 8);
    for (const [x, y] of [[0, 80], [159, 80], [80, 0], [80, 159], [0, 0], [159, 159]] as [number, number][]) {
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
  /* The plan's bytes are 128 + 127·sin(r·π)·(1 − r), whose peak is 0.58 of the range (at r of about 0.35), not the whole range: a map
     stretched to its peak pushed the words 1/0.58 times too far and squeezed those inside a dent near unreadable. */
  test("the ring's peak push is the plan's, about 0.58 of 127 bytes, in every direction", () => {
    let peak = 0;
    for (let i = 0; i < m.length; i += 4) peak = Math.max(peak, Math.abs(m[i]! - 128), Math.abs(m[i + 1]! - 128));
    assert.ok(peak >= 72 && peak <= 75, `the largest byte offset is ${peak}, not 0.58 * 127 = 73.7`);
    const p = px(m, Math.round(80 + 80 * 0.35 - 0.5), 80);
    assert.ok(Math.abs(p.r - 128 - 73.5) <= 2, `the ring's red offset is ${p.r - 128}`);
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

describe('dentShape: each dent its own shape and turn, from the play id alone', () => {
  const ids = ['sc1', 'sc2', 'sc3'];
  test('the same id gives the same shape, every time', () => {
    for (const id of ids) assert.deepEqual(dentShape(id), dentShape(id));
  });
  test('three ids give three shapes that differ: in turn by at least 15 degrees, and in an axis or the outline by a visible margin', () => {
    const [a, b, c] = ids.map(dentShape) as [ReturnType<typeof dentShape>, ReturnType<typeof dentShape>, ReturnType<typeof dentShape>];
    const apart = (p: typeof a, q: typeof a) => {
      const turn = Math.abs(((p.turn - q.turn + 540) % 360) - 180);
      assert.ok(turn >= 15, `turns ${p.turn} and ${q.turn} are ${turn} apart`);
      /* An outline point is a percentage of the box, 42 to 58; 4 points of it is about as visible as 0.04 of an axis. */
      const form = Math.max(Math.abs(p.rx - q.rx), Math.abs(p.ry - q.ry), ...p.outline.map((o, i) => Math.abs(o - q.outline[i]!) / 100));
      assert.ok(form >= 0.04, `forms differ by ${form}`);
    };
    apart(a, b); apart(a, c); apart(b, c);
  });
  test('values stay in their stated ranges over many ids: axes 0.85 to 1.15, turn 0 to 360, outline points 42 to 58', () => {
    assert.equal(AXIS_MIN, 0.85);
    assert.equal(AXIS_MAX, 1.15);
    for (let i = 0; i < 500; i++) {
      const s = dentShape(`some-play-id-${i}-${i * 7919}`);
      for (const v of [s.rx, s.ry]) assert.ok(v >= AXIS_MIN && v <= AXIS_MAX, `axis ${v}`);
      assert.ok(s.turn >= 0 && s.turn < 360, `turn ${s.turn}`);
      for (const o of s.outline) assert.ok(o >= 42 && o <= 58, `outline ${o}`);
    }
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
