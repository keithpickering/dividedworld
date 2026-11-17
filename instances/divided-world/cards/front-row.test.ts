/**
 * Front Row's own rules: a Gimmick a character carries, used on the character and never cast; one at a time; and the machine's price.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse, type CardTarget } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { frontRow, price } from './front-row.ts';

const character: CardTarget = { reach: 'character', character: 'c1' };

test('Front Row is a Pepperoni uncommon use card that earns on reactions to a character\'s cards for three days, and sells for 150', () => {
  assert.equal(frontRow.key, 'front-row');
  assert.equal(frontRow.name, 'Front Row');
  assert.equal(frontRow.alignment, 'pepperoni');
  assert.equal(frontRow.rarity, 'uncommon');
  assert.equal(frontRow.play, 'use');
  assert.deepEqual(frontRow.reaches, ['character']);
  assert.deepEqual(frontRow.gimmick, { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'], flat: 0.5, acts: ['card', 'spring'] });
  assert.deepEqual(frontRow.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
});

test('Front Row is used on a character through decideUse for 0, is refused by decidePlay, and a second live one is refused', () => {
  const use = decideUse(frontRow, settings, character, [], {}, '');
  assert.deepEqual([use.ok, use.ok ? use.value.price : null], [true, 0]);
  assert.equal(decidePlay(frontRow, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'front-row', act: 'k1', reach: 'character', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(frontRow, settings, character, live, {}, '').ok, false, 'a second live play is refused');
});

test('the instance stays whole with Front Row in its pool', () => {
  assert.ok(instance.cards.some((c) => c.key === 'front-row'), 'the card is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});
