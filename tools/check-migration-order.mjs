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
 * without git; the command reads the base's names with `git ls-tree` and the working tree's folder,
 * and its exit status is what CI reads: 0 clean, 1 faults, 2 when it cannot tell (no --base, or a
 * ref git cannot read). It needs a base, which only CI knows, so the build does not run it.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIGRATION_NAME } from './check-migration-versions.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The faults in a branch's migrations against its base's, each naming the file; only migrations' names are read. */
export function orderFaults(baseNames, headNames) {
  const base = [...baseNames].filter((n) => MIGRATION_NAME.test(n));
  const head = [...headNames].filter((n) => MIGRATION_NAME.test(n));
  if (base.length === 0) return [];
  const baseSet = new Set(base);
  const newestName = base.reduce((a, b) => (MIGRATION_NAME.exec(b)[1] > MIGRATION_NAME.exec(a)[1] ? b : a));
  const newest = MIGRATION_NAME.exec(newestName)[1];
  return head
    .filter((n) => !baseSet.has(n) && MIGRATION_NAME.exec(n)[1] <= newest)
    .sort()
    .map((n) => `${n} is new on this branch and numbered at or below ${newest}, the newest migration on the base (${newestName}); renumber it above ${newest}`);
}

function main() {
  const i = process.argv.indexOf('--base');
  const ref = i === -1 ? undefined : process.argv[i + 1];
  if (!ref) {
    console.error('  migration-order: no --base: say which ref the branch is compared with (node tools/check-migration-order.mjs --base origin/main)');
    process.exit(2);
  }
  const ls = spawnSync('git', ['ls-tree', '--name-only', ref, 'supabase/migrations/'], { cwd: repoRoot, encoding: 'utf8' });
  if (ls.status !== 0) {
    console.error(`  migration-order: git cannot read ${ref}: ${(ls.stderr || '').trim() || `exit ${ls.status}`}`);
    process.exit(2);
  }
  const baseNames = ls.stdout.split('\n').filter(Boolean).map((p) => path.posix.basename(p));
  const dir = path.join(repoRoot, 'supabase', 'migrations');
  const headNames = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const faults = orderFaults(baseNames, headNames);
  if (faults.length) {
    console.error(`  migration-order: ${faults.length} fault(s) against ${ref}:`);
    for (const f of faults) console.error(`    ${f}`);
    process.exit(1);
  }
  const baseSet = new Set(baseNames);
  const added = headNames.filter((n) => MIGRATION_NAME.test(n) && !baseSet.has(n)).length;
  const newest = baseNames.filter((n) => MIGRATION_NAME.test(n)).map((n) => MIGRATION_NAME.exec(n)[1]).sort().at(-1) ?? 'none';
  console.log(`  migration-order: ${added} migration(s) added on this branch, each above ${newest}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
