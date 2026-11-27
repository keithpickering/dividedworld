/**
 * Tests for the guard in tools/check-outcome-quote-fixtures.mjs.
 *
 *   node tools/test-outcome-quote-fixtures.mjs
 *
 * The guard holds supabase/tests/0452-outcome-quotes-parity.sql to exactly what tools/outcome-quote-fixtures.mjs makes from
 * engine/bbcode/outcome-quote.fixtures.ts. A case dropped from the SQL test, one whose words were changed in the SQL test only,
 * one whose room was, one added to the fixtures only, and a line of the SQL test edited by hand that is not an assertion must
 * each fire; the real pair must stay clean.
 */
import fs from 'node:fs';
import { quoteFaults, FIXTURES, TESTS } from './check-outcome-quote-fixtures.mjs';
import { readFixtures, sqlTests } from './outcome-quote-fixtures.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const fixturesText = fs.readFileSync(FIXTURES, 'utf8');
const sqlText = fs.readFileSync(TESTS, 'utf8');
check('the real pair agrees', quoteFaults(fixturesText, sqlText).length === 0, JSON.stringify(quoteFaults(fixturesText, sqlText).slice(0, 3)));

const rows = sqlText.split('\n');
const row = rows.findIndex((l) => /^ {4}\(\$f\$cut at a word\$f\$/.test(l));
check('the poisons have a case row to work on', row > 0 && /, 9, \$f\$alpha…\$f\$\),?$/.test(rows[row]), rows[row]);
{
  const dropped = [...rows.slice(0, row), ...rows.slice(row + 1)].join('\n');
  check('a case dropped from the SQL test fires', quoteFaults(fixturesText, dropped).length > 0);
}
{
  const changed = [...rows.slice(0, row), rows[row].replace('$f$alpha…$f$', '$f$alpha beta…$f$'), ...rows.slice(row + 1)].join('\n');
  check('the poison for changed words really changed the row', changed !== sqlText);
  check('a case\'s words changed in the SQL test only fires', quoteFaults(fixturesText, changed).length > 0);
}
{
  const changed = [...rows.slice(0, row), rows[row].replace(', 9, ', ', 10, '), ...rows.slice(row + 1)].join('\n');
  check('the poison for a changed room really changed the row', changed !== sqlText);
  check('a case\'s room changed in the SQL test only fires', quoteFaults(fixturesText, changed).length > 0);
}
{
  const list = readFixtures(fixturesText);
  const more = fixturesText.replace(/(export const OUTCOME_QUOTE_FIXTURES[^=]*= )\[/, '$1[\n  { "name": "added to the fixtures only", "body": "x", "room": 50, "words": "x" },');
  check('the poison for an added case really added one', readFixtures(more).length === list.length + 1);
  check('a case added to the fixtures only fires', quoteFaults(more, sqlText).length > 0);
  check('the SQL test made from the added case is clean', quoteFaults(more, sqlTests(readFixtures(more))).length === 0);
}
{
  const first = rows.findIndex((l) => l.startsWith('begin'));
  const edited = [...rows.slice(0, first), '  -- an edit by hand', ...rows.slice(first)].join('\n');
  check('a line edited by hand that is not an assertion fires', quoteFaults(fixturesText, edited).length > 0);
  check('a lost last line fires', quoteFaults(fixturesText, rows.slice(0, -3).join('\n')).length > 0);
  check('a missing SQL test fires', quoteFaults(fixturesText, '').length > 0);
}
{
  const list = readFixtures(fixturesText);
  const at = (n) => list.find((f) => f.name === n);
  const whole = at('280 code points whole, 281 cut: exactly 280');
  const cut = at('280 code points whole, 281 cut: 281 is cut');
  check('the list has the 280 boundary, whole at 280 and cut at 281', Array.from(whole?.body ?? '').length === 280 && whole.words === whole.body && Array.from(cut?.body ?? '').length === 281 && cut.words === 'abcdefgh'.repeat(35) + '…');
  check('the list has a case with no room', list.some((f) => f.words === null));
}
check('a case with a room that is not a number is a sentence, never a throw', (() => { try { const fs = quoteFaults(fixturesText.replace('"room": 9,', '"room": "9",'), sqlText); return fs.length === 1 && /room/.test(fs[0]); } catch { return false; } })());
check('a fixtures module out of shape is a sentence, never a throw', (() => { try { return quoteFaults(fixturesText.replace('OUTCOME_QUOTE_FIXTURES', 'OTHER'), sqlText).length === 1; } catch { return false; } })());
check('a case the SQL cannot carry is a sentence, never a throw', (() => { try { return quoteFaults(fixturesText.replace(/"name": "whole"/, '"name": "x$f$y"'), sqlText).length === 1; } catch { return false; } })());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
