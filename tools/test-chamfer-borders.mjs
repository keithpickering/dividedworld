/**
 * Tests for the guard in tools/check-chamfer-borders.mjs.
 *
 *   node tools/test-chamfer-borders.mjs
 *
 * The guard refuses a rule that cuts its corners with a polygon clip-path and also has a border: the clip takes the border
 * off the diagonal, so the cut is drawn without an edge (the welcome letter, the Updates post, the guide article, Gabe's note).
 * So the poison is that rule itself, and it must fire; each thing that only looks like it (a polygon with no border, a
 * border under an inset() clip, a zero border, a border drawn on the cut and said so) must stay clean, and a comment that
 * opts out without saying how must not count. The last case runs the guard over the real tree, so a guard that has gone
 * quiet over nothing fails here.
 */
import { chamferFaults, readNothing, treeFiles } from './check-chamfer-borders.mjs';

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

const POLY = 'clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%);';
const run = (css, p = 'engine/ui/x/x.css') => chamferFaults({ [p]: css });

/* ---- the poison ---- */
{
  const r = run(`.kb-a {\n  border: 1px solid red;\n  ${POLY}\n}\n`);
  check('a polygon clip-path with a border fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the selector and the line', r[0]?.file === 'engine/ui/x/x.css' && r[0]?.selector === '.kb-a' && r[0]?.line === 3, JSON.stringify(r));
}

/* ---- the ways a border is set ---- */
check('a border-top width fires', run(`.kb-a { border-top: 2px solid red; ${POLY} }`).length === 1);
check('a border-width fires', run(`.kb-a { border-width: 0 0 1px; ${POLY} }`).length === 1);
check('a border-left-width fires', run(`.kb-a { border-left-width: 3px; ${POLY} }`).length === 1);
check('an outline under a polygon fires: it is the border the clip cuts', run(`.kb-a { outline: 1px solid red; outline-offset: -1px; ${POLY} }`).length === 1);
check('an outline-width fires', run(`.kb-a { outline-width: 2px; ${POLY} }`).length === 1);
check('outline: none is clean', run(`.kb-a { outline: none; ${POLY} }`).length === 0);
check('a lone outline-offset or outline-color is not a width', run(`.kb-a { outline-offset: -1px; outline-color: red; ${POLY} }`).length === 0);
check('a border whose width is a variable fires', run(`.kb-a { border: var(--w) solid red; ${POLY} }`).length === 1);
check('the border after the clip fires', run(`.kb-a { ${POLY} border: 1px solid red; }`).length === 1);
check('a rule inside a media query is read', run(`@media (min-width: 10px) {\n  .kb-a { border: 1px solid red; ${POLY} }\n}\n`).length === 1);

/* ---- what is clean ---- */
check('a polygon with no border is clean', run(`.kb-a { ${POLY} }`).length === 0);
check('a border under an inset() clip is clean', run(`.kb-a { border: 1px solid red; clip-path: inset(0 round 4px); }`).length === 0);
check('border: 0 is clean', run(`.kb-a { border: 0; ${POLY} }`).length === 0);
check('border: none is clean', run(`.kb-a { border: none; ${POLY} }`).length === 0);
check('border-width: 0 is clean', run(`.kb-a { border-width: 0; ${POLY} }`).length === 0);
check('a border-color or a border-radius is not a width', run(`.kb-a { border-color: red; border-radius: 4px; ${POLY} }`).length === 0);
check('a border in a rule with no clip-path is clean', run(`.kb-a { border: 1px solid red; }`).length === 0);
check('a clip-path in a comment is not read', run(`.kb-a { border: 1px solid red; /* ${POLY} */ }`).length === 0);
check('the glass base stylesheet is the cut and is not read', chamferFaults({ 'engine/ui/glass/base.css': `.kb-a { border: 1px solid red; ${POLY} }` }).length === 0);
check('a file outside engine/ and instances/ is not read', run(`.kb-a { border: 1px solid red; ${POLY} }`, 'web/a.css').length === 0);

/* ---- the prefixed clip, and a border with no line ---- */
check('a -webkit-clip-path polygon with a border fires', run(`.kb-a { border: 1px solid red; -webkit-clip-path: polygon(0 0, 100% 0, 100% 100%); }`).length === 1);
check('a border whose style is none is not a border', run(`.kb-a { border: 1px none red; ${POLY} }`).length === 0);
check('a border whose style is hidden is not a border', run(`.kb-a { border-top: 1px hidden; ${POLY} }`).length === 0);
check('border: none with a border-top width fires', run(`.kb-a { border: none; border-top: 1px solid red; ${POLY} }`).length === 1);
check('border: none with a border-top-width alone is still a width that fires', run(`.kb-a { border: none; border-top-width: 1px; ${POLY} }`).length === 1);
check('an outline whose style is none is not an outline', run(`.kb-a { outline: 2px none; ${POLY} }`).length === 0);

/* ---- a guard reading nothing ---- */
check('no stylesheet read is refused', readNothing({}) === true && readNothing({ 'engine/ui/a.tsx': 'x' }) === true);
check('a stylesheet read is not', readNothing({ 'engine/ui/a.css': '.a{}' }) === false);

/* ---- the opt-out ---- */
const OPT = '/* chamfer: border drawn on the cut by a ::after one border in */';
check('the opt-out above the selector, saying how, passes', run(`${OPT}\n.kb-a {\n  border: 1px solid red;\n  ${POLY}\n}\n`).length === 0);
check('the opt-out above the clip-path line, saying how, passes', run(`.kb-a {\n  border: 1px solid red;\n  ${OPT}\n  ${POLY}\n}\n`).length === 0);
{
  const r = run(`/* chamfer: */\n.kb-a { border: 1px solid red; ${POLY} }\n`);
  check('an opt-out with nothing after the colon is refused', r.length === 1 && /how/.test(r[0].why), JSON.stringify(r));
}
check('an opt-out that does not say how is refused', run(`/* chamfer: it is fine */\n.kb-a { border: 1px solid red; ${POLY} }\n`).length === 1);
check('an opt-out two lines up does not count', run(`${OPT}\n\n.kb-a { border: 1px solid red; ${POLY} }\n`).length === 1);
check('an opt-out on another rule does not count', run(`${OPT}\n.kb-b { color: red; }\n.kb-a { border: 1px solid red; ${POLY} }\n`).length === 1);

/* ---- the real tree ---- */
{
  const files = treeFiles();
  check('the real tree reads stylesheets', Object.keys(files).some((f) => f.endsWith('.css')));
  const r = chamferFaults(files);
  check('the real tree is clean', r.length === 0, JSON.stringify(r.map((f) => `${f.file}:${f.line} ${f.selector}`)));
}

console.log(`\n  chamfer-borders: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-chamfer-borders: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
