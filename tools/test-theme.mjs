/**
 * Tests for the guard in tools/check-theme.mjs.
 *
 *   node tools/test-theme.mjs
 *
 * The guard holds every instance's theme to the theme contract: a stylesheet of `--kb-*` custom
 * properties under the three selectors the engine's tokens use, and nothing else. A theme that
 * also writes `.kb-hud { display: none }` hides the HUD or a game effect from every player; one
 * that zeroes a size token makes the text vanish. Both look right in review of the colors and
 * change no test, so each is planted here and must fire, and the real tree runs last so a guard
 * gone quiet over nothing fails here.
 */
import { themeFaults, themeHrefFaults, treeFiles } from './check-theme.mjs';

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

const THEME = 'instances/divided-world/ui/theme.css';
const fires = (text, file = THEME) => themeFaults({ [file]: text });
const GOOD = `/* a theme */
:root { --kb-fg: #000; --kb-size-body: 0.8125rem; --kb-line: 1.45; }
@media (prefers-color-scheme: dark) {
  :root:not([data-kb-mode="light"]) { --kb-fg: #fff; }
}
:root[data-kb-mode="dark"] { --kb-fg: #fff; }
:root[data-kb-mode="light"] { --kb-fg: #000; }
`;

/* ---- the plan's poisons ---- */
{
  const house = treeFiles()[THEME] ?? '';
  const r = fires(`${house}\n.kb-hud { display: none }\n`);
  check('.kb-hud { display: none } appended to the house theme fires', r.length >= 1 && /\.kb-hud/.test(r[0]?.why ?? ''), JSON.stringify(r));
  check('the house theme itself is read (the poison above is appended to real text)', house.includes(':root'));
}
{
  const r = fires(GOOD.replace('--kb-size-body: 0.8125rem', '--kb-size-body: 0'));
  check('--kb-size-body: 0 fires', r.length === 1 && /size-body/.test(r[0]?.why ?? ''), JSON.stringify(r));
}

{
  /* A later block over the real ones: the browser applies it, so the file no longer says what the page shows. */
  const house = treeFiles()[THEME] ?? '';
  const r = fires(`${house}
:root { --kb-fg: #fefefe; }
@media (prefers-color-scheme: dark) {
  :root:not([data-kb-mode="light"]) { --kb-fg: #000001; }
}
:root[data-kb-mode="dark"] { --kb-fg: #000001; }
`);
  check('a second :root, device-dark and chosen-dark block appended to the house theme each fire',
    r.length === 3 && r.every((f) => /a second block/.test(f.why)), JSON.stringify(r));
}

{
  /* The board's column width is a size too (the owner's 960px word): at 0 every board page is an empty column. */
  const r = fires(GOOD.replace('--kb-line: 1.45;', '--kb-line: 1.45; --kb-board-max: 0;'));
  check('--kb-board-max: 0 fires', r.length === 1 && /board-max/.test(r[0]?.why ?? ''), JSON.stringify(r));
  const calc = fires(GOOD.replace('--kb-line: 1.45;', '--kb-line: 1.45; --kb-board-max: calc(100% - 1px);'));
  check('--kb-board-max as a calc() fires', calc.length === 1 && /board-max/.test(calc[0]?.why ?? ''), JSON.stringify(calc));
  check('--kb-board-max: 960px is clean', fires(GOOD.replace('--kb-line: 1.45;', '--kb-line: 1.45; --kb-board-max: 960px;')).length === 0);
}

/* ---- clean ---- */
check('a theme in the contract\'s shape is clean', fires(GOOD).length === 0, JSON.stringify(fires(GOOD)));
check('an empty theme is clean', fires('/* nothing yet */').length === 0);
check('a comment holding a rule is not a rule', fires(`/* .kb-hud { display: none } */\n${GOOD}`).length === 0);
check('a selector list formatted over lines, with extra spaces, is the same selector', fires(`:root   {\n --kb-fg: #000;\n}`).length === 0);
check('a value holding a semicolon in a string or url() is one declaration', fires(`:root { --kb-x: url("data:image/svg+xml;utf8,<svg/>"); --kb-fg: #000; }`).length === 0);

/* ---- selectors ---- */
check('a class rule fires', fires(`${GOOD}\n.kb-box { border: 0; }`).length === 1);
check('an element rule fires', fires(`${GOOD}\nbody { display: none; }`).length === 1);
check('a selector list that adds one fires', fires(`:root, .kb-hud { --kb-fg: #000; }`).length === 1);
check('a differently-attributed :root fires', fires(`:root[data-kb-mode="sepia"] { --kb-fg: #000; }`).length === 1);
check('html as a selector fires', fires(`html { --kb-fg: #000; }`).length === 1);
check('a :root with a descendant fires', fires(`:root .kb-hud { --kb-fg: #000; }`).length === 1);

/* ---- at-rules ---- */
check('@import fires', fires(`@import "../../../engine/ui/x.css";\n${GOOD}`).length === 1);
check('@font-face fires', fires(`@font-face { font-family: X; src: url(x.woff2); }\n${GOOD}`).length === 1);
check('@layer and @keyframes fire', fires(`@layer x { :root { --kb-fg: #000; } }\n@keyframes k { from { --kb-fg: #000; } }`).length === 2);
check('a media query other than the dark scheme fires', fires(`@media (max-width: 40em) { :root { --kb-fg: #000; } }`).length === 1);
check('a selector other than the not-light root inside the dark query fires', fires(`@media (prefers-color-scheme: dark) { .kb-hud { --kb-fg: #fff; } }`).length === 1);
check('the dark query holding a property that is not a --kb- one fires', fires(`@media (prefers-color-scheme: dark) { :root:not([data-kb-mode="light"]) { display: none; } }`).length === 1);
check('a repeated selector written with other spacing or quotes is still a repeat', fires(`${GOOD}\n:root[ data-kb-mode = 'dark' ]{--kb-fg:#fff}`).length === 1);
check('a second dark query holding the device-dark selector again fires', fires(`${GOOD}\n@media (prefers-color-scheme: dark) { :root:not([data-kb-mode="light"]) { --kb-fg: #fff; } }`).length === 1);
check('a repeat names the line of the first block', /line 2/.test(fires(`${GOOD}\n:root { --kb-fg: #111; }`)[0]?.why ?? ''), JSON.stringify(fires(`${GOOD}\n:root { --kb-fg: #111; }`)));
check('the dark query written with different spacing is the same query', fires(`@media (prefers-color-scheme:dark){:root:not([data-kb-mode="light"]){--kb-fg:#fff}}`).length === 0);

/* ---- declarations ---- */
check('a property that is not --kb-* fires', fires(`:root { display: none; }`).length === 1);
check('a custom property outside the --kb- family fires', fires(`:root { --other: 1; }`).length === 1);
check('a !important --kb- value is still a --kb- value', fires(`:root { --kb-fg: #000 !important; }`).length === 0);

/* ---- size tokens ---- */
check('--kb-line: 0 fires', fires(`:root { --kb-line: 0; }`).length === 1);
check('--kb-size-small: 0px fires', fires(`:root { --kb-size-small: 0px; }`).length === 1);
check('a negative size fires', fires(`:root { --kb-size-heading: -1rem; }`).length === 1);
check('a size of 0.0em fires', fires(`:root { --kb-size-logo: 0.0em; }`).length === 1);
check('a size written as calc() or var() fires, since it cannot be shown positive', fires(`:root { --kb-size-body: calc(1rem - 1rem); }`).length === 1);
check('a zero size in the dark block fires too', fires(`:root[data-kb-mode="dark"] { --kb-size-body: 0; }`).length === 1);
check('a zero in a token that is not a size (a border width, a shadow offset) is clean', fires(`:root { --kb-rule-width: 0; }`).length === 0);
check('a positive size with a unit, or a bare number, is clean', fires(`:root { --kb-size-body: 14px; --kb-size-small: .75em; --kb-line: 1.5; }`).length === 0);

/* ---- the whole file ---- */
check('an unclosed block fires', fires(`:root { --kb-fg: #000;`).length === 1);
check('a stray closing brace fires', fires(`:root { --kb-fg: #000; } }`).length === 1);
{
  const r = fires(`:root { --kb-fg: #000; }\n\n.kb-hud { display: none }\n`);
  check('a fault names the file and the line', r[0]?.file === THEME && r[0]?.line === 3, JSON.stringify(r));
}

/* ---- the instance's themes list names such a file ---- */
const INDEX = 'instances/divided-world/ui/index.ts';
const TREE = { [THEME]: GOOD, 'instances/divided-world/ui/other.css': GOOD, 'instances/divided-world/ui/x.css': '.a{}' };
const hrefs = (text, extra = {}) => themeHrefFaults({ [INDEX]: text, ...TREE, ...extra });
const IDX = (head, entry) => `${head}\nexport const instanceUi = { themes: [${entry}] };`;
check('a themes list whose href is an imported theme file is clean',
  hrefs(IDX(`import theme from './theme.css?url';`, `{ key: 'house', name: 'House', href: theme, modes: 'both' }`)).length === 0);
check('the shorthand { href } and a second theme file are clean',
  hrefs(IDX(`import href from './other.css?url';`, `{ key: 'o', name: 'O', href }`)).length === 0);
check('an href that is a string literal fires', hrefs(IDX('', `{ key: 'x', name: 'X', href: '/themes/x.css' }`)).length === 1);
check('an href imported from outside the instance\'s ui folder fires',
  hrefs(IDX(`import t from '../../../engine/ui/base.css?url';`, `{ key: 'x', name: 'X', href: t }`)).length === 1);
check('an href imported from a stylesheet that is not in the tree fires',
  hrefs(IDX(`import t from './gone.css?url';`, `{ key: 'x', name: 'X', href: t }`)).length === 1);
check('an href that is not an import (a call, a member) fires', hrefs(IDX(`import t from './theme.css?url';`, `{ key: 'x', name: 'X', href: pick(t) }`)).length === 1);
check('an href to a stylesheet that breaks the contract fires, through the same rules',
  themeFaults({ 'instances/divided-world/ui/x.css': `.kb-hud { display: none }` }).length === 1);
check('an instance with no themes list is clean (the engine has its own house theme)', hrefs(`export const instanceUi = {};`).length === 0);

/* ---- the real tree ---- */
{
  const files = treeFiles();
  check('the real tree holds at least one theme and one ui index', Object.keys(files).some((f) => f.endsWith('.css')) && Object.keys(files).some((f) => f.endsWith('/ui/index.ts')));
  const r = [...themeFaults(files), ...themeHrefFaults(files)];
  check('the real tree is clean', r.length === 0, JSON.stringify(r));
}

console.log(`\n  theme: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-theme: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
