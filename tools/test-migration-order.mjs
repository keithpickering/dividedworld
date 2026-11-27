/**
 * Tests for the guard in tools/check-migration-order.mjs.
 *
 *   node tools/test-migration-order.mjs
 *
 * The guard fails a branch that adds a migration numbered at or below the newest one its base
 * has, so that supabase db push never meets a version older than one already applied. The first
 * case is 25 November: the base held 0425 and the branch added 0424. Each case runs the function
 * over names; the command is run with no --base and against HEAD, whose exit codes the CI reads.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderFaults } from './check-migration-order.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'check-migration-order.mjs');
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

const base = ['0423_a.sql', '0425_c.sql'];

const f1 = orderFaults(base, [...base, '0424_b.sql']);
check('25 Nov: 0424 added under a base whose newest is 0425 faults, naming both',
  f1.length === 1 && f1[0].includes('0424_b.sql') && f1[0].includes('0425_c.sql') && f1[0].includes('renumber it above 0425'), JSON.stringify(f1));
const f2 = orderFaults(base, [...base, '0425_d.sql']);
check('an added version equal to the base\'s newest faults', f2.length === 1 && f2[0].includes('0425_d.sql'), JSON.stringify(f2));
check('an added version above the newest passes', orderFaults(base, [...base, '0426_e.sql']).length === 0);
const f3 = orderFaults(base, ['0423_a.sql', '0425_c.sql'].filter((n) => n !== '0423_a.sql').concat('0422_a.sql'));
check('a rename of an existing file to a lower number faults', f3.some((f) => f.includes('0422_a.sql')), JSON.stringify(f3));
check('a rename to a number above the newest passes', orderFaults(base, ['0425_c.sql', '0426_a.sql']).length === 0);
check('a base with no migrations passes', orderFaults([], ['0001_a.sql']).length === 0);
check('names that are not migrations are ignored',
  orderFaults([...base, 'README.md'], [...base, 'README.md', 'notes.sql', '0001-x.sql', '0100_Bad.sql']).length === 0);

const none = spawnSync(process.execPath, [script], { encoding: 'utf8' });
check('the command with no --base exits 2 saying why', none.status === 2 && /--base/.test(none.stderr), `${none.status} ${none.stderr}`);
const bad = spawnSync(process.execPath, [script, '--base', 'no-such-ref-xyz'], { encoding: 'utf8' });
check('the command with a ref git cannot read exits 2', bad.status === 2, `${bad.status} ${bad.stderr}`);
const same = spawnSync(process.execPath, [script, '--base', 'HEAD'], { encoding: 'utf8', cwd: path.resolve(here, '..') });
check('the command against HEAD in this checkout exits 0', same.status === 0 && /0 migration\(s\) added/.test(same.stdout), `${same.status} ${same.stdout} ${same.stderr}`);

console.log(`\n  migration-order: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-migration-order: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
