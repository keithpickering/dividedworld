/**
 * Kick Me's own rules: its facts, its gimmick and refunds, the use on the player's own post it lands on (and the post of another it
 * refuses), a second one while one is up refused, and that the instance still passes its checks with the card in the pool.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideUse, decidePlay } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { cards } from './index.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';

test('Kick Me is a Pepperoni common used on a post, for three days, paying on negative reactions and handing back three Salty casts, and sold at 1.00', async () => {
  const { kickMe, price } = await import('./kick-me.ts');
  assert.deepEqual([kickMe.key, kickMe.name, kickMe.alignment, kickMe.rarity, kickMe.play], ['kick-me', 'Kick Me', 'pepperoni', 'common', 'use']);
  assert.deepEqual(kickMe.gimmick, { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 1 });
  assert.deepEqual(kickMe.refunds, { flavors: ['salty'], count: 3 });
  assert.deepEqual(kickMe.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 100);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'kick-me')?.price, 100);
});

test('Kick Me lands on a post through decideUse at no price, is refused by decidePlay, and is refused on a character', async () => {
  const { kickMe } = await import('./kick-me.ts');
  const use = decideUse(kickMe, settings, post(10), [], {}, '');
  assert.equal(use.ok, true);
  assert.equal(use.ok && use.value.price, 0);
  assert.equal(decidePlay(kickMe, settings, post(10), [], {}, '').ok, false, 'a Gimmick is not cast');
  assert.deepEqual(
    decideUse(kickMe, settings, { reach: 'character', act: 'c1', kind: 'character' } as never, [], {}, ''),
    { ok: false, why: 'this card lands on a post' },
  );
});

test('a second Kick Me while one is up on the post is refused in the engine\'s words', async () => {
  const { kickMe } = await import('./kick-me.ts');
  const live = [{ card: 'kick-me', act: 'k1', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.deepEqual(decideUse(kickMe, settings, post(10), live, {}, ''), { ok: false, why: 'this post already carries that card' });
});

test('the instance has no problems with Kick Me in the pool', async () => {
  const { kickMe } = await import('./kick-me.ts');
  assert.equal(cards.find((c) => c.key === 'kick-me'), kickMe, 'Kick Me is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});
