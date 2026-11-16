/**
 * Tests for the guard in tools/check-effect-canvas.mjs.
 *
 *   node tools/test-effect-canvas.mjs
 *
 * The defect the guard exists to catch is a canvas made outside the tile layer (engine/ui/cards/tiles.ts), which is how an effect came to size a canvas to
 * a post and hold its whole area in memory. So the poison is exactly that: an effect file making a canvas, by each of the four ways it can be made. It must
 * fire, naming the file, the line and what was found, and what only looks like one (a test, a story, a comment, a string, a div, the layer itself, a listed
 * file within its count) must stay clean. The list must be exact, an instance file on the layer must have a budget story, and the last cases run over the
 * real tree, so a guard gone quiet fails here.
 */
import os from 'node:os';
import { budgetKeys, canvasFaults, canvasUses, CANVASES, LAYER, layerImports, report, treeFiles } from './check-effect-canvas.mjs';

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

/** @type {Record<string, { count: number; why: string; until?: string }>} */
const none = {};
const faults = (text, file = 'instances/x/ui/y/Effect.tsx', allowed = none) => canvasFaults({ [file]: text }, allowed);
const STORY = 'instances/x/ui/EffectBudget.board.stories.tsx';
const TILES = "import { makeTileLayer } from '../../../../engine/ui/cards/tiles.ts';\nexport const layer = makeTileLayer;";
const SHALLOW = TILES.replace('../../../../', '../../../');

/* ---- the poison ---- */
{
  const r = faults('export const Smoke = () => {\n  return <canvas ref={r} />;\n};');
  check('an effect file holding <canvas ref={r} /> fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and what was found', r[0]?.file === 'instances/x/ui/y/Effect.tsx' && r[0]?.line === 2 && r[0]?.what === '<canvas>' && r[0]?.kind === 'canvas', JSON.stringify(r));
}
check('<canvas> with children and a closing tag fires', faults('const a = <canvas width={1}></canvas>;').length === 1);
check("document.createElement('canvas') fires, and names it", faults("const c = document.createElement('canvas');")[0]?.what === "createElement('canvas')");
check('createElement("canvas") through another document fires', faults('const c = host.ownerDocument.createElement("canvas");').length === 1);
check('createElement with a template string fires', faults('const c = document.createElement(`canvas`);').length === 1);
check('new OffscreenCanvas(1, 1) fires, and names it', faults('const c = new OffscreenCanvas(1, 1);')[0]?.what === 'new OffscreenCanvas');
check('el.transferControlToOffscreen() fires, and names it', faults('const o = el.transferControlToOffscreen();')[0]?.what === 'transferControlToOffscreen()');
check("a bare createElement('canvas') (React's, imported by name) fires, and names it", faults("const c = createElement('canvas', { ref });")[0]?.what === "createElement('canvas')");
check("React.createElement('canvas') fires", faults("const c = React.createElement('canvas', null);").length === 1);
check("a bare createElement('div') is not a canvas", faults("const c = createElement('div', null);").length === 0);
check('a bare createElement of a variable is not read (the header says so)', faults('const c = createElement(tag, null);').length === 0);
for (const ns of ['globalThis', 'self', 'window']) check(`new ${ns}.OffscreenCanvas(1, 1) fires, and names it`, faults(`const c = new ${ns}.OffscreenCanvas(1, 1);`)[0]?.what === 'new OffscreenCanvas');
check("document.createElementNS(ns, 'canvas') fires, and names it", faults("const c = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');")[0]?.what === "createElementNS('canvas')");
check("createElementNS(ns, 'svg') is not a canvas", faults("const c = document.createElementNS('http://www.w3.org/2000/svg', 'svg');").length === 0);
check('new Foo.Canvas is not an OffscreenCanvas', faults('const c = new Foo.Canvas(1, 1);').length === 0);
check('each of them fires in engine/ui too', ['<canvas />', "document.createElement('canvas')", 'new OffscreenCanvas(1, 1)', 'el.transferControlToOffscreen()']
  .every((s) => faults(`export const a = ${s};`, 'engine/ui/x/X.tsx').length === 1));
check('a plain .ts file is read', faults("export const c = () => document.createElement('canvas');", 'engine/ui/x/x.ts').length === 1);
check('a canvas in a second effect folder of an instance fires', faults('const c = new OffscreenCanvas(1, 1);', 'instances/y/ui/z/Effect.tsx').length === 1);

/* ---- what only looks like one ---- */
check('a test file is not read', faults("const c = document.createElement('canvas');", 'instances/x/ui/y/Effect.test.tsx').length === 0);
check('a story file is not read', faults('const c = <canvas />;', 'instances/x/ui/y/Effect.stories.tsx').length === 0);
check('a board story file is not read', faults('const c = <canvas />;', 'instances/x/ui/y/Effect.board.stories.tsx').length === 0);
check('a comment is not read', faults("// <canvas>\n/* createElement('canvas') */\nconst a = 1;").length === 0);
check('a string is not read', faults('const a = "<canvas>"; const b = \'new OffscreenCanvas(1, 1)\'; const c = `transferControlToOffscreen()`;').length === 0);
check("createElement('div') is not a canvas", faults("const d = document.createElement('div');").length === 0);
check('a createElement of a variable is not read (the header says so)', faults('const d = document.createElement(tag);').length === 0);
check('a getContext on a canvas that was handed in is not a new one', faults("const ctx = canvas.getContext('2d');").length === 0);
check('an element named Canvas is not the tag', faults('const a = <Canvas />; const b = <div className="canvas" />;').length === 0);
check('a file outside engine/ui and instances is not read', faults('const c = <canvas />;', 'web/src/App.tsx').length === 0);
check('engine/ui/cards/tiles.ts itself is clean', faults("const c = document.createElement('canvas');", 'engine/ui/cards/tiles.ts').length === 0);
check('the layer is clean only as that one file', faults("const c = document.createElement('canvas');", 'engine/ui/cards/tileLoop.ts').length === 1);

/* ---- the list is exact ---- */
const listed = { 'instances/x/ui/y/Effect.tsx': { count: 1, why: 'a sprite' } };
check('a listed file within its count is clean', faults('const c = new OffscreenCanvas(1, 1);', 'instances/x/ui/y/Effect.tsx', listed).length === 0);
{
  const r = faults('const a = new OffscreenCanvas(1, 1);\nconst b = new OffscreenCanvas(2, 2);', 'instances/x/ui/y/Effect.tsx', listed);
  check('a second canvas in a listed file fires, at the second', r.length === 1 && r[0]?.line === 2 && r[0]?.kind === 'canvas', JSON.stringify(r));
}
{
  const r = canvasFaults({ 'instances/x/ui/y/Effect.tsx': 'const a = 1;' }, listed);
  check('a listed file with fewer than its count is a stale entry', r.length === 1 && r[0]?.kind === 'stale' && r[0]?.file === 'instances/x/ui/y/Effect.tsx', JSON.stringify(r));
}
{
  const r = canvasFaults({}, listed);
  check('a listed file that is gone fires', r.length === 1 && r[0]?.kind === 'gone' && r[0]?.file === 'instances/x/ui/y/Effect.tsx', JSON.stringify(r));
}
{
  const r = canvasFaults({ 'instances/x/ui/y/Effect.tsx': 'const a = <canvas />; const b = <canvas />;' }, { 'instances/x/ui/y/Effect.tsx': { count: 2, why: 'two', until: 'step 4' } });
  check('an entry with an until is held to its count like any other', r.length === 0, JSON.stringify(r));
}
check('canvasUses counts each use with its line', JSON.stringify(canvasUses('a();\n<canvas />;\nnew OffscreenCanvas(1, 1);', 'x.tsx').map((r) => r.line)) === '[2,3]');

/* ---- the budget stories ---- */
{
  const on = (stories) => canvasFaults({ 'instances/x/ui/y/Effect.tsx': TILES, ...(stories === null ? {} : { [STORY]: stories }) }, none);
  const r = on("export const BUDGET = { 'z': () => 1 };");
  check('an instance file on the layer, with no key for its folder, fires', r.length === 1 && r[0]?.kind === 'budget' && r[0]?.file === 'instances/x/ui/y/Effect.tsx' && r[0]?.line === 1, JSON.stringify(r));
  check('with the key present it is clean', on("export const BUDGET = { 'z': () => 1, 'y': () => 2 };").length === 0);
  check('an unquoted key counts', on('export const BUDGET = { y: () => 2 };').length === 0);
  check('a key written in a comment or a string does not count', on("/* 'y' */ export const BUDGET = { 'z': () => 'y' };").length === 1);
  check('a key of another object in the file does not count', on('const OTHER = { y: 1 };\nexport const BUDGET = { z: 1 };').length === 1);
  check('a BUDGET that is not exported does not count', on('const BUDGET = { y: 1 };').length === 1);
  check('with no budget stories file at all it fires', on(null).length === 1);
  check('a story file of another instance does not count', canvasFaults({ 'instances/x/ui/y/Effect.tsx': TILES, 'instances/w/ui/EffectBudget.board.stories.tsx': 'export const BUDGET = { y: 1 };' }, none).length === 1);
  check('a file directly in ui/ has no folder, so it fires', canvasFaults({ 'instances/x/ui/Effect.tsx': TILES.replace('../../../../', '../../../'), [STORY]: 'export const BUDGET = { y: 1, ui: 1 };' }, none).length === 1);
  {
    const CARD = 'instances/x/cards/y/Effect.tsx';
    const withKey = { [STORY]: "export const BUDGET = { y: 1 };" };
    const r = canvasFaults({ [CARD]: TILES }, none);
    check('an instance effect under cards/<folder>/ on the layer, with no key, fires', r.length === 1 && r[0]?.kind === 'budget' && r[0]?.file === CARD, JSON.stringify(r));
    check('and with its key it is clean', canvasFaults({ [CARD]: TILES, ...withKey }, none).length === 0);
    const r2 = canvasFaults({ 'instances/x/cards/y.ts': SHALLOW, ...withKey }, none);
    check('an instance file in neither shape that imports the layer fires, saying it cannot name its effect', r2.length === 1 && r2[0]?.kind === 'budget' && /cannot name its effect/.test(r2[0]?.what), JSON.stringify(r2));
    check('a file directly under instances/x/ui/ importing the layer fires', canvasFaults({ 'instances/x/ui/Effect.tsx': SHALLOW, ...withKey }, none).length === 1);
    check('the budget story file itself is not held to the rule', canvasFaults({ [STORY]: TILES + '\nexport const BUDGET = { y: 1 };' }, none).length === 0);
  }
  check('an import of another engine file is not the layer', canvasFaults({ 'instances/x/ui/y/Effect.tsx': "import { bodyOf } from '../../../../engine/ui/cards/body.ts';" }, none).length === 0);
  check('an import of a file named tiles.ts that is not the layer is not the layer', canvasFaults({ 'instances/x/ui/y/Effect.tsx': "import { a } from './tiles.ts';" }, none).length === 0);
  check('an import without the extension is still the layer', canvasFaults({ 'instances/x/ui/y/Effect.tsx': "import { a } from '../../../../engine/ui/cards/tiles';" }, none).length === 1);
  check('a test importing the layer is not read', canvasFaults({ 'instances/x/ui/y/Effect.test.tsx': TILES }, none).length === 0);
  check('an engine file importing the layer needs no budget', canvasFaults({ 'engine/ui/cards/x.ts': "import { a } from './tiles.ts';" }, none).length === 0);
}

/* ---- the ways a file can name the layer ---- */
{
  const F = 'instances/x/ui/y/Effect.tsx';
  const LAYER_SPEC = "'../../../../engine/ui/cards/tiles.ts'";
  const lay = (t) => JSON.stringify(layerImports(t, F));
  const budgetFault = (t) => canvasFaults({ [F]: t, [STORY]: 'export const BUDGET = { z: 1 };' }, none);
  check('an import of the layer is found at its line', lay(`const a = 1;\nimport { makeTileLayer } from ${LAYER_SPEC};`) === '[2]');
  check('an export-from of the layer is found at its line', lay(`const a = 1;\nexport { makeTileLayer } from ${LAYER_SPEC};`) === '[2]');
  check('an export-star of the layer is found at its line', lay(`const a = 1;\nexport * from ${LAYER_SPEC};`) === '[2]');
  check('a dynamic import of the layer is found at its line', lay(`const a = 1;\nconst m = () => import(${LAYER_SPEC});`) === '[2]');
  check('an import type of the layer makes no layer', lay(`import type { TileLayer } from ${LAYER_SPEC};`) === '[]');
  check('an export type from the layer makes no layer', lay(`export type { TileLayer } from ${LAYER_SPEC};`) === '[]');
  check('an import that names a value besides a type is still the layer', lay(`import { type TileLayer, makeTileLayer } from ${LAYER_SPEC};`) === '[1]');
  for (const [name, text] of [['an export-from', `const a = 1;\nexport { makeTileLayer } from ${LAYER_SPEC};`], ['a dynamic import', `const a = 1;\nconst m = () => import(${LAYER_SPEC});`]]) {
    const r = budgetFault(text);
    check(`${name} of the layer with no key for its folder fires the budget fault, at its line`, r.length === 1 && r[0]?.kind === 'budget' && r[0]?.line === 2, JSON.stringify(r));
  }
  check('an import type of the layer asks for no budget', budgetFault(`import type { TileLayer } from ${LAYER_SPEC};`).length === 0);
}

/* ---- what the check cannot read, it refuses ---- */
{
  const refuses = (text) => { try { budgetKeys(text); return null; } catch (e) { return /cannot read BUDGET's keys: /.test(String(e.message)) ? e.message : `wrong error: ${e.message}`; } };
  check('a BUDGET built by a call is refused, saying so', /call/.test(refuses('export const BUDGET = makeBudget();') ?? ''), String(refuses('export const BUDGET = makeBudget();')));
  check('a BUDGET with a spread is refused, saying so', /spread/.test(refuses('export const BUDGET = { ...OTHER, y: 1 };') ?? ''), String(refuses('export const BUDGET = { ...OTHER, y: 1 };')));
  check('a BUDGET with a computed key is refused, saying so', /computed/.test(refuses("export const BUDGET = { [KEY]: 1, y: 1 };") ?? ''), String(refuses('export const BUDGET = { [KEY]: 1, y: 1 };')));
  check('a plain BUDGET (a shorthand, a method, a quoted key, a cast) is read', JSON.stringify([...budgetKeys("const a = 1; export const BUDGET = { a, b() { return 1; }, 'c': 1 } as const;")]) === '["a","b","c"]');
  check('no BUDGET at all is null and not a refusal', budgetKeys('export const OTHER = 1;') === null);
  const F = 'instances/x/ui/y/Effect.tsx';
  let threw = '';
  try { canvasFaults({ [F]: TILES, [STORY]: 'export const BUDGET = makeBudget();' }, none); } catch (e) { threw = String(e.message); }
  check('an effect on the layer in an instance whose BUDGET cannot be read refuses and does not report a missing key', /cannot read BUDGET's keys/.test(threw), threw);
  const missing = canvasFaults({ [F]: TILES }, none);
  check('a missing budget story file is named as missing, not as a missing key', missing.length === 1 && /is missing/.test(missing[0]?.what) && !/no key/.test(missing[0]?.what), JSON.stringify(missing));
  const none2 = canvasFaults({ [F]: TILES, [STORY]: 'export const OTHER = 1;' }, none);
  check('a story file that exports no BUDGET says so', none2.length === 1 && /exports no BUDGET/.test(none2[0]?.what), JSON.stringify(none2));
  let git = '';
  try { treeFiles(os.tmpdir()); } catch (e) { git = String(e.message); }
  check('a failing git ls-files throws one plain line', /git ls-files failed/.test(git) && !git.includes('\n'), git);
  const asked = report(() => { throw new Error('effect-canvas: git ls-files failed: boom'); });
  check('the report of a failing read is one line on stderr and a non-zero code', asked.code === 1 && asked.err.length === 1 && !/\n|\bat /.test(asked.err[0]) && /git ls-files failed/.test(asked.err[0]), JSON.stringify(asked));
  const unread = report(() => ({ 'instances/x/ui/y/Effect.tsx': 'const a = 1;' }));
  check('a read that lacks the layer is refused, not passed', unread.code === 1 && unread.out.length === 0 && /was not read/.test(unread.err[0] ?? ''), JSON.stringify(unread));
  check('a read that has the layer is not refused for that', report(() => ({ [LAYER]: 'export {};' })).err.every((l) => !/was not read/.test(l)));
}

/* ---- the real tree ---- */
{
  const files = treeFiles();
  check('the real tree is read', Object.keys(files).length > 100, String(Object.keys(files).length));
  check('the layer is among the files read (so it is the one excluded, not unread)', 'engine/ui/cards/tiles.ts' in files);
  check('the budget stories are read', 'instances/divided-world/ui/EffectBudget.board.stories.tsx' in files);
  const r = canvasFaults(files);
  check('the real tree has no canvas outside the layer beyond the list, and every effect on it a budget story', r.length === 0, JSON.stringify(r));
  check('every listed entry has a reason', Object.values(CANVASES).every((e) => e.why.length > 20));
  check('every until names a step', Object.values(CANVASES).every((e) => e.until === undefined || /^step [2-5]$/.test(e.until)));
  check('Hot Box waits for nothing: its one entry is its sprite, with no until', Object.entries(CANVASES).filter(([f]) => f.includes('/hot-box/')).every(([, e]) => e.until === undefined));
}

console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
