/**
 * The camera finds Playwright's headless shell wherever this machine put it: a browsers folder holds `chromium_headless_shell-<build>`,
 * and under it one folder per platform holds the executable. Each test builds a folder shaped like one layout and asks for the path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHeadlessShell, browserRoots, jpegSize, checkFrameSize } from './camera.mjs';

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

/* A JPEG's size is in its first start-of-frame segment: FF C0..CF (but C4, C8, CC), then length, precision, height, width. */
const jpeg = (/** @type {number} */ w, /** @type {number} */ h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03]);

test('a frame`s size is read from the picture itself', () => {
  assert.deepEqual(jpegSize(jpeg(2880, 1620)), { width: 2880, height: 1620 });
  assert.deepEqual(jpegSize(jpeg(1440, 810)), { width: 1440, height: 810 });
  assert.equal(jpegSize(Buffer.from([1, 2, 3])), null);
});

test('a frame that is not css x scale is refused: a film at double density must not be a picture blown up', () => {
  assert.doesNotThrow(() => checkFrameSize(jpeg(2880, 1620), { width: 1440, height: 810 }, 2));
  assert.throws(() => checkFrameSize(jpeg(1440, 810), { width: 1440, height: 810 }, 2), /1440 x 810.*2880 x 1620/);
});
