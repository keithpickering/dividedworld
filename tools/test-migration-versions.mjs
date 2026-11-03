/**
 * Tests for the guard in tools/check-migration-versions.mjs.
 *
 *   node tools/test-migration-versions.mjs
 *
 * The guard fails a migrations folder in which two files share a version, a `.sql` file of another
 * shape, and a folder with no migrations. Each case runs the check over names, through its
 * function, and the red ones over a scratch folder through the command too, whose exit code is
 * what the build reads. The first case is the folder as it stood when a hosted push stopped on it.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationFaults } from './check-migration-versions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'check-migration-versions.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-versions-'));
let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

/** A scratch folder holding empty files of these names; the command's result over it. */
function run(caseName, names) {
  const dir = path.join(root, caseName);
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, n), '');
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

/** One poison: the function names it (matching `want`), and the command exits 1 saying so. */
function red(name, names, want) {
  const faults = migrationFaults(names);
  if (check(name, faults.some((f) => want.test(f)), JSON.stringify(faults))) {
    const c = run(name.replace(/\W+/g, '-'), names);
    check('  and the command exits 1 naming it', c.status === 1 && want.test(c.stderr), `${c.status} ${c.stderr}`);
  }
}

try {
  const clean = ['0001_core.sql', '0002_reactions.sql', '0070_autocorrect.sql', '0071_jobs_key.sql'];
  check('a folder whose versions are each its own is clean', migrationFaults(clean).length === 0, JSON.stringify(migrationFaults(clean)));
  const c = run('clean', clean);
  check('  and the command exits 0', c.status === 0 && /4 migration\(s\)/.test(c.stdout), `${c.status} ${c.stderr}`);

  red('0070 and 0073 taken twice, as the folder stood when the hosted push stopped, are both named',
    ['0069_tips_settings.sql', '0070_autocorrect.sql', '0070_jobs_key.sql', '0071_play_moments.sql', '0073_settle_claim.sql', '0073_trap_locks.sql'],
    /version 0070 is taken by 2 files \(0070_autocorrect\.sql, 0070_jobs_key\.sql\)/);
  check('  and 0073 is named beside it', migrationFaults(['0073_settle_claim.sql', '0073_trap_locks.sql', '0070_a.sql', '0070_b.sql']).length === 2);
  red('three files on one version are counted', ['0005_a.sql', '0005_b.sql', '0005_c.sql'], /version 0005 is taken by 3 files/);
  red('a version of three digits is not a migration\'s name', ['0001_core.sql', '100_late.sql'], /100_late\.sql: not a migration's name/);
  red('a version of five digits is not one either', ['0001_core.sql', '00701_jobs_key.sql'], /00701_jobs_key\.sql: not a migration's name/);
  red('a name with no underscore after its version', ['0001core.sql'], /0001core\.sql: not a migration's name/);
  red('a name with a capital letter', ['0001_Core.sql'], /0001_Core\.sql: not a migration's name/);
  red('a name with a hyphen, as a test file has', ['0001-core.sql'], /0001-core\.sql: not a migration's name/);
  red('a timestamp version, as supabase migration new writes', ['0001_core.sql', '20261103120000_new.sql'], /20261103120000_new\.sql: not a migration's name/);
  check('a file that is not .sql is not read', migrationFaults(['0001_core.sql', 'README.md', '.gitkeep']).length === 0);

  const empty = run('empty', []);
  check('a folder with no migrations exits 1 as having none', empty.status === 1 && /no migrations/.test(empty.stderr), `${empty.status} ${empty.stderr}`);
  const missing = spawnSync(process.execPath, [script, path.join(root, 'nowhere')], { encoding: 'utf8' });
  check('a folder that is not there exits 1 as having none', missing.status === 1 && /no migrations/.test(missing.stderr), `${missing.status} ${missing.stderr}`);

  const real = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  check('the real supabase/migrations/ is clean', real.status === 0, real.stderr);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n  migration-versions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-migration-versions: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
