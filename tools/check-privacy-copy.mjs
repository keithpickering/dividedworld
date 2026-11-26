/**
 * Guard: the words a player reads in the engine and the instances never promise more privacy than the game gives.
 *
 *   node tools/check-privacy-copy.mjs
 *
 * The game hides a thing from every other player, and an admin can still see it. Copy that says "only you see this" or "nobody can see who
 * wrote this" is a promise the game does not keep, so it says "no other player" (the owner, 2026-11-26, #1145 and #1147; CLAUDE.md, "The
 * fiction may lie; the log never does", where the glass's copy never bluffs about how the game works; and instances/divided-world/voice/gabe.md,
 * section 5). The Strategy Guide is held to this by tools/check-guide.mjs. This check holds the rest of the copy to the same rule, with the
 * same detector: `privacyOverclaims`, imported from there, so there is one rule and not two that drift.
 *
 * Read: every `.ts` and `.tsx` file git tracks under `engine/`, `instances/` and `web/src/`, and only the text a player can read in it, as the
 * TypeScript parser finds it: a string literal (a label, an `aria-label`, a prop), the text of a template literal (a substitution is read as
 * one word, so "nobody ${x} sees it" is still found) and JSX text. A comment is never read, since it is for the author.
 *
 * Left out: `*.test.*` and `*.stories.*` files; `engine/ui/data/fake.ts`, the in-memory backend, whose refusal strings stand in for the
 * server's and are no copy of the game's; and `e2e/`, which is outside the three trees. What the detector does not catch is not caught: a
 * bare label such as "Only you", with no verb after it, is a choice of copy and the owner's to make, not this check's.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The detection is exported and pure so
 * tools/test-privacy-copy.mjs drives every branch red.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { privacyOverclaims } from './check-guide.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOTS = /^(?:engine|instances|web\/src)\//;
const SOURCE = /\.tsx?$/;
const LEFT_OUT = /\.(?:test|stories)\.[^/]+$|^engine\/ui\/data\/fake\.ts$/;

/** The tracked paths this check reads, from a list of paths. */
export function copyFiles(paths) {
  return paths.filter((p) => ROOTS.test(p) && SOURCE.test(p) && !LEFT_OUT.test(p));
}

/** Every tracked file this check reads, as `{path: source}`; empty when git cannot say, which the caller refuses. */
export function readTree() {
  const listed = execFileSync('git', ['ls-files', '-z', 'engine', 'instances', 'web/src'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 26 });
  const files = {};
  for (const p of copyFiles(listed.split('\0').filter(Boolean))) {
    if (fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  }
  return files;
}

/** The player-readable texts of one source, each with the line it starts on. */
function textsOf(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const add = (node, text) => out.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) add(node, node.head.text + node.templateSpans.map((s) => ' _ ' + s.literal.text).join(''));
    else if (ts.isJsxText(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The faults in `files` (`{path: source}`): each text that claims more privacy than the game gives, as `{file, line, why}`. */
export function copyFaults(files) {
  const faults = [];
  for (const [file, source] of Object.entries(files)) {
    for (const { text, line } of textsOf(file, source)) {
      for (const hit of privacyOverclaims(text)) {
        faults.push({ file, line, why: `"${hit}" claims more privacy than the game gives (an admin can see what is hidden from players): say "no other player" instead` });
      }
    }
  }
  return faults;
}

function main() {
  const files = readTree();
  /* A guard reading nothing would pass; the repository holds the engine, so an empty read is a broken read. */
  if (Object.keys(files).length === 0) {
    console.error('  privacy-copy: no source file was found under engine/, instances/ or web/src/, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = copyFaults(files);
  if (faults.length) {
    console.error(`  privacy-copy: ${faults.length} claim(s) of more privacy than the game gives:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.why}`);
    console.error('  What a player reads says "no other player", never "nobody" or "only you" (CLAUDE.md, "The fiction may lie; the log never does"; #1147).');
    process.exit(1);
  }
  console.log(`  privacy-copy: ${Object.keys(files).length} source file(s) read, no claim of more privacy than the game gives`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
