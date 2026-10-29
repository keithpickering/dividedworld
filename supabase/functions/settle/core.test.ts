import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOST_WINDOWS_PER_RUN, runSettlement } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';
import type { SettlementInput } from '../../../engine/rules/types.ts';

const H = 3_600_000;
const FROM = Date.parse('2026-11-01T08:17:00Z');
const TO = FROM + 24 * H;
/** A day on the board: Bob's Heel posts; Cat reacts with heat; Dee, the Lurker, with heat and a polite shrug. */
const day: SettlementInput = {
  window: { id: '2026-11-01T08:17:00+00:00', from: FROM, to: TO },
  characters: [
    { id: 'he', player: 'bob', classes: [{ class: 'heel', from: 0 }] },
    { id: 'ca', player: 'cat', classes: [{ class: 'face', from: 0 }] },
    { id: 'de', player: 'dee', classes: [{ class: 'lurker', from: 0 }] },
  ],
  acts: [{ id: 'p1', character: 'he', kind: 'post', at: FROM + H, thread: 't' }],
  reactions: [
    { act: 'p1', player: 'cat', character: 'ca', kind: 'tomato', at: FROM + 2 * H },
    { act: 'p1', player: 'dee', character: 'de', kind: 'tea', at: FROM + 3 * H },
    { act: 'p1', player: 'dee', character: 'de', kind: 'angry', at: FROM + 3 * H + 1 },
  ],
};

/** A database that holds what has been settled, as apply_settlement() does. */
function fakeDb(input: SettlementInput = day, databaseSettings: Record<string, unknown> = { economy: instance.settings.economy }, failInputAt?: string) {
  const settled = new Set<string>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let lastEnd: string | null = null;
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (fn === 'next_settlement_window') {
        // As the SQL does: from the last settled end, a day at most, to the until.
        const start = lastEnd ?? new Date(FROM).toISOString();
        const end = Math.min(Date.parse(String(args.until)), Date.parse(start) + 24 * H);
        return (end > Date.parse(start) ? { start, end: new Date(end).toISOString() } : null) as T;
      }
      if (fn === 'settlement_input') {
        if (failInputAt === String(args.window_start)) throw new DatabaseError('settlement_input: the connection dropped', '08006', 500);
        return { ...input, window: { ...input.window, from: Date.parse(String(args.window_start)), to: Date.parse(String(args.window_end)) } } as T;
      }
      if (fn === 'instance_settings') return databaseSettings as T;
      if (fn === 'apply_settlement') {
        const key = `${args.window_start}/${args.window_end}`;
        if (settled.has(key)) return { applied: false, reason: 'already settled' } as T;
        settled.add(key);
        lastEnd = String(args.window_end);
        return { applied: true, settlement: settled.size, entries: (args.entries as unknown[]).length } as T;
      }
      throw new Error(`unexpected ${fn}`);
    },
  };
  return { db, calls };
}

test('a run settles the next window: reads its input, runs the instance\'s classes, applies their entries', async () => {
  const { db, calls } = fakeDb();
  const out = await runSettlement(db, instance, new Date(TO).toISOString());
  assert.equal(out.status, 'applied');
  assert.deepEqual(calls.map((c) => c.fn), ['next_settlement_window', 'instance_settings', 'settlement_input', 'apply_settlement', 'next_settlement_window']);
  const apply = calls[3]!.args;
  assert.deepEqual(apply.entries, [
    // Heat: Cat's whole vote and half of Dee's; a shrug: the other half of Dee's.
    { player: 'bob', character: 'he', reason: 'heel.drewHeat', amount: 15 },
    { player: 'bob', character: 'he', reason: 'heel.shrugged', amount: -5 },
    // The post ends up excited-negative, and Dee was second to react: her heat was an early call.
    { player: 'dee', character: 'de', reason: 'lurker.calledIt', amount: 5 },
  ]);
  assert.deepEqual(apply.class_totals, { heel: 10, lurker: 5 });
  assert.equal(apply.window_start, new Date(FROM).toISOString());
});

test('the settings rows reach the settlement: an admin\'s tuning of a vote or a class\'s number is what pays', async () => {
  const { db, calls } = fakeDb(day, { vote: 20, economy: { ...instance.settings.economy, 'lurker.earlyMatch': 40 }, copy: { turnsThreadTitle: 'x' } });
  await runSettlement(db, instance, new Date(TO).toISOString());
  const entries = calls.find((c) => c.fn === 'apply_settlement')!.args.entries as { reason: string; amount: number }[];
  assert.equal(entries.find((e) => e.reason === 'heel.drewHeat')?.amount, 30);
  assert.equal(entries.find((e) => e.reason === 'lurker.calledIt')?.amount, 20);
});

test('the settings row\'s economy is the whole economy, as the SQL reads it: a number it lacks is refused, not filled from the code', async () => {
  const { db, calls } = fakeDb(day, { economy: { 'lurker.earlyMatch': 40 } });
  await assert.rejects(runSettlement(db, instance, new Date(TO).toISOString()), /lurker\.earlyPlayers/);
  assert.ok(!calls.some((c) => c.fn === 'apply_settlement'));
});

test('a database with no economy row is refused, never settled on the code\'s numbers', async () => {
  const { db } = fakeDb(day, { vote: 10 });
  await assert.rejects(runSettlement(db, instance, new Date(TO).toISOString()), /economy/);
});

test('a run with nothing to settle reads no settings', async () => {
  const { db, calls } = fakeDb();
  await runSettlement(db, instance, new Date(FROM).toISOString());
  assert.deepEqual(calls.map((c) => c.fn), ['next_settlement_window']);
});

test('settings rows that would make the instance not whole are refused before anything is settled', async () => {
  const { db, calls } = fakeDb(day, { economy: { 'lurker.earlyMatch': 'lots' } });
  await assert.rejects(runSettlement(db, instance, new Date(TO).toISOString()), /lurker\.earlyMatch/);
  assert.ok(!calls.some((c) => c.fn === 'apply_settlement'));
});

test('missed days are settled one window at a time, in order, until the run is caught up', async () => {
  const { db, calls } = fakeDb();
  const out = await runSettlement(db, instance, new Date(TO + 24 * H).toISOString());
  const applied = calls.filter((c) => c.fn === 'apply_settlement').map((c) => [c.args.window_start, c.args.window_end]);
  assert.deepEqual(applied, [[new Date(FROM).toISOString(), new Date(TO).toISOString()], [new Date(TO).toISOString(), new Date(TO + 24 * H).toISOString()]]);
  assert.equal(out.status, 'applied');
  assert.equal(out.status === 'applied' && out.windows.length, 2);
});

test('a run that fails between two missed windows keeps the first, and the next run resumes at the second', async () => {
  const { db, calls } = fakeDb(day, undefined, new Date(TO).toISOString());
  await assert.rejects(runSettlement(db, instance, new Date(TO + 24 * H).toISOString()), DatabaseError);
  assert.deepEqual(calls.filter((c) => c.fn === 'apply_settlement').map((c) => c.args.window_start), [new Date(FROM).toISOString()]);
});

test('a run settles at most a month of missed windows, says it is behind, and the next run carries on', async () => {
  const { db, calls } = fakeDb();
  const first = await runSettlement(db, instance, new Date(FROM + 40 * 24 * H).toISOString());
  assert.equal(first.status === 'applied' && first.windows.length, MOST_WINDOWS_PER_RUN);
  assert.equal(first.status === 'applied' && first.behind, true);
  const second = await runSettlement(db, instance, new Date(FROM + 40 * 24 * H).toISOString());
  assert.equal(second.status === 'applied' && second.windows.length, 40 - MOST_WINDOWS_PER_RUN);
  assert.equal(second.status === 'applied' && second.behind, false);
  assert.equal(calls.filter((c) => c.fn === 'apply_settlement').length, 40);
});

test('a second run of the same firing is a no-op', async () => {
  const { db, calls } = fakeDb();
  const until = new Date(TO).toISOString();
  await runSettlement(db, instance, until);
  const again = await runSettlement(db, instance, until);
  assert.equal(again.status, 'nothing to settle');
  assert.equal(calls.filter((c) => c.fn === 'apply_settlement').length, 1);
});

test('a window another run settled first is reported as such, not applied twice', async () => {
  const { db } = fakeDb();
  const until = new Date(TO).toISOString();
  // Two runs that both asked for the window before either applied it.
  const [a, b] = await Promise.all([runSettlement(db, instance, until), runSettlement(db, instance, until)]);
  assert.deepEqual([a.status, b.status].sort(), ['already settled', 'applied']);
});

test('a database error is thrown, not swallowed: the window stays unsettled for the next run', async () => {
  const db: Db = { rpc: async () => { throw new DatabaseError('settlement_input: no', '42501', 403); } };
  await assert.rejects(runSettlement(db, instance, new Date(TO).toISOString()), DatabaseError);
});

test('an until that is not a time is refused before anything is asked', async () => {
  const { db, calls } = fakeDb();
  await assert.rejects(runSettlement(db, instance, 'yesterday'), /until/);
  assert.equal(calls.length, 0);
});
