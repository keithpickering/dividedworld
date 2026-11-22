/**
 * Buzzkill's own rules: its facts, that the instance has no problem with it in the pool, that it is played face up and never offered to staff,
 * that it lands on a post and on a character, and that its configuration names the Gimmick it ends by id (docs/plans/2026-11-21-buzzkill-plan.md, Task 7).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceUpOnly, landsOn, staffOffers } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { cards } from './index.ts';
import { post } from './test-kit.ts';

const PLAY = '3f1c2a54-8d1e-4b0a-9a56-0c6d1b7e2f10';

test('Buzzkill is a Salty rare Move on a post or a character that cuts up to rare, sold at 3.00, and the instance has no problem with it', async () => {
  const { buzzkill, price } = await import('./buzzkill.ts');
  assert.deepEqual([buzzkill.key, buzzkill.name, buzzkill.alignment, buzzkill.rarity], ['buzzkill', 'Buzzkill', 'salty', 'rare']);
  assert.deepEqual(buzzkill.reaches, ['post', 'character']);
  assert.deepEqual(buzzkill.cuts, { upTo: 'rare' });
  assert.equal(price, 300);
  assert.equal(cards.find((c) => c.key === 'buzzkill'), buzzkill, 'Buzzkill is in the pool');
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'buzzkill')?.price, 300);
  assert.deepEqual(instanceProblems(instance), []);
});

test('Buzzkill is played face up only, and never offered to staff', async () => {
  const { buzzkill } = await import('./buzzkill.ts');
  assert.equal(faceUpOnly(buzzkill), true);
  assert.equal(staffOffers(buzzkill), false);
});

test('Buzzkill lands on a post and on a character', async () => {
  const { buzzkill } = await import('./buzzkill.ts');
  assert.equal(landsOn(buzzkill, post(10), []).ok, true);
  assert.equal(landsOn(buzzkill, { reach: 'character', act: 'c1', kind: 'character' } as never, []).ok, true);
});

test('Buzzkill\'s configuration names a Gimmick by id, and refuses the rest in the engine\'s words', async () => {
  const { buzzkill } = await import('./buzzkill.ts');
  assert.deepEqual(buzzkill.validateConfig({ play: PLAY }), { ok: true, value: { play: PLAY } });
  const refusal = { ok: false, why: 'Buzzkill names the Gimmick it ends' };
  assert.deepEqual(buzzkill.validateConfig({}), refusal);
  assert.deepEqual(buzzkill.validateConfig({ play: 'not-an-id' }), refusal);
  assert.deepEqual(buzzkill.validateConfig({ play: 7 }), refusal);
  assert.deepEqual(buzzkill.validateConfig(undefined as never), refusal);
});
