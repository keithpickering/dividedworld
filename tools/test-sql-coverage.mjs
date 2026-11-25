/**
 * The SQL suite fails when a client read is never called.
 *
 *   node tools/test-sql-coverage.mjs
 *
 * A `plpgsql` body is checked only when it runs, so a migration that drops a column a page reads
 * breaks that page and nothing else until somebody calls it. tools/test-sql.mjs therefore turns on
 * `track_functions` for each file's clone and, after each file and before its clone is dropped (a drop takes
 * the statistics with it), reads Postgres's own function statistics; the counts are summed over every file,
 * and once after the last file `uncalledReads` names the stable functions in ALLOWED_RPCS
 * (tools/check-web-reads.mjs) that no file called. The comparison is a guard, and the suite is outside the
 * build, so it is driven here: red on a name with no row and on a row with zero calls, green on a full set.
 * The wiring is held too, since a comparison nobody runs detects nothing: the suite's text must set
 * `track_functions` on each clone, read the counts from each clone before its drop, sum them, and run the
 * `coverage` step once, after the loops over the files.
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

check('the suite sets kayfabb.client_rpcs from ALLOWED_RPCS, and every setting through one list for the template and each clone', /set kayfabb\.client_rpcs to '\$\{ALLOWED_RPCS\.join\(','\)\}'/.test(code) && /clientRpcsSql\(db\)/.test(code) && /cloneSql\(template, clone, url\)/.test(code));
if (typeof runner.clientRpcsSql === 'function') {
  const sql = runner.clientRpcsSql('d');
  check('and the setting holds every client read, comma-joined', sql.includes(`'${ALLOWED_RPCS.join(',')}'`) && sql.startsWith('alter database d set kayfabb.client_rpcs'), sql.slice(0, 80));
}

/* A clone has none of the template's settings (`alter database … set` is not copied), so counting must be switched on for each clone. */
const clone = typeof runner.cloneSql === 'function' ? runner.cloneSql('t', 'c', 'postgres://postgres:pg@localhost:5432/postgres') : '';
check('track_functions is set on each clone, not only on the template', clone.includes("alter database c set track_functions to 'all';"), clone.slice(0, 120));
check('and client_rpcs too, which the counts are asked about', clone.includes(`alter database c set kayfabb.client_rpcs to '${ALLOWED_RPCS.join(',')}';`));
const afterAt = code.search(/psqlLines\(cloneUrl, afterFileSql\)/);
const dropAt = code.search(/drop database if exists \$\{clone\} with \(force\)/);
check('the counts are read from each clone before its drop', afterAt >= 0 && dropAt > afterAt, `read at ${afterAt}, drop at ${dropAt}`);
check('and kept, one list for each file', /counts\.push\(read\.calls\)/.test(code));
const comparisons = [...code.matchAll(/\buncalledReads\(/g)].filter((m) => !/function\s+$/.test(code.slice(0, m.index))).map((m) => m.index);
check('uncalledReads runs once', comparisons.length === 1, `${comparisons.length} calls`);
check('on the sum of every file\'s counts', /sumCalls\(counts\)/.test(code) && code.search(/sumCalls\(counts\)/) < (comparisons[0] ?? -1));
check('after the loops over the assertion files and the end-to-end files', comparisons.length === 1 && code.search(/for \(const t of files\)/) < comparisons[0] && e2eLoopAt < comparisons[0], `comparison at ${comparisons[0]}`);
if (typeof runner.afterFileSql === 'string') {
  check('what is read from a clone is the function statistics, after a forced flush', /pg_stat_force_next_flush\(\)/.test(runner.afterFileSql) && /pg_stat_user_functions/.test(runner.afterFileSql));
} else check('the runner exports afterFileSql', false);

const exempt = runner.UNCOUNTABLE_READS ?? {};
check('every uncountable read is a client read, with its reason', Object.entries(exempt).every(([n, why]) => ALLOWED_RPCS.includes(n) && typeof why === 'string' && why.length > 20), JSON.stringify(exempt));
check('and the suite takes them out before it compares', /filter\(\(n\) => !\(n in UNCOUNTABLE_READS\)\)/.test(code));

console.log(`\n  sql-coverage: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sql-coverage: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
