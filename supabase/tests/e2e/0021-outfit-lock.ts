/**
 * End to end: saving outfits is serialized per account (supabase/migrations/0153_gear.sql set_outfit; the cosmetics plan, Task 2's review focus).
 * Two connections to the scratch database, each holding a transaction open: one account with ONE copy of a gear and two masks. A saves the copy
 * onto mask 1 and holds its transaction; B's save of it onto mask 2 must wait (it neither sees A's uncommitted piece nor takes the copy), and once
 * A commits, B is refused, so a single copy is never worn twice. Then the same for a retirement: a save waiting on a mask's row lock, while an
 * admin's retire_character holds it, is refused as retired once that commits, and the mask is bare. Run by tools/test-sql.mjs.
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

const piece = (gear: string) => JSON.stringify([{ gear, x: 0.5, y: 0.5, w: 0.3, turn: 0, layer: 0 }]);
const save = (who: string, mask: string, gear: string) => `select set_outfit('${who}', '${mask}', '${piece(gear)}'::jsonb);`;
const waiting = () => Number(sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%set_outfit%'`));
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(ok(), what);
}

test('two saves for two masks of one account never wear one copy twice, and a save waiting on a retirement is refused', async () => {
  const tag = Date.now().toString(36);
  sql(`insert into settings (key, value) values ('cosmetics', '{"gear": {"wornMost": 3, "reach": 0.4}, "trophies": {"shownMost": 3}, "events": {"windowMinutes": 15, "dayMost": 4, "outcomes": {"line": 70, "gear": 20, "card": 10}, "gearRarity": {"common": 80}, "cardRarity": {"common": 80}}}')
    on conflict (key) do nothing`);
  const gear = `lk-${tag}`;
  sql(`insert into gear_kinds (key, rarity) values ('${gear}', 'common')`);
  const ids = sql(`select tests.account('lk-${tag}') || ' ' || tests.account('lka-${tag}')`).split(' ');
  const [who, admin] = ids as [string, string];
  sql(`insert into admins (account) values ('${admin}'); insert into gear_ledger (account, gear, kind) values ('${who}', '${gear}', 'granted')`);
  const m1 = sql(`select tests.character('${who}', 'Lk One ${tag}')`);
  const m2 = sql(`select tests.character('${who}', 'Lk Two ${tag}')`);
  const worn = (m: string) => Number(sql(`select count(*) from gear_worn where character = '${m}'`));
  const a = session();
  const b = session();
  try {
    // One copy, two masks: A holds its save open; B's save waits on it, and is refused when A commits.
    a.send(`begin; select tests.become_service(); ${save(who, m1, gear)}`);
    await a.done();
    assert.equal(worn(m1), 0, 'A\'s piece is not committed yet');
    b.send(`begin; select tests.become_service(); ${save(who, m2, gear)}`);
    await until('B waits on A\'s lock', () => waiting() === 1);
    assert.equal(await b.settled(300), false, 'B answered while A held the copy');
    a.send('commit;');
    await a.done();
    await b.done();
    assert.match(b.err, /"lk-[\w]+" is worn 1 time here, and 0 copies are free/, b.err);
    b.send('rollback;');
    await b.done();
    assert.equal(worn(m1), 1);
    assert.equal(worn(m2), 0, 'one copy was worn twice');

    // A retirement holds the mask's row; a save for it waits, then is refused as retired, and the mask is bare.
    sql(`delete from gear_worn where character = '${m1}'`);
    a.send(`begin; select tests.become('${admin}'); select retire_character('${m2}');`);
    await a.done();
    b.send(`begin; select tests.become_service(); ${save(who, m2, gear)}`);
    await until('B waits on the retirement', () => waiting() === 1);
    assert.equal(await b.settled(300), false, 'B answered while the retirement held the mask');
    a.send('commit;');
    await a.done();
    await b.done();
    assert.match(b.err, /that character is retired/, b.err);
    assert.equal(worn(m2), 0, 'a retired mask was dressed');
  } finally {
    a.close();
    b.close();
  }
});
