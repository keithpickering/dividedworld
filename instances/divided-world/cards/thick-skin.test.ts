/**
 * Thick Skin's own rules: a Gimmick on a character, used and never cast, sold for 150 and held by one character at a time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { instance } from '../index.ts';
import { thickSkin, price } from './thick-skin.ts';

const character = { reach: 'character' as const, character: 'c1' };
const later = () => new Date(Date.now() + 86_400_000).toISOString();

test('Thick Skin is a sweet uncommon use card, a cushion Gimmick for three days, and the machine sells it for 150', () => {
  assert.deepEqual([thickSkin.key, thickSkin.name, thickSkin.alignment, thickSkin.rarity, thickSkin.play], ['thick-skin', 'Thick Skin', 'sweet', 'uncommon', 'use']);
  assert.deepEqual(thickSkin.gimmick, { kind: 'cushion', share: 0.5 });
  assert.deepEqual(thickSkin.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
  const slot = instance.machine.find((m) => 'card' in m.item && m.item.card === 'thick-skin');
  assert.equal(slot?.price, 150, 'the machine sells it for 150');
});

test('Thick Skin lands on a character through decideUse for free, is refused by decidePlay, and a second live one is refused', () => {
  const used = decideUse(thickSkin, settings, character, [], {}, '');
  assert.equal(used.ok, true);
  assert.equal((used as { value: { price: number } }).value.price, 0);
  assert.equal(decidePlay(thickSkin, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'thick-skin', act: 'k1', reach: 'character' as const, ends: later() }];
  assert.equal(decideUse(thickSkin, settings, character, live, {}, '').ok, false, 'a character holds one at a time');
});

test('the instance is whole with Thick Skin in its pool', () => {
  assert.deepEqual(instanceProblems(instance), []);
});
