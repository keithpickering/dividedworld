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
  postMaxLength: 20000,
  titleMaxLength: 120,
  economy: { 'a.bonus': 5, 'splat.price': 100 },
  settlementLength: { unit: 'day', count: 1 },
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
  copy: { turnsThreadTitle: 'Season {season}: Turns', revealTitle: 'Season {season}: The Reveal', revealBody: 'All of it.' },
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
  assert.match(settingsProblems({ ...settings, registrationMode: 'shut' as never }).join('\n'), /registrationMode/);
  for (const mode of ['open', 'invite', 'closed'] as const) assert.deepEqual(settingsProblems({ ...settings, registrationMode: mode }), [], mode);
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

test('the economy is a setting of named numbers, which the engine checks are numbers and never reads', () => {
  const { economy: _, ...none } = settings;
  assert.match(settingsProblems(none as Settings).join('\n'), /economy/);
  assert.match(settingsProblems({ ...settings, economy: { 'a.bonus': 'five' } as never }).join('\n'), /a\.bonus/);
  assert.match(settingsProblems({ ...settings, economy: { 'a.bonus': Number.NaN } }).join('\n'), /a\.bonus/);
  assert.match(settingsProblems({ ...settings, economy: [] as never }).join('\n'), /economy/);
});

test('an economy override that is not an object of numbers reaches the check, never dropped in silence', () => {
  for (const bad of ['lots', null, [1, 2]]) {
    assert.match(settingsProblems(withOverrides(settings, { economy: bad as never })).join('\n'), /economy/, JSON.stringify(bad));
  }
});

test('a number a class reads can carry its bounds, and a price is a whole number a wallet can hold', () => {
  const bounded = { ...good, classes: [{ key: 'a', name: 'A', reads: [{ key: 'a.bonus', whole: true, min: 6 }], earn: () => [] }] };
  assert.match(instanceProblems(bounded).join('\n'), /class "a" reads economy "a\.bonus" as 5; it must be at least 6/);
  assert.match(instanceProblems({ ...bounded, settings: { ...settings, economy: { ...settings.economy, 'a.bonus': 6.5 } } }).join('\n'), /a whole number/);
  const card = { key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
  // A price above what a wallet holds is a card nobody can buy, the Vending Machine's to refuse at
  // the purchase, never a reason to stop every settlement.
  assert.deepEqual(instanceProblems({ ...good, cards: [card], settings: { ...settings, economy: { ...settings.economy, 'splat.price': 700 } } }), []);
  assert.match(instanceProblems({ ...good, cards: [card], settings: { ...settings, economy: { ...settings.economy, 'splat.price': 2 ** 31 } } }).join('\n'), /splat\.price/);
});

test('a settlement window\'s length is a span', () => {
  assert.match(settingsProblems({ ...settings, settlementLength: { unit: 'hour', count: 1 } as never }).join('\n'), /settlementLength/);
});

test('an override of one economy number keeps the others', () => {
  const tuned = withOverrides(settings, { economy: { 'a.bonus': 9 } });
  assert.deepEqual(tuned.economy, { 'a.bonus': 9, 'splat.price': 100 });
  assert.deepEqual(settings.economy, { 'a.bonus': 5, 'splat.price': 100 });
});

test('a class or card reading an economy number the settings lack is a problem', () => {
  const reads = { ...good, classes: [{ key: 'a', name: 'A', reads: ['a.bonus', 'a.missing'], earn: () => [] }] };
  assert.match(instanceProblems(reads).join('\n'), /class "a" reads economy "a\.missing"/);
  const card = { key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.cost', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
  assert.match(instanceProblems({ ...good, cards: [card] }).join('\n'), /card "splat" is priced by economy "splat\.cost"/);
  assert.deepEqual(instanceProblems({ ...good, cards: [{ ...card, priceKey: 'splat.price' }] }), []);
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

test('an instance says The System\'s words, each title naming its season', () => {
  assert.match(instanceProblems({ ...good, copy: { ...good.copy, revealBody: ' ' } }).join('\n'), /no copy for revealBody/);
  assert.match(instanceProblems({ ...good, copy: { ...good.copy, revealTitle: 'The Reveal' } }).join('\n'), /revealTitle does not say which season/);
  assert.match(instanceProblems({ ...good, copy: undefined } as unknown as Instance).join('\n'), /no copy for turnsThreadTitle/);
});
