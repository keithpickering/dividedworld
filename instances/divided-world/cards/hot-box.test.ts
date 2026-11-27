/**
 * Hot Box's own rules: its facts, its smoke color, who may cast it on what, and that it can be set.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOT_BOX_THINS, hotBox, price } from './hot-box.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { decidePlay, decideSet, staffConfigOf } from '../../../engine/rules/cards.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';

const now = new Date('2026-11-15T12:00:00Z');
const effect = (ends: Date) => ({ card: 'hot-box', act: 'k1', ends: ends.toISOString() });

test('Hot Box is a Salty common cast on a post for three days, one at a time, sold at 1.00', () => {
  assert.deepEqual([hotBox.key, hotBox.name, hotBox.alignment, hotBox.rarity], ['hot-box', 'Hot Box', 'salty', 'common']);
  assert.equal(hotBox.play, undefined, 'a cast');
  assert.equal(hotBox.reaches, undefined, 'a cast on a post');
  assert.equal(hotBox.lasts, undefined, 'a play has no end of its own');
  assert.deepEqual(HOT_BOX_THINS, { unit: 'day', count: 3 });
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
  assert.equal(hotBox.canApply(post(10), [], { color: 'teal' }, now).ok, true);
  const live = [effect(new Date(now.getTime() + 86_400_000))];
  const ended = [effect(new Date(now.getTime() - 1000))];
  assert.deepEqual(hotBox.canApply(post(10), live, { color: 'teal' }, now), { ok: false, why: 'this post already carries that card' });
  assert.equal(hotBox.canApply(post(10), ended, { color: 'teal' }, now).ok, true, 'a post whose Hot Box has ended');
  const open = { card: 'hot-box', act: 'k1' };
  assert.deepEqual(hotBox.canApply(post(10), [open], { color: 'teal' }, now), { ok: false, why: 'this post already carries that card' }, 'an uncleared play with no ends holds the place');
  assert.equal(hotBox.canApply(post(10), [{ ...open, cleared: true }], { color: 'teal' }, now).ok, true, 'a cleared play no longer blocks');
  assert.equal(hotBox.canApply({ reach: 'character', character: 'c1' }, [], { color: 'teal' }, now).ok, false);
});

test('Hot Box costs nothing more on a long post, and can be set face down', () => {
  const verdict = decidePlay(hotBox, settings, post(100_000), [], { color: 'teal' }, '');
  assert.equal(verdict.ok && verdict.value.price, 0);
  assert.equal(decideSet(hotBox, settings, post(10), [], { color: 'teal' }, cards).ok, true);
});

test('Hot Box takes a share aired or clean, and refuses anything else', () => {
  const v = hotBox.validateState!;
  assert.deepEqual(v({ clean: true }), { ok: true, value: { clean: true } });
  assert.deepEqual(v({ aired: 0.5 }), { ok: true, value: { aired: 0.5 } });
  assert.deepEqual(v({ aired: 0.123456, junk: 1 }), { ok: true, value: { aired: 0.1235 } }, 'rounded to a ten-thousandth, other keys dropped');
  const refusal = { ok: false, why: 'the smoke is aired out to a share of the post, more than 0 and less than 1, or clean' };
  for (const bad of [{ aired: 0 }, { aired: 1 }, { aired: -0.5 }, { aired: NaN }, { aired: '0.5' }, { clean: false }, {}, null, undefined, { aired: 0.00001 }]) assert.deepEqual(v(bad), refusal, JSON.stringify(bad));
});

test('Hot Box is cleared, for everyone, only once aired out clean, and that is final', () => {
  assert.equal(hotBox.drawsEffect!.final, true);
  const cleared = hotBox.drawsEffect!.cleared!;
  assert.equal(cleared({ clean: true }), true);
  for (const s of [{ aired: 0.5 }, {}, undefined, null, { clean: false }]) assert.equal(cleared(s), false, JSON.stringify(s));
});

test('Hot Box holds its author\'s saves for hotBox.holdHours after the play lands; 0 holds none', () => {
  const landed = new Date('2026-11-16T10:00:00Z');
  assert.equal(hotBox.stateHeldUntil!(settings, landed)?.toISOString(), '2026-11-17T10:00:00.000Z');
  assert.equal(hotBox.stateHeldUntil!(withOverrides(settings, { economy: { 'hotBox.holdHours': 0 } }), landed), undefined);
  assert.equal(hotBox.stateHeldWords!('Nov 17, 10:00'), 'This smoke is too thick to air out until Nov 17, 10:00. It can be aired out after that.');
  assert.deepEqual(hotBox.reads, [{ key: 'hotBox.holdHours', whole: true, min: 0, max: 168 }]);
  for (const bad of [-1, 169, 1.5]) {
    assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'hotBox.holdHours': bad } }) }).join('\n'), /hotBox\.holdHours/, String(bad));
  }
});

test('what the staff read says of the smoke: thick, part aired out, or all aired out', () => {
  const play = { config: { color: 'teal' }, by: 'D-Guy', ago: 'two hours ago' } as never;
  const seen = (state: unknown) => hotBox.seen!({ ...(play as object), state } as never);
  assert.equal(seen(undefined), 'D-Guy filled this post with thick teal smoke, two hours ago: a reader has to wave it away to read through, and over three days it thins to a haze that stays.');
  assert.equal(seen({ aired: 0.4 }), 'D-Guy filled this post with thick teal smoke, two hours ago: a reader has to wave it away to read through, and over three days it thins to a haze that stays. Its author has aired out the top of it.');
  assert.equal(seen({ clean: true }), 'D-Guy filled this post with smoke, two hours ago, and its author has aired it all out: the words read clearly.');
});

test('the instance, with Hot Box in it, has no problems', () => {
  assert.deepEqual(instanceProblems(instance), []);
});
