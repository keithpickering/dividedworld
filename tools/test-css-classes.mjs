/**
 * Tests for the guard in tools/check-css-classes.mjs.
 *
 *   node tools/test-css-classes.mjs
 *
 * The guard holds every `kb-*` class a component names to a rule: a class with no rule anywhere renders
 * as the browser's default (a bare button), which no test of behavior notices. So the poison is the
 * defect itself, a component using a class with no rule, and it must fire; each way of naming a class
 * (a plain string, a ternary, a template, a clsx-style call) is planted, and each thing that only looks like
 * one (a class defined in a stylesheet, a listed hook, a test file, a comment, a prefix that a template
 * completes) must stay clean. The last case runs the guard over the real tree, so a guard that has gone
 * quiet over nothing fails here.
 */
import { classFaults, ALLOWED_HOOKS, treeFiles } from './check-css-classes.mjs';

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

const css = { 'engine/ui/a.css': `.kb-has-rule { color: var(--kb-fg); }\n.kb-other:hover, .kb-two > .kb-three { margin: 0; }` };
const fires = (tsx, extra = {}) => classFaults({ ...css, 'engine/ui/x/X.tsx': tsx, ...extra });

/* ---- the poison ---- */
{
  const r = fires(`export const X = () => <button className="kb-has-no-rule">Save</button>;`);
  check('a component using a class with no rule fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and the class', r[0]?.file === 'engine/ui/x/X.tsx' && r[0]?.line === 1 && r[0]?.name === 'kb-has-no-rule', JSON.stringify(r));
}

/* ---- the ways a class is named ---- */
check('a class with a rule is clean', fires(`const X = () => <p className="kb-has-rule" />;`).length === 0);
check('the second of two classes is read', fires(`const X = () => <p className="kb-has-rule kb-missing" />;`).length === 1);
check('a class in a ternary branch is read', fires(`const X = (a) => <p className={a ? 'kb-has-rule' : 'kb-missing'} />;`).length === 1);
check('a class in a template literal is read', fires('const X = (a) => <p className={`kb-has-rule kb-missing ${a}`} />;').length === 1);
check('a class in a && is read', fires(`const X = (a) => <p className={a && 'kb-missing'} />;`).length === 1);
check('a class in an array join is read', fires(`const X = (a) => <p className={['kb-has-rule', a && 'kb-missing'].join(' ')} />;`).length === 1);
check('a class in a call is read', fires(`const X = () => <p className={cx('kb-has-rule', 'kb-missing')} />;`).length === 1);
check('a template prefix a variable completes is not a class', fires('const X = (a) => <p className={`kb-has-rule kb-thing-${a}`} />;').length === 0);
check('a class that is a selector in a compound or a pseudo rule is defined', fires(`const X = () => <p className="kb-other kb-two kb-three" />;`).length === 0);
check('a class not on a className is not read', fires(`const a = 'kb-missing'; const X = () => <p data-x="kb-missing" />;`).length === 0);
check('a class that is not kb- is not read', fires(`const X = () => <p className="plain other" />;`).length === 0);

/* ---- what is left out ---- */
check('a test file is not read', classFaults({ ...css, 'engine/ui/x/X.test.tsx': `const X = () => <p className="kb-missing" />;` }).length === 0);
check('a file outside engine/ and instances/ is not read', classFaults({ ...css, 'web/src/App.tsx': `const X = () => <p className="kb-missing" />;` }).length === 0);
check('a comment is not read', fires(`// className="kb-missing"\nconst X = () => <p className="kb-has-rule" />;`).length === 0);
check('a class named only in a CSS comment has no rule', fires(`const X = () => <p className="kb-ghost" />;`, { 'engine/ui/b.css': `/* .kb-ghost { color: red } */` }).length === 1);
check('a class defined in an instance stylesheet counts', fires(`const X = () => <p className="kb-from-instance" />;`, { 'instances/dw/ui/t.css': `.kb-from-instance { color: red; }` }).length === 0);
{
  const hook = [...ALLOWED_HOOKS][0];
  check('a listed hook with no rule is clean', hook !== undefined && fires(`const X = () => <p className="${hook}" />;`).length === 0, String(hook));
  check('every listed hook is still named by a component (a stale entry fails)', staleHooks().length === 0, JSON.stringify(staleHooks()));
}

function staleHooks() {
  const files = treeFiles();
  const used = new Set();
  for (const [p, t] of Object.entries(files)) if (p.endsWith('.tsx') && !/\.test\.tsx$/.test(p)) for (const h of ALLOWED_HOOKS) if (t.includes(h)) used.add(h);
  return [...ALLOWED_HOOKS].filter((h) => !used.has(h));
}

/* ---- the real tree ---- */
{
  const files = treeFiles();
  check('the real tree reads stylesheets and components', Object.keys(files).some((f) => f.endsWith('.css')) && Object.keys(files).some((f) => f.endsWith('.tsx')));
  const r = classFaults(files);
  check('the real tree is clean', r.length === 0, JSON.stringify(r.slice(0, 5)));
}

console.log(`\n  css-classes: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-css-classes: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
