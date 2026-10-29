/**
 * An instance exported and imported into a fresh database is the same instance, table by
 * table ("Portable by construction"; plan Task 15): tools/export-instance.mjs and
 * tools/import-instance.mjs, run as an admin would run them, on the scratch database
 * tools/test-sql.mjs made and on a second one made here from the migrations alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchUrl, sql } from './psql-db.ts';

/** The tables the migrations fill themselves (tools/instance-files.mjs), held below to what a fresh database holds. */
const files = '../../../tools/instance-files.mjs';
const { MIGRATION_DATA } = (await import(files)) as { MIGRATION_DATA: readonly string[] };

const root = path.resolve(import.meta.dirname, '../../..');
const migrations = path.join(root, 'supabase/migrations');

const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** Every table of ours and the logins beside them, each as one sorted JSON value. */
const contents = (url: string): Map<string, string> => {
  const tables = psqlOn(url, `select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' union all select 'auth.users' union all select 'auth.identities' where to_regclass('auth.identities') is not null order by 1`).split('\n');
  return new Map(tables.map((t) => [t, psqlOn(url, `select coalesce(jsonb_agg(x order by x::text), '[]')::text from (select to_jsonb(t) x from ${t} t) s`)]));
};

/** The service key a tool calls Storage with: in its environment, never on its command line, and never printed. */
const STORAGE_KEY = 'sErViCe-kEy-for-storage';
/** A tool, run as an admin runs it; spawned, not run synchronously, so the fake Storage below answers it. */
const run = (tool: string, args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'tools', tool), ...args], { env: { ...process.env, KAYFABB_STORAGE_KEY: STORAGE_KEY } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

/** Supabase Storage's two object endpoints, in memory: each server is one project's buckets. */
async function fakeStorage() {
  const objects = new Map<string, Buffer>();
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization === `Bearer ${STORAGE_KEY}` ? 'keyed' : 'unkeyed'}`);
      const m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(req.url ?? '');
      if (!m || req.headers.authorization !== `Bearer ${STORAGE_KEY}`) { res.writeHead(403).end(); return; }
      const key = `${m[1]}/${decodeURIComponent(m[2]!)}`;
      if (req.method === 'GET') { const o = objects.get(key); if (!o) { res.writeHead(404).end(); return; } res.writeHead(200).end(o); return; }
      if (req.method === 'POST') { if (objects.has(key)) { res.writeHead(409).end(); return; } objects.set(key, Buffer.concat(chunks)); res.writeHead(200).end('{}'); return; }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, objects, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('an instance exported and imported into a fresh database is the same instance, table by table', async () => {
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
      -- What the screens keep: a release, reading, view counts, preferences, a profile with an
      -- avatar, and an admin.
      insert into effect_releases (account, play) values (bob, play);
      insert into reading (account, thread, furthest_seq, first_character) values (bob, t, 1, b);
      perform count_thread_views();
      insert into account_preferences (account, theme, postbit, motion) values (ann, 'dark', 'stacked', 'reduce');
      insert into character_profiles (character, title, signature, avatar_source, avatar_square, avatar_portrait, square_frame, portrait_frame)
      values (a, 'Exported', '[b]sig[/b]', 'exp-src.webp', 'exp-sq.webp', 'exp-pt.webp', '{"x": 0, "y": 0, "w": 1, "h": 1}', '{"x": 0, "y": 0, "w": 0.5, "h": 1}');
      insert into admins (account) values (ann);
      -- The open season revealed at its end, as the settlement of its last window would.
      perform reveal_season((select starts_at from seasons where ends_at is null) + span_interval(setting('seasonLength')));
    end $$;
    -- A table holding what the instance's own do not yet: a type whose name has a comma, an
    -- array, an astral character. Made here and in the fresh database alike.
    create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);
    insert into public.export_probe values (1, 12.50, array['a,b', 'q"uote', null], 'astral 😀 and \\. alone');`);
  const before = contents(from);
  for (const t of ['public.accounts', 'public.characters', 'public.class_history', 'public.acts', 'public.reactions', 'public.card_ledger', 'public.effect_state',
    'public.invites', 'public.settlements', 'public.paid_votes', 'public.ledger', 'public.wallet_events', 'public.seasons', 'auth.users',
    'public.effect_releases', 'public.reading', 'public.thread_view_counts', 'public.view_count_runs', 'public.account_preferences',
    'public.character_profiles', 'public.pip_styles', 'public.admins']) {
    assert.notEqual(before.get(t), '[]', `${t} should hold something to carry across`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-export-'));
  const fresh = new URL(from);
  const name = `${fresh.pathname.slice(1)}_imported`;
  const server = new URL(from);
  server.pathname = '/postgres';
  fresh.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  // The old project's Storage holds the avatar's three files; the new project's starts empty.
  const oldStore = await fakeStorage();
  const newStore = await fakeStorage();
  const avatar = { 'avatars/exp-src.webp': Buffer.from('RIFF-src'), 'avatars/exp-sq.webp': Buffer.from('RIFF-sq'), 'avatars/exp-pt.webp': Buffer.from('RIFF-pt') };
  for (const [k, v] of Object.entries(avatar)) oldStore.objects.set(k, v);
  try {
    // Each tool names the database it touches and refuses one a URL does not name.
    const unnamed = new URL(from);
    unnamed.pathname = '';
    const nowhere = await run('export-instance.mjs', ['--from', unnamed.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(nowhere.status, 0);
    assert.match(nowhere.stderr, /names no database/);
    const steered = await run('export-instance.mjs', ['--from', `${from}?host=elsewhere`, '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(steered.status, 0);
    assert.match(steered.stderr, /host/);
    // A password never reaches the terminal, even one libpq would quote back, nor psql's command line.
    const secret = new URL(from);
    secret.password = 'sEcReT%zz';
    const leaked = await run('export-instance.mjs', ['--from', secret.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(leaked.status, 0);
    assert.doesNotMatch(leaked.stdout + leaked.stderr, /sEcReT/);
    const wrong = new URL(from);
    wrong.password = 'sEcReTwrong';
    wrong.username = 'nobody_here';
    const refusedLogin = await run('export-instance.mjs', ['--from', wrong.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(refusedLogin.status, 0);
    assert.doesNotMatch(refusedLogin.stdout + refusedLogin.stderr, /sEcReT/);
    assert.match((await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'back\\slash')])).stderr, /backslash/);
    fs.rmSync(path.join(dir, 'nowhere'), { recursive: true, force: true });

    // An instance holding files is not exported without them.
    const without = await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'without')]);
    assert.notEqual(without.status, 0);
    assert.match(without.stderr, /holds files: give --storage/);
    assert.equal(fs.existsSync(path.join(dir, 'without')), false, 'refused before anything was written');
    const exported = await run('export-instance.mjs', ['--from', from, '--to', dir, '--storage', oldStore.url]);
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    assert.match(exported.stdout, /exporting from localhost:\d+\/kayfabb_scratch/);
    assert.match(exported.stdout, /the server says it is kayfabb_scratch\w+ on port \d+/);
    assert.match(exported.stdout, /kayfabb_functions_url.*kayfabb_service_key/s, 'both Vault secrets are named as not exported');
    const again = await run('export-instance.mjs', ['--from', from, '--to', dir, '--storage', oldStore.url]);
    assert.notEqual(again.status, 0, 'an export into a directory that is not empty');
    assert.doesNotMatch(exported.stdout + exported.stderr, /pg@|password/i, 'the export printed a secret');
    assert.ok(!(exported.stdout + exported.stderr).includes(STORAGE_KEY), 'the export printed the Storage key');
    for (const [k, v] of Object.entries(avatar)) assert.deepEqual(fs.readFileSync(path.join(dir, 'files', k)), v, `${k} is carried`);
    assert.ok(oldStore.seen.every((r) => r.startsWith('GET') && r.endsWith('keyed')), oldStore.seen.join('\n'));

    // The fresh instance: the shim and the migrations, nothing seeded.
    psqlOn(fresh.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) psqlOn(fresh.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    // The tables a fresh, migrated database already holds rows in are the ones the export leaves
    // to the migrations (MIGRATION_DATA): one more, and every import would be refused as not empty.
    const filled = psqlOn(fresh.toString(), `select string_agg(name, ',' order by name) from (select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public') t
      where (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %s', name), false, true, '')))[1]::text::bigint > 0`);
    assert.equal(filled, [...MIGRATION_DATA].sort().join(','), 'the tables the migrations fill are MIGRATION_DATA');
    psqlOn(fresh.toString(), 'create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);');

    // The export is as private as the database: no file in it is readable by anyone else.
    for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o077, 0, `${f} is readable by others`);

    // A short file is refused, naming the table, and leaves the database as it was.
    const short = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-short-'));
    fs.cpSync(dir, short, { recursive: true });
    fs.writeFileSync(path.join(short, 'public.invites.jsonl'), '');
    const shorted = await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.notEqual(shorted.status, 0);
    assert.match(shorted.stderr, /public\.invites/);
    // A row whose account is not in the export (a lost line, the manifest's count made to agree) is refused by its foreign key.
    const accounts = fs.readFileSync(path.join(dir, 'public.accounts.jsonl'), 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(path.join(short, 'public.invites.jsonl'), fs.readFileSync(path.join(dir, 'public.invites.jsonl')));
    fs.writeFileSync(path.join(short, 'public.accounts.jsonl'), accounts.slice(1).join('\n') + '\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(short, 'manifest.json'), 'utf8'));
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').rows -= 1;
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    const orphaned = await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.notEqual(orphaned.status, 0);
    assert.match(orphaned.stderr, /references a row the export does not hold/);
    // A file the manifest names outside the export is refused.
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').file = '../elsewhere.jsonl';
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /names a file/);
    // An export made at another release of the name folds is refused: its characters' name keys
    // are that release's (supabase/migrations/0010_name_folds.sql). The folds themselves are the
    // migrations', not the instance's, and are not carried.
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').file = 'public.accounts.jsonl';
    assert.ok(manifest.nameFolds?.confusables, 'the export names its release of the name folds');
    assert.ok(!manifest.tables.some((t: { name: string }) => t.name === 'public.name_maps' || t.name === 'public.unicode_data'), 'the name folds are not exported');
    const folds = manifest.nameFolds;
    manifest.nameFolds = { ...folds, confusables: { ...folds.confusables, version: '1.0.0' } };
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /name folds/);
    manifest.nameFolds = { ...folds, confusables: { ...folds.confusables, sha256: '0'.repeat(64) } };
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /name folds/, 'the same release from other files is another release');
    // A character whose carried key is not its name's is refused: an import keys every name again.
    // From a clean copy of the export, but for that one row.
    for (const f of ['manifest.json', 'public.accounts.jsonl']) fs.copyFileSync(path.join(dir, f), path.join(short, f));
    const characters = fs.readFileSync(path.join(dir, 'public.characters.jsonl'), 'utf8').split('\n').filter(Boolean);
    for (const key of ['name_key', 'name_look']) {
      const forged = JSON.parse(characters[0]!);
      forged[key] = 'not its name';
      fs.writeFileSync(path.join(short, 'public.characters.jsonl'), [JSON.stringify(forged), ...characters.slice(1)].join('\n') + '\n');
      assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /edited after it was made/, key);
    }
    // An export from before the folds were carried names none, and is told so plainly.
    const none = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    delete none.nameFolds;
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(none));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /names no release of the name folds/);
    fs.copyFileSync(path.join(dir, 'manifest.json'), path.join(short, 'manifest.json'));
    fs.writeFileSync(path.join(short, 'public.characters.jsonl'), characters.join('\n') + '\n');
    fs.rmSync(short, { recursive: true, force: true });
    assert.equal(psqlOn(fresh.toString(), 'select count(*) from public.accounts'), '0', 'a refused import left rows behind');

    // A carried file that is not the one exported, and one no row names, are refused before anything is written.
    const tampered = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-tampered-'));
    fs.cpSync(dir, tampered, { recursive: true });
    fs.writeFileSync(path.join(tampered, 'files', 'avatars', 'exp-sq.webp'), 'RIFF-other');
    assert.match((await run('import-instance.mjs', ['--from', tampered, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /exp-sq\.webp is not the file the export made/);
    // A carried file no row names, and a row naming a file the export does not carry.
    fs.writeFileSync(path.join(tampered, 'files', 'avatars', 'exp-sq.webp'), avatar['avatars/exp-sq.webp']);
    const carried = JSON.parse(fs.readFileSync(path.join(tampered, 'manifest.json'), 'utf8'));
    fs.writeFileSync(path.join(tampered, 'files', 'avatars', 'stray.webp'), 'RIFF-stray');
    fs.writeFileSync(path.join(tampered, 'manifest.json'), JSON.stringify({ ...carried, files: [...carried.files, { bucket: 'avatars', name: 'stray.webp', bytes: 10, sha256: 'x' }] }));
    assert.match((await run('import-instance.mjs', ['--from', tampered, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /carries avatars\/stray\.webp, which no row names/);
    fs.writeFileSync(path.join(tampered, 'manifest.json'), JSON.stringify({ ...carried, files: carried.files.filter((f: { name: string }) => f.name !== 'exp-pt.webp') }));
    assert.match((await run('import-instance.mjs', ['--from', tampered, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /a row names avatars\/exp-pt\.webp, which the export does not carry/);
    fs.rmSync(tampered, { recursive: true, force: true });
    // A file already in the new project under a name the export carries, with other bytes, is refused.
    newStore.objects.set('avatars/exp-src.webp', Buffer.from('RIFF-someone-else'));
    assert.match((await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /exp-src\.webp is already there, and is another file/);
    // The refused imports above put some files in already; the same files again are the same files.
    newStore.objects.delete('avatars/exp-src.webp');
    const imported = await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.equal(imported.status, 0, imported.stderr + imported.stdout);
    const after = contents(fresh.toString());
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [t, rows] of before) assert.equal(after.get(t), rows, `${t} differs after the round trip`);
    // And every file its rows name is in the new project's Storage, byte for byte.
    assert.deepEqual(new Map(newStore.objects), new Map(Object.entries(avatar)));
    assert.ok(!(imported.stdout + imported.stderr).includes(STORAGE_KEY), 'the import printed the Storage key');

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

    // The jobs that run the instance are there, each scheduled from the imported settings: the
    // settlement's and the view count's.
    assert.equal(psqlOn(fresh.toString(), `select string_agg(jobname, ',' order by jobname) from cron.job where jobname like 'kayfabb-%'`), 'kayfabb-settle,kayfabb-view-counts');

    // And a second import onto what is no longer a fresh instance is refused, naming why.
    const twice = await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.notEqual(twice.status, 0);
    assert.match(twice.stderr, /not empty/);
  } finally {
    await oldStore.close();
    await newStore.close();
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
