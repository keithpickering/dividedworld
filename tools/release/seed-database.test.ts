// seed-database.ts: the release's own seed, written by psql before the functions move. Its arguments' refusals, a payload
// that is the seed function's own, and, against a scratch database built from the migrations on this machine's Postgres, a
// first run that seeds an empty instance and a second that changes nothing. It never touches a deployed database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedArgs, seedSql, seedPayload } from './seed-database.ts';
import { runSeed } from '../../supabase/functions/seed/core.ts';
import { chooseInstance } from '../../supabase/functions/_shared/instance.ts';
import type { Db } from '../../supabase/functions/_shared/rpc.ts';

const TOOL = fileURLToPath(new URL('./seed-database.ts', import.meta.url));
const URL_OK = 'postgres://postgres:s3cret-pw@db.example.supabase.co:5432/postgres';
const NODE = ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', TOOL];

test('--db is required, and has no default', () => {
  for (const argv of [[], ['--profile', 'playtest'], ['--db'], ['--db', '']]) {
    const r = seedArgs(argv);
    assert.ok(r.refusal, `refused ${JSON.stringify(argv)}`);
    assert.match(r.refusal, /--db/);
  }
});

test('an unknown argument, a repeated one and a --profile with no value are refused', () => {
  assert.match(seedArgs(['--db', URL_OK, '--force']).refusal ?? '', /unknown argument --force/);
  assert.match(seedArgs(['--db', URL_OK, '--db', URL_OK]).refusal ?? '', /more than once/);
  assert.match(seedArgs(['--db', URL_OK, '--profile']).refusal ?? '', /--profile/);
  assert.match(seedArgs(['--db', 'mysql://x/y']).refusal ?? '', /postgres:\/\//);
  assert.match(seedArgs(['--db', 'not a url']).refusal ?? '', /postgres:\/\//);
});

test('a refusal never carries the URL or its password', () => {
  const r = seedArgs(['--db', URL_OK, '--bogus']);
  assert.ok(r.refusal && !r.refusal.includes('s3cret-pw') && !r.refusal.includes(URL_OK));
});

test('--profile "" is no profile, and a name is kept', () => {
  assert.deepEqual(seedArgs(['--db', URL_OK, '--profile', '']), { db: URL_OK, profile: '' });
  assert.deepEqual(seedArgs(['--db', URL_OK, '--profile', 'playtest']), { db: URL_OK, profile: 'playtest' });
  assert.deepEqual(seedArgs(['--db', URL_OK]), { db: URL_OK, profile: undefined });
});

test('the SQL carries the payload as one dollar-quoted literal that no payload text can end', () => {
  const payload = { a: '$q$ and $$ and $seed$ inside' };
  const text = seedSql(payload);
  const m = /select seed_instance\(\$(\w+)\$(.*)\$\1\$::jsonb\)/s.exec(text);
  assert.ok(m, 'one select seed_instance($tag$…$tag$::jsonb)');
  assert.deepEqual(JSON.parse(m[2]), payload);
  assert.ok(!m[2].includes(`$${m[1]}$`));
});

for (const profile of [undefined, '', 'playtest']) {
  test(`the payload for profile ${JSON.stringify(profile)} is what runSeed sends`, async () => {
    let sent: unknown;
    const db = { rpc: async (name: string, args: unknown) => { assert.equal(name, 'seed_instance'); sent = (args as { payload: unknown }).payload; throw new Error('stop after the call'); } } as unknown as Db;
    await assert.rejects(runSeed(db, chooseInstance(profile)), /stop after the call/);
    assert.ok(sent, 'runSeed called seed_instance');
    assert.deepEqual(JSON.parse(JSON.stringify(seedPayload(profile))), JSON.parse(JSON.stringify(sent)));
  });
}

test('an unknown profile is refused by chooseInstance, as the function would', () => {
  assert.throws(() => seedPayload('nope'), /profiles are/);
});

test('without --db the tool exits 2 and connects nowhere', () => {
  const r = spawnSync(process.execPath, NODE, { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--db/);
});

/* ---- against this machine's Postgres, in a scratch database ---- */

const ADMIN = process.env.DATABASE_URL;
const local = Boolean(ADMIN) && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(ADMIN as string).hostname);
const skip = local ? false : 'DATABASE_URL does not name this machine';
const scratch = `kayfabb_seeddb_${process.pid}_${Date.now()}`;
const at = (db: string) => { const u = new URL(ADMIN as string); u.pathname = `/${db}`; return u.toString(); };
const sql = (url: string, text: string) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
const run = (...extra: string[]) => spawnSync(process.execPath, [...NODE, '--db', at(scratch), ...extra], { encoding: 'utf8' });
/** Every public table's row count and a hash of its rows, so a second run's effect is read off the tables themselves. */
const picture = () => sql(at(scratch), `
  select string_agg(format('%s %s', t.table_name, x.h), E'\\n' order by t.table_name)
  from information_schema.tables t,
  lateral (select md5(query_to_xml(format('select * from public.%I t order by t::text', t.table_name), false, false, '')::text) as h) x
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE';`);

before(() => {
  if (!local) return;
  sql(at('postgres'), `create database ${scratch};`);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = [`${root}supabase/tests/setup/auth-shim.sql`, ...fs.readdirSync(`${root}supabase/migrations`).filter((f) => f.endsWith('.sql')).sort().map((f) => `${root}supabase/migrations/${f}`)];
  for (const f of files) sql(at(scratch), fs.readFileSync(f, 'utf8'));
});
after(() => { if (local) sql(at('postgres'), `drop database if exists ${scratch} with (force);`); });

test('a run seeds an empty instance, and a second run changes nothing', { skip, timeout: 600_000 }, () => {
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

test('a refusal exits 1 with its reason, and the URL stays out of it', { skip }, () => {
  const r = run('--profile', 'nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /profiles are/);
  assert.ok(!r.stderr.includes('postgres://'));
});
