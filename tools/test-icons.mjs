/**
 * Tests for the guard in tools/check-icons.mjs, and for the ICO and PNG reading in tools/icons.mjs.
 *
 *   node tools/test-icons.mjs
 *
 * The guard fails a site whose icons are missing, malformed, not made from their sources, or not
 * what the build served (docs/plans/2026-11-02-favicon-plan.md, Task 1). This reads no file in the
 * repository: each case writes a repository-shaped scratch folder (an instance's icon/ and
 * public/, web/index.html, web/dist/) from bytes made here, with writeIco and a small PNG writer of
 * the test's own, and runs the check over it through its function and through the command, whose
 * exit code is what the build reads.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { iconFaults } from './check-icons.mjs';
import { pngInfo, pngOpaque, pngSamples, readIco, writeIco } from './icons.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-icons.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
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

/* ---------------------------------------------------------------- a PNG writer ---- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * A PNG of `width` by `height` whose samples are `pixel(x, y)` (an array of `channels` values),
 * each row written with `filter` (0 to 4), or with filter `y % 5` when filter is 'each'.
 */
function png({ width, height, colorType = 6, bitDepth = 8, interlace = 0, filter = 0, pixel, extra = [] }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const stride = width * channels;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) pixel(x, y).forEach((v, k) => { line[x * channels + k] = v; });
    const f = filter === 'each' ? y % 5 : filter;
    const out = Buffer.alloc(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      out[i + 1] = (line[i] - pred) & 0xff;
    }
    rows.push(out);
    prev = line;
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** An RGBA square whose colors vary by pixel, opaque unless `hole` names a pixel and its alpha. */
const square = (size, { seed = 0, hole } = {}) => png({
  width: size,
  height: size,
  filter: 'each',
  pixel: (x, y) => [(x * 37 + seed) & 0xff, (y * 59 + seed) & 0xff, (x * y + 11) & 0xff, hole && hole.x === x && hole.y === y ? hole.alpha : 255],
});

/** A transparent-rimmed sprite like the owner's: alpha 0 at the corners. */
const sprite = (seed = 1) => png({ width: 16, height: 16, pixel: (x, y) => [x * 16, y * 16, seed, (x === 0 || y === 0) ? 0 : 255] });

/* ---------------------------------------------------------------- a scratch repository ---- */

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>');
const INDEX = '<!doctype html><html><head><title>X</title>\n<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />\n<link rel="apple-touch-icon" href="/apple-touch-icon.png" />\n</head><body></body></html>';

/**
 * A repository-shaped folder with one instance whose icons are clean, then `poison(files)` applied:
 * `files` maps a path under the folder to its bytes (a string or Buffer), or to null for no file.
 * The record is written from the files before the poison, unless the poison rewrites it.
 */
function repo(name, poison = () => {}) {
  const coin16 = sprite();
  const ico = writeIco([coin16, square(32), square(48)]);
  const apple = square(180, { seed: 3 });
  const record = {
    sources: { 'coin-16.png': sha(coin16), 'coin.svg': sha(SVG) },
    outputs: { 'apple-touch-icon.png': sha(apple), 'favicon.ico': sha(ico) },
  };
  const ui = 'instances/demo/ui';
  const files = {
    [`${ui}/icon/coin-16.png`]: coin16,
    [`${ui}/icon/coin.svg`]: SVG,
    [`${ui}/icon/icons.json`]: JSON.stringify(record, null, 2) + '\n',
    [`${ui}/public/favicon.ico`]: ico,
    [`${ui}/public/apple-touch-icon.png`]: apple,
    'web/index.html': INDEX,
    'web/dist/index.html': INDEX,
    'web/dist/favicon.ico': ico,
    'web/dist/apple-touch-icon.png': apple,
  };
  poison(files, { ui, coin16, apple, record });
  const dir = path.join(root, name);
  for (const [f, bytes] of Object.entries(files)) {
    if (bytes === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), bytes);
  }
  fs.mkdirSync(path.join(dir, 'web', 'dist'), { recursive: true });
  return dir;
}

const faultsOf = (dir) => iconFaults({
  instanceUi: [path.join(dir, 'instances/demo/ui')],
  indexHtml: path.join(dir, 'web/index.html'),
  dist: path.join(dir, 'web/dist'),
});
const run = (dir) => spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });

/** One poison: the function names it (matching `want`), and the command exits 1 saying so. */
function red(name, poison, want) {
  const dir = repo(name.replace(/\W+/g, '-'), poison);
  const faults = faultsOf(dir);
  const hit = faults.some((f) => want.test(f));
  check(name, hit, JSON.stringify(faults));
  if (hit) {
    const c = run(dir);
    check(`  and the command exits 1 naming it`, c.status === 1 && want.test(c.stderr), `${c.status} ${c.stderr}`);
  }
}

try {
  /* ---- clean ---- */
  {
    const dir = repo('clean');
    const faults = faultsOf(dir);
    check('a clean instance and site have no fault', faults.length === 0, JSON.stringify(faults));
    const c = run(dir);
    check('  and the command exits 0', c.status === 0, `${c.status} ${c.stderr}`);
  }

  /* ---- (1) a file missing ---- */
  red('a missing icons.json is named', (f, { ui }) => { f[`${ui}/icon/icons.json`] = null; }, /icons\.json.*missing/);
  red('a missing apple-touch-icon.png is named', (f, { ui }) => { f[`${ui}/public/apple-touch-icon.png`] = null; }, /public\/apple-touch-icon\.png.*missing/);

  /* ---- (2) the ICO's images ---- */
  red('an ICO with only 16 and 32', (f, { ui, coin16 }) => { f[`${ui}/public/favicon.ico`] = writeIco([coin16, square(32)]); }, /favicon\.ico.*16, 32, 48/);
  red('an ICO whose 32px entry holds a 31px PNG', (f, { ui, coin16 }) => {
    const ico = writeIco([coin16, square(31), square(48)]);
    ico[6 + 16] = 32; ico[6 + 16 + 1] = 32; // the directory says 32; the PNG is 31
    f[`${ui}/public/favicon.ico`] = ico;
  }, /favicon\.ico.*32x32.*31x31/);
  red('a BMP image in an ICO', (f, { ui, coin16 }) => {
    const bmp = Buffer.concat([Buffer.from([40, 0, 0, 0]), Buffer.alloc(36 + 48 * 48 * 4)]);
    const ico = writeIco([coin16, square(32), square(48)]);
    const dir = ico.subarray(0, 6 + 48);
    dir.writeUInt32LE(bmp.length, 6 + 32 + 8);
    const offset = dir.readUInt32LE(6 + 32 + 12);
    f[`${ui}/public/favicon.ico`] = Buffer.concat([dir, ico.subarray(6 + 48, offset), bmp]);
  }, /favicon\.ico.*not a PNG/);
  red('a file that is not an ICO', (f, { ui }) => { f[`${ui}/public/favicon.ico`] = Buffer.from('<!doctype html><html></html>'); }, /favicon\.ico.*not an ICO/);

  /* ---- (3) the 16px image is the sprite ---- */
  red('an ICO whose 16px image is not coin-16.png byte for byte', (f, { ui }) => {
    f[`${ui}/public/favicon.ico`] = writeIco([sprite(2), square(32), square(48)]);
  }, /16px image.*coin-16\.png/);

  /* ---- (4) the home-screen icon ---- */
  red('a 180px apple icon with one pixel at alpha 254', (f, { ui }) => {
    f[`${ui}/public/apple-touch-icon.png`] = square(180, { seed: 3, hole: { x: 90, y: 179, alpha: 254 } });
  }, /apple-touch-icon\.png.*alpha/);
  red('a 192px apple icon', (f, { ui }) => { f[`${ui}/public/apple-touch-icon.png`] = square(192); }, /apple-touch-icon\.png.*192x192.*180/);

  /* ---- (5) the record ---- */
  red('coin-16.png changed after the record was written', (f, { ui }) => {
    const changed = sprite(9);
    f[`${ui}/icon/coin-16.png`] = changed;
    /* The ICO follows the sprite, so only the record is stale. */
    f[`${ui}/public/favicon.ico`] = writeIco([changed, square(32), square(48)]);
  }, /coin-16\.png.*icons\.json.*make-icons\.mjs/);
  red('coin.svg changed after the record was written', (f, { ui }) => { f[`${ui}/icon/coin.svg`] = Buffer.from('<svg/>'); }, /coin\.svg.*icons\.json.*make-icons\.mjs/);
  red('favicon.ico replaced after the record was written', (f, { ui, coin16 }) => {
    const ico = writeIco([coin16, square(32, { seed: 5 }), square(48)]);
    f[`${ui}/public/favicon.ico`] = ico;
    f['web/dist/favicon.ico'] = ico;
  }, /favicon\.ico.*icons\.json.*make-icons\.mjs/);

  /* ---- (6) the page names them ---- */
  red('an index.html without the icon link', (f) => { f['web/index.html'] = INDEX.replace(/<link rel="icon"[^>]*>/, ''); }, /index\.html.*rel="icon"/);
  red('an index.html without the apple-touch link', (f) => { f['web/index.html'] = INDEX.replace(/<link rel="apple-touch-icon"[^>]*>/, ''); }, /index\.html.*rel="apple-touch-icon"/);

  /* ---- (7) the build served them ---- */
  red('a dist whose favicon.ico differs from the instance\'s', (f, { coin16 }) => { f['web/dist/favicon.ico'] = writeIco([coin16, square(32, { seed: 8 }), square(48)]); }, /dist\/favicon\.ico.*not.*public/);
  red('a dist without apple-touch-icon.png', (f) => { f['web/dist/apple-touch-icon.png'] = null; }, /dist\/apple-touch-icon\.png.*missing/);
  red('an empty dist', (f) => { for (const k of Object.keys(f)) if (k.startsWith('web/dist/')) f[k] = null; }, /nothing built/);

  /* ---- the reader's own refusals ---- */
  const throws = (fn, want) => { try { fn(); return false; } catch (e) { return want.test(String(e.message)); } };
  check('a palette PNG is refused by name', throws(() => pngOpaque(png({ width: 4, height: 4, colorType: 3, pixel: () => [0] })), /palette/));
  check('a 16-bit PNG is refused by name', throws(() => pngOpaque(png({ width: 2, height: 2, bitDepth: 16, pixel: () => [0, 0, 0, 0, 0, 0, 0, 0] })), /bit depth 16/));
  check('an interlaced PNG is refused by name', throws(() => pngOpaque(png({ width: 4, height: 4, interlace: 1, pixel: () => [0, 0, 0, 255] })), /interlaced/));
  check('a PNG with a tRNS color is refused by name', throws(() => pngOpaque(png({ width: 2, height: 2, colorType: 2, pixel: () => [1, 2, 3], extra: [chunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3]))] })), /tRNS/));
  check('a file that is not an ICO is refused by name', throws(() => readIco(Buffer.from('GIF89a')), /not an ICO/));
  {
    const ico = writeIco([square(16)]);
    ico.writeUInt32LE(9999, 6 + 8);
    check('an ICO entry running past the file is refused by name', throws(() => readIco(ico), /runs past the file/));
  }

  /* ---- the five row filters, each undone right ---- */
  for (const filter of [0, 1, 2, 3, 4]) {
    const opaque = png({ width: 9, height: 7, filter, pixel: (x, y) => [x * 29, y * 31, (x + y) * 13, 255] });
    const holed = png({ width: 9, height: 7, filter, pixel: (x, y) => [x * 29, y * 31, (x + y) * 13, x === 5 && y === 4 ? 200 : 255] });
    check(`filter ${filter}: an opaque RGBA image reads opaque`, pngOpaque(opaque) === true);
    check(`filter ${filter}: one pixel at alpha 200 reads not opaque`, pngOpaque(holed) === false);
    const ga = png({ width: 5, height: 5, colorType: 4, filter, pixel: (x, y) => [x * 50 + y, 255] });
    check(`filter ${filter}: an opaque gray-alpha image reads opaque`, pngOpaque(ga) === true);
  }
  /*
   * Each filter undone to the exact samples written. Opacity alone cannot show every wrong undoing
   * (on an opaque image the alpha predictor's neighbors are all 255, so a Paeth tie broken the
   * wrong way never shows), so the samples are compared whole, on values from 0 to 3, where the
   * predictor's ties are common.
   */
  for (const filter of [0, 1, 2, 3, 4, 'each']) {
    let state = 7;
    const next = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return (state >> 16) & 3; };
    const want = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let k = 0; k < 4; k++) want.push(next());
    const img = png({ width: 16, height: 16, filter, pixel: (x, y) => want.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4) });
    const got = pngSamples(img).samples;
    check(`filter ${filter}: the samples read back exactly as written`, got.equals(Buffer.from(want)));
  }
  check('an RGB image with no alpha reads opaque outright', pngOpaque(png({ width: 3, height: 3, colorType: 2, pixel: () => [1, 2, 3] })) === true);

  /* ---- writeIco and readIco round-trip, 256 written as 0 ---- */
  {
    const big = square(256);
    const ico = writeIco([square(16), big]);
    const imgs = readIco(ico);
    check('writeIco writes a 256px side as 0, and readIco reads it back as 256', ico[6 + 16] === 0 && imgs[1].width === 256 && imgs[1].bytes.equals(big) && pngInfo(imgs[0].bytes).width === 16);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n  icons: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-icons: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
