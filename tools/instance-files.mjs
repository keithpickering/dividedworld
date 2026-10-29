/**
 * What tools/export-instance.mjs and tools/import-instance.mjs share: their arguments, the
 * tables an instance is made of, and psql, which both run, so neither needs a driver.
 *
 * An instance is every table in the public schema, private ones included, and the logins beside
 * them in Supabase Auth (auth.users, and auth.identities where Auth keeps one), so that an
 * imported instance's players sign in as before. What is not exported is said where it is left
 * out (NOT_EXPORTED): the two Vault secrets, Auth's sessions, which end, and the tables the
 * migrations fill themselves (MIGRATION_DATA), whose release the manifest names instead. The files
 * the rows name (avatars, BUCKETS) are carried beside the rows, from Storage and back to it.
 *
 * A connection's password never reaches psql's command line, where any user's `ps` reads it, nor
 * the terminal: the URL is taken apart here and handed to psql as libpq's variables, and every
 * message a tool prints passes through scrub() first.
 */
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const FORMAT = 'kayfabb-export/1';

/** --from and --to, both required; --storage, the instance's Supabase URL, where its files are. */
export function args(argv, usage) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--from' && flag !== '--to' && flag !== '--storage') throw new Error(usage);
    out[flag.slice(2)] = argv[i + 1];
  }
  if (!out.from || !out.to) throw new Error(usage);
  return out;
}

/* ------------------------------------------------------------- the files an instance holds ---- */

/**
 * The buckets an instance keeps files in, each with the table and columns that name its files: an
 * export carries every file a row names, and an import puts each back under its name, so the
 * imported forum shows the same avatars (supabase/migrations/0019_profiles.sql).
 */
export const BUCKETS = [{ bucket: 'avatars', table: 'public.character_profiles', columns: ['avatar_source', 'avatar_square', 'avatar_portrait'], contentType: 'image/webp' }];

/** The environment variable that holds the service key Storage is called with; never printed, never on a command line. */
export const STORAGE_KEY = 'KAYFABB_STORAGE_KEY';

/** A name a row gives a file: one path segment, nothing that could climb out of the export. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/** Every file the exported rows name, by bucket, read from the table files the export wrote. */
export async function filesNamed(dir) {
  const out = [];
  for (const b of BUCKETS) {
    const file = path.join(dir, fileOf(b.table));
    if (!fs.existsSync(file)) continue;
    const names = new Set();
    for await (const line of readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
      if (!line) continue;
      const row = JSON.parse(line);
      for (const c of b.columns) if (row[c]) names.add(row[c]);
    }
    for (const name of [...names].sort()) {
      if (!FILE_NAME.test(name)) throw new Error(`${b.table} names a file "${name}" that is not one path segment`);
      out.push({ bucket: b.bucket, name });
    }
  }
  return out;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Supabase Storage at a project's URL, called with the service key from STORAGE_KEY. The URL
 * carries no credentials, and is https unless it is this machine. Each request is retried on what
 * says it never reached a Storage that ran it, or never answered (a timeout, a thrown fetch, a 5xx,
 * a 429), a few times, waiting longer each time; any other answer is a fact about the request
 * ("Three unrelated timeouts are not a poison pill"). A retried store is safe: the same bytes found
 * there are the same file.
 */
export function storage(url, { timeoutMs = Number(process.env.KAYFABB_STORAGE_TIMEOUT_MS) || 30_000, attempts = 4 } = {}) {
  const key = process.env[STORAGE_KEY];
  if (!url) throw new Error('the instance holds files: give --storage with its Supabase URL');
  if (!key) throw new Error(`the instance holds files: set ${STORAGE_KEY} to its service key`);
  secrets.add(key);
  let base;
  try { base = new URL(url); } catch { throw new Error('--storage is the project\'s URL, https://…'); }
  if (base.username || base.password) throw new Error('--storage carries credentials; the key goes in ' + STORAGE_KEY + ', never the URL');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && LOOPBACK.has(base.hostname))) throw new Error('--storage is https, unless it is this machine: the service key never travels in clear');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const at = (bucket, name) => new URL(`storage/v1/object/${bucket}/${encodeURIComponent(name)}`, base.href.endsWith('/') ? base.href : `${base.href}/`);
  const request = async (where, init, what) => {
    const seen = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 2)));
      try {
        const r = await fetch(where, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (r.status >= 500 || r.status === 429) { seen.push(`HTTP ${r.status}`); await r.body?.cancel(); continue; }
        return r;
      } catch (e) {
        seen.push(`no answer (${e?.name === 'TimeoutError' ? `none in ${timeoutMs} ms` : e?.message ?? e})`);
      }
    }
    throw new Error(`storage: ${what}: no answer after ${seen.length} attempt(s): ${seen.join('; ')}`);
  };
  const read = async (bucket, name) => request(at(bucket, name), { headers }, `reading ${bucket}/${name}`);
  return {
    named: base.origin,
    async get(bucket, name) {
      const r = await read(bucket, name);
      if (r.status === 404 || r.status === 400) {
        await r.body?.cancel();
        throw new Error(`storage: ${bucket}/${name}, which a row names, is not there: it was replaced or removed since the rows were read; export again into a new directory (this one is left as it is)`);
      }
      if (!r.ok) { await r.body?.cancel(); throw new Error(`storage: ${bucket}/${name} answered HTTP ${r.status}`); }
      return new Uint8Array(await r.arrayBuffer());
    },
    /**
     * Stores a file, never over another: one already there with the same bytes (an import run again
     * after one that stopped part way) is the same file; one with other bytes is refused. Storage
     * answers 409, or 400 with its own word for it, for a name taken; any other refusal is said as
     * itself.
     */
    async put(bucket, name, bytes, contentType) {
      const r = await request(at(bucket, name), { method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes }, `storing ${bucket}/${name}`);
      await r.body?.cancel();
      if (r.ok) return;
      if (r.status === 400 || r.status === 409) {
        const there = await read(bucket, name);
        if (there.ok) {
          if (sha256(new Uint8Array(await there.arrayBuffer())) === sha256(bytes)) return;
          throw new Error(`storage: ${bucket}/${name} is already there, and is another file`);
        }
        await there.body?.cancel();
      }
      throw new Error(`storage: storing ${bucket}/${name} answered HTTP ${r.status}`);
    },
  };
}

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** The query parameters a URL may carry, as the libpq variable each sets: none can send psql elsewhere. */
const HARMLESS = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME' };

/** Every secret a tool has been handed, so that scrub() can take each out of what it prints. */
const secrets = new Set();

/**
 * A message with every password a tool was given, raw or encoded, replaced. One shorter than four
 * characters is left, since it would be found inside psql's own words (PL/pgSQL) and is no secret
 * worth the garble; nothing prints a password in any case, since none reaches psql's command line.
 */
export function scrub(text) {
  let out = String(text);
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('<password>');
  return out;
}

/**
 * A URL taken apart: the database it names, as host:port/database with no user or password, and
 * the libpq variables that connect to it. A URL that names no host or database, carries a
 * parameter that could connect somewhere else than it says, or meets a PG* variable that could,
 * is refused.
 */
export function connection(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('the database is a postgres:// URL'); }
  if (u.password) secrets.add(u.password);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('the database is a postgres:// URL');
  if (!u.hostname) throw new Error('the URL names no host');
  if (u.pathname.length < 2) throw new Error('the URL names no database');
  const env = {};
  for (const [key, value] of u.searchParams) {
    if (!(key in HARMLESS)) throw new Error(`the URL's ${key} parameter could connect somewhere it does not say`);
    env[HARMLESS[key]] = value;
  }
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS']) if (process.env[key]) throw new Error(`${key} is set, and could connect somewhere the URL does not say`);
  const decode = (part, what) => {
    try { return decodeURIComponent(part); } catch { throw new Error(`the URL's ${what} is not percent-encoded`); }
  };
  const password = decode(u.password, 'password');
  secrets.add(password);
  const host = u.hostname.replace(/^\[(.*)\]$/, '$1');
  return {
    named: `${u.hostname}:${u.port || '5432'}${u.pathname}`,
    env: { PGHOST: host, PGPORT: u.port || '5432', PGDATABASE: decode(u.pathname.slice(1), 'database'), PGUSER: decode(u.username, 'user') || 'postgres', PGPASSWORD: password, ...env },
  };
}

const psqlEnv = (c) => {
  const env = { ...process.env, ...c.env };
  for (const key of Object.keys(env)) if (key.startsWith('PG') && !(key in c.env)) delete env[key];
  return env;
};
const PSQL = ['-v', 'ON_ERROR_STOP=1', '-qtAX', '-f', '-'];

/** Runs a script through psql and returns its unaligned output; an error carries psql's own words, scrubbed. */
export function psql(c, script) {
  try {
    return execFileSync('psql', PSQL, { input: script, env: psqlEnv(c), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
  } catch (e) {
    throw new Error(scrub(String(e.stderr || '').trim() || `psql exited ${e.status ?? 'without a status'}`));
  }
}

/** psql reading a script streamed to it, for a load too large to hold. */
export function psqlStream(c) {
  return spawn('psql', PSQL, { env: psqlEnv(c), stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The database as the server itself names it, once connected. */
export function answered(c) {
  return psql(c, `select format('%s on port %s', current_database(), coalesce(inet_server_port()::text, 'the local socket'))`);
}

/**
 * The instance's tables, each with its columns (stored generated columns aside, which are
 * computed again) and the order its rows are written in, read as JSON so that no name or type
 * (numeric(10,2)) can be cut at a delimiter.
 */
export function tables(c) {
  return JSON.parse(psql(c, `
    select coalesce(json_agg(json_build_object('name', t.name, 'columns', t.columns, 'order', t.ord) order by t.name), '[]')
    from (
      select format('%I.%I', n.nspname, c.relname) as name,
        (select json_agg(json_build_array(quote_ident(a.attname), format_type(a.atttypid, a.atttypmod)) order by a.attnum)
           from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '') as columns,
        coalesce((select string_agg(quote_ident(a.attname), ', ' order by array_position(i.indkey, a.attnum))
           from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
           where i.indrelid = c.oid and i.indisprimary), 'ctid') as ord
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition
        and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
        and format('%I.%I', n.nspname, c.relname) <> all (array[${MIGRATION_DATA.map((t) => `'${t}'`).join(', ')}]::text[])
    ) t`));
}

/**
 * The tables a migration fills, the same in every instance at one set of migrations: the name
 * folds (supabase/migrations/0010_name_folds.sql). Not an instance's to carry; the manifest
 * names their release instead (nameFolds), and an import into a database holding another is
 * refused, since every character's name keys are that release's.
 */
export const MIGRATION_DATA = ['public.name_maps', 'public.name_classes', 'public.unicode_data'];

/** The release of each kind of name fold the database holds, and the hash of the file it came from. */
export const nameFolds = (c) => JSON.parse(psql(c, `select coalesce(json_object_agg(what, json_build_object('version', version, 'sha256', source_sha256) order by what), '{}') from public.unicode_data`));

/** The one file name a table's rows are kept in. */
export const fileOf = (name) => `${name}.jsonl`;

/** Prints a tool's failure, scrubbed, and exits. */
export function fail(e) {
  console.error(scrub(e?.message ?? e));
  process.exit(1);
}

export const NOT_EXPORTED = [
  'the name folds (public.name_maps, public.name_classes, public.unicode_data): the migrations load them, and the manifest names their release and source files (nameFolds), which an import requires the new database to hold; every character\'s name keys are computed again there and must be the ones carried',
  'the two Vault secrets the scheduled jobs call the Edge Functions with, kayfabb_functions_url and kayfabb_service_key: secrets, which are set by hand on the new project, with select vault.create_secret(<the functions URL>, \'kayfabb_functions_url\') and select vault.create_secret(<the service key>, \'kayfabb_service_key\') (supabase/migrations/0004_schedule.sql reads them); until then the settlement job runs and calls nothing',
  'Supabase Auth\'s sessions and refresh tokens: they end, and each player signs in once more',
];
