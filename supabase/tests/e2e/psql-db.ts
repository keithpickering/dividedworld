/**
 * A Db (supabase/functions/_shared/rpc.ts) that calls the SQL functions through psql, as the
 * service role or as a player, on the clone tools/test-sql.mjs made for the file: so an end-to-end test runs
 * the Edge Functions' own core against the real migrations with no PostgREST in between. The
 * arguments are passed as one JSON value and each is cast to the type pg_proc says its
 * parameter takes, by name, as PostgREST does.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { DatabaseError, type Db } from '../../functions/_shared/rpc.ts';
import { instanceSeed } from '../../functions/_shared/seed.ts';
import { conduct } from '../../../instances/divided-world/ui/conduct.ts';
import type { Instance } from '../../../engine/rules/types.ts';

// A variable specifier: TypeScript does not resolve it, so the .mjs needs no declaration file.
const runnerFile = '../../../tools/test-sql.mjs';
const { FILE_TIMEOUT_MS, cloneSql, cloneSuffixError, migrationFiles } = (await import(runnerFile)) as { FILE_TIMEOUT_MS: number; cloneSql(template: string, clone: string, url: string): string; cloneSuffixError(clone: string, suffix: string): string | null; migrationFiles(): string[] };

export function scratchUrl(): string {
  const url = process.env.KAYFABB_SCRATCH_URL;
  if (!url) throw new Error('KAYFABB_SCRATCH_URL is not set; end-to-end tests run inside tools/test-sql.mjs');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`refusing a database on ${host}`);
  return url;
}

/** What the runner snapshotted while it replayed the migrations for its template: `migrated`, and one database for each point a file's name gives (tools/test-sql.mjs, snapshotPoints). */
function snapshots(): Record<string, string> {
  const raw = process.env.KAYFABB_SNAPSHOTS;
  if (!raw) throw new Error('KAYFABB_SNAPSHOTS is not set; end-to-end tests run inside tools/test-sql.mjs');
  return JSON.parse(raw) as Record<string, string>;
}

let made = 0;

/** A clone of one of the runner's snapshots, named after this file's own clone (`<clone>_<suffix>`) so it is unique, and dropped with it: by `drop()`, and by the runner when it drops the clone. */
function cloneOfSnapshot(key: string, suffix: string): { url: string; drop: () => void } {
  const snapshot = snapshots()[key];
  if (!snapshot) throw new Error(`the runner made no snapshot for ${key} (it made ${Object.keys(snapshots()).join(', ')}); an upgrade test is named NNNN-<name>-across-MMMM.ts for the migration it crosses`);
  const scratch = new URL(scratchUrl());
  const clone = scratch.pathname.slice(1);
  const badSuffix = cloneSuffixError(clone, suffix);
  if (badSuffix) throw new Error(badSuffix);
  const name = `${clone}_${suffix}`;
  const server = new URL(scratch);
  server.pathname = '/postgres';
  const onServer = (text: string) => execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', server.toString(), '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  // The settings a database starts with do not travel with a clone, so cloneSql gives the clone its own, scratch_url naming it.
  onServer(cloneSql(snapshot, name, server.toString()));
  const url = new URL(scratch);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => { onServer(`drop database if exists ${name} with (force);`); } };
}

/**
 * A database as the migrations before `migration` (its number, as `0082`) left it: the shim and every migration up to it, no fixtures. It is a clone
 * of the snapshot the runner made at that point of its replay; the point is the file's own name (`NNNN-<name>-across-0082.ts`). `remaining` is the SQL
 * of each migration from `migration` on, in order, for the file to apply once it has written what the old schema wrote; `crossing` is the file name of the
 * migration it crosses and `before` the names of those the snapshot holds, so a file can say which migration it is about. This is the one place that reads
 * the migrations directory: a file replays nothing of its own (the runner refuses one that does).
 */
export function databaseBefore(migration: string, suffix = `before${++made}`): { url: string; drop: () => void; remaining: string[]; crossing: string; before: string[] } {
  const names = migrationFiles().slice(1);
  const at = names.findIndex((f) => path.basename(f).startsWith(`${migration}_`));
  if (at < 0) throw new Error(`no migration begins ${migration}_`);
  return { ...cloneOfSnapshot(migration, suffix), remaining: names.slice(at).map((f) => fs.readFileSync(f, 'utf8')), crossing: path.basename(names[at]!), before: names.slice(0, at).map((f) => path.basename(f)) };
}

/** A database with every migration and no fixtures, as a fresh instance is before an import: a clone of the runner's `migrated` snapshot. */
export function migratedDatabase(suffix = `migrated${++made}`): { url: string; drop: () => void } {
  return cloneOfSnapshot('migrated', suffix);
}

/** Runs SQL as the harness's superuser and returns psql's unaligned output. */
export function sql(text: string, vars: Record<string, string> = {}): string {
  const args = ['-v', 'ON_ERROR_STOP=1', '-qtAX', scratchUrl()];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  return execFileSync('psql', args, { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Makes the open season end far ahead, and returns what puts its length back. A move that would land after the season ends is dropped,
 * and an earlier file's seasons start long ago (the fixture's first starts in 2000), so a meeting held now would be in the farewell
 * window of a season long over, and its moves would be dropped. Only the length moves, never a season's start, so the settlements an
 * earlier file left and their windows are untouched; the season's end is its start plus this length.
 */
export function openSeasonAhead(): () => void {
  const length = sql(`select value::text from settings where key = 'seasonLength'`);
  sql(`update settings set value = '{"unit": "month", "count": 1000}' where key = 'seasonLength'`);
  return () => { sql(`update settings set value = '${length}' where key = 'seasonLength'`); };
}

/**
 * The instance's seed, for this scratch database. The clone holds the SQL suite's own test
 * instance (supabase/tests/setup/fixtures.sql) and its reaction kinds, and
 * seed_instance takes a payload's reactions as the instance's whole set and refuses to drop a kind that
 * reactions use (0091). So the kinds the database already holds are seeded beside the instance's own, as
 * they stood before. Where a held kind shares a key or an emoji with one of the instance's, the instance's
 * wins and the held one is left out.
 *
 * The same for personas: the seed's roster is the whole staff, and a persona it does not list is benched (0403), with the Boss handed over first. The files here are not about
 * a roster leaving, and each seeds the roster its own world needs (the placeholder Bosses, FanGaME), so the personas the database already holds are listed beside the instance's own,
 * by key and name alone (which leaves what the fixtures wrote as it was), and no file's seed benches what the template holds.
 */
export function scratchSeed(instance: Instance): ReturnType<typeof instanceSeed> {
  const seed = instanceSeed(instance, conduct);
  const heldStaff = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('key', staff, 'name', name) order by staff), '[]') from characters where staff_kind = 'persona'`)) as { key: string; name: string }[];
  // Listing every held persona also re-lists any that an earlier e2e file left benched by a seed (a seed that omitted it), which brings it back, so no e2e file sees departure residue.
  const listed = new Set(seed.system.staff.map((p) => p.key));
  // The seed's persona type is the full file; seed_instance reads only the keys a persona has, so the held ones are key and name alone.
  const system = { ...seed.system, staff: [...seed.system.staff, ...heldStaff.filter((p) => !listed.has(p.key))] as unknown as typeof seed.system.staff };
  const held = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('key', key, 'emoji', emoji, 'quadrant', quadrant) order by key), '[]') from reaction_kinds`)) as typeof seed.reactions;
  const keys = new Set(seed.reactions.map((r) => r.key));
  const emoji = new Set(seed.reactions.map((r) => r.emoji));
  return { ...seed, system, reactions: [...seed.reactions, ...held.filter((r) => !keys.has(r.key) && !emoji.has(r.emoji))] };
}

/** As the service role, or, given an account, as that player, as their session would be. */
export function psqlDb(as?: string): Db {
  const role = as ? 'authenticated' : 'service_role';
  const claims = JSON.stringify(as ? { sub: as, role } : { role });
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const params = sql(`select string_agg(n || ':' || format_type(t, null), ',' order by i)
        from pg_proc p, unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a(n, t, i)
        where p.proname = :'fn' and p.pronamespace = 'public'::regnamespace`, { fn });
      const typeOf = new Map(params.split(',').filter(Boolean).map((x) => x.split(':') as [string, string]));
      // A parameter's name is quoted where it is written, as PostgREST names it: `window` (pool_read) is a reserved word.
      const named = Object.keys(args).map((k) => {
        const type = typeOf.get(k);
        if (!type) throw new Error(`${fn} has no parameter ${k}`);
        if (type === 'jsonb' || type === 'json') return `"${k}" => (:'args'::jsonb -> '${k}')::${type}`;
        // A JSON array is an array parameter as PostgREST sends it (the patrol run's boards); its text is no array literal, so its elements are cast one by one.
        // A JSON null is SQL NULL, as PostgREST passes it.
        if (type.endsWith('[]')) return `"${k}" => case when jsonb_typeof(:'args'::jsonb -> '${k}') = 'array' then array(select jsonb_array_elements_text(:'args'::jsonb -> '${k}'))::${type} end`;
        return `"${k}" => (:'args'::jsonb ->> '${k}')::${type}`;
      });
      try {
        const out = sql(`set role ${role};
          select set_config('request.jwt.claims', :'claims', false) \\g /dev/null
          select coalesce(to_jsonb(public.${fn}(${named.join(', ')})), 'null'::jsonb)::text;`, { args: JSON.stringify(args), claims });
        return JSON.parse(out) as T;
      } catch (e) {
        // psql's own report of the error: its message, and the hint it was raised with.
        const stderr = String((e as { stderr?: string }).stderr ?? e);
        const message = /ERROR:\s+(.*)/.exec(stderr)?.[1]?.trim() ?? stderr.trim();
        const hint = /HINT:\s+(.*)/.exec(stderr)?.[1]?.trim() ?? '';
        throw new DatabaseError(`${fn}: ${message}`, '', 400, message, hint);
      }
    },
  };
}

/** One held-open psql connection: statements go in, and `done()` waits for everything sent so far. */
export function session() {
  const child: ChildProcessWithoutNullStreams = spawn('psql', ['-X', '-q', '-tA', scratchUrl()], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  let n = 0;
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const waitFor = async (mark: string, ms: number) => {
    const until = Date.now() + ms;
    while (!out.includes(mark)) {
      if (Date.now() > until) throw new Error(`no ${mark} in ${ms} ms; out ${out}; err ${err}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return {
    send(text: string) { child.stdin.write(text + '\n'); },
    /** True when everything sent so far has answered, within `ms`. */
    async settled(ms: number) {
      const mark = `<<${++n}>>`;
      child.stdin.write(`\\echo ${mark}\n`);
      try { await waitFor(mark, ms); return true; } catch { return false; }
    },
    async done(ms = 15_000) { assert.ok(await this.settled(ms), `a statement never answered; err ${err}`); },
    get out() { return out; },
    get err() { return err; },
    close() { child.stdin.end(); child.kill(); },
  };
}
