/**
 * Holds the outcome quote's cases to one list: supabase/tests/0452-outcome-quotes-parity.sql must be exactly what
 * tools/outcome-quote-fixtures.mjs makes from engine/bbcode/outcome-quote.fixtures.ts, the list engine/bbcode/outcome-quote.test.ts
 * and engine/ui/data/fake.test.tsx hold `outcomeQuote` to. So a case the database's `outcome_quote` is not tested on, one tested on
 * other words than the engine gives, and a test edited by hand each fail the build ("Two lists that must agree are one list").
 *
 *   node tools/check-outcome-quote-fixtures.mjs
 *
 * tools/test-outcome-quote-fixtures.mjs drives it red.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIXTURES, TESTS, readFixtures, sqlTests } from './outcome-quote-fixtures.mjs';

export { FIXTURES, TESTS };

/** What is wrong with the pair, as sentences; nothing when the SQL test is the fixtures'. */
export function quoteFaults(fixturesText, sqlText) {
  let fixtures;
  try { fixtures = readFixtures(fixturesText); } catch (e) { return [String(e.message)]; }
  let want;
  try { want = sqlTests(fixtures).split('\n'); } catch (e) { return [String(e.message)]; }
  const have = sqlText.split('\n');
  for (let i = 0; i < Math.max(want.length, have.length); i++) {
    if (want[i] !== have[i]) {
      return [`${TESTS} is not what tools/outcome-quote-fixtures.mjs makes from ${FIXTURES}: line ${i + 1} is ${JSON.stringify(have[i] ?? '(none)')}, made ${JSON.stringify(want[i] ?? '(none)')}; run node tools/outcome-quote-fixtures.mjs`];
    }
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const faults = quoteFaults(fs.readFileSync(FIXTURES, 'utf8'), fs.existsSync(TESTS) ? fs.readFileSync(TESTS, 'utf8') : '');
  if (faults.length) { for (const f of faults) console.error(f); process.exit(1); }
  console.log(`outcome quote fixtures: ${TESTS} is ${FIXTURES}'s`);
}
