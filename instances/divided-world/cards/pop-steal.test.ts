/**
 * Pop Steal's own rules: its facts, what it lands as set face down, the back it is refused behind, and that it is never cast.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { decidePlay, decideSet, staffConfigOf } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

test('Pop Steal is a Salty common Set card that springs on a Sweet common cast, and the machine sells it for 100', async () => {
  const { popSteal } = await import('./pop-steal.ts');
  assert.equal(popSteal.key, 'pop-steal');
  assert.equal(popSteal.name, 'Pop Steal');
  assert.equal(popSteal.alignment, 'salty');
  assert.equal(popSteal.rarity, 'common');
  assert.equal(popSteal.play, 'set');
  assert.deepEqual(popSteal.trap, { trigger: { on: 'cast' }, match: { flavors: ['sweet'], upTo: 'common' } });
  assert.equal('catches' in popSteal, false);
  assert.equal('lasts' in popSteal, false);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'pop-steal')?.price, 100);
});

test('Pop Steal is set face down on a post with no price and no catch, with or without a configuration', async () => {
  const { popSteal } = await import('./pop-steal.ts');
  const set = decideSet(popSteal, settings, post(10), [], {}, cards);
  assert.equal(set.ok, true);
  assert.equal(set.ok && set.value.price, 0);
  assert.equal(set.ok && set.value.catches, undefined);
  const unset = decideSet(popSteal, settings, post(10), [], undefined, cards);
  assert.equal(unset.ok, true, 'the set form starts with no configuration');
});

test('a second card face down on the same post is refused in the engine\'s words', async () => {
  const { popSteal } = await import('./pop-steal.ts');
  assert.deepEqual(
    decideSet(popSteal, settings, post(10), [{ card: null, act: 's1', faceDown: true }], {}, cards),
    { ok: false, why: 'this post already holds a card face down' },
  );
});

test('Pop Steal is never cast, so a cast of it is refused in plain words', async () => {
  const { popSteal } = await import('./pop-steal.ts');
  assert.deepEqual(
    decidePlay(popSteal, settings, post(10), [], {}, ''),
    { ok: false, why: 'Pop Steal is set face down on your own post' },
  );
});

test('the instance holds Pop Steal in its pool, and its problems list is empty', async () => {
  const { popSteal } = await import('./pop-steal.ts');
  assert.equal(cards.find((c) => c.key === 'pop-steal'), popSteal, 'Pop Steal is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});

test('the staff pool offers Pop Steal with no options', async () => {
  const { popSteal } = await import('./pop-steal.ts');
  assert.deepEqual(staffConfigOf(popSteal, () => 0), {});
});
