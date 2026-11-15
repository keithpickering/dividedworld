/**
 * Rope Break's own rules: its facts, what it lands as set face down, the back it is refused behind, and that it is never cast.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { decidePlay, decideSet, staffConfigOf } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

test('Rope Break is a Sweet common Set card that springs on a Salty common cast, and the machine sells it for 100', async () => {
  const { ropeBreak } = await import('./rope-break.ts');
  assert.equal(ropeBreak.key, 'rope-break');
  assert.equal(ropeBreak.name, 'Rope Break');
  assert.equal(ropeBreak.alignment, 'sweet');
  assert.equal(ropeBreak.rarity, 'common');
  assert.equal(ropeBreak.play, 'set');
  assert.deepEqual(ropeBreak.trap, { trigger: { on: 'cast' }, match: { flavors: ['salty'], upTo: 'common' } });
  assert.equal('catches' in ropeBreak, false);
  assert.equal('lasts' in ropeBreak, false);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'rope-break')?.price, 100);
});

test('Rope Break is set face down on a post with no price and no catch, with or without a configuration', async () => {
  const { ropeBreak } = await import('./rope-break.ts');
  const set = decideSet(ropeBreak, settings, post(10), [], {}, cards);
  assert.equal(set.ok, true);
  assert.equal(set.ok && set.value.price, 0);
  assert.equal(set.ok && set.value.catches, undefined);
  const unset = decideSet(ropeBreak, settings, post(10), [], undefined, cards);
  assert.equal(unset.ok, true, 'the set form starts with no configuration');
});

test('a second card face down on the same post is refused in the engine\'s words', async () => {
  const { ropeBreak } = await import('./rope-break.ts');
  assert.deepEqual(
    decideSet(ropeBreak, settings, post(10), [{ card: null, act: 's1', faceDown: true }], {}, cards),
    { ok: false, why: 'this post already holds a card face down' },
  );
});

test('Rope Break is never cast, so a cast of it is refused in plain words', async () => {
  const { ropeBreak } = await import('./rope-break.ts');
  assert.deepEqual(
    decidePlay(ropeBreak, settings, post(10), [], {}, ''),
    { ok: false, why: 'Rope Break is set face down on your own post' },
  );
});

test('the instance holds Rope Break in its pool, and its problems list is empty', async () => {
  const { ropeBreak } = await import('./rope-break.ts');
  assert.equal(cards.find((c) => c.key === 'rope-break'), ropeBreak, 'Rope Break is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});

test('the staff pool offers Rope Break with no options', async () => {
  const { ropeBreak } = await import('./rope-break.ts');
  assert.deepEqual(staffConfigOf(ropeBreak, () => 0), {});
});
