/**
 * A season revealed before supabase/migrations/0029_reveal_rolls_over.sql keeps its Acts as they were
 * written, every class in them ("Append-only"); a season revealed after it shows only what was made
 * public (the class reveal plan, Task 3). On a database of its own, made here beside the scratch one
 * tools/test-sql.mjs made, from the migrations before 0029 and the test instance's fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scratchUrl } from './psql-db.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const migrations = path.join(root, 'supabase/migrations');
const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

test('a season revealed before 0029 keeps its Acts, every class in them; the next is revealed by the new rule', () => {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_reveal`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const db = new URL(scratch);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    const all = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
    assert.ok(all.includes('0029_reveal_rolls_over.sql'), 'the migration this holds is there');
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of all.filter((f) => f < '0029')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8'));
    // Season 1 revealed before the migration: a character with a silent Turn in it.
    psqlOn(db.toString(), `
      do $$
      declare a uuid := tests.character(tests.account('old-reveal'), 'Revealed Before', 'alpha', '2000-01-02');
      begin
        insert into class_history (character, class_key, started_at) values (a, 'beta', '2000-02-01');
        perform reveal_season('2000-01-01'::timestamptz + span_interval(setting('seasonLength')));
      end $$;`);
    const before = psqlOn(db.toString(), `select jsonb_agg(to_jsonb(a) order by a.seq)::text from acts a where a.kind = 'reveal'`);
    assert.match(before, /"classes": \[\{"from": "[^"]+", "class": "alpha"\}, \{"from": "[^"]+", "class": "beta"\}\]/, 'the old reveal showed every class, the silent Turn among them');
    for (const m of all.filter((f) => f >= '0029')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    assert.equal(psqlOn(db.toString(), `select jsonb_agg(to_jsonb(a) order by a.seq)::text from acts a where a.kind = 'reveal'`), before, 'the earlier season\'s reveal is as it was written');
    // Season 2 revealed after it: the same character, whose player made nothing public, shows no class.
    const after = psqlOn(db.toString(), `
      select reveal_season(starts_at + span_interval(setting('seasonLength'))) is not null from seasons where ends_at is null;
      select a.payload::text from acts a where a.kind = 'reveal' and a.payload ->> 'name' = 'Revealed Before' and a.payload ->> 'season' = '2';`).split('\n').at(-1)!;
    const entry = JSON.parse(after);
    assert.deepEqual(entry.shown, [], 'nothing was made public');
    assert.equal('classes' in entry, false);
    assert.doesNotMatch(after, /alpha|beta/);
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
