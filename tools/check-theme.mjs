/**
 * Guard: an instance's theme is a stylesheet of `--kb-*` custom properties and nothing else.
 *
 *   node tools/check-theme.mjs
 *
 * A theme is how an instance looks (docs/plans/2026-10-29-screens-design.md, section 12), and the
 * engine's screens read it only through the tokens in engine/ui/tokens.css. A theme file is still a
 * stylesheet, so nothing but this check stops it from also writing `.kb-hud { display: none }`,
 * hiding the HUD or a game effect from every player, or from setting `--kb-size-body: 0`, which
 * makes the text vanish. Both look right in the house colors and change no test, so the file is read
 * on every build rather than trusted.
 *
 * Read: every `instances/<name>/ui/*.css`. After comments are removed it may hold only
 *
 *   :root { … }                                     light
 *   :root[data-kb-mode="dark"] { … }                dark, as a player who chose it gets it
 *   :root[data-kb-mode="light"] { … }               light, if the theme needs it
 *   @media (prefers-color-scheme: dark) { :root:not([data-kb-mode="light"]) { … } }   dark as the device gets it
 *
 * each at most once, and every declaration in them is a `--kb-*` custom property. A second block with the
 * same selector is refused: the browser lays it over the first, so a reader of the file (and a reviewer of a
 * diff that touches only the first) sees colors the page does not show. engine/ui/contrast.ts reads every
 * block in order as the browser does, so contrast holds either way; this keeps the file saying what it does. A size token (`--kb-size-*`, `--kb-line`)
 * must be a plain positive number with an optional unit: a `calc()` or a `var()` cannot be shown
 * positive, so it is refused, and 0 or less hides the text it sizes. A theme may add a size token the
 * engine does not name; the engine ignores it.
 *
 * Also read: each instance's `ui/index.ts`. Every `href` in its `themes` list must be an identifier
 * imported from a `*.css?url` file that sits in that instance's own ui/ folder and is in the tree, so
 * the file the page loads as a theme is a file this check has read.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The
 * detection is exported and pure so tools/test-theme.mjs drives every branch red.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const THEME_FILE = /^instances\/([^/]+)\/ui\/[^/]+\.css$/;
export const UI_INDEX = /^instances\/([^/]+)\/ui\/index\.ts$/;

const SELECTORS = new Set([':root', ':root[data-kb-mode="dark"]', ':root[data-kb-mode="light"]']);
const DEVICE_QUERY = '@media(prefers-color-scheme:dark)';
const DEVICE_SELECTOR = ':root:not([data-kb-mode="light"])';
const SIZE_TOKEN = /^--kb-(size-[a-z0-9-]+|line)$/;

/** A stylesheet with its comments blanked to spaces, so lines keep their numbers; strings are skipped whole. */
function withoutComments(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const j = close === -1 ? text.length : close + 2;
      out += text.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The index of the first of `stops` at depth 0 of parentheses and brackets, outside strings, from `i`; -1 if none. */
function scanTo(text, i, stops) {
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
    } else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth <= 0 && stops.includes(c)) return i;
  }
  return -1;
}

/** The index of the `}` closing the `{` at `open`, counting nested braces and skipping strings; -1 if unclosed. */
function closeOf(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim().replace(/'/g, '"');

/** Faults of one rule's declarations. */
function declarationFaults(body, at, lineOf, file, out) {
  let i = 0;
  while (i < body.length) {
    const semi = scanTo(body, i, [';']);
    const end = semi === -1 ? body.length : semi;
    const decl = body.slice(i, end);
    const lead = decl.length - decl.trimStart().length;
    const line = lineOf(at + i + lead);
    i = end + 1;
    if (!decl.trim()) continue;
    const colon = decl.indexOf(':');
    const name = colon === -1 ? decl.trim() : decl.slice(0, colon).trim();
    const value = colon === -1 ? '' : decl.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim();
    if (!/^--kb-[a-z0-9-]+$/.test(name)) {
      out.push({ file, line, why: `"${name.slice(0, 40)}" is not a --kb-* custom property; a theme sets tokens and nothing else` });
    } else if (SIZE_TOKEN.test(name)) {
      const m = value.match(/^(\d*\.?\d+)([a-z%]*)$/i);
      if (!m) out.push({ file, line, why: `${name}: ${value} is not a plain positive number with an optional unit, so it cannot be shown to size text above zero` });
      else if (!(parseFloat(m[1]) > 0)) out.push({ file, line, why: `${name}: ${value} is not above zero, which hides the text it sizes` });
    }
  }
}

/**
 * Every departure of theme stylesheets from the contract, as `{ file, line, why }`; [] is clean.
 * @param {Record<string, string>} files repository path to text
 */
export function themeFaults(files) {
  const out = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!THEME_FILE.test(file)) continue;
    const text = withoutComments(raw);
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    /** each selector's first block, by line: a repeat is refused */
    const firstAt = new Map();

    /** Rules of one level: `inMedia` allows only the device-dark selector, else only the three top-level ones. */
    const rules = (from, to, inMedia) => {
      let i = from;
      while (i < to) {
        while (i < to && /\s/.test(text[i])) i++;
        if (i >= to) break;
        const line = lineOf(i);
        if (text[i] === '}') { out.push({ file, line, why: 'a closing brace with no block open' }); i++; continue; }
        const stop = scanTo(text, i, ['{', ';', '}']);
        if (stop === -1 || stop >= to || text[stop] !== '{') {
          out.push({ file, line, why: text[stop] === ';' ? `"${squash(text.slice(i, stop)).slice(0, 40)}" is a statement; a theme holds only rules` : 'a block that is never opened' });
          i = stop === -1 || stop >= to ? to : stop + 1;
          continue;
        }
        const prelude = text.slice(i, stop);
        const close = closeOf(text, stop);
        if (close === -1 || close >= to) {
          out.push({ file, line, why: `the block opened by "${squash(prelude).slice(0, 40)}" is never closed` });
          return;
        }
        const body = [stop + 1, close];
        const sel = squash(prelude);
        if (!inMedia && sel.startsWith('@')) {
          const query = sel.toLowerCase().replace(/\s*:\s*/g, ':').replace(/\s+/g, '');
          if (query !== DEVICE_QUERY) out.push({ file, line, why: `"${sel.slice(0, 50)}" is not allowed; the only at-rule is @media (prefers-color-scheme: dark)` });
          else rules(body[0], body[1], true);
        } else if (inMedia ? sel.replace(/\s+/g, '') !== DEVICE_SELECTOR : !SELECTORS.has(sel.replace(/\s*([\[\]=])\s*/g, '$1'))) {
          out.push({ file, line, why: inMedia
            ? `"${sel.slice(0, 50)}" inside the dark query; the only selector there is ${DEVICE_SELECTOR}`
            : `selector "${sel.slice(0, 50)}" is not :root, :root[data-kb-mode="dark"] or :root[data-kb-mode="light"]; a theme styles nothing but the tokens` });
        } else {
          const key = inMedia ? DEVICE_SELECTOR : sel.replace(/\s*([\[\]=])\s*/g, '$1');
          if (firstAt.has(key)) out.push({ file, line, why: `a second block for ${key} (the first is at line ${firstAt.get(key)}); the browser lays it over the first, so the file would show colors the page does not` });
          else firstAt.set(key, line);
          declarationFaults(text.slice(body[0], body[1]), body[0], lineOf, file, out);
        }
        i = close + 1;
      }
    };
    rules(0, text.length, false);
  }
  return out;
}

/**
 * Every `href` in an instance's `themes` list that is not an identifier imported from a `*.css?url` file in
 * that instance's own ui/ folder which the tree holds.
 * @param {Record<string, string>} files repository path to text
 */
export function themeHrefFaults(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    const home = file.match(UI_INDEX);
    if (!home) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    /** local name -> repository path of the stylesheet it imports */
    const imported = new Map();
    for (const st of source.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.name && /\.css\?url$/.test(st.moduleSpecifier.text)) {
        imported.set(st.importClause.name.text, path.posix.normalize(path.posix.join(path.posix.dirname(file), st.moduleSpecifier.text.replace(/\?url$/, ''))));
      }
    }
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'themes') {
        /* The list may be wrapped (Object.freeze([...])); find the array literal inside it. */
        let list = node.initializer;
        while (ts.isCallExpression(list) && list.arguments.length) list = list.arguments[0];
        if (!ts.isArrayLiteralExpression(list)) {
          out.push({ file, line: lineOf(node), why: 'the themes list is not an array literal the check can read' });
          return;
        }
        for (const el of list.elements) {
          let obj = el;
          while (ts.isCallExpression(obj) && obj.arguments.length) obj = obj.arguments[0];
          if (!ts.isObjectLiteralExpression(obj)) { out.push({ file, line: lineOf(el), why: 'a theme entry is not an object literal the check can read' }); continue; }
          const prop = obj.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText(source) === 'href');
          const assigned = prop !== undefined && ts.isPropertyAssignment(prop) ? prop.initializer : null;
          const ident = prop === undefined ? null : ts.isShorthandPropertyAssignment(prop) ? prop.name : assigned !== null && ts.isIdentifier(assigned) ? assigned : null;
          if (ident === null) { out.push({ file, line: lineOf(obj), why: 'a theme\'s href is not an identifier imported from a *.css?url file' }); continue; }
          const target = imported.get(ident.text);
          const ownUi = `instances/${home[1]}/ui/`;
          if (target === undefined) out.push({ file, line: lineOf(ident), why: `href ${ident.text} is not imported from a *.css?url file` });
          else if (!(target.startsWith(ownUi) && !target.slice(ownUi.length).includes('/') && THEME_FILE.test(target))) out.push({ file, line: lineOf(ident), why: `href ${ident.text} is ${target}, which is not a stylesheet in this instance's ui/ folder` });
          else if (!Object.hasOwn(files, target)) out.push({ file, line: lineOf(ident), why: `href ${ident.text} is ${target}, which the tree does not hold` });
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

/** The tracked themes and ui indexes, read from disk. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if ((THEME_FILE.test(p) || UI_INDEX.test(p)) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass; an instance always has a theme, so an empty read is a broken read. */
  const themes = Object.keys(files).filter((f) => THEME_FILE.test(f));
  if (themes.length === 0) {
    console.error('  theme: no instance theme was read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = [...themeFaults(files), ...themeHrefFaults(files)];
  if (faults.length) {
    console.error(`  theme: ${faults.length} departure(s) from the theme contract:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.why}`);
    console.error('  A theme is a stylesheet of --kb-* custom properties under :root, :root[data-kb-mode], and the device-dark media query\n  (docs/plans/2026-10-29-screens-design.md, section 12).');
    process.exit(1);
  }
  console.log(`  theme: ${themes.length} theme file(s), only --kb-* tokens under the contract's selectors`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
