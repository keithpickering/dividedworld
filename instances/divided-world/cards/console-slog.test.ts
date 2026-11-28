/**
 * Console Slog's rules (docs/plans/2026-11-27-season-two-cards-design.md, section 3.3): priced by the post's length as Whoops! is, on a post with words of its own,
 * one to a post, and open to a Mod Bot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consoleSlog, price } from './console-slog.ts';
import { cards } from './index.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { instanceProblems, withOverrides } from '../../../engine/rules/instance.ts';
import { staffOffers } from '../../../engine/rules/cards.ts';
import { by, on, post, seenOf } from './test-kit.ts';

const QUOTED = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('it is a common Salty Move at 1.00, one to a post, that draws an effect and never clears', () => {
  assert.deepEqual([consoleSlog.key, consoleSlog.alignment, consoleSlog.rarity, consoleSlog.stack, price], ['console-slog', 'salty', 'common', 1, 100]);
  assert.deepEqual(consoleSlog.drawsEffect, {});
  assert.equal(by('console-slog'), cards.find((c) => c.key === 'console-slog'), 'it is in the instance\'s list');
  assert.deepEqual(instanceProblems(instance), []);
});

test('a play costs 0.25 for every 500 characters of the post, at most 2.00 more, and the numbers are settings', () => {
  const at = (length: number, s = settings) => consoleSlog.playPrice(s, post(length), {}, []);
  assert.deepEqual([0, 499, 500, 999, 1000, 4000, 8000, 1_000_000].map((n) => at(n)), [0, 0, 25, 25, 50, 200, 200, 200]);
  const tuned = withOverrides(settings, { economy: { 'consoleSlog.perLength': 50, 'consoleSlog.lengthStep': 250, 'consoleSlog.mostAdded': 300 } });
  assert.deepEqual([249, 250, 1000, 1_000_000].map((n) => at(n, tuned)), [0, 50, 200, 300]);
  assert.match(instanceProblems({ ...instance, settings: withOverrides(settings, { economy: { 'consoleSlog.lengthStep': 0 } }) }).join('\n'), /consoleSlog\.lengthStep/);
  assert.equal(consoleSlog.playPrice(settings, { reach: 'character' } as never, {}, []), 0, 'a target that is no post is priced nothing');
});

test('its price is the same as Whoops!\'s for the same post', () => {
  for (const n of [0, 600, 5000]) assert.equal(consoleSlog.playPrice(settings, post(n), {}, []), by('whoops').playPrice(settings, post(n), { color: 'red' }, []));
});

test('it lands on a post with words of its own, and not on one with none', () => {
  const nothing = { ok: false, why: "There's nothing in this post to type out." };
  assert.deepEqual(consoleSlog.canApply(on('[img]https://x.test/a.png[/img]'), []), nothing);
  assert.deepEqual(consoleSlog.canApply(on(`[quote=${QUOTED}]someone else[/quote]`), []), nothing);
  assert.deepEqual(consoleSlog.canApply(on('[code]let x = 1[/code]'), []), nothing);
  assert.deepEqual(consoleSlog.canApply(on('   '), []), nothing);
  assert.equal(consoleSlog.canApply(on(`[quote=${QUOTED}]someone else[/quote] and then I said`), []).ok, true);
  assert.equal(consoleSlog.canApply(on('Plain words'), []).ok, true);
});

test('it takes one to a post', () => {
  assert.equal(consoleSlog.canApply(on('words'), []).ok, true);
  assert.equal(consoleSlog.canApply(on('words'), [{ card: 'console-slog', act: 'k0' }]).ok, false);
  assert.equal(consoleSlog.canApply(on('words'), [{ card: 'whoops', act: 'k0' }]).ok, true, 'another card is not counted');
});

test('a Mod Bot may play it', () => {
  assert.equal(staffOffers(consoleSlog), true);
});

test('its screens\' numbers are settings with bounds, and a play\'s seen line is the design\'s', () => {
  assert.deepEqual(consoleSlog.screenReads?.map((r) => (typeof r === 'string' ? r : r.key)), ['consoleSlog.rhythmMs', 'consoleSlog.perStep', 'consoleSlog.mostPerPress', 'consoleSlog.drain', 'consoleSlog.bands']);
  assert.deepEqual(['consoleSlog.rhythmMs', 'consoleSlog.perStep', 'consoleSlog.mostPerPress', 'consoleSlog.drain', 'consoleSlog.bands'].map((k) => settings.cardSettings[k]), [450, 5, 8, 12, 16]);
  assert.equal(seenOf('console-slog'), 'Wario turned this post into a command prompt, 2 days ago. A reader types it out by pressing keys.');
});
