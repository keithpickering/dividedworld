/**
 * Holds the name folds to one list: supabase/migrations/0010_name_folds.sql must be exactly what
 * tools/name-folds.mjs makes from engine/rules/name-folds.data.ts, the client's copy, so the
 * client never tells a player a name is free that the database refuses, nor the other way, and
 * both name the same Unicode release ("Two lists that must agree are one list").
 *
 *   node tools/check-name-folds.mjs
 *
 * tools/test-name-folds.mjs drives it red.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA, MIGRATION, migration, readData } from './name-folds.mjs';

export { DATA, MIGRATION };

/** What is wrong with the pair, as sentences; nothing when the migration is the data's. */
export function foldFaults(dataText, migrationText) {
  let data;
  try { data = readData(dataText); } catch (e) { return [String(e.message)]; }
  for (const k of ['unicode', 'confusablesDate', 'caseFolding', 'confusablesSha256', 'caseFoldingSha256']) {
    if (typeof data[k] !== 'string' || !data[k]) return [`${DATA}: no ${k}`];
  }
  const want = migration(data).split('\n');
  const have = migrationText.split('\n');
  for (let i = 0; i < Math.max(want.length, have.length); i++) {
    if (want[i] !== have[i]) {
      return [`${MIGRATION} is not what tools/name-folds.mjs makes from ${DATA}: line ${i + 1} is ${JSON.stringify(have[i] ?? '(none)')}, made ${JSON.stringify(want[i] ?? '(none)')}`];
    }
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const faults = foldFaults(fs.readFileSync(DATA, 'utf8'), fs.readFileSync(MIGRATION, 'utf8'));
  if (faults.length) { for (const f of faults) console.error(f); process.exit(1); }
  console.log(`name folds: ${MIGRATION} is ${DATA}'s`);
}
