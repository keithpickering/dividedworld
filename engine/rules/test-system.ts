/**
 * The System's part of a test fixture: the settings and the content an `Instance` now carries, for
 * tests that build an instance of their own to test something else (the settlement, an action).
 * They say nothing about any real instance, and `instance.test.ts` builds its own to test these.
 */
import type { Settings, SystemContent } from './types.ts';
import { STOCK_LINE_KEYS } from '../system/stock.ts';
import { DEFAULT_STRENGTHS } from '../system/pool.ts';

/** The pool's settings as a test world holds them. */
export const testPool: Settings['pool'] = {
  weekly: 20, holdback: 0.2, threadsWeekly: 1, cardRarityMost: 'common', priorityDays: 28, notesRead: 12, chatterThreadPosts: 8, strengths: { ...DEFAULT_STRENGTHS }, chatterCron: '37 17 * * *',
};

/** The Mod Bots' numbers as a test world holds them. */
export const testModBots: Settings['modBots'] = { allowanceMost: 3, ruleDaysMost: 7, visitHours: { least: 2, most: 12 }, patrolsPerDay: 6, patrolSample: 5, reportPrice: 25, reportsPerDay: 3, judgmentsPerDay: 60, filingLinesPerDay: 60, appealPrice: 50, tailHours: 24, cap: { punishments: 3, days: 7 }, filingCron: '*/5 * * * *', filingGraceMinutes: 10 };

export const testWarnBar: Settings['warnBar'] = { size: 10, bands: { minor: 2, moderate: 4, severe: 7 }, decay: { unit: 'day', count: 14 }, banDays: [1, 3, 7] };

export const systemSettings: Pick<Settings, 'modBots' | 'warnBar' | 'systemEnabled' | 'meetingCron' | 'phases' | 'inheritanceGraceDays' | 'rosterRecentExcluded' | 'structuralHoldHours' | 'microEventDailyCalls' | 'digestThreads' | 'digestExcerpts' | 'digestExcerptChars' | 'memoryOpinions' | 'memoryGrudges' | 'memoryWheelhouse' | 'memoryRealWorld' | 'pool' | 'boardNameMaxLength' | 'moveExpiryMostDays' | 'moveExpiryLeastHours' | 'demandCheckMinutes' | 'demandChecksPerTick' | 'modelTiers'> = {
  systemEnabled: false,
  meetingCron: '23 9 * * *',
  phases: {
    honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
    reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
    meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
  },
  inheritanceGraceDays: 3, rosterRecentExcluded: 2, structuralHoldHours: 24, microEventDailyCalls: 20, digestThreads: 10, digestExcerpts: 8,
  digestExcerptChars: 280, memoryOpinions: 40, memoryGrudges: 20, memoryWheelhouse: 30, memoryRealWorld: 30, pool: testPool, modBots: testModBots, warnBar: testWarnBar, boardNameMaxLength: 60, moveExpiryMostDays: 42, moveExpiryLeastHours: 24, demandCheckMinutes: 5, demandChecksPerTick: 40,
  modelTiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' },
};

const botFields = {
  beats: [], petRules: [], strictness: { visitHours: { least: 2, most: 12 }, bands: [] }, weakness: { kind: 'distraction' }, voice: 'chat', persuadedBy: 'Pedantry.',
} as const;

export const testSystem: SystemContent = {
  roster: [
    { key: 'boss-a', name: 'Boss A', title: 'The Boss', signature: 'Hi.', persona: 'You are a boss.', startingHobby: 'tomatoes', temperament: 'petty', ...botFields },
    { key: 'bot-a', name: 'Bot A', title: 'Hall monitor', signature: 'Walk.', persona: 'You are a bot.', startingHobby: 'clipboards', temperament: 'earnest', ...botFields },
  ],
  staffGroup: { name: 'Test Cores' },
  firstBoss: 'boss-a',
  announcementsTitle: 'Announcements',
  firstStaff: ['bot-a'],
  duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'boss', chatter: 'boss' },
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, ['A line.']])) as unknown as SystemContent['stockLines'],
  feeds: [], realWorld: [], wheelhouse: [],
  nameStyle: () => [],
  nameStyleBrief: 'any name',
};
