/**
 * Guard: no canvas is made outside the tile layer, and no effect is on the layer without its budget story.
 *
 *   node tools/check-effect-canvas.mjs
 *
 * An effect that lays a canvas the size of a post holds the post's whole area in memory however long it is, and a post of 20,000 characters is tall
 * (docs/plans/2026-11-16-effect-tiles-design.md, sections 1 and 6). The layer (engine/ui/cards/tiles.ts) holds a canvas only for the part of the box
 * near the window, capped in pixels, so a canvas an effect makes for itself is the defect. This is guard 2 of that design.
 *
 * Read: every non-test, non-story `.ts`/`.tsx` under engine/ui and instances/, from the TypeScript AST. A canvas is a `<canvas>` element, a call of
 * `createElement('canvas')` on anything or bare, a `new OffscreenCanvas(...)`, or a call of `transferControlToOffscreen()`. Each is a fault unless it is in
 * engine/ui/cards/tiles.ts (the layer makes the canvases) or in CANVASES, which lists each other file with how many, and why a canvas that is not the size of a
 * post is right there. A file making more than its count, a listed file making fewer (a stale entry: the step that moved the effect deletes its line), and a
 * listed file that is gone, each fail. An entry with `until` is an effect not yet on the layer, and names the step of the design's section 7 that moves it.
 *
 * Budget stories (guard 3): an instance file that imports engine/ui/cards/tiles.ts is an effect on the layer, and the folder it is in (the one directly
 * under instances/<instance>/ui/) must be a key of the object literal `BUDGET` exported by instances/<instance>/ui/EffectBudget.board.stories.tsx, which
 * has a story for each key. e2e/effect-tiles.spec.ts measures every one of those stories, so an effect with none would skip the measuring. The same
 * holds for the folder directly under instances/<instance>/cards/ (Whoops!, Graffiti and Autocorrect live there). An instance file on the layer that is in
 * neither shape (directly in ui/ or cards/, or anywhere else in the instance) fires too, saying the check cannot name its effect, never a silent pass; the
 * budget story file itself, and test and story files (which are not read), are exempt. A type-only import of the layer makes no layer and is not one. When
 * the story file is missing, exports no BUDGET, or exports one that is not a plain object literal (a call, a spread, a computed key), the check says so and
 * refuses; it never reports every effect as missing a key. A failing `git ls-files` ends in one plain line and exit 1.
 *
 * A bare `createElement('canvas')` (React's, imported by name) is one, as is `React.createElement('canvas')`.
 *
 * What it cannot see: a canvas made through a variable tag name (`createElement(tag)`), one made through the automatic JSX runtime's `jsx('canvas', ...)` (no
 * source here calls it; the `<canvas>` element is seen), a `createElement` renamed on import, a hyperscript helper under another name (`h('canvas')`), a canvas
 * written inside an HTML string (`innerHTML`, a template literal), a `cloneNode` of a canvas, and a canvas, in a file the list allows, that is sized to a post
 * (a listed file is held to its count, never to what its canvas is for). It sees `new OffscreenCanvas`, `new globalThis.OffscreenCanvas` (and self., window.:
 * any property access ending in the name) and `createElementNS(ns, 'canvas')`. Nor does it see an import of the layer through a path alias or a barrel
 * re-export in another file (the layer is named only by a relative path to engine/ui/cards/tiles); none exists today, and a new alias or barrel must be taught
 * to `layerImports` in the same change, or an effect imported through it asks for no budget story. The tile layer's own unit test (engine/ui/cards/tiles.test.tsx) holds the
 * pixels and e2e/effect-tiles.spec.ts holds the frames in a real page; this holds only that nothing makes a canvas where the layer is not looking.
 * tools/test-effect-canvas.mjs drives it red on each planted canvas.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = /^(?:engine\/ui|instances)\/.*\.tsx?$/;
const NOT_SOURCE = /\.test\.tsx?$|\.stories\.tsx?$/;
/** The layer: the one file that makes the canvases an effect draws on. */
export const LAYER = 'engine/ui/cards/tiles.ts';
const LAYER_MODULE = LAYER.replace(/\.ts$/, '');
const BUDGET_FILE = /^instances\/([^/]+)\/ui\/EffectBudget\.board\.stories\.tsx$/;

/**
 * The canvases that stay or wait, by file: how many, why, and for an effect not yet on the layer, the step (of the design's section 7) that moves it.
 * @type {Readonly<Record<string, { count: number; why: string; until?: string }>>}
 */
export const CANVASES = {
  /* ---- stay: a canvas that is not a post's size, by what it is for ---- */
  'engine/ui/glass/field.ts': { count: 1, why: 'rasterizes the glass field\'s SVG noise to a PNG mask, a scratch canvas the size of the field\'s window, drawn once and dropped' },
  'engine/ui/profile-edit/picture.ts': { count: 4, why: 'the avatar editor: a 4 px probe for whether the browser honors a bitmap resize, the shrunk picture it shows, the picture it opens, and the encoded crop' },
  'engine/ui/vending/packLight.ts': { count: 2, why: 'a scratch canvas to read the pixels of a pack\'s art, to light it, and the light\'s own canvas laid over the pack\'s picture (a bare createElement), a bitmap never past the relief\'s 540 by 840' },
  'instances/divided-world/cards/whoops/ConfigForm.tsx': { count: 1, why: 'the ink\'s preview in the card\'s config form, a fixed small box (PREVIEW_BOX)' },
  'instances/divided-world/cards/whoops/cursor.ts': { count: 2, why: 'the bench\'s drop, a 24 by 36 sprite drawn once, and the one fixed overlay for the drips, sized to the window and shared by the whole page' },
  'instances/divided-world/ui/hot-box/paint.ts': { count: 1, why: "the fog's scratch canvas, one for the page: a tile's rows of fog are put on it a cell to a pixel (a field's width by a tile's rows, never a post's size) and drawn from it onto the tile; the fog itself is on the layer" },
  'instances/divided-world/ui/its-curtains/confetti.ts': { count: 1, why: "the confetti's one canvas for the page: fixed over the window with no pointer events, the window's size and never a post's, shared by every throw and removed when the last piece lands" },
  'instances/divided-world/ui/steel-chair/dent.ts': { count: 1, why: 'a dent\'s height-map images (its bend, and its shade and light as alpha images), each at most 320 px square, drawn once per play and kept as URLs in a cache of 32 plays, and again, capped against the dents it overlaps, in a cache of 8' },
  /* ---- wait: an effect not yet on the layer, with the step (design, section 7) that moves it ---- */
  'instances/divided-world/cards/graffiti/Compose.tsx': { count: 1, why: 'the wall\'s ink canvas while composing, laid over the post\'s whole area', until: 'step 2' },
  'instances/divided-world/cards/graffiti/Effect.tsx': { count: 2, why: 'the wall\'s ink and its suds, each laid over the post\'s whole area', until: 'step 2' },
  'instances/divided-world/cards/graffiti/spray.ts': { count: 2, why: 'the overspray sprite, and the halo scratch canvas that step 2 deletes', until: 'step 2' },
  'instances/divided-world/cards/whoops/Effect.tsx': { count: 2, why: 'the ink bands (one canvas for each band and layer) and the suds, laid over the post\'s whole area', until: 'step 3' },
  'instances/divided-world/cards/whoops/paint.ts': { count: 1, why: 'the ink\'s canvas, sized to the post\'s box at a density the cap lowers', until: 'step 3' },
  'instances/divided-world/cards/whoops/suds.ts': { count: 1, why: 'the suds\' wet-layer canvases, sized to the post\'s box', until: 'step 3' },
  'instances/divided-world/ui/feelin-fab/Effect.tsx': { count: 1, why: 'the foil, one canvas over the post\'s whole body, handed to the foil worker', until: 'step 4' },
  'instances/divided-world/ui/glitter-bomb/Effect.tsx': { count: 3, why: 'the glitter\'s under, flash and over canvases, each over the post\'s whole body', until: 'step 4' },
  'engine/ui/shine/foil.ts': { count: 2, why: 'the foil\'s drawing canvas, an OffscreenCanvas or a canvas where there is none, sized to the post body it draws', until: 'step 4' },
  'engine/ui/shine/foilClient.ts': { count: 1, why: 'hands a host\'s canvas to the foil worker (transferControlToOffscreen)', until: 'step 4' },
  'engine/ui/shine/flakes.ts': { count: 3, why: 'the loose flakes\' star sprite (an OffscreenCanvas, or a canvas where there is none) and the one window-sized canvas the loop draws them on', until: 'step 4' },
  'engine/ui/shine/landing.ts': { count: 1, why: 'a landed-glitter tile, at most TILE_W by TILE_H, made where a flake first lands in its cell', until: 'step 4' },
  /* ---- wait: step 5 ---- */
  'instances/divided-world/cards/autocorrect/Effect.tsx': { count: 6, why: 'six. Five stay: the text ruler for measureText, each line\'s own paper (a line\'s size), the corner fold (one piece\'s size, only while its end is picked) and the film and the scratch the residue is colored on. The residue canvas, sized to the strips\' whole footprint, leaves for the layer at step 5, which lowers this count to 5 and drops `until`', until: 'step 5' },
  'instances/divided-world/cards/autocorrect/foldpaint.ts': { count: 2, why: 'two, each one piece\'s size and only while its end is picked: a face of the tape (its paper and its sticky side) and the scratch the fold is laid on, so its shadow is not clipped; the scratch is made with the faces and cleared per frame, not made per frame' },
};

const kindOf = (file) => (file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const parse = (text, file) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file));
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
/** @param {ts.Node | undefined} n @returns {n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral} */
const isText = (n) => n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));

/** Each canvas made in a source text, with its line and what it was. */
export function canvasUses(text, file) {
  const sf = parse(text, file);
  const out = [];
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === 'canvas') {
      out.push({ line: lineOf(sf, node), what: '<canvas>' });
    } else if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isIdentifier(node.expression))) {
      /* `x.createElement(...)` and a bare `createElement(...)` (React's, imported by name) alike. */
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.text;
      if (name === 'createElement' && isText(node.arguments[0]) && node.arguments[0].text.toLowerCase() === 'canvas') out.push({ line: lineOf(sf, node), what: "createElement('canvas')" });
      else if (name === 'createElementNS' && isText(node.arguments[1]) && node.arguments[1].text.toLowerCase() === 'canvas') out.push({ line: lineOf(sf, node), what: "createElementNS('canvas')" });
      else if (name === 'transferControlToOffscreen') out.push({ line: lineOf(sf, node), what: 'transferControlToOffscreen()' });
    } else if (ts.isNewExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'OffscreenCanvas') || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'OffscreenCanvas'))) {
      /* `new OffscreenCanvas`, and `new globalThis.OffscreenCanvas` (or self., window.): a property access that ends in the name. */
      out.push({ line: lineOf(sf, node), what: 'new OffscreenCanvas' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The line of each import (or re-export, or dynamic import) in a source text that names the layer, resolved from the importing file's folder. */
export function layerImports(text, file) {
  const sf = parse(text, file);
  const out = [];
  const names = (spec) => {
    if (!spec.startsWith('.')) return false;
    const target = path.posix.join(path.posix.dirname(file), spec).replace(/\.(?:[cm]?[jt]sx?)$/, '');
    return target === LAYER_MODULE;
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isText(node.moduleSpecifier) && names(node.moduleSpecifier.text)) {
      /* `import type` and `export type ... from` are erased: they make no layer, so they ask for no budget. */
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly;
      if (!typeOnly) out.push(lineOf(sf, node));
    }
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && isText(node.arguments[0]) && names(node.arguments[0].text)) out.push(lineOf(sf, node));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * The keys of the object literal `BUDGET` that a story file exports, or null when it exports none. A BUDGET that is exported but is not a plain object
 * literal (built by a call, with a spread, with a computed key) is not read: this throws "cannot read BUDGET's keys", never a guess at them.
 */
export function budgetKeys(text, file = 'EffectBudget.board.stories.tsx') {
  const sf = parse(text, file);
  let keys = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== 'BUDGET' || !d.initializer) continue;
      let init = d.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      const cannot = (why) => new Error(`effect-canvas: cannot read BUDGET's keys: ${why} (${file}:${lineOf(sf, d)}); write BUDGET as a plain object literal of its folder names`);
      if (!ts.isObjectLiteralExpression(init)) throw cannot(ts.isCallExpression(init) ? 'it is built by a call' : 'it is not an object literal');
      keys = new Set();
      for (const p of init.properties) {
        if (ts.isSpreadAssignment(p)) throw cannot('it has a spread');
        const n = p.name;
        if (n && ts.isComputedPropertyName(n)) throw cannot('it has a computed key');
        if (n && (ts.isIdentifier(n) || isText(n))) keys.add(n.text);
        else throw cannot('it has a key that is not a name');
      }
    }
  }
  return keys;
}

/**
 * The effect an instance file belongs to: the folder directly under `instances/<instance>/ui/` or `instances/<instance>/cards/`, with that instance. The
 * folder is null where the check cannot name the effect (a file directly in ui/ or cards/, or anywhere else in the instance); null for a file outside any instance.
 */
function effectFolder(file) {
  const m = /^instances\/([^/]+)\/(.+)$/.exec(file);
  if (!m) return null;
  const rest = m[2].split('/');
  return { instance: m[1], folder: (rest[0] === 'ui' || rest[0] === 'cards') && rest.length > 2 ? rest[1] : null };
}

/**
 * Every fault: a canvas in a file that does not list it, a file making more than it lists, a listed file making fewer or gone, and an instance file on the
 * layer whose folder has no budget story.
 * @param {Record<string, string>} files tracked path to text
 */
export function canvasFaults(files, allowed = CANVASES) {
  const faults = [];
  const seen = new Map();
  /** Per instance, the keys of its BUDGET (null when it has none). */
  const budgets = new Map();
  for (const [p, t] of Object.entries(files)) {
    const m = BUDGET_FILE.exec(p);
    if (m) budgets.set(m[1], budgetKeys(t, p));
  }
  for (const [p, t] of Object.entries(files)) {
    if (!SOURCE.test(p) || NOT_SOURCE.test(p) || p === LAYER) continue;
    const uses = canvasUses(t, p);
    seen.set(p, uses.length);
    const room = allowed[p]?.count ?? 0;
    if (uses.length > room) for (const u of uses.slice(room)) faults.push({ file: p, line: u.line, what: u.what, kind: 'canvas' });
    const where = BUDGET_FILE.test(p) ? null : effectFolder(p);
    if (where) {
      const lines = layerImports(t, p);
      if (lines.length) {
        const hasFile = budgets.has(where.instance);
        const keys = budgets.get(where.instance) ?? null;
        const story = `instances/${where.instance}/ui/EffectBudget.board.stories.tsx`;
        if (where.folder === null) {
          faults.push({ file: p, line: lines[0], what: `is on the tile layer but is in no ui/<folder>/ or cards/<folder>/ of its instance, so the check cannot name its effect for a key of BUDGET in ${story} (move it into its effect's folder)`, kind: 'budget' });
        } else if (!hasFile) {
          faults.push({ file: p, line: lines[0], what: `is on the tile layer and the budget story file ${story} is missing (an effect on the layer needs its key in BUDGET there)`, kind: 'budget' });
        } else if (keys === null) {
          faults.push({ file: p, line: lines[0], what: `is on the tile layer and ${story} exports no BUDGET (an effect on the layer needs its key there)`, kind: 'budget' });
        } else if (!keys.has(where.folder)) {
          faults.push({ file: p, line: lines[0], what: `is on the tile layer and its folder ${where.folder} is no key of BUDGET in ${story}`, kind: 'budget' });
        }
      }
    }
  }
  for (const [p, entry] of Object.entries(allowed)) {
    if (!(p in files)) faults.push({ file: p, line: 0, what: `lists ${entry.count} canvas(es) and is gone`, kind: 'gone' });
    else if ((seen.get(p) ?? 0) < entry.count) faults.push({ file: p, line: 0, what: `lists ${entry.count} canvas(es) and makes ${seen.get(p) ?? 0}`, kind: 'stale' });
  }
  return faults;
}

export function treeFiles(cwd = repoRoot) {
  let tree;
  try {
    tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
  } catch (e) {
    throw new Error(`effect-canvas: git ls-files failed in ${cwd}, so the tree was not read (${String(e?.stderr || e?.message || e).trim().split(/\r?\n/)[0]})`);
  }
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) {
    if (!((SOURCE.test(p) && !NOT_SOURCE.test(p)) || BUDGET_FILE.test(p))) continue;
    if (fs.existsSync(path.join(cwd, p))) files[p] = fs.readFileSync(path.join(cwd, p), 'utf8');
  }
  return files;
}

/**
 * What the check says and its exit code, from a reader of the tree: a pure function, so the refusals can be driven in a test.
 * @param {() => Record<string, string>} read
 * @returns {{ code: number, out: string[], err: string[] }}
 */
export function report(read = treeFiles) {
  const refused = (e) => ({ code: 1, out: [], err: [String(e?.message ?? e).split(/\r?\n/)[0]] });
  let files;
  try {
    files = read();
  } catch (e) {
    return refused(e);
  }
  /* A guard reading nothing would pass. */
  if (!(LAYER in files)) return { code: 1, out: [], err: [`  effect-canvas: ${LAYER} was not read, which cannot be right; refusing to report a pass on nothing`] };
  let faults;
  try {
    faults = canvasFaults(files);
  } catch (e) {
    return refused(e);
  }
  if (faults.length) {
    const err = [`  effect-canvas: ${faults.length} fault(s):`];
    for (const f of faults) {
      const hint = f.kind === 'stale' ? ' (update CANVASES)' : f.kind === 'gone' ? ' (delete its CANVASES line)' : '';
      err.push(`    ${f.file}${f.line ? `:${f.line}` : ''}  ${f.kind === 'canvas' ? `makes a canvas outside the tile layer: ${f.what}` : f.what}${hint}`);
    }
    err.push('  An effect draws on a layer from engine/ui/cards/tiles.ts (makeTileLayer), which holds a canvas only near the window. A canvas that is not the size of a post (a sprite, a preview) is listed in CANVASES (tools/check-effect-canvas.mjs) with why; an effect on the layer needs its key in BUDGET (instances/<instance>/ui/EffectBudget.board.stories.tsx).');
    return { code: 1, out: [], err };
  }
  const waiting = Object.values(CANVASES).filter((e) => e.until).length;
  return { code: 0, out: [`  effect-canvas: ${Object.keys(files).length} file(s), no canvas outside the layer beyond the ${Object.keys(CANVASES).length} listed (${waiting} waiting for a step)`], err: [] };
}

function main() {
  const r = report();
  for (const l of r.out) console.log(l);
  for (const l of r.err) console.error(l);
  if (r.code) process.exit(r.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
