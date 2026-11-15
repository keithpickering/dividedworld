/**
 * Guard: an engine story names its card by key; it never takes the first of something.
 *
 *   node tools/check-story-picks.mjs
 *
 * A story that draws `instance.cards[0]`, or the first card with a skim, passes its own PR and turns red in a
 * later card build that does not edit it: a new card that is the new first of its kind changes the scene, and
 * the story's board and its e2e spec break in someone else's change. So a story names the card it means
 * (`cardOf(instance.cards, '4d-chess')`, from engine/ui/story.tsx) and the story fails, naming the key, when
 * the instance has none.
 *
 * What is read: every tracked `*.stories.tsx` and `*-world.ts` under engine/ and instances/, and
 * engine/ui/story.tsx. Test files are not read (a test builds its own cards), nor is any other file.
 *
 * What is refused: an instance's pool of cards is `X.cards` where the expression `X` ends in the identifier
 * `instance` or `ui` (`instance.cards`, `ui.cards`, `kayfa.instance.cards`, `kayfa.ui.cards`; parentheses,
 * `as` casts, `!` and `?.` are looked through), and `const { cards } = instance` (or `= ui`, or `({ cards } = instance)`) takes it too. The
 * pool may be used whole, and nothing else:
 *   - as an argument of a call (`cardOf(instance.cards, KEY)`, `facesOf(instance.cards, ui.cards, s)`);
 *   - as the iterable of a `for ... of`;
 *   - as the receiver of a called `.map`, `.forEach`, `.some` or `.every`;
 *   - spread into an array, or as an element of an array literal (a hook's dependency list).
 * Every other use is a fault: an index, a destructuring, `.find`, `.filter`, `.slice`, `.at`, `.length`, an
 * assignment to another name. A list of allowed uses was chosen over a list of refused ones because a refused
 * list misses the next way to take the first of something.
 *
 * What it cannot see:
 *   - a helper that receives the pool as a parameter and indexes its own parameter (`found(cards, scene)`
 *     with `cards.find(...)` inside). A story's helper takes a key, never the pool.
 *   - `.map(f)` followed by any pick (`.map(f)[0]`, `.map(f).find(g)`, `.map(f).filter(g)`), `[...instance.cards][0]`
 *     and `[instance.cards][0]`: the pool is used whole there, and what is picked from is a new array.
 *   - a parameter that destructures it (`({ cards }: I) => ...`): nothing says the parameter is an instance.
 *   - classes (`instance.classes[0]`), gear and any pool under another name (`const pool = ...` is refused at
 *     the assignment, but a pool handed in under a parameter is not followed).
 *   It reads no database, so "a test that builds its own subject" has nothing to say here.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The detection is
 * exported and pure so tools/test-story-picks.mjs drives every branch red on purpose.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files the guard reads: stories and worlds under engine/ and instances/, and the story helpers. */
export const READ = /^(?:(?:engine|instances)\/(?:.*\/)?[^/]*(?:\.stories\.tsx|-world\.ts)|engine\/ui\/story\.tsx)$/;

const POOL_OWNERS = new Set(['instance', 'ui']);
const WHOLE_RECEIVERS = new Set(['map', 'forEach', 'some', 'every']);

/** The expression with parentheses, `as`, `satisfies`, `<T>` casts and `!` looked through. */
function bare(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

/** @param {ts.Expression | undefined} a @returns {a is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral} */
const isString = (a) => a !== undefined && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a));

/** True when the expression ends in the name `instance` or `ui`, as an identifier, a property or a string index. */
function endsInOwner(node) {
  node = bare(node);
  if (ts.isIdentifier(node)) return POOL_OWNERS.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return POOL_OWNERS.has(node.name.text);
  if (ts.isElementAccessExpression(node)) {
    const a = node.argumentExpression;
    return isString(a) && POOL_OWNERS.has(a.text);
  }
  return false;
}

/** True for `X.cards` and `X['cards']` where X ends in instance or ui. */
function isPool(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'cards' && endsInOwner(node.expression);
  if (ts.isElementAccessExpression(node)) {
    const a = node.argumentExpression;
    return isString(a) && a.text === 'cards' && endsInOwner(node.expression);
  }
  return false;
}

/** The key a property name spells (`cards`, `'cards'`, `['cards']`), or null when it is not a plain one. */
function keyOf(name) {
  if (ts.isComputedPropertyName(name)) return isString(name.expression) ? name.expression.text : null;
  return ts.isIdentifier(name) || isString(name) ? name.text : null;
}

/** Whether the node is wrapped only in parentheses and casts up to its parent, and the outermost wrapper. */
function outer(node) {
  while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isSatisfiesExpression(node.parent)
    || ts.isTypeAssertionExpression(node.parent) || ts.isNonNullExpression(node.parent))) node = node.parent;
  return node;
}

/** What the pool is used for, in words, or null when the use is one of the allowed ones. */
function refusedUse(pool) {
  const n = outer(pool);
  const p = n.parent;
  if (ts.isCallExpression(p) && p.arguments.includes(n)) return null;
  if (ts.isForOfStatement(p) && p.expression === n) return null;
  if (ts.isSpreadElement(p) && ts.isArrayLiteralExpression(p.parent)) return null;
  if (ts.isArrayLiteralExpression(p)) return null;
  if (ts.isPropertyAccessExpression(p) && p.expression === n) {
    const call = p.parent;
    if (WHOLE_RECEIVERS.has(p.name.text) && ts.isCallExpression(call) && call.expression === p) return null;
    return `.${p.name.text} on the pool`;
  }
  if (ts.isElementAccessExpression(p) && p.expression === n) return 'an index into the pool';
  if (ts.isSpreadElement(p)) return 'the pool spread into a call';
  if (ts.isVariableDeclaration(p) && p.initializer === n) {
    return ts.isArrayBindingPattern(p.name) ? 'an array destructuring of the pool' : ts.isObjectBindingPattern(p.name) ? 'an object destructuring of the pool' : 'the pool assigned to another name';
  }
  if (ts.isBinaryExpression(p)) return 'the pool assigned or compared';
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return 'the pool returned';
  return `the pool used in a way the guard does not allow (${ts.SyntaxKind[p.kind]})`;
}

/**
 * Every pick of a card by place or by predicate in a set of files, as `{ path, line, use, message }`; [] is clean.
 * Files the guard does not read (tests, other sources) are skipped, so a caller may pass the whole tree.
 * @param {{ path: string, text: string }[]} files
 */
export function storyPickFaults(files) {
  const out = [];
  for (const { path: file, text } of files) {
    if (!READ.test(file)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const report = (node, use) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      out.push({
        path: file, line, use,
        message: `${file}:${line}  ${use}; pick the card by key: cardOf(instance.cards, '<key>') (engine/ui/story.tsx)`,
      });
    };
    const visit = (node) => {
      if (isPool(node)) {
        const use = refusedUse(node);
        if (use !== null) report(node, use);
      } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && endsInOwner(node.initializer)
        && node.name.elements.some((e) => keyOf(e.propertyName ?? e.name) === 'cards')) {
        report(node, 'an object destructuring of the instance that takes its cards');
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.left)
        && endsInOwner(node.right) && node.left.properties.some((e) => (ts.isShorthandPropertyAssignment(e) || ts.isPropertyAssignment(e)) && keyOf(e.name) === 'cards')) {
        report(node, 'an assignment destructuring of the instance that takes its cards');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

/** The tracked files the guard reads, from disk, as `{ path, text }`. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  return tree.filter((p) => READ.test(p) && fs.existsSync(path.join(repoRoot, p))).map((p) => ({ path: p, text: fs.readFileSync(path.join(repoRoot, p), 'utf8') }));
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass; the engine has stories, so an empty read is a broken read. */
  if (!files.some((f) => f.path.startsWith('engine/') && f.path.endsWith('.stories.tsx'))) {
    console.error('  story-picks: no engine story was read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = storyPickFaults(files);
  if (faults.length) {
    console.error(`  story-picks: ${faults.length} card(s) picked by place or by predicate, not by key:`);
    for (const f of faults) console.error(`    ${f.message}`);
    console.error('  A story names the card it means, so a new card cannot change it. Name the key in a constant at the top of the file and\n  look it up with cardOf (engine/ui/story.tsx). See docs/plans/2026-11-15-stories-by-key-design.md, section 4.');
    process.exit(1);
  }
  console.log(`  story-picks: ${files.length} story and world file(s), every card named by key`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
