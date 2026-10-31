import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardEvent, WalletEvent } from './api.ts';
import { cutLog, micros, type LedgerRow, type LogRead, type ShareRow } from './log-page.ts';

const none: LogRead = { ledger: [], shares: [], wallet: [], cards: [], playsOnMine: [], saves: [] };
const line = (settlement: number, endsAt: string, character: string, reason: string, amount: number): LedgerRow =>
  ({ settlement, startsAt: '2026-10-28T08:17:00Z', endsAt, sharesKept: true, character, reason, amount });
const bought = (at: string): CardEvent => ({ card: 'whoops', kind: 'bought', act: null, price: 100, at });
const spent = (at: string): WalletEvent => ({ settlement: null, kind: 'purchase', change: -100, overflow: 0, floored: 0, balanceAfter: 0, ref: null, at });

test('micros reads the microseconds Postgres writes, where a millisecond would lose them', () => {
  assert.equal(micros('2026-10-30T08:17:00.000123+00:00') - micros('2026-10-30T08:17:00+00:00'), 123);
  assert.equal(micros('2026-10-30T08:17:00.5Z') - micros('2026-10-30T08:17:00Z'), 500_000);
  assert.equal(micros('2026-10-30T09:17:00+01:00'), micros('2026-10-30T08:17:00Z'));
});

test('a read that came back short is the whole log: nothing is cut, and nothing is older', () => {
  const log = cutLog({ ...none, ledger: [line(2, '2026-10-30T08:17:00Z', 'p', 'heel.drewHeat', 20)], cards: [bought('2026-10-29T20:10:00Z')] }, 3);
  assert.equal(log.before, null);
  assert.deepEqual(log.settlements.map((s) => s.id), [2]);
  assert.equal(log.cards.length, 1);
});

test('a full source ends the page at its oldest time; every source keeps only what is newer, and the next page starts there', () => {
  const read: LogRead = {
    ...none,
    cards: [bought('2026-10-30T10:00:00Z'), bought('2026-10-30T09:00:00Z')],
    wallet: [spent('2026-10-30T09:30:00Z'), spent('2026-10-30T09:00:00Z'), spent('2026-10-30T08:00:00Z')].slice(0, 2),
    ledger: [line(3, '2026-10-30T08:17:00Z', 'p', 'heel.drewHeat', 20)],
  };
  const log = cutLog(read, 2);
  /* Both full sources reached 09:00; the page keeps what is after it, and the settlement at 08:17 waits for the next page. */
  assert.equal(log.before, '2026-10-30T09:00:00Z');
  assert.deepEqual(log.cards.map((c) => c.at), ['2026-10-30T10:00:00Z']);
  assert.deepEqual(log.wallet.map((e) => e.at), ['2026-10-30T09:30:00Z']);
  assert.deepEqual(log.settlements, []);
});

test('a settlement whose lines ran past a full read is left whole for the next page', () => {
  const ledger = [
    line(5, '2026-10-31T08:17:00Z', 'p', 'heel.drewHeat', 20),
    line(4, '2026-10-30T08:17:00Z', 'p', 'heel.drewHeat', 10),
    line(4, '2026-10-30T08:17:00Z', 'h', 'face.cheered', 5),
  ];
  const log = cutLog({ ...none, ledger }, 3);
  assert.deepEqual(log.settlements.map((s) => [s.id, s.lines.length]), [[5, 1]]);
  assert.equal(log.before, '2026-10-30T08:17:00Z');
});

test('the cursor is the source\'s own time, to the microsecond, so a row a millisecond would round onto is not skipped', () => {
  const cards = [bought('2026-10-30T09:00:00.000900+00:00'), bought('2026-10-30T09:00:00.000400+00:00')];
  const log = cutLog({ ...none, cards, wallet: [spent('2026-10-30T09:00:00.000600+00:00')] }, 2);
  assert.equal(log.before, '2026-10-30T09:00:00.000400+00:00');
  assert.deepEqual(log.cards.map((c) => c.at), ['2026-10-30T09:00:00.000900+00:00']);
  assert.deepEqual(log.wallet.map((e) => e.at), ['2026-10-30T09:00:00.000600+00:00']);
});

test('each line carries its shares, largest first, and a line the estimate valued nothing for carries none', () => {
  const ledger = [line(7, '2026-10-30T08:17:00Z', 'p', 'heel.drewHeat', 20), line(7, '2026-10-30T08:17:00Z', 'p', 'heel.shrugged', -5)];
  const shares: ShareRow[] = [
    { settlement: 7, character: 'p', reason: 'heel.drewHeat', act: 'a1', quadrant: 'excitedNegative', amount: 8 },
    { settlement: 7, character: 'p', reason: 'heel.drewHeat', act: 'a2', quadrant: 'excitedNegative', amount: 12 },
  ];
  const [s] = cutLog({ ...none, ledger, shares }).settlements;
  assert.deepEqual(s!.lines, [
    { character: 'p', reason: 'heel.drewHeat', amount: 20, shares: [{ act: 'a2', quadrant: 'excitedNegative', amount: 12 }, { act: 'a1', quadrant: 'excitedNegative', amount: 8 }] },
    { character: 'p', reason: 'heel.shrugged', amount: -5, shares: [] },
  ]);
});

test('settlements read newest first, whatever order the rows came in', () => {
  const ledger = [line(1, '2026-10-29T08:17:00Z', 'p', 'heel.drewHeat', 1), line(2, '2026-10-30T08:17:00Z', 'p', 'heel.drewHeat', 2)];
  assert.deepEqual(cutLog({ ...none, ledger }).settlements.map((s) => s.id), [2, 1]);
});

test('where two full sources reach different times, the page ends at the newer, so the other\'s rows past it wait for the next page', () => {
  const read: LogRead = {
    ...none,
    cards: [bought('2026-10-30T10:00:00Z'), bought('2026-10-30T09:00:00Z')],
    wallet: [spent('2026-10-30T09:30:00Z'), spent('2026-10-30T08:00:00Z')],
  };
  const log = cutLog(read, 2);
  /* The card ledger may hold more between 08:00 and 09:00, so the wallet's 08:00 cannot be shown before them. */
  assert.equal(log.before, '2026-10-30T09:00:00Z');
  assert.deepEqual(log.wallet.map((e) => e.at), ['2026-10-30T09:30:00Z']);
});
