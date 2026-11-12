/**
 * Guard: a screen reads one clock, the backend's.
 *
 *   node tools/check-one-clock.mjs
 *
 * The screens compare times the data layer hands them (an Act's date, a play's end, a ban's expiry) with "now". If "now" is the page's own
 * `Date.now()` while the backend's times come from its own clock (the fake's stands in October 2026), a test passes on the day it was written
 * and fails when the calendar date meets the fixtures' (issue #244: thirteen tests, on 2026-11-12). So a screen asks `api.now()` (engine/ui/data/api.ts),
 * which the real backend answers with the real clock and the fake with its own, and a pure helper is given `now` by its caller.
 *
 * Read: every non-test, non-story `.ts`/`.tsx` under engine/ui, from the TypeScript AST. A call of `Date.now()` or `new Date()` with no argument, or a `Date.now` passed on as a value,
 * is a read of the page's clock. It must be in WALL_CLOCK, which lists the files that read it for a reason that is not a data time (a timer's
 * length, a cache's age, an id), each with how many reads and why; a file reading more than listed, or a listed file reading fewer (a stale
 * entry), fails. tools/test-one-clock.mjs drives it red on a planted call. A test that must set the real clock shifts it instead:
 * `KAYFA_TEST_SHIFT_DAYS` in web/test-setup.ts.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCREEN_SOURCE = /^engine\/ui\/.*\.tsx?$/;
const NOT_SCREEN = /\.test\.tsx?$|\.stories\.tsx?$/;

/**
 * The wall-clock reads that stay, by file: how many, and why none compares a time from the data.
 * @type {Readonly<Record<string, { count: number; why: string }>>}
 */
export const WALL_CLOCK = {
  'engine/ui/router.tsx': { count: 8, why: 'navigation ids, the age of a cached page and of a prefetch, and how long a load took: durations on the page\'s own timers' },
  'engine/ui/player.tsx': { count: 4, why: 'how long an estimate stays fresh, counted from receipt (the header says so): elapsed time between two reads of the same clock' },
  'engine/ui/spin/spun.ts': { count: 1, why: 'the spun loader\'s cache age (SPUN_TTL_MS), `Date.now` passed as its `now`: elapsed time between two reads of the same clock, compared with no data time' },
  'engine/ui/alerts/Toasts.tsx': { count: 2, why: 'the time a toast has left on its own countdown, which pauses under a pointer: elapsed time' },
};

/** Each no-argument `Date.now()` / `new Date()` (also via `globalThis.` / `window.`) and each bare `Date.now` value in a source text, with its line. */
export function clockReads(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  /* `Date`, `globalThis.Date` or `window.Date`. */
  const isDate = (e) => (ts.isIdentifier(e) && e.text === 'Date')
    || (ts.isPropertyAccessExpression(e) && e.name.text === 'Date' && ts.isIdentifier(e.expression) && (e.expression.text === 'globalThis' || e.expression.text === 'window'));
  const isDateNow = (e) => ts.isPropertyAccessExpression(e) && e.name.text === 'now' && isDate(e.expression);
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 0 && isDateNow(node.expression)) out.push({ line: at(node), what: 'Date.now()' });
    /* A bare `Date.now` that is not a call's callee (handed on as a callback) is the same read, made later. */
    else if (isDateNow(node) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) out.push({ line: at(node), what: 'Date.now (as a value)' });
    else if (ts.isNewExpression(node) && isDate(node.expression) && (node.arguments?.length ?? 0) === 0) out.push({ line: at(node), what: 'new Date()' });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every fault: a read in a file that does not list it, a file reading more than it lists, and a listed file reading fewer.
 * @param {Record<string, string>} files tracked path to text
 */
export function clockFaults(files, allowed = WALL_CLOCK) {
  const faults = [];
  const seen = new Map();
  for (const [p, t] of Object.entries(files)) {
    if (!SCREEN_SOURCE.test(p) || NOT_SCREEN.test(p)) continue;
    const reads = clockReads(t, p);
    seen.set(p, reads.length);
    const room = allowed[p]?.count ?? 0;
    if (reads.length > room) for (const r of reads.slice(room)) faults.push({ file: p, line: r.line, what: r.what, kind: 'read' });
  }
  for (const [p, entry] of Object.entries(allowed)) {
    if ((seen.get(p) ?? 0) < entry.count) faults.push({ file: p, line: 0, what: `lists ${entry.count} read(s) and has ${seen.get(p) ?? 0}`, kind: 'stale' });
  }
  return faults;
}

export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (SCREEN_SOURCE.test(p) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass. */
  if (!Object.keys(files).some((f) => f === 'engine/ui/router.tsx')) {
    console.error('  one-clock: engine/ui/router.tsx was not read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = clockFaults(files);
  if (faults.length) {
    console.error(`  one-clock: ${faults.length} fault(s) in the screens' clock:`);
    for (const f of faults) console.error(`    ${f.file}${f.line ? `:${f.line}` : ''}  ${f.what}${f.kind === 'stale' ? ' (update WALL_CLOCK)' : ''}`);
    console.error('  A screen compares a time from the data with `api.now()` (useKayfa), and a pure helper is given `now`. Only a wall-clock read that compares no data time is listed in WALL_CLOCK (tools/check-one-clock.mjs), with why.');
    process.exit(1);
  }
  console.log(`  one-clock: ${Object.keys(files).length} file(s), no screen reads the page's clock beyond the ${Object.keys(WALL_CLOCK).length} listed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
