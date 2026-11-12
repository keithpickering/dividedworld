/**
 * Tests for the guard in tools/check-one-clock.mjs.
 *
 *   node tools/test-one-clock.mjs
 *
 * The defect the guard exists to catch is a screen comparing a time from the data with the page's own clock, so the poison is exactly that: a
 * component calling `Date.now()` or `new Date()` with no argument. It must fire, and what only looks like it (a dated `new Date(x)`, a comment, a
 * string, a test, a story, a listed file within its count) must stay clean. The last case runs over the real tree, so a guard gone quiet fails here.
 */
import { clockFaults, clockReads, treeFiles, WALL_CLOCK } from './check-one-clock.mjs';

let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

/** @type {Record<string, { count: number; why: string }>} */
const none = {};
const faults = (text, file = 'engine/ui/x/X.tsx', allowed = none) => clockFaults({ [file]: text }, allowed);

/* ---- the poison ---- */
{
  const r = faults(`export const X = ({ at }: { at: string }) => <p>{Date.parse(at) > Date.now() ? 'later' : 'over'}</p>;`);
  check('a screen comparing a time with Date.now() fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and the read', r[0]?.file === 'engine/ui/x/X.tsx' && r[0]?.line === 1 && r[0]?.what === 'Date.now()', JSON.stringify(r));
}
check('new Date() with no argument fires', faults(`const now = new Date();`).length === 1);
check('new Date without parentheses fires', faults(`const now = new Date;`).length === 1);
check('a default parameter of Date.now() fires', faults(`export const ago = (iso: string, nowMs = Date.now()) => nowMs;`, 'engine/ui/x/x.ts').length === 1);
check('a plain .ts file is read', faults(`export const t = () => new Date().toISOString();`, 'engine/ui/x/x.ts').length === 1);

/* ---- what only looks like one ---- */
check('a dated new Date(x) is no read of the clock', faults(`const d = new Date(iso); const e = new Date(api.now());`).length === 0);
check('Date.parse and Date.UTC are no read of the clock', faults(`const a = Date.parse(x) + Date.UTC(2026, 9, 29);`).length === 0);
check('a comment is not read', faults(`// Date.now()\n/* new Date() */\nconst a = 1;`).length === 0);
check('a string is not read', faults(`const a = 'Date.now()';`).length === 0);
check('a test file is not read', faults(`const a = Date.now();`, 'engine/ui/x/X.test.tsx').length === 0);
check('a story file is not read', faults(`const a = new Date();`, 'engine/ui/x/X.stories.tsx').length === 0);
check('a file outside engine/ui is not read', faults(`const a = Date.now();`, 'web/src/App.tsx').length === 0);

/* ---- the allow-list ---- */
const listed = { 'engine/ui/x/X.tsx': { count: 1, why: 'a countdown' } };
check('a listed file within its count is clean', faults(`const a = Date.now();`, 'engine/ui/x/X.tsx', listed).length === 0);
{
  const r = faults(`const a = Date.now();\nconst b = Date.now();`, 'engine/ui/x/X.tsx', listed);
  check('a second read in a listed file fires, at the second', r.length === 1 && r[0]?.line === 2, JSON.stringify(r));
}
{
  const r = clockFaults({ 'engine/ui/x/X.tsx': `const a = 1;` }, listed);
  check('a listed file that no longer reads the clock is a stale entry', r.length === 1 && r[0]?.kind === 'stale', JSON.stringify(r));
}
check('clockReads counts each read with its line', JSON.stringify(clockReads(`a();\nDate.now();\nnew Date();`, 'x.ts').map((r) => r.line)) === '[2,3]');

/* ---- the real tree ---- */
{
  const files = treeFiles();
  check('the real tree is read', Object.keys(files).length > 100, String(Object.keys(files).length));
  const r = clockFaults(files);
  check('the real tree has no screen reading the page\'s clock beyond the list', r.length === 0, JSON.stringify(r));
  check('every listed entry has a reason', Object.values(WALL_CLOCK).every((e) => e.why.length > 20));
}

console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
