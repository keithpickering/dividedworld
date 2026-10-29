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

test('a card lands on a post up to its stack: Stick Around once, Whoops! three times, never on an edit', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'whoops', act: `k${i}` }));
  assert.equal(whoops.canApply(post(10), []).ok, true);
  assert.equal(whoops.canApply(post(10), [{ card: 'stick-around', act: 'k0' }]).ok, true, 'the two combine');
  assert.equal(whoops.canApply(post(10), w(2)).ok, true, 'a third Whoops! lands');
  assert.deepEqual(whoops.canApply(post(10), w(3)), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.equal(whoops.canApply(post(10), [...w(2), { card: 'stick-around', act: 's' }]).ok, true, 'another card is not counted');
  assert.deepEqual(stickAround.canApply(post(10), [{ card: 'stick-around', act: 's' }]), { ok: false, why: 'this post already carries that card' });
  assert.equal(stickAround.canApply({ act: 'p1', kind: 'edit', length: 10 }, []).ok, false);
  assert.equal(whoops.stack, 3);
  assert.equal(whoops.seeded, true, 'each splat is drawn from a seed the server chooses');
  assert.equal(stickAround.stack ?? 1, 1);
  assert.equal(stickAround.seeded ?? false, false);
});

test('a play carries the caster\'s message: plain text, at most 200 characters, and may be empty', () => {
  assert.deepEqual(decidePlay(whoops, settings, post(10), [], { color: 'red' }, '  A riposte.  '), { ok: true, value: { price: 0, config: { color: 'red' }, message: 'A riposte.' } });
  assert.equal((decidePlay(whoops, settings, post(10), [], { color: 'red' }, '') as { value: { message: string } }).value.message, '');
  assert.equal((decidePlay(whoops, settings, post(10), [], { color: 'red' }, undefined) as { value: { message: string } }).value.message, '', 'no message is an empty one');
  assert.equal(decidePlay(whoops, settings, post(10), [], { color: 'red' }, '🔥'.repeat(200)).ok, true, 'counted in characters');
  assert.deepEqual(decidePlay(whoops, settings, post(10), [], { color: 'red' }, 'x'.repeat(201)), { ok: false, why: 'the message is at most 200 characters' });
  assert.deepEqual(decidePlay(whoops, settings, post(10), [], { color: 'red' }, 7), { ok: false, why: 'the message is text' });
});

test('the seed is the server\'s: one in the caster\'s configuration is never kept', () => {
  assert.deepEqual(whoops.validateConfig({ color: 'red', seed: 12345 }), { ok: true, value: { color: 'red' } });
});

test('a play is decided by the card\'s own rules: its price, whether it lands, its configuration', () => {
  assert.deepEqual(decidePlay(whoops, settings, post(1200), [], { color: 'red' }, ''), { ok: true, value: { price: 50, config: { color: 'red' }, message: '' } });
  assert.match(String((decidePlay(whoops, settings, post(1200), [], { color: 'nope' }, '') as { why: string }).why), /color/);
  assert.match(String((decidePlay(whoops, settings, post(1200), [1, 2, 3].map((i) => ({ card: 'whoops', act: `k${i}` })), { color: 'red' }, '') as { why: string }).why), /already/);
});

test('Whoops! strokes wash or ink, in widths of the fixed layout: across 0 to 1, down 0 to 64', () => {
  const ink = { tool: 'ink', color: '#000000', width: 4, points: [[0.1, 0.2], [0.3, 40]] };
  const wash = { tool: 'wash', width: 30, points: [[0.5, 0.5]] };
  assert.equal(whoops.validateState!({ strokes: [ink, wash] }).ok, true);
  assert.equal(whoops.validateState!({ strokes: [] }).ok, true, 'nothing saved yet');
  assert.deepEqual(whoops.validateState!({ strokes: [wash], clean: true }), { ok: true, value: { strokes: [wash], clean: true } }, 'washed clean, said by the author\'s save');
  assert.equal(whoops.validateState!({ strokes: [], clean: 'yes' }).ok, false);
  // A state 0026 moved aside keeps its old strokes under legacy; a save never carries it back.
  assert.deepEqual(whoops.validateState!({ strokes: [wash], legacy: { strokes: [{ width: 0.05, points: [[0.1, 0.2]] }] } }), { ok: true, value: { strokes: [wash] } }, 'a save takes no legacy');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: [[0.5, 64]] }] }).ok, true, 'down to 64 widths');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: [[0.5, 65]] }] }).ok, false, 'a down of 65');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: [[1.01, 0.5]] }] }).ok, false, 'an across of 1.01');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: [[-0.01, 0.5]] }] }).ok, false);
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, tool: 'brush' }] }).ok, false, 'a tool is wash or ink');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, color: undefined }] }).ok, false, 'ink carries a color');
  assert.equal(whoops.validateState!({ strokes: [{ ...wash, color: 'red' }] }).ok, false, 'a wash carries none');
  assert.equal(whoops.validateState!({ strokes: Array(201).fill(ink) }).ok, false, 'too many strokes');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: Array(501).fill([0.5, 0.5]) }] }).ok, false, 'too many points');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, width: 500 }] }).ok, false, 'too wide');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, width: 0.0004 }] }).ok, false, 'a width that keeps to nothing');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, color: 'url(x)' }] }).ok, false, 'not a color');
  assert.equal(whoops.validateState!({ strokes: [{ ...ink, points: [[0.1, Number.NaN]] }] }).ok, false);
  assert.equal(whoops.validateState!({ strokes: 'all of them' }).ok, false);
});

test('the most strokes Whoops! saves fit the database\'s bound, as Postgres writes them', () => {
  // Every stroke at its longest, every point at its longest (a down of two digits), until the total runs out.
  const point = [0.123456789, 63.987654321];
  const strokes = [];
  let left = STROKES.totalPoints;
  while (left > 0) { const n = Math.min(STROKES.points, left); strokes.push({ tool: 'ink', color: '#abcdef', width: STROKES.widest - 0.0004321, points: Array(n).fill(point) }); left -= n; }
  const saved = whoops.validateState!({ strokes, clean: false });
  assert.equal(saved.ok, true);
  // jsonb's text puts a space after every comma and colon.
  const asPostgres = JSON.stringify(saved.ok && saved.value).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) <= 262_144, `${Buffer.byteLength(asPostgres)} bytes`);
  assert.equal(whoops.validateState!({ strokes: [...strokes, { tool: 'wash', width: 1, points: [[0, 0]] }] }).ok, false, 'one point past the total');
});

test('a stroke\'s points and width are kept to a thousandth', () => {
  const saved = whoops.validateState!({ strokes: [{ tool: 'ink', color: 'red', width: 2.12345, points: [[0.123456, 12.98765]] }] });
  assert.deepEqual(saved.ok && saved.value, { strokes: [{ tool: 'ink', color: 'red', width: 2.123, points: [[0.123, 12.988]] }] });
});

test('Stick Around holds no state to save', () => {
  assert.equal(stickAround.validateState, undefined);
});
