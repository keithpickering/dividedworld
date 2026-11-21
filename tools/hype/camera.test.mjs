/**
 * The camera finds Playwright's headless shell wherever this machine put it: a browsers folder holds `chromium_headless_shell-<build>`,
 * and under it one folder per platform holds the executable. Each test builds a folder shaped like one layout and asks for the path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHeadlessShell, browserRoots } from './camera.mjs';

const make = (...parts) => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-camera-test-'));
  const file = join(dir, ...parts);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
  return { dir, file };
};

test('the Linux layout: chrome-headless-shell under a platform folder', () => {
  const { dir, file } = make('chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  assert.equal(findHeadlessShell([dir], 'linux'), file);
});

test('the older Linux name: headless_shell', () => {
  const { dir, file } = make('chromium_headless_shell-1000', 'chrome-linux', 'headless_shell');
  assert.equal(findHeadlessShell([dir], 'linux'), file);
});

test('the Windows layout: the executable ends in .exe', () => {
  const { dir, file } = make('chromium_headless_shell-1200', 'chrome-win', 'headless_shell.exe');
  assert.equal(findHeadlessShell([dir], 'win32'), file);
});

test('the newest build wins', () => {
  const { dir } = make('chromium_headless_shell-1000', 'chrome-linux', 'headless_shell');
  const newer = join(dir, 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  mkdirSync(join(newer, '..'), { recursive: true });
  writeFileSync(newer, '');
  assert.equal(findHeadlessShell([dir], 'linux'), newer);
});

test('builds are ordered by number, not by spelling', () => {
  const { dir } = make('chromium_headless_shell-999', 'chrome-linux', 'headless_shell');
  const newer = join(dir, 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  mkdirSync(join(newer, '..'), { recursive: true });
  writeFileSync(newer, '');
  assert.equal(findHeadlessShell([dir], 'linux'), newer);
});

test('roots are tried in order, and a missing root is skipped', () => {
  const { dir, file } = make('chromium_headless_shell-1243', 'x', 'chrome-headless-shell');
  assert.equal(findHeadlessShell([join(dir, 'nowhere'), dir], 'linux'), file);
});

test('an executable of the other platform is not found', () => {
  const { dir } = make('chromium_headless_shell-1200', 'chrome-win', 'headless_shell.exe');
  assert.throws(() => findHeadlessShell([dir], 'linux'));
});

test('none found: the error names every place looked', () => {
  const a = mkdtempSync(join(tmpdir(), 'kb-camera-test-'));
  const b = join(a, 'missing');
  assert.throws(() => findHeadlessShell([a, b], 'linux'), (/** @type {Error} */ e) => e.message.includes(a) && e.message.includes(b));
});

test('the roots, in order: PLAYWRIGHT_BROWSERS_PATH, /opt/pw-browsers, LOCALAPPDATA, ~/.cache', () => {
  const roots = browserRoots({ PLAYWRIGHT_BROWSERS_PATH: '/p', LOCALAPPDATA: '/l' }, '/h');
  assert.deepEqual(roots, ['/p', '/opt/pw-browsers', join('/l', 'ms-playwright'), join('/h', '.cache', 'ms-playwright')]);
  assert.deepEqual(browserRoots({}, '/h'), ['/opt/pw-browsers', join('/h', '.cache', 'ms-playwright')]);
});
