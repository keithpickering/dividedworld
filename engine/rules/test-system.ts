/**
 * The System's part of a test fixture: the settings and the content an `Instance` now carries, for
 * tests that build an instance of their own to test something else (the settlement, an action).
 * They say nothing about any real instance, and `instance.test.ts` builds its own to test these.
 */
import { PRONOUN_PRESETS } from './pronouns.ts';
import type { Instance, Settings, SystemContent } from './types.ts';
import type { GroupsContent } from './groups.ts';
import { STOCK_LINE_KEYS } from '../system/stock.ts';
import { DEFAULT_STRENGTHS } from '../system/pool.ts';

/** The pool's settings as a test world holds them. */
export const testPool: Settings['pool'] = {
  weekly: 20, holdback: 0.2, threadsWeekly: 1, cardRarityMost: 'common', priorityDays: 28, notesRead: 12, chatterThreadPosts: 8, strengths: { ...DEFAULT_STRENGTHS }, chatterCron: '37 17 * * *',
};

/** The Mod Bots' numbers as a test world holds them. */
export const testModBots: Settings['modBots'] = { allowanceMost: 3, ruleDaysMost: 7, visitHours: { least: 2, most: 12 }, patrolsPerDay: 6, patrolSample: 5, reportPrice: 25, reportsPerDay: 3, judgmentsPerDay: 60, filingLinesPerDay: 60, appealPrice: 50, tailHours: 24, cap: { punishments: 3, days: 7 }, filingCron: '*/5 * * * *', filingGraceMinutes: 10 };

export const testWarnBar: Settings['warnBar'] = { size: 10, bands: { minor: 2, moderate: 4, severe: 7 }, decay: { unit: 'day', count: 14 }, banDays: [1, 3, 7] };

/** The apology's numbers as a test world holds them. */
export const testApologySettings: Settings['apology'] = { apologyEveryHours: 24, apologyJudgeBatch: 10, apologyRulingMaxWords: 80 };

/** The cosmetics content of a test world that has none: no gear, a catalog of three places and a demand, no event lines. */
export const testCosmeticsContent: Pick<Instance, 'gear' | 'trophies' | 'events'> = {
  gear: [],
  trophies: { kinds: [{ key: 'p1', name: 'P1' }, { key: 'p2', name: 'P2' }, { key: 'p3', name: 'P3' }, { key: 'met', name: 'Met' }], seasonPlaces: ['p1', 'p2', 'p3'], boss: [], demandMet: 'met' },
  events: { lines: [] },
};

export const systemSettings: Pick<Settings, 'modBots' | 'warnBar' | 'apology' | 'conduct' | 'systemEnabled' | 'oldVoice' | 'cardWriteSettleSeconds' | 'pronouns' | 'meetingCron' | 'phases' | 'inheritanceGraceDays' | 'rosterRecentExcluded' | 'structuralHoldHours' | 'microEventDailyCalls' | 'digestThreads' | 'digestBoards' | 'digestBoardDays' | 'movedStubDays' | 'farewellWindowHours' | 'bundleMostParts' | 'bundleAuthoredMostParts' | 'digestExcerpts' | 'digestExcerptChars' | 'memoryOpinions' | 'memoryGrudges' | 'memoryWheelhouse' | 'memoryRealWorld' | 'pool' | 'boardNameMaxLength' | 'moveExpiryMostDays' | 'moveExpiryLeastHours' | 'demandCheckMinutes' | 'demandChecksPerTick' | 'modelTiers' | 'cosmetics'> = {
  systemEnabled: false,
  oldVoice: true,
  cardWriteSettleSeconds: 30,
  conduct: { openReportsMost: 3, adminAddress: null },
  pronouns: PRONOUN_PRESETS.it,
  meetingCron: '23 9 * * *',
  phases: {
    honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
    reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
    meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
  },
  inheritanceGraceDays: 3, rosterRecentExcluded: 2, structuralHoldHours: 24, microEventDailyCalls: 20, digestThreads: 10, digestBoards: 30, digestBoardDays: 21, movedStubDays: 7, farewellWindowHours: 36, bundleMostParts: 4, bundleAuthoredMostParts: 8, digestExcerpts: 8,
  digestExcerptChars: 280, memoryOpinions: 40, memoryGrudges: 20, memoryWheelhouse: 30, memoryRealWorld: 30, pool: testPool, modBots: testModBots, warnBar: testWarnBar, apology: testApologySettings, boardNameMaxLength: 60, moveExpiryMostDays: 42, moveExpiryLeastHours: 24, demandCheckMinutes: 5, demandChecksPerTick: 40,
  modelTiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' },
  cosmetics: { gear: { wornMost: 12, reach: 0.4 }, trophies: { shownMost: 3 }, events: { windowMinutes: 15, dayMost: 4, outcomes: { line: 70, gear: 20, card: 10 }, gearRarity: { common: 80, uncommon: 17, rare: 3 }, cardRarity: { common: 80, uncommon: 17, rare: 3 } } },
};

const botFields = {
  beats: [], petRules: [], strictness: { visitHours: { least: 2, most: 12 }, bands: [] }, weakness: { kind: 'distraction' }, voice: 'chat', persuadedBy: 'Pedantry.',
} as const;

export const testSystem: SystemContent = {
  roster: [
    { key: 'boss-a', name: 'Boss A', title: 'The Boss', signature: 'Hi.', selfPrompt: 'You are a boss.', officeLines: { boss: 'You run the place.', member: 'You used to run the place.' }, startingHobby: 'tomatoes', temperament: 'petty', ...botFields },
    { key: 'bot-a', name: 'Bot A', title: 'Hall monitor', signature: 'Walk.', selfPrompt: 'You are a bot.', startingHobby: 'clipboards', temperament: 'earnest', ...botFields },
  ],
  firstBoss: 'boss-a',
  announcementsTitle: 'Announcements',
  firstStaff: ['bot-a'],
  duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'boss', chatter: 'boss', filing: 'beat', reportJudge: 'beat', patrolJudge: 'beat', apologyJudge: 'beat' },
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, ['A line.']])) as unknown as SystemContent['stockLines'],
  feeds: [], realWorld: [], scrubWords: ['badword'], wheelhouse: [],
  nameStyle: () => [],
  nameStyleBrief: 'any name',
  offices: {
    boss: { premise: 'Boss premise.', answerRules: 'Boss rules.' },
    mod: { premise: 'Mod premise.', answerRules: 'Mod rules.' },
    member: { premise: 'Member premise.', answerRules: 'Member rules.' },
  },
};

/** A small valid `groups` for test fakes of an `Instance`: a default rung and a staff rung. */
export const testGroups: GroupsContent = {
  ladder: [{ key: 'members', name: 'Members', color: '#7a7a7a', when: { kind: 'default' } }, { key: 'staff', name: 'Test Cores', color: '#d4a017', when: { kind: 'staff' } }],
  conferred: [
    { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, tone: 'punishment' },
    { key: 'teachersPet', name: 'Teacher\'s Pet', color: '#c2408f', tone: 'favor' },
  ],
};
