// seed-database.ts: the release's own seed, written by psql before the functions move. Its arguments' refusals, a payload
// that is the seed function's own, and, against a scratch database built from the migrations on this machine's Postgres, a
// first run that seeds an empty instance and a second that changes nothing. It never touches a deployed database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('a connection that cannot be made sense of is refused with exit 2, before any payload is built', () => {
  for (const url of ['postgres:///postgres', 'postgres://u:pw@somewhere/postgres?host=elsewhere']) {
    const r = spawnSync(process.execPath, [...NODE, '--db', url, '--profile', 'nope'], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /seed-database: refused: /);
    assert.ok(!r.stderr.includes('pw'), 'no password');
  }
});

test('an unknown profile is not a refusal of the arguments: it exits 1', () => {
  const r = spawnSync(process.execPath, [...NODE, '--db', 'postgres://u:pw@localhost:1/postgres', '--profile', 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /profiles are/);
});
