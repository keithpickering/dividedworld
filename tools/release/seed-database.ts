/**
 * The release's own seed: writes the instance's vocabulary and numbers into the database a release has just migrated, before
 * the functions move (docs/plans/2026-11-27-release-order-design.md, D3). The functions job then starts on a database that holds
 * every row and key its new code reads, and never on rows older than its code.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning tools/release/seed-database.ts --db <postgres URL> [--profile <name>]
 *
 * It builds the payload exactly as the seed function does (supabase/functions/seed/core.ts: `instanceSeed(chooseInstance(profile),
 * conduct)`, from the same modules), so the two cannot drift, and calls `seed_instance(payload)` through psql. `--profile ""` is no
 * profile, as chooseInstance reads it: an unset release variable arrives empty. The database is named by an explicit --db and never
 * by a default; a database on this machine is allowed, since the test seeds a scratch one.
 *
 * The tuned mark. seed_instance sets `kayfabb.seeding` to 'on' itself, with `set_config(..., true)` inside its own body, and puts it
 * back before it returns (supabase/migrations/0405_cut.sql and every later definition), so the settings trigger leaves a seed's rows
 * unmarked whoever calls it: the function's own call and this tool's psql statement alike. Nothing is set here beforehand.
 *
 * The payload goes to psql on stdin, inside the statement, never on the command line, and never as an argument. Nothing prints the
 * URL: the host and the counts are printed, and every message passes through scrub(). A refusal from seed_instance (SQLSTATE 22023
 * and the like) exits 1 with psql's own words; a transport failure is retried where it happened, a few times, and then exits 1.
 */
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chooseInstance, conduct } from '../../supabase/functions/_shared/instance.ts';
import { instanceSeed } from '../../supabase/functions/_shared/seed.ts';
// Variable specifiers: TypeScript does not resolve them, so the .mjs files need no declaration file.
const checkFile = '../check-deployed-migrations.mjs';
const filesFile = '../instance-files.mjs';
const { retrying, connectOptions } = (await import(checkFile)) as { retrying<T>(fn: () => Promise<T> | T): Promise<T>; connectOptions<C>(c: C): C };
const { connection, psql, scrub } = (await import(filesFile)) as {
  connection(url: string): { named: string; env: Record<string, string> };
  psql(c: unknown, script: string): string;
  scrub(text: string): string;
};

export type SeedArgs = { db?: string; profile?: string; refusal?: string };

/** What the command was asked for, or the plain reason it refuses; never carries the URL. Nothing here connects. */
export function seedArgs(argv: string[]): SeedArgs {
  let db: string | undefined;
  let profile: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--db' && flag !== '--profile') return { refusal: `unknown argument ${flag}; the arguments are --db <postgres URL> and --profile <name>` };
    if (seen.has(flag)) return { refusal: `${flag} is given more than once` };
    seen.add(flag);
    const value = argv[++i];
    if (value === undefined) return { refusal: `${flag} has no value` };
    if (flag === '--db') db = value; else profile = value;
  }
  if (db === undefined) return { refusal: 'no --db: name the database to seed, explicitly; there is no default' };
  if (db === '') return { refusal: '--db is empty: the release\'s SUPABASE_DB_URL secret is not set in the production environment, or, in a hand run, the variable passed to --db is unset' };
  let u: URL;
  try { u = new URL(db); } catch { return { refusal: 'the --db value is not a postgres:// URL' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { refusal: 'the --db value is not a postgres:// URL' };
  return { db, profile };
}

/** The payload the seed function sends for the same profile: its own two calls, from the same modules. */
export function seedPayload(profile: string | undefined) {
  return instanceSeed(chooseInstance(profile), conduct);
}

/**
 * The one statement psql reads on stdin: the payload as a dollar-quoted literal whose tag no part of the payload contains, so
 * nothing in a card's words can end it, cast to jsonb and handed to seed_instance.
 */
export function seedSql(payload: unknown): string {
  const body = JSON.stringify(payload);
  let tag = 'seed';
  while (body.includes(`$${tag}`)) tag = `seed${crypto.randomBytes(4).toString('hex')}`;
  return `select seed_instance($${tag}$${body}$${tag}$::jsonb);`;
}

async function main(): Promise<number> {
  const a = seedArgs(process.argv.slice(2));
  if (a.refusal !== undefined) {
    console.error(`  seed-database: refused: ${a.refusal}`);
    return 2;
  }
  let c;
  try { c = connectOptions(connection(a.db as string)); } catch (e) {
    console.error(`  seed-database: refused: ${scrub((e as Error).message)}`);
    return 2;
  }
  let sql: string;
  try { sql = seedSql(seedPayload(a.profile)); } catch (e) {
    console.error(`  seed-database: ${scrub((e as Error).message)}`);
    return 1;
  }
  try {
    const out = await retrying(() => psql(c, sql));
    const counts = JSON.parse(out) as Record<string, unknown>;
    const n = (k: string) => (typeof counts[k] === 'number' ? counts[k] : Array.isArray(counts[k]) ? (counts[k] as unknown[]).length : counts[k]);
    console.log(scrub(`seeded ${new URL(a.db as string).hostname}: settings ${n('settings')}, classes ${n('classes')}, reactions ${n('reactions')}, groups ${n('groups')}, cards ${n('cards')}, boards ${n('boards')}, retired ${n('retired')}`));
    return 0;
  } catch (e) {
    console.error(`  seed-database: ${scrub((e as Error).message)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
