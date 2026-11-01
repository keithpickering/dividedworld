/**
 * The System's part of a test fixture: the settings and the content an `Instance` now carries, for
 * tests that build an instance of their own to test something else (the settlement, an action).
 * They say nothing about any real instance, and `instance.test.ts` builds its own to test these.
 */
import type { Settings, SystemContent } from './types.ts';
import { STOCK_LINE_KEYS } from '../system/stock.ts';

export const systemSettings: Pick<Settings, 'systemEnabled' | 'meetingCron' | 'phases' | 'inheritanceGraceDays' | 'rosterRecentExcluded' | 'structuralHoldHours' | 'microEventDailyCalls' | 'digestThreads' | 'digestExcerpts' | 'digestExcerptChars' | 'memoryOpinions' | 'memoryGrudges' | 'memoryWheelhouse' | 'memoryRealWorld' | 'boardNameMaxLength' | 'moveExpiryMostDays' | 'moveExpiryLeastHours' | 'modelTiers'> = {
  systemEnabled: false,
  meetingCron: '23 9 * * *',
  phases: {
    honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
    reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
    meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
  },
  inheritanceGraceDays: 3, rosterRecentExcluded: 2, structuralHoldHours: 24, microEventDailyCalls: 20, digestThreads: 10, digestExcerpts: 8,
  digestExcerptChars: 280, memoryOpinions: 40, memoryGrudges: 20, memoryWheelhouse: 30, memoryRealWorld: 30, boardNameMaxLength: 60, moveExpiryMostDays: 42, moveExpiryLeastHours: 24,
  modelTiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' },
};

export const testSystem: SystemContent = {
  bosses: [{ key: 'boss-a', name: 'Boss A', title: 'The Boss', signature: 'Hi.', persona: 'You are a boss.', startingHobby: 'tomatoes', temperament: 'petty' }],
  firstBoss: 'boss-a',
  modBots: [{
    key: 'bot-a', name: 'Bot A', title: 'Hall monitor', signature: 'Walk.', persona: 'You are a bot.', beats: [], petRules: [],
    strictness: { visitHours: { least: 2, most: 12 }, bands: [] }, weakness: { kind: 'distraction' }, voice: 'chat', persuadedBy: 'Pedantry.',
  }],
  firstStaff: ['bot-a'],
  duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'boss' },
  stockLines: Object.fromEntries(STOCK_LINE_KEYS.map((k) => [k, ['A line.']])) as unknown as SystemContent['stockLines'],
  feeds: [], realWorld: [], wheelhouse: [],
  oldVoice: () => ({ prompt: '', stop: [] }),
  nameStyle: () => [],
};
