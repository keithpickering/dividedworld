/**
 * Guard: the engine never imports an instance, and no instance imports another.
 *
 *   node tools/check-engine-boundary.mjs
 *
 * "KayfaBB never knows which instance it runs." Until the engine has a repository of its
 * own, both layers live here side by side: engine/ is the engine, instances/<name>/ is each
 * instance's content, and supabase/functions/ is the composition root, the one place both
 * are imported. A crossing changes no test and no screen; the engine just starts knowing a
 * name it should not, and the day it moves out it will not build. So the line is read on
 * every build rather than trusted.
 *
 * Every way one file can name another is read from the TypeScript AST, not a regex: a static
 * import (type-only included: the engine may not know an instance's types either), a
 * re-export, a side-effect import, `import()`, an `import('…')` type, `require()`. A relative
 * specifier is resolved against its file; a bare one that names `instances` (a package.json
 * "imports" alias, a path mapping) fires as it stands. A dynamic import in engine/ whose
 * argument is not a plain string fires too, since it could name anything and the guard
 * cannot say it does not. Comments and strings are not imports, and the AST knows that
 * without help.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass.
 * The detection is exported and pure so tools/test-engine-boundary.mjs drives every branch
 * red on purpose.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** The files the guard reads. */
export const SOURCE = /^(engine|instances)\/.*\.(ts|mts|cts|tsx|js|mjs|cjs)$/;

/**
 * Every specifier a file names, with its line, and the dynamic imports it cannot read.
 * @param {string} file @param {string} text
 * @returns {{ spec: string | null, line: number }[]}
 */
function specifiers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  /** @type {{ spec: string | null, line: number }[]} */
  const out = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      out.push({ spec: literal(node.moduleSpecifier), line: lineOf(node) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      out.push({ spec: literal(node.moduleReference.expression), line: lineOf(node) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push({ spec: literal(node.arguments[0]), line: lineOf(node) });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length) {
      out.push({ spec: literal(node.arguments[0]), line: lineOf(node) });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      out.push({ spec: literal(node.argument.literal), line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** `instances/<name>` for a repository path inside an instance, else null. */
const instanceOf = (p) => p.match(/^instances\/([^/]+)(\/|$)/)?.[1] ?? null;

/**
 * Every crossing in a set of files, as `{ file, line, spec, target, why }`; [] is clean.
 * @param {Record<string, string>} files repository path to text
 */
export function boundaryFaults(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    if (!SOURCE.test(file)) continue;
    const inEngine = file.startsWith('engine/');
    const home = instanceOf(file);
    for (const { spec, line } of specifiers(file, text)) {
      if (spec === null) {
        if (inEngine) out.push({ file, line, spec: null, target: null, why: 'a dynamic import or require the guard cannot read, which could name an instance' });
        continue;
      }
      const relative = spec.startsWith('./') || spec.startsWith('../');
      const target = relative ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : null;
      if (inEngine) {
        if (target !== null && instanceOf(target) !== null) out.push({ file, line, spec, target, why: 'the engine imports an instance' });
        else if (target === null && /(^|[/#@])instances(\/|$)/.test(spec)) out.push({ file, line, spec, target: spec, why: 'the engine names instances/ through a bare specifier' });
      } else if (home !== null && target !== null) {
        const other = instanceOf(target);
        if (other !== null && other !== home) out.push({ file, line, spec, target, why: `instance ${home} imports instance ${other}` });
      }
    }
  }
  return out;
}

/** The tracked engine and instance sources, read from disk. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (SOURCE.test(p) && fs.existsSync(p)) files[p] = fs.readFileSync(p, 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  const faults = boundaryFaults(files);
  if (faults.length) {
    console.error(`  engine-boundary: ${faults.length} import(s) cross the line between the engine and an instance:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.spec === null ? '(unreadable)' : f.spec}  ${f.why}`);
    console.error('  The engine reaches an instance only through the Instance interface, which the composition root\n  (supabase/functions/) hands it. See CLAUDE.md, "KayfaBB never knows which instance it runs".');
    process.exit(1);
  }
  console.log(`  engine-boundary: ${Object.keys(files).length} engine and instance file(s), no crossing`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
