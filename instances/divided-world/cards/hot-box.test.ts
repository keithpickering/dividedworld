/**
 * Hot Box's own rules: its facts, its smoke color, who may cast it on what, and that it can be set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOT_BOX_LASTS, hotBox, price } from './hot-box.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { decidePlay, decideSet, staffConfigOf } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';

const now = new Date('2026-11-15T12:00:00Z');
const effect = (ends: Date) => ({ card: 'hot-box', act: 'k1', ends: ends.toISOString() });

test('Hot Box is a Salty common cast on a post for three days, one at a time, sold at 1.00', () => {
  assert.deepEqual([hotBox.key, hotBox.name, hotBox.alignment, hotBox.rarity], ['hot-box', 'Hot Box', 'salty', 'common']);
  assert.equal(hotBox.play, undefined, 'a cast');
  assert.equal(hotBox.reaches, undefined, 'a cast on a post');
  assert.deepEqual(hotBox.lasts, { unit: 'day', count: 3 });
  assert.equal(hotBox.lasts, HOT_BOX_LASTS);
  assert.equal(hotBox.stack, undefined, 'one at a time');
  assert.equal(hotBox.seeded, undefined, 'the smoke is drawn on each screen');
  assert.equal(price, 100);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'hot-box')?.price, 100);
  assert.equal(cards.includes(hotBox as never), true);
});

test('Hot Box\'s smoke is a color, and only a color', () => {
  assert.deepEqual(hotBox.validateConfig({ color: ' Teal ' }), { ok: true, value: { color: 'teal' } });
  assert.deepEqual(hotBox.validateConfig({ color: '#abc', seed: 1, x: 2 }), { ok: true, value: { color: '#abc' } });
  const refusal = { ok: false, why: 'the smoke is a color: a named one, or #rgb or #rrggbb' };
  for (const config of [{}, { color: 'nope' }, undefined]) assert.deepEqual(hotBox.validateConfig(config), refusal, String(config));
});

test('every color a persona may pick is a color, and a persona is given one of them', () => {
  assert.equal(hotBox.staffConfigs!.length, 5);
  for (const c of hotBox.staffConfigs!) assert.equal(hotBox.validateConfig(c).ok, true, JSON.stringify(c));
  assert.equal(hotBox.staffOptions, undefined, 'a persona is given no option');
  assert.ok(hotBox.staffConfigs!.some((c) => JSON.stringify(c) === JSON.stringify(staffConfigOf(hotBox, () => 0))));
});

test('Hot Box lands on a post with no live Hot Box, and nowhere else', () => {
  assert.equal(hotBox.canApply(post(10), [], {}, now).ok, true);
  const live = [effect(new Date(now.getTime() + 86_400_000))];
  const ended = [effect(new Date(now.getTime() - 1000))];
  assert.deepEqual(hotBox.canApply(post(10), live, {}, now), { ok: false, why: 'this post already carries that card' });
  assert.equal(hotBox.canApply(post(10), ended, {}, now).ok, true, 'a post whose Hot Box has ended');
  assert.equal(hotBox.canApply({ reach: 'character', character: 'c1' }, [], {}, now).ok, false);
});

test('Hot Box costs nothing more on a long post, and can be set face down', () => {
  const verdict = decidePlay(hotBox, settings, post(100_000), [], { color: 'teal' }, '');
  assert.equal(verdict.ok && verdict.value.price, 0);
  assert.equal(decideSet(hotBox, settings, post(10), [], { color: 'teal' }, cards).ok, true);
});

test('the instance, with Hot Box in it, has no problems', () => {
  assert.deepEqual(instanceProblems(instance), []);
});
