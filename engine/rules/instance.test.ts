import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIBE_BOUNDS, deepFreeze, instanceProblems, settingsProblems, withOverrides } from './instance.ts';
import type { Instance, ModBotPersona, Settings, SystemContent } from './types.ts';
import { PHASE_CAPS } from '../system/phases.ts';
import { DUTIES } from '../system/duties.ts';
import { STOCK_LINE_KEYS } from '../system/stock.ts';

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
  boardNameMaxLength: 60,
  moveExpiryMostDays: 42,
  moveExpiryLeastHours: 24,
  modelTiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' },
};

const bot: ModBotPersona = {
  key: 'bot-a', name: 'Bot A', title: 'Hall monitor', signature: 'Walk.', persona: 'You are a bot.', beats: ['general'], petRules: ['noBump'],
  strictness: { visitHours: { least: 2, most: 12 }, bands: ['small'] },
  weakness: { kind: 'quiz', questions: [{ question: 'Which is a number?', choices: ['one', 'cat'], answer: 'one' }] },
  voice: 'chat', persuadedBy: 'Pedantry.',
};

const system: SystemContent = {
  bosses: [{ key: 'boss-a', name: 'Boss A', title: 'The Boss', signature: 'Hi.', persona: 'You are a boss.', startingHobby: 'tomatoes', temperament: 'petty' }],
  firstBoss: 'boss-a',
  modBots: [bot],
  firstStaff: ['bot-a'],
  duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'beat' },
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, ['A line.']])) as unknown as SystemContent['stockLines'],
  feeds: [],
  realWorld: ['politics'],
  wheelhouse: ['games'],
  oldVoice: ({ name }) => ({ prompt: `Board: ${name}\nDescription:`, stop: ['\n'] }),
  nameStyle: () => [],
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
  const card = (stack: unknown) => ({ ...good, cards: [{ key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.price', stack, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] }) as unknown as Instance;
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
  const card = (screenReads: unknown) => ({ ...good, cards: [{ key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.price', screenReads, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) }] }) as unknown as Instance;
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
  const card = { key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }) };
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

/* ------------------------------------------------------------------------ The System's content ---- */

const withSystem = (change: Partial<SystemContent>): Instance => ({ ...good, system: { ...system, ...change } });
const withBot = (change: Partial<ModBotPersona>): Instance => withSystem({ modBots: [{ ...bot, ...change }] });
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

test('firstBoss must be in the roster, and the roster must hold a Boss', () => {
  assert.match(said(withSystem({ firstBoss: 'nobody' })), /firstBoss "nobody"/);
  assert.match(said(withSystem({ bosses: [], firstBoss: 'boss-a' })), /no Boss/);
});

test('firstStaff must hold at least one key', () => {
  assert.match(said(withSystem({ firstStaff: [] })), /firstStaff.*at least one/);
});

test('every firstStaff key must be a Mod Bot, and a Boss\'s key is not', () => {
  assert.match(said(withSystem({ firstStaff: ['bot-a', 'ghost'] })), /firstStaff.*"ghost"/);
  assert.match(said(withSystem({ firstStaff: ['bot-a', 'boss-a'] })), /firstStaff.*"boss-a"/);
});

test('a key shared by a Boss and a bot is a problem, and so is one used twice in a roster', () => {
  assert.match(said(withBot({ key: 'boss-a' })), /"boss-a" is both a Boss and a Mod Bot/);
  assert.match(said(withSystem({ bosses: [system.bosses[0]!, system.bosses[0]!] })), /Boss key "boss-a" is used twice/);
  assert.match(said(withSystem({ modBots: [bot, bot] })), /Mod Bot key "bot-a" is used twice/);
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
  const boss = (phases: NonNullable<SystemContent['bosses'][number]['phases']>) => withSystem({ bosses: [{ ...system.bosses[0]!, phases }] });
  assert.match(said(boss({ reign: { weeklyMoves: PHASE_CAPS.reign.weeklyMoves + 1 } })), /Boss "boss-a".*reign.*weeklyMoves/);
  assert.match(said(boss({ reign: { bankCap: 0 } })), /Boss "boss-a".*reign.*bankCap/);
  assert.deepEqual(instanceProblems(boss({ reign: { weeklyMoves: PHASE_CAPS.reign.weeklyMoves }, honeymoon: { days: 7 } })), []);
});

test('a Boss that inherits the memory of a Boss that is not in the roster, or of itself, is a problem', () => {
  const boss = (inheritsMemoryOf: string) => withSystem({ bosses: [{ ...system.bosses[0]!, inheritsMemoryOf }] });
  assert.match(said(boss('ghost')), /"boss-a" inherits the memory of "ghost"/);
  assert.match(said(boss('boss-a')), /"boss-a" inherits the memory of "boss-a"/);
});

test('a title over 40 characters or a signature over 500 is a problem, for a Boss and for a bot (the seed cuts them in silence)', () => {
  assert.match(said(withSystem({ bosses: [{ ...system.bosses[0]!, title: 'x'.repeat(41) }] })), /Boss "boss-a".*title.*41.*at most 40/);
  assert.match(said(withSystem({ bosses: [{ ...system.bosses[0]!, signature: 'x'.repeat(501) }] })), /Boss "boss-a".*signature.*501.*at most 500/);
  assert.match(said(withBot({ title: 'x'.repeat(41) })), /Mod Bot "bot-a".*title/);
  assert.match(said(withBot({ signature: 'x'.repeat(501) })), /Mod Bot "bot-a".*signature/);
  assert.deepEqual(instanceProblems(withBot({ title: 'x'.repeat(40), signature: 'x'.repeat(500) })), []);
});

test('a staff member needs a name, a title and a persona', () => {
  assert.match(said(withBot({ name: ' ' })), /Mod Bot "bot-a" has no name/);
  assert.match(said(withBot({ persona: '' })), /Mod Bot "bot-a" has no persona/);
  assert.match(said(withSystem({ bosses: [{ ...system.bosses[0]!, title: '' }] })), /Boss "boss-a" has no title/);
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
  for (const k of ['inheritanceGraceDays', 'rosterRecentExcluded', 'structuralHoldHours', 'microEventDailyCalls', 'digestThreads', 'digestExcerpts', 'digestExcerptChars', 'boardNameMaxLength', 'moveExpiryMostDays', 'moveExpiryLeastHours']) {
    assert.match(bad(k, -1), new RegExp(k), k);
    assert.match(bad(k, 1.5), new RegExp(k), k);
  }
  assert.match(bad('modelTiers', { strong: 'a' }), /modelTiers/);
  assert.match(bad('modelTiers', { strong: 'a', light: '' }), /modelTiers/);
  assert.deepEqual(settingsProblems({ ...settings, microEventDailyCalls: 0, rosterRecentExcluded: 0, inheritanceGraceDays: 0 }), [], 'zero is allowed where it means none');
});
