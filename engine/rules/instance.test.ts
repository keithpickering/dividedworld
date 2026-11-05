import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIBE_BOUNDS, DEFAULT_DEVELOPER, deepFreeze, instanceProblems, settingsProblems, withOverrides } from './instance.ts';
import type { Instance, Persona, Settings, SystemContent } from './types.ts';
import { PHASE_CAPS } from '../system/phases.ts';
import { DUTIES } from '../system/duties.ts';
import { STOCK_LINE_KEYS } from '../system/stock.ts';
import { DIGEST_MOST } from '../system/digest.ts';

const settings: Settings = {
  walletCap: 600,
  vote: 10,
  halving: 0.5,
  reactionCap: 3,
  charactersPerPlayer: 6,
  settlementCron: '17 8 * * *',
  viewCountCron: '41 * * * *',
  invitesPerPlayer: 3,
  inviteLifetime: { unit: 'day', count: 7 },
  editGrace: { unit: 'minute', count: 2 },
  seasonLength: { unit: 'month', count: 3 },
  turnCooldown: { unit: 'day', count: 30 },
  registrationMode: 'invite',
  postMaxLength: 20000,
  titleMaxLength: 120,
  postsPerPage: 20,
  hotReplies: 10,
  cardSettings: { 'splat.clean': 95 },
  economy: { 'a.bonus': 5, 'splat.price': 100 },
  settlementLength: { unit: 'day', count: 1 },
  presenceWindow: { unit: 'minute', count: 5 },
  presenceNames: 15,
  presencePollSeconds: 30,
  systemEnabled: false,
  meetingCron: '23 9 * * *',
  phases: {
    honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
    reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
    meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
  },
  inheritanceGraceDays: 3,
  rosterRecentExcluded: 2,
  structuralHoldHours: 24,
  microEventDailyCalls: 20,
  digestThreads: 10,
  digestExcerpts: 8,
  digestExcerptChars: 280,
  memoryOpinions: 40,
  memoryGrudges: 20,
  memoryWheelhouse: 30,
  memoryRealWorld: 30,
  notesRead: 12,
  boardNameMaxLength: 60,
  moveExpiryMostDays: 42,
  demandCheckMinutes: 5,
  demandChecksPerTick: 40,
  moveExpiryLeastHours: 24,
  modelTiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' },
  setLasts: { unit: 'day', count: 7 },
  reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' },
  reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } },
  toastDefaults: ['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'ruling', 'settlement', 'update'],
};

const bossFields = { startingHobby: 'tomatoes', temperament: 'petty' };
const botFields = {
  beats: ['general'], petRules: ['noBump'], strictness: { visitHours: { least: 2, most: 12 }, bands: ['small'] },
  weakness: { kind: 'quiz', questions: [{ question: 'Which is a number?', choices: ['one', 'cat'], answer: 'one' }] },
  voice: 'chat', persuadedBy: 'Pedantry.',
} as const;
const boss: Persona = { key: 'boss-a', name: 'Boss A', title: 'The Boss', signature: 'Hi.', persona: 'You are a boss.', ...bossFields, ...botFields };
const bot: Persona = { key: 'bot-a', name: 'Bot A', title: 'Hall monitor', signature: 'Walk.', persona: 'You are a bot.', ...bossFields, ...botFields };

const system: SystemContent = {
  roster: [boss, bot],
  staffGroup: { name: 'Test Cores' },
  firstBoss: 'boss-a',
  firstStaff: ['bot-a'],
  duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'beat' },
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, ['A line.']])) as unknown as SystemContent['stockLines'],
  feeds: [],
  realWorld: ['politics'],
  wheelhouse: ['games'],
  oldVoice: ({ name }) => ({ prompt: `Board: ${name}\nDescription:`, stop: ['\n'] }),
  nameStyle: () => [],
  nameStyleBrief: 'any name',
  announcementsTitle: 'Announcements',
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
  boards: [{ slug: 'general', name: 'General', description: 'Anything.' }, { slug: 'the-system', name: 'The System', description: 'Its own.', system: true }],
  ranks: [{ name: 'Rookie', from: 0 }, { name: 'Regular', from: 100 }, { name: 'Legend', from: 1000 }],
  pipStyles: [{ key: 'default', name: 'Default', full: 'pip-full.svg', empty: 'pip-empty.svg' }],
  copy: { turnsThreadTitle: 'Season {season}: Turns', revealTitle: 'Season {season}: The Reveal', revealBody: 'All of it.' },
  system,
};

test('a whole instance has no problems', () => {
  assert.deepEqual(instanceProblems(good), []);
});

test('exactly one board is The System\'s, and at least one is not', () => {
  const ordinary = good.boards.filter((b) => !b.system);
  assert.match(instanceProblems({ ...good, boards: ordinary }).join('\n'), /no board is The System's/);
  const twice = [...good.boards, { slug: 'also-system', name: 'Also', description: '', system: true }];
  assert.match(instanceProblems({ ...good, boards: twice }).join('\n'), /2 boards are The System's \(the-system, also-system\); exactly one is/);
  const onlySystem = good.boards.filter((b) => b.system);
  assert.match(instanceProblems({ ...good, boards: onlySystem }).join('\n'), /no board for players/);
});

test('a card\'s stack is a whole number, at least 1', () => {
  const card = (stack: unknown) => ({ ...good, cards: [{ key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.price', stack, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] }) as unknown as Instance;
  assert.deepEqual(instanceProblems(card(3)), []);
  assert.deepEqual(instanceProblems(card(undefined)), []);
  for (const bad of [0, 1.5, '3', -1]) assert.match(instanceProblems(card(bad)).join('\n'), /card "splat" stacks .*; a stack is a whole number, at least 1/, String(bad));
});

test('the view counts are recounted on a cron of their own', () => {
  const { viewCountCron: _gone, ...without } = settings;
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "viewCountCron" is missing/);
  assert.match(settingsProblems({ ...settings, viewCountCron: 'hourly' }).join('\n'), /viewCountCron/);
});

test('a thread\'s page and what makes it hot are whole numbers, at least 1', () => {
  for (const key of ['postsPerPage', 'hotReplies'] as const) {
    const { [key]: _gone, ...without } = settings;
    assert.match(settingsProblems(without as Settings).join('\n'), new RegExp(`setting "${key}" is missing`));
    for (const bad of [0, 2.5, '20', null, Number.NaN]) {
      assert.match(settingsProblems({ ...settings, [key]: bad as number }).join('\n'), new RegExp(`setting "${key}"`), `${String(bad)}`);
    }
  }
});

test('the numbers a card gives the screens are an object of named numbers, like the economy', () => {
  const { cardSettings: _gone, ...without } = settings;
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "cardSettings" is missing/);
  for (const bad of [null, [1], 'x', { 'splat.clean': 'ninety' }, { 'splat.clean': Number.NaN }]) {
    assert.match(settingsProblems({ ...settings, cardSettings: bad as never }).join('\n'), /setting "cardSettings"/, JSON.stringify(bad));
  }
  assert.deepEqual(settingsProblems({ ...settings, cardSettings: {} }), []);
});

test('a number a card reads for the screens is one the settings hold, within the card\'s bounds', () => {
  const card = (screenReads: unknown) => ({ ...good, cards: [{ key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.price', screenReads, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] }) as unknown as Instance;
  const reads = [{ key: 'splat.clean', whole: true, min: 1, max: 100 }];
  assert.deepEqual(instanceProblems(card(reads)), []);
  assert.match(instanceProblems(card([{ key: 'splat.other' }])).join('\n'), /card "splat" reads card setting "splat\.other", which the settings do not hold/);
  const held = (n: number) => ({ ...card(reads), settings: { ...settings, cardSettings: { 'splat.clean': n } } }) as Instance;
  assert.match(instanceProblems(held(101)).join('\n'), /card "splat" reads card setting "splat\.clean" as 101; it must be at most 100/);
  assert.match(instanceProblems(held(0)).join('\n'), /at least 1/);
  assert.match(instanceProblems(held(94.5)).join('\n'), /whole number/);
});

test('ranks start at 0 and rise, each named', () => {
  assert.match(instanceProblems({ ...good, ranks: [] }).join('\n'), /no rank/);
  assert.match(instanceProblems({ ...good, ranks: [{ name: 'Late', from: 50 }] }).join('\n'), /the first rank is from 0/);
  assert.match(instanceProblems({ ...good, ranks: [{ name: 'A', from: 0 }, { name: 'B', from: 100 }, { name: 'C', from: 100 }] }).join('\n'), /rank "C" is from 100, not above the rank before it/);
  assert.match(instanceProblems({ ...good, ranks: [{ name: 'A', from: 0 }, { name: ' ', from: 10 }] }).join('\n'), /a rank has no name/);
  assert.match(instanceProblems({ ...good, ranks: [{ name: 'A', from: 0 }, { name: 'B', from: 1.5 }] }).join('\n'), /rank "B" is from 1.5/);
});

test('pip styles hold a default, each with a key, a name and a full and an empty', () => {
  assert.match(instanceProblems({ ...good, pipStyles: [{ key: 'gold', name: 'Gold', full: 'g', empty: 'e' }] }).join('\n'), /no pip style "default"/);
  assert.match(instanceProblems({ ...good, pipStyles: [...good.pipStyles, { key: 'default', name: 'Again', full: 'f', empty: 'e' }] }).join('\n'), /pip style "default" is used twice/);
  assert.match(instanceProblems({ ...good, pipStyles: [...good.pipStyles, { key: 'Bad Key', name: 'Bad', full: 'f', empty: 'e' }] }).join('\n'), /pip style key "Bad Key"/);
  assert.match(instanceProblems({ ...good, pipStyles: [...good.pipStyles, { key: 'blank', name: 'Blank', full: '', empty: 'e' }] }).join('\n'), /pip style "blank" has no full/);
});

test('the developer persona: a name a character can bear, a tagline a profile holds, an avatar key if any; the engine\'s own is plain', () => {
  assert.deepEqual(DEFAULT_DEVELOPER, { name: 'The developers', tagline: '' }, 'the engine\'s default names no one');
  assert.deepEqual(instanceProblems({ ...good, developer: { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' } }), []);
  assert.deepEqual(instanceProblems(good), [], 'an instance with no persona stands on the default');
  assert.match(instanceProblems({ ...good, developer: { name: ' ', tagline: '' } }).join('\n'), /developer has no name/);
  assert.match(instanceProblems({ ...good, developer: { name: 'G'.repeat(41), tagline: '' } }).join('\n'), /developer name .* 41 characters.* at most 40/);
  assert.match(instanceProblems({ ...good, developer: { name: ' Padded ', tagline: '' } }).join('\n'), /developer name .*space/);
  assert.match(instanceProblems({ ...good, developer: { name: 'Gabe', tagline: 'x'.repeat(41) } }).join('\n'), /developer tagline .* 41 characters.* at most 40/);
  assert.match(instanceProblems({ ...good, developer: { name: 'Gabe', tagline: 'Fine', avatar: ' ' } }).join('\n'), /developer avatar/);
  assert.match(instanceProblems({ ...good, developer: { name: 'Gabe', tagline: 3 as unknown as string } }).join('\n'), /developer tagline/);
});

test('a player holds a whole number of open invites, each open for a span', () => {
  assert.match(settingsProblems({ ...settings, invitesPerPlayer: 0 }).join('\n'), /invitesPerPlayer/);
  assert.match(settingsProblems({ ...settings, invitesPerPlayer: 2.5 }).join('\n'), /invitesPerPlayer/);
  assert.match(settingsProblems({ ...settings, inviteLifetime: { unit: 'day', count: 0 } }).join('\n'), /inviteLifetime/);
  assert.deepEqual(settingsProblems({ ...settings, invitesPerPlayer: 1, inviteLifetime: { unit: 'week', count: 2 } }), []);
});

test('an edit\'s grace is a span that may count minutes; the windows, seasons and cooldowns never do', () => {
  assert.deepEqual(settingsProblems({ ...settings, editGrace: { unit: 'minute', count: 2 } }), []);
  assert.deepEqual(settingsProblems({ ...settings, editGrace: { unit: 'day', count: 1 } }), []);
  assert.match(settingsProblems({ ...settings, editGrace: { unit: 'second', count: 90 } } as unknown as Settings).join('\n'), /editGrace/);
  assert.match(settingsProblems({ ...settings, settlementLength: { unit: 'minute', count: 5 } }).join('\n'), /settlementLength/);
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
  for (const key of ['classes', 'cards', 'reactions', 'boards', 'ranks', 'pipStyles'] as const) {
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
  const card = { key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
  // A price above what a wallet holds is a card nobody can buy, the Vending Machine's to refuse at
  // the purchase, never a reason to stop every settlement.
  assert.deepEqual(instanceProblems({ ...good, cards: [card], settings: { ...settings, economy: { ...settings.economy, 'splat.price': 700 } } }), []);
  assert.match(instanceProblems({ ...good, cards: [card], settings: { ...settings, economy: { ...settings.economy, 'splat.price': 2 ** 31 } } }).join('\n'), /splat\.price/);
});

test('a settlement window\'s length is a span', () => {
  assert.match(settingsProblems({ ...settings, settlementLength: { unit: 'hour', count: 1 } as never }).join('\n'), /settlementLength/);
  // A count the database's span_interval cannot hold would break every window: refused here as there.
  assert.match(settingsProblems({ ...settings, seasonLength: { unit: 'month', count: 1001 } }).join('\n'), /seasonLength/);
  assert.deepEqual(settingsProblems({ ...settings, seasonLength: { unit: 'month', count: 1000 } }), []);
});

test('an override of one economy number keeps the others', () => {
  const tuned = withOverrides(settings, { economy: { 'a.bonus': 9 } });
  assert.deepEqual(tuned.economy, { 'a.bonus': 9, 'splat.price': 100 });
  assert.deepEqual(settings.economy, { 'a.bonus': 5, 'splat.price': 100 });
});

test('a class or card reading an economy number the settings lack is a problem', () => {
  const reads = { ...good, classes: [{ key: 'a', name: 'A', reads: ['a.bonus', 'a.missing'], earn: () => [] }] };
  assert.match(instanceProblems(reads).join('\n'), /class "a" reads economy "a\.missing"/);
  const card = { key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.cost', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
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

/* ------------------------------------------------------------------------ The System's content ---- */

const withSystem = (change: Partial<SystemContent>): Instance => ({ ...good, system: { ...system, ...change } });
const withBot = (change: Partial<Persona>): Instance => withSystem({ roster: [boss, { ...bot, ...change }] });
const withBoss = (change: Partial<Persona>): Instance => withSystem({ roster: [{ ...boss, ...change }, bot] });
const said = (i: Instance) => instanceProblems(i).join('\n');

test('a duty assigned to a staff key that does not exist is a problem; a key that does, and the beat and the filer, are not', () => {
  assert.match(said(withSystem({ duties: { ...system.duties, appeal: 'ghost' } })), /duty "appeal".*"ghost"/);
  assert.deepEqual(instanceProblems(withSystem({ duties: { ...system.duties, appeal: 'bot-a', renameJudge: 'filer' } })), []);
  assert.deepEqual(instanceProblems(withSystem({ duties: { ...system.duties, meeting: 'boss-a' } })), [], 'a Boss\'s key is a staff key too');
});

test('a duty left unassigned is a problem, one for each', () => {
  const { appeal: _a, ...rest } = system.duties;
  assert.match(said(withSystem({ duties: rest as SystemContent['duties'] })), /duty "appeal" is assigned to no one/);
  assert.equal(DUTIES.length, 5);
});

test('a standing order with no stock line is a problem, and so is one with an empty list', () => {
  const { moveExpired: _x, ...rest } = system.stockLines;
  assert.match(said(withSystem({ stockLines: rest as SystemContent['stockLines'] })), /stock line "moveExpired"/);
  assert.match(said(withSystem({ stockLines: { ...system.stockLines, moveMet: [] } })), /stock line "moveMet"/);
  assert.match(said(withSystem({ stockLines: { ...system.stockLines, moveMet: ['  '] } })), /stock line "moveMet"/);
});

test('a stock line naming a token its key does not offer is a problem', () => {
  assert.match(said(withSystem({ stockLines: { ...system.stockLines, moveMet: ['Well done, {boss}.'] } })), /stock line "moveMet".*\{boss\}/);
  assert.deepEqual(instanceProblems(withSystem({ stockLines: { ...system.stockLines, moveMet: ['The {move} is over.'] } })), []);
});

test('firstBoss must be in the roster, and an empty roster is flagged', () => {
  assert.match(said(withSystem({ firstBoss: 'nobody' })), /firstBoss "nobody"/);
  assert.match(said(withSystem({ roster: [], firstBoss: 'boss-a' })), /roster is empty/);
});

test('a feed is read over https: a plain http or malformed address is a problem naming the feed', () => {
  assert.equal(said(withSystem({ feeds: [{ name: 'Site', url: 'https://example.com/feed.xml' }] })), '');
  assert.match(said(withSystem({ feeds: [{ name: 'Old Site', url: 'http://example.com/feed.xml' }] })), /feed "Old Site".*https/);
  assert.match(said(withSystem({ feeds: [{ name: 'Odd', url: 'not a url' }] })), /feed "Odd".*https/);
});

test('firstStaff must hold at least one key', () => {
  assert.match(said(withSystem({ firstStaff: [] })), /firstStaff.*at least one/);
});

test('every firstStaff key must be in the roster, and firstBoss is not among them', () => {
  assert.match(said(withSystem({ firstStaff: ['bot-a', 'ghost'] })), /firstStaff.*"ghost"/);
  assert.match(said(withSystem({ firstStaff: ['bot-a', 'boss-a'] })), /firstStaff.*"boss-a".*firstBoss/);
});

test('a key used twice in the roster is a problem, and so is the developer\'s key', () => {
  assert.match(said(withBot({ key: 'boss-a' })), /persona key "boss-a" is used twice/);
  assert.match(said(withSystem({ roster: [boss, bot, bot] })), /persona key "bot-a" is used twice/);
  assert.match(said(withBoss({ key: 'developer' })), /persona key "developer" is reserved/);
  assert.match(said(withBot({ key: 'developer' })), /persona key "developer" is reserved/);
});

test('a persona has every field: a bot field missing from a Boss and a Boss field missing from a bot are each named', () => {
  const without = (p: Persona, field: string) => { const { [field as keyof Persona]: _gone, ...rest } = p; return rest as unknown as Persona; };
  for (const field of ['beats', 'petRules', 'strictness', 'weakness', 'voice', 'persuadedBy']) {
    assert.match(said(withSystem({ roster: [without(boss, field), bot] })), new RegExp(`persona "boss-a" has no ${field}`), field);
  }
  for (const field of ['startingHobby', 'temperament']) {
    assert.match(said(withSystem({ roster: [boss, without(bot, field)] })), new RegExp(`persona "bot-a" has no ${field}`), field);
  }
});

test('a persona with no weakness is reported (poison: today a Boss with none passes)', () => {
  const { weakness: _w, ...rest } = boss;
  assert.match(said(withSystem({ roster: [rest as unknown as Persona, bot] })), /persona "boss-a" has no weakness/);
});

test('the staff group is named, one to 40 characters', () => {
  assert.match(said(withSystem({ staffGroup: { name: '' } })), /staffGroup.name.*1 to 40/);
  assert.match(said(withSystem({ staffGroup: { name: 'x'.repeat(41) } })), /staffGroup.name.*1 to 40/);
  assert.match(said(withSystem({ staffGroup: undefined } as unknown as Partial<SystemContent>)), /staffGroup.name.*1 to 40/);
  assert.deepEqual(instanceProblems(withSystem({ staffGroup: { name: 'x'.repeat(40) } })), []);
});

test('a quiz needs a question, and each question\'s answer must be one of its choices', () => {
  const quiz = (questions: readonly { question: string; choices: readonly string[]; answer: string }[]) => withBot({ weakness: { kind: 'quiz', questions } });
  assert.match(said(quiz([{ question: 'Q?', choices: ['a', 'b'], answer: 'c' }])), /quiz.*"c".*not one of its choices/);
  assert.match(said(quiz([])), /quiz.*at least one question/);
  assert.match(said(quiz([{ question: 'Q?', choices: ['a'], answer: 'a' }])), /quiz.*at least two choices/);
  assert.match(said(quiz([{ question: 'Q?', choices: ['a', 'a'], answer: 'a' }])), /quiz.*twice/);
  assert.deepEqual(instanceProblems(quiz([{ question: 'Q?', choices: ['a', 'b'], answer: 'b' }])), []);
});

test('a bribe\'s price must be inside the engine\'s bounds and something the wallet can hold', () => {
  const bribe = (price: number) => withBot({ weakness: { kind: 'bribe', price } });
  assert.match(said(bribe(BRIBE_BOUNDS.least - 1)), /bribe.*price/);
  assert.match(said(bribe(BRIBE_BOUNDS.most + 1)), /bribe.*price/);
  assert.match(said(bribe(1.5)), /bribe.*price/);
  assert.deepEqual(instanceProblems(bribe(BRIBE_BOUNDS.least)), []);
  assert.deepEqual(instanceProblems({ ...bribe(BRIBE_BOUNDS.most), settings: { ...settings, walletCap: BRIBE_BOUNDS.most } }), []);
  assert.match(said({ ...bribe(BRIBE_BOUNDS.most), settings: { ...settings, walletCap: BRIBE_BOUNDS.most - 1 } }), /wallet/);
});

test('a distraction needs nothing more', () => {
  assert.deepEqual(instanceProblems(withBot({ weakness: { kind: 'distraction' } })), []);
});

test('a Boss\'s phase override past a cap is a problem, naming the number; one inside is not', () => {
  const boss = (phases: NonNullable<Persona['phases']>) => withBoss({ phases });
  assert.match(said(boss({ reign: { weeklyMoves: PHASE_CAPS.reign.weeklyMoves + 1 } })), /persona "boss-a".*reign.*weeklyMoves/);
  assert.match(said(boss({ reign: { bankCap: 0 } })), /persona "boss-a".*reign.*bankCap/);
  assert.deepEqual(instanceProblems(boss({ reign: { weeklyMoves: PHASE_CAPS.reign.weeklyMoves }, honeymoon: { days: 7 } })), []);
});

test('a persona that inherits the memory of one that is not in the roster, or of itself, is a problem', () => {
  const boss = (inheritsMemoryOf: string) => withBoss({ inheritsMemoryOf });
  assert.match(said(boss('ghost')), /"boss-a" inherits the memory of "ghost"/);
  assert.match(said(boss('boss-a')), /"boss-a" inherits the memory of "boss-a"/);
});

test('a title over 40 characters or a signature over 500 is a problem, for a Boss and for a bot (the seed cuts them in silence)', () => {
  assert.match(said(withBoss({ title: 'x'.repeat(41) })), /persona "boss-a".*title.*41.*at most 40/);
  assert.match(said(withBoss({ signature: 'x'.repeat(501) })), /persona "boss-a".*signature.*501.*at most 500/);
  assert.match(said(withBot({ title: 'x'.repeat(41) })), /persona "bot-a".*title/);
  assert.match(said(withBot({ signature: 'x'.repeat(501) })), /persona "bot-a".*signature/);
  assert.deepEqual(instanceProblems(withBot({ title: 'x'.repeat(40), signature: 'x'.repeat(500) })), []);
});

test('a staff member needs a name, a title and a persona', () => {
  assert.match(said(withBot({ name: ' ' })), /persona "bot-a" has no name/);
  assert.match(said(withBot({ persona: '' })), /persona "bot-a" has no persona/);
  assert.match(said(withBoss({ title: '' })), /persona "boss-a" has no title/);
});

test('the name style must also be said in words for the meeting\'s prompt', () => {
  assert.match(said(withSystem({ nameStyleBrief: ' ' })), /nameStyleBrief/);
  assert.match(said(withSystem({ announcementsTitle: ' ' })), /announcementsTitle/);
});

test('nameStyle must be a function', () => {
  assert.match(said(withSystem({ nameStyle: 'PPP' as never })), /nameStyle/);
  assert.match(said(withSystem({ oldVoice: undefined as never })), /oldVoice/);
});

test('no system content at all is a problem, not a crash', () => {
  assert.match(said({ ...good, system: undefined as never }), /no system content/);
});

test('a phase\'s longest move may not outrun the setting for any move, and the least cannot exceed the most', () => {
  const phased = (change: object) => ({ ...good, settings: { ...settings, ...change } }) as Instance;
  assert.match(said(phased({ moveExpiryMostDays: 10 })), /phase "meltdown".*moveExpiryMostDays/);
  assert.match(said(phased({ moveExpiryLeastHours: 24 * 42 + 1 })), /moveExpiryLeastHours/);
});

test('the new settings are checked like the others', () => {
  const bad = (k: string, v: unknown) => settingsProblems({ ...settings, [k]: v } as unknown as Settings).join('\n');
  assert.match(bad('systemEnabled', 'yes'), /systemEnabled/);
  assert.match(bad('meetingCron', 'daily'), /meetingCron/);
  assert.match(bad('phases', { ...settings.phases, reign: { weeklyMoves: 0, bankCap: 10, moveExpiryMostDays: 28 } }), /phases/);
  assert.match(bad('phases', { ...settings.phases, honeymoon: { weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 } }), /phases/);
  for (const k of ['inheritanceGraceDays', 'rosterRecentExcluded', 'structuralHoldHours', 'microEventDailyCalls', 'digestThreads', 'digestExcerpts', 'digestExcerptChars', 'memoryOpinions', 'memoryGrudges', 'memoryWheelhouse', 'memoryRealWorld', 'notesRead', 'boardNameMaxLength', 'moveExpiryMostDays', 'moveExpiryLeastHours', 'demandCheckMinutes', 'demandChecksPerTick']) {
    assert.match(bad(k, -1), new RegExp(k), k);
    assert.match(bad(k, 1.5), new RegExp(k), k);
  }
  for (const k of ['memoryOpinions', 'memoryGrudges', 'memoryWheelhouse', 'memoryRealWorld', 'notesRead']) {
    assert.match(bad(k, 0), new RegExp(k), k);
    assert.match(bad(k, 2.5), new RegExp(k), k);
  }
  // The digest settings have a ceiling too: an admin setting cannot grow the meeting's prompt without bound.
  for (const [k, most] of [['digestThreads', DIGEST_MOST.threads], ['digestExcerpts', DIGEST_MOST.excerpts], ['digestExcerptChars', DIGEST_MOST.excerptChars]] as const) {
    assert.match(bad(k, most + 1), new RegExp(k), k);
    assert.deepEqual(settingsProblems({ ...settings, [k]: most }), [], `${k} may be its ceiling`);
  }
  // The tick's demand-check pacing: at least 1, and a ceiling so a setting cannot make the per-minute transaction unbounded.
  for (const [k, most] of [['demandCheckMinutes', 1440], ['demandChecksPerTick', 1000]] as const) {
    assert.match(bad(k, 0), new RegExp(k), k);
    assert.match(bad(k, most + 1), new RegExp(k), k);
    assert.deepEqual(settingsProblems({ ...settings, [k]: most }), [], `${k} may be its ceiling`);
  }
  assert.match(bad('modelTiers', { strong: 'a' }), /modelTiers/);
  assert.match(bad('modelTiers', { strong: 'a', light: '' }), /modelTiers/);
  assert.deepEqual(settingsProblems({ ...settings, microEventDailyCalls: 0, rosterRecentExcluded: 0, inheritanceGraceDays: 0 }), [], 'zero is allowed where it means none');
});

test('a bot voice that is neither chat nor oldVoice is a problem', () => {
  assert.match(said(withBot({ voice: 'shout' as never })), /persona "bot-a" has the voice "shout"/);
});

test('visit hours with the least above the most, or below 1, are a problem', () => {
  assert.match(said(withBot({ strictness: { ...bot.strictness, visitHours: { least: 13, most: 12 } } })), /persona "bot-a" has visit hours/);
  assert.match(said(withBot({ strictness: { ...bot.strictness, visitHours: { least: 0, most: 12 } } })), /persona "bot-a" has visit hours/);
});

test('a bot with no weakness is a problem', () => {
  assert.match(said(withBot({ weakness: undefined as never })), /persona "bot-a" has no weakness/);
});

test('duties naming a key that is not a duty are a problem', () => {
  assert.match(said(withSystem({ duties: { ...system.duties, bogus: 'boss' } as never })), /the duties name "bogus", which is not a duty/);
});

test('a stock line for no standing order is a problem', () => {
  assert.match(said(withSystem({ stockLines: { ...system.stockLines, bogus: ['A line.'] } as never })), /stock line "bogus" is for no standing order/);
});

test('presence: a window that may count minutes, a most of names, and a poll between 10 and 300 seconds', () => {
  for (const key of ['presenceWindow', 'presenceNames', 'presencePollSeconds'] as const) {
    const { [key]: _gone, ...without } = settings;
    assert.match(settingsProblems(without as Settings).join('\n'), new RegExp(`setting "${key}" is missing`));
  }
  for (const bad of [5, 9, 301, 400, 30.5]) {
    assert.match(settingsProblems({ ...settings, presencePollSeconds: bad }).join('\n'), /setting "presencePollSeconds"/, String(bad));
  }
  assert.deepEqual(settingsProblems({ ...settings, presencePollSeconds: 10 }), []);
  assert.deepEqual(settingsProblems({ ...settings, presencePollSeconds: 300 }), []);
  for (const bad of [0, 2.5, '15']) {
    assert.match(settingsProblems({ ...settings, presenceNames: bad as number }).join('\n'), /setting "presenceNames"/, String(bad));
  }
  assert.deepEqual(settingsProblems({ ...settings, presenceWindow: { unit: 'day', count: 1 } }), []);
  assert.match(settingsProblems({ ...settings, presenceWindow: { unit: 'second', count: 300 } } as unknown as Settings).join('\n'), /presenceWindow/);
});

test('hints: a least of whole reactions, a share above a half, a split of at most a half, a window that may count minutes', () => {
  const { hints: _gone, ...without } = settings;
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "hints" is missing/);
  assert.deepEqual(settingsProblems({ ...settings, hints: { ...settings.hints, least: 1, share: 1, split: 0.5 } }), []);
  const bad = (over: Record<string, unknown>) => settingsProblems({ ...settings, hints: { ...settings.hints, ...over } as never }).join('\n');
  for (const least of [0, 2.5, '10']) assert.match(bad({ least }), /setting "hints"/, `least ${least}`);
  for (const share of [0.5, 0, 1.1, '0.6']) assert.match(bad({ share }), /setting "hints"/, `share ${share}`);
  for (const split of [0, 0.51, 1, -0.1]) assert.match(bad({ split }), /setting "hints"/, `split ${split}`);
  for (const window of [{ unit: 'second', count: 30 }, { unit: 'minute', count: 0 }, 360, null]) assert.match(bad({ window }), /setting "hints"/, JSON.stringify(window));
  assert.match(settingsProblems({ ...settings, hints: [] as never }).join('\n'), /setting "hints"/);
  assert.match(settingsProblems({ ...settings, hints: { least: 10, share: 0.6, split: 0.3 } as never }).join('\n'), /setting "hints"/, 'a missing window');
});

test('toastDefaults: the kinds that toast until a player chooses, each a kind of alert named once; none at all is allowed', () => {
  const { toastDefaults: _gone, ...without } = settings;
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "toastDefaults" is missing/);
  assert.deepEqual(settingsProblems({ ...settings, toastDefaults: [] }), []);
  assert.deepEqual(settingsProblems({ ...settings, toastDefaults: ['seasonNews', 'hint'] }), []);
  for (const bad of [['confetti'], ['quote', 'quote'], 'quote', null, [1], ['quote', null], { quote: true }]) {
    assert.match(settingsProblems({ ...settings, toastDefaults: bad as never }).join('\n'), /setting "toastDefaults"/, JSON.stringify(bad));
  }
  assert.match(settingsProblems({ ...settings, toastDefaults: ['quote', 'confetti'] as never }).join('\n'), /confetti/, 'the unknown kind is named');
});

// The card mechanic's pairings (docs/plans/2026-11-01-card-plays-plan.md, Task 1): each refused, naming the card.
const testCard = (over: Record<string, unknown>) => ({ key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }), ...over });
const withCards = (...cards: Record<string, unknown>[]) => ({ ...good, cards: cards.map(testCard) }) as unknown as Instance;

test('a card carries one of the four rarities', () => {
  assert.deepEqual(instanceProblems(withCards({ rarity: 'legendary' })), []);
  assert.match(instanceProblems(withCards({ rarity: undefined })).join('\n'), /card "splat" has no rarity/);
  assert.match(instanceProblems(withCards({ rarity: 'mythic' })).join('\n'), /card "splat" has the rarity "mythic"; a rarity is common, uncommon, rare or legendary/);
});

test('a trap is a Set card\'s, and a ward and a time up are a Use card\'s', () => {
  const trap = { trigger: { on: 'cast' }, outcome: { do: 'nullify' } };
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap })), []);
  assert.deepEqual(instanceProblems(withCards({ play: 'set' })), [], 'a Set card with no trap is a bluff');
  assert.match(instanceProblems(withCards({ trap })).join('\n'), /card "splat" has a trap, and only a Set card does/);
  assert.match(instanceProblems(withCards({ play: 'use', trap })).join('\n'), /card "splat" has a trap, and only a Set card does/);
  assert.deepEqual(instanceProblems(withCards({ play: 'use', ward: true, lasts: { unit: 'day', count: 7 } })), []);
  assert.match(instanceProblems(withCards({ ward: true })).join('\n'), /card "splat" is a ward, and only a Use card is/);
  assert.match(instanceProblems(withCards({ play: 'use', ward: 'yes' })).join('\n'), /card "splat" is a ward of "yes"; a ward is true or left out/);
  assert.match(instanceProblems(withCards({ play: 'use', ward: true })).join('\n'), /card "splat" is a ward with no time up \(lasts\); a ward ends at its time/);
  assert.match(instanceProblems(withCards({ play: 'set', lasts: { unit: 'day', count: 7 } })).join('\n'), /card "splat" has a time up \(lasts\), and only a Use card or a card reaching beyond a post does/);
  assert.match(instanceProblems(withCards({ play: 'use', lasts: { unit: 'hour', count: 7 } })).join('\n'), /card "splat" lasts .*; it must be a span/);
  assert.match(instanceProblems(withCards({ play: 'deal' })).join('\n'), /card "splat" is played "deal"; a card is cast, used, set or kept/);
});

test('a trap springs on a trigger in the list and does an outcome in the list', () => {
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'sneeze' }, outcome: { do: 'nullify' } } })).join('\n'), /card "splat" springs on "sneeze"/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'reaction', quadrant: 'sideways' }, outcome: { do: 'nullify' } } })).join('\n'), /card "splat" springs on a reaction of "sideways", which is no quadrant/);
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'reaction', quadrant: 'boredNegative' }, outcome: { do: 'nullify' } } })), []);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'cast' }, outcome: { do: 'reflect' } } })).join('\n'), /card "splat" does "reflect"/);
});

test('a strike names a card the instance has, at or below the trap\'s rarity', () => {
  const striker = (card: string) => ({ key: 'striker', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'reply' }, outcome: { do: 'strike', card } } });
  assert.deepEqual(instanceProblems(withCards(striker('splat'), {})), []);
  assert.deepEqual(instanceProblems(withCards(striker('splat'), { rarity: 'uncommon' })), []);
  assert.match(instanceProblems(withCards(striker('nothing'))).join('\n'), /card "striker" strikes with "nothing", which the instance does not have/);
  assert.match(instanceProblems(withCards(striker('splat'), { key: 'splat', rarity: 'rare' })).join('\n'), /card "striker" strikes with "splat", which is rare, rarer than the trap \(uncommon\)/);
});

test('no card springs on a visit, until the staff build wires visits', () => {
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'visit' }, outcome: { do: 'nullify' } } })).join('\n'), /card "splat" springs on a visit, which is not wired until the staff build adds Mod Bot visits/);
});

test('no card is a Keep, until Keep is designed', () => {
  assert.match(instanceProblems(withCards({ play: 'keep' })).join('\n'), /card "splat" is kept, and Keep is not built until it is designed/);
});

test('every Set lasts the same span, setLasts', () => {
  const { setLasts: _gone, ...without } = settings;
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "setLasts" is missing/);
  for (const bad of [{ unit: 'minute', count: 5 }, { unit: 'day', count: 0 }, 7]) {
    assert.match(settingsProblems({ ...settings, setLasts: bad as never }).join('\n'), /setting "setLasts"/, JSON.stringify(bad));
  }
});

test('in this part, Nullify springs on any trigger, Pay out only on a cast, and Strike only on a reply or a quote', () => {
  const trap = (on: string, outcome: Record<string, unknown>) => withCards({ play: 'set', trap: { trigger: { on, quadrant: 'boredNegative' }, outcome } }, { key: 'blot' });
  for (const on of ['cast', 'reaction', 'reply', 'quote']) assert.deepEqual(instanceProblems(trap(on, { do: 'nullify' })), [], on);
  assert.deepEqual(instanceProblems(trap('cast', { do: 'payout' })), []);
  for (const on of ['reaction', 'reply', 'quote']) assert.match(instanceProblems(trap(on, { do: 'payout' })).join('\n'), /card "splat" pays out on a \w+; it pays out only on a cast, since only a cast is paid for/, on);
  for (const on of ['reply', 'quote']) assert.deepEqual(instanceProblems(trap(on, { do: 'strike', card: 'blot' })), [], on);
  for (const on of ['cast', 'reaction']) assert.match(instanceProblems(trap(on, { do: 'strike', card: 'blot' })).join('\n'), /card "splat" strikes on a \w+; a strike lays its card on a reply or a quote, until cards reach characters/, on);
});

// Reach (docs/plans/2026-11-01-card-reach-plan.md, Task 1): each refused, naming the card.
test('a card reaches no further than its rarity allows', () => {
  const lasts = { unit: 'day', count: 1 };
  assert.deepEqual(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['character'], lasts })), []);
  assert.deepEqual(instanceProblems(withCards({ rarity: 'legendary', reaches: ['post', 'board'], lasts })), []);
  assert.match(instanceProblems(withCards({ rarity: 'common', reaches: ['character'], lasts })).join('\n'), /card "splat" reaches a character, which takes a card of uncommon or rarer; it is common/);
  assert.match(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['post', 'thread'], lasts })).join('\n'), /card "splat" reaches a thread, which takes a card of rare or rarer; it is uncommon/);
  assert.match(instanceProblems(withCards({ rarity: 'rare', reaches: ['board'], lasts })).join('\n'), /card "splat" reaches a board, which takes a card of legendary or rarer; it is rare/);
});

test('a card\'s reaches are a list of a post, a character, a thread or a board', () => {
  for (const bad of [[], ['room'], 'post', ['post', 'post']]) {
    assert.match(instanceProblems(withCards({ reaches: bad })).join('\n'), /card "splat" reaches .*; a card reaches a list of post, character, thread or board, each once/, JSON.stringify(bad));
  }
  assert.deepEqual(instanceProblems(withCards({ reaches: ['post'] })), []);
});

test('a card beyond a post ends at its time, and no later than its reach\'s bound', () => {
  assert.match(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['character'] })).join('\n'), /card "splat" reaches beyond a post with no time up \(lasts\); every effect beyond a post ends at its time/);
  assert.deepEqual(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['character'], lasts: { unit: 'week', count: 1 } })), []);
  assert.match(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['character'], lasts: { unit: 'day', count: 8 } })).join('\n'), /card "splat" lasts 8 days, longer than a character effect may \(reachLasts\.character, 7 days\)/);
  assert.match(instanceProblems(withCards({ rarity: 'legendary', reaches: ['thread', 'board'], lasts: { unit: 'week', count: 1 } })).join('\n'), /card "splat" lasts 1 week, longer than a thread effect may \(reachLasts\.thread, 1 day\)/);
});

test('a Cast on a post alone has no time up', () => {
  assert.match(instanceProblems(withCards({ reaches: ['post'], lasts: { unit: 'day', count: 1 } })).join('\n'), /card "splat" has a time up \(lasts\), and only a Use card or a card reaching beyond a post does/);
});

test('a Set lands on a post alone', () => {
  assert.match(instanceProblems(withCards({ rarity: 'legendary', play: 'set', reaches: ['post', 'board'], lasts: { unit: 'day', count: 1 } })).join('\n'), /card "splat" is set face down, and a Set lands only on a post/);
});

test('each reach\'s least rarity and longest time are settings', () => {
  const { reachRarity: _r, reachLasts: _l, ...without } = settings;
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "reachRarity" is missing/);
  assert.match(settingsProblems(without as Settings).join('\n'), /setting "reachLasts" is missing/);
  for (const bad of [{ character: 'uncommon', thread: 'rare' }, { character: 'mythic', thread: 'rare', board: 'legendary' }, ['rare'], 'rare', { character: 'uncommon', thread: 'rare', board: 'legendary', room: 'rare' }]) {
    assert.match(settingsProblems({ ...settings, reachRarity: bad as never }).join('\n'), /setting "reachRarity" .*; it must be an object giving character, thread and board each a rarity/, JSON.stringify(bad));
  }
  for (const bad of [{ character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 } }, { character: { unit: 'minute', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } }, 7]) {
    assert.match(settingsProblems({ ...settings, reachLasts: bad as never }).join('\n'), /setting "reachLasts" .*; it must be an object giving character, thread and board each a span/, JSON.stringify(bad));
  }
});

test('only a card that reaches a thread pins', () => {
  const lasts = { unit: 'day', count: 1 };
  assert.deepEqual(instanceProblems(withCards({ rarity: 'rare', reaches: ['thread'], lasts, pins: true })), []);
  assert.match(instanceProblems(withCards({ pins: true })).join('\n'), /card "splat" pins true; only a card that reaches a thread pins/);
  assert.match(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['character'], lasts, pins: true })).join('\n'), /card "splat" pins true; only a card that reaches a thread pins/);
  assert.match(instanceProblems(withCards({ rarity: 'rare', reaches: ['thread'], lasts, pins: 'yes' })).join('\n'), /card "splat" pins "yes"/);
});
