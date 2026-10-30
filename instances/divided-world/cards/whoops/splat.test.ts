/**
 * Whoops!'s pure half (design, section 11; plan Task 5): the seeded splat and the shading by the ink's luminance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, covers, luminance, makeSplat, mulberry32, shading, tagText } from './splat.ts';
import { NAMED_COLORS } from '../../../../engine/bbcode/parse.ts';

test('the generator is deterministic: one seed and one post height always give one splat', () => {
  assert.deepEqual(makeSplat(20261029, 12), makeSplat(20261029, 12));
  assert.equal(makeSplat(7, 3).path, makeSplat(7, 3).path);
  const a = mulberry32(5), b = mulberry32(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(mulberry32(5)(), mulberry32(6)());
});

test('different seeds give different splats', () => {
  const paths = new Set([1, 2, 3, 4, 5, 2 ** 31 - 1].map((s) => makeSplat(s, 12).path));
  assert.equal(paths.size, 6);
  assert.notEqual(makeSplat(1, 12).placement.cx, makeSplat(2, 12).placement.cx);
});

test('a splat is one closed path in widths of the layout, with a lumpy blob, arms and droplets', () => {
  for (const seed of [0, 1, 99, 2 ** 31 - 1]) {
    const s = makeSplat(seed, 10);
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

test('the splat sits on the post: its blob keeps inside the post laid out that tall, however tall', () => {
  for (const seed of [3, 4, 5, 6]) {
    const s = makeSplat(seed, 8);
    assert.ok(s.placement.cy - s.placement.ry >= -1e-9 && s.placement.cy + s.placement.ry <= 8 + 1e-9);
    assert.deepEqual(makeSplat(seed, 500), makeSplat(seed, 64), 'the post counts only to the 64 widths a stroke can reach');
  }
});

test('on a tall post the blob is one place, not a smear: its height is at most 1.3 times its width', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { rx, ry } = makeSplat(seed, 64).placement;
    assert.ok(ry <= 1.3 * rx + 1e-3, `seed ${seed}: ry ${ry} against rx ${rx}`);
    assert.ok(rx >= 0.42 - 1e-3 && rx <= 0.56 + 1e-3);
  }
});

test('where the splat sits down a tall post is the seed\'s, and the whole blob stays inside the post', () => {
  const centers = new Set<number>();
  for (let seed = 1; seed <= 200; seed++) {
    for (const height of [8, 20, 64]) {
      const s = makeSplat(seed, height);
      let top = Infinity, bottom = -Infinity;
      for (const [, y] of s.blob) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      assert.ok(top >= -1e-9 && bottom <= height + 1e-9, `seed ${seed}, ${height} tall: blob from ${top} to ${bottom}`);
    }
    centers.add(makeSplat(seed, 64).placement.cy);
  }
  assert.ok(centers.size > 150, 'the center falls in different places for different seeds');
  const ys = [...centers];
  assert.ok(Math.max(...ys) - Math.min(...ys) > 20, 'and over a wide stretch of the post');
});

test('a post of any height, or a height that is not a number, still gives a finite splat', () => {
  assert.deepEqual(makeSplat(5, Infinity), makeSplat(5, 64), 'an unbounded height is the deepest, not zero');
  assert.notDeepEqual(makeSplat(5, Infinity), makeSplat(5, 0));
  assert.deepEqual(makeSplat(5, NaN), makeSplat(5, 0));
  assert.deepEqual(makeSplat(5, -Infinity), makeSplat(5, 0));
  assert.equal(makeSplat(5, Infinity).path.includes('NaN'), false);
});

test('covers holds the blob and every arm and droplet circle, and nothing outside', () => {
  for (const seed of [1, 2, 3, 99]) {
    const s = makeSplat(seed, 12);
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
    const s = makeSplat(seed, 12);
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

test('the tag is black on a pale ink and white on a dark one, with 4.5:1 or better', () => {
  assert.equal(tagText('#ffffff'), '#000000');
  assert.equal(tagText('yellow'), '#000000');
  assert.equal(tagText('#000'), '#ffffff');
  assert.equal(tagText('navy'), '#ffffff');
  for (const name of NAMED_COLORS) assert.ok(contrast(tagText(name), name) >= 4.5, name);
  for (let v = 0; v < 256; v += 5) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    assert.ok(contrast(tagText(hex), hex) >= 4.5, hex);
  }
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
});
