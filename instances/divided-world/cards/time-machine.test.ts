/**
 * Time Machine's own rules (docs/plans/2026-11-21-time-machine-design.md, section 1): its facts, that its configuration is the version it
 * names, that it is never set face down and never staffed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from './test-kit.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { faceUpOnly, staffOffers } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';

test('Time Machine is a rare Pepperoni Cast on a post that rewinds up to rare for 3 days; it costs 3.00 and nothing more to play', async () => {
  const { timeMachine, price } = await import('./time-machine.ts');
  assert.deepEqual([timeMachine.key, timeMachine.name, timeMachine.alignment, timeMachine.rarity, timeMachine.play ?? 'cast', timeMachine.reaches, timeMachine.lasts, timeMachine.rewind], ['time-machine', 'Time Machine', 'pepperoni', 'rare', 'cast', ['post'], { unit: 'day', count: 3 }, { upTo: 'rare' }]);
  assert.equal(timeMachine.playPrice(settings, post(10), { to: 'v1' }, []), 0);
  assert.equal(price, 300);
  assert.ok(cards.some((c) => c.key === 'time-machine'));
  assert.deepEqual(timeMachine.drawsEffect, {});
});

test('Time Machine passes the instance checks, takes a point as { to } and refuses none', async () => {
  const { timeMachine } = await import('./time-machine.ts');
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(timeMachine.validateConfig({ to: 'v1' }), { ok: true, value: { to: 'v1' } });
  assert.equal(timeMachine.validateConfig({} as never).ok, false);
  assert.equal(timeMachine.canApply(post(10), [], { to: 'v1' }, new Date()).ok, true);
  assert.equal(timeMachine.canApply({ reach: 'character', character: 'c1' }, [], { to: 'v1' }, new Date()).ok, false);
});

test('Time Machine is only played face up and is never staffed', async () => {
  const { timeMachine } = await import('./time-machine.ts');
  assert.equal(faceUpOnly(timeMachine), true);
  assert.equal(staffOffers(timeMachine), false);
});
