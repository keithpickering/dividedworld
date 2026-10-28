/**
 * Divided World's two cards (design, sections 7 and 10): Stick Around and Whoops!. Plan Task 10.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickAround } from './stick-around.ts';
import { whoops } from './whoops.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { decidePlay } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import type { CardTarget } from '../../../engine/rules/cards.ts';

const post = (length: number): CardTarget => ({ act: 'p1', kind: 'post', length });

test('the instance sells the two cards, Sweet and Salty, at their prices', () => {
  assert.deepEqual(cards.map((c) => [c.key, c.alignment, c.basePrice]), [['stick-around', 'sweet', 100], ['whoops', 'salty', 100]]);
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instance.cards, cards);
});

test('Whoops! costs 0.25 more per 500 characters of its target, at most 3.00 in all', () => {
  const config = { color: '#ff00aa' };
  assert.equal(whoops.playPrice(post(499), config), 0);
  assert.equal(whoops.playPrice(post(500), config), 25);
  assert.equal(whoops.playPrice(post(999), config), 25);
  assert.equal(whoops.playPrice(post(1000), config), 50);
  assert.equal(whoops.playPrice(post(6000), config), 200, 'twelve steps would be 3.00 on top; with the 1.00 paid, 3.00 is all');
  assert.equal(whoops.basePrice + whoops.playPrice(post(6000), config), 300);
  assert.equal(whoops.basePrice + whoops.playPrice(post(1_000_000), config), 300);
});

test('Stick Around costs nothing more to play', () => {
  assert.equal(stickAround.playPrice(post(6000), { sentence: 'Read it.' }), 0);
});

test('Whoops!\'s ink is a color, and only a color', () => {
  assert.deepEqual(whoops.validateConfig({ color: '#FF00AA' }), { ok: true, value: { color: '#ff00aa' } });
  assert.deepEqual(whoops.validateConfig({ color: 'rebeccapurple' }), { ok: true, value: { color: 'rebeccapurple' } });
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
  assert.deepEqual(decidePlay(whoops, post(1200), [], { color: 'red' }), { ok: true, value: { price: 50, config: { color: 'red' } } });
  assert.match(String((decidePlay(whoops, post(1200), [], { color: 'nope' }) as { why: string }).why), /color/);
  assert.match(String((decidePlay(whoops, post(1200), [{ card: 'whoops', act: 'k' }], { color: 'red' }) as { why: string }).why), /already/);
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

test('Stick Around holds no state to save', () => {
  assert.equal(stickAround.validateState, undefined);
});
