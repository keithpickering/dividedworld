import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOST_RUN_MS, MOST_WINDOWS_PER_RUN, runSettlement } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';
import type { SettlementInput } from '../../../engine/rules/types.ts';

const H = 3_600_000;
const FROM = Date.parse('2026-11-01T08:17:00Z');
const TO = FROM + 24 * H;
/** A day on the board: Bob's Heel posts; Cat reacts with heat; Dee, the Lurker, with heat and a polite shrug; Eve and Fay with heat after her. */
const day: SettlementInput = {
  window: { id: '2026-11-01T08:17:00+00:00', from: FROM, to: TO },
  characters: [
    { id: 'he', player: 'bob', classes: [{ class: 'heel', from: 0 }] },
    { id: 'ca', player: 'cat', classes: [{ class: 'face', from: 0 }] },
    { id: 'de', player: 'dee', classes: [{ class: 'lurker', from: 0 }] },
    { id: 'ev', player: 'eve', classes: [{ class: 'face', from: 0 }] },
    { id: 'fa', player: 'fay', classes: [{ class: 'face', from: 0 }] },
  ],
  acts: [{ id: 'p1', character: 'he', kind: 'post', at: FROM + H, thread: 't' }],
  reactions: [
    { act: 'p1', player: 'cat', character: 'ca', kind: 'tomato', at: FROM + 2 * H },
    { act: 'p1', player: 'dee', character: 'de', kind: 'tea', at: FROM + 3 * H },
    { act: 'p1', player: 'dee', character: 'de', kind: 'angry', at: FROM + 3 * H + 1 },
    { act: 'p1', player: 'eve', character: 'ev', kind: 'tomato', at: FROM + 4 * H },
    { act: 'p1', player: 'fay', character: 'fa', kind: 'tomato', at: FROM + 5 * H },
  ],
};

/** A database that holds what has been settled, as apply_settlement() does. */
function fakeDb(input: SettlementInput = day, databaseSettings: Record<string, unknown> = { economy: instance.settings.economy }, failInput: { at?: string } = {}, settledElsewhere: readonly string[] = [], outbox: { id: number; topic: string; event: string; payload: unknown }[] = []) {
  const settled = new Set<string>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let lastEnd: string | null = null;
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (fn === 'next_settlement_window') {
        // As the SQL does: from the last settled end, a whole day, once the until has reached its end.
        const start = lastEnd ?? new Date(FROM).toISOString();
        const end = Date.parse(start) + 24 * H;
        return (end <= Date.parse(String(args.until)) ? { start, end: new Date(end).toISOString() } : null) as T;
      }
      if (fn === 'settlement_input') {
        if (failInput.at === String(args.window_start)) throw new DatabaseError('settlement_input: the connection dropped', '08006', 500);
        return { ...input, window: { ...input.window, from: Date.parse(String(args.window_start)), to: Date.parse(String(args.window_end)) } } as T;
      }
      if (fn === 'instance_settings') return databaseSettings as T;
      if (fn === 'due_broadcasts') return outbox.slice(0, Number(args.most)) as T;
      if (fn === 'broadcasts_sent') { const ids = args.ids as number[]; outbox.splice(0, outbox.length, ...outbox.filter((m) => !ids.includes(m.id))); return ids.length as T; }
      if (fn === 'apply_settlement') {
        const key = `${args.window_start}/${args.window_end}`;
        // Another run applied this window first.
        if (settledElsewhere.includes(String(args.window_start)) && !settled.has(key)) { settled.add(key); lastEnd = String(args.window_end); return { applied: false, reason: 'already settled' } as T; }
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
  assert.deepEqual(calls.map((c) => c.fn), ['next_settlement_window', 'instance_settings', 'settlement_input', 'apply_settlement', 'next_settlement_window', 'due_broadcasts']);
  const apply = calls[3]!.args;
  assert.deepEqual(apply.entries, [
    // Heat: Cat's, Eve's and Fay's whole votes and half of Dee's; a shrug: the other half of Dee's.
    { player: 'bob', character: 'he', reason: 'heel.drewHeat', amount: 35 },
    { player: 'bob', character: 'he', reason: 'heel.shrugged', amount: -5 },
    // Dee was second to react; with Fay, three other players have, and without Dee the post
    // leans excited-negative: her heat was an early call.
    { player: 'dee', character: 'de', reason: 'lurker.calledIt', amount: 5 },
  ]);
  assert.deepEqual(apply.class_totals, { heel: 30, lurker: 5 });
  assert.equal(apply.window_start, new Date(FROM).toISOString());
});

test('the settings rows reach the settlement: an admin\'s tuning of a vote or a class\'s number is what pays', async () => {
  const { db, calls } = fakeDb(day, { vote: 20, economy: { ...instance.settings.economy, 'lurker.earlyMatch': 40 }, copy: { turnsThreadTitle: 'x' } });
  await runSettlement(db, instance, new Date(TO).toISOString());
  const entries = calls.find((c) => c.fn === 'apply_settlement')!.args.entries as { reason: string; amount: number }[];
  assert.equal(entries.find((e) => e.reason === 'heel.drewHeat')?.amount, 70, 'three and a half votes of heat at 20 each');
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

test('a run with nothing to settle reads no settings, and sends what still waits to be sent', async () => {
  const { db, calls } = fakeDb();
  await runSettlement(db, instance, new Date(FROM).toISOString());
  assert.deepEqual(calls.map((c) => c.fn), ['next_settlement_window', 'due_broadcasts']);
});

test('what a settlement posted is sent live from the outbox, then cleared; a failed send leaves it for the next run', async () => {
  const outbox = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, topic: 'thread:t', event: 'act', payload: { id: `a${i}` } }));
  const { db, calls } = fakeDb(day, undefined, {}, [], outbox);
  const sent: unknown[][] = [];
  let up = false;
  const send = async (m: readonly unknown[]) => { if (!up) return false; sent.push([...m]); return true; };
  await runSettlement(db, instance, new Date(TO).toISOString(), { send });
  assert.equal(outbox.length, 3, 'a send that failed leaves every broadcast waiting');
  assert.ok(!calls.some((c) => c.fn === 'broadcasts_sent'));
  up = true;
  const out = await runSettlement(db, instance, new Date(TO).toISOString(), { send });
  assert.equal(out.status, 'nothing to settle');
  assert.deepEqual(sent, [[{ topic: 'thread:t', event: 'act', payload: { id: 'a0' } }, { topic: 'thread:t', event: 'act', payload: { id: 'a1' } }, { topic: 'thread:t', event: 'act', payload: { id: 'a2' } }]]);
  assert.equal(outbox.length, 0, 'sent, they are cleared');
});

test('a reveal larger than one send goes out in batches, every one of it', async () => {
  const outbox = Array.from({ length: 1201 }, (_, i) => ({ id: i + 1, topic: 'thread:r', event: 'act', payload: { id: `r${i}` } }));
  const { db } = fakeDb(day, undefined, {}, [], outbox);
  let messages = 0;
  await runSettlement(db, instance, new Date(FROM).toISOString(), { send: async (m) => { messages += m.length; return true; } });
  assert.equal(messages, 1201);
  assert.equal(outbox.length, 0);
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
  const failing = { at: new Date(TO).toISOString() as string | undefined };
  const { db, calls } = fakeDb(day, undefined, failing);
  await assert.rejects(runSettlement(db, instance, new Date(TO + 24 * H).toISOString()), DatabaseError);
  assert.deepEqual(calls.filter((c) => c.fn === 'apply_settlement').map((c) => c.args.window_start), [new Date(FROM).toISOString()]);
  failing.at = undefined;
  const resumed = await runSettlement(db, instance, new Date(TO + 24 * H).toISOString());
  assert.equal(resumed.status === 'applied' && resumed.windows.length, 1, 'the next run settles only the window still waiting');
  assert.deepEqual(calls.filter((c) => c.fn === 'apply_settlement').map((c) => c.args.window_start), [new Date(FROM).toISOString(), new Date(TO).toISOString()]);
});

test('a run that applied one window, where another run applied the one before, says it applied', async () => {
  const { db } = fakeDb(day, undefined, {}, [new Date(FROM).toISOString()]);
  const out = await runSettlement(db, instance, new Date(TO + 24 * H).toISOString());
  assert.equal(out.status, 'applied');
  assert.deepEqual(out.status === 'applied' && out.windows.map((w) => w.applied), [false, true]);
});

test('a run stops starting windows once its time is spent, says it is behind, and the next run carries on', async () => {
  const { db, calls } = fakeDb();
  let t = 0;
  // Each window takes a third of the run's time: the third starts at its limit, and waits.
  const clock = () => { const now = t; t += MOST_RUN_MS / 3; return now; };
  const first = await runSettlement(db, instance, new Date(FROM + 5 * 24 * H).toISOString(), { clock });
  assert.equal(first.status === 'applied' && first.behind, true);
  const settledFirst = calls.filter((c) => c.fn === 'apply_settlement').length;
  assert.ok(settledFirst >= 1 && settledFirst < 5, `the run stopped early: ${settledFirst}`);
  const second = await runSettlement(db, instance, new Date(FROM + 5 * 24 * H).toISOString());
  assert.equal(second.status === 'applied' && second.behind, false);
  assert.equal(calls.filter((c) => c.fn === 'apply_settlement').length, 5);
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
