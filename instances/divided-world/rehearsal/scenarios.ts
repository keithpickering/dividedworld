/**
 * Divided World's rehearsal scenarios (docs/plans/2026-11-11-system-rehearsal-design.md, section 7).
 *
 * The season is three months (`seasonLength` in ../settings.ts), taken as 90 days. Day 1 of the season is its first
 * day, so the season ends as day 91 begins. `meltdown-handover` puts day 1 of the run eight days before that end:
 * 91 - 8 = day 83 of the season, so the run's seven days are days 83 to 89 and its last tick is inside the final day
 * (the meltdown's last week, with the successor window beside it). A real season is 89 to 92 days; the rehearsal's
 * setup dates the season from the scenario's `dayOfSeason`, so the figure is the one it works from.
 *
 * Starting memories name characters by their sketch's name; setup resolves them to the cast's character ids.
 */
import type { Memory } from '../../../engine/system/memory.ts';
import type { Scenario } from '../../../engine/rehearsal/types.ts';

const SEASON_DAYS = 90;

const meltdownMemory: Memory = {
  hobby: { name: 'collecting unfinished fan projects', since: 'day 61', from: 'Sleepyfig, who keeps posting about games nobody finished' },
  opinions: [
    { character: 'Toadstool Annie', score: 4, note: 'Runs the contest and keeps the board civil. Suspiciously helpful.' },
    { character: 'Sodapop Rex', score: -3, note: 'Contradicts everyone on principle. Entertaining, and a problem.' },
    { character: 'Zephyrgoat', score: 2, note: 'Posts glitch guides I actually use.' },
  ],
  grudges: [
    { character: 'Gravelbyte', note: 'Called my last ruling lazy in front of the whole board.' },
    { character: 'Cobaltpretzel', note: 'Said my favorite game was overrated and has not taken it back.' },
    { character: 'Waffleknight', note: 'Promised a release date three weeks running and never delivered.' },
  ],
  wheelhouse: ['Mario fangames and the people who make them', 'the Minus World and glitches that let you go where you should not', 'speedrunning and the tricks behind it'],
  realWorld: ['real-world politics', 'anyone\'s real name or workplace'],
  marks: [],
};

export const scenarios: readonly Scenario[] = [
  {
    key: 'small-circle-reign',
    seed: 1301,
    players: 8,
    charactersPerPlayer: { least: 2, most: 3 },
    startThreads: 6,
    backstoryDays: 3,
    dayOfSeason: 30,
    days: 7,
    postsPerDay: { least: 10, most: 25 },
    reactionsPerPost: { least: 0, most: 3 },
    costCapDollars: 5,
  },
  {
    key: 'season-opening',
    seed: 2402,
    players: 8,
    charactersPerPlayer: { least: 2, most: 3 },
    startThreads: 4,
    backstoryDays: 2,
    dayOfSeason: 1,
    days: 7,
    postsPerDay: { least: 8, most: 20 },
    reactionsPerPost: { least: 0, most: 3 },
    costCapDollars: 5,
  },
  {
    key: 'meltdown-handover',
    seed: 3503,
    players: 8,
    charactersPerPlayer: { least: 2, most: 3 },
    startThreads: 6,
    backstoryDays: 3,
    dayOfSeason: SEASON_DAYS + 1 - 8,
    days: 7,
    postsPerDay: { least: 12, most: 30 },
    reactionsPerPost: { least: 0, most: 4 },
    costCapDollars: 5,
    bossMemory: meltdownMemory,
  },
];
