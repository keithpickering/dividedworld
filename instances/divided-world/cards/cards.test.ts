/**
 * Divided World's two cards (design, sections 7 and 10): Stick Around and Whoops!. Plan Task 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickAround } from './stick-around.ts';
import { STROKES, whoops } from './whoops.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { basePrice, decidePlay } from '../../../engine/rules/cards.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import type { CardTarget } from '../../../engine/rules/cards.ts';

const post = (length: number): CardTarget => ({ act: 'p1', kind: 'post', length });

test('the instance sells the two cards, Sweet and Salty, at their prices', () => {
  assert.deepEqual(cards.map((c) => [c.key, c.alignment, basePrice(c, settings)]), [['stick-around', 'sweet', 100], ['whoops', 'salty', 100]]);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instance.cards, cards);
});

test('a card\'s prices are settings: an override reaches what it sells for and what it costs to play', () => {
  const tuned = withOverrides(settings, { economy: { 'whoops.price': 150, 'whoops.perLength': 50, 'whoops.mostInAll': 400 } });
  assert.equal(basePrice(whoops, tuned), 150);
  assert.equal(basePrice(stickAround, withOverrides(settings, { economy: { 'stickAround.price': 75 } })), 75);
  assert.equal(whoops.playPrice(withOverrides(settings, { economy: { 'whoops.lengthStep': 250 } }), post(500), { color: 'red' }), 50, 'the step is a setting too');
  assert.equal(whoops.playPrice(withOverrides(settings, { economy: { 'whoops.mostInAll': 50 } }), post(6000), { color: 'red' }), 0, 'a cap at or below the price never makes a play pay back');
  assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'whoops.lengthStep': 0 } }) }).join('\n'), /whoops\.lengthStep/);
  assert.equal(whoops.playPrice(tuned, post(1000), { color: 'red' }), 100);
  assert.equal(basePrice(whoops, tuned) + whoops.playPrice(tuned, post(1_000_000), { color: 'red' }), 400);
});

test('Whoops! costs 0.25 more per 500 characters of its target, at most 3.00 in all', () => {
  const config = { color: '#ff00aa' };
  assert.equal(whoops.playPrice(settings, post(499), config), 0);
  assert.equal(whoops.playPrice(settings, post(500), config), 25);
  assert.equal(whoops.playPrice(settings, post(999), config), 25);
  assert.equal(whoops.playPrice(settings, post(1000), config), 50);
  assert.equal(whoops.playPrice(settings, post(6000), config), 200, 'twelve steps would be 3.00 on top; with the 1.00 paid, 3.00 is all');
  assert.equal(basePrice(whoops, settings) + whoops.playPrice(settings, post(6000), config), 300);
  assert.equal(basePrice(whoops, settings) + whoops.playPrice(settings, post(1_000_000), config), 300);
});

test('Stick Around costs nothing more to play', () => {
  assert.equal(stickAround.playPrice(settings, post(6000), { sentence: 'Read it.' }), 0);
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

test('Stick Around\'s release is the caster\'s own sentence, bounded, with the design\'s default', () => {
  assert.deepEqual(stickAround.validateConfig({}), { ok: true, value: { sentence: 'I legally certify that I have read this post in full and thought about it contemplatively' } });
  assert.deepEqual(stickAround.validateConfig({ sentence: '  I read it.  ' }), { ok: true, value: { sentence: 'I read it.' } });
  assert.equal(stickAround.validateConfig({ sentence: 'x'.repeat(201) }).ok, false);
  assert.equal(stickAround.validateConfig({ sentence: '   ' }).ok, false);
  assert.equal(stickAround.validateConfig({ sentence: 7 }).ok, false);
});

test('a card lands on a post, once: not twice on the same post, not on an edit', () => {
  assert.equal(whoops.canApply(post(10), []).ok, true);
  assert.equal(whoops.canApply(post(10), [{ card: 'stick-around', act: 'k0' }]).ok, true, 'the two combine');
  assert.equal(whoops.canApply(post(10), [{ card: 'whoops', act: 'k0' }]).ok, false);
  assert.equal(stickAround.canApply({ act: 'p1', kind: 'edit', length: 10 }, []).ok, false);
});

test('a play is decided by the card\'s own rules: its price, whether it lands, its configuration', () => {
  assert.deepEqual(decidePlay(whoops, settings, post(1200), [], { color: 'red' }), { ok: true, value: { price: 50, config: { color: 'red' } } });
  assert.match(String((decidePlay(whoops, settings, post(1200), [], { color: 'nope' }) as { why: string }).why), /color/);
  assert.match(String((decidePlay(whoops, settings, post(1200), [{ card: 'whoops', act: 'k' }], { color: 'red' }) as { why: string }).why), /already/);
});

test('Whoops! strokes are paths, bounded in count and size, in the post\'s own coordinates', () => {
  const stroke = { color: '#000000', width: 4, points: [[0.1, 0.2], [0.3, 0.4]] };
  assert.equal(whoops.validateState!({ strokes: [stroke] }).ok, true);
  assert.equal(whoops.validateState!({ strokes: [] }).ok, true, 'washed clean');
  assert.equal(whoops.validateState!({ strokes: Array(201).fill(stroke) }).ok, false, 'too many strokes');
  assert.equal(whoops.validateState!({ strokes: [{ ...stroke, points: Array(501).fill([0.5, 0.5]) }] }).ok, false, 'too many points');
  assert.equal(whoops.validateState!({ strokes: [{ ...stroke, points: [[1.5, 0]] }] }).ok, false, 'off the post');
  assert.equal(whoops.validateState!({ strokes: [{ ...stroke, width: 500 }] }).ok, false, 'too wide');
  assert.equal(whoops.validateState!({ strokes: [{ ...stroke, color: 'url(x)' }] }).ok, false, 'not a color');
  assert.equal(whoops.validateState!({ strokes: [{ ...stroke, points: [[0.1, Number.NaN]] }] }).ok, false);
  assert.equal(whoops.validateState!({ strokes: 'all of them' }).ok, false);
});

test('the most strokes Whoops! saves fit the database\'s bound, as Postgres writes them', () => {
  // Every stroke at its longest, every point at its longest, until the total runs out.
  const point = [0.123456789, 0.987654321];
  const strokes = [];
  let left = STROKES.totalPoints;
  while (left > 0) { const n = Math.min(STROKES.points, left); strokes.push({ color: '#abcdef', width: STROKES.widest, points: Array(n).fill(point) }); left -= n; }
  const saved = whoops.validateState!({ strokes });
  assert.equal(saved.ok, true);
  // jsonb's text puts a space after every comma and colon.
  const asPostgres = JSON.stringify(saved.ok && saved.value).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144, `${Buffer.byteLength(asPostgres)} bytes`);
  assert.equal(whoops.validateState!({ strokes: [...strokes, { color: 'red', width: 1, points: [[0, 0]] }] }).ok, false, 'one point past the total');
});

test('a stroke\'s points are kept to a thousandth of the post', () => {
  const saved = whoops.validateState!({ strokes: [{ color: 'red', width: 2, points: [[0.123456, 0.98765]] }] });
  assert.deepEqual(saved.ok && saved.value, { strokes: [{ color: 'red', width: 2, points: [[0.123, 0.988]] }] });
});

test('Stick Around holds no state to save', () => {
  assert.equal(stickAround.validateState, undefined);
});
