/**
 * Tests for the guard in tools/check-gear-art.mjs.
 *
 *   node tools/test-gear-art.mjs
 *
 * The guard fails a gear folder (instances/<name>/ui/gear/<key>/, docs/plans/2026-11-23-rendered-gear-design.md, section 3,
 * and docs/plans/2026-11-23-rendered-gear-plan.md, Task 5) whose views.json is missing, is not JSON, is oversize or is
 * wrong in its default, its views or its geometry; whose pictures do not match the views it lists (a view with no file or
 * two, a picture for no listed view); a WebP that is the wrong size, over 1024 pixels, without alpha, animated or oversize;
 * an SVG whose viewBox disagrees or that runs or reaches out; and a flat `ui/gear/<key>.svg` of the old layout. This reads
 * no file in the repository: each case writes a repository-shaped scratch folder in os.tmpdir() and runs the check over it
 * through its function and through the command, whose exit code is what the build reads.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gearArtFaults } from './check-gear-art.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-gear-art.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-art-'));
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

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const SVG = (inner = '', box = '0 0 64 32') => `<svg ${NS} viewBox="${box}">${inner}<rect width="64" height="32"/></svg>`;

// Real WebP images, made once with Pillow (libwebp) and held as base64: 64 by 32 lossy with an alpha channel (a "VP8X"
// file with an "ALPH" chunk), the same without one (a plain "VP8 " file), and 2000 by 10 lossy with alpha.
const b64 = (s) => Buffer.from(s, 'base64');
const WEBP_ALPHA = b64('UklGRogAAABXRUJQVlA4WAoAAAAQAAAAPwAAHwAAQUxQSBUAAAABD/DA/4iIIBZM5i8dQm9E/6MKvgEAVlA4IEwAAADQAwCdASpAACAAPm0ylUckIyIhLBqoAIANiWMAxyKAAECMVfCI+gAA/u1N3/G7LOHB7/9cB/84D/5wH8t6iXsouG8tfGYj4sfQAAAA');
const WEBP_OPAQUE = b64('UklGRjQAAABXRUJQVlA4ICgAAAAQAwCdASpAACAAPm02mEikIyKhJAgAgA2JaQAAJmh9iPAA/tA4AAAA');
const WEBP_WIDE = b64('UklGRsQAAABXRUJQVlA4WAoAAAAQAAAAzwcACQAAQUxQSBgAAAABD/DA/4iIIKYh9C8tgdci+j8BttN+MgBWUDgghgAAANAKAJ0BKtAHCgA+bTaaSaQjIqEgiACADYlpbuF0m9BPgGgA+QAACg0flgjYgqOe2IvEFRz2xF4gqOe2IvEFRz2xDye2xF4gqOe2IvEFRz2xF4gqOe2IvEFRz2xF4gEAAP7+QMavw5lUg/9cB8EXlHfZnngAA9Pxu/2l3LBsn69E4WgAAAAA');
/** A copy of a buffer with `edit(copy)` applied. */
const altered = (buf, edit) => {
  const c = Buffer.from(buf);
  edit(c);
  return c;
};

const view = (width = 64, height = 32, pivot = { x: 32, y: 16 }) => ({ width, height, pivot });
/** A views.json text for the views named, each at 64 by 32 with its pivot in the middle. */
const manifest = (names, def = names[0]) => JSON.stringify({ default: def, views: Object.fromEntries(names.map((n) => [n, view()])) });

let n = 0;
/**
 * A repository-shaped folder with one clean gear folder (one SVG view, `front`), then `poison(files, flat)` applied:
 * `files` maps a name in the gear folder to its content (a string or a Buffer), or to null for no file; `flat` maps a
 * name directly in ui/gear/ to its content.
 * @param {(files: Record<string, string | Buffer | null>, flat: Record<string, string>) => void} [poison]
 */
function repo(poison = () => {}) {
  /** @type {Record<string, string | Buffer | null>} */
  const files = { 'views.json': manifest(['front']), 'front.svg': SVG() };
  /** @type {Record<string, string>} */
  const flat = {};
  poison(files, flat);
  const dir = path.join(root, `r${n++}`);
  const gear = path.join(dir, 'instances/demo/ui/gear');
  const item = path.join(gear, 'demo-cap');
  fs.mkdirSync(item, { recursive: true });
  for (const [f, body] of Object.entries(files)) if (body !== null) fs.writeFileSync(path.join(item, f), body);
  for (const [f, body] of Object.entries(flat)) fs.writeFileSync(path.join(gear, f), body);
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });

/** One poison: the function names it (matching `want`), and the command exits 1 saying so. */
function red(name, poison, want) {
  const dir = repo(poison);
  const faults = gearArtFaults(dir);
  check(name, faults.some((f) => want.test(f)), JSON.stringify(faults));
  const c = run(dir);
  check('  and the command exits 1 naming it', c.status === 1 && want.test(c.stderr), `${c.status} ${c.stderr}`);
}
/** A folder that must pass. */
function green(name, poison) {
  const dir = repo(poison);
  const faults = gearArtFaults(dir);
  check(name, faults.length === 0, JSON.stringify(faults));
  const c = run(dir);
  check('  and the command exits 0', c.status === 0, `${c.status} ${c.stderr}`);
}
/** The files of an item with the views named, as WebP of `buf`. */
const webps = (names, def, buf = WEBP_ALPHA) => (f) => {
  f['front.svg'] = null;
  f['views.json'] = manifest(names, def);
  for (const v of names) f[`${v}.webp`] = buf;
};
/** Edit the views.json of the clean folder. */
const edit = (mutate) => (f) => {
  const m = JSON.parse(f['views.json']);
  mutate(m);
  f['views.json'] = JSON.stringify(m);
};

try {
  green('a folder with one SVG view has no fault', () => {});
  green('a folder with three WebP views, a model.blend and a rig input beside them has no fault', (f) => {
    webps(['front', 'three-quarter-left', 'three-quarter-right'], 'three-quarter-right')(f);
    f['model.blend'] = Buffer.from('BLENDER-v405 not a picture');
    f.rig = 'not read';
  });
  {
    const none = path.join(root, 'no-instances');
    fs.mkdirSync(none);
    check('a repository with no instances has no fault', gearArtFaults(none).length === 0);
    const dir = path.join(root, 'empty');
    fs.mkdirSync(path.join(dir, 'instances/demo/ui/gear/__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'instances/demo/ui/gear/__pycache__/rig.pyc'), 'x');
    check('a folder named as no key could be (__pycache__) is not read', gearArtFaults(dir).length === 0, JSON.stringify(gearArtFaults(dir)));
  }

  /* ---- (1) views.json ---- */
  red('no views.json', (f) => { f['views.json'] = null; }, /views\.json.*missing/);
  red('a views.json that is not JSON', (f) => { f['views.json'] = '{default:'; }, /views\.json.*not JSON/);
  red('a views.json over 2 KB', (f) => { f['views.json'] = JSON.stringify({ ...JSON.parse(manifest(['front'])), note: 'x'.repeat(3000) }); }, /views\.json.*2 KB/);
  red('a default that is not among the views', edit((m) => { m.default = 'side-left'; }), /views\.json.*default.*side-left/);
  red('a view named back', (f) => { f['views.json'] = manifest(['front', 'back']); f['back.svg'] = SVG(); }, /views\.json.*back.*not one of the five/);
  red('a views object with no view', (f) => { f['views.json'] = JSON.stringify({ default: 'front', views: {} }); }, /views\.json.*views.*at least one/);
  red('a views.json that is a list', (f) => { f['views.json'] = '[]'; }, /views\.json.*object/);

  /* ---- (2) the pictures match the listed views ---- */
  red('a listed view with no file', (f) => { f['views.json'] = manifest(['front', 'side-left']); }, /side-left.*no side-left\.webp or side-left\.svg/);
  red('a view with both files', (f) => { f['front.webp'] = WEBP_ALPHA; }, /front.*both/);
  red('a front.webp that is not listed', (f) => { f['views.json'] = manifest(['side-left']); f['side-left.svg'] = SVG(); f['front.svg'] = null; f['front.webp'] = WEBP_ALPHA; }, /front\.webp.*not listed/);
  red('a picture named for no view', (f) => { f['hero.webp'] = WEBP_ALPHA; }, /hero\.webp.*names no view/);
  red('an svg for a view that is not listed', (f) => { f['side-right.svg'] = SVG(); }, /side-right\.svg.*not listed/);

  /* ---- (3) geometry ---- */
  red('a pivot at width + 1', edit((m) => { m.views.front.pivot.x = 65; }), /front.*pivot\.x/);
  red('a pivot at height + 1', edit((m) => { m.views.front.pivot.y = 33; }), /front.*pivot\.y/);
  red('a pivot below 0', edit((m) => { m.views.front.pivot.x = -1; }), /front.*pivot\.x/);
  red('a width that is not a whole number', edit((m) => { m.views.front.width = 64.5; }), /front.*width/);
  red('a height of 0', edit((m) => { m.views.front.height = 0; }), /front.*height/);
  green('a pivot on the far corner (at width and height) is within the picture', edit((m) => { m.views.front.pivot = { x: 64, y: 32 }; }));

  /* ---- (4) a WebP ---- */
  green('a one-view WebP of 64 by 32 with alpha', webps(['front']));
  red('a WebP whose size disagrees with views.json', (f) => { webps(['front'])(f); f['views.json'] = JSON.stringify({ default: 'front', views: { front: view(65, 32) } }); }, /front\.webp.*is 64 by 32.*65 by 32/);
  red('a 2000 by 10 WebP (over 1024)', (f) => { webps(['front'], 'front', WEBP_WIDE)(f); f['views.json'] = JSON.stringify({ default: 'front', views: { front: view(2000, 10, { x: 1000, y: 5 }) } }); }, /front\.webp.*1024/);
  red('a WebP with no alpha', webps(['front'], 'front', WEBP_OPAQUE), /front\.webp.*alpha/);
  red('the alpha WebP with its animation flag set', webps(['front'], 'front', altered(WEBP_ALPHA, (c) => { c[20] |= 2; })), /front\.webp.*animated/);
  red('a WebP padded past 200 KB', webps(['front'], 'front', Buffer.concat([WEBP_ALPHA, Buffer.alloc(201 * 1024)])), /front\.webp.*200 KB/);
  red('a PNG named front.webp', webps(['front'], 'front', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])), /front\.webp.*is not a WebP image$/m);

  /* ---- (5) an SVG ---- */
  green('an SVG view whose viewBox is its size, at any origin', (f) => { f['front.svg'] = SVG('', '10 20 64 32'); });
  red('an SVG whose viewBox disagrees', (f) => { f['front.svg'] = SVG('', '0 0 64 33'); }, /front\.svg.*viewBox/);
  red('an SVG with no viewBox', (f) => { f['front.svg'] = `<svg ${NS}/>`; }, /front\.svg.*viewBox/);
  red('an SVG with a <script>', (f) => { f['front.svg'] = SVG('<script>alert(1)</script>'); }, /front\.svg.*<script/i);
  red('an SVG with an onload', (f) => { f['front.svg'] = SVG('<g onload="x()"/>'); }, /front\.svg.*onload/i);
  red('an SVG with a url( to elsewhere', (f) => { f['front.svg'] = SVG('<rect fill="url(https://example.com/a#b)"/>'); }, /front\.svg.*url\(/);
  red('an SVG over 50 KB', (f) => { f['front.svg'] = SVG(`<!--${'a'.repeat(51 * 1024)}-->`); }, /front\.svg.*50 KB/);

  /* ---- (6) the old layout ---- */
  red('a flat ui/gear/cap.svg', (_f, flat) => { flat['cap.svg'] = SVG(); }, /gear\/cap\.svg.*old layout.*gear\/<key>\//);
  green('a file that is not an svg directly in ui/gear/ (a README) is not the old layout', (_f, flat) => { flat['README.md'] = 'notes'; });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n  gear art: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-gear-art: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
