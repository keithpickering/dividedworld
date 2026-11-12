/** What the card keeps of a stroke's points: packed into a string (the ink field design, section 4). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePoints, encodePoints } from './points.ts';
import type { Pt } from './scrub.ts';

const td = (n: number) => Math.round(n * 10_000) / 10_000;
/** A small seeded generator, so a failure repeats. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('500 random points round trip to a ten-thousandth', () => {
  const r = rng(7);
  const pts: Pt[] = Array.from({ length: 500 }, () => [r(), r()]);
  const s = encodePoints(pts);
  assert.match(s, /^[A-Za-z0-9_-]+$/, 'base64url with no padding');
  assert.equal(s.length, Math.ceil((500 * 4 * 4) / 3), '4 bytes a point, 3 bytes to 4 characters, no padding');
  assert.deepEqual(decodePoints(s), pts.map(([x, y]) => [td(x), td(y)]));
});

test('a one-point stroke is 4 bytes', () => {
  assert.deepEqual(decodePoints(encodePoints([[0.1235, 0.9877]])), [[0.1235, 0.9877]]);
  assert.equal(encodePoints([[0, 0]]), 'AAAAAA');
});

test('a jump from 0 to 10,000 and back is kept', () => {
  const pts: Pt[] = [[0, 0], [1, 1], [0, 0], [1, 0], [0, 1]];
  assert.deepEqual(decodePoints(encodePoints(pts)), pts);
});

test('a string that is not what the card writes decodes to null', () => {
  const good = encodePoints([[0.2, 0.2], [0.3, 0.3]]);
  assert.notEqual(decodePoints(good), null);
  assert.equal(decodePoints(good.slice(0, 1) + '+' + good.slice(2)), null, 'a character outside base64url');
  assert.equal(decodePoints(good + '='), null, 'padding');
  assert.equal(decodePoints(good.slice(0, -2)), null, 'a length off by a byte (7 bytes)');
  assert.equal(decodePoints(good + 'AA'), null, 'a length off by a byte (9 bytes)');
  assert.equal(decodePoints(''), null, 'no points');
  // A difference that leaves the box: the first point at 0.5, then a step of +20000.
  const bytes = Buffer.alloc(8);
  bytes.writeUInt16LE(5000, 0); bytes.writeUInt16LE(5000, 2); bytes.writeInt16LE(20_000, 4); bytes.writeInt16LE(0, 6);
  assert.equal(decodePoints(bytes.toString('base64url')), null, 'a point past 1');
  bytes.writeInt16LE(-20_000, 4);
  assert.equal(decodePoints(bytes.toString('base64url')), null, 'a point before 0');
  const first = Buffer.alloc(4);
  first.writeUInt16LE(10_001, 0);
  assert.equal(decodePoints(first.toString('base64url')), null, 'a first point past 1');
});
