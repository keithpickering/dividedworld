import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardEvent, WalletEvent } from './api.ts';
import { cutLog, justBefore, LOG_ROWS, micros, readLogPage, type LedgerRow, type LogRange, type LogRead, type ShareRow } from './log-page.ts';

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
    wallet: [spent('2026-10-30T09:30:00Z'), spent('2026-10-30T09:00:00Z')],
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

test('shares of one size are ordered by their Act, and lines by character and then reason, so both backends hand the same order', () => {
  const ledger = [line(7, '2026-10-30T08:17:00Z', 'q', 'heel.shrugged', -5), line(7, '2026-10-30T08:17:00Z', 'p', 'heel.stoleThunder', 4), line(7, '2026-10-30T08:17:00Z', 'p', 'heel.drewHeat', 4)];
  const shares: ShareRow[] = [
    { settlement: 7, character: 'p', reason: 'heel.drewHeat', act: 'b', quadrant: 'excitedNegative', amount: 2 },
    { settlement: 7, character: 'p', reason: 'heel.drewHeat', act: 'a', quadrant: 'excitedNegative', amount: 2 },
  ];
  const [s] = cutLog({ ...none, ledger, shares }).settlements;
  assert.deepEqual(s!.lines.map((l) => [l.character, l.reason]), [['p', 'heel.drewHeat'], ['p', 'heel.stoleThunder'], ['q', 'heel.shrugged']]);
  assert.deepEqual(s!.lines[0]!.shares.map((sh) => sh.act), ['a', 'b']);
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

/*
 * #89 F4: a source that holds `LOG_ROWS` rows at one instant. Cut at that instant, the page keeps nothing of it and hands the same
 * instant back as the cursor, so Show older lines would read the same page forever. The cursors must only ever move back, and every
 * row must be read once.
 */
test('a source full at one instant never hands back the cursor it was read with: every row is read once, and the cursors only move back', async () => {
  const at9 = '2026-10-30T08:17:00.000000+00:00';
  const at8 = '2026-10-29T08:17:00.000000+00:00';
  const ledger: LedgerRow[] = [
    ...Array.from({ length: LOG_ROWS }, (_, k) => line(9, at9, `c${String(k).padStart(3, '0')}`, 'heel.drewHeat', k + 1)),
    line(8, at8, 'c000', 'heel.drewHeat', 7),
  ];
  const wallet = [spent(at9), spent(at8)];
  /* A backend's reads over these rows, as each source reads: newest first, at or before the cursor, a page long; or all at one instant. */
  const read = (range: LogRange): LogRead => {
    const fits = (iso: string) => ('at' in range ? micros(iso) === micros(range.at) : range.before === null || micros(iso) <= micros(range.before));
    const cap = <T,>(rows: T[]) => ('at' in range ? rows : rows.slice(0, range.limit));
    return { ...none, ledger: cap(ledger.filter((l) => fits(l.endsAt))), wallet: cap(wallet.filter((e) => fits(e.at))) };
  };
  const seen: string[] = [];
  const cursors: (string | null)[] = [null];
  for (let page = 0; page < 6; page++) {
    const cursor = cursors[cursors.length - 1]!;
    const log = await readLogPage(read, cursor);
    for (const s of log.settlements) for (const l of s.lines) seen.push(`${s.id} ${l.character}`);
    if (log.before === null) break;
    if (cursor !== null) assert.ok(micros(log.before) < micros(cursor), `the cursor ${log.before} did not move back from ${cursor}`);
    cursors.push(log.before);
  }
  assert.equal(new Set(seen).size, seen.length, 'a line was read twice');
  assert.equal(seen.length, LOG_ROWS + 1, 'a line was never read');
});

test('the microsecond before an instant is written in UTC to the microsecond, whatever offset and fraction the instant was written with', () => {
  assert.equal(justBefore('2026-10-30T10:17:00.5+02:00'), '2026-10-30T08:17:00.499999+00:00');
  assert.equal(justBefore('2026-10-30T08:17:00.123456-05:30'), '2026-10-30T13:47:00.123455+00:00');
  assert.equal(justBefore('2026-10-30T08:17:00Z'), '2026-10-30T08:16:59.999999+00:00');
  assert.equal(justBefore('2026-01-01T00:00:00+00:00'), '2025-12-31T23:59:59.999999+00:00');
  for (const iso of ['2026-10-30T10:17:00.5+02:00', '2026-10-30T08:17:00.123456-05:30', '2026-10-30T08:17:00Z']) assert.equal(micros(iso) - micros(justBefore(iso)), 1);
});
