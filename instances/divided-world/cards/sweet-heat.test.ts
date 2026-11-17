/**
 * Sweet Heat's own rules: it is used on a character, never cast, and one live at a time on a character.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { sweetHeat, price } from './sweet-heat.ts';

const character = { reach: 'character' as const, character: 'c1' };

test('Sweet Heat has its facts: a pepperoni uncommon use on a character, half a vote more on excited reactions for 3 days, sold for 150', () => {
  assert.equal(sweetHeat.key, 'sweet-heat');
  assert.equal(sweetHeat.name, 'Sweet Heat');
  assert.equal(sweetHeat.alignment, 'pepperoni');
  assert.equal(sweetHeat.rarity, 'uncommon');
  assert.equal(sweetHeat.play, 'use');
  assert.deepEqual(sweetHeat.reaches, ['character']);
  assert.deepEqual(sweetHeat.gimmick, { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative'], flat: 0.5 });
  assert.deepEqual(sweetHeat.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
});

test('Sweet Heat lands on a character through decideUse for free, is refused by decidePlay, and a second live one is refused', () => {
  assert.deepEqual(decideUse(sweetHeat, settings, character, [], {}, '').ok, true);
  assert.equal((decideUse(sweetHeat, settings, character, [], {}, '') as { value: { price: number } }).value.price, 0);
  assert.equal(decidePlay(sweetHeat, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'sweet-heat', act: 'k1', reach: 'character' as const, ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(sweetHeat, settings, character, live, {}, '').ok, false);
});

test('the instance is whole with Sweet Heat in its pool', () => {
  assert.deepEqual(instanceProblems(instance), []);
});
