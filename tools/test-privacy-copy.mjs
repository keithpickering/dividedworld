/**
 * Tests for the guard in tools/check-privacy-copy.mjs.
 *
 *   node tools/test-privacy-copy.mjs
 *
 * Each way the copy can promise more privacy than the game gives is planted in an in-memory source and must fire; the same words in a
 * comment, a rewording and an excluded path must stay clean; and the real tree runs clean last, so a guard gone quiet over nothing fails here.
 */
import { copyFaults, copyFiles, readTree } from './check-privacy-copy.mjs';

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

const P = 'engine/ui/x/Thing.tsx';
const faultsOf = (source, path = P) => copyFaults({ [path]: source });

/* ---- planted: each must fire, once, on the right line ---- */
for (const [name, source, line] of [
  ['a string literal', 'export const a = 1;\nexport const t = "Only you see this";\n', 2],
  ['a JSX text', 'export const J = () => (\n  <p>\n    only you see here\n  </p>\n);\n', 3],
  ['a template literal', 'const f = (x: string) => `${x} class stays yours alone.`;\n', 1],
  ['a template literal with a substitution before the verb', 'const f = (x: string) => `nobody ${x} sees it`;\n', 1],
  ['a template literal whose substitution splits the phrase', 'const f = (x: string) => `Only you${x} can see these`;\n', 1],
  ['a past tense', 'const t = "So nobody learned who";\n', 1],
  ['an aria-label attribute', 'const J = () => <b aria-label="Only you know this">x</b>;\n', 1],
  ['a plain template with no substitution', 'const t = `No one saw it`;\n', 1],
]) {
  const r = faultsOf(source);
  check(`${name} fires`, r.length === 1 && r[0].file === P && r[0].line === line && /more privacy than the game gives/.test(r[0].why), JSON.stringify(r));
}

/* ---- clean ---- */
check('the phrase in a // comment is not read', faultsOf('// Only you see this, and nobody learned who.\nconst a = 1;\n').length === 0);
check('the phrase in a /* */ comment is not read', faultsOf('/* Only you see this, yours alone. */\nconst a = 1;\n').length === 0);
check('the phrase in a JSX comment is not read', faultsOf('const J = () => <p>{/* only you see here */}ok</p>;\n').length === 0);
check('"No other player sees this" is clean', faultsOf('const t = "No other player sees this";\n').length === 0);
check('a *.test.ts path is not read', copyFiles(['engine/a.test.ts', 'engine/a.test.tsx', 'engine/a.ts']).join() === 'engine/a.ts');
for (const path of ['engine/ui/Thing.stories.tsx', 'engine/ui/data/fake.ts', 'e2e/boards/x.ts', 'tools/x.ts', 'engine/ui/x.md', 'web/src/main.tsx', 'instances/divided-world/ui/cards/a/ui.ts']) {
  const kept = copyFiles([path]).length === 1;
  const want = /^(web\/src\/main\.tsx|instances\/.*ui\.ts)$/.test(path);
  check(`path ${path} is ${want ? 'read' : 'left out'}`, kept === want);
}
check('a file that cannot parse as TypeScript still reads its strings', faultsOf('const t = "Only you see this"; }}}\n').length === 1);

/* ---- the real tree ---- */
{
  const files = readTree();
  check('the real tree reads files (a guard reading nothing would pass)', Object.keys(files).length > 100, String(Object.keys(files).length));
  const r = copyFaults(files);
  check('the real tree is clean', r.length === 0, r.map((f) => `${f.file}:${f.line}`).join(' '));
}

console.log(`\n  privacy-copy: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  console.error('  test-privacy-copy: FAILED');
  process.exit(1);
}
