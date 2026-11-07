/**
 * Tests for tools/theme-preview.mjs and the guard tools/check-theme-preview.mjs.
 *
 *   node tools/test-theme-preview.mjs
 *
 * The picker's miniature is drawn from a preview read out of the theme's file. Each way the preview could stop being the
 * theme is planted here and must fire: a token the theme does not set, a var() to nothing, a loop. The real house theme runs
 * last, so a guard gone quiet over nothing fails here.
 */
import fs from 'node:fs';
import { THEME_FILE } from './check-theme.mjs';
import { previewOf, previewFaults, previewModule, REQUIRED_TOKENS } from './theme-preview.mjs';

let pass = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('  PASS  ' + name); } else { failures.push(name); console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : '')); }
}

const THEME = 'instances/divided-world/ui/theme.css';
const house = fs.readFileSync(THEME, 'utf8');

/* a theme holding every required token once, in :root */
const full = (extra = '') => `:root { ${REQUIRED_TOKENS.map((t) => `${t}: #123456;`).join(' ')} ${extra} }`;

{
  const p = previewOf(house);
  check('the house theme is clean', p.faults.length === 0, p.faults.join('; '));
  check('the house light preview carries its --kb-head-bg', p.light?.['--kb-head-bg'] === 'linear-gradient(#6a6a6a, #474747 50%, #383838 51%, #2b2b2b)', JSON.stringify(p.light?.['--kb-head-bg']));
  check('the house dark preview differs from light (its dark blocks are laid over :root)', p.dark !== undefined && p.dark['--kb-bg'] === '#141414' && p.light?.['--kb-bg'] === '#d9d9d9');
  check('a dark token the dark blocks do not set is the :root one (as in the browser)', p.dark?.['--kb-link'] !== undefined);
  check('the module source is the preview as JSON', previewModule(THEME, house).startsWith('export default {"light":'));
}

/* ---- poisons ---- */
{
  const poisoned = house.replace(/^\s*--kb-head-bg:.*$/gm, '');
  const f = previewOf(poisoned).faults;
  check('a preview token missing from the file fires, in both modes', f.some((x) => /^light: the theme sets no --kb-head-bg/.test(x)) && f.some((x) => /^dark: .*--kb-head-bg/.test(x)), f.join('; '));
  let threw = false;
  try { previewModule(THEME, poisoned); } catch (e) { threw = /--kb-head-bg/.test(String(e)); }
  check('the build (the ?preview import) refuses the poisoned theme', threw);
  check('the guard over the tree names the file', previewFaults({ [THEME]: poisoned }).some((x) => x.file === THEME));
}
check('a theme with every required token is clean', previewOf(full()).faults.length === 0);
check('a var() to a token nobody sets fires', previewOf(full('--kb-fg: var(--kb-nowhere);')).faults.some((x) => /--kb-fg resolves to nothing/.test(x)));
check('a var() loop fires', previewOf(full('--kb-fg: var(--kb-link); --kb-link: var(--kb-fg);')).faults.some((x) => /resolves to nothing/.test(x)));
check('a var() fallback is used', previewOf(full('--kb-fg: var(--kb-nowhere, #fff);')).light?.['--kb-fg'] === '#fff');
check('a var() to a theme token is followed', previewOf(full('--kb-fg: var(--kb-bg);')).light?.['--kb-fg'] === '#123456');
check('an optional token falls to the engine default, resolved in the theme', previewOf(full()).light?.['--kb-button-bg'] === '#123456');
check('a light-only theme fills only light', (() => { const p = previewOf(full()); return p.light !== undefined && p.dark === undefined; })());
check('a dark-only theme that writes dark blocks fills dark', (() => { const p = previewOf(full() + ':root[data-kb-mode="dark"] { --kb-bg: #000; }'); return p.dark?.['--kb-bg'] === '#000'; })());
check('a dark-only theme (:root and both dark blocks alike) yields no light', (() => {
  const p = previewOf(full() + ':root[data-kb-mode="dark"] { ' + REQUIRED_TOKENS.map((t) => `${t}: #123456;`).join(' ') + ' }');
  return p.light === undefined && p.dark?.['--kb-bg'] === '#123456' && p.faults.length === 0;
})());
check('a $& in a value is kept literally', previewOf(full('--kb-fg: var(--kb-nowhere, a$&b);')).light?.['--kb-fg'] === 'a$&b');
check('a var() fallback that is itself a var() is followed', previewOf(full('--kb-fg: var(--kb-nowhere, var(--kb-bg));')).light?.['--kb-fg'] === '#123456');
check('a var() fallback var() that resolves to nothing fires', previewOf(full('--kb-fg: var(--kb-nowhere, var(--kb-also));')).faults.some((x) => /--kb-fg resolves to nothing/.test(x)));
check('previewFaults reads exactly the files check-theme.mjs calls themes (so a ui/themes/ file is checked once THEME_FILE names it)', (() => {
  const bad = house.replace(/^\s*--kb-head-bg:.*$/gm, '');
  return ['instances/a/ui/theme.css', 'instances/a/ui/themes/x.css', 'instances/a/ui/deep/x/y.css', 'engine/ui/base.css'].every((f) => (previewFaults({ [f]: bad }).length > 0) === THEME_FILE.test(f));
})());
check('a stylesheet that is not a theme file is not read', previewFaults({ 'engine/ui/base.css': 'x{}' }).length === 0);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error('FAILED: ' + failures.join('; ')); process.exit(1); }
