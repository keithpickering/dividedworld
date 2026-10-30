/**
 * Whoops!'s pure half (design, section 11; plan Task 5): the seeded splat and the shading by the ink's luminance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, covers, makeSplat, mulberry32, shading, tagText } from './splat.ts';
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
    const tall = makeSplat(seed, 500);
    assert.ok(tall.placement.cy <= 64, 'within the 64 widths a stroke can reach');
  }
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
