/**
 * So Very Happy's own rules: its facts and the lockout it springs, what it lands as set face down, that the machine sells it for 300,
 * that the instance holds it, and that its problems list is empty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { decideSet, ok } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

test('So Very Happy is a Salty rare Set card that springs on a Salty or Pepperoni Move up to rare with a 24 hour lockout, and the machine sells it for 300', async () => {
  const { soVeryHappy } = await import('./so-very-happy.ts');
  assert.equal(soVeryHappy.key, 'so-very-happy');
  assert.equal(soVeryHappy.alignment, 'salty');
  assert.equal(soVeryHappy.rarity, 'rare');
  assert.equal(soVeryHappy.play, 'set');
  assert.deepEqual(soVeryHappy.trap, {
    trigger: { on: 'cast' },
    match: { flavors: ['salty', 'pepperoni'], upTo: 'rare' },
    outcome: { kind: 'lockout', hours: 24 },
  });
  assert.equal('catches' in soVeryHappy, false);
  assert.equal('lasts' in soVeryHappy, false);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'so-very-happy')?.price, 300);
});

test('So Very Happy validates with an empty configuration, and is set face down on a post with no price and no catch', async () => {
  const { soVeryHappy } = await import('./so-very-happy.ts');
  assert.deepEqual(soVeryHappy.validateConfig({}), ok({}));
  const set = decideSet(soVeryHappy, settings, post(10), [], {}, cards);
  assert.equal(set.ok, true);
  assert.equal(set.ok && set.value.price, 0);
  assert.equal(set.ok && set.value.catches, undefined);
});

test('the instance holds So Very Happy in its pool, and its problems list is empty', async () => {
  const { soVeryHappy } = await import('./so-very-happy.ts');
  assert.equal(cards.find((c) => c.key === 'so-very-happy'), soVeryHappy, 'So Very Happy is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});
