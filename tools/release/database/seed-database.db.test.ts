// seed-database.ts against this machine's Postgres, in a scratch database built from the migrations: a run seeds an empty
// instance, a second run changes nothing, and a real psql failure exits 1 with its reason and no URL. Outside test:engine,
// which has no database: `npm run test:release-db`, run by rehearsal.yml, whose job has the Postgres service. Throws, never
// skips, when DATABASE_URL is unset or names another machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error test-sql.mjs is untyped JavaScript
import { LOCAL_HOSTS, migrationFiles } from '../../test-sql.mjs';

const ADMIN = process.env.DATABASE_URL;
if (!ADMIN) throw new Error('DATABASE_URL is not set (postgres://postgres:pg@localhost:5432/postgres)');
if (!LOCAL_HOSTS.has(new URL(ADMIN).hostname)) throw new Error(`refusing DATABASE_URL on host "${new URL(ADMIN).hostname}": this test creates and drops a database, and reads only Postgres on localhost`);

const TOOL = fileURLToPath(new URL('../seed-database.ts', import.meta.url));
const NODE = ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', TOOL];
const scratch = `kayfabb_seeddb_${process.pid}_${Date.now()}`;
const at = (db: string, password?: string) => { const u = new URL(ADMIN); u.pathname = `/${db}`; if (password) u.password = password; return u.toString(); };
const sql = (url: string, text: string) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
const run = (...extra: string[]) => spawnSync(process.execPath, [...NODE, '--db', at(scratch), ...extra], { encoding: 'utf8' });
/** A hash of every public table's rows, so a second run's effect is read off the tables themselves. */
const picture = () => sql(at(scratch), `
  select string_agg(format('%s %s', t.table_name, x.h), E'\\n' order by t.table_name)
  from information_schema.tables t,
  lateral (select md5(query_to_xml(format('select * from public.%I t order by t::text', t.table_name), false, false, '')::text) as h) x
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE';`);

before(() => {
  sql(at('postgres'), `create database ${scratch};`);
  for (const f of migrationFiles() as string[]) sql(at(scratch), fs.readFileSync(f, 'utf8'));
});
after(() => { sql(at('postgres'), `drop database if exists ${scratch} with (force);`); });

test('a run seeds an empty instance, and a second run changes nothing', { timeout: 600_000 }, () => {
  assert.equal(sql(at(scratch), 'select count(*) from card_kinds'), '0', 'the instance starts empty');
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /localhost/);
  assert.ok(!first.stdout.includes('postgres://') && !first.stdout.includes(':pg@'), 'no URL is printed');
  assert.ok(Number(sql(at(scratch), 'select count(*) from card_kinds')) > 0, 'the cards were written');
  assert.ok(Number(sql(at(scratch), 'select count(*) from settings')) > 0, 'the settings were written');
  assert.equal(sql(at(scratch), 'select count(*) from settings where tuned_at is not null'), '0', 'a seed through psql marks no row tuned');
  const afterFirst = picture();
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(picture(), afterFirst, 'the second run changed no row');
  assert.equal(sql(at(scratch), 'select count(*) from settings where tuned_at is not null'), '0');
  assert.equal(second.stdout, first.stdout, 'and printed the same counts');
});

test('an unknown profile exits 1 with its reason, and the URL stays out of it', () => {
  const r = run('--profile', 'nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /profiles are/);
  assert.ok(!r.stderr.includes('postgres://'));
});

test('a real psql failure exits 1 with the database\'s words, and neither the URL nor the password', () => {
  // The admin database has no seed_instance, so psql itself answers with an error.
  const r = spawnSync(process.execPath, [...NODE, '--db', at('postgres', 'pg')], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /does not exist/);
  assert.ok(!r.stderr.includes('postgres://'), 'no URL');
  assert.ok(!r.stdout.includes('postgres://'), 'no URL on stdout');
  assert.ok(!/(^|[^a-z])pg@|:pg\b/.test(r.stderr), 'no password');
});
