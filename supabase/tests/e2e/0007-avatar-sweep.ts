/**
 * The avatars bucket swept (tools/sweep-avatars.mjs; supabase/migrations/0025_avatars.sql): every
 * file no profile names and written more than an hour ago is removed, the originals 0025 listed in
 * avatar_orphans first, and a file named, or stored a moment before its profile is written, is
 * kept. And 0025 itself, run on a database that already holds profiles with an original: each
 * original is listed for the sweep, and each profile keeps its crops. The clues plan, Task 4.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { scratchUrl, sql } from './psql-db.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const STORAGE_KEY = 'sWeEp-kEy-for-storage';
const HOUR = 60 * 60 * 1000;

const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const run = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'tools/sweep-avatars.mjs'), ...args], { env: { ...process.env, KAYFABB_STORAGE_KEY: STORAGE_KEY, KAYFABB_STORAGE_TIMEOUT_MS: '500' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

/** Supabase Storage's list and remove endpoints for one bucket, in memory, each file with when it was written. */
async function fakeStorage() {
  const objects = new Map<string, string>();
  /** What the next requests meet first: a 503. */
  const trouble: 'unavailable'[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (trouble.shift() === 'unavailable') { res.writeHead(503).end(); return; }
      if (req.headers.authorization !== `Bearer ${STORAGE_KEY}`) { res.writeHead(403).end(); return; }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      if (req.method === 'POST' && req.url === '/storage/v1/object/list/avatars') {
        // As Storage lists a bucket: a folder among the files, with no id and no times.
        const all = [...objects, ['a-folder', null] as const].sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([name, at]) => (at === null ? { name, id: null, created_at: null, updated_at: null } : { name, id: `id-${name}`, created_at: at, updated_at: at }));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(all.slice(body.offset, body.offset + body.limit)));
        return;
      }
      if (req.method === 'DELETE' && req.url === '/storage/v1/object/avatars') {
        const gone = (body.prefixes as string[]).filter((n) => objects.delete(n));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(gone.map((name) => ({ name }))));
        return;
      }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, objects, trouble, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test('the sweep removes each file no profile names that was written over an hour ago, the originals 0025 listed first, and keeps the rest', async () => {
  sql(`
    do $$
    declare
      ann uuid := tests.account('sweep-ann');
      a uuid := tests.character(ann, 'Swept Avatar');
    begin
      insert into character_profiles (character, avatar_square, avatar_portrait, square_frame, portrait_frame)
      values (a, 'named-sq.webp', 'named-pt.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 1, "h": 1}');
      insert into avatar_orphans (key) values ('original.webp');
    end $$;`);
  const store = await fakeStorage();
  const old = new Date(Date.now() - 2 * HOUR).toISOString();
  for (const name of ['named-sq.webp', 'named-pt.webp', 'stale.webp', 'original.webp']) store.objects.set(name, old);
  // Stored a moment ago, its profile not yet written.
  store.objects.set('new.webp', new Date(Date.now() - 5 * 60 * 1000).toISOString());
  // Just under the hour is kept; an original is removed whatever its age.
  store.objects.set('nearly.webp', new Date(Date.now() - HOUR + 60 * 1000).toISOString());
  // More than a page of a listing, each old and unnamed; and Storage unavailable once, at first.
  for (let i = 0; i < 1005; i++) store.objects.set(`bulk-${String(i).padStart(4, '0')}.webp`, old);
  store.trouble.push('unavailable');
  try {
    const out = await run(['--from', scratchUrl(), '--storage', store.url]);
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.match(out.stdout, /sweeping avatars in http:\/\/127\.0\.0\.1:\d+, named by localhost:\d+\/kayfabb_scratch/);
    assert.ok(![...store.objects.keys()].some((k) => k.startsWith('bulk-')), 'every page of the listing is swept');
    assert.ok(!(out.stdout + out.stderr).includes(STORAGE_KEY), 'the sweep printed the Storage key');
    assert.ok(!store.objects.has('stale.webp'), 'a file no row names, older than an hour, is removed');
    assert.ok(!store.objects.has('original.webp'), 'an original 0025 listed is removed');
    assert.ok(store.objects.has('new.webp'), 'a new unnamed file is kept');
    assert.ok(store.objects.has('nearly.webp'), 'an unnamed file written under an hour ago is kept');
    assert.ok(store.objects.has('named-sq.webp') && store.objects.has('named-pt.webp'), 'a named file is kept');
    assert.equal(sql(`select count(*) from avatar_orphans where key = 'original.webp'`), '0', 'an original removed leaves the list');
    // Run again, it finds nothing more to take.
    const again = await run(['--from', scratchUrl(), '--storage', store.url]);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual([...store.objects.keys()].sort(), ['named-pt.webp', 'named-sq.webp', 'nearly.webp', 'new.webp']);
    // Without Storage, or without its key, it refuses before it reads anything.
    assert.match((await run(['--from', scratchUrl()])).stderr, /usage/);
  } finally {
    await store.close();
  }
});

test('0025 on a database holding profiles with an original lists each original for the sweep, and keeps each profile\'s crops; a sweep from a database naming no avatar is refused', async () => {
  const from = new URL(scratchUrl());
  const name = `${from.pathname.slice(1)}_avatars`;
  const server = new URL(from);
  server.pathname = '/postgres';
  const db = new URL(from);
  db.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  try {
    psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const at = migrations.indexOf('0025_avatars.sql');
    assert.ok(at > 0);
    for (const m of migrations.slice(0, at)) psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/migrations', m), 'utf8'));
    // Profiles as PR #9 wrote them: an original with two crops, and an original with a square alone.
    psqlOn(db.toString(), `
      insert into pip_styles (key, name, full_image, empty_image) values ('default', 'Default', 'f', 'e');
      insert into settings (key, value) values ('charactersPerPlayer', '6');
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'old-avatar@test.invalid');
      insert into accounts (id) values ('00000000-0000-4000-8000-000000000001');
      insert into characters (id, owner, name, debuted_at) values
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Two Crops', now()),
        ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'Square Alone', now());
      insert into character_profiles (character, avatar_source, avatar_square, avatar_portrait, square_frame, portrait_frame) values
        ('00000000-0000-4000-8000-0000000000a1', 'src-1.webp', 'sq-1.webp', 'pt-1.webp', '{"x": 0, "y": 0, "w": 0.5, "h": 0.5}', '{"x": 0, "y": 0, "w": 0.5, "h": 1}'),
        ('00000000-0000-4000-8000-0000000000a2', 'src-2.webp', 'sq-2.webp', null, '{"x": 0, "y": 0, "w": 0.5, "h": 0.5}', null);`);
    for (const m of migrations.slice(at)) psqlOn(db.toString(), fs.readFileSync(path.join(root, 'supabase/migrations', m), 'utf8'));
    assert.equal(psqlOn(db.toString(), `select string_agg(key, ',' order by key) from avatar_orphans`), 'src-1.webp,src-2.webp', 'each original is listed for the sweep');
    assert.equal(psqlOn(db.toString(), `select string_agg(concat_ws('/', avatar_square, avatar_portrait), ',' order by avatar_square) from character_profiles`), 'sq-1.webp/pt-1.webp,sq-2.webp', 'each profile keeps its crops');
    assert.equal(psqlOn(db.toString(), `select count(*) from information_schema.columns where table_name = 'character_profiles' and column_name = 'avatar_source'`), '0', 'no profile names an original');
    // The same database emptied, beside a bucket holding old files: not this bucket's database.
    psqlOn(db.toString(), `delete from character_profiles; delete from avatar_orphans;`);
    const store = await fakeStorage();
    store.objects.set('sq-1.webp', new Date(Date.now() - 2 * HOUR).toISOString());
    try {
      const refused = await run(['--from', db.toString(), '--storage', store.url]);
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /names no avatar, and .* holds 1 file\(s\) over an hour old: is this the instance's own database\? Nothing was removed/);
      assert.ok(store.objects.has('sq-1.webp'), 'nothing is removed on the word of a database that names no avatar');
    } finally {
      await store.close();
    }
  } finally {
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
  }
});
