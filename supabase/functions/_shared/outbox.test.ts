import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Broadcast, Delivery } from './broadcast.ts';
import { sendWaiting } from './outbox.ts';
import type { Db } from './rpc.ts';

type Row = { id: number; topic: string; event: string; payload: { n: number }; attempts: number; dead?: string };

/** The outbox as 0061_account_channel.sql keeps it: claims bump attempts, release and renew and dead and sent act on ids. */
function outbox(n: number) {
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, topic: 'reach', event: 'effect', payload: { n: i + 1 }, attempts: 0 }));
  const claimed = new Set<number>();
  let last = n;
  const add = () => { const id = ++last; rows.push({ id, topic: 'reach', event: 'effect', payload: { n: id }, attempts: 0 }); };
  const log: string[] = [];
  const db: Db = {
    rpc: async <T>(fn: string, args: Record<string, unknown>) => {
      const ids = (args.ids ?? []) as number[];
      if (fn === 'due_broadcasts') {
        const take = rows.filter((r) => r.dead === undefined && !claimed.has(r.id)).slice(0, Number(args.most));
        for (const r of take) { r.attempts++; claimed.add(r.id); }
        return take.map((r) => ({ ...r })) as T;
      }
      log.push(`${fn}:${ids.join(',')}${fn === 'broadcasts_dead' ? `:${args.why}` : ''}`);
      if (fn === 'broadcasts_sent') for (const id of ids) rows.splice(rows.findIndex((r) => r.id === id), 1);
      if (fn === 'broadcasts_release') for (const id of ids) claimed.delete(id);
      if (fn === 'broadcasts_dead') for (const id of ids) { rows.find((r) => r.id === id)!.dead = String(args.why); claimed.delete(id); }
      return ids.length as T;
    },
  };
  return { rows, db, log, add };
}
const poisoned = (bad: number, answer: Delivery) => async (m: readonly Broadcast[]): Promise<Delivery> =>
  (m as readonly { payload: { n: number } }[]).some((x) => x.payload.n === bad) ? answer : 'sent';

test('a batch that cannot be reached is released with a backoff, not held for its lease, and stops the drain', async () => {
  const { db, log, rows } = outbox(3);
  await sendWaiting(db, async () => 'unreachable');
  assert.deepEqual(log, ['broadcasts_release:1,2,3']);
  assert.equal(rows.length, 3);
});

test('a row only one payload makes unreachable never holds back the rest: they go one at a time after a few attempts, and it is given up dead with its record', async () => {
  const { db, log, rows, add } = outbox(4);
  const deliver = poisoned(3, 'unreachable');
  // Traffic goes on: it is the proof Realtime is up, which a row alone cannot give.
  for (let drain = 0; drain < 8; drain++) { await sendWaiting(db, deliver); add(); }
  await sendWaiting(db, deliver);
  assert.deepEqual(rows.map((r) => r.id), [3], 'every other row went');
  assert.equal(rows[0]!.dead, 'unreachable', 'the poisoned row is kept, dead, with its payload');
  assert.deepEqual(rows[0]!.payload, { n: 3 });
  assert.ok(log.some((l) => l.startsWith('broadcasts_dead:3')), log.join('\n'));
});

test('an outage does not kill rows: when nothing at all goes, nothing is given up however many drains fail', async () => {
  const { db, rows } = outbox(3);
  for (let drain = 0; drain < 12; drain++) await sendWaiting(db, async () => 'unreachable');
  assert.deepEqual(rows.map((r) => r.dead), [undefined, undefined, undefined]);
});

test('a row Realtime refuses for good is kept dead, with its payload, and the rows after it are sent', async () => {
  const { db, rows } = outbox(3);
  await sendWaiting(db, poisoned(2, 'refused'));
  assert.deepEqual(rows.map((r) => [r.id, r.dead ?? null]), [[2, 'refused']]);
  assert.deepEqual(rows[0]!.payload, { n: 2 });
});

test('the lease is renewed as a one-at-a-time fallback goes on, and the fallback stops short of the lease', async () => {
  const { db, log } = outbox(5);
  let now = 0;
  const deliver = async (m: readonly Broadcast[]): Promise<Delivery> => {
    if (m.length > 1) return 'refused';
    now += 30_000; // a slow Realtime
    return 'sent';
  };
  await sendWaiting(db, deliver, { clock: () => now });
  assert.ok(log.filter((l) => l.startsWith('broadcasts_renew')).length >= 1, log.join('\n'));
  // 30 seconds each: the fallback gives way before its 90 seconds, releasing what it has not sent.
  const sent = log.filter((l) => l.startsWith('broadcasts_sent')).length;
  assert.ok(sent < 5 && log.some((l) => l.startsWith('broadcasts_release')), log.join('\n'));
});
