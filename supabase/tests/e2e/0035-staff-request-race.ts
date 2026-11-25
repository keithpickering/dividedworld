/**
 * End to end: a request is ruled once, and a Boss's move is paid once, whatever races (supabase/migrations/0424_staff_requests.sql: rule_request, apply_boss_move; the staff requests plan, Task 3).
 * Two connections to the scratch database, each holding a transaction open, as 0033 does for a turn:
 *   1. apply_boss_move: A queues the Boss's move for a cause and holds its transaction; B asks for the same cause and must WAIT on the Boss's bank lock (an advisory lock: the wait of an index entry would be a
 *      different one), then, once A commits, answer the first move as it was ("existing") and charge nothing. One queued move, one debit.
 *   2. rule_request: A rules a fulfill on a request and holds; B rules the same request and must wait on the request's own lock, then return A's row as it was written. One request row, one move, one debit.
 * Red with the bank lock taken out of apply_boss_move (B does not wait on it), and with the request's lock and lookup taken out of rule_request (B raises on the second row for one request).
 * Rows are committed under keys of their own (a persona, boards and a thread made for this run), the open season's Boss is this persona for the run and put back after, and the rest is left as the other files here leave theirs.
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

test('two sessions making one Boss move, or ruling one request, at once do it once, and the second answers the first', async () => {
  const tag = Date.now().toString(36);
  const key = `rr-boss-${tag}`;
  const before = sql(`select coalesce(boss, '') from seasons where ends_at is null`);
  sql(`insert into characters (name, staff, staff_kind, debuted_at) values ('Rr Boss ${tag}', '${key}', 'persona', now());
    insert into move_bank (staff, balance, as_of) values ('${key}', 5, now());
    insert into meetings (slot, started_at, finished_at, outcome) values (now() + interval '${Number.parseInt(tag, 36) % 100000} seconds', now(), now(), 'ok');
    update seasons set boss = '${key}' where ends_at is null;
    insert into settings (key, value) values ('structuralHoldHours', '24'::jsonb) on conflict (key) do nothing;
    insert into move_kinds (key, structural, lasting, offices) values ('moveThread', false, true, '{boss,mod}') on conflict (key) do nothing;`);
  try {
    const board = (n: string) => sql(`insert into boards (slug, name, description) values ('rr-${n}-${tag}', 'Rr ${n} ${tag}', 'A board of its own for the race.') returning id`).split('\n')[0]!;
    const [from, to] = [board('a'), board('b')];
    const thread = sql(`insert into threads (board, title) values ('${from}', 'Rr ${tag}') returning id`).split('\n')[0]!;
    const player = sql(`select tests.character(tests.account('rr-${tag}'), 'Rr Ann ${tag}')`);
    const opener = sql(`select (write_staff_act('${key}', 'post', '${thread}', null, '{"body": "The boss speaks."}') ->> 'id')`);
    const reply = (n: number) => sql(`select tests.act('${player}', 'post', '${thread}', '{"body": "Ann asks ${n}."}', '${opener}', now() - interval '1 hour')`);
    const turn = (to_act: string) => sql(`select (write_staff_act('${key}', 'post', '${thread}', '${to_act}', '{"body": "The boss answers."}') ->> 'id')`);
    const move = (n: string) => `'{"kind": "moveThread", "params": {"thread": "${thread}", "board": "${to}"}, "expires_in_hours": 0, "why": "Race ${n}."}'::jsonb`;
    const bank = () => Number(sql(`select balance from move_bank where staff = '${key}'`));
    const moves = (cause: string) => Number(sql(`select count(*) from queued_moves where staff = '${key}' and cause_act = '${cause}'`));

    // 1. apply_boss_move on one cause.
    const cause = reply(1);
    const make = `select 'MOVE:' || (apply_boss_move('${key}', ${move('1')}, '${cause}', 0, 20))::text;`;
    const a = session();
    const b = session();
    try {
      a.send(`begin; select tests.become_service(); ${make}`);
      await a.done();
      assert.match(a.out, /"queued": true/, `A queued the move: ${a.out} ${a.err}`);
      assert.equal(moves(cause), 0, 'A\'s move is not committed yet');
      b.send(`begin; select tests.become_service(); ${make}`);
      await until('B waits on the Boss\'s bank lock', () => waitingOn('apply_boss_move') === 1);
      assert.equal(await b.settled(300), false, 'B answered while A held the Boss\'s bank');
      a.send('commit;');
      await a.done();
      assert.ok(await b.settled(15_000), `B never answered once A committed; err ${b.err}`);
      assert.match(b.out, /"existing": true/, `B answered the first move as it was: ${b.out} ${b.err}`);
      assert.match(b.out, /"queued": false/, `B queued nothing: ${b.out}`);
      b.send('rollback;');
      await b.done();
      assert.equal(moves(cause), 1, 'one queued move for the cause');
      assert.equal(bank(), 4, 'one debit');
    } finally {
      a.close();
      b.close();
    }

    // 2. rule_request on one request post.
    const request = reply(2);
    const answer = turn(request);
    const rule = `select 'RULED:' || (rule_request('${key}', '${request}', '${answer}', 'fulfill', ${move('2')}, 0, 20))::text;`;
    const c = session();
    const d = session();
    try {
      c.send(`begin; select tests.become_service(); ${rule}`);
      await c.done();
      assert.match(c.out, /"ruling": "fulfill"/, `C ruled the request: ${c.out} ${c.err}`);
      d.send(`begin; select tests.become_service(); ${rule}`);
      await until('D waits on the request\'s lock', () => waitingOn('rule_request') === 1);
      assert.equal(await d.settled(300), false, 'D ruled while C held the request');
      c.send('commit;');
      await c.done();
      assert.ok(await d.settled(15_000), `D never answered once C committed; err ${d.err}`);
      assert.equal(d.err, '', `D raised: ${d.err}`);
      assert.match(d.out, /"existing": true/, `D answered C's ruling as it was written: ${d.out}`);
      d.send('rollback;');
      await d.done();
      assert.equal(Number(sql(`select count(*) from staff_requests where staff = '${key}' and request_act = '${request}'`)), 1, 'one ruling on the request');
      assert.equal(moves(request), 1, 'one move for the request');
      assert.equal(bank(), 3, 'one more debit, not two');
      assert.equal(Number(sql(`select count(*) from staff_requests_open o join staff_requests q on q.id = o.request where q.staff = '${key}'`)), 0, 'a fulfill is not waiting');
    } finally {
      c.close();
      d.close();
    }
  } finally {
    sql(`update seasons set boss = ${before === '' ? 'null' : `'${before}'`} where ends_at is null`);
  }
});
