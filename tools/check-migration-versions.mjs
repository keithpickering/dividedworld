/**
 * Guard: every migration has a version of its own, and the Supabase CLI reads them in the order
 * the SQL suite applies them.
 *
 *   node tools/check-migration-versions.mjs [directory]     (default: supabase/migrations/)
 *
 * `supabase db push` takes a migration's version from the digits before the first underscore of
 * its file name and records it in supabase_migrations.schema_migrations, whose key is the version.
 * Two files with one version cannot both be recorded: the first push to a hosted project applied
 * 0070_autocorrect.sql, then stopped on 0070_jobs_key.sql with a duplicate key, and 0073 was doubled
 * the same way. tools/test-sql.mjs applies the files in name order and records nothing, so it
 * passed over both, and two build sessions working at once had each taken the next free number.
 *
 * So each file is held to the shape every migration has: four digits, an underscore, a name in
 * lowercase letters, digits and underscores, and `.sql`. Four digits for every version mean the
 * CLI's order and the suite's name order are one order. A `.sql` file of another shape is a
 * fault too, since the CLI would skip it or read a version the suite does not sort by. And no two
 * files share a version. A missing or empty folder fails as "no migrations", since a check over
 * nothing has nothing wrong in it.
 *
 * `migrationFaults` takes the file names, so tools/test-migration-versions.mjs drives it red
 * without a folder; the command reads the folder, and its exit status is what the build reads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The shape of a migration's file name; the first group is its version. */
export const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** The faults in a folder's file names, each naming the file; only `.sql` files are read. */
export function migrationFaults(names) {
  const faults = [];
  const byVersion = new Map();
  for (const name of [...names].filter((n) => n.endsWith('.sql')).sort()) {
    const m = MIGRATION_NAME.exec(name);
    if (!m) {
      faults.push(`${name}: not a migration's name (four digits, an underscore, a name in lowercase letters, digits and underscores, then .sql)`);
      continue;
    }
    byVersion.set(m[1], [...(byVersion.get(m[1]) ?? []), name]);
  }
  for (const [version, files] of byVersion) {
    if (files.length > 1) faults.push(`version ${version} is taken by ${files.length} files (${files.join(', ')}); supabase db push records one migration per version, so give each its own`);
  }
  return faults;
}

function main() {
  const dir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'supabase', 'migrations'));
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.sql')) : [];
  if (names.length === 0) {
    console.error(`  migration-versions: no migrations: ${dir} is missing or holds no .sql file, so there is nothing to check`);
    process.exit(1);
  }
  const faults = migrationFaults(names);
  if (faults.length) {
    console.error(`  migration-versions: ${faults.length} fault(s) in ${dir}:`);
    for (const f of faults) console.error(`    ${f}`);
    console.error('  A migration no database holds yet may be renumbered; one a database holds keeps its version (supabase migration list --linked shows which).');
    process.exit(1);
  }
  console.log(`  migration-versions: ${names.length} migration(s), each with a version of its own`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
