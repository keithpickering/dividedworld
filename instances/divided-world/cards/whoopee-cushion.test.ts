/**
 * Whoopee Cushion's own rules: its facts and the trap it springs with, what it lands as set face down, the back it is refused behind,
 * that it is never cast, and that a persona is never offered it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { decidePlay, decideSet, staffOffers } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

test('Whoopee Cushion is a Pepperoni common Set card that springs on a common cast and pays a quarter of each vote, and the machine sells it for 100', async () => {
  const { whoopeeCushion } = await import('./whoopee-cushion.ts');
  assert.equal(whoopeeCushion.key, 'whoopee-cushion');
  assert.equal(whoopeeCushion.name, 'Whoopee Cushion');
  assert.equal(whoopeeCushion.alignment, 'pepperoni');
  assert.equal(whoopeeCushion.rarity, 'common');
  assert.equal(whoopeeCushion.play, 'set');
  assert.deepEqual(whoopeeCushion.trap, { trigger: { on: 'cast' }, match: { upTo: 'common' }, outcome: { kind: 'ride', share: 0.25, every: true } });
  assert.equal('catches' in whoopeeCushion, false);
  assert.equal('lasts' in whoopeeCushion, false);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'whoopee-cushion')?.price, 100);
});

test('Whoopee Cushion is set face down on a post with no price and no catch, with or without a configuration', async () => {
  const { whoopeeCushion } = await import('./whoopee-cushion.ts');
  const set = decideSet(whoopeeCushion, settings, post(10), [], {}, cards);
  assert.equal(set.ok, true);
  assert.equal(set.ok && set.value.price, 0);
  assert.equal(set.ok && set.value.catches, undefined);
  const unset = decideSet(whoopeeCushion, settings, post(10), [], undefined, cards);
  assert.equal(unset.ok, true, 'the set form starts with no configuration');
});

test('a second card face down on the same post is refused in the engine\'s words', async () => {
  const { whoopeeCushion } = await import('./whoopee-cushion.ts');
  assert.deepEqual(
    decideSet(whoopeeCushion, settings, post(10), [{ card: null, act: 's1', faceDown: true }], {}, cards),
    { ok: false, why: 'this post already holds a card face down' },
  );
});

test('Whoopee Cushion is never cast, so a cast of it is refused in plain words', async () => {
  const { whoopeeCushion } = await import('./whoopee-cushion.ts');
  assert.deepEqual(
    decidePlay(whoopeeCushion, settings, post(10), [], {}, ''),
    { ok: false, why: 'Whoopee Cushion is set face down on your own post' },
  );
});

test('the instance holds Whoopee Cushion in its pool, and its problems list is empty', async () => {
  const { whoopeeCushion } = await import('./whoopee-cushion.ts');
  assert.equal(cards.find((c) => c.key === 'whoopee-cushion'), whoopeeCushion, 'Whoopee Cushion is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});

test('a persona is never offered Whoopee Cushion', async () => {
  const { whoopeeCushion } = await import('./whoopee-cushion.ts');
  assert.equal(staffOffers(whoopeeCushion), false);
});
