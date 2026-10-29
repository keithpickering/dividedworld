/**
 * Tests for the guard in tools/check-name-folds.mjs.
 *
 *   node tools/test-name-folds.mjs
 *
 * The guard holds the name folds to one list: the database's copy (supabase/migrations/
 * 0010_names.sql) must be exactly what tools/name-folds.mjs makes from the client's copy
 * (engine/rules/name-folds.data.ts), its Unicode release included. A mapping the migration lost,
 * one it gained, a release that drifted, or a migration edited by hand must each fire; the real
 * pair must stay clean.
 */
import fs from 'node:fs';
import { foldFaults, DATA, MIGRATION } from './check-name-folds.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const data = fs.readFileSync(DATA, 'utf8');
const migration = fs.readFileSync(MIGRATION, 'utf8');
check('the real pair agrees', foldFaults(data, migration).length === 0, JSON.stringify(foldFaults(data, migration).slice(0, 3)));

const rows = migration.split('\n');
const mapping = rows.findIndex((l) => /^\s*\('confusable', /.test(l));
{
  const lost = [...rows.slice(0, mapping), ...rows.slice(mapping + 1)].join('\n');
  check('a mapping the migration lost fires', foldFaults(data, lost).length > 0);
}
{
  const gained = [...rows.slice(0, mapping), rows[mapping], rows[mapping].replace(/^(\s*\('confusable', )U&'[^']*'/, "$1U&'\\+10FFFD'"), ...rows.slice(mapping + 1)].join('\n');
  check('a mapping the migration gained fires', foldFaults(data, gained).length > 0);
}
{
  const release = data.replace(/"unicode": "[^"]+"/, '"unicode": "1.0.0"');
  check('a client copy of another release fires', foldFaults(release, migration).length > 0);
}
{
  const edited = migration.replace(/create table name_maps/, '-- an edit by hand\ncreate table name_maps');
  check('a migration edited by hand fires', foldFaults(data, edited).length > 0);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
