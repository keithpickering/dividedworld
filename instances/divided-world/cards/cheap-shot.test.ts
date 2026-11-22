/**
 * Cheap Shot's own rules: a Gimmick on a character, used and never cast, sold for 150 and held by one character at a time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { instance } from '../index.ts';
import { post } from './test-kit.ts';
import { cheapShot, price } from './cheap-shot.ts';

const character = { reach: 'character' as const, character: 'c1' };
const later = () => new Date(Date.now() + 86_400_000).toISOString();

test('Cheap Shot is a salty uncommon use card, a pierce Gimmick up to uncommon for three days, and the machine sells it for 150', () => {
  assert.deepEqual([cheapShot.key, cheapShot.name, cheapShot.alignment, cheapShot.rarity, cheapShot.play], ['cheap-shot', 'Cheap Shot', 'salty', 'uncommon', 'use']);
  assert.deepEqual(cheapShot.gimmick, { kind: 'pierce', upTo: 'uncommon' });
  assert.deepEqual(cheapShot.reaches, ['character']);
  assert.deepEqual(cheapShot.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
  const slot = instance.machine.find((m) => 'card' in m.item && m.item.card === 'cheap-shot');
  assert.equal(slot?.price, 150, 'the machine sells it for 150');
});

test('Cheap Shot lands on a character through decideUse for free, is refused by decidePlay, and a second live one is refused', () => {
  const used = decideUse(cheapShot, settings, character, [], {}, '');
  assert.equal(used.ok, true);
  assert.equal((used as { value: { price: number } }).value.price, 0);
  assert.equal(decidePlay(cheapShot, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'cheap-shot', act: 'k1', reach: 'character' as const, ends: later() }];
  assert.equal(decideUse(cheapShot, settings, character, live, {}, '').ok, false, 'a character holds one at a time');
});

test('Cheap Shot lands on a character only, and is refused on a post', () => {
  assert.equal(cheapShot.canApply(post(10), []).ok, false, 'a post is refused');
  assert.equal(cheapShot.canApply(character, []).ok, true, 'a character is not');
});

test('the instance is whole with Cheap Shot in its pool', () => {
  assert.ok(instance.cards.some((c) => c.key === 'cheap-shot'), 'the card is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});
