/**
 * Whoops!'s own rules: its price, its ink, its strokes and their bounds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STROKES, whoops } from './whoops.ts';
import { encodePoints } from './whoops/points.ts';
import type { Pt } from './whoops/scrub.ts';
import { defaults as settings } from '../settings.ts';
import { post, seenOf } from './test-kit.ts';
import { POINT_BUDGET, thinned, washedShare } from './whoops/seen.ts';

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

test('Whoops! says what the splat looks like to a reader, and how much of it has been scrubbed away', () => {
  const stroke = (width: number, points: Pt[]) => ({ tool: 'wash', width, aspect: 2, points: pack(points) });
  const sweep = (width: number) => stroke(width, Array.from({ length: 30 }, (_, i): Pt => [i / 29, 0.5]));
  const wholeBox = Array.from({ length: 12 }, (_, i) => stroke(0.5, Array.from({ length: 30 }, (_, j): Pt => [j / 29, i / 11])));
  const config = { color: 'teal', seed: 12345 };
  assert.equal(seenOf('whoops', { config }), 'Wario covered this post in a big teal splat of goop, 2 days ago.', 'a bare play: nothing is washed');
  assert.equal(seenOf('whoops', { config, by: null }), 'Someone covered this post in a big teal splat of goop, 2 days ago.');
  assert.equal(seenOf('whoops', { config: { color: '#ff00aa' } }), 'Wario covered this post in a big splat of goop, 2 days ago.', 'a hex ink is not a word');
  assert.equal(seenOf('whoops', { config, state: { strokes: [] } }), seenOf('whoops', { config }), 'a save with no strokes washes nothing');
  assert.equal(seenOf('whoops', { config, state: { strokes: [], clean: true } }), 'Wario covered this post in a big teal splat of goop, 2 days ago. It has all been scrubbed away.');
  // Every band the engine says is told in the card's words; the share behind it is the screens' own.
  const said = (strokes: object[]) => seenOf('whoops', { config, state: { strokes }, amountWords: (share) => `<${share.toFixed(2)}>` });
  assert.match(said([sweep(0.04)]), /^Wario covered .* 2 days ago\. <0\.\d\d> of it has been scrubbed away\.$/, 'a thin line is some of it, said through amountWords');
  assert.match(said(wholeBox), /<0\.99> of it has been scrubbed away\.$/, 'a layer still holding ink is never all of it');
  for (const [words, then] of [['a bit', 'A bit'], ['some', 'Some'], ['about half', 'About half'], ['most', 'Most'], ['almost all', 'Almost all']] as const) {
    assert.match(seenOf('whoops', { config, state: { strokes: [sweep(0.04)] }, amountWords: () => words }), new RegExp(`2 days ago\\. ${then} of it has been scrubbed away\\.$`), words);
  }
  assert.doesNotMatch(seenOf('whoops', { config, state: { strokes: [sweep(0.04)] }, amountWords: () => 'none' }), /scrubbed/, 'none says nothing');
  // The real bands rise with the strokes: a dab is little, the whole box is most.
  const rank = ['none', 'a bit', 'some', 'about half', 'most', 'almost all', 'all'];
  const at = (strokes: object[]) => rank.findIndex((w) => seenOf('whoops', { config, state: { strokes } }).includes(`${w[0]!.toUpperCase()}${w.slice(1)} of it`) || (w === 'none' && !/scrubbed/.test(seenOf('whoops', { config, state: { strokes } }))));
  assert.ok(at([sweep(0.04)]) < at(wholeBox), 'more washing reads as more');
  assert.equal(at(wholeBox), rank.indexOf('almost all'));
});

test('the staff\'s read of a Whoops! thins a maximum-stroke play to bounded work, and leaves an ordinary one alone', () => {
  const line = (n: number, y: number): Pt[] => Array.from({ length: n }, (_, i): Pt => [i / (n - 1), y]);
  const stroke = (n: number, y: number) => ({ tool: 'wash' as const, width: 0.05, aspect: 2, points: line(n, y) });
  const ordinary = [stroke(20, 0.3), stroke(20, 0.6)];
  assert.deepEqual(thinned(ordinary), ordinary, 'a small play is replayed whole');
  const most = Array.from({ length: STROKES.most }, (_, i) => stroke(STROKES.totalPoints / STROKES.most, i / STROKES.most));
  const kept = thinned(most);
  assert.equal(kept.length, STROKES.most, 'every stroke stays');
  assert.ok(kept.reduce((n, s) => n + s.points.length, 0) <= POINT_BUDGET + 2 * STROKES.most, 'the points replayed are bounded, not the 40,000 the card allows');
  for (const [i, s] of kept.entries()) assert.deepEqual([s.points[0], s.points.at(-1)], [most[i]!.points[0], most[i]!.points.at(-1)], 'a stroke keeps its first and last point');
  const config = { seed: 3 };
  const share = washedShare(config, { strokes: most.map((s) => ({ ...s, points: pack([...s.points]) })) });
  assert.ok(share > 0 && share < 1);
});
