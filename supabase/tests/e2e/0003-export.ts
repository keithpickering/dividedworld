/**
 * An instance exported and imported into a fresh database is the same instance, table by
 * table ("Portable by construction"; plan Task 15): tools/export-instance.mjs and
 * tools/import-instance.mjs, run as an admin would run them, on the scratch database
 * tools/test-sql.mjs made and on a second one made here from the migrations alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchUrl, sql } from './psql-db.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const migrations = path.join(root, 'supabase/migrations');

const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** Every table of ours and the logins beside them, each as one sorted JSON value. */
const contents = (url: string): Map<string, string> => {
  const tables = psqlOn(url, `select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' union all select 'auth.users' union all select 'auth.identities' where to_regclass('auth.identities') is not null order by 1`).split('\n');
  return new Map(tables.map((t) => [t, psqlOn(url, `select coalesce(jsonb_agg(x order by x::text), '[]')::text from (select to_jsonb(t) x from ${t} t) s`)]));
};

const run = (tool: string, args: string[]) => spawnSync(process.execPath, [path.join(root, 'tools', tool), ...args], { encoding: 'utf8' });

test('an instance exported and imported into a fresh database is the same instance, table by table', () => {
  const from = scratchUrl();
  // A cast with every kind of thing in it: players, characters, Acts, reactions, cards and
  // their state, invites, a settlement (e2e/0001 settled), and a reveal.
  sql(`
    do $$
    declare
      ann uuid := tests.account('exp-ann'); bob uuid := tests.account('exp-bob');
      a uuid := tests.character(ann, 'Exported A'); b uuid := tests.character(bob, 'Exported B');
      t uuid := tests.thread('Exported thread');
      p uuid := tests.post(a, t, 'Carried across, with a backslash \\ and a tab' || chr(9) || 'and a line' || chr(10) || 'break.');
      play uuid;
    begin
      insert into reactions (act, reactor_account, reactor_character, kind, slot) values (p, bob, b, 'up', 1);
      insert into reaction_tallies (act, kind, count) values (p, 'up', 1);
      insert into wallets (account, balance) values (ann, 0) on conflict (account) do nothing;
      insert into card_ledger (account, card, kind, price) values (ann, 'splat', 'bought', 100);
      insert into invites (code_hash, inviter) values (invite_hash('exported'), ann);
      insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, p, '{"card": "splat", "config": {"color": "red"}}') returning id into play;
      insert into effect_state (play, state, saved_by) values (play, '{"strokes": []}', b);
      update seasons set starts_at = least(starts_at, now() - interval '200 days') where ends_at is null;
      perform reveal_season();
    end $$;
    -- A table holding what the instance's own do not yet: a type whose name has a comma, an
    -- array, an astral character. Made here and in the fresh database alike.
    create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);
    insert into public.export_probe values (1, 12.50, array['a,b', 'q"uote', null], 'astral 😀 and \\. alone');`);
  const before = contents(from);
  for (const t of ['public.accounts', 'public.characters', 'public.class_history', 'public.acts', 'public.reactions', 'public.card_ledger', 'public.effect_state',
    'public.invites', 'public.settlements', 'public.ledger', 'public.wallet_events', 'public.seasons', 'auth.users']) {
    assert.notEqual(before.get(t), '[]', `${t} should hold something to carry across`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-export-'));
  const fresh = new URL(from);
  const name = `${fresh.pathname.slice(1)}_imported`;
  const server = new URL(from);
  server.pathname = '/postgres';
  fresh.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    // Each tool names the database it touches and refuses one a URL does not name.
    const unnamed = new URL(from);
    unnamed.pathname = '';
    const nowhere = run('export-instance.mjs', ['--from', unnamed.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(nowhere.status, 0);
    assert.match(nowhere.stderr, /names no database/);
    const steered = run('export-instance.mjs', ['--from', `${from}?host=elsewhere`, '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(steered.status, 0);
    assert.match(steered.stderr, /host/);
    // A password never reaches the terminal, even one libpq would quote back, nor psql's command line.
    const secret = new URL(from);
    secret.password = 'sEcReT%zz';
    const leaked = run('export-instance.mjs', ['--from', secret.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(leaked.status, 0);
    assert.doesNotMatch(leaked.stdout + leaked.stderr, /sEcReT/);
    const wrong = new URL(from);
    wrong.password = 'sEcReTwrong';
    wrong.username = 'nobody_here';
    const refusedLogin = run('export-instance.mjs', ['--from', wrong.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(refusedLogin.status, 0);
    assert.doesNotMatch(refusedLogin.stdout + refusedLogin.stderr, /sEcReT/);
    assert.match(run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'back\\slash')]).stderr, /backslash/);
    fs.rmSync(path.join(dir, 'nowhere'), { recursive: true, force: true });

    const exported = run('export-instance.mjs', ['--from', from, '--to', dir]);
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    assert.match(exported.stdout, /exporting from localhost:\d+\/kayfabb_scratch/);
    assert.match(exported.stdout, /the server says it is kayfabb_scratch\w+ on port \d+/);
    assert.match(exported.stdout, /kayfabb_functions_url.*kayfabb_service_key/s, 'both Vault secrets are named as not exported');
    const again = run('export-instance.mjs', ['--from', from, '--to', dir]);
    assert.notEqual(again.status, 0, 'an export into a directory that is not empty');
    assert.doesNotMatch(exported.stdout + exported.stderr, /pg@|password/i, 'the export printed a secret');

    // The fresh instance: the shim and the migrations, nothing seeded.
    psqlOn(fresh.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) psqlOn(fresh.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    psqlOn(fresh.toString(), 'create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);');

    // The export is as private as the database: no file in it is readable by anyone else.
    for (const f of fs.readdirSync(dir)) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o077, 0, `${f} is readable by others`);

    // A short file is refused, naming the table, and leaves the database as it was.
    const short = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-short-'));
    for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(short, f));
    fs.writeFileSync(path.join(short, 'public.invites.jsonl'), '');
    const shorted = run('import-instance.mjs', ['--from', short, '--to', fresh.toString()]);
    assert.notEqual(shorted.status, 0);
    assert.match(shorted.stderr, /public\.invites/);
    // A row whose account is not in the export (a lost line, the manifest's count made to agree) is refused by its foreign key.
    const accounts = fs.readFileSync(path.join(dir, 'public.accounts.jsonl'), 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(path.join(short, 'public.invites.jsonl'), fs.readFileSync(path.join(dir, 'public.invites.jsonl')));
    fs.writeFileSync(path.join(short, 'public.accounts.jsonl'), accounts.slice(1).join('\n') + '\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(short, 'manifest.json'), 'utf8'));
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').rows -= 1;
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    const orphaned = run('import-instance.mjs', ['--from', short, '--to', fresh.toString()]);
    assert.notEqual(orphaned.status, 0);
    assert.match(orphaned.stderr, /references a row the export does not hold/);
    // A file the manifest names outside the export is refused.
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').file = '../elsewhere.jsonl';
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match(run('import-instance.mjs', ['--from', short, '--to', fresh.toString()]).stderr, /names a file/);
    fs.rmSync(short, { recursive: true, force: true });
    assert.equal(psqlOn(fresh.toString(), 'select count(*) from public.accounts'), '0', 'a refused import left rows behind');

    const imported = run('import-instance.mjs', ['--from', dir, '--to', fresh.toString()]);
    assert.equal(imported.status, 0, imported.stderr + imported.stdout);
    const after = contents(fresh.toString());
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [t, rows] of before) assert.equal(after.get(t), rows, `${t} differs after the round trip`);

    // The imported instance goes on: each identity column's next value is past every row it holds.
    const identities = psqlOn(fresh.toString(), `
      select format('public.%I', c.relname), quote_ident(a.attname), pg_get_serial_sequence(format('public.%I', c.relname), a.attname)
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attidentity <> ''`).split('\n').filter(Boolean).map((l) => l.split('|'));
    assert.ok(identities.length >= 5, 'the identity columns are found');
    const behind = identities.filter(([table, column, sequence]) =>
      psqlOn(fresh.toString(), `select case when (select is_called from ${sequence}) then (select last_value from ${sequence}) else 0 end < coalesce((select max(${column}) from ${table}), 0)`) === 't')
      .map(([table, column]) => `${table}.${column}`).join(', ');
    assert.equal(behind, '', `identity columns behind their rows: ${behind}`);

    // The jobs that run the instance are there: the reveal's from its migration, the
    // settlement's from the imported settings.
    assert.equal(psqlOn(fresh.toString(), `select string_agg(jobname, ',' order by jobname) from cron.job where jobname like 'kayfabb-%'`), 'kayfabb-reveal,kayfabb-settle');

    // And a second import onto what is no longer a fresh instance is refused, naming why.
    const twice = run('import-instance.mjs', ['--from', dir, '--to', fresh.toString()]);
    assert.notEqual(twice.status, 0);
    assert.match(twice.stderr, /not empty/);
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
