/**
 * Steel Chair's own rules: its facts, the three that stack on a post and stay until an admin ends them, that it is refused on a character,
 * that it costs nothing more to play, and that it is never staffed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post, on } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { decidePlay, decideSet, staffConfigOf } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

const now = new Date('2026-11-15T12:00:00Z');
const live = (card = 'steel-chair') => ({ card, act: 'c1', reach: 'post' as const });
const ended = () => ({ card: 'steel-chair', act: 'c0', reach: 'post' as const, ends: new Date(now.getTime() - 1000).toISOString() });

test('Steel Chair is a common Salty Cast on a post, three to a post, that stays until an admin ends it; it costs 1.00 and nothing more to play', async () => {
  const { steelChair, price } = await import('./steel-chair.ts');
  assert.deepEqual([steelChair.key, steelChair.name, steelChair.alignment, steelChair.rarity, steelChair.play ?? 'cast', steelChair.reaches, steelChair.stack], ['steel-chair', 'Steel Chair', 'salty', 'common', 'cast', undefined, 3]);
  assert.equal(steelChair.lasts, undefined, 'a chair has no span: it stays until an admin ends it');
  assert.equal(price, 100);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'steel-chair')!.price, 100);
  assert.ok(cards.some((c) => c.key === 'steel-chair'));
});

test('Steel Chair lands on a bare post, on one with two live chairs, and on one whose third chair has ended; a fourth on three live chairs is refused', async () => {
  const { steelChair } = await import('./steel-chair.ts');
  assert.equal(steelChair.canApply(post(10), [], {}, now).ok, true);
  assert.equal(steelChair.canApply(post(10), [live(), live()], {}, now).ok, true);
  assert.deepEqual(steelChair.canApply(post(10), [live(), live(), live()], {}, now), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.equal(steelChair.canApply(post(10), [live(), live(), ended()], {}, now).ok, true, 'an ended chair holds no place');
  assert.deepEqual(steelChair.canApply({ reach: 'character', character: 'c1' }, [], {}, now), { ok: false, why: 'this card lands on a post' });
});

test('Steel Chair is decided at no cost, keeps an empty configuration, can be set face down, and is never staffed', async () => {
  const { steelChair } = await import('./steel-chair.ts');
  assert.deepEqual(decidePlay(steelChair, settings, post(10), [], {}, ''), { ok: true, value: { price: 0, config: {}, message: '' } });
  assert.equal(decideSet(steelChair, settings, on('a post'), [], {}, cards).ok, true);
  assert.deepEqual(staffConfigOf(steelChair, () => 0), {});
  assert.deepEqual(instanceProblems(instance), []);
});
