/**
 * tools/test-hype.mjs, driven red on purpose: it must fail when its glob finds no test file, when a test file runs no test, and when
 * a test fails, and pass when a test passes. A runner that passes over nothing has only ever shown that it runs.
 *
 *   node tools/test-test-hype.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-hype.mjs');
const root = mkdtempSync(path.join(tmpdir(), 'test-hype-'));
let failures = 0;

/** @param {string} name @param {Record<string, string>} files @param {boolean} passes */
function expect(name, files, passes) {
  const dir = path.join(root, name);
  mkdirSync(dir);
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
  const r = spawnSync(process.execPath, [runner, `${dir}/*.test.mjs`], { encoding: 'utf8' });
  const ok = (r.status === 0) === passes;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: expected ${passes ? 'pass' : 'refusal'}, exit ${r.status}`);
}

const test = (/** @type {string} */ body) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('t', () => { ${body} });\n`;
expect('empty-directory', {}, false);
expect('file-with-no-tests', { 'a.test.mjs': 'export {};\n' }, false);
expect('failing-test', { 'a.test.mjs': test('assert.equal(1, 2)') }, false);
expect('every-test-skipped', { 'a.test.mjs': "import { test } from 'node:test';\ntest.skip('t', () => {});\n" }, false);
expect('every-test-todo', { 'a.test.mjs': "import { test } from 'node:test';\ntest.todo('t');\n" }, false);
expect('one-skipped-one-passing', { 'a.test.mjs': "import { test } from 'node:test';\ntest.skip('s', () => {});\ntest('t', () => {});\n" }, true);
expect('passing-test', { 'a.test.mjs': test('assert.equal(1, 1)') }, true);
rmSync(root, { recursive: true, force: true });
if (failures) {
  console.error(`${failures} failure(s) in test-test-hype`);
  process.exit(1);
}
