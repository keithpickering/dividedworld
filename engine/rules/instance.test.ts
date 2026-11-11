import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIBE_BOUNDS, DEFAULT_DEVELOPER, deepFreeze, instanceProblems, settingsProblems, withOverrides } from './instance.ts';
import type { Instance, Persona, Settings, SystemContent } from './types.ts';
import { PHASE_CAPS } from '../system/phases.ts';
import { DUTIES } from '../system/duties.ts';
import { STOCK_LINE_KEYS } from '../system/stock.ts';
import { DIGEST_MOST } from '../system/digest.ts';
import { testGroups } from './test-system.ts';
import { PRONOUN_PRESETS } from './pronouns.ts';

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
  searchLanguage: 'english',
  searchRankPool: 5000,
  cardSettings: { 'splat.clean': 95 },
  economy: { 'a.bonus': 5 },
  settlementLength: { unit: 'day', count: 1 },
  presenceWindow: { unit: 'minute', count: 5 },
  presenceNames: 15,
  presencePollSeconds: 30,
  systemEnabled: false,
  oldVoice: true,
  cardWriteSettleSeconds: 30,
  pronouns: PRONOUN_PRESETS.it,
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
  digestBoards: 30,
  digestBoardDays: 21,
  movedStubDays: 7,
  bundleMostParts: 4,
  bundleAuthoredMostParts: 8,
  digestExcerpts: 8,
  digestExcerptChars: 280,
  memoryOpinions: 40,
  memoryGrudges: 20,
  memoryWheelhouse: 30,
  memoryRealWorld: 30,
  pool: { weekly: 20, holdback: 0.2, threadsWeekly: 1, cardRarityMost: 'common', priorityDays: 28, notesRead: 12, chatterThreadPosts: 8, strengths: { named: 5, quoted: 5, legacy: 5, successorStumbles: 5, oldFlame: 5, homeTurf: 2, seasonTurn: 2, hotOnBeat: 2 }, chatterCron: '37 17 * * *' },
  modBots: { allowanceMost: 3, ruleDaysMost: 7, visitHours: { least: 2, most: 12 }, patrolsPerDay: 6, patrolSample: 5, reportPrice: 25, reportsPerDay: 3, judgmentsPerDay: 60, filingLinesPerDay: 60, appealPrice: 50, tailHours: 24, cap: { punishments: 3, days: 7 }, filingCron: '*/5 * * * *', filingGraceMinutes: 10 },
  warnBar: { size: 10, bands: { minor: 2, moderate: 4, severe: 7 }, decay: { unit: 'day', count: 14 }, banDays: [1, 3, 7] },
  apology: { apologyEveryHours: 24, apologyJudgeBatch: 10, apologyRulingMaxWords: 80 },
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
  toastDefaults: ['quote', 'cardOnYours', 'cardEnded', 'trapStruck', 'trapSprang', 'ruling', 'settlement', 'update'],
};

const bossFields = { startingHobby: 'tomatoes', temperament: 'petty' };
const botFields = {
  beats: ['general'], petRules: ['noBump'], strictness: { visitHours: { least: 2, most: 12 }, bands: ['small'] },
  weakness: { kind: 'quiz', questions: [{ question: 'Which is a number?', choices: ['one', 'cat'], answer: 'one' }] },
  voice: 'chat', persuadedBy: 'Pedantry.',
} as const;
const boss: Persona = { key: 'boss-a', name: 'Boss A', title: 'The Boss', signature: 'Hi.', selfPrompt: 'You are a boss.', ...bossFields, ...botFields };
const bot: Persona = { key: 'bot-a', name: 'Bot A', title: 'Hall monitor', signature: 'Walk.', selfPrompt: 'You are a bot.', ...bossFields, ...botFields };

const system: SystemContent = {
  roster: [boss, bot],
  firstBoss: 'boss-a',
  firstStaff: ['bot-a'],
  duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'beat', chatter: 'boss', filing: 'beat', reportJudge: 'beat', patrolJudge: 'beat', apologyJudge: 'beat' },
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, ['A line.']])) as unknown as SystemContent['stockLines'],
  feeds: [],
  realWorld: ['politics'],
  scrubWords: ['badword'],
  wheelhouse: ['games'],
  nameStyle: () => [],
  nameStyleBrief: 'any name',
  offices: { boss: { premise: 'B.', answerRules: 'Br.' }, mod: { premise: 'M.', answerRules: 'Mr.' }, member: { premise: 'E.', answerRules: 'Er.' } },
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
  boards: [{ slug: 'general', name: 'General', description: 'Anything.' }, { slug: 'announcements', name: 'The System', description: 'Its own.', system: true }],
  ranks: [{ name: 'Rookie', from: 0 }, { name: 'Regular', from: 100 }, { name: 'Legend', from: 1000 }],
  pipStyles: [{ key: 'default', name: 'Default', full: 'pip-full.svg', empty: 'pip-empty.svg' }],
  groups: testGroups,
  copy: { announcementsThreadTitle: 'Season {season}: Promos' },
  system,
  packs: [],
  machine: [],
};

test('a whole instance has no problems', () => {
  assert.deepEqual(instanceProblems(good), []);
});

test('exactly one board is The System\'s, and at least one is not', () => {
  const ordinary = good.boards.filter((b) => !b.system);
  assert.match(instanceProblems({ ...good, boards: ordinary }).join('\n'), /no board is The System's/);
  const twice = [...good.boards, { slug: 'also-system', name: 'Also', description: '', system: true }];
  assert.match(instanceProblems({ ...good, boards: twice }).join('\n'), /2 boards are The System's \(announcements, also-system\); exactly one is/);
  const onlySystem = good.boards.filter((b) => b.system);
  assert.match(instanceProblems({ ...good, boards: onlySystem }).join('\n'), /no board for players/);
});

test('a card\'s stack is a whole number, at least 1', () => {
  const card = (stack: unknown) => ({ ...good, cards: [{ key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, stack, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] }) as unknown as Instance;
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

test('the search language names a text search configuration and the rank pool is a whole number from 100 to 100,000', () => {
  for (const key of ['searchLanguage', 'searchRankPool'] as const) {
    const { [key]: _gone, ...without } = settings;
    assert.match(settingsProblems(without as Settings).join('\n'), new RegExp(`setting "${key}" is missing`));
  }
  assert.deepEqual(settingsProblems({ ...settings, searchLanguage: 'simple', searchRankPool: 100 }), []);
  assert.deepEqual(settingsProblems({ ...settings, searchRankPool: 100_000 }), []);
  for (const bad of ['', 5, null, ' english', 'English', 'a b', 'english;']) {
    assert.match(settingsProblems({ ...settings, searchLanguage: bad as never }).join('\n'), /setting "searchLanguage" is .*text search configuration/, JSON.stringify(bad));
  }
  for (const bad of [99, 100_001, 2.5, '5000', null, Number.NaN, -1]) {
    assert.match(settingsProblems({ ...settings, searchRankPool: bad as never }).join('\n'), /setting "searchRankPool" is .*; it must be a whole number of matches from 100 to 100,000/, String(bad));
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
  const card = (screenReads: unknown) => ({ ...good, cards: [{ key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, screenReads, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] }) as unknown as Instance;
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

test('groups with a problem make the instance have one, in words', () => {
  const noDefault = { ...good.groups, ladder: good.groups.ladder.filter((r) => r.when.kind !== 'default') };
  assert.match(instanceProblems({ ...good, groups: noDefault }).join('\n'), /0 default rungs/);
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

test('a number a class reads can carry its bounds', () => {
  const bounded = { ...good, classes: [{ key: 'a', name: 'A', reads: [{ key: 'a.bonus', whole: true, min: 6 }], earn: () => [] }] };
  assert.match(instanceProblems(bounded).join('\n'), /class "a" reads economy "a\.bonus" as 5; it must be at least 6/);
  assert.match(instanceProblems({ ...bounded, settings: { ...settings, economy: { ...settings.economy, 'a.bonus': 6.5 } } }).join('\n'), /a whole number/);
});

test('a number a class reads can carry a most', () => {
  const bounded = { ...good, classes: [{ key: 'a', name: 'A', reads: [{ key: 'a.bonus', whole: true, min: 1, max: 4 }], earn: () => [] }] };
  assert.match(instanceProblems(bounded).join('\n'), /class "a" reads economy "a\.bonus" as 5; it must be at most 4/);
});

test('a settlement window\'s length is a span', () => {
  assert.match(settingsProblems({ ...settings, settlementLength: { unit: 'hour', count: 1 } as never }).join('\n'), /settlementLength/);
  // A count the database's span_interval cannot hold would break every window: refused here as there.
  assert.match(settingsProblems({ ...settings, seasonLength: { unit: 'month', count: 1001 } }).join('\n'), /seasonLength/);
  assert.deepEqual(settingsProblems({ ...settings, seasonLength: { unit: 'month', count: 1000 } }), []);
});

test('an override of one economy number keeps the others', () => {
  const tuned = withOverrides(settings, { economy: { 'a.bonus': 9 } });
  assert.deepEqual(tuned.economy, { 'a.bonus': 9 });
  assert.deepEqual(settings.economy, { 'a.bonus': 5 });
});

test('a class or card reading an economy number the settings lack is a problem', () => {
  const reads = { ...good, classes: [{ key: 'a', name: 'A', reads: ['a.bonus', 'a.missing'], earn: () => [] }] };
  assert.match(instanceProblems(reads).join('\n'), /class "a" reads economy "a\.missing"/);
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
  assert.match(instanceProblems({ ...good, copy: { ...good.copy, announcementsThreadTitle: ' ' } }).join('\n'), /no copy for announcementsThreadTitle/);
  assert.match(instanceProblems({ ...good, copy: { ...good.copy, announcementsThreadTitle: 'Promos' } }).join('\n'), /announcementsThreadTitle does not say which season/);
  assert.match(instanceProblems({ ...good, copy: undefined } as unknown as Instance).join('\n'), /no copy for announcementsThreadTitle/);
  // A copy written before 0099 holds only the old keys, and so lacks the one now asked for (unknown keys are not refused).
  assert.match(instanceProblems({ ...good, copy: { revealTitle: 'Season {season}', revealBody: 'x', turnsThreadTitle: 'S{season}' } } as unknown as Instance).join('\n'), /no copy for announcementsThreadTitle/);
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
  assert.equal(DUTIES.length, 10);
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

test('the staff group is the ladder\'s staff rung, so the system content names none (a leftover staffGroup is not read)', () => {
  assert.deepEqual(instanceProblems(withSystem({ staffGroup: { name: '' } } as unknown as Partial<SystemContent>)), []);
});

test('a quiz needs a question, and each question\'s answer must be one of its choices', () => {
  const quiz = (questions: readonly { question: string; choices: readonly string[]; answer: string }[]) => withBot({ weakness: { kind: 'quiz', questions } });
  assert.match(said(quiz([{ question: 'Q?', choices: ['a', 'b'], answer: 'c' }])), /quiz.*"c".*not one of its choices/);
  assert.match(said(quiz([])), /quiz.*at least one question/);
  assert.match(said(quiz([{ question: 'Q?', choices: ['a'], answer: 'a' }])), /quiz.*at least two choices/);
  assert.match(said(quiz([{ question: 'Q?', choices: ['a', 'a'], answer: 'a' }])), /quiz.*twice/);
  assert.match(said(quiz([{ question: ' ', choices: ['a', 'b'], answer: 'a' }])), /quiz.*no question to ask/);
  assert.match(said(quiz([{ question: 'Q?', choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], answer: 'a' }])), /quiz.*more than eight choices/);
  assert.match(said(quiz([{ question: 'Q? ', choices: ['a', 'b'], answer: 'a' }])), /quiz.*space at the start or the end of its question/);
  assert.match(said(quiz([{ question: 'Q?', choices: ['a', ' b'], answer: 'a' }])), /quiz.*choice with a space/);
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
  assert.match(said(withBot({ selfPrompt: '' })), /persona "bot-a" has no selfPrompt/);
  assert.match(said(withBoss({ title: '' })), /persona "boss-a" has no title/);
});

test('a persona in each office\'s frame: every posting office has a premise and answer rules, and an office line names an office that posts', () => {
  const { member: _gone, ...noMember } = system.offices;
  assert.match(said(withSystem({ offices: noMember as SystemContent['offices'] })), /system\.offices has no "member" frame/);
  assert.match(said(withSystem({ offices: { ...system.offices, boss: { premise: ' ', answerRules: 'r' } } })), /system\.offices\.boss has a blank premise/);
  assert.match(said(withSystem({ offices: { ...system.offices, mod: { premise: 'p', answerRules: '' } } })), /system\.offices\.mod has a blank answerRules/);
  assert.match(said(withBoss({ officeLines: { janitor: 'Mop.' } as unknown as Persona['officeLines'] })), /persona "boss-a" has an office line for "janitor", which is not an office that posts \(boss, mod, member\)/);
  assert.match(said(withBoss({ officeLines: { boss: ' ' } })), /persona "boss-a" has a blank office line for "boss"/);
  assert.deepEqual(instanceProblems(withBoss({ officeLines: { boss: 'You run it.', mod: 'You patrol.' } })), []);
});

test('the name style must also be said in words for the meeting\'s prompt', () => {
  assert.match(said(withSystem({ nameStyleBrief: ' ' })), /nameStyleBrief/);
  assert.match(said(withSystem({ announcementsTitle: ' ' })), /announcementsTitle/);
});

test('nameStyle must be a function', () => {
  assert.match(said(withSystem({ nameStyle: 'PPP' as never })), /nameStyle/);
  assert.doesNotMatch(said(withSystem({ nameStyleBrief: 'x' })), /oldVoice/, 'a whole system names no oldVoice problem');
});

test('no system content at all is a problem, not a crash', () => {
  assert.match(said({ ...good, system: undefined as never }), /no system content/);
});

test('a phase\'s longest move may not outrun the setting for any move, and the least cannot exceed the most', () => {
  const phased = (change: object) => ({ ...good, settings: { ...settings, ...change } }) as Instance;
  assert.match(said(phased({ moveExpiryMostDays: 10 })), /phase "meltdown".*moveExpiryMostDays/);
  assert.match(said(phased({ moveExpiryLeastHours: 24 * 42 + 1 })), /moveExpiryLeastHours/);
});

test('the pool\'s settings are checked: whole numbers, a holdback from 0 to 0.5, a rarity, a strength for every trigger, a cron', () => {
  const pool = settings.pool;
  const bad = (change: object) => settingsProblems({ ...settings, pool: { ...pool, ...change } } as unknown as Settings).join('\n');
  const good = (change: object) => settingsProblems({ ...settings, pool: { ...pool, ...change } } as unknown as Settings);
  for (const k of ['weekly', 'priorityDays', 'notesRead', 'chatterThreadPosts']) for (const v of [0, -1, 1.5, '5', null, 2 ** 53]) assert.match(bad({ [k]: v }), /setting "pool"/, `${k} = ${String(v)}`);
  for (const v of [-1, 1.5, '1', null]) assert.match(bad({ threadsWeekly: v }), /threadsWeekly/, String(v));
  assert.deepEqual(good({ threadsWeekly: 0 }), [], 'zero new threads a week is allowed');
  for (const v of [-0.1, 0.51, 1, '0.2', null]) assert.match(bad({ holdback: v }), /holdback/, String(v));
  for (const v of [0, 0.5]) assert.deepEqual(good({ holdback: v }), [], `holdback ${v}`);
  for (const v of ['mythic', '', 'Common', 1, null]) assert.match(bad({ cardRarityMost: v }), /cardRarityMost/, String(v));
  for (const v of ['daily', '61 * * * *', '* * * *', 5, null]) assert.match(bad({ chatterCron: v }), /chatterCron/, String(v));
  for (const t of Object.keys(pool.strengths)) {
    const { [t as keyof typeof pool.strengths]: _gone, ...rest } = pool.strengths;
    assert.match(bad({ strengths: rest }), new RegExp(`strengths.${t}`), `no strength for ${t}`);
    for (const v of [0, 1.5, '5', null]) assert.match(bad({ strengths: { ...pool.strengths, [t]: v } }), new RegExp(`strengths.${t}`), `${t} = ${String(v)}`);
  }
  assert.match(bad({ strengths: { ...pool.strengths, shouting: 5 } }), /strengths.shouting/);
  assert.match(bad({ stray: 1 }), /stray/);
  assert.match(settingsProblems({ ...settings, pool: [] } as unknown as Settings).join('\n'), /setting "pool"/);
});

test('the new settings are checked like the others', () => {
  const bad = (k: string, v: unknown) => settingsProblems({ ...settings, [k]: v } as unknown as Settings).join('\n');
  assert.match(bad('systemEnabled', 'yes'), /systemEnabled/);
  assert.match(bad('oldVoice', 'yes'), /oldVoice/);
  assert.match(bad('meetingCron', 'daily'), /meetingCron/);
  assert.match(bad('phases', { ...settings.phases, reign: { weeklyMoves: 0, bankCap: 10, moveExpiryMostDays: 28 } }), /phases/);
  assert.match(bad('phases', { ...settings.phases, honeymoon: { weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 } }), /phases/);
  for (const k of ['inheritanceGraceDays', 'rosterRecentExcluded', 'structuralHoldHours', 'microEventDailyCalls', 'digestThreads', 'digestBoards', 'digestBoardDays', 'movedStubDays', 'bundleMostParts', 'bundleAuthoredMostParts', 'digestExcerpts', 'digestExcerptChars', 'memoryOpinions', 'memoryGrudges', 'memoryWheelhouse', 'memoryRealWorld', 'boardNameMaxLength', 'moveExpiryMostDays', 'moveExpiryLeastHours', 'demandCheckMinutes', 'demandChecksPerTick']) {
    assert.match(bad(k, -1), new RegExp(k), k);
    assert.match(bad(k, 1.5), new RegExp(k), k);
  }
  for (const k of ['memoryOpinions', 'memoryGrudges', 'memoryWheelhouse', 'memoryRealWorld']) {
    assert.match(bad(k, 0), new RegExp(k), k);
    assert.match(bad(k, 2.5), new RegExp(k), k);
  }
  // The digest settings have a ceiling too: an admin setting cannot grow the meeting's prompt without bound.
  for (const [k, most] of [['digestThreads', DIGEST_MOST.threads], ['digestBoards', DIGEST_MOST.boards], ['digestBoardDays', DIGEST_MOST.boardDays], ['digestExcerpts', DIGEST_MOST.excerpts], ['digestExcerptChars', DIGEST_MOST.excerptChars]] as const) {
    assert.match(bad(k, most + 1), new RegExp(k), k);
    assert.deepEqual(settingsProblems({ ...settings, [k]: most }), [], `${k} may be its ceiling`);
  }
  // The tick's demand-check pacing: at least 1, and a ceiling so a setting cannot make the per-minute transaction unbounded.
  // How long a moved thread's stub stays on the board it left: at least a day, at most a year, as the migration's check holds.
  assert.match(bad('movedStubDays', 0), /movedStubDays/);
  assert.match(bad('movedStubDays', 366), /movedStubDays/);
  assert.deepEqual(settingsProblems({ ...settings, movedStubDays: 365 }), []);
  // The bundle bounds: a composed bundle and an authored one each hold from one part to sixteen, so a setting cannot make a bundle unbounded.
  for (const k of ['bundleMostParts', 'bundleAuthoredMostParts']) {
    assert.match(bad(k, 0), new RegExp(k), k);
    assert.match(bad(k, 17), new RegExp(k), k);
    assert.deepEqual(settingsProblems({ ...settings, [k]: 16 }), [], `${k} may be 16`);
    assert.deepEqual(settingsProblems({ ...settings, [k]: 1 }), [], `${k} may be 1`);
  }
  for (const [k, most] of [['demandCheckMinutes', 1440], ['demandChecksPerTick', 1000]] as const) {
    assert.match(bad(k, 0), new RegExp(k), k);
    assert.match(bad(k, most + 1), new RegExp(k), k);
    assert.deepEqual(settingsProblems({ ...settings, [k]: most }), [], `${k} may be its ceiling`);
  }
  assert.match(bad('modelTiers', { strong: 'a' }), /modelTiers/);
  assert.match(bad('modelTiers', { strong: 'a', light: '' }), /modelTiers/);
  // The warn bar: a band above the bar's size is a problem, as is an empty ladder, a ladder step below one day and a decay that is no span.
  const wb = settings.warnBar;
  assert.match(bad('warnBar', { ...wb, bands: { ...wb.bands, severe: wb.size + 1 } }), /warnBar.*bands\.severe/);
  assert.match(bad('warnBar', { ...wb, size: 0 }), /warnBar.*size/);
  assert.match(bad('warnBar', { ...wb, banDays: [] }), /warnBar.*banDays/);
  assert.match(bad('warnBar', { ...wb, banDays: [1, 0] }), /warnBar.*banDays/);
  assert.match(bad('warnBar', { ...wb, decay: { unit: 'year', count: 1 } }), /warnBar.*decay/);
  assert.deepEqual(settingsProblems({ ...settings, warnBar: { ...wb, bands: { ...wb.bands, severe: wb.size }, decay: { unit: 'minute', count: 1 } } }), [], 'a band may fill the bar, and a decay may be minutes');
  // The apology's numbers: each a whole number, at least 1, and nothing else in the object.
  const gs = settings.apology;
  for (const k of ['apologyEveryHours', 'apologyJudgeBatch', 'apologyRulingMaxWords'] as const) {
    for (const v of [0, -1, 1.5, '24', null]) assert.match(bad('apology', { ...gs, [k]: v }), new RegExp(`apology.*"${k}" is not`), `${k} = ${String(v)}`);
    assert.deepEqual(settingsProblems({ ...settings, apology: { ...gs, [k]: 1 } }), [], `${k} may be 1`);
  }
  assert.match(bad('apology', { ...gs, other: 1 }), /apology.*"other" is not one of its fields/);
  assert.match(bad('apology', { apologyEveryHours: 24, apologyJudgeBatch: 10 }), /apology.*"apologyRulingMaxWords" is not/);
  assert.match(bad('apology', 'x'), /apology/);
  assert.match(bad('apology', null), /apology/);
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
const testCard = (over: Record<string, unknown>) => ({ key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }), ...over });
const withCards = (...cards: Record<string, unknown>[]) => ({ ...good, cards: cards.map(testCard) }) as unknown as Instance;

test('a card carries one of the four rarities', () => {
  assert.deepEqual(instanceProblems(withCards({ rarity: 'legendary' })), []);
  assert.match(instanceProblems(withCards({ rarity: undefined })).join('\n'), /card "splat" has no rarity/);
  assert.match(instanceProblems(withCards({ rarity: 'mythic' })).join('\n'), /card "splat" has the rarity "mythic"; a rarity is common, uncommon, rare or legendary/);
});

test('a trap is a set card\'s, and a gimmick and a time up are a use card\'s', () => {
  const trap = { trigger: { on: 'visit' } };
  const ward = { kind: 'ward', upTo: 'common' };
  const day = { unit: 'day', count: 7 };
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap })), []);
  assert.match(instanceProblems(withCards({ play: 'set' })).join('\n'), /card "splat" is a set card with no trap/);
  assert.match(instanceProblems(withCards({ trap })).join('\n'), /card "splat" has a trap, and only a set card has one/);
  assert.match(instanceProblems(withCards({ play: 'use', trap, gimmick: ward, lasts: day })).join('\n'), /card "splat" has a trap, and only a set card has one/);
  assert.deepEqual(instanceProblems(withCards({ play: 'use', gimmick: ward, lasts: day })), []);
  assert.match(instanceProblems(withCards({ play: 'use', lasts: day })).join('\n'), /card "splat" is a use card with no gimmick/);
  assert.match(instanceProblems(withCards({ gimmick: ward })).join('\n'), /card "splat" has a gimmick, and only a use card has one/);
  assert.match(instanceProblems(withCards({ play: 'use', gimmick: ward })).join('\n'), /card "splat" is a use card with no time up \(lasts\)/);
  assert.match(instanceProblems(withCards({ play: 'use', gimmick: ward, lasts: day, reaches: ['board'] })).join('\n'), /card "splat" is a use card and reaches a board; a use card reaches a post, a character or a thread/);
  assert.match(instanceProblems(withCards({ play: 'use', gimmick: ward, lasts: day, reaches: ['post', 'moon'] })).join('\n'), /a use card reaches a post, a character or a thread/);
  assert.deepEqual(instanceProblems(withCards({ play: 'use', gimmick: ward, lasts: { unit: 'day', count: 1 }, rarity: 'rare', reaches: ['post', 'character', 'thread'] })), []);
  assert.match(instanceProblems(withCards({ play: 'set', trap, lasts: day })).join('\n'), /card "splat" has a time up \(lasts\), and only a use card or a card reaching beyond a post does/);
  assert.match(instanceProblems(withCards({ play: 'use', gimmick: ward, lasts: { unit: 'minute', count: 7 } })).join('\n'), /card "splat" lasts .*; it must be a span/);
  assert.deepEqual(instanceProblems(withCards({ rarity: 'uncommon', reaches: ['character'], lasts: { unit: 'hour', count: 36 } })), [], 'a card may last hours');
  assert.match(instanceProblems(withCards({ play: 'deal' })).join('\n'), /card "splat" is played "deal"; a card is cast, used, set or kept/);
});

test('a gimmick is a ward, an earn or a price, each with its numbers', () => {
  const lasts = { unit: 'day', count: 7 };
  const use = (gimmick: unknown) => instanceProblems(withCards({ play: 'use', lasts, gimmick })).join('\n');
  assert.equal(use({ kind: 'ward', flavors: ['salty'] }), '');
  assert.equal(use({ kind: 'ward', cards: ['splat'] }), '');
  assert.match(use({ kind: 'ward' }), /card "splat" has a ward that names no rarity, flavor or card/);
  assert.match(use({ kind: 'ward', upTo: 'mythic' }), /card "splat" has a ward up to "mythic"/);
  assert.match(use({ kind: 'ward', flavors: ['bitter'] }), /card "splat" has a ward of the flavors \["bitter"\]/);
  assert.match(use({ kind: 'sneeze' }), /card "splat" has a gimmick of kind "sneeze"; a gimmick is ward, earn or price/);
  assert.equal(use({ kind: 'earn', quadrants: ['excitedPositive'], by: 0.5 }), '');
  assert.equal(use({ kind: 'earn', reactions: ['fire'], by: 1 }), '');
  assert.match(use({ kind: 'earn', quadrants: ['excitedPositive'], by: 0 }), /card "splat" has an earn of 0; by is above 0 and at most 1/);
  assert.match(use({ kind: 'earn', quadrants: ['excitedPositive'], by: 1.5 }), /card "splat" has an earn of 1.5; by is above 0 and at most 1/);
  assert.match(use({ kind: 'earn', by: 0.5 }), /card "splat" has an earn that names no quadrant and no reaction/);
  assert.match(use({ kind: 'earn', quadrants: ['excitedPositive'] }), /an earn with no by/);
  for (const bad of [[], 'excitedPositive', null]) assert.match(use({ kind: 'earn', quadrants: bad, by: 0.5 }), /card "splat" has an earn naming no quadrant/, JSON.stringify(bad));
  for (const bad of [[], 'fire', null]) assert.match(use({ kind: 'earn', reactions: bad, by: 0.5 }), /card "splat" has an earn naming no reaction/, JSON.stringify(bad));
  for (const bad of [[], [1], ['splat', 2]]) assert.match(use({ kind: 'ward', cards: bad }), /card "splat" has a ward of the cards .*; cards are named by key/, JSON.stringify(bad));
  assert.match(use({ kind: 'earn', reactions: ['laugh'], by: 0.5 }), /card "splat" has an earn naming the reaction "laugh", which the instance does not have/);
  assert.match(use({ kind: 'earn', quadrants: ['spicy'], by: 0.5 }), /card "splat" has an earn naming the quadrant "spicy"/);
  assert.equal(use({ kind: 'price', flavors: ['salty'], add: 100 }), '');
  assert.match(use({ kind: 'price', flavors: ['salty'], add: 0 }), /card "splat" has a price that adds 0; add is a positive whole number/);
  assert.match(use({ kind: 'price', flavors: ['salty'], add: 1.5 }), /card "splat" has a price that adds 1.5; add is a positive whole number/);
  assert.match(use({ kind: 'price', flavors: [], add: 100 }), /card "splat" has a price with no flavors/);
  assert.match(use({ kind: 'price', add: 100 }), /card "splat" has a price with no flavors/);
});

test('a set card springs on a cast or a visit', () => {
  const catches = () => 'splat';
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'cast' } }, catches })), []);
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'visit' } } })), []);
  for (const on of ['sneeze', 'quote', 'reply', 'reaction']) {
    assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on } } })).join('\n'), new RegExp(`card "splat" springs on "${on}"; a set card springs on cast or visit`), on);
  }
  assert.match(instanceProblems(withCards({ play: 'set', trap: {} })).join('\n'), /card "splat" springs on nothing; a set card springs on cast or visit/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: {} } })).join('\n'), /card "splat" springs on nothing; a set card springs on cast or visit/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 5 } } })).join('\n'), /card "splat" springs on 5; a set card springs on cast or visit/);
  assert.match(instanceProblems(withCards({ trap: { trigger: { on: 'quote' } } })).join('\n'), /card "splat" has a trap, and only a set card has one/);
});

test('a cast trap names its card or matches cards, never both; a visit trap does neither', () => {
  const cast = { on: 'cast' };
  const catches = () => 'splat';
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: { flavors: ['salty'], upTo: 'common' } } })), []);
  assert.deepEqual(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: { upTo: 'common' } } })), []);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'visit' } , match: { upTo: 'common' } } })).join('\n'), /card "splat" has a match, and only a set card that springs on a cast does/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: { upTo: 'common' } }, catches })).join('\n'), /card "splat" names a card \(catches\) and has a match; a set card has one of the two/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: {} } })).join('\n'), /card "splat" has a match that names no flavor and no rarity/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: { flavors: [] } } })).join('\n'), /card "splat" has a match of the flavors \[\]; a flavor is/);
  for (const bad of ['salty', 5, null]) assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: bad } })).join('\n'), /card "splat" has a match that is not an object/, String(bad));
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: { upTo: 'mythic' } } })).join('\n'), /card "splat" has a match up to "mythic"/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: cast, match: { flavors: ['bitter'] } } })).join('\n'), /card "splat" has a match of the flavors \["bitter"\]/);
});

test('a cast set card has a catch, and nothing else has one; a phrase is a cast card\'s alone', () => {
  const catches = () => 'splat';
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'cast' } } })).join('\n'), /card "splat" springs on a cast and names no card to catch \(catches\) or match \(match\)/);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'visit' } }, catches })).join('\n'), /card "splat" has a catch, and only a set card that springs on a cast does/);
  assert.match(instanceProblems(withCards({ play: 'set', catches })).join('\n'), /card "splat" has a catch, and only a set card that springs on a cast does/);
  assert.match(instanceProblems(withCards({ catches })).join('\n'), /card "splat" has a catch, and only a set card that springs on a cast does/);
  assert.match(instanceProblems(withCards({ catches: 'splat', play: 'set', trap: { trigger: { on: 'cast' } } })).join('\n'), /card "splat" has a catch that is not a function/);
  const setPhrase = () => 'a phrase';
  assert.deepEqual(instanceProblems(withCards({ setPhrase })), []);
  assert.match(instanceProblems(withCards({ play: 'set', trap: { trigger: { on: 'visit' } }, setPhrase })).join('\n'), /card "splat" has a set phrase, and only a cast card has one/);
  assert.match(instanceProblems(withCards({ play: 'use', setPhrase })).join('\n'), /card "splat" has a set phrase, and only a cast card has one/);
  assert.match(instanceProblems(withCards({ setPhrase: 'a phrase' })).join('\n'), /card "splat" has a set phrase that is not a function/);
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

test('a card that writes reaches a post alone', () => {
  const writes = { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) };
  const lasts = { unit: 'day', count: 1 };
  assert.deepEqual(instanceProblems(withCards({ rarity: 'rare', writes })), []);
  assert.deepEqual(instanceProblems(withCards({ rarity: 'rare', writes, reaches: ['post'] })), []);
  assert.match(instanceProblems(withCards({ rarity: 'rare', writes, reaches: ['character'], lasts })).join('\n'), /card "splat" writes, and a card that writes reaches a post alone/);
  assert.match(instanceProblems(withCards({ rarity: 'rare', writes, reaches: ['post', 'thread'], lasts })).join('\n'), /card "splat" writes, and a card that writes reaches a post alone/);
  assert.match(instanceProblems(withCards({ rarity: 'rare', writes: 'yes' })).join('\n'), /card "splat" has writes that are not a tokens function and a frame function/);
  assert.match(instanceProblems(withCards({ rarity: 'rare', writes, play: 'set', trap: { trigger: { on: 'visit' } } })).join('\n'), /card "splat" writes, and only a cast card does: it is cast face up, never set face down/);
  assert.match(instanceProblems(withCards({ rarity: 'rare', writes, play: 'use', lasts })).join('\n'), /card "splat" writes, and only a cast card does: it is cast face up, never set face down/);
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
  assert.match(instanceProblems(withCards({ reaches: ['post'], lasts: { unit: 'day', count: 1 } })).join('\n'), /card "splat" has a time up \(lasts\), and only a use card or a card reaching beyond a post does/);
});

test('a set card lands on a post alone', () => {
  assert.match(instanceProblems(withCards({ rarity: 'legendary', play: 'set', reaches: ['post', 'board'], lasts: { unit: 'day', count: 1 } })).join('\n'), /card "splat" is a set card, and a set card lands only on a post/);
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

// Packs and the machine's slots (docs/plans/2026-11-04-booster-packs-plan.md, Task 1).
const packCards = [
  testCard({ key: 'a', rarity: 'common' }), testCard({ key: 'b', rarity: 'uncommon' }), testCard({ key: 'c', rarity: 'rare' }),
] as unknown as Instance['cards'];
const stocked = (over: Partial<Instance>): Instance => ({ ...good, cards: packCards, packs: [{ key: 'p', pulls: [{ weights: { common: 1 } }, { weights: { uncommon: 3, rare: 1 } }] }], machine: [{ item: { card: 'a' }, availability: 'onSale', price: 100 }, { item: { pack: 'p' }, availability: 'onSale', price: 300 }], ...over });

test('an instance with packs and slots that agree has no problems', () => {
  assert.deepEqual(instanceProblems(stocked({})), []);
});

test('a pull weight is a positive whole number', () => {
  for (const w of [0, -1, 1.5, Number.NaN]) {
    assert.match(said(stocked({ packs: [{ key: 'p', pulls: [{ weights: { common: w } }] }], machine: [] })), /pack "p".*weight/, String(w));
  }
});

test('a pull naming a rarity with no eligible card is a problem, and a legendary over today\'s cards is one', () => {
  assert.match(said(stocked({ packs: [{ key: 'p', pulls: [{ weights: { legendary: 1 } }] }], machine: [] })), /pack "p".*legendary.*no (eligible )?card/);
  assert.match(said(stocked({ packs: [{ key: 'p', pulls: [{ weights: { common: 1 } }], leaves: ['a'] }], machine: [] })), /pack "p".*common.*no (eligible )?card/);
});

test('a pack has pulls, and leaves only cards that exist', () => {
  assert.match(said(stocked({ packs: [{ key: 'p', pulls: [] }], machine: [] })), /pack "p" has no pulls/);
  assert.match(said(stocked({ packs: [{ key: 'p', pulls: [{ weights: { common: 1 } }], leaves: ['ghost'] }], machine: [] })), /pack "p" leaves out "ghost".*no such card/);
});

test('a pack key is used once', () => {
  const p = { key: 'p', pulls: [{ weights: { common: 1 } }] };
  assert.match(said(stocked({ packs: [p, p], machine: [] })), /pack key "p" is used twice/);
});

test('a slot names a card or a pack the instance has, once', () => {
  assert.match(said(stocked({ machine: [{ item: { card: 'ghost' }, availability: 'onSale', price: 100 }] })), /slot.*card "ghost".*no such card/);
  assert.match(said(stocked({ machine: [{ item: { pack: 'ghost' }, availability: 'onSale', price: 100 }] })), /slot.*pack "ghost".*no such pack/);
  const twice = [{ item: { card: 'a' }, availability: 'onSale' as const, price: 100 }, { item: { card: 'a' }, availability: 'hidden' as const, price: 50 }];
  assert.match(said(stocked({ machine: twice })), /two slots.*card "a"/);
});

test('a slot\'s price is a positive whole number at most INT4_MAX', () => {
  for (const price of [0, -5, 2.5, 2 ** 31, Number.NaN]) {
    assert.match(said(stocked({ machine: [{ item: { card: 'a' }, availability: 'onSale', price }] })), /slot.*price/, String(price));
  }
  assert.deepEqual(instanceProblems(stocked({ machine: [{ item: { card: 'a' }, availability: 'onSale', price: 2 ** 31 - 1 }] })), []);
  assert.match(said(stocked({ machine: [{ item: { card: 'a' }, availability: 'sometimes' as never, price: 1 }] })), /slot.*availability/);
});

/* ------------------------------------------------------------------------------------- Pronouns ---- */

test('the pronouns setting is held by pronounProblems', () => {
  assert.deepEqual(settingsProblems(settings), []);
  assert.match(settingsProblems({ ...settings, pronouns: { ...PRONOUN_PRESETS.it, subject: 'it ' } }).join('\n'), /setting "pronouns".*subject holds a space/);
  assert.match(settingsProblems({ ...settings, pronouns: 'it' as never }).join('\n'), /setting "pronouns"/);
  assert.match(settingsProblems({ ...settings, pronouns: undefined } as never).join('\n'), /setting "pronouns" is missing/);
});

test('a persona or the developer with a bad pronoun set is named; a good or missing one is not', () => {
  assert.deepEqual(instanceProblems(withBot({ pronouns: PRONOUN_PRESETS.she })), []);
  assert.match(said(withBot({ pronouns: { ...PRONOUN_PRESETS.she, reflexive: 'x3' } })), /persona "bot-a".*reflexive holds a character that is not a letter/);
  assert.match(said(withBoss({ pronouns: { subject: 'a' } as never })), /persona "boss-a".*no object/);
  assert.match(said({ ...good, developer: { name: 'Gabe', tagline: '', pronouns: { ...PRONOUN_PRESETS.he, plural: 'yes' as never } } }), /developer.*plural is not true or false/);
  assert.deepEqual(instanceProblems({ ...good, developer: { name: 'Gabe', tagline: '', pronouns: PRONOUN_PRESETS.he } }), []);
});

test('a stock line may use a staff token\'s pronoun forms and no other token\'s', () => {
  const line = (key: 'visitFiled' | 'moveMet' | 'reportDismissed', text: string) => withSystem({ stockLines: { ...system.stockLines, [key]: [text] } });
  assert.deepEqual(instanceProblems(line('visitFiled', '{mod} forgot how {mod.they} felt; {mod.They} {mod.is} sorry, {mod.Their} {mod.themself} watch{mod.s}.')), []);
  assert.match(said(line('reportDismissed', 'Sorry, {reporter.they}.')), /stock line "reportDismissed".*\{reporter\.they\}/);
  assert.match(said(line('visitFiled', '{mod.thei} left.')), /stock line "visitFiled".*\{mod\.thei\}.*one of: they, They, them/);
  assert.match(said(line('moveMet', '{boss.they} won.')), /stock line "moveMet".*\{boss\.they\}/);
  assert.match(said(line('visitFiled', '{rule.they}')), /\{rule\.they\}/);
  assert.deepEqual(instanceProblems(line('visitFiled', '{mod} filed it.')), []);
  assert.match(said(line('visitFiled', '{mod.} left.')), /stock line "visitFiled".*\{mod\.\}/);
  assert.match(said(line('visitFiled', '{mod.they.x} left.')), /stock line "visitFiled".*\{mod\.they\.x\}/);
});

test('a scrubWords entry that is empty or not lower case is a problem', () => {
  const withWords = (scrubWords: string[]) => ({ ...good, system: { ...system, scrubWords } }) as Instance;
  assert.deepEqual(instanceProblems(withWords(['badword', 'two words'])), []);
  assert.match(instanceProblems(withWords(['badword', ''])).join('\n'), /scrubWords entry is empty/);
  assert.match(instanceProblems(withWords(['  '])).join('\n'), /scrubWords entry is empty/);
  assert.match(instanceProblems(withWords(['BadWord'])).join('\n'), /scrubWords entry "BadWord" is not lower case/);
  assert.match(instanceProblems({ ...good, system: { ...system, scrubWords: undefined } } as unknown as Instance).join('\n'), /no system\.scrubWords list/);
});


/* ------------------------------------------------------------------------ arcs: beats, conditions, held-back kinds ---- */

const split = {
  key: 'split',
  unlock: [{ kind: 'phase', phase: 'reign' }],
  due: { phase: 'reign', daysIntoPhase: 7 },
  brief: 'Make two boards.',
  bundle: {
    name: 'The Split',
    parts: [
      { role: 'minus', kind: 'createBoard', params: { name: 'World -1', premise: 'Everything else.', description: 'Not fangames.' } },
      { role: 'fangames', kind: 'createBoard', params: {}, slots: { name: { default: 'Palace', hint: 'a board name' } } },
    ],
  },
} as const;
const picking = { key: 'picking-apart', unlock: [{ kind: 'beatLanded', beat: 'split' }], brief: 'Move threads.' } as const;
const everything = {
  key: 'everything',
  unlock: [{ kind: 'phase', daysBeforeEnd: 7 }, { kind: 'beatLanded', beat: 'split' }],
  due: { daysBeforeEnd: 2 },
  brief: 'Merge it all.',
  bundle: { name: 'Everything', parts: [{ role: 'final', kind: 'mergeBoard', params: { board: { role: 'fangames', beat: 'split' }, into: { role: 'minus', beat: 'split' } } }] },
} as const;
const lap = {
  key: 'victory-lap',
  unlock: [{ kind: 'boardActivity', board: { role: 'fangames', beat: 'split' }, days: 7, above: { role: 'minus', beat: 'split' } }],
  brief: 'Tidy.',
} as const;
const arcFields = {
  arc: [split, picking, everything],
  miniArcs: [lap],
  holdsBack: [{ kind: 'createBoard', until: 'split' }, { kind: 'moveThread', until: 'picking-apart' }],
} as unknown as Partial<Persona>;
const arcOf = (change: Record<string, unknown>) => said(withBoss({ ...arcFields, ...change } as Partial<Persona>));
const arcWith = (arc: unknown[], extra: Record<string, unknown> = {}) => arcOf({ arc, ...extra });

test('a persona with an arc, a mini-arc and held-back kinds passes; one with none runs as every persona does', () => {
  assert.deepEqual(instanceProblems(withBoss(arcFields)), []);
  assert.deepEqual(instanceProblems(withBoss({})), []);
});

test('two beats with one key are a problem, across the arc and the mini-arcs', () => {
  assert.match(arcWith([split, { ...picking, key: 'split' }]), /persona "boss-a".*beat "split" is used twice.*\(isUnique\)/);
  assert.match(arcOf({ miniArcs: [{ ...lap, key: 'split' }] }), /persona "boss-a".*beat "split" is used twice.*\(isUnique\)/);
});

test('a beat key is a lowercase key, and a beat needs a brief and an unlock', () => {
  assert.match(arcWith([{ ...split, key: 'The Split' }]), /persona "boss-a".*beat "The Split".*\(isKey\)/);
  assert.match(arcWith([{ ...split, brief: ' ' }]), /persona "boss-a".*beat "split".*brief.*\(required\)/);
  assert.match(arcWith([{ ...split, unlock: [] }]), /persona "boss-a".*beat "split".*unlock.*\(atLeast\(1\)\)/);
});

test('a beat whose condition key is unknown is a problem naming the key and the list', () => {
  assert.match(arcWith([{ ...split, unlock: [{ kind: 'fullMoon' }] }]), /persona "boss-a".*beat "split".*unlock 1.*"fullMoon".*\(oneOf\(phase, beatLanded, boardActivity, moveReversed, demandResolved\)\)/);
  assert.match(arcWith([{ ...split, unlock: [{ kind: 'demandResolved', outcome: 'late' }] }]), /persona "boss-a".*beat "split".*unlock 1.*\(oneOf\(met, failed\)\)/);
});

test('a beatLanded that names no beat of the persona, itself or a later beat is a problem', () => {
  assert.match(arcWith([split, { ...picking, unlock: [{ kind: 'beatLanded', beat: 'ghost' }] }]), /persona "boss-a".*beat "picking-apart".*"ghost".*\(beatOfPersona\)/);
  assert.match(arcWith([split, { ...picking, unlock: [{ kind: 'beatLanded', beat: 'picking-apart' }] }]), /persona "boss-a".*beat "picking-apart".*\(earlierBeat\)/);
  assert.match(arcWith([{ ...split, unlock: [{ kind: 'beatLanded', beat: 'picking-apart' }] }, picking]), /persona "boss-a".*beat "split".*"picking-apart".*\(earlierBeat\)/);
});

test('a bundle template part whose kind is not in the catalog is a problem', () => {
  const bundle = { ...split.bundle, parts: [{ ...split.bundle.parts[0], kind: 'burnBoard' }, split.bundle.parts[1]] };
  assert.match(arcWith([{ ...split, bundle }]), /persona "boss-a".*beat "split".*part "minus".*"burnBoard".*\(oneOf\(renameBoard, .*createBoard.*\)\)/);
});

test('a role used and never made is a problem: in its bundle, or from another beat', () => {
  const lost = { ...split, bundle: { ...split.bundle, parts: [{ ...split.bundle.parts[0], params: { ...split.bundle.parts[0].params, board: { role: 'nowhere' } } }, split.bundle.parts[1]] } };
  assert.match(arcWith([lost]), /persona "boss-a".*beat "split".*part "minus".*role "nowhere".*\(roleMade\)/);
  // A part names the parts before it only: the role is made by a later part.
  const later = { ...split, bundle: { ...split.bundle, parts: [{ role: 'a', kind: 'mergeBoard', params: { board: { role: 'b' }, into: { role: 'b' } } }, { role: 'b', kind: 'createBoard', params: {} }] } };
  assert.match(arcWith([later]), /persona "boss-a".*beat "split".*part "a".*role "b".*\(roleMade\)/);
  // {role, beat}: the beat must be an earlier one of the persona's with a bundle that has the role.
  const wrongRole = { ...everything, bundle: { ...everything.bundle, parts: [{ role: 'final', kind: 'mergeBoard', params: { board: { role: 'fangames', beat: 'split' }, into: { role: 'void', beat: 'split' } } }] } };
  assert.match(arcWith([split, picking, wrongRole]), /persona "boss-a".*beat "everything".*role "void".*beat "split".*\(roleMade\)/);
  assert.match(arcWith([split, { ...picking, unlock: [{ kind: 'boardActivity', board: { role: 'fangames', beat: 'picking-apart' }, days: 7, above: 1 }] }]), /persona "boss-a".*beat "picking-apart".*role "fangames".*beat "picking-apart".*\(roleMade\)/);
  assert.match(arcOf({ miniArcs: [{ ...lap, unlock: [{ kind: 'boardActivity', board: { role: 'fangames', beat: 'ghost' }, days: 7, above: 1 }] }] }), /persona "boss-a".*beat "victory-lap".*beat "ghost".*\(beatOfPersona\)/);
});

test('a role made twice in one bundle is a problem', () => {
  const twice = { ...split, bundle: { ...split.bundle, parts: [split.bundle.parts[0], { ...split.bundle.parts[1], role: 'minus' }] } };
  assert.match(arcWith([twice]), /persona "boss-a".*beat "split".*role "minus" is used twice.*\(isUnique\)/);
});

test('a slot that is also a fixed param is a problem', () => {
  const both = { ...split, bundle: { ...split.bundle, parts: [split.bundle.parts[0], { ...split.bundle.parts[1], params: { name: 'Fixed' } }] } };
  assert.match(arcWith([both]), /persona "boss-a".*beat "split".*part "fangames".*slot "name".*\(notFixed\)/);
});

test('holdsBack naming an unknown kind or an unknown beat is a problem', () => {
  assert.match(arcOf({ holdsBack: [{ kind: 'burnBoard', until: 'split' }] }), /persona "boss-a".*holdsBack.*"burnBoard".*\(oneOf\(renameBoard, .*createBoard.*\)\)/);
  assert.match(arcOf({ holdsBack: [{ kind: 'createBoard', until: 'ghost' }] }), /persona "boss-a".*holdsBack.*"createBoard".*"ghost".*\(beatOfPersona\)/);
  assert.match(arcOf({ holdsBack: [{ kind: 'createBoard', until: 'split' }, { kind: 'createBoard', until: 'picking-apart' }] }), /persona "boss-a".*holdsBack.*"createBoard".*twice.*\(isUnique\)/);
});

test('a due point on a mini-arc is a problem, and so is repeatable on an arc beat', () => {
  assert.match(arcOf({ miniArcs: [{ ...lap, due: { daysBeforeEnd: 2 } }] }), /persona "boss-a".*beat "victory-lap".*mini-arc.*due.*\(noDueOnMiniArc\)/);
  assert.match(arcWith([{ ...split, repeatable: true }]), /persona "boss-a".*beat "split".*repeatable.*\(miniArcOnly\)/);
  assert.deepEqual(instanceProblems(withBoss({ ...arcFields, miniArcs: [{ ...lap, repeatable: true }] } as Partial<Persona>)), []);
});

test('a due point is held to its shape', () => {
  assert.match(arcWith([{ ...split, due: {} }]), /persona "boss-a".*beat "split".*due.*\(atLeastOneOf\(phase, daysIntoPhase, daysBeforeEnd\)\)/);
  assert.match(arcWith([{ ...split, due: { daysIntoPhase: 3 } }]), /persona "boss-a".*beat "split".*due.*\(requires\(phase\)\)/);
});

test('an authored bundle over bundleAuthoredMostParts is a problem, and a persona has a bounded number of beats', () => {
  const part = (i: number) => ({ role: `p${i}`, kind: 'createBoard', params: {} });
  const nine = { ...split, bundle: { name: 'Nine', parts: Array.from({ length: 9 }, (_, i) => part(i)) } };
  assert.match(arcWith([nine]), /persona "boss-a".*beat "split".*9 parts.*\(atMost\(8\)\)/);
  const eight = { ...split, bundle: { name: 'Eight', parts: Array.from({ length: 8 }, (_, i) => part(i)) } };
  assert.deepEqual(instanceProblems(withBoss({ ...arcFields, arc: [eight], miniArcs: [], holdsBack: [] } as Partial<Persona>)), []);
  const many = Array.from({ length: 25 }, (_, i) => ({ ...picking, key: `b${i}`, unlock: [{ kind: 'phase', phase: 'reign' }] }));
  assert.match(arcWith(many, { miniArcs: [], holdsBack: [] }), /persona "boss-a".*25 beats.*\(atMost\(24\)\)/);
});
