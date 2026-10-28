import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze, instanceProblems, settingsProblems, withOverrides } from './instance.ts';
import type { Instance, Settings } from './types.ts';

const settings: Settings = {
  walletCap: 600,
  vote: 10,
  halving: 0.5,
  reactionCap: 3,
  charactersPerPlayer: 6,
  settlementCron: '17 8 * * *',
  seasonLength: { unit: 'month', count: 3 },
  turnCooldown: { unit: 'day', count: 30 },
  registrationMode: 'invite',
};

const good: Instance = {
  key: 'test-world',
  name: 'Test World',
  classes: [{ key: 'a', name: 'A', earn: () => [] }],
  cards: [],
  reactions: [
    { key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' },
    { key: 'zzz', emoji: '💤', quadrant: 'boredNegative' },
  ],
  settings,
  boards: [{ slug: 'general', name: 'General', description: 'Anything.' }],
};

test('a whole instance has no problems', () => {
  assert.deepEqual(instanceProblems(good), []);
});

test('two reactions with one key are a problem', () => {
  const bad = { ...good, reactions: [...good.reactions, { key: 'fire', emoji: '🌶️', quadrant: 'excitedPositive' as const }] };
  assert.match(instanceProblems(bad).join('\n'), /reaction key "fire" is used twice/);
});

test('two reactions with one emoji are a problem', () => {
  const bad = { ...good, reactions: [...good.reactions, { key: 'flame', emoji: '🔥', quadrant: 'excitedPositive' as const }] };
  assert.match(instanceProblems(bad).join('\n'), /emoji "🔥" is used twice/);
});

test('a reaction with no quadrant, or one that is not a quadrant, is a problem', () => {
  const bad = { ...good, reactions: [{ key: 'meh', emoji: '😐', quadrant: 'lukewarm' }] } as unknown as Instance;
  assert.match(instanceProblems(bad).join('\n'), /reaction "meh" has no quadrant/);
});

test('two classes with one key are a problem', () => {
  const bad = { ...good, classes: [...good.classes, { key: 'a', name: 'Also A', earn: () => [] }] };
  assert.match(instanceProblems(bad).join('\n'), /class key "a" is used twice/);
});

test('an instance with no class or no board is a problem', () => {
  assert.match(instanceProblems({ ...good, classes: [] }).join('\n'), /no class/);
  assert.match(instanceProblems({ ...good, boards: [] }).join('\n'), /no board/);
});

test('every setting the engine reads must be present', () => {
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const { [key]: _gone, ...rest } = settings;
    assert.match(settingsProblems(rest as Settings).join('\n'), new RegExp(`setting "${key}"`), `dropping ${key} should be a problem`);
  }
});

test('settings out of range are problems', () => {
  assert.match(settingsProblems({ ...settings, walletCap: 0 }).join('\n'), /walletCap/);
  assert.match(settingsProblems({ ...settings, vote: 2.5 }).join('\n'), /vote/);
  assert.match(settingsProblems({ ...settings, halving: 1.5 }).join('\n'), /halving/);
  assert.match(settingsProblems({ ...settings, reactionCap: 0 }).join('\n'), /reactionCap/);
  for (const cron of ['daily', '* * * * * *', '99 99 * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '5-1 * * * *', 'MON * * * *', ''])
    assert.match(settingsProblems({ ...settings, settlementCron: cron }).join('\n'), /settlementCron/, `cron ${JSON.stringify(cron)}`);
  for (const cron of ['17 8 * * *', '*/15 0-6 * * 1-5', '0 0 1,15 * 0', '0 12 * * 7'])
    assert.deepEqual(settingsProblems({ ...settings, settlementCron: cron }), [], `cron ${JSON.stringify(cron)}`);
  assert.match(settingsProblems({ ...settings, walletCap: 1e300 }).join('\n'), /walletCap/);
  assert.match(settingsProblems({ ...settings, seasonLength: { unit: 'year', count: 1 } as never }).join('\n'), /seasonLength/);
  assert.match(settingsProblems({ ...settings, turnCooldown: { unit: 'day', count: 0 } }).join('\n'), /turnCooldown/);
  assert.match(settingsProblems({ ...settings, registrationMode: 'closed' as never }).join('\n'), /registrationMode/);
});

test('settings that are not an object are a problem, not a crash', () => {
  assert.match(settingsProblems(null as unknown as Settings).join('\n'), /settings are missing/);
  assert.match(instanceProblems({ ...good, settings: undefined } as unknown as Instance).join('\n'), /settings are missing/);
});

test('an instance missing a list is a problem, not a crash', () => {
  for (const key of ['classes', 'cards', 'reactions', 'boards'] as const) {
    const { [key]: _gone, ...rest } = good;
    assert.match(instanceProblems(rest as Instance).join('\n'), new RegExp(`no ${key} list`), key);
  }
});

test('an override left undefined keeps the default', () => {
  assert.deepEqual(withOverrides(settings, { vote: undefined }).vote, settings.vote);
});

test('overrides make a new settings object and leave the defaults as they were', () => {
  const before = JSON.stringify(settings);
  const playtest = withOverrides(settings, { turnCooldown: { unit: 'day', count: 7 } });
  assert.deepEqual(playtest.turnCooldown, { unit: 'day', count: 7 });
  assert.equal(playtest.walletCap, settings.walletCap);
  assert.equal(JSON.stringify(settings), before);
  assert.ok(Object.isFrozen(playtest));
  assert.ok(Object.isFrozen(playtest.turnCooldown) && Object.isFrozen(playtest.seasonLength), 'frozen all the way down');
});

test('deepFreeze reaches inside an object already frozen at the top, and survives a cycle', () => {
  const shallow = Object.freeze({ a: { b: 1 } });
  deepFreeze(shallow);
  assert.ok(Object.isFrozen(shallow.a));
  const loop: { self?: unknown } = {};
  loop.self = loop;
  assert.doesNotThrow(() => deepFreeze(loop));
  assert.ok(Object.isFrozen(loop));
});
