/**
 * The log's lines as pure data (lines.ts): the parts the screens' tests reach only through a seeded world, held here on the
 * edges a world rarely makes: a season's end, reasons of two classes, an announcement's word against the reasons', a Turn to
 * the class the window scored, and two pages of one settlement merged.
 */
import { describe, expect, test } from 'vitest';
import type { Log, LogSettlement, MyCharacter, TurnAnnounced } from '../data/api.ts';
import { testInstance } from '../test-world.tsx';
import { logRows, rankChanges, scoredAs, turnsTaken, type LogData, type Words } from './lines.ts';
import { mergeLogs } from './useLog.ts';

const empty: Log = { settlements: [], wallet: [], cards: [], playsOnMine: [], saves: [], before: null };
const settled = (id: number, endsAt: string, lines: LogSettlement['lines']): LogSettlement => ({ id, startsAt: new Date(Date.parse(endsAt) - 86_400_000).toISOString(), endsAt, sharesKept: true, lines });
const char = (id: string, name: string, cls: string, classSince = '2026-10-01T00:00:00.000Z'): MyCharacter =>
  ({ id, name, class: cls, classSince, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00.000Z', debutLoudness: 'announced', retiredAt: null, pendingTurn: null });
const words: Words = {
  instance: testInstance,
  ui: { reasonWords: (r) => ({ 'heel.drewHeat': 'Drew heat: x', 'face.cheered': 'Cheered: y' } as Record<string, string>)[r] ?? r, quadrantLabels: { excitedNegative: 'Heat', excitedPositive: 'Hype', boredNegative: 'Groan', calmPositive: 'Calm' }, cards: [], copy: { siteName: '', siteTagline: '', shopName: 'Shop', reducedMotionCard: '' } },
  postsPerPage: 20,
};
const data = (over: Partial<LogData>): LogData => ({
  log: empty, mine: [], estimate: null, standings: {}, season: null, turns: [], acts: new Map(), names: new Map(), titles: new Map(), states: new Map(), ...over,
});
const season = (startsAt: string) => ({ id: 2, number: 2, startsAt, endsAt: null, turnsThread: null, revealAct: null });

describe('rank changes', () => {
  test('are drawn for the open season\'s settlements, and never across its start', () => {
    const p = char('p', 'Pipewrench', 'heel');
    /* The season began on Oct 25; Oct 30's +0.50 took this season's standing from 2.70 to 3.20, Jobber to Midcarder. */
    const log = { ...empty, settlements: [
      settled(2, '2026-10-30T08:17:00Z', [{ character: 'p', reason: 'heel.drewHeat', amount: 50, shares: [] }]),
      settled(1, '2026-10-20T08:17:00Z', [{ character: 'p', reason: 'heel.drewHeat', amount: -200, shares: [] }]),
    ] };
    const changes = rankChanges(data({ log, mine: [p], standings: { p: 320 }, season: season('2026-10-25T00:00:00Z') }), testInstance);
    expect(changes.get(2)).toEqual([{ character: 'p', before: 270, after: 320, rankWas: 0, rankNow: 1 }]);
    /* Read across the season's start, last season's loss would wrongly be a rank down from 4.70. */
    expect(changes.has(1)).toBe(false);
  });
});

describe('the class a settlement scored', () => {
  test('is named only when every reason is one class\'s; reasons of two say "Scored" alone', () => {
    expect(scoredAs([{ character: 'p', reason: 'heel.drewHeat', amount: 1, shares: [] }], testInstance)).toBe('heel');
    expect(scoredAs([{ character: 'p', reason: 'heel.drewHeat', amount: 1, shares: [] }, { character: 'p', reason: 'face.cheered', amount: 1, shares: [] }], testInstance)).toBeNull();
    const log = { ...empty, settlements: [settled(1, '2026-10-30T08:17:00Z', [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }, { character: 'p', reason: 'face.cheered', amount: 5, shares: [] }])] };
    const [row] = logRows(data({ log, mine: [char('p', 'Pipewrench', 'face')] }), words, 600, 'p');
    expect(row!.details.join('')).toMatch(/^Scored for Oct 29: /u);
  });
});

describe('a Turn that took effect', () => {
  const at = '2026-10-30T08:17:00.000Z';
  test('names the old class the announcement said, over the class the window\'s reasons name', () => {
    const p = char('p', 'Pipewrench', 'face', at);
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    const turns: TurnAnnounced[] = [{ act: 't', character: 'p', at, was: 'lurker', since: null }];
    expect(turnsTaken(data({ log, mine: [p], turns }), testInstance).get(1)).toEqual([{ character: 'p', classNow: 'face', classWas: 'lurker', announced: turns[0] }]);
    expect(turnsTaken(data({ log, mine: [p] }), testInstance).get(1)![0]!.classWas).toBe('heel');
  });
  test('names no old class where the window scored the class it Turned to', () => {
    const p = char('p', 'Pipewrench', 'heel', at);
    const log = { ...empty, settlements: [settled(1, at, [{ character: 'p', reason: 'heel.drewHeat', amount: 5, shares: [] }])] };
    expect(turnsTaken(data({ log, mine: [p] }), testInstance).get(1)![0]!.classWas).toBeNull();
  });
});

describe('two pages merged', () => {
  test('hold each settlement once, the older page\'s rows after the newer\'s, and the older page\'s cursor', () => {
    const a = settled(2, '2026-10-30T08:17:00Z', []);
    const b = settled(1, '2026-10-29T08:17:00Z', []);
    const merged = mergeLogs({ ...empty, settlements: [a, b], before: 'x' }, { ...empty, settlements: [b], before: null });
    expect(merged.settlements.map((s) => s.id)).toEqual([2, 1]);
    expect(merged.before).toBeNull();
  });
});
