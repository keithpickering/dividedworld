/**
 * End to end: rolling a Random Event is serialized per account (supabase/migrations/0155_random_events.sql random_event; the cosmetics plan, Task 4's review focus).
 * Two connections to the scratch database, each holding a transaction open: one account with two masks (so the mask's own row lock cannot serialize them) and a roll window of a day. A rolls through one mask and holds its
 * transaction; B's roll through the other must wait on the roll row (it neither sees A's uncommitted stamp nor rolls beside it), and once A commits, B reads the
 * stamp and answers null. Exactly one event is written, and the account has one roll row, so the first-ever roll cannot be taken twice. Run by tools/test-sql.mjs.
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
  const waitFor = async (mark: string, ms = 15_000) => {
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

const roll = (who: string, mask: string) => `select 'ROLL:' || coalesce(random_event('${who}', '${mask}')::text, 'null');`;
const waiting = () => Number(sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%random_event(%'`));
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
}

async function race(old: boolean) {
  const tag = Date.now().toString(36);
  sql(`insert into settings (key, value) values ('cosmetics', '{"gear": {"wornMost": 3, "reach": 0.4}, "trophies": {"shownMost": 3}, "events": {"windowMinutes": 1440, "dayMost": 100, "outcomes": {"line": 1000000000, "gear": 1, "card": 1}, "gearRarity": {"common": 80}, "cardRarity": {"common": 80}}}')
    on conflict (key) do update set value = excluded.value`);
  sql(`insert into event_lines (key, outcome, text) values ('rr-line-${tag}', 'line', 'A race line.') on conflict (key) do nothing`);
  const who = sql(`select tests.account('rr-${tag}')`);
  const mask = sql(`select tests.character('${who}', 'Rr One ${tag}')`);
  const other = sql(`select tests.character('${who}', 'Rr Two ${tag}')`);
  if (old) sql(`insert into random_event_rolls (account, rolled_at) values ('${who}', now() - interval '2 days')`);
  assert.equal(sql(`select count(*) from random_event_rolls where account = '${who}'`), old ? '1' : '0', old ? 'the account rolled long ago' : 'the account has never rolled');
  const events = () => Number(sql(`select count(*) from random_events where account = '${who}'`));
  const a = session();
  const b = session();
  try {
    a.send(`begin; select tests.become_service(); ${roll(who, mask)}`);
    await a.done();
    assert.match(a.out, /ROLL:\{/, `A rolled: ${a.out} ${a.err}`);
    assert.equal(events(), 0, 'A\'s event is not committed yet');
    b.send(`begin; select tests.become_service(); ${roll(who, other)}`);
    await until('B waits on A\'s roll row', () => waiting() === 1);
    assert.equal(await b.settled(300), false, 'B answered while A held the roll');
    a.send('commit;');
    await a.done();
    await b.done();
    assert.match(b.out, /ROLL:null/, `B reads A's stamp and does not roll: ${b.out} ${b.err}`);
    b.send('commit;');
    await b.done();
    assert.equal(events(), 1, 'one roll, one event');
    assert.equal(sql(`select count(*) from random_event_rolls where account = '${who}'`), '1');
  } finally {
    a.close();
    b.close();
  }
}

test('two rolls for one account at once, the first it has ever made, roll exactly once', () => race(false));
// The roll row serializes two rolls twice over: `insert ... on conflict do nothing` waits on a row another transaction holds or is inserting, and `for update` locks it.
// Red only with both taken out (the insert made a `where not exists` and the lock dropped); either alone still holds.
test('two rolls for one account at once, with a stamp from long ago, roll exactly once', () => race(true));
