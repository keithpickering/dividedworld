/**
 * Holds the plain words to one list: supabase/tests/0117-bbcode-plain.sql must be exactly what
 * tools/bbcode-plain.mjs makes from engine/bbcode/plain.fixtures.ts, the list engine/bbcode/
 * plain.test.ts holds `visibleText` to. So a fixture the database's `bbcode_plain` is not tested
 * on, one tested on other words than the engine gives, and a test edited by hand each fail the
 * build ("Two lists that must agree are one list").
 *
 *   node tools/check-bbcode-plain.mjs
 *
 * tools/test-bbcode-plain.mjs drives it red.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIXTURES, TESTS, readFixtures, sqlTests } from './bbcode-plain.mjs';

export { FIXTURES, TESTS };

/** What is wrong with the pair, as sentences; nothing when the SQL test is the fixtures'. */
export function plainFaults(fixturesText, sqlText) {
  let fixtures;
  try { fixtures = readFixtures(fixturesText); } catch (e) { return [String(e.message)]; }
  let want;
  try { want = sqlTests(fixtures).split('\n'); } catch (e) { return [String(e.message)]; }
  const have = sqlText.split('\n');
  for (let i = 0; i < Math.max(want.length, have.length); i++) {
    if (want[i] !== have[i]) {
      return [`${TESTS} is not what tools/bbcode-plain.mjs makes from ${FIXTURES}: line ${i + 1} is ${JSON.stringify(have[i] ?? '(none)')}, made ${JSON.stringify(want[i] ?? '(none)')}; run node tools/bbcode-plain.mjs`];
    }
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const faults = plainFaults(fs.readFileSync(FIXTURES, 'utf8'), fs.existsSync(TESTS) ? fs.readFileSync(TESTS, 'utf8') : '');
  if (faults.length) { for (const f of faults) console.error(f); process.exit(1); }
  console.log(`bbcode plain: ${TESTS} is ${FIXTURES}'s`);
}
