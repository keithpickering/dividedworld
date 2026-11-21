/**
 * Pay It Forward's own rules: its facts and the trap it springs with, what it lands as set face down, the back it is refused behind,
 * that it is never cast, that the instance holds it, and that a persona may be offered it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { decidePlay, decideSet, staffOffers } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

test('Pay It Forward is a Sweet uncommon Set card that springs on a Sweet cast up to uncommon and hands it back, and the machine sells it for 150', async () => {
  const { payItForward } = await import('./pay-it-forward.ts');
  assert.equal(payItForward.key, 'pay-it-forward');
  assert.equal(payItForward.name, 'Pay It Forward');
  assert.equal(payItForward.alignment, 'sweet');
  assert.equal(payItForward.rarity, 'uncommon');
  assert.equal(payItForward.play, 'set');
  assert.deepEqual(payItForward.trap, { trigger: { on: 'cast' }, match: { flavors: ['sweet'], upTo: 'uncommon' }, outcome: { kind: 'refund' } });
  assert.equal('catches' in payItForward, false);
  assert.equal('lasts' in payItForward, false);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'pay-it-forward')?.price, 150);
});

test('Pay It Forward is set face down on a post with no price and no catch, with or without a configuration', async () => {
  const { payItForward } = await import('./pay-it-forward.ts');
  const set = decideSet(payItForward, settings, post(10), [], {}, cards);
  assert.equal(set.ok, true);
  assert.equal(set.ok && set.value.price, 0);
  assert.equal(set.ok && set.value.catches, undefined);
  const unset = decideSet(payItForward, settings, post(10), [], undefined, cards);
  assert.equal(unset.ok, true, 'the set form starts with no configuration');
});

test('a second card face down on the same post is refused in the engine\'s words', async () => {
  const { payItForward } = await import('./pay-it-forward.ts');
  assert.deepEqual(
    decideSet(payItForward, settings, post(10), [{ card: null, act: 's1', faceDown: true }], {}, cards),
    { ok: false, why: 'this post already holds a card face down' },
  );
});

test('Pay It Forward is never cast, so a cast of it is refused in plain words', async () => {
  const { payItForward } = await import('./pay-it-forward.ts');
  assert.deepEqual(
    decidePlay(payItForward, settings, post(10), [], {}, ''),
    { ok: false, why: 'Pay It Forward is set face down on your own post' },
  );
});

test('the instance holds Pay It Forward in its pool, and its problems list is empty', async () => {
  const { payItForward } = await import('./pay-it-forward.ts');
  assert.equal(cards.find((c) => c.key === 'pay-it-forward'), payItForward, 'Pay It Forward is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});

test('a persona may be offered Pay It Forward, since its back is a refund and not a ride', async () => {
  const { payItForward } = await import('./pay-it-forward.ts');
  assert.equal(staffOffers(payItForward), true);
});
