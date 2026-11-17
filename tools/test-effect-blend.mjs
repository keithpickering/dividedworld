/**
 * Tests for the guard in tools/check-effect-blend.mjs.
 *
 *   node tools/test-effect-blend.mjs
 *
 * The defect the guard exists to catch is an element that blends with what is behind it (issue #768): a planted stylesheet with `mix-blend-mode: multiply`,
 * and a planted component with `style={{ mixBlendMode: 'screen' }}`, must each fire, naming the file and the line. What only looks like a blend (`normal`, a
 * comment, `background-blend-mode`, a test or a story file, engine/mail/) must stay clean, and the last cases run over the real tree, so a guard gone quiet
 * fails here. Cases beyond the plan's: no space after the colon, `!important`, upper case, a `.ts` file, a story file, a value on a later line, a
 * declaration among others, a CSS string in a script, `style.mixBlendMode = ...`, a value that is not a literal, and a file outside engine/ui and instances.
 */
import os from 'node:os';
import { blendFaults, report, treeFiles } from './check-effect-blend.mjs';

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

const faults = (text, file = 'instances/x/ui/y/effect.css') => blendFaults({ [file]: text });

/* ---- the poison ---- */
{
  const r = faults('.a {\n  color: red;\n  mix-blend-mode: multiply;\n}');
  check('a stylesheet with mix-blend-mode: multiply fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and the value', r[0]?.file === 'instances/x/ui/y/effect.css' && r[0]?.line === 3 && /multiply/.test(r[0]?.what ?? ''), JSON.stringify(r));
}
{
  const r = faults("export const A = () => (\n  <div\n    style={{ mixBlendMode: 'screen' }}\n  />\n);", 'instances/x/ui/y/Effect.tsx');
  check("a .tsx with style={{ mixBlendMode: 'screen' }} fires, at its line", r.length === 1 && r[0]?.line === 3 && /screen/.test(r[0]?.what ?? ''), JSON.stringify(r));
}
check('mix-blend-mode:screen with no space fires', faults('.a{mix-blend-mode:screen}').length === 1);
check('!important does not hide a value', faults('.a { mix-blend-mode: multiply !important; }').length === 1);
check('upper case fires', faults('.a { MIX-BLEND-MODE: Multiply; }').length === 1);
check('a value on a later line of the declaration fires, at the property', (() => { const r = faults('.a {\n  mix-blend-mode:\n    multiply;\n}'); return r.length === 1 && r[0]?.line === 2; })());
check('a blend among other declarations on one line fires', faults('.a { color: red; mix-blend-mode: overlay; top: 0 }').length === 1);
check('a second blend in a file fires too', faults('.a { mix-blend-mode: multiply }\n.b { mix-blend-mode: screen }').length === 2);
check('a .ts file is read', faults("export const s = { mixBlendMode: 'multiply' };", 'engine/ui/x/x.ts').length === 1);
check('a quoted key fires', faults("export const s = { 'mixBlendMode': 'multiply' };", 'engine/ui/x/x.ts').length === 1);
check('el.style.mixBlendMode = ... fires', faults("el.style.mixBlendMode = 'multiply';", 'engine/ui/x/x.ts').length === 1);
check('a value that is not a literal fires (it cannot be shown to be normal)', faults('const s = { mixBlendMode: mode };', 'engine/ui/x/x.ts').length === 1);
check("setProperty('mix-blend-mode', 'multiply') fires", faults("el.style.setProperty('mix-blend-mode', 'multiply');", 'engine/ui/x/x.ts').length === 1);
check("a wrapped value ('screen' as const, in parentheses) fires", faults("const s = { mixBlendMode: ('screen' as const) };", 'engine/ui/x/x.ts').length === 1);
check("a computed literal key fires", faults("const s = { ['mixBlendMode']: 'screen' };", 'engine/ui/x/x.ts').length === 1);
check('a comment mark inside a CSS string does not hide a blend', faults('.a{content:"/*"; mix-blend-mode: multiply} .b{content:"*/"}').length === 1);
check('a single-quoted string with an escaped quote and a comment mark does not hide a blend', faults(".a{content:'\\'/*'; mix-blend-mode: multiply} .b{content:'*/'}").length === 1);
check('a CSS string in a script fires', faults('const css = `.a { mix-blend-mode: multiply; }`;', 'engine/ui/x/x.ts').length === 1);
check('each fires in engine/ui and in another instance too', ['engine/ui/x/x.css', 'instances/y/ui/z/z.css', 'instances/y/cards/z/z.css'].every((f) => faults('.a { mix-blend-mode: multiply }', f).length === 1));

/* ---- what only looks like one ---- */
check('mix-blend-mode: normal is clean', faults('.a { mix-blend-mode: normal; }').length === 0);
check("setProperty('mix-blend-mode', 'normal') is clean", faults("el.style.setProperty('mix-blend-mode', 'normal');", 'engine/ui/x/x.ts').length === 0);
check("'normal' as const is clean", faults("const s = { mixBlendMode: 'normal' as const };", 'engine/ui/x/x.ts').length === 0);
check("'normal' satisfies string is clean", faults("const s = { mixBlendMode: 'normal' satisfies string };", 'engine/ui/x/x.ts').length === 0);
check("a computed literal key with 'normal' is clean", faults("const s = { ['mixBlendMode']: 'normal' };", 'engine/ui/x/x.ts').length === 0);
check('a real comment holding a quote character still blanks, and a later blend keeps its line', (() => { const r = faults('/* don\'t "mix-blend-mode: multiply */\n.a { mix-blend-mode: screen }'); return r.length === 1 && r[0]?.line === 2; })());
check('NORMAL !important is clean', faults('.a { mix-blend-mode: NORMAL !important }').length === 0);
check("mixBlendMode: 'normal' is clean", faults("const s = { mixBlendMode: 'normal' };", 'engine/ui/x/x.ts').length === 0);
check('the words in a CSS comment are clean', faults('/* mix-blend-mode: multiply */\n.a { color: red; }').length === 0);
check('the words in a multi-line CSS comment are clean, and a later blend keeps its line', (() => { const r = faults('/*\n mix-blend-mode: multiply\n*/\n.a { mix-blend-mode: screen }'); return r.length === 1 && r[0]?.line === 4; })());
check('the words in a script comment are clean', faults("// mixBlendMode: 'multiply'\n/* mix-blend-mode: screen */\nconst a = 1;", 'engine/ui/x/x.ts').length === 0);
check('background-blend-mode is not a blend with the backdrop', faults('.a { background-blend-mode: multiply; }').length === 0);
check('backgroundBlendMode is not a blend with the backdrop', faults("const s = { backgroundBlendMode: 'multiply' };", 'engine/ui/x/x.ts').length === 0);
check('a test file is not read', faults("const s = { mixBlendMode: 'multiply' };", 'instances/x/ui/y/Effect.test.tsx').length === 0);
check('a story file is not read', faults("const s = { mixBlendMode: 'multiply' };", 'instances/x/ui/y/Effect.stories.tsx').length === 0);
check('a board story file is not read', faults("const s = { mixBlendMode: 'multiply' };", 'instances/x/ui/y/Effect.board.stories.tsx').length === 0);
check('engine/mail/ is not read', faults('.a { mix-blend-mode: multiply }', 'engine/mail/x.css').length === 0 && faults("const s = { mixBlendMode: 'multiply' };", 'engine/mail/render.ts').length === 0);
check('a file outside engine/ui and instances is not read', faults('.a { mix-blend-mode: multiply }', 'web/src/x.css').length === 0);

/* ---- the refusals ---- */
{
  let git = '';
  try { treeFiles(os.tmpdir()); } catch (e) { git = String(e.message); }
  check('a failing git ls-files throws one plain line', /git ls-files failed/.test(git) && !git.includes('\n'), git);
  const asked = report(() => { throw new Error('effect-blend: git ls-files failed: boom'); });
  check('the report of a failing read is one line on stderr and a non-zero code', asked.code === 1 && asked.err.length === 1 && /git ls-files failed/.test(asked.err[0]), JSON.stringify(asked));
  const none = report(() => ({}));
  check('a read of nothing is refused, not passed', none.code === 1 && /nothing/.test(none.err[0] ?? ''), JSON.stringify(none));
  const bad = report(() => ({ 'instances/x/ui/y/a.css': '.a { mix-blend-mode: multiply }' }));
  check('a fault gives a non-zero code naming file and line', bad.code === 1 && bad.err.some((l) => l.includes('instances/x/ui/y/a.css:1')), JSON.stringify(bad));
}

/* ---- the real tree ---- */
{
  const files = treeFiles();
  const names = Object.keys(files);
  check('the real tree is read', names.length > 100, String(names.length));
  check('stylesheets are among the files read', names.some((f) => f.endsWith('.css')));
  check('scripts are among the files read', names.some((f) => f.endsWith('.tsx')));
  check('engine/mail/ is not among the files read', !names.some((f) => f.startsWith('engine/mail/')));
  const r = blendFaults(files);
  check('the real tree has no element that blends with its backdrop', r.length === 0, JSON.stringify(r));
}

console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
