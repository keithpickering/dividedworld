/**
 * End to end: showing a trophy and taking it back are serialized (supabase/migrations/0154_trophies.sql show_trophies and reverse_award; the cosmetics plan, Task 3's
 * review focus). Two connections to the scratch database, each holding a transaction open: A, an admin, reverses an award and holds its transaction; B's show_trophies of that
 * award must wait (it neither sees A's uncommitted reversal nor takes the award past it), and once A commits, B is refused as taken back, so no reversed award is ever shown.
 * Two `for share` locks never wait on each other, so only a stronger lock in show_trophies makes B wait; a single session cannot test it. Run by tools/test-sql.mjs.
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
    get err() { return err; },
    close() { child.stdin.end(); child.kill(); },
  };
}

const waiting = () => Number(sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%show_trophies%'`));
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
}

test('a show waiting on a reversal is refused once it commits, and no reversed award is shown', async () => {
  const tag = Date.now().toString(36);
  sql(`insert into settings (key, value) values ('cosmetics', '{"gear": {"wornMost": 3, "reach": 0.4}, "trophies": {"shownMost": 3}, "events": {"windowMinutes": 15, "dayMost": 4, "outcomes": {"line": 70, "gear": 20, "card": 10}, "gearRarity": {"common": 80}, "cardRarity": {"common": 80}}}')
    on conflict (key) do nothing`);
  const kind = `sv-${tag}`;
  sql(`insert into trophy_kinds (key, name) values ('${kind}', 'Sv ${tag}')`);
  const [who, admin] = sql(`select tests.account('sv-${tag}') || ' ' || tests.account('sva-${tag}')`).split(' ') as [string, string];
  sql(`insert into admins (account) values ('${admin}')`);
  const mask = sql(`select tests.character('${who}', 'Sv One ${tag}')`);
  const award = sql(`insert into trophy_awards (trophy, character, by) values ('${kind}', '${mask}', 'admin') returning id`).split('\n')[0]!;
  const shown = () => Number(sql(`select count(*) from trophies_shown where character = '${mask}'`));
  const a = session();
  const b = session();
  try {
    a.send(`begin; select tests.become('${admin}'); select reverse_award('${award}');`);
    await a.done();
    b.send(`begin; select tests.become_service(); select show_trophies('${who}', '${mask}', array['${award}']::uuid[]);`);
    await until('B waits on A\'s reversal', () => waiting() === 1);
    assert.equal(await b.settled(300), false, 'B answered while A held the award');
    a.send('commit;');
    await a.done();
    await b.done();
    assert.match(b.err, /that trophy has been taken back/, b.err);
    b.send('rollback;');
    await b.done();
    assert.equal(shown(), 0, 'a reversed award was shown');
  } finally {
    a.close();
    b.close();
  }
});
