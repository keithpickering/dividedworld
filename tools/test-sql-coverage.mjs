/**
 * The SQL suite fails when a client read is never called.
 *
 *   node tools/test-sql-coverage.mjs
 *
 * A `plpgsql` body is checked only when it runs, so a migration that drops a column a page reads
 * breaks that page and nothing else until somebody calls it. tools/test-sql.mjs therefore turns on
 * `track_functions` for the scratch database and, after its last file, asks Postgres's own function
 * statistics which stable functions in ALLOWED_RPCS (tools/check-web-reads.mjs) were never called;
 * `uncalledReads` is that comparison. The comparison is a guard, and the suite is outside the build,
 * so it is driven here: red on a name with no row and on a row with zero calls, green on a full set.
 * The wiring is held too: the suite's text must set `track_functions` and run the `coverage` step
 * after the end-to-end loop, since a comparison nobody runs detects nothing.
 */
import fs from 'node:fs';
import * as runner from './test-sql.mjs';
import { ALLOWED_RPCS } from './check-web-reads.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uncalled = runner.uncalledReads;

check('the runner exports uncalledReads', typeof uncalled === 'function');
if (typeof uncalled === 'function') {
  const planted = uncalled(['thread_page', 'planted_read'], [{ name: 'thread_page', calls: 3 }]);
  check('a name with no row is named', same(planted, ['planted_read']), JSON.stringify(planted));
  const zero = uncalled(['thread_page', 'planted_read'], [{ name: 'thread_page', calls: 3 }, { name: 'planted_read', calls: 0 }]);
  check('a row with zero calls is named', same(zero, ['planted_read']), JSON.stringify(zero));
  const full = uncalled(['thread_page', 'board_page'], [{ name: 'thread_page', calls: 3 }, { name: 'board_page', calls: 1 }]);
  check('a full set answers nothing', same(full, []), JSON.stringify(full));
  const sorted = uncalled(['zeta', 'alpha', 'mid'], []);
  check('the names come back sorted', same(sorted, ['alpha', 'mid', 'zeta']), JSON.stringify(sorted));
  const extra = uncalled(['a'], [{ name: 'a', calls: 2 }, { name: 'not_listed', calls: 0 }]);
  check('a row for a name not asked about is ignored', same(extra, []), JSON.stringify(extra));
  const strings = uncalled(['a'], [{ name: 'a', calls: '2' }]);
  check('a count that arrives as text is read as a number', same(strings, []), JSON.stringify(strings));
}

const text = fs.readFileSync('tools/test-sql.mjs', 'utf8');
const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const trackAt = code.search(/track_functions/);
const e2eLoopAt = code.search(/for \(const f of e2e\)/);
const coverageAt = code.search(/step\(\s*'coverage'/);
check('the suite sets track_functions', trackAt >= 0);
check('and reads ALLOWED_RPCS from check-web-reads, with no copy', /import \{[^}]*\bALLOWED_RPCS\b[^}]*\} from '\.\/check-web-reads\.mjs'/.test(code));
check('and runs the coverage step', coverageAt >= 0);
check('after the end-to-end loop', e2eLoopAt >= 0 && coverageAt > e2eLoopAt, `loop at ${e2eLoopAt}, coverage at ${coverageAt}`);
check('and forces the statistics flush first', /pg_stat_force_next_flush\(\)/.test(code));

check('the suite sets kayfabb.client_rpcs from ALLOWED_RPCS on the scratch database', /set kayfabb\.client_rpcs to '\$\{ALLOWED_RPCS\.join\(','\)\}'/.test(code) && /clientRpcsSql\(scratch\)/.test(code));
if (typeof runner.clientRpcsSql === 'function') {
  const sql = runner.clientRpcsSql('d');
  check('and the setting holds every client read, comma-joined', sql.includes(`'${ALLOWED_RPCS.join(',')}'`) && sql.startsWith('alter database d set kayfabb.client_rpcs'), sql.slice(0, 80));
}

const exempt = runner.UNCOUNTABLE_READS ?? {};
check('every uncountable read is a client read, with its reason', Object.entries(exempt).every(([n, why]) => ALLOWED_RPCS.includes(n) && typeof why === 'string' && why.length > 20), JSON.stringify(exempt));
check('and the suite takes them out before it compares', /filter\(\(n\) => !\(n in UNCOUNTABLE_READS\)\)/.test(code));

console.log(`\n  sql-coverage: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sql-coverage: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
