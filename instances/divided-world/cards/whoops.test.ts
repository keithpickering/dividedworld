/**
 * Whoops!'s own rules: its price, its ink, its strokes and their bounds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STROKES, whoops } from './whoops.ts';
import { encodePoints } from './whoops/points.ts';
import type { Pt } from './whoops/scrub.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';

test('Whoops! costs 0.25 more per 500 characters of its target, at most 2.00 added', () => {
  const config = { color: '#ff00aa' };
  assert.equal(whoops.playPrice(settings, post(499), config), 0);
  assert.equal(whoops.playPrice(settings, post(500), config), 25);
  assert.equal(whoops.playPrice(settings, post(999), config), 25);
  assert.equal(whoops.playPrice(settings, post(1000), config), 50);
  assert.equal(whoops.playPrice(settings, post(6000), config), 200, 'twelve steps would be 3.00 on top; 2.00 is the most a play adds');
  assert.equal(whoops.playPrice(settings, post(1_000_000), config), 200);
});

test('Whoops!\'s ink is a color, and only a color', () => {
  assert.deepEqual(whoops.validateConfig({ color: '#FF00AA' }), { ok: true, value: { color: '#ff00aa' } });
  assert.deepEqual(whoops.validateConfig({ color: 'Teal' }), { ok: true, value: { color: 'teal' } });
  assert.deepEqual(whoops.validateConfig({ color: 'beige' }), { ok: true, value: { color: 'beige' } }, 'the same list as a post\'s [color]');
  for (const color of ['url(javascript:alert(1))', 'red; background: x', '#ff00a', 'notacolor', '', 7, null]) {
    assert.equal(whoops.validateConfig({ color }).ok, false, String(color));
  }
  assert.equal(whoops.validateConfig(null).ok, false);
});

const pack = (points: Pt[]) => encodePoints(points);

test('Whoops! strokes wash or ink, in shares of the post body\'s box: across 0 to 1, down 0 to 1', () => {
  const ink = { tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: pack([[0.1, 0.2], [0.3, 0.4]]) };
  const wash = { tool: 'wash', width: 0.3, aspect: 2.99, points: pack([[0.5, 0.5]]) };
  assert.equal(whoops.validateState!({ strokes: [ink, wash] }).ok, true);
  assert.equal(whoops.validateState!({ strokes: [] }).ok, true, 'nothing saved yet');
  assert.deepEqual(whoops.validateState!({ strokes: [wash], clean: true }), { ok: true, value: { strokes: [wash], clean: true } }, 'washed clean, said by the author\'s save');
  assert.equal(whoops.validateState!({ strokes: [], clean: 'yes' }).ok, false);
  // A state 0026 moved aside keeps its old strokes under legacy; a save never carries it back.
  assert.deepEqual(whoops.validateState!({ strokes: [wash], legacy: { strokes: [{ width: 0.05, points: [[0.1, 0.2]] }] } }), { ok: true, value: { strokes: [wash] } }, 'a save takes no legacy');
  const refused = (stroke: object, why: RegExp, label: string) => {
    const r = whoops.validateState!({ strokes: [stroke] });
    assert.equal(r.ok, false, label);
    assert.match(String(!r.ok && r.why), why, label);
  };
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: pack([[1, 1]]) }] }).ok, true, 'down to 1');
  refused({ ...ink, aspect: undefined }, /aspect/, 'a missing aspect');
  refused({ ...ink, aspect: 0 }, /aspect/, 'an aspect of 0');
  refused({ ...ink, aspect: 5000 }, /aspect/, 'an aspect of 5000');
  refused({ ...ink, aspect: Number.NaN }, /aspect/, 'an aspect that is not a number');
  refused({ ...ink, width: 1.5 }, /wide/, 'too wide');
  refused({ ...ink, width: 0.00004 }, /wide/, 'a width that keeps to nothing');
  refused({ ...ink, tool: 'brush' }, /washes or inks/, 'a tool is wash or ink');
  refused({ ...ink, color: undefined }, /color/, 'ink carries a color');
  refused({ ...wash, color: 'red' }, /no color/, 'a wash carries none');
  refused({ ...ink, color: 'url(x)' }, /color/, 'not a color');
  assert.equal(whoops.validateState!({ strokes: Array(201).fill(ink) }).ok, false, 'too many strokes');
  assert.equal(whoops.validateState!({ strokes: 'all of them' }).ok, false);
});

test('Whoops! refuses a stroke whose points are not packed as the card writes them, and the old shape', () => {
  const ink = { tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: pack([[0.1, 0.2], [0.3, 0.4]]) };
  const wash = { tool: 'wash', width: 0.3, aspect: 3, points: pack([[0.3, 0.4], [0.5, 0.5]]) };
  const refused = (strokes: object[], why: RegExp, label: string) => {
    const r = whoops.validateState!({ strokes });
    assert.equal(r.ok, false, label);
    assert.match(String(!r.ok && r.why), why, label);
  };
  const packed = /points are packed as the card writes them/;
  refused([{ ...ink, points: [[0.1, 0.2]] }], packed, 'an old-shape stroke');
  refused([{ ...ink, points: 'not+base64url' }], packed, 'a string that does not decode');
  refused([{ ...ink, points: 7 }], packed, 'points that are not a string');
  refused([{ ...ink, points: '' }], packed, 'no points');
  refused([{ ...ink, points: pack(Array.from({ length: 501 }, (): Pt => [0.5, 0.5])) }], /at most 500 points in a stroke/, 'too many points in one stroke');
  refused(Array.from({ length: 81 }, () => ({ ...ink, points: pack(Array.from({ length: 500 }, (): Pt => [0.5, 0.5])) })), /at most 40000 points in all/, 'too many points in all');
  assert.equal(whoops.validateState!({ strokes: Array.from({ length: 80 }, () => ({ ...ink, points: pack(Array.from({ length: 500 }, (): Pt => [0.5, 0.5])) })) }).ok, true, 'exactly 40,000');
  // continues: true or absent, and only on a stroke that starts where the last ended.
  const cont = { ...wash, tool: 'ink', color: '#000000', width: 0.04, aspect: 3, points: pack([[0.3, 0.4], [0.6, 0.6]]) };
  assert.equal(whoops.validateState!({ strokes: [ink, { ...cont, continues: true }] }).ok, true, 'a piece that starts where the last ended');
  const started = /a continued stroke starts where the last ended/;
  refused([ink, { ...cont, continues: false }], /continues/, 'continues is true or absent');
  refused([{ ...ink, continues: true }], started, 'continues on the first stroke');
  refused([ink, { ...cont, points: pack([[0.31, 0.4], [0.6, 0.6]]), continues: true }], started, 'a first point that is not the last one');
  refused([ink, { ...cont, width: 0.05, continues: true }], started, 'a different width');
  refused([ink, { ...cont, aspect: 2, continues: true }], started, 'a different aspect');
  refused([wash, { ...cont, continues: true }], started, 'a different tool');
  refused([ink, { ...cont, color: '#ff0000', continues: true }], started, 'a different color');
  refused([{ ...ink, drops: 2 }, { ...cont, continues: true }], /only a line's last piece throws drops/, 'drops before a continued piece');
  assert.equal(whoops.validateState!({ strokes: [ink, { ...cont, continues: true, drops: 2 }] }).ok, true, 'drops on the last piece');
  // drops: a whole number 0 to 3, on an ink stroke.
  for (const d of [0, 1, 2, 3]) assert.equal(whoops.validateState!({ strokes: [{ ...ink, drops: d }] }).ok, true, `drops ${d}`);
  for (const d of [4, -1, 1.5, '1', null]) refused([{ ...ink, drops: d }], /drops are a whole number from 0 to 3/, `drops ${JSON.stringify(d)}`);
  refused([{ ...wash, drops: 1 }], /drops are a whole number from 0 to 3/, 'drops on a wash');
});

test('the most strokes Whoops! saves fit the database\'s bound, as Postgres writes them', () => {
  // The true worst case: the most strokes, each with an equal share of the total points, every key of every stroke at its longest:
  // a seven-character color, continues, drops 3 (on the last piece, the only one that may), the widest width, a three-figure aspect, and every point's difference the largest.
  const each = STROKES.totalPoints / STROKES.most;
  assert.ok(Number.isInteger(each) && each <= STROKES.points);
  // Alternating corners: each difference is 10,000 or -10,000 (each point packs to four bytes whatever its difference).
  const corners = (from: 0 | 1) => pack(Array.from({ length: each }, (_, i): Pt => ((i + from) % 2 === 0 ? [0, 0] : [1, 1])));
  const [there, back] = [corners(0), corners(1)]; // a piece ends on the corner the next one starts on
  const pieces = Array.from({ length: STROKES.most }, (_, i) => ({ tool: 'ink', color: '#abcdef', width: 0.9999, aspect: 0.00123, points: i % 2 === 0 ? there : back, ...(i > 0 ? { continues: true } : null), ...(i === STROKES.most - 1 ? { drops: 3 } : null) }));
  const saved = whoops.validateState!({ strokes: pieces, clean: false });
  assert.equal(saved.ok, true, saved.ok ? '' : saved.why);
  const plain = JSON.stringify(saved.ok && saved.value);
  // jsonb's text puts a space after every comma and colon.
  const asPostgres = JSON.stringify(saved.ok && saved.value).replace(/([,:])/g, '$1 ');
  console.log(`largest save: ${Buffer.byteLength(plain)} bytes as JSON.stringify, ${Buffer.byteLength(asPostgres)} as Postgres writes it`);
  assert.ok(Buffer.byteLength(plain) <= 262_144 * 0.95, `${Buffer.byteLength(plain)} bytes`);
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144 * 0.95, `${Buffer.byteLength(asPostgres)} bytes`);
  assert.equal(whoops.validateState!({ strokes: [...pieces, { tool: 'wash', width: 1, aspect: 1, points: pack([[0, 0]]) }] }).ok, false, 'one stroke past the most');
});

test('a stroke\'s width is kept to a ten-thousandth, its aspect to three significant figures, its points packed back', () => {
  const saved = whoops.validateState!({ strokes: [{ tool: 'ink', color: 'red', width: 0.123456, aspect: 2.34567, points: pack([[0.123456, 0.987654]]) }] });
  assert.deepEqual(saved.ok && saved.value, { strokes: [{ tool: 'ink', color: 'red', width: 0.1235, aspect: 2.35, points: pack([[0.1235, 0.9877]]) }] });
  const small = whoops.validateState!({ strokes: [{ tool: 'wash', width: 0.5, aspect: 0.0123456, points: pack([[0, 0]]) }] });
  assert.deepEqual(small.ok && small.value, { strokes: [{ tool: 'wash', width: 0.5, aspect: 0.0123, points: pack([[0, 0]]) }] });
  const pieces = whoops.validateState!({ strokes: [{ tool: 'ink', color: 'red', width: 0.1, aspect: 2, points: pack([[0.1, 0.1], [0.2, 0.2]]) }, { tool: 'ink', color: 'red', width: 0.1, aspect: 2, points: pack([[0.2, 0.2], [0.3, 0.3]]), continues: true, drops: 2 }] });
  assert.deepEqual(pieces.ok && (pieces.value as { strokes: { continues?: true; drops?: number }[] }).strokes.map((s) => [s.continues, s.drops]), [[undefined, undefined], [true, 2]], 'continues and drops are kept');
});

test('it draws an effect, and a layer washed clean (the state\'s clean is true) stops counting toward the post\'s limit', () => {
  const cleared = whoops.drawsEffect?.cleared;
  assert.ok(whoops.drawsEffect, 'it declares drawsEffect');
  assert.ok(cleared, 'and says when it is cleared');
  assert.equal(cleared({ strokes: [], clean: true }), true);
  assert.equal(cleared({ strokes: [], clean: false }), false);
  assert.equal(cleared({ strokes: [] }), false);
  for (const odd of [{}, null, 'clean', undefined, [], 1]) assert.equal(cleared(odd), false, JSON.stringify(odd));
});
