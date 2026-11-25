/**
 * It's Curtains' own rules (docs/plans/2026-11-23-its-curtains-design.md, sections 2.5 to 2.7; the plan's Task 4): its fields, its
 * stack and price, its fabrics, and what a configuration may hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landsOn, type CardEffect, type CardTarget } from '../../../engine/rules/cards.ts';
import { withOverrides } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';
import { FABRICS, itsCurtains, price } from './its-curtains.ts';

const curtain = (act: string, ends?: string): CardEffect => ({ card: 'its-curtains', act, reach: 'post', ...(ends ? { ends } : {}) });
const LIVE = '2999-01-01T00:00:00.000Z';
const ENDED = '2020-01-01T00:00:00.000Z';
const characterTarget = { reach: 'character', character: 'c1' } as unknown as CardTarget;

test('It\'s Curtains is an uncommon Pepperoni Cast on a post, stacked three deep, with its fabric as the configuration', () => {
  assert.deepEqual(
    [itsCurtains.key, itsCurtains.name, itsCurtains.alignment, itsCurtains.rarity, itsCurtains.play ?? 'cast', itsCurtains.reaches, itsCurtains.stack, itsCurtains.lasts],
    ['its-curtains', "It's Curtains", 'pepperoni', 'uncommon', 'cast', ['post'], 3, undefined],
  );
  assert.deepEqual(itsCurtains.drawsEffect, {});
  assert.deepEqual(itsCurtains.reads, [
    { key: 'itsCurtains.secondAdd', whole: true, min: 0 },
    { key: 'itsCurtains.thirdAdd', whole: true, min: 0 },
  ]);
  assert.deepEqual(itsCurtains.staffConfigs, Object.keys(FABRICS).map((fabric) => ({ fabric })));
});

test('the six fabrics are the design\'s, each with its dark, mid and light shade', () => {
  assert.deepEqual(FABRICS, {
    red: { name: 'Red', dark: '#af0000', mid: '#ee0000', light: '#f73434' },
    'royal-blue': { name: 'Royal Blue', dark: '#0a1f6b', mid: '#1f3fbf', light: '#4a6bef' },
    purple: { name: 'Purple', dark: '#3b0a5c', mid: '#6a1b9a', light: '#9c4dcc' },
    emerald: { name: 'Emerald', dark: '#04402a', mid: '#0b7a4b', light: '#2fb37a' },
    gold: { name: 'Gold', dark: '#7a5a00', mid: '#c9a000', light: '#f2d24a' },
    black: { name: 'Black', dark: '#050505', mid: '#1c1c1c', light: '#3a3a3a' },
  });
});

test('its price at the machine is 1.50', () => {
  assert.equal(price, 150);
});

test('a fourth curtain on a post is refused in landsOn\'s words, and a third lands', () => {
  const three = [curtain('a'), curtain('b'), curtain('c')];
  assert.equal(itsCurtains.canApply(post(10), [curtain('a'), curtain('b')], { fabric: 'red' }, new Date()).ok, true);
  const fourth = itsCurtains.canApply(post(10), three, { fabric: 'red' }, new Date());
  assert.equal(fourth.ok, false);
  assert.deepEqual(fourth, landsOn(itsCurtains, post(10), three));
  assert.equal(typeof (fourth as { why?: unknown }).why, 'string');
});

test('a play adds nothing for the first curtain, 1.00 for the second and 2.00 for the third, and 0 once a curtain has ended', () => {
  const config = { fabric: 'red' as const };
  assert.equal(itsCurtains.playPrice(settings, post(10), config, []), 0);
  assert.equal(itsCurtains.playPrice(settings, post(10), config, [curtain('a')]), 100);
  assert.equal(itsCurtains.playPrice(settings, post(10), config, [curtain('a'), curtain('b')]), 200);
  assert.equal(itsCurtains.playPrice(settings, post(10), config, [curtain('a', ENDED)]), 0, 'the one curtain has ended');
  assert.equal(itsCurtains.playPrice(settings, post(10), config, [curtain('a', LIVE), curtain('b', ENDED)]), 100, 'an ended curtain is not counted');
  assert.equal(itsCurtains.playPrice(settings, characterTarget, config, [curtain('a'), curtain('b')]), 0, 'off a post, nothing');
});

test('an override of the second and third surcharges reaches the price', () => {
  const tuned = withOverrides(settings, { economy: { 'itsCurtains.secondAdd': 250, 'itsCurtains.thirdAdd': 400 } });
  assert.equal(itsCurtains.playPrice(tuned, post(10), { fabric: 'red' }, [curtain('a')]), 250);
  assert.equal(itsCurtains.playPrice(tuned, post(10), { fabric: 'red' }, [curtain('a'), curtain('b')]), 400);
});

test('validateConfig accepts each fabric, defaults to red, keeps no other key, and refuses a hex code or a name', () => {
  for (const fabric of Object.keys(FABRICS)) {
    assert.deepEqual(itsCurtains.validateConfig({ fabric }), { ok: true, value: { fabric } });
  }
  assert.deepEqual(itsCurtains.validateConfig({}), { ok: true, value: { fabric: 'red' } });
  assert.deepEqual(itsCurtains.validateConfig(undefined), { ok: true, value: { fabric: 'red' } });
  assert.deepEqual(itsCurtains.validateConfig({ fabric: 'gold', seed: 7 }), { ok: true, value: { fabric: 'gold' } });
  for (const bad of ['#ff0000', 'Red']) {
    assert.deepEqual(itsCurtains.validateConfig({ fabric: bad }), { ok: false, why: 'the curtain is one of the listed fabrics' });
  }
});
