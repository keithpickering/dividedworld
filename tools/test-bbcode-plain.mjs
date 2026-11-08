/**
 * Tests for the guard in tools/check-bbcode-plain.mjs.
 *
 *   node tools/test-bbcode-plain.mjs
 *
 * The guard holds supabase/tests/0117-bbcode-plain.sql to exactly what tools/bbcode-plain.mjs makes
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
  const changed = [...rows.slice(0, row), rows[row].replace(/\$f\$, null, null\)(,?)$/, ' changed$f$, null, null)$1'), ...rows.slice(row + 1)].join('\n');
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
{
  // The excerpt lines: one fixture row that holds an excerpt, changed in the SQL test only, dropped to none, or made of an Act id that is not one.
  const exRow = rows.findIndex((l) => /^ {4}\(\$f\$the excerpt: one quote of the act\$f\$/.test(l));
  check('the poisons have an excerpt row to work on', exRow > 0 && /\$f\$cats in a quote\$f\$\),?$/.test(rows[exRow]), rows[exRow]);
  const wrongWords = [...rows.slice(0, exRow), rows[exRow].replace(/\$f\$cats in a quote\$f\$\)(,?)$/, '$f$cats in a quote and more$f$)$1'), ...rows.slice(exRow + 1)].join('\n');
  check('the poison for a changed excerpt really changed the row', wrongWords !== sqlText);
  check('an excerpt changed in the SQL test only fires', plainFaults(fixturesText, wrongWords).length > 0);
  const noExcerpt = [...rows.slice(0, exRow), rows[exRow].replace(/, \$f\$[^$]*\$f\$, \$f\$cats in a quote\$f\$\)(,?)$/, ', null, null)$1'), ...rows.slice(exRow + 1)].join('\n');
  check('the poison for a dropped excerpt really dropped it', noExcerpt !== sqlText);
  check('an excerpt dropped from the SQL test only fires', plainFaults(fixturesText, noExcerpt).length > 0);
  const list = readFixtures(fixturesText);
  check('the SQL test asserts bbcode_walk\'s excerpt', sqlText.includes('bbcode_walk(f.body, f.excerptof::uuid)') && sqlText.includes('f.excerpt'));
  const lone = fixturesText.replace(/"excerpt": "cats in a quote"/, '"note": "cats in a quote"');
  check('a fixture with an excerptOf and no excerpt is a sentence, never a throw', (() => { try { const fs = plainFaults(lone, sqlText); return fs.length === 1 && /excerpt/.test(fs[0]); } catch { return false; } })());
  const notAnId = fixturesText.replace(/"excerptOf": "0f8fad5b-d9cb-469f-a165-70867728950e",\n    "excerpt": "cats in a quote"/, '"excerptOf": "nope",\n    "excerpt": "cats in a quote"');
  check('an excerptOf that is not an Act id is a sentence, never a throw', (() => { try { const fs = plainFaults(notAnId, sqlText); return fs.length === 1 && /excerptOf/.test(fs[0]); } catch { return false; } })());
  check('the real list has fixtures with an excerpt', list.filter((f) => f.excerptOf !== undefined).length >= 12);
}
check('a fixtures module out of shape is a sentence, never a throw', (() => { try { return plainFaults(fixturesText.replace('PLAIN_FIXTURES', 'OTHER'), sqlText).length === 1; } catch { return false; } })());
check('a fixture the SQL cannot carry is a sentence, never a throw', (() => { try { return plainFaults(fixturesText.replace(/"name": "plain text"/, '"name": "x$f$y"'), sqlText).length === 1; } catch { return false; } })());

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
