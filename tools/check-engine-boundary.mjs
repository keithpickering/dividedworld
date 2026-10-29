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
 * A stylesheet (.css) is read too, for `@import` and `url()`, so a theme cannot cross by CSS.
 *
 * Every way one file can name another is read from the TypeScript AST, not a regex: a static
 * import (type-only included: the engine may not know an instance's types either), a
 * re-export, a side-effect import, `import()`, an `import('…')` type, `require()`,
 * `import.meta.resolve()` and a triple-slash reference. A relative
 * specifier is resolved against its file; a bare or absolute one is read as it stands, so one
 * that names `instances` (a package.json "imports" alias, a path mapping) fires in the engine,
 * and one that names another instance fires in an instance. A dynamic import in engine/ whose
 * argument is not a plain string fires too, since it could name anything and the guard
 * cannot say it does not. Comments and strings are not imports, and the AST knows that
 * without help.
 *
 * An engine file may also reach an instance by the filesystem, with no import: `readdirSync(join(cwd, 'instances'))`.
 * A string literal whose path segments include `instances`, among the arguments of an fs or path call (readdirSync,
 * readFileSync, existsSync, join, resolve, …) or of `new URL`, fires in engine/.
 *
 * `import.meta.glob(…)` names files too (Vite reads it): its pattern, or every pattern of an array, is a
 * specifier, relative to its file, so a glob over `../../instances/*` fires in engine/ as an import does.
 *
 * A file outside both layers can carry the engine to an instance: an engine file that imports
 * `.storybook/preview.tsx` (which imports the instance) depends on the instance as surely as one that
 * imports it directly. So each relative import in engine/ that leaves both layers is followed, through
 * the files it reaches (any tracked source), until it reaches instances/ (a crossing, reported on the
 * engine file with the chain), reaches engine/ again (that file is checked on its own), or leaves the
 * tree. Following was chosen over forbidding engine/ from importing `.storybook/` and `web/`: the
 * rule is "the engine never reaches an instance", and a ban on two directories names two places the
 * route happens to pass through today.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass.
 * The detection is exported and pure so tools/test-engine-boundary.mjs drives every branch
 * red on purpose.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files the guard checks. */
export const SOURCE = /^(engine|instances)\/.*\.(ts|mts|cts|tsx|js|mjs|cjs|css)$/;
/** The files it may read while following an import out of engine/: any source in the tree. */
export const FOLLOWED = /\.(ts|mts|cts|tsx|js|mjs|cjs|css)$/;

/**
 * A stylesheet with its comments blanked to spaces, so lines keep their numbers. Strings are
 * skipped whole, so a `/*` inside `content: "/*"` opens no comment; an unclosed comment runs to
 * the end, as a browser reads it.
 * @param {string} text
 */
function cssWithoutComments(text) {
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

/**
 * Every specifier a stylesheet names, with its line: `@import "x"`, `@import url(x)`, every
 * `url(x)` and every string in an `image-set()`, in any case, comments stripped first. A `data:`
 * URL names no file, and a `#fragment` names a part of the same document. A theme is a
 * stylesheet, so a stylesheet can cross the line as an import can.
 * @param {string} text
 * @returns {{ spec: string | null, line: number }[]}
 */
function cssSpecifiers(text) {
  const bare = cssWithoutComments(text);
  /** @type {{ spec: string | null, line: number }[]} */
  const out = [];
  const lineAt = (i) => bare.slice(0, i).split('\n').length;
  const unquote = (s) => s.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  const keep = (spec, at) => { if (!/^(data:|#)/i.test(spec)) out.push({ spec, line: lineAt(at) }); };
  for (const m of bare.matchAll(/url\(\s*("[^"]*"|'[^']*'|[^)]*?)\s*\)/gi)) keep(unquote(m[1]), m.index);
  for (const m of bare.matchAll(/@import\s*(["'])([^"']*)\1/gi)) keep(m[2], m.index);
  for (const m of bare.matchAll(/image-set\(([^)]*(?:\([^)]*\)[^)]*)*)\)/gi)) {
    for (const q of m[1].matchAll(/(["'])([^"']*)\1/g)) keep(q[2], m.index);
  }
  return out;
}

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
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'resolve'
      && ts.isMetaProperty(node.expression.expression) && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
      out.push({ spec: literal(node.arguments[0]), line: lineOf(node) });
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^glob(Eager)?$/.test(node.expression.name.text)
      && ts.isMetaProperty(node.expression.expression) && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isArrayLiteralExpression(arg)) for (const el of arg.elements) out.push({ spec: literal(el), line: lineOf(node) });
      else out.push({ spec: literal(arg), line: lineOf(node) });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      out.push({ spec: literal(node.argument.literal), line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const ref of source.referencedFiles) out.push({ spec: ref.fileName.startsWith('.') ? ref.fileName : `./${ref.fileName}`, line: source.getLineAndCharacterOfPosition(ref.pos).line + 1 });
  return out;
}

/** The calls that read the filesystem or build a path: a string argument naming `instances` among them is the engine reaching an instance by fs. */
const FS_CALLS = new Set(['readdirSync', 'readFileSync', 'existsSync', 'statSync', 'readdir', 'readFile', 'stat', 'access', 'opendirSync', 'globSync', 'join', 'resolve']);

/**
 * Where the engine names an instance's directory to the filesystem: a string literal (or a template's
 * text) whose `/`-separated segments include `instances`, among the arguments of a call to an fs or path
 * function or of `new URL`. A nested call is read on its own visit, so each literal fires once.
 * @param {string} file @param {string} text
 * @returns {{ spec: string, line: number }[]}
 */
function fsInstanceReaches(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const named = (s) => s.split(/[\\/]/).includes('instances');
  const scan = (node, report) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (named(node.text)) report(node, node.text); return; }
    if (ts.isTemplateExpression(node)) {
      for (const t of [node.head, ...node.templateSpans.map((x) => x.literal)]) if (named(t.text)) report(node, t.text);
    }
    ts.forEachChild(node, (c) => scan(c, report));
  };
  const visit = (node) => {
    const callee = ts.isCallExpression(node) ? node.expression : null;
    const fname = callee === null ? null : ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && !ts.isMetaProperty(callee.expression) ? callee.name.text : null;
    const isUrl = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL';
    if ((fname !== null && FS_CALLS.has(fname)) || isUrl) {
      for (const arg of node.arguments ?? []) {
        scan(arg, (at, str) => out.push({ spec: str, line: source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1 }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** `instances/<name>` for a repository path inside an instance, else null. */
const instanceOf = (p) => p.match(/^instances\/([^/]+)(\/|$)/)?.[1] ?? null;

/** The specifiers of any source file, stylesheets included. */
const specsOf = (file, text) => (file.endsWith('.css') ? cssSpecifiers(text) : specifiers(file, text));

/** The repository path a relative specifier names from `file`, or null for a bare or absolute one. */
function resolveRelative(file, spec, css) {
  const relative = spec.startsWith('./') || spec.startsWith('../') || (css && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(spec));
  return relative ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : null;
}

/** The tracked file a repository path names (exact, with an extension, or a directory's index), or null. */
function tracked(files, target) {
  const tries = [target, ...['.ts', '.tsx', '.mjs', '.js', '.css'].map((e) => target + e), ...['ts', 'tsx', 'mjs', 'js'].map((e) => `${target}/index.${e}`)];
  return tries.find((t) => Object.hasOwn(files, t) && FOLLOWED.test(t)) ?? null;
}

/**
 * The chain from `start` (a file outside both layers) to an instance, as `a -> b -> instances/x`, or
 * null when it reaches none. Stops at engine/ (checked on its own), at a path outside the tree, and
 * at a file it has seen.
 */
function reachesInstance(files, start, seen) {
  if (seen.has(start)) return null;
  seen.add(start);
  for (const { spec } of specsOf(start, files[start])) {
    if (spec === null) continue;
    const target = resolveRelative(start, spec, start.endsWith('.css'));
    const named = target === null ? spec.match(/(?:^|[/#@])instances(?:\/([^/]+)|$)/) : null;
    if (target === null) { if (named) return `${start} -> ${spec}`; continue; }
    if (target.startsWith('..')) continue;
    if (instanceOf(target) !== null) return `${start} -> ${target}`;
    if (target.startsWith('engine/')) continue;
    const next = tracked(files, target);
    if (next === null) continue;
    const rest = reachesInstance(files, next, seen);
    if (rest !== null) return `${start} -> ${rest}`;
  }
  return null;
}

/**
 * Every crossing in a set of files, as `{ file, line, spec, target, why }`; [] is clean. `files`
 * holds the engine and instance sources, and any other source an engine import may lead through.
 * @param {Record<string, string>} files repository path to text
 */
export function boundaryFaults(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    if (!SOURCE.test(file)) continue;
    const inEngine = file.startsWith('engine/');
    const home = instanceOf(file);
    if (inEngine && !file.endsWith('.css')) {
      for (const { spec, line } of fsInstanceReaches(file, text)) out.push({ file, line, spec, target: spec, why: 'the engine reaches an instance through the filesystem (a path argument naming instances); read it in the composition root (web/) instead' });
    }
    for (const { spec, line } of specsOf(file, text)) {
      if (spec === null) {
        if (inEngine) out.push({ file, line, spec: null, target: null, why: 'a dynamic import, glob or require the guard cannot read, which could name an instance' });
        continue;
      }
      /* A stylesheet's url(x) with no ./ is relative too, as a browser reads it; a scheme or // is not a file here. */
      const target = resolveRelative(file, spec, file.endsWith('.css'));
      /* A bare or absolute specifier is read as it stands: the instance it names, if any. */
      const named = target === null ? spec.match(/(?:^|[/#@])instances(?:\/([^/]+)|$)/) : null;
      if (inEngine) {
        if (target !== null && instanceOf(target) !== null) out.push({ file, line, spec, target, why: 'the engine imports an instance' });
        else if (named) out.push({ file, line, spec, target: spec, why: 'the engine names instances/ through a bare or absolute specifier' });
        else if (target !== null && !target.startsWith('engine/') && !target.startsWith('..')) {
          const next = tracked(files, target);
          const chain = next === null ? null : reachesInstance(files, next, new Set());
          if (chain !== null) out.push({ file, line, spec, target, why: `the engine reaches an instance through a file outside both layers: ${file} -> ${chain}` });
        }
      } else if (home !== null) {
        const other = target !== null ? instanceOf(target) : (named?.[1] ?? null);
        if (other !== null && other !== home) out.push({ file, line, spec, target: target ?? spec, why: `instance ${home} imports instance ${other}` });
      }
    }
  }
  return out;
}

/** The tracked sources, read from disk: the engine's and the instances', and the rest that an engine import may lead through. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (FOLLOWED.test(p) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass; the engine is never empty, so an empty read is a broken read. */
  const checked = Object.keys(files).filter((f) => SOURCE.test(f));
  if (!checked.some((f) => f.startsWith('engine/'))) {
    console.error('  engine-boundary: no engine file was read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = boundaryFaults(files);
  if (faults.length) {
    console.error(`  engine-boundary: ${faults.length} import(s) cross the line between the engine and an instance:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.spec === null ? '(unreadable)' : f.spec}  ${f.why}`);
    console.error('  The engine reaches an instance only through the Instance interface, which the composition root\n  (supabase/functions/) hands it. See CLAUDE.md, "KayfaBB never knows which instance it runs".');
    process.exit(1);
  }
  console.log(`  engine-boundary: ${checked.length} engine and instance file(s), no crossing`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
