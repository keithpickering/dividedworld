/**
 * Tests for the guard in tools/check-web-bundle.mjs.
 *
 *   node tools/test-web-bundle.mjs
 *
 * The guard fails a production build that carries the in-memory backend's marker, and a build that
 * never ran. This builds nothing: each case writes a scratch folder and runs the check over it,
 * through its function and through the command, whose exit code is what the build reads. The marker
 * split across two chunks is not a case, because the check reads each file whole and a bundler
 * never cuts inside a string literal.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleFaults, MARKER } from './check-web-bundle.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-web-bundle.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bundle-'));
let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

/** A scratch dist with these files (path to text). */
function dist(name, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

try {
  /* ---- the plan's poisons ---- */
  {
    const dir = dist('poisoned', {
      'index.html': '<!doctype html><script src="/assets/index.js"></script>',
      'assets/index.js': 'console.log("app")',
      'assets/fake-Cx81.js': `export default { marker: "${MARKER}" }`,
    });
    const r = bundleFaults(dir);
    check('a chunk holding the marker is named', r.carrying.length === 1 && r.carrying[0] === 'assets/fake-Cx81.js', JSON.stringify(r));
    const c = run(dir);
    check('and the command exits 1 and prints the file', c.status === 1 && c.stderr.includes('assets/fake-Cx81.js') && !c.stderr.includes('assets/index.js'), c.stderr);
  }
  {
    const dir = dist('two', { 'a.js': `x${MARKER}y`, 'nested/b.js': MARKER, 'c.js': 'clean' });
    const r = bundleFaults(dir);
    check('every file carrying it is named, not only the first', r.carrying.join() === 'a.js,nested/b.js', JSON.stringify(r));
  }
  {
    const dir = path.join(root, 'empty');
    fs.mkdirSync(dir);
    const c = run(dir);
    check('an empty dist fails as nothing built', c.status === 1 && /nothing built/.test(c.stderr), `${c.status} ${c.stderr}`);
  }
  {
    const c = run(path.join(root, 'never-made'));
    check('a missing dist fails as nothing built', c.status === 1 && /nothing built/.test(c.stderr), `${c.status} ${c.stderr}`);
  }

  /* ---- what stays clean ---- */
  {
    const dir = dist('clean', { 'index.html': '<html></html>', 'assets/index.js': 'console.log("KAYFA_FAKE")', 'assets/logo.png': 'PNG' });
    const r = bundleFaults(dir);
    const c = run(dir);
    check('a build without the marker (a near miss included) is clean and reads every file', r.carrying.length === 0 && r.files.length === 3 && c.status === 0, JSON.stringify(r));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n  web-bundle: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-web-bundle: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
