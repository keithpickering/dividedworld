/**
 * Heads Will Roll's own rules (docs/plans/2026-11-27-season-two-cards-design.md, section 2.4): a Pepperoni rare Move on a post, one to a post, no
 * configuration, nothing more to play than its price, five screen numbers within their bounds, a persona may play it, and its log line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, staffConfigOf, staffOffers, type CardRules } from '../../../engine/rules/cards.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { by, on, seenOf } from './test-kit.ts';
import { headsWillRoll, price } from './heads-will-roll.ts';

test('Heads Will Roll is a Pepperoni rare Move on a post, one to a post, drawing an effect, sold at 3.00', () => {
  assert.deepEqual([headsWillRoll.key, headsWillRoll.name, headsWillRoll.alignment, headsWillRoll.rarity], ['heads-will-roll', 'Heads Will Roll', 'pepperoni', 'rare']);
  assert.equal(headsWillRoll.stack, 1);
  assert.deepEqual(headsWillRoll.drawsEffect, {});
  assert.equal(headsWillRoll.reads, undefined);
  assert.equal(price, 300);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'heads-will-roll')?.price, 300);
  assert.equal(by('heads-will-roll'), headsWillRoll);
});

test('it takes no configuration, costs nothing more to play, lands once on a post and refuses a second in the engine\'s words', () => {
  const rules = headsWillRoll as CardRules;
  const first = decidePlay(rules, settings, on('Some words'), [], {}, '');
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.value.price, 0);
  assert.deepEqual(headsWillRoll.validateConfig({ anything: 1 }), { ok: true, value: {} });
  const live = [{ card: 'heads-will-roll', act: 'h1', ends: null }];
  assert.deepEqual(decidePlay(rules, settings, on('Some words'), live as never, {}, ''), { ok: false, why: 'this post already carries that card' });
});

test('its five screen numbers are read within their bounds and the instance holds each default, and refuses one out of bounds', () => {
  const keys = (headsWillRoll.screenReads ?? []).map((r) => (typeof r === 'string' ? r : r.key));
  assert.deepEqual(keys, ['headsWillRoll.overMass', 'headsWillRoll.suns', 'headsWillRoll.mostTurns', 'headsWillRoll.reelBase', 'headsWillRoll.reelPerSpeed']);
  const given = settings.cardSettings;
  assert.deepEqual(keys.map((k) => given[k]), [2, 2, 0.5, 0.8, 0.12]);
  assert.deepEqual(instanceProblems(instance), []);
  for (const [key, bad] of [['headsWillRoll.suns', 5], ['headsWillRoll.suns', 1.5], ['headsWillRoll.overMass', 0.5], ['headsWillRoll.mostTurns', 0], ['headsWillRoll.reelBase', 6], ['headsWillRoll.reelPerSpeed', 1.5]] as const) {
    const poisoned = { ...instance, settings: withOverrides(settings, { cardSettings: { ...settings.cardSettings, [key]: bad } }) };
    assert.match(instanceProblems(poisoned).join('\n'), new RegExp(key.replace('.', '\\.')), `${key} = ${bad}`);
  }
});

test('a persona may play it, with no options, and it says what the board sees', () => {
  assert.equal(staffOffers(headsWillRoll as CardRules), true);
  assert.deepEqual(staffConfigOf(headsWillRoll as CardRules, () => 0), {});
  assert.equal(seenOf('heads-will-roll'), "Wario knocked this post's reactions loose, 2 days ago: they orbit inside it now, and a reader catches one to react.");
});
