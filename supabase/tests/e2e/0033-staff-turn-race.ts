/**
 * End to end: a reply is answered once, whatever races (supabase/migrations/0415_chattier_staff.sql write_staff_turn; the final review of PR #1000, row RF1; the chattier follow-ups plan, Task 1).
 * Two connections to the scratch database, each holding a transaction open: A writes a turn answering a persona's waiting reply and holds its transaction; B writes a turn answering the same reply and must wait
 * on the persona's lock (write_staff_turn takes a per-persona advisory lock), then, once A commits, find the reply answered and be refused. Exactly one turn, one post and one pool_answered row are written.
 * write_staff_turn has two guards for this, the lock (the second turn reads the first's answers after waiting) and pool_answered's primary key (a duplicate is refused whatever got past the read);
 * red only with both taken out. Rows are committed under keys of their own (a persona and a thread made for this run) and left, as the other files here leave theirs. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { sql, scratchUrl } from './psql-db.ts';

/** One held-open psql connection: statements go in, and `done()` waits for everything sent so far. */
function session() {
  const child: ChildProcessWithoutNullStreams = spawn('psql', ['-X', '-q', '-tA', scratchUrl()], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  let n = 0;
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const waitFor = async (mark: string, ms: number) => {
    const until = Date.now() + ms;
    while (!out.includes(mark)) {
      if (Date.now() > until) throw new Error(`no ${mark} in ${ms} ms; out ${out}; err ${err}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return {
    send(text: string) { child.stdin.write(text + '\n'); },
    /** True when everything sent so far has answered, within `ms`. */
    async settled(ms: number) {
      const mark = `<<${++n}>>`;
      child.stdin.write(`\\echo ${mark}\n`);
      try { await waitFor(mark, ms); return true; } catch { return false; }
    },
    async done(ms = 15_000) { assert.ok(await this.settled(ms), `a statement never answered; err ${err}`); },
    get out() { return out; },
    get err() { return err; },
    close() { child.stdin.end(); child.kill(); },
  };
}

const waiting = () => Number(sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%write_staff_turn(%'`));
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
}

test('two turns answering one reply at once write exactly one turn, and the second is refused', async () => {
  const tag = Date.now().toString(36);
  const key = `rt-boss-${tag}`;
  sql(`
    insert into characters (name, staff, staff_kind, debuted_at) values ('Rt Boss ${tag}', '${key}', 'persona', now());
    select write_sessions((now() at time zone 'UTC')::date, '[{"staff": "${key}", "start": 0, "end": 1440}]');`);
  const thread = sql(`with b as (insert into boards (slug, name, description) values ('rt-${tag}', 'Rt ${tag}', 'A board of its own for the race.') returning id) insert into threads (board, title) select id, 'Rt ${tag}' from b returning id`);
  const player = sql(`select tests.character(tests.account('rt-${tag}'), 'Rt Ann ${tag}')`);
  const post = sql(`select (write_staff_act('${key}', 'post', '${thread}', null, '{"body": "The boss speaks."}') ->> 'id')`);
  const reply = sql(`select tests.act('${player}', 'post', '${thread}', '{"body": "Ann answers."}', '${post}', now() - interval '1 hour')`);
  const sid = sql(`select id from staff_sessions where staff = '${key}' order by id desc limit 1`);
  const turn = (body: string) => `select 'TURN:' || (write_staff_turn('${key}', ${sid}, '${thread}', '${reply}', array['${reply}']::uuid[], '${body}') ->> 'turn');`;
  const turns = () => Number(sql(`select count(*) from pool_turns where staff = '${key}'`));
  const answers = () => Number(sql(`select count(*) from pool_answered where reply = '${reply}'`));
  const a = session();
  const b = session();
  try {
    a.send(`begin; select tests.become_service(); ${turn('A answers.')}`);
    await a.done();
    assert.match(a.out, /TURN:\d+/, `A wrote a turn: ${a.out} ${a.err}`);
    assert.equal(turns(), 0, 'A\'s turn is not committed yet');
    b.send(`begin; select tests.become_service(); ${turn('B answers.')}`);
    await until('B waits on A\'s turn (the persona\'s lock)', () => waiting() === 1);
    assert.equal(await b.settled(300), false, 'B answered while A held the persona\'s turn');
    a.send('commit;');
    await a.done();
    assert.ok(await b.settled(15_000), `B never answered once A committed; err ${b.err}`);
    assert.match(b.err, /a reply is answered once/, `B is refused: ${b.out} ${b.err}`);
    assert.doesNotMatch(b.out, /TURN:\d+/, `B wrote no turn: ${b.out}`);
    b.send('rollback;');
    await b.done();
    assert.equal(turns(), 1, 'one turn');
    assert.equal(answers(), 1, 'the reply is answered once');
    assert.equal(sql(`select count(*) from acts where thread = '${thread}' and character = (select id from characters where staff = '${key}')`), '2', 'the persona\'s opening post and one turn');
  } finally {
    a.close();
    b.close();
  }
});
