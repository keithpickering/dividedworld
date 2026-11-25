/**
 * End to end: a meeting reads the Boss's bank under the Boss's bank lock, so a turn's debit is never overwritten by a meeting that read the bank before it (supabase/migrations/0424_staff_requests.sql, section 3: apply_meeting;
 * the staff requests plan, Task 5, review focus 2). Two connections to the scratch database, each holding a transaction open, as 0033 and 0035 do:
 *   A: a Boss's turn queues a move (apply_boss_move) and holds its transaction: the bank is debited and not committed. It began before any meeting was open, so it took no meeting's lock.
 *   B: a meeting begins after that (begin_meeting commits its row) and is applied: apply_meeting must WAIT on the Boss's bank lock (an advisory lock, which a wait on the debited row would not be), and once A commits it reads the bank A left:
 *      `bank_before` is the balance after the debit, never the one before it. Without the lock B reads the committed balance at once, runs to its write of the balance, and the debit is overwritten.
 * Red with the bank lock taken out of apply_meeting (B does not wait on an advisory lock; it waits on A's row instead, or reads the old balance).
 * Rows are committed under keys of their own (a persona, boards and a thread made for this run); the open season's Boss is this persona for the run and put back after, and the rest is left as the other files here leave theirs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql, session } from './psql-db.ts';

/** Sessions waiting on an advisory lock inside the function named. */
const waitingOn = (fn: string) => Number(sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory' and query like '%${fn}(%'`));
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
}

test('a meeting that begins after a turn looked at the bank waits for it, and reads the bank the turn left', async () => {
  const tag = Date.now().toString(36);
  const key = `mb-boss-${tag}`;
  const before = sql(`select coalesce(boss, '') from seasons where ends_at is null`);
  sql(`insert into characters (name, staff, staff_kind, debuted_at) values ('Mb Boss ${tag}', '${key}', 'persona', now());
    insert into move_bank (staff, balance, as_of) values ('${key}', 5, now());
    insert into meetings (slot, started_at, finished_at, outcome) values (now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', 'ok');
    update seasons set boss = '${key}' where ends_at is null;
    insert into settings (key, value) values ('structuralHoldHours', '24'::jsonb) on conflict (key) do nothing;
    insert into move_kinds (key, structural, lasting, offices) values ('moveThread', false, true, '{boss,mod}') on conflict (key) do nothing;`);
  try {
    const board = (n: string) => sql(`insert into boards (slug, name, description) values ('mb-${n}-${tag}', 'Mb ${n} ${tag}', 'A board of its own for the race.') returning id`).split('\n')[0]!;
    const [from, to] = [board('a'), board('b')];
    const thread = sql(`insert into threads (board, title) values ('${from}', 'Mb ${tag}') returning id`).split('\n')[0]!;
    const cause = sql(`select (write_staff_act('${key}', 'post', '${thread}', null, '{"body": "The boss speaks."}') ->> 'id')`);
    const bank = () => Number(sql(`select balance from move_bank where staff = '${key}'`));
    assert.equal(sql(`select count(*) from meetings where finished_at is null`), '0', 'no meeting is open, so the turn below takes no meeting\'s lock');

    const turn = session();
    const meet = session();
    try {
      turn.send(`begin; select tests.become_service(); select 'MOVE:' || (apply_boss_move('${key}', '{"kind": "moveThread", "params": {"thread": "${thread}", "board": "${to}"}, "expires_in_hours": 0, "why": "Race."}'::jsonb, '${cause}', 0, 20))::text;`);
      await turn.done();
      assert.match(turn.out, /"queued": true/, `the turn queued its move: ${turn.out} ${turn.err}`);
      assert.equal(bank(), 5, 'the turn\'s debit is not committed yet');

      // The meeting's row is opened now, after the turn looked at the bank, and applied.
      const meeting = sql(`select (begin_meeting(now() + interval '${Number.parseInt(tag, 36) % 1000 + 1} seconds') ->> 'meeting')`);
      meet.send(`begin; select tests.become_service(); select 'APPLIED:' || (apply_meeting(${meeting}, jsonb_build_object('boss', '${key}', 'weekly_moves', 0, 'bank_cap', 5, 'moves', '[]'::jsonb, 'record', '{}'::jsonb)))::text;`);
      await until('the meeting waits on the Boss\'s bank lock', () => waitingOn('apply_meeting') === 1);
      assert.equal(await meet.settled(300), false, 'the meeting was applied while the turn held the Boss\'s bank');

      turn.send('commit;');
      await turn.done();
      assert.ok(await meet.settled(15_000), `the meeting never went on once the turn committed; err ${meet.err}`);
      assert.equal(meet.err, '', `the meeting raised: ${meet.err}`);
      assert.match(meet.out, /"bank_before": 4(\.0+)?[,}]/, `the meeting read the bank the turn left, not the one before its debit: ${meet.out}`);
      meet.send('commit;');
      await meet.done();
      assert.equal(sql(`select count(*) from queued_moves where staff = '${key}' and cause_act = '${cause}'`), '1', 'the turn\'s one move');
      assert.equal(bank(), Number(/"bank_after": (\d+)/.exec(meet.out)![1]), 'the balance is the one the meeting wrote from the bank it read');
    } finally {
      turn.close();
      meet.close();
    }
  } finally {
    sql(`update seasons set boss = ${before === '' ? 'null' : `'${before}'`} where ends_at is null`);
  }
});
