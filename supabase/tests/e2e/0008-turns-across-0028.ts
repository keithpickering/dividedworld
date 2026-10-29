/**
 * A Turn waiting across supabase/migrations/0028_loud_classes.sql: asked "revealed" before it, it
 * takes effect after it as asked, announced with its old class named, and an older client's
 * "revealed" still reaches it through turn()'s three-argument form (the class reveal plan, Task 2).
 * On a database of its own, made here beside the scratch one tools/test-sql.mjs made, from the
 * migrations before 0028, so the row is written by the schema that wrote such rows.
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

test('a Turn asked "revealed" before 0028 takes effect after it with its old class named, as asked', () => {
  const scratch = new URL(scratchUrl());
  const name = `${scratch.pathname.slice(1)}_turns`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const db = new URL(scratch);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    const all = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort();
    const before = all.filter((f) => f < '0028');
    assert.ok(all.includes('0028_loud_classes.sql'), 'the migration this holds is there');
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of before) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    // A Turn waiting, asked "revealed" as a client before 0028 asked it.
    // The test instance's settings, as supabase/tests/setup/fixtures.sql writes them.
    const fixtures = fs.readFileSync(path.join(root, 'supabase/tests/setup/fixtures.sql'), 'utf8');
    const settings = fixtures.indexOf('insert into settings');
    psqlOn(db.toString(), fixtures.slice(settings, fixtures.indexOf("');\n", settings) + 3));
    psqlOn(db.toString(), `
      insert into class_kinds (key, name) values ('alpha', 'Alpha'), ('beta', 'Beta');
      insert into boards (slug, name, is_system) values ('general', 'General', false), ('the-system', 'The System', true);
      insert into seasons (number, starts_at) values (1, now() - interval '100 days');
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'old@test.invalid');
      insert into accounts (id) values ('00000000-0000-4000-8000-000000000001');
      insert into characters (id, owner, name, created_at, debuted_at) values
        ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'Asked Before', now() - interval '60 days', now() - interval '60 days'),
        ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'Asked After', now() - interval '60 days', now() - interval '60 days');
      insert into class_history (character, class_key, started_at) values
        ('00000000-0000-4000-8000-0000000000c1', 'alpha', now() - interval '60 days'), ('00000000-0000-4000-8000-0000000000c2', 'alpha', now() - interval '60 days');
      insert into pending_turns (character, class_key, loudness) values ('00000000-0000-4000-8000-0000000000c1', 'beta', 'revealed');`);
    for (const m of all.filter((f) => f >= '0028')) psqlOn(db.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));

    assert.equal(psqlOn(db.toString(), `select loudness || ',' || show_from || ',' || show_to from pending_turns where character = '00000000-0000-4000-8000-0000000000c1'`), 'announced,true,false',
      'a waiting "revealed" Turn becomes announced, naming its old class');
    // An older client, after the migration, asks the same through the three-argument form.
    psqlOn(db.toString(), `
      select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}', false);
      set role authenticated;
      select turn('00000000-0000-4000-8000-0000000000c2', 'beta', 'revealed');
      reset role;`);
    // Two statements: the second sees the tally the first wrote.
    const written = psqlOn(db.toString(), `select masks_change(now() + interval '1 minute')`);
    const tally = JSON.parse(psqlOn(db.toString(), `select payload::text from acts where id = '${written}'`));
    for (const who of ['Asked Before', 'Asked After']) {
      const entry = tally.turns.find((t: { name: string }) => t.name === who);
      assert.equal(entry?.was, 'alpha', `${who}'s Turn names its old class: ${JSON.stringify(tally)}`);
      assert.equal(entry?.class, undefined, `${who}'s Turn names no new class`);
    }
    assert.equal(psqlOn(db.toString(), `select count(*) from acts where kind = 'unmask'`), '0', 'naming the old class alone writes no unmask');
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
