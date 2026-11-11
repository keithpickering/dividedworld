/**
 * Tests for the guard in tools/check-visit-outcome-words.mjs.
 *
 *   node tools/test-visit-outcome-words.mjs
 *
 * The guard holds the glass's words for how a visit ended to the outcomes the database allows. Each poison must fire (naming what is wrong) and the real
 * tree must stay clean: the old `/^Rule \d/iu` notice test (which doubles "House Rule 1: x"); a `reversed` whose only writer passes a
 * null `by_act` while the words say "admin" (main before the plain-words plan's Task 6); an outcome added to the SQL's list with no
 * words; and words for an outcome the SQL does not allow.
 */
import { visitWordFaults, readTree } from './check-visit-outcome-words.mjs';

let pass = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? '  <- ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error('the poison finds nothing to change: ' + from);
  return text.replace(from, to);
};

const tree = readTree();
const real = await visitWordFaults(tree);
check('the real tree is clean', real.length === 0, JSON.stringify(real.slice(0, 3)));

const fire = async (name, poisoned, needle) => {
  const faults = await visitWordFaults({ ...tree, ...poisoned });
  check(name + ' fires', faults.length > 0 && faults.every((f) => f.includes(needle)), JSON.stringify(faults.slice(0, 3)));
};

await fire('the old rule-number test', { visitText: swap(tree.visitText, '/^(House )?Rule \\d/iu', '/^Rule \\d/iu') }, 'House Rule 1: x');

const reversedWriter = (third) => `\ncreate or replace function ender() returns void language plpgsql as $$ begin perform end_visit(v, 'reversed', ${third}, 'x'); end $$;\n`;
await fire('a reversed whose only writer names no Act while the words say admin', { sqlText: tree.sqlText + reversedWriter('null') }, "reversed");
{
  const ok = await visitWordFaults({ ...tree, sqlText: tree.sqlText + reversedWriter('some_act') });
  check('a reversed writer that names an Act may say admin', ok.length === 0, JSON.stringify(ok));
}
{
  // The real tree has no reversed writer today, and its words say admin: the words wait.
  check('words for an outcome with no writer may say admin', real.length === 0 && /admin/i.test(tree.visitText));
}

await fire('an outcome added to the SQL list with no words', { sqlText: swap(tree.sqlText, "'reversed', 'dropped') then raise", "'reversed', 'dropped', 'vanished') then raise") }, 'vanished');
await fire('words for an outcome the SQL does not allow', { sqlText: swap(tree.sqlText, "'reversed', 'dropped') then raise", "'reversed') then raise") }, 'dropped');

if (failures.length) { console.error(`\n${failures.length} failed:`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`\n${pass} passed`);
