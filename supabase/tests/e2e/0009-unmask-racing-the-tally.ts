/**
 * A reveal racing the tally that applies a pending Turn (supabase/migrations/0027_unmask.sql; the
 * class reveal plan's review focus). A Turn takes effect at the end of the window it was asked in,
 * which the settlement reaches only after that end has passed: a reveal made in between would name
 * the class the Turn is about to replace, dated after the instant the Turn takes effect at, a claim
 * false on its own date once the settlement runs. So it is refused, and comes through once the
 * settlement has run, naming the class the Turn took. Where the window's end is not known in advance
 * and a reveal comes before the run has claimed its window (the round trip, the settle claim design's
 * section 3), the settlement passes the Turn over instead (supabase/migrations/0074_settle_claim.sql),
 * so the reveal stays true on its date. Each on a database of its own, beside the scratch one
 * tools/test-sql.mjs made, since the scratch one's earlier files commit settlements past now.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scratchUrl } from './psql-db.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** A database of its own, with every migration and the fixtures, dropped after `run`. */
function onItsOwnDatabase(suffix: string, run: (db: string) => void) {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_${suffix}`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const db = new URL(scratch);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    const migrations = path.join(root, 'supabase/migrations');
    for (const m of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8'));
    run(db.toString());
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
}

/** A player's character with a Turn to beta waiting, asked two hours before the instant `ago` counts from, and a thread to reveal in. */
function turning(db: string, ago: (hours: number) => string) {
  const ids = psqlOn(db, `
      select a || ',' || c || ',' || t from (select tests.account('racer') a) x,
        lateral (select tests.character(x.a, 'Racing Unmasker', 'alpha', now() - interval '60 days') c) y,
        lateral (select tests.thread('Racing the tally') t) z;`).split('\n').at(-1)!.split(',');
  const [ann, c, t] = ids as [string, string, string];
  const as = (stmt: string) => `
      select set_config('request.jwt.claims', '{"sub": "${ann}", "role": "authenticated"}', false);
      set role authenticated;
      ${stmt}
      reset role;`;
  psqlOn(db, as(`select turn('${c}', 'beta', 'silent', false, false);`));
  psqlOn(db, `update pending_turns set asked_at = ${ago(2)} where character = '${c}';`);
  return { c, t, as };
}

test('a reveal after the window a pending Turn takes effect at has ended, and before its settlement, is refused until it runs', () => {
  onItsOwnDatabase('race', (db) => {
    // Settled to 25 hours ago, in day-long windows: the open window ended an hour ago, and its
    // settlement has not run. A Turn asked two hours ago takes effect at that end.
    // One instant for every statement below, each its own connection with a now() of its own.
    const at = psqlOn(db, `select now()`);
    const ago = (hours: number) => `'${at}'::timestamptz - interval '${hours} hours'`;
    psqlOn(db, `select apply_settlement(${ago(49)}, ${ago(25)}, '[]') is not null;`);
    const { c, t, as } = turning(db, ago);
    assert.ok(psqlOn(db, `select next_settlement_at(${ago(2)}) = ${ago(1)}`) === 't', 'the Turn takes effect at an end already past');

    let refused = '';
    try { psqlOn(db, as(`select unmask('${c}', '${t}', '');`)); } catch (e) { refused = String((e as { stderr?: string }).stderr ?? e); }
    assert.match(refused, /this character's Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn/);
    assert.equal(psqlOn(db, `select count(*) from acts where kind = 'unmask'`), '0', 'nothing was written');

    // The settlement runs; the reveal comes through, naming the class the Turn took, true on its date.
    psqlOn(db, `select apply_settlement(${ago(25)}, ${ago(1)}, '[]');`);
    psqlOn(db, as(`select unmask('${c}', '${t}', '');`));
    assert.equal(psqlOn(db, `select r.class || ',' || (r.class = n.class_key) from class_reveals r cross join lateral class_now(r.character, r.at) n where r.character = '${c}'`), 'beta,true');
  });
});

test('a reveal committed after a season\'s first window has ended, before the run has claimed it, makes the Turn wait for the next settlement', () => {
  onItsOwnDatabase('roundtrip', (db) => {
    // A season's first window, begun 26 hours ago and ended an hour ago, with nothing settled: its end was not known in advance,
    // so no refusal has a known end to read, and the run has not yet claimed the window.
    const at = psqlOn(db, `select now()`);
    const ago = (hours: number) => `'${at}'::timestamptz - interval '${hours} hours'`;
    psqlOn(db, `update seasons set starts_at = ${ago(26)} where ends_at is null;`);
    const { c, t, as } = turning(db, ago);
    assert.equal(psqlOn(db, `select next_settlement_at(now()) is null`), 't', 'the window\'s end is not known in advance');

    // The reveal goes through, in the round trip, naming the class the character holds.
    psqlOn(db, as(`select unmask('${c}', '${t}', '');`));
    psqlOn(db, `select apply_settlement(${ago(26)}, ${ago(1)}, '[]');`);
    assert.equal(psqlOn(db, `select class_key from class_now('${c}', 'infinity')`), 'alpha', 'the Turn did not take effect behind the reveal');
    assert.equal(psqlOn(db, `select due_at = ${ago(1)} from pending_turns where character = '${c}'`), 't', 'the Turn waits, due at the window it was passed over at');
    assert.equal(psqlOn(db, `select r.class || ',' || (r.class = n.class_key) from class_reveals r cross join lateral class_now(r.character, r.at) n where r.character = '${c}'`), 'alpha,true',
      'the reveal names the old class, true on its date');

    // The next settlement lands it.
    psqlOn(db, `select apply_settlement(${ago(1)}, '${at}'::timestamptz + interval '1 hour', '[]');`);
    assert.equal(psqlOn(db, `select class_key from class_now('${c}', 'infinity')`), 'beta', 'the next settlement lands the Turn');
    assert.equal(psqlOn(db, `select count(*) from pending_turns where character = '${c}'`), '0');
    assert.equal(psqlOn(db, `select r.class = n.class_key from class_reveals r cross join lateral class_now(r.character, r.at) n where r.character = '${c}'`), 't',
      'the reveal is still true on its date');
  });
});
