/**
 * Tests for the guard in tools/check-phrase-sql.mjs.
 *
 *   node tools/test-phrase-sql.mjs
 *
 * The guard holds supabase/tests/0136-phrase.sql to exactly what tools/phrase-sql.mjs makes from engine/bbcode/phrase.fixtures.ts.
 * A fixture dropped from the SQL test, one whose answer was flipped in the SQL test only, one added to the fixtures only, and a line of
 * the SQL test edited by hand that is not an assertion must each fire; the real pair must stay clean.
 */
import fs from 'node:fs';
import { phraseFaults, FIXTURES, TESTS } from './check-phrase-sql.mjs';
import { readFixtures, sqlTests } from './phrase-sql.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const fixturesText = fs.readFileSync(FIXTURES, 'utf8');
const sqlText = fs.readFileSync(TESTS, 'utf8');
check('the real pair agrees', phraseFaults(fixturesText, sqlText).length === 0, JSON.stringify(phraseFaults(fixturesText, sqlText).slice(0, 3)));

const rows = sqlText.split('\n');
const row = rows.findIndex((l) => /^ {4}\(\$f\$mixed case\$f\$/.test(l));
check('the poisons have a fixture row to work on', row > 0);
{
  const dropped = [...rows.slice(0, row), ...rows.slice(row + 1)].join('\n');
  check('a fixture dropped from the SQL test fires', phraseFaults(fixturesText, dropped).length > 0);
}
{
  const flipped = [...rows.slice(0, row), rows[row].replace(/(true|false)\)(,?)$/, (_, v, c) => (v === 'true' ? 'false' : 'true') + ')' + c), ...rows.slice(row + 1)].join('\n');
  check('the poison for a flipped answer really flipped the row', flipped !== sqlText);
  check('a fixture\'s answer flipped in the SQL test only fires', phraseFaults(fixturesText, flipped).length > 0);
}
{
  const list = readFixtures(fixturesText);
  const more = fixturesText.replace(/(export const PHRASE_FIXTURES[^=]*= )\[/, '$1[\n  { "name": "added to the fixtures only", "body": "x", "phrase": "x", "found": true },');
  check('the poison for an added fixture really added one', readFixtures(more).length === list.length + 1);
  check('a fixture added to the fixtures only fires', phraseFaults(more, sqlText).length > 0);
  check('the SQL test made from the added fixture is clean', phraseFaults(more, sqlTests(readFixtures(more))).length === 0);
}
{
  const first = rows.findIndex((l) => l.startsWith('begin'));
  const edited = [...rows.slice(0, first), '  -- an edit by hand', ...rows.slice(first)].join('\n');
  check('a line edited by hand that is not an assertion fires', phraseFaults(fixturesText, edited).length > 0);
  check('a lost last line fires', phraseFaults(fixturesText, rows.slice(0, -3).join('\n')).length > 0);
  check('a missing SQL test fires', phraseFaults(fixturesText, '').length > 0);
}
check('a fixtures module out of shape is a sentence, never a throw', (() => { try { return phraseFaults(fixturesText.replace('PHRASE_FIXTURES', 'OTHER'), sqlText).length === 1; } catch { return false; } })());
check('a fixture the SQL cannot carry is a sentence, never a throw', (() => { try { return phraseFaults(fixturesText.replace(/"name": "mixed case"/, '"name": "x$f$y"'), sqlText).length === 1; } catch { return false; } })());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
