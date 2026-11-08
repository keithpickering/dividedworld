/**
 * Holds the phrase matcher to one list: supabase/tests/0136-phrase.sql must be exactly what tools/phrase-sql.mjs makes from
 * engine/bbcode/phrase.fixtures.ts, the list engine/bbcode/phrase.test.ts holds `phraseIn` to. So a fixture the database's
 * `phrase_in` is not tested on, one tested on another answer than the engine gives, and a test edited by hand each fail the
 * build ("Two lists that must agree are one list").
 *
 *   node tools/check-phrase-sql.mjs
 *
 * tools/test-phrase-sql.mjs drives it red.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIXTURES, TESTS, readFixtures, sqlTests } from './phrase-sql.mjs';

export { FIXTURES, TESTS };

/** What is wrong with the pair, as sentences; nothing when the SQL test is the fixtures'. */
export function phraseFaults(fixturesText, sqlText) {
  let fixtures;
  try { fixtures = readFixtures(fixturesText); } catch (e) { return [String(e.message)]; }
  let want;
  try { want = sqlTests(fixtures).split('\n'); } catch (e) { return [String(e.message)]; }
  const have = sqlText.split('\n');
  for (let i = 0; i < Math.max(want.length, have.length); i++) {
    if (want[i] !== have[i]) {
      return [`${TESTS} is not what tools/phrase-sql.mjs makes from ${FIXTURES}: line ${i + 1} is ${JSON.stringify(have[i] ?? '(none)')}, made ${JSON.stringify(want[i] ?? '(none)')}; run node tools/phrase-sql.mjs`];
    }
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const faults = phraseFaults(fs.readFileSync(FIXTURES, 'utf8'), fs.existsSync(TESTS) ? fs.readFileSync(TESTS, 'utf8') : '');
  if (faults.length) { for (const f of faults) console.error(f); process.exit(1); }
  console.log(`phrase: ${TESTS} is ${FIXTURES}'s`);
}
