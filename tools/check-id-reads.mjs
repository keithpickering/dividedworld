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
 * - clean when its list is an identifier bound as the plain first parameter (no rest, no default) of an arrow or
 *   function expression that is the first argument of `.map`/`.flatMap` on a call to the bare `chunks(…)`, or the
 *   second argument of a call to the bare `byChunks(…)`, and that parameter is used nowhere in its callback but as the
 *   list of `.in()` calls;
 * - anything else fires, with its file, line and column: a column the guard cannot read (a variable), a list spread or
 *   built in place, a list passed through a variable or a helper first, a chunk's parameter used for anything else in
 *   its callback (even harmlessly, such as `part.length`) or shadowed by an inner function's, and the helpers reached
 *   through an object (`u.chunks`).
 *
 * `.in` taken as a value rather than called at once (`q.in.call(…)`, `.apply`, `run(q.in)`, `const f = q['in']`,
 * `const { in: f } = q`) fires too, since the guard cannot follow where it is called. It fires on any property named
 * `in` read as a value, a query's or not: the data layer has no other, and the safe side costs nothing.
 *
 * Out of scope, named so a reader knows: a method reached by a computed key (`q[k](…)`) is not read, since the guard
 * cannot know `k` names `in`; check-web-reads.mjs holds each `.from()` read at once with `.select()`, so a query is
 * never handed to code that could filter it that way.
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

/** The functions a chunk's callback can be; a parameter bound by any other kind is never a chunk. */
/** @type {(n: ts.Node) => n is ts.ArrowFunction | ts.FunctionExpression} */
const isFunction = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n);
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

/** The node under any parentheses, casts, non-null marks and satisfies wrapped around it: the outermost of them. */
function outermost(node) {
  let n = node;
  while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isNonNullExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isTypeAssertionExpression(n.parent))) n = n.parent;
  return n;
}

/** True when an identifier is the list (the second argument) of an `.in()` call. */
function isInList(id) {
  const arg = outermost(id);
  const call = arg.parent;
  return ts.isCallExpression(call) && call.arguments[1] === arg && memberName(unwrap(call.expression)) === 'in';
}

/** The nearest function around an identifier that takes a parameter of its name, or null. */
function binder(id) {
  for (let n = id.parent; n; n = n.parent) {
    if (isFunction(n) && n.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === id.text)) return n;
  }
  return null;
}

/**
 * True when `list` is a chunk: the plain first parameter (no rest, no default) of a chunk's callback, and that
 * parameter is used nowhere in the callback but as the list of `.in()` calls. Any other use (declared or assigned
 * again, incremented, passed on, shadowed by an inner function's parameter) fires, without asking whether it is
 * harmless: the safe side, and a shape the data layer never needs.
 */
function isChunk(list) {
  const id = unwrap(list);
  if (!ts.isIdentifier(id)) return false;
  const fn = binder(id);
  if (!fn) return false;
  const [first] = fn.parameters;
  if (!first || !ts.isIdentifier(first.name) || first.name.text !== id.text || first.dotDotDotToken || first.initializer || !isChunkCallback(fn)) return false;
  let clean = true;
  const visit = (n) => {
    if (!clean) return;
    if (ts.isIdentifier(n) && n.text === id.text && n !== first.name && !isInList(n)) clean = false;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return clean;
}

/** Every `.in()` call in one file, with whether it is clean. */
function inCalls(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bounded = new Set(/** @type {readonly string[]} */ (BOUNDED_IN.map((b) => b.column)));
  const out = [];
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source));
  const visit = (node) => {
    /* `.in` taken as a value (`q.in.call(…)`, `const f = q['in']`, `const { in: f } = q`) is a read the guard cannot follow, so it fires. */
    const member = (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(node) === 'in';
    const callee = member ? outermost(node) : node;
    const taken = (member && !(ts.isCallExpression(callee.parent) && callee.parent.expression === callee))
      || (ts.isBindingElement(node) && node.propertyName !== undefined && (ts.isIdentifier(node.propertyName) || ts.isStringLiteral(node.propertyName)) && node.propertyName.text === 'in');
    if (taken) {
      const p = at(node);
      out.push({ file, line: p.line + 1, column: p.character + 1, clean: false });
    }
    if (ts.isCallExpression(node) && memberName(unwrap(node.expression)) === 'in') {
      const [column, list] = node.arguments;
      const col = column && (ts.isStringLiteral(column) || ts.isNoSubstitutionTemplateLiteral(column)) ? column.text : null;
      const clean = col !== null && (bounded.has(col) || (list !== undefined && isChunk(list)));
      const p = at(node);
      out.push({ file, line: p.line + 1, column: p.character + 1, clean });
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
