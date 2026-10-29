/**
 * A reveal racing the tally that applies a pending Turn (supabase/migrations/0027_unmask.sql; the
 * class reveal plan's review focus). A Turn takes effect at the end of the window it was asked in,
 * which the settlement reaches only after that end has passed: a reveal made in between would name
 * the class the Turn is about to replace, dated after the instant the Turn takes effect at, a claim
 * false on its own date once the settlement runs. So it is refused, and comes through once the
 * settlement has run, naming the class the Turn took. On a database of its own, beside the scratch
 * one tools/test-sql.mjs made, since the scratch one's earlier files commit settlements past now.
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

test('a reveal after the window a pending Turn takes effect at has ended, and before its settlement, is refused until it runs', () => {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_race`;
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
    // Settled to 25 hours ago, in day-long windows: the open window ended an hour ago, and its
    // settlement has not run. A Turn asked two hours ago takes effect at that end.
    // One instant for every statement below, each its own connection with a now() of its own.
    const at = psqlOn(db.toString(), `select now()`);
    const ago = (hours: number) => `'${at}'::timestamptz - interval '${hours} hours'`;
    const ids = psqlOn(db.toString(), `
      select apply_settlement(${ago(49)}, ${ago(25)}, '[]') is not null;
      select a || ',' || c || ',' || t from (select tests.account('racer') a) x,
        lateral (select tests.character(x.a, 'Racing Unmasker', 'alpha', now() - interval '60 days') c) y,
        lateral (select tests.thread('Racing the tally') t) z;`).split('\n').at(-1)!.split(',');
    const [ann, c, t] = ids as [string, string, string];
    const as = (stmt: string) => `
      select set_config('request.jwt.claims', '{"sub": "${ann}", "role": "authenticated"}', false);
      set role authenticated;
      ${stmt}
      reset role;`;
    psqlOn(db.toString(), as(`select turn('${c}', 'beta', 'silent', false, false);`));
    psqlOn(db.toString(), `update pending_turns set asked_at = ${ago(2)} where character = '${c}';`);
    assert.ok(psqlOn(db.toString(), `select next_settlement_at(${ago(2)}) = ${ago(1)}`) === 't', 'the Turn takes effect at an end already past');

    let refused = '';
    try { psqlOn(db.toString(), as(`select unmask('${c}', '${t}', '');`)); } catch (e) { refused = String((e as { stderr?: string }).stderr ?? e); }
    assert.match(refused, /this character's Turn takes effect at the settlement now due; reveal once it has run/);
    assert.equal(psqlOn(db.toString(), `select count(*) from acts where kind = 'unmask'`), '0', 'nothing was written');

    // The settlement runs; the reveal comes through, naming the class the Turn took, true on its date.
    psqlOn(db.toString(), `select apply_settlement(${ago(25)}, ${ago(1)}, '[]');`);
    psqlOn(db.toString(), as(`select unmask('${c}', '${t}', '');`));
    assert.equal(psqlOn(db.toString(), `select r.class || ',' || (r.class = n.class_key) from class_reveals r cross join lateral class_now(r.character, r.at) n where r.character = '${c}'`), 'beta,true');
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
