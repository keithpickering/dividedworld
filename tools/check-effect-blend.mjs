/**
 * Guard: nothing in the interface blends with what is behind it.
 *
 *   node tools/check-effect-blend.mjs
 *
 * An element that blends takes its backdrop from the nearest stacking context. A place that shows a post (the ORIGIN box's area) or another card's wrapper
 * may make one with nothing painted in it, so the blended image has no backdrop and is drawn as it is: an opaque gray shows as a white rectangle
 * (issue #768, docs/plans/2026-11-16-steel-chair-origin-design.md, section 2). An effect draws plain alpha instead, which is the same picture over any backdrop.
 *
 * Read: every `.css` under engine/ui and instances, and every non-test, non-story `.ts`/`.tsx` there (engine/mail is not read: an email is not a post's
 * place, and its blends are its own). A `mix-blend-mode` declaration with any value but `normal` (any case, with or without `!important`, a value on a later
 * line) is a fault, naming the file and the line, and so is a `mixBlendMode` property in a script: a key of an object (an inline style), an assignment to
 * `style.mixBlendMode`, or `setProperty('mix-blend-mode', ...)`, whose value is anything but the literal 'normal' (a variable cannot be shown to be normal).
 * A CSS declaration written inside a script's string or template is read as CSS. Comments, in a stylesheet and in a script, are not read.
 * `background-blend-mode` is not its concern: it blends an element's own backgrounds with each other, never with what is behind it.
 *
 * What it cannot see: a blend set through a custom property (`mix-blend-mode: var(--x)` is a fault, as no value but `normal` passes, but `--x: multiply`
 * set somewhere else is not read), through a computed property name that is not a string literal (`style[prop] = ...`, `{ [prop]: ... }`), through `cssText` or an HTML string built in pieces, through a
 * stylesheet outside engine/ui and instances, or by a `.module` import of one; none exists today, and a new way to set a blend must be taught to this check
 * in the same change. tools/test-effect-blend.mjs drives it red on each planted blend.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = /^(?:engine\/ui|instances)\/.*\.(?:css|tsx?)$/;
const NOT_SOURCE = /\.test\.tsx?$|\.stories\.tsx?$/;

const kindOf = (file) => (file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
/** @param {ts.Node | undefined} n @returns {n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral} */
const isText = (n) => n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));
const isNormal = (value) => value.replace(/!\s*important/i, '').trim().toLowerCase() === 'normal';

/** A text with its `/* *\/` comments blanked, newlines kept, so a line number in it is still the line in the file. */
const blankComments = (text) =>
  text.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g, (c) => (c.startsWith('/*') ? c.replace(/[^\n]/g, ' ') : c));

/** An expression with its `as`, `satisfies`, non-null and parentheses taken off. */
const unwrap = (n) => {
  while (n && (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n))) n = n.expression;
  return n;
};

/** Each `mix-blend-mode` declaration in a CSS text that is not `normal`, with its line (counted from `firstLine`) and its value. */
function cssBlends(css, firstLine = 1) {
  const out = [];
  const text = blankComments(css);
  const re = /(?<![\w-])mix-blend-mode\s*:([^;}]*)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (isNormal(m[1])) continue;
    const value = m[1].replace(/\s+/g, ' ').trim();
    out.push({ line: firstLine + (text.slice(0, m.index).match(/\n/g) ?? []).length, what: `mix-blend-mode: ${value}` });
  }
  return out;
}

/** Each blend in a script: an inline style's `mixBlendMode`, a `style.mixBlendMode =`, a `setProperty('mix-blend-mode', ...)`, and CSS in a string. */
function scriptBlends(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file));
  const out = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const valueOf = (v) => (v === undefined ? 'a value that is not a literal' : isText(v) ? `'${v.text}'` : 'a value that is not a literal');
  const flag = (node, value) => {
    const v = unwrap(value);
    if (!(isText(v) && isNormal(v.text))) out.push({ line: lineOf(node), what: `mixBlendMode: ${valueOf(v)}` });
  };
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || isText(node.name) || (ts.isComputedPropertyName(node.name) && isText(unwrap(node.name.expression)))) && (ts.isComputedPropertyName(node.name) ? unwrap(node.name.expression).text : node.name.text) === 'mixBlendMode') flag(node, node.initializer);
    else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'mixBlendMode') flag(node, undefined);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'mixBlendMode') flag(node, node.right);
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setProperty' && isText(node.arguments[0]) && node.arguments[0].text.toLowerCase() === 'mix-blend-mode') flag(node, node.arguments[1]);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const b of cssBlends(node.getText(sf), lineOf(node))) out.push(b);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every fault: each blend in a stylesheet or script that is not `normal`.
 * @param {Record<string, string>} files tracked path to text
 * @returns {{ file: string, line: number, what: string }[]}
 */
export function blendFaults(files) {
  const faults = [];
  for (const [p, t] of Object.entries(files)) {
    if (!SOURCE.test(p) || NOT_SOURCE.test(p)) continue;
    for (const b of p.endsWith('.css') ? cssBlends(t) : scriptBlends(t, p)) faults.push({ file: p, ...b });
  }
  return faults;
}

export function treeFiles(cwd = repoRoot) {
  let tree;
  try {
    tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
  } catch (e) {
    throw new Error(`effect-blend: git ls-files failed in ${cwd}, so the tree was not read (${String(e?.stderr || e?.message || e).trim().split(/\r?\n/)[0]})`);
  }
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) {
    if (!SOURCE.test(p) || NOT_SOURCE.test(p)) continue;
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
  let files;
  try {
    files = read();
  } catch (e) {
    return { code: 1, out: [], err: [String(e?.message ?? e).split(/\r?\n/)[0]] };
  }
  /* A guard reading nothing would pass. */
  if (Object.keys(files).length === 0) return { code: 1, out: [], err: ['  effect-blend: read nothing, which cannot be right; refusing to report a pass on nothing'] };
  const faults = blendFaults(files);
  if (faults.length) {
    const err = [`  effect-blend: ${faults.length} fault(s):`];
    for (const f of faults) err.push(`    ${f.file}:${f.line}  blends with what is behind it: ${f.what}`);
    err.push('  An element that blends takes its backdrop from the nearest stacking context, and a post\'s place may make one with nothing painted in it, so the image is drawn as it is (issue #768). Draw plain alpha instead: black with an alpha for a shade, white with an alpha for a light.');
    return { code: 1, out: [], err };
  }
  return { code: 0, out: [`  effect-blend: ${Object.keys(files).length} file(s), no blend with what is behind`], err: [] };
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
