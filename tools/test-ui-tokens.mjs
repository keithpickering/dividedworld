/**
 * Tests for the guard in tools/check-ui-tokens.mjs.
 *
 *   node tools/test-ui-tokens.mjs
 *
 * The guard holds the engine's screens to their tokens: a color, a font family or a border color
 * written as a literal anywhere in engine/ui/ but tokens.css is a piece of one instance's look
 * baked into the engine, and a theme (a CSS file of overrides) can no longer reach it. So each
 * place a literal can hide (a stylesheet's declaration, a shorthand, a style object, an SVG
 * attribute) is planted here and must fire, and each thing that only looks like one (a token, a
 * keyword, a comment, a class name) must stay clean. The last case runs the guard over the real
 * tree, so a guard that has gone quiet over nothing fails here.
 */
import { tokenFaults, treeFiles } from './check-ui-tokens.mjs';

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

const fires = (file, text) => tokenFaults({ [file]: text });

/* ---- the plan's poisons ---- */
{
  const r = fires('engine/ui/frame/Frame.tsx', `export const Frame = () => <div style={{ background: '#fff' }} />;`);
  check('a #fff in an engine/ui component\'s style fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and the literal', r[0]?.file === 'engine/ui/frame/Frame.tsx' && r[0]?.line === 1 && r[0]?.literal === '#fff', JSON.stringify(r));
}
{
  const r = fires('engine/ui/base.css', `.kb-frame {\n  font-family: Arial;\n}`);
  check('a font-family: Arial in base.css fires', r.length === 1 && r[0]?.line === 2, JSON.stringify(r));
}

/* ---- colors in stylesheets ---- */
check('a hex color in a declaration fires', fires('engine/ui/base.css', `.a { color: #000000; }`).length === 1);
check('an rgb() color fires', fires('engine/ui/base.css', `.a { background: rgb(0 0 0 / 50%); }`).length === 1);
check('an hsl() color fires', fires('engine/ui/base.css', `.a { color: hsla(0, 0%, 0%, 1); }`).length === 1);
check('an oklch() color fires', fires('engine/ui/base.css', `.a { color: oklch(70% 0.1 200); }`).length === 1);
check('a named color fires', fires('engine/ui/base.css', `.a { color: white; }`).length === 1);
check('a border color literal in a shorthand fires', fires('engine/ui/base.css', `.a { border: 1px solid black; }`).length === 1);
check('a border-top-color literal fires', fires('engine/ui/base.css', `.a { border-top-color: GRAY; }`).length === 1);
check('a shadow color literal fires', fires('engine/ui/base.css', `.a { box-shadow: 0 1px 2px #0004; }`).length === 1);
check('a color inside a gradient fires', fires('engine/ui/base.css', `.a { background: linear-gradient(red, var(--kb-bg)); }`).length === 1);
check('a fallback inside var() still fires: it is a literal a theme cannot reach', fires('engine/ui/base.css', `.a { color: var(--kb-fg, #000); }`).length === 1);

/* ---- fonts in stylesheets ---- */
check('a quoted family fires', fires('engine/ui/base.css', `.a { font-family: "Courier New", monospace; }`).length === 1);
check('a generic family alone fires: it is still a family', fires('engine/ui/base.css', `.a { font-family: monospace; }`).length === 1);
check('a family in the font shorthand fires', fires('engine/ui/base.css', `.a { font: bold 12px Verdana, sans-serif; }`).length === 1);

/* ---- colors and fonts in components ---- */
check('a hex in a style object fires', fires('engine/ui/x.tsx', `const s = { borderColor: '#123456' };`).length === 1);
check('a named color in a style object fires', fires('engine/ui/x.tsx', `const s = { color: 'white' };`).length === 1);
check('a fontFamily literal fires', fires('engine/ui/x.tsx', `const s = { fontFamily: 'Verdana' };`).length === 1);
check('an SVG fill attribute literal fires', fires('engine/ui/orbs/Orb.tsx', `export const O = () => <circle fill="#e74c3c" r={4} />;`).length === 1);
check('an SVG stroke named color fires', fires('engine/ui/orbs/Orb.tsx', `export const O = () => <circle stroke="black" r={4} />;`).length === 1);
check('a color in a template literal fires', fires('engine/ui/x.ts', 'const css = `color: rgb(1, 2, 3)`;').length === 1);
check('a .ts file is read too', fires('engine/ui/x.ts', `export const c = '#abc';`).length === 1);

/* ---- from the Task 1 quality review: where a literal hid ---- */
check('a custom property set to a literal outside tokens.css fires', fires('engine/ui/base.css', `:root { --kb-local: #fff; }\n.a { color: var(--kb-local); }`).length === 1);
check('a hex in a property the color list does not name fires', fires('engine/ui/base.css', `.a { -webkit-text-fill-color: #fff; }`).length === 1);
check('a gradient in a mask or border-image fires', fires('engine/ui/base.css', `.a { mask-image: linear-gradient(#000, transparent); border-image: linear-gradient(red, blue) 1; }`).length === 2);
check('a hex inside a longer style value in a script fires', fires('engine/ui/x.tsx', `const s = { textDecoration: 'underline #000', filter: 'drop-shadow(0 0 2px #000)' };`).length === 2);
check('a named color in a ternary under a color key fires', fires('engine/ui/x.tsx', `const s = { color: on ? 'red' : 'var(--kb-fg)' };`).length === 1);
check('a named color in a JSX expression attribute fires', fires('engine/ui/x.tsx', `export const O = () => <circle fill={'black'} />;`).length === 1);
check('a named color in a JSX ternary attribute fires', fires('engine/ui/x.tsx', `export const O = () => <circle fill={on ? 'black' : 'none'} />;`).length === 1);
check('a computed color key fires', fires('engine/ui/x.tsx', `const s = { ['color']: 'white' };`).length === 1);
check('a declaration string inside a script fires', fires('engine/ui/x.ts', `const css = 'border: 1px solid black;';`).length === 1);
check('a template with substitutions fires', fires('engine/ui/x.ts', 'const css = `color: ${x}; border-color: #000`;').length === 1);
check('a family in a script\'s font shorthand fires', fires('engine/ui/x.tsx', `const s = { font: 'bold 12px Verdana' };`).length === 1);
check('a token in a script\'s font shorthand is clean', fires('engine/ui/x.tsx', `const s = { font: 'bold 12px var(--kb-font-mono)' };`).length === 0);
check('a custom property set to a token or a length outside tokens.css is clean', fires('engine/ui/base.css', `.a { --kb-hud-height: 3.2em; --kb-local: var(--kb-fg); }`).length === 0);

/* ---- what only looks like a literal ---- */
check('a token is clean', fires('engine/ui/base.css', `.a { color: var(--kb-fg); border: 1px solid var(--kb-rule); font: bold 12px/1.4 var(--kb-font-mono); }`).length === 0);
check('the keywords are clean', fires('engine/ui/base.css', `.a { color: inherit; background: transparent; border-color: currentColor; outline: none; fill: currentcolor; }`).length === 0);
check('color-mix of tokens is clean', fires('engine/ui/base.css', `.a { background: color-mix(in srgb, var(--kb-fg) 20%, transparent); }`).length === 0);
check('a comment is not a literal', fires('engine/ui/base.css', `/* color: #fff; font-family: Arial */\n.a { color: var(--kb-fg); }`).length === 0);
check('a selector or class name that is a color word is clean', fires('engine/ui/base.css', `.kb-red .white > a:hover { color: var(--kb-fg); }`).length === 0);
check('an id selector that looks like hex is clean', fires('engine/ui/base.css', `#fade { color: var(--kb-fg); }`).length === 0);
check('a url() is not read for colors', fires('engine/ui/base.css', `.a { background: url(./black.svg) no-repeat; }`).length === 0);
check('a JS comment is not a literal', fires('engine/ui/x.tsx', `// color: '#fff'\nexport const a = 1;`).length === 0);
check('a permalink fragment is not a color', fires('engine/ui/x.tsx', `const href = '#post-142'; const id = '#abc-def';`).length === 0);
check('a class name string is clean', fires('engine/ui/x.tsx', `const c = 'kb-orb kb-orb--red white';`).length === 0);
check('a font weight and size in the shorthand are clean', fires('engine/ui/base.css', `.a { font: italic bold 11px/1.2 var(--kb-font-body); }`).length === 0);
check('tokens.css may hold the values', fires('engine/ui/tokens.css', `:root { --kb-fg: #000; --kb-font-body: Verdana, sans-serif; }`).length === 0);
check('the glass tokens.css may hold the values', fires('engine/ui/glass/tokens.css', `:root { --kb-glass-neon: #9ef4ff; --kb-glass-font-display: Anton, sans-serif; }`).length === 0);
check('a glass component holding #ff2bd6 fires', fires('engine/ui/glass/Smoke.tsx', `export const S = () => <rect fill="#ff2bd6" />;`).length === 1);
check('the glass base.css holding #ff2bd6 fires', fires('engine/ui/glass/base.css', `.a { color: #ff2bd6; }`).length === 1);
check('the glass calm.css reading a token is clean', fires('engine/ui/glass/calm.css', `.a::before { background: var(--kb-glass-ground); }`).length === 0);
check('a tokens.css anywhere else under engine/ui/ is held to it', fires('engine/ui/glass/sub/tokens.css', `:root { --kb-x: #fff; }`).length === 1);
check('a file outside engine/ui is not held to it (an instance holds the values)', fires('instances/divided-world/ui/theme.css', `:root { --kb-fg: #000; }`).length === 0);
check('a test file is not held to it (it may assert a computed color)', fires('engine/ui/x.test.tsx', `expect(c).toBe('#000');`).length === 0);

/* ---- the real tree ---- */
{
  const files = treeFiles();
  const r = tokenFaults(files);
  check('the real tree is clean', r.length === 0, JSON.stringify(r));
}

console.log(`\n  ui-tokens: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-ui-tokens: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
