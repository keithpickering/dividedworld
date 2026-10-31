/**
 * Guard: every read by many ids in the data layer is chunked.
 *
 *   node tools/check-id-reads.mjs
 *
 * PostgREST's `.in(column, list)` puts every value of `list` in the request's address. A list a busy instance grows (a
 * page's posts and plays, a gap of missed posts, a log page's settlements) eventually makes an address past a proxy's
 * bound, and then the page reads "The thread could not be loaded" or the gap stays missing until a reload (#104: the
 * page's tallies and own-reactions reads, unchunked, crossed 8,000 characters at about 23 posts with plays). A read
 * left unchunked "because today's list is short" is exactly that failure, so none is ("Weigh a design at the scale of
 * a busy instance"). The chunking itself is `chunks()` and `byChunks()` in web/src/data/supabase.ts.
 *
 * Read from the TypeScript AST of every tracked, non-test file in web/src/data/ (`git ls-files` on purpose: an
 * untracked scratch file neither fails the build nor makes it pass). For each call whose callee is `X.in(…)` or
 * `X['in'](…)`, through parentheses, casts and `!`:
 * - clean when its column is a string literal in BOUNDED_IN, whose values are a fixed list with its bound stated;
 * - clean when its list is an identifier bound as the first parameter of an arrow or function expression that is the
 *   first argument of `.map`/`.flatMap` on a call to `chunks(…)`, or the second argument of a call to `byChunks(…)`,
 *   with no declaration of the same name between that function and the `.in`;
 * - anything else fires, with its file, line and column: a column the guard cannot read (a variable), a list spread or
 *   built in place, a list passed through a variable or a helper first, or a chunk's parameter shadowed.
 *
 * Out of scope, named so a reader knows: a list built from a chunk and then renamed through a destructuring or an
 * object field fires (it is not read through), which is the safe side; a `.in` reached through a variable holding the
 * method (`const f = q.in`) is not a call of `.in` and is not read, and check-web-reads.mjs holds that each `.from()`
 * is read at once with `.select()`, so a query is never stored to be filtered later.
 *
 * The detection is exported and pure so tools/test-id-reads.mjs drives every branch red.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files the guard reads: the data layer, without its tests. */
export const SOURCE = /^web\/src\/data\/.*\.(ts|tsx|mts|js|mjs)$/;
const TEST = /\.test\./;

/** The columns an `.in()` may filter on with any list, each with the bound on its values stated. */
export const BOUNDED_IN = Object.freeze([
  Object.freeze({ column: 'kind', bound: 'the Act kinds, a fixed list in the rules (engine/rules/), so the list never grows with an instance' }),
]);

/** The expression under any parentheses, casts, non-null marks and satisfies. */
function unwrap(node) {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
  return n;
}

/** The name a member access reads, `a.x` or `a['x']`, or null for any other node. */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))) return node.argumentExpression.text;
  return null;
}

const isFunction = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);
const calls = (node, name) => ts.isCallExpression(node) && ts.isIdentifier(unwrap(node.expression)) && unwrap(node.expression).text === name;

/** True when a function is a chunk's callback: `chunks(…).map(fn)`/`.flatMap(fn)`, or `byChunks(ids, fn)`. */
function isChunkCallback(fn) {
  let at = fn;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const call = at.parent;
  if (!call || !ts.isCallExpression(call)) return false;
  if (calls(call, 'byChunks')) return call.arguments[1] === at;
  const callee = unwrap(call.expression);
  const method = memberName(callee);
  if ((method !== 'map' && method !== 'flatMap') || call.arguments[0] !== at) return false;
  return calls(unwrap(callee.expression), 'chunks');
}

/** True when `name` is declared (a variable, a parameter, a function) anywhere inside `scope` but outside `fn`'s own parameter list. */
function declaredWithin(scope, name, skip) {
  let found = false;
  const visit = (n) => {
    if (found || n === skip) return;
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

/** True when `list` is a chunk: the first parameter of a chunk's callback, not shadowed between it and the read. */
function isChunk(list) {
  const id = unwrap(list);
  if (!ts.isIdentifier(id)) return false;
  for (let n = id.parent; n; n = n.parent) {
    if (!isFunction(n)) continue;
    const at = n.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === id.text);
    if (at === -1) {
      /* A function between the read and the binder that declares the name inside it shadows it. */
      if (declaredWithin(n.body ?? n, id.text, null)) return false;
      continue;
    }
    if (at !== 0 || !isChunkCallback(n)) return false;
    /* The callback's own body must not declare the name again over its parameter. */
    return !(n.body && declaredWithin(n.body, id.text, null));
  }
  return false;
}

/** Every `.in()` call in one file, with whether it is clean. */
function inCalls(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bounded = new Set(BOUNDED_IN.map((b) => b.column));
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && memberName(unwrap(node.expression)) === 'in') {
      const [column, list] = node.arguments;
      const col = column && (ts.isStringLiteral(column) || ts.isNoSubstitutionTemplateLiteral(column)) ? column.text : null;
      const clean = col !== null && (bounded.has(col) || (list !== undefined && isChunk(list)));
      const at = source.getLineAndCharacterOfPosition(node.getStart(source));
      out.push({ file, line: at.line + 1, column: at.character + 1, clean });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const read = (files) => Object.entries(files).filter(([f]) => SOURCE.test(f) && !TEST.test(f));

/** Every `.in()` read that is neither chunked nor bounded: `{ file, line, column }`. */
export function readFaults(files) {
  return read(files).flatMap(([f, text]) => inCalls(f, text).filter((c) => !c.clean).map(({ file, line, column }) => ({ file, line, column })));
}
/** How many `.in()` reads the guard read, so a guard gone quiet over nothing is seen. */
readFaults.count = (files) => read(files).reduce((n, [f, text]) => n + inCalls(f, text).length, 0);

/** The tracked, non-test data-layer sources, read from disk. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z', 'web/src/data'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (SOURCE.test(p) && !TEST.test(p) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  const count = readFaults.count(files);
  /* A guard reading nothing would pass; the data layer always reads by id, so no `.in()` read is a broken read. */
  if (count === 0) {
    console.error('  id-reads: no `.in()` read found in web/src/data/, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = readFaults(files);
  if (faults.length) {
    console.error(`  id-reads: ${faults.length} \`.in()\` read(s) neither chunked nor bounded:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}:${f.column}`);
    console.error('  Read by chunks(…).map((part) => …in(col, part)) or byChunks(ids, (part) => …); a column with a fixed list goes in BOUNDED_IN, tools/check-id-reads.mjs.');
    process.exit(1);
  }
  console.log(`  id-reads: ${count} \`.in()\` reads in ${Object.keys(files).length} files, each chunked or bounded`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
