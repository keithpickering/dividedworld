/**
 * Tests for the guard in tools/check-name-folds.mjs.
 *
 *   node tools/test-name-folds.mjs
 *
 * The guard holds the name folds to one list: the database's copy (supabase/migrations/
 * 0010_name_folds.sql) must be exactly what tools/name-folds.mjs makes from the client's copy
 * (engine/rules/name-folds.data.ts), its Unicode release included. A mapping the migration lost,
 * one it gained, a release that drifted, or a migration edited by hand must each fire; the real
 * pair must stay clean.
 */
import fs from 'node:fs';
import { foldFaults, DATA, MIGRATION } from './check-name-folds.mjs';
import { parseCaseFolding, parseConfusables, parseUnicodeData } from './name-folds.mjs';

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
  const cut = rows.slice(0, -4).join('\n');
  check('a migration that lost its last lines fires', foldFaults(data, cut).length > 0);
  check('a data module with a table missing is a sentence, never a throw', (() => { try { return foldFaults(data.replace('"ccc": {', '"cccc": {'), migration).length > 0; } catch { return false; } })());
}
{
  const edited = migration.replace(/create table name_maps/, '-- an edit by hand\ncreate table name_maps');
  check('a migration edited by hand fires', foldFaults(data, edited).length > 0);
}

/* ---- the parsers, on lines of each file's own shape ---- */
{
  const conf = parseConfusables('# Date: 2026-08-06, 01:05:35 GMT\n# Version: 18.0.0\n\n0021 ;\t01C3 ;\tMA\t# ( ! → ǃ )\n1D400 ;\t0041 ;\tMA\t# astral\n00C6 ;\t0041 0045 ;\tMA\t# two\n');
  check('confusables: an astral source, a target of two code points, and the release', conf.version === '18.0.0' && conf.map['\u{1D400}'] === 'A' && conf.map['\u00C6'] === 'AE' && conf.map['!'] === '\u01C3', JSON.stringify(conf.map));
  let threw = false;
  try { parseConfusables('# Date: 2026-08-06\n# Version: 18.0.0\n0021 ; 01C3 ; MA # spaces, not tabs\n'); } catch { threw = true; }
  check('confusables: a data line the parser cannot read is refused, never dropped', threw);
  const fold = parseCaseFolding('# CaseFolding-18.0.0.txt\n0041; C; 0061; # A\n00DF; F; 0073 0073; # sharp s\n1E9E; S; 00DF; # simple\n0049; T; 0131; # Turkic\n');
  check('case folding: C and F kept, S and T left out', fold.version === '18.0.0' && fold.map.A === 'a' && fold.map['\u00DF'] === 'ss' && !('\u1E9E' in fold.map) && fold.map.I === undefined, JSON.stringify(fold.map));
  const ucd = parseUnicodeData([
    '0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;',
    '00C0;LATIN CAPITAL LETTER A WITH GRAVE;Lu;0;L;0041 0300;;;;N;;;;00E0;',
    '0300;COMBINING GRAVE ACCENT;Mn;230;NSM;;;;;N;;;;;',
    '1EA6;LATIN CAPITAL LETTER A WITH CIRCUMFLEX AND GRAVE;Lu;0;L;00C2 0300;;;;N;;;;1EA7;',
    '00C2;LATIN CAPITAL LETTER A WITH CIRCUMFLEX;Lu;0;L;0041 0302;;;;N;;;;00E2;',
    '00BD;VULGAR FRACTION ONE HALF;No;0;ON;<fraction> 0031 2044 0035;;;1/2;N;;;;;',
  ].join('\n'));
  const refuses = (f) => { try { f(); return false; } catch { return true; } };
  check('case folding: a data line the parser cannot read is refused', refuses(() => parseCaseFolding('# CaseFolding-18.0.0.txt\n0041 C 0061 # no semicolons\n')));
  check('unicode data: a data line the parser cannot read is refused', refuses(() => parseUnicodeData('0041;LATIN CAPITAL LETTER A;Lu;0\n')));
  check('unicode data: a decomposition that never ends is refused', refuses(() => parseUnicodeData(['0041;A;Lu;0;L;0042;;;;N;;;;;', '0042;B;Lu;0;L;0041;;;;N;;;;;'].join('\n'))));
  check('unicode data: a decomposition taken to its end, a compatibility one left out, a mark\'s class', ucd.decompose['\u1EA6'] === 'A\u0302\u0300' && ucd.decompose['\u00C0'] === 'A\u0300' && !('\u00BD' in ucd.decompose) && ucd.ccc['\u0300'] === 230 && !('A' in ucd.ccc), JSON.stringify(ucd));
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
