/**
 * Guard: a migration new on a branch is numbered above the newest migration its base already has.
 *
 *   node tools/check-migration-order.mjs --base <ref>
 *
 * `supabase db push` refuses a migration whose version is older than one the database already
 * holds, so a branch that took a number below what its base gained meanwhile cannot be pushed
 * once merged. On 25 November a branch added 0424 after main had taken 0425; each branch passed
 * tools/check-migration-versions.mjs alone, since only the merge held both. This check compares
 * the branch's folder with the base's: a file the branch adds (a rename counts as added) whose
 * version is at or below the base's newest is a fault, and the way out is to renumber it.
 *
 * `orderFaults` takes the two lists of file names, so tools/test-migration-order.mjs drives it red
 * without git; the command reads the base's names with `git ls-tree` and the working tree's folder (of the current directory, or `--root`),
 * and its exit status is what CI reads: 0 clean, 1 faults, 2 when it cannot tell (no --base, or a
 * ref git cannot read). It needs a base, which only CI knows, so the build does not run it.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrationVersion } from './check-migration-versions.mjs';

/** The newest migration among these names, as {name, version}, or null when none is a migration's. */
export function newestMigration(names) {
  let best = null;
  for (const name of names) {
    const version = migrationVersion(name);
    if (version !== null && (best === null || version > best.version)) best = { name, version };
  }
  return best;
}

/** The faults in a branch's migrations against its base's, each naming the file; only migrations' names are read. */
export function orderFaults(baseNames, headNames) {
  const newest = newestMigration(baseNames);
  if (!newest) return [];
  const baseSet = new Set(baseNames);
  return [...headNames]
    .filter((n) => migrationVersion(n) !== null && !baseSet.has(n) && migrationVersion(n) <= newest.version)
    .sort()
    .map((n) => `${n} is new on this branch and numbered at or below ${newest.version}, the newest migration on the base (${newest.name}); renumber it above ${newest.version}`);
}

function main() {
  const argv = process.argv;
  const flag = (f) => { const i = argv.indexOf(f); return i === -1 ? undefined : argv[i + 1]; };
  const ref = flag('--base');
  const root = path.resolve(flag('--root') ?? process.cwd());
  if (!ref || ref.startsWith('-')) {
    console.error('  migration-order: no --base: say which ref the branch is compared with (node tools/check-migration-order.mjs --base origin/main)');
    process.exit(2);
  }
  const ls = spawnSync('git', ['ls-tree', '--name-only', ref, '--', 'supabase/migrations/'], { cwd: root, encoding: 'utf8' });
  if (ls.error || ls.status !== 0) {
    console.error(`  migration-order: cannot read ${ref} in ${root}: ${(ls.stderr || ls.error?.message || '').trim() || `exit ${ls.status}`}`);
    process.exit(2);
  }
  const baseNames = ls.stdout.split('\n').filter(Boolean).map((p) => path.posix.basename(p));
  const dir = path.join(root, 'supabase', 'migrations');
  const headNames = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const faults = orderFaults(baseNames, headNames);
  if (faults.length) {
    console.error(`  migration-order: ${faults.length} fault(s) against ${ref}:`);
    for (const f of faults) console.error(`    ${f}`);
    process.exit(1);
  }
  const baseSet = new Set(baseNames);
  const added = headNames.filter((n) => migrationVersion(n) !== null && !baseSet.has(n)).length;
  console.log(`  migration-order: ${added} migration(s) added on this branch, each above ${newestMigration(baseNames)?.version ?? 'none'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
