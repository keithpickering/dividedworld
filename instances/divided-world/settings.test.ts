import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsProblems } from '../../engine/rules/instance.ts';
import { defaults, playtest, playtestOverrides } from './settings.ts';
import { reactions } from './reactions.ts';
import { QUADRANTS } from '../../engine/rules/types.ts';

test('the defaults hold every setting the engine reads, in range', () => {
  assert.deepEqual(settingsProblems(defaults), []);
});

test('the playtest settings hold every setting the engine reads, in range', () => {
  assert.deepEqual(settingsProblems(playtest), []);
});

test('the defaults are the design\'s section 10 table, in hundredths of an orb', () => {
  assert.equal(defaults.walletCap, 600);
  assert.equal(defaults.vote, 10);
  assert.equal(defaults.halving, 0.5);
  assert.equal(defaults.reactionCap, 3);
  assert.equal(defaults.charactersPerPlayer, 6);
  assert.deepEqual(defaults.seasonLength, { unit: 'month', count: 3 });
  assert.deepEqual(defaults.turnCooldown, { unit: 'day', count: 30 });
  assert.equal(defaults.registrationMode, 'invite');
  assert.equal(defaults.postMaxLength, 20_000);
  assert.equal(defaults.titleMaxLength, 120);
  assert.match(defaults.settlementCron, /^\d+ \d+ \* \* \*$/, 'daily');
});

test('the classes\' and cards\' numbers are the table\'s, as settings', () => {
  assert.deepEqual(defaults.economy, {
    'lurker.earlyPlayers': 3, 'lurker.earlyMatch': 10, 'lurker.spunThreadRepliers': 3, 'lurker.spunThread': 20,
    'lurker.postsAllowed': 3, 'lurker.overPosting': -10,
    'heel.saltyOutdraws': 20,
    'face.cardOutdraws': -20,
    'jabroni.saltyLanded': 20,
    'stickAround.price': 100,
    'whoops.price': 100, 'whoops.perLength': 25, 'whoops.lengthStep': 500, 'whoops.mostInAll': 300,
  });
  assert.ok(Object.isFrozen(defaults.economy));
});

test('the playtest overrides are separate values, not edits of the defaults', () => {
  assert.deepEqual(playtestOverrides, { seasonLength: { unit: 'week', count: 3 }, turnCooldown: { unit: 'day', count: 7 } });
  assert.deepEqual(defaults.seasonLength, { unit: 'month', count: 3 });
  assert.deepEqual(defaults.turnCooldown, { unit: 'day', count: 30 });
  assert.deepEqual(playtest.seasonLength, { unit: 'week', count: 3 });
  assert.deepEqual(playtest.turnCooldown, { unit: 'day', count: 7 });
  assert.notEqual(playtest, defaults);
  assert.ok(Object.isFrozen(defaults), 'the defaults cannot be edited in place');
  assert.ok(Object.isFrozen(defaults.seasonLength) && Object.isFrozen(defaults.turnCooldown), 'not even their spans');
  assert.throws(() => { (defaults.seasonLength as { count: number }).count = 99; }, TypeError);
  const { seasonLength: _s, turnCooldown: _t, ...restPlaytest } = playtest;
  const { seasonLength: _s2, turnCooldown: _t2, ...restDefaults } = defaults;
  assert.deepEqual(restPlaytest, restDefaults, 'the playtest changes only what it overrides');
});

test('the reaction set is the spec\'s four sets of four', () => {
  const by = (q: string) => reactions.filter((r) => r.quadrant === q).map((r) => r.emoji);
  assert.deepEqual(by('excitedPositive'), ['🔥', '❤️', '🙌', '🤩']);
  assert.deepEqual(by('excitedNegative'), ['🍅', '😡', '🤬', '👎']);
  assert.deepEqual(by('calmPositive'), ['😌', '☕', '🤝', '🧘']);
  assert.deepEqual(by('boredNegative'), ['💤', '🙄', '🗑️', '🥱']);
  assert.equal(reactions.length, 16);
});

test('every reaction key is unique, plain, and has a quadrant', () => {
  const keys = reactions.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const r of reactions) {
    assert.match(r.key, /^[a-z][a-z0-9-]*$/, `${r.key} is a plain key, safe in SQL and a URL`);
    assert.ok(QUADRANTS.includes(r.quadrant), `${r.key} has a quadrant`);
  }
});
