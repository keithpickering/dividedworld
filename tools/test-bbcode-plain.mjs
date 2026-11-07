/**
 * Tests for the guard in tools/check-bbcode-plain.mjs.
 *
 *   node tools/test-bbcode-plain.mjs
 *
 * The guard holds supabase/tests/0116-bbcode-plain.sql to exactly what tools/bbcode-plain.mjs makes
 * from engine/bbcode/plain.fixtures.ts. A fixture dropped from the SQL test, one whose plain words
 * were changed in the SQL test only, one added to the fixtures only, and a line of the SQL test
 * edited by hand that is not an assertion must each fire; the real pair must stay clean.
 */
import fs from 'node:fs';
import { plainFaults, FIXTURES, TESTS } from './check-bbcode-plain.mjs';
import { readFixtures, sqlTests } from './bbcode-plain.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const fixturesText = fs.readFileSync(FIXTURES, 'utf8');
const sqlText = fs.readFileSync(TESTS, 'utf8');
check('the real pair agrees', plainFaults(fixturesText, sqlText).length === 0, JSON.stringify(plainFaults(fixturesText, sqlText).slice(0, 3)));

const rows = sqlText.split('\n');
const row = rows.findIndex((l) => /^ {4}\(\$f\$a link with = /.test(l));
check('the poisons have a fixture row to work on', row > 0);
{
  const dropped = [...rows.slice(0, row), ...rows.slice(row + 1)].join('\n');
  check('a fixture dropped from the SQL test fires', plainFaults(fixturesText, dropped).length > 0);
}
{
  const changed = [...rows.slice(0, row), rows[row].replace(/\$f\$\)(,?)$/, ' changed$f$)$1'), ...rows.slice(row + 1)].join('\n');
  check('the poison for a changed plain really changed the row', changed !== sqlText);
  check('a fixture\'s plain words changed in the SQL test only fires', plainFaults(fixturesText, changed).length > 0);
}
{
  const list = readFixtures(fixturesText);
  const more = fixturesText.replace(/(export const PLAIN_FIXTURES[^=]*= )\[/, '$1[\n  { "name": "added to the fixtures only", "body": "[b]x[/b]", "plain": "x" },');
  check('the poison for an added fixture really added one', readFixtures(more).length === list.length + 1);
  check('a fixture added to the fixtures only fires', plainFaults(more, sqlText).length > 0);
  check('the SQL test made from the added fixture is clean', plainFaults(more, sqlTests(readFixtures(more))).length === 0);
}
{
  const first = rows.findIndex((l) => l.startsWith('begin'));
  const edited = [...rows.slice(0, first), '  -- an edit by hand', ...rows.slice(first)].join('\n');
  check('a line edited by hand that is not an assertion fires', plainFaults(fixturesText, edited).length > 0);
  check('a lost last line fires', plainFaults(fixturesText, rows.slice(0, -3).join('\n')).length > 0);
}
check('a fixtures module out of shape is a sentence, never a throw', (() => { try { return plainFaults(fixturesText.replace('PLAIN_FIXTURES', 'OTHER'), sqlText).length === 1; } catch { return false; } })());
check('a fixture the SQL cannot carry is a sentence, never a throw', (() => { try { return plainFaults(fixturesText.replace(/"name": "plain text"/, '"name": "x$f$y"'), sqlText).length === 1; } catch { return false; } })());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
