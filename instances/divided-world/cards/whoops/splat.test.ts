/**
 * Whoops!'s pure half (design, section 11; plan Task 5): the seeded splat and the shading by the ink's luminance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, covers, luminance, makeSplat, mulberry32, shading } from './splat.ts';
import { NAMED_COLORS } from '../../../../engine/bbcode/parse.ts';

test('the generator is deterministic: one seed and one post height always give one splat', () => {
  assert.deepEqual(makeSplat(20261029), makeSplat(20261029));
  assert.equal(makeSplat(7).path, makeSplat(7).path);
  const a = mulberry32(5), b = mulberry32(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(mulberry32(5)(), mulberry32(6)());
});

test('different seeds give different splats', () => {
  const paths = new Set([1, 2, 3, 4, 5, 2 ** 31 - 1].map((s) => makeSplat(s).path));
  assert.equal(paths.size, 6);
  assert.notEqual(makeSplat(1).placement.cx, makeSplat(2).placement.cx);
});

test('a splat is one closed path in widths of the layout, with a lumpy blob, arms and droplets', () => {
  for (const seed of [0, 1, 99, 2 ** 31 - 1]) {
    const s = makeSplat(seed);
    assert.match(s.path, /^M[-\d. ,MLAZa-z]+Z$/);
    assert.equal(s.path.includes('NaN'), false);
    assert.ok(s.blob.length >= 100);
    assert.ok(s.circles.length >= 10, 'arms and droplets are circles');
    const { minX, maxX, minY, maxY } = s.bounds;
    assert.ok(minX < 0.5 && maxX > 0.5 && minY < maxY);
    assert.ok(minX > -1 && maxX < 2, 'the ink runs a little into the margins and no further');
    assert.ok(minY >= -1, 'it starts at the top of the post, give or take an arm');
    assert.ok(covers(s, s.placement.cx, s.placement.cy), 'the center is inked');
    assert.equal(covers(s, maxX + 1, maxY + 1), false);
  }
});

test('the splat is the seed\'s alone: where it sits does not depend on how tall the post is, so an edit never moves it', () => {
  // The signature takes no height; a second argument a caller still passes changes nothing.
  const loose = makeSplat as unknown as (seed: number, height?: number) => ReturnType<typeof makeSplat>;
  for (const seed of [3, 4, 5, 6, 1234567]) {
    for (const height of [0.05, 1, 8, 64, Infinity, NaN]) assert.deepEqual(loose(seed, height), makeSplat(seed), `at ${height}`);
  }
});

test('the blob is one place, not a smear: its height is at most 1.3 times its width, and its width is the seed\'s', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { rx, ry } = makeSplat(seed).placement;
    assert.ok(ry <= 1.3 * rx + 1e-3 && ry >= 0.7 * rx - 1e-3, `seed ${seed}: ry ${ry} against rx ${rx}`);
    assert.ok(rx >= 0.42 - 1e-3 && rx <= 0.56 + 1e-3);
  }
});

test('the splat sits in the first band of the post: across its middle, and down from its top, so a post of a line is inked as a tall one is', () => {
  const centers = new Set<number>();
  for (let seed = 1; seed <= 200; seed++) {
    const s = makeSplat(seed);
    assert.ok(s.placement.cx >= 0.42 - 1e-3 && s.placement.cx <= 0.58 + 1e-3);
    assert.ok(s.bounds.minY < 0.1, `seed ${seed} starts at ${s.bounds.minY}: it reaches the post's top rows`);
    assert.ok(s.bounds.maxY < 3, `seed ${seed} ends at ${s.bounds.maxY}: within the first three widths`);
    assert.ok(s.placement.cy > 0 && s.placement.cy < 1.3, `seed ${seed}'s center is at ${s.placement.cy}`);
    centers.add(s.placement.cy);
  }
  assert.ok(centers.size > 150, 'the center falls in different places for different seeds');
});

test('covers holds the blob and every arm and droplet circle, and nothing outside', () => {
  for (const seed of [1, 2, 3, 99]) {
    const s = makeSplat(seed);
    const blobOnly = { blob: s.blob, circles: [], bounds: s.bounds };
    const outside = s.circles.filter(([x, y]) => !covers(blobOnly, x, y));
    assert.ok(outside.length > 0, 'some arm or droplet sits outside the blob');
    for (const [x, y, r] of outside) {
      assert.equal(covers(s, x, y), true, 'the circle\'s center is inked');
      assert.equal(covers(s, x + r * 0.9, y), true, 'and so is a point just inside its edge');
    }
    let rightmost = s.blob[0]!;
    for (const p of s.blob) if (p[0] > rightmost[0]) rightmost = p;
    assert.equal(covers(blobOnly, rightmost[0] + 0.001, rightmost[1]), false, 'just outside the blob');
    assert.equal(covers(blobOnly, s.placement.cx, s.placement.cy), true);
    const { minX, maxX, minY, maxY } = s.bounds;
    for (const [x, y] of [[minX - 0.01, s.placement.cy], [maxX + 0.01, s.placement.cy], [s.placement.cx, minY - 0.01], [s.placement.cx, maxY + 0.01]] as const) {
      assert.equal(covers(s, x, y), false, 'outside the bounds');
    }
  }
});

test('the arcs turn the way the blob does, so the nonzero rule fills the union and no overlap cuts a hole', () => {
  for (const seed of [1, 2, 3, 99]) {
    const s = makeSplat(seed);
    let area = 0;
    for (let i = 0, j = s.blob.length - 1; i < s.blob.length; j = i++) area += s.blob[j]![0] * s.blob[i]![1] - s.blob[i]![0] * s.blob[j]![1];
    assert.ok(area > 0, 'the blob is clockwise on a y-down plane (positive shoelace area)');
    const arcs = [...s.path.matchAll(/A([\d.]+) ([\d.]+) 0 (\d) (\d) /g)];
    assert.equal(arcs.length, s.circles.length * 2, 'two arcs make each circle');
    for (const arc of arcs) assert.equal(arc[4], '1', 'an arc sweeps clockwise on a y-down plane, as the blob winds');
  }
});

test('luminance is the WCAG relative luminance of the primaries', () => {
  assert.ok(Math.abs(luminance('#ff0000') - 0.2126) < 1e-9);
  assert.ok(Math.abs(luminance('#00ff00') - 0.7152) < 1e-9);
  assert.ok(Math.abs(luminance('#0000ff') - 0.0722) < 1e-9);
  assert.equal(luminance('#000'), 0);
  assert.ok(Math.abs(luminance('white') - 1) < 1e-9);
});

test('the shading: the highlight falls and the shadows rise with the ink\'s luminance', () => {
  const inks = ['#000000', '#800000', '#808080', '#c0c0c0', '#ffffff'].map((c) => shading(c));
  for (let i = 1; i < inks.length; i++) {
    assert.ok(inks[i]!.highlight < inks[i - 1]!.highlight, 'highlight falls');
    assert.ok(inks[i]!.edgeShadow > inks[i - 1]!.edgeShadow, 'edge shadow rises');
    assert.ok(inks[i]!.underside > inks[i - 1]!.underside, 'underside rises');
  }
  assert.ok(shading('#000').highlight > 0.2);
  assert.equal(shading('#fff').highlight, 0);
  assert.equal(shading('black').edgeShadow, 0);
  assert.deepEqual(shading('#f00'), shading('#ff0000'));
  assert.deepEqual(shading('White'), shading('#ffffff'));
});

test('every named color the card accepts has a shading', () => {
  for (const name of NAMED_COLORS) assert.ok(Number.isFinite(shading(name).highlight), name);
  assert.throws(() => shading('chartreuse'), RangeError);
});

test('contrast is the WCAG ratio, 1 to 21', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(contrast('#777777', '#777777'), 1);
});
