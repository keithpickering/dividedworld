/**
 * Required Reading's own rules: its facts, the use on a post it lands on (and the cast it refuses), a second live one refused, and that
 * the instance still passes its checks with the card in the pool.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { cards } from './index.ts';
import { price, requiredReading } from './required-reading.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';

test('Required Reading is a Sweet common used on a post, for a week, paying on calm positive reactions, and sold at 1.00', () => {
  assert.deepEqual([requiredReading.key, requiredReading.name, requiredReading.alignment, requiredReading.rarity, requiredReading.play], ['required-reading', 'Required Reading', 'sweet', 'common', 'use']);
  assert.deepEqual(requiredReading.gimmick, { kind: 'earn', quadrants: ['calmPositive'], flat: 1 });
  assert.deepEqual(requiredReading.lasts, { unit: 'week', count: 1 });
  assert.equal(price, 100);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'required-reading')?.price, 100);
});

test('Required Reading lands on a post through decideUse at no price, is refused by decidePlay, and a second live one is refused', () => {
  const use = decideUse(requiredReading, settings, post(10), [], {}, '');
  assert.equal(use.ok, true);
  assert.equal(use.ok && use.value.price, 0);
  assert.equal(decidePlay(requiredReading, settings, post(10), [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'required-reading', act: 'k1', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(requiredReading, settings, post(10), live, {}, '').ok, false);
});

test('the instance has no problems with Required Reading in the pool', () => {
  assert.equal(cards.some((c) => c.key === 'required-reading'), true);
  assert.deepEqual(instanceProblems(instance), []);
});
