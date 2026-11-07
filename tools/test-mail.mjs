/**
 * Tests for the guard in tools/check-mail.mjs.
 *
 *   node tools/test-mail.mjs
 *
 * The guard fails an instance whose email images, fonts, record, committed Auth templates or colors are
 * not what the glass-mail design says (docs/plans/2026-11-07-glass-mail-plan.md, Task 4). This reads no
 * file in the repository: each case writes a repository-shaped scratch folder (an instance's ui/ with
 * glass.json, icon/coin.svg, fonts/ and public/mail/, its mail/ with a theme and assets.json, a stand-in
 * composition root for the Auth templates, and supabase/templates/) from bytes made here, and runs the
 * check over it through its function and through the command, whose exit code is what the build reads.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadRoot, mailFaults } from './check-mail.mjs';
import { canonicalJson, sha256, sourceSlices } from './mail-assets.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-mail.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-'));
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

/* ---------------------------------------------------------------- byte writers ---- */

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

/** An RGBA PNG of `width` by `height`, opaque unless `hole` names a pixel and its alpha. */
/** @param {number} width @param {number} height @param {{ seed?: number, hole?: { x: number, y: number, alpha: number } }} [opts] */
function png(width, height, { seed = 0, hole } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const o = 1 + x * 4;
      row[o] = (x * 37 + seed) & 0xff;
      row[o + 1] = (y * 59 + seed) & 0xff;
      row[o + 2] = (x * y + 11) & 0xff;
      row[o + 3] = hole && hole.x === x && hole.y === y ? hole.alpha : 255;
    }
    rows.push(row);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** A JPEG's markers (SOI, a baseline SOF0 saying `width` by `height`, EOI), then `pad` bytes after the end. */
function jpeg(width, height, pad = 0) {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9]), Buffer.alloc(pad, 7)]);
}

/* ---------------------------------------------------------------- a scratch repository ---- */

const THEME_COLORS = {
  ground: '#101018', field: '#1c1c2a', text: '#f0f0f0', text2: '#c8c8d0', hi: '#ffffff', pale: '#dddddd',
  neon: '#00e5ff', neonText: '#5ff0ff', violet: '#b8a0ff', ink: '#000000',
};
const FONTS = ['Anton-Regular.woff2', 'BarlowCondensed-Medium.woff2', 'BarlowCondensed-SemiBold.woff2', 'BarlowCondensed-Bold.woff2'];
const GLASS = {
  keys: { standard: { '--kb-glass-ground': { value: '#101018' }, '--kb-glass-field': { value: '#1c1c2a' }, '--kb-glass-neon': { value: '#00e5ff' } } },
  smoke: { field: { layers: [{ seed: 1, scale: 3 }, { seed: 2, scale: 5 }] }, recipes: { page: { colors: [{ color: '#808080', opacity: 0.3 }, { color: '#606070', opacity: 0.2 }] } } },
};
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>');
const TEMPLATES = [
  { path: 'supabase/templates/sign-in.html', html: '<html><body>Your code is {{ .Token }}</body></html>' },
  { path: 'supabase/templates/sign-up.html', html: '<html><body>Confirm at {{ .ConfirmationURL }}</body></html>' },
];

const ui = 'instances/demo/ui';
const mail = 'instances/demo/mail';

/**
 * A repository-shaped folder with one clean instance, then `poison(files, made)` applied. `files` maps a
 * path under the folder to its bytes (a string or Buffer), or null for no file. The record is made from the
 * files before the poison, unless the poison rewrites it. `made.theme` and `made.glass` are the objects
 * the clean files came from; a poison that changes one rewrites its file itself.
 */
/** @param {string} name @param {(files: Record<string, any>, made: any) => void} [poison] */
function repo(name, poison = () => {}) {
  const theme = { name: 'Demo', colors: { ...THEME_COLORS }, fonts: FONTS.map((f) => ({ url: `https://demo.example/mail/fonts/${f}` })) };
  const glass = JSON.parse(JSON.stringify(GLASS));
  const fonts = Object.fromEntries(FONTS.map((f) => [f, Buffer.from(`font bytes of ${f}`)]));
  const images = { 'smoke.jpg': jpeg(1200, 360, 1000), 'cut-panel.png': png(24, 24), 'cut-button.png': png(24, 24, { seed: 5 }), 'coin.png': png(80, 80, { seed: 9 }) };
  const outputs = Object.fromEntries(Object.entries(images).map(([k, v]) => [k, sha256(v)]));
  const sources = { 'icon/coin.svg': sha256(SVG) };
  for (const f of FONTS) {
    outputs[`fonts/${f}`] = sha256(fonts[f]);
    sources[`fonts/${f}`] = sha256(fonts[f]);
  }
  for (const [k, text] of Object.entries(sourceSlices(glass))) sources[k] = sha256(Buffer.from(text));
  const record = { outputs, sources };
  const files = {
    [`${ui}/glass.json`]: JSON.stringify(glass),
    [`${ui}/icon/coin.svg`]: SVG,
    [`${mail}/index.ts`]: `export const mailTheme = ${JSON.stringify(theme)};\n`,
    [`${mail}/assets.json`]: JSON.stringify(record, null, 2) + '\n',
    'supabase/functions/_shared/mail/auth.ts': `export function authTemplates() { return ${JSON.stringify(TEMPLATES)}; }\n`,
  };
  for (const [k, v] of Object.entries(images)) files[`${ui}/public/mail/${k}`] = v;
  for (const f of FONTS) {
    files[`${ui}/fonts/${f}`] = fonts[f];
    files[`${ui}/public/mail/fonts/${f}`] = fonts[f];
  }
  for (const t of TEMPLATES) files[t.path] = t.html;
  poison(files, { theme, glass, fonts, images, record });
  const dir = path.join(root, name);
  for (const [f, bytes] of Object.entries(files)) {
    if (bytes === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), bytes);
  }
  return dir;
}

const faultsOf = async (dir) => (await loadRoot(dir)).flatMap((args) => mailFaults(args));
const run = (dir) => spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });
const themeFile = (theme) => `export const mailTheme = ${JSON.stringify(theme)};\n`;

/** One poison: the function names it (matching `want`), and the command exits 1 saying so. */
async function red(name, poison, want) {
  const dir = repo(name.replace(/\W+/g, '-'), poison);
  const faults = await faultsOf(dir);
  const hit = faults.some((f) => want.test(f));
  check(name, hit, JSON.stringify(faults));
  const c = run(dir);
  check('  and the command exits 1 naming it', c.status === 1 && want.test(c.stderr), `${c.status} ${c.stderr}`);
}

try {
  /* ---- clean ---- */
  {
    const dir = repo('clean');
    const faults = await faultsOf(dir);
    check('a clean instance has no fault', faults.length === 0, JSON.stringify(faults));
    const c = run(dir);
    check('  and the command exits 0', c.status === 0, `${c.status} ${c.stderr}`);
  }

  /* ---- (1) a file missing ---- */
  await red('a missing coin.png is named', (f) => { f[`${ui}/public/mail/coin.png`] = null; }, /public[\\/]mail[\\/]coin\.png.*missing/);
  await red('a missing font is named', (f) => { f[`${ui}/public/mail/fonts/${FONTS[1]}`] = null; }, new RegExp(`${FONTS[1]}.*missing`));

  /* ---- (2) the images ---- */
  await red('a smoke.jpg of 1200 by 300', (f) => { f[`${ui}/public/mail/smoke.jpg`] = jpeg(1200, 300); }, /smoke\.jpg.*1200x300.*1200x360/);
  await red('a smoke.jpg padded to 61KB', (f) => { f[`${ui}/public/mail/smoke.jpg`] = jpeg(1200, 360, 61 * 1024); }, /smoke\.jpg.*over/);
  await red('a smoke.jpg that is not a JPEG', (f) => { f[`${ui}/public/mail/smoke.jpg`] = png(1200, 360); }, /smoke\.jpg.*not a JPEG/);
  await red('a corner with one pixel at alpha 254', (f) => { f[`${ui}/public/mail/cut-panel.png`] = png(24, 24, { hole: { x: 12, y: 23, alpha: 254 } }); }, /cut-panel\.png.*alpha|cut-panel\.png.*opaque/);
  await red('a corner of 25 by 25', (f) => { f[`${ui}/public/mail/cut-button.png`] = png(25, 25); }, /cut-button\.png.*25x25.*24x24/);
  await red('a coin of 80 by 80 with a transparent pixel', (f) => { f[`${ui}/public/mail/coin.png`] = png(80, 80, { hole: { x: 0, y: 0, alpha: 0 } }); }, /coin\.png.*opaque/);

  /* ---- (3) the fonts are the ui's ---- */
  await red('a font with one byte changed', (f, { fonts }) => {
    const b = Buffer.from(fonts[FONTS[0]]);
    b[3] ^= 1;
    f[`${ui}/public/mail/fonts/${FONTS[0]}`] = b;
  }, new RegExp(`fonts[\\\\/]${FONTS[0]}.*differs from.*ui[\\\\/]fonts`));

  /* ---- (4) the record ---- */
  await red('the page recipe\'s opacity changed after the record was written', (f, { glass }) => {
    glass.smoke.recipes.page.colors[0].opacity = 0.31;
    f[`${ui}/glass.json`] = JSON.stringify(glass);
  }, /smoke\.recipes\.page.*assets\.json.*make-mail-assets\.mjs/);
  await red('the field layers changed after the record was written', (f, { glass }) => {
    glass.smoke.field.layers[1].scale = 6;
    f[`${ui}/glass.json`] = JSON.stringify(glass);
  }, /smoke\.field\.layers.*assets\.json.*make-mail-assets\.mjs/);
  await red('coin.svg changed after the record was written', (f) => { f[`${ui}/icon/coin.svg`] = Buffer.from('<svg/>'); }, /coin\.svg.*assets\.json.*make-mail-assets\.mjs/);
  await red('coin.png replaced after the record was written', (f) => { f[`${ui}/public/mail/coin.png`] = png(80, 80, { seed: 1 }); }, /assets\.json.*coin\.png.*make-mail-assets\.mjs/);
  await red('a missing assets.json', (f) => { f[`${mail}/assets.json`] = null; }, /assets\.json.*missing/);

  /* ---- (5) the committed templates ---- */
  await red('a committed template with one word changed', (f) => { f[TEMPLATES[0].path] = TEMPLATES[0].html.replace('code', 'cove'); }, /sign-in\.html.*differs.*check-mail\.mjs --write/);
  await red('a missing committed template', (f) => { f[TEMPLATES[1].path] = null; }, /sign-up\.html.*missing/);

  /* ---- (6) Gmail's clip ---- */
  {
    const fat = TEMPLATES[0].html + '<!--' + 'x'.repeat(102400) + '-->';
    await red('a rendered email padded past 100KB', (f) => {
      f['supabase/functions/_shared/mail/auth.ts'] = `export function authTemplates() { return ${JSON.stringify([{ path: TEMPLATES[0].path, html: fat }, TEMPLATES[1]])}; }\n`;
      f[TEMPLATES[0].path] = fat;
    }, /sign-in\.html.*102400/);
  }

  /* ---- (7) the colors ---- */
  await red('text2 darkened to fail 4.5:1 on field', (f, { theme }) => {
    theme.colors.text2 = '#6a6a88';
    f[`${mail}/index.ts`] = themeFile(theme);
  }, /text2.*field.*4\.5/);
  await red('ink on neon failing 4.5:1', (f, { theme }) => {
    theme.colors.ink = '#40e0f0';
    f[`${mail}/index.ts`] = themeFile(theme);
  }, /ink.*neon.*4\.5/);

  /* ---- (8) the masthead name on the smoke ---- */
  await red('the name color darkened to fail 3:1 on the smoke\'s worst', (f, { theme }) => {
    theme.colors.text = '#505058';
    f[`${mail}/index.ts`] = themeFile(theme);
  }, /masthead.*smoke.*3:1/);

  /* ---- the glass written in another key order is the same glass ---- */
  {
    const dir = repo('reordered', (f, { glass }) => {
      const flip = (o) => (Array.isArray(o) ? o.map(flip) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).reverse().map((k) => [k, flip(o[k])])) : o);
      f[`${ui}/glass.json`] = JSON.stringify(flip(glass));
    });
    const faults = await faultsOf(dir);
    check('a glass.json with its keys in another order is clean', faults.length === 0, JSON.stringify(faults));
  }

  /* ---- --write ---- */
  {
    const dir = repo('write', (f) => { f[TEMPLATES[0].path] = 'stale'; f[TEMPLATES[1].path] = null; });
    const c = spawnSync(process.execPath, [script, '--root', dir, '--write'], { encoding: 'utf8' });
    check('--write writes the templates, then the check is clean', c.status === 0 && fs.readFileSync(path.join(dir, TEMPLATES[0].path), 'utf8') === TEMPLATES[0].html && fs.existsSync(path.join(dir, TEMPLATES[1].path)), `${c.status} ${c.stderr}`);
  }

  /* ---- no instance has a mail/ folder ---- */
  {
    const dir = repo('no-instance');
    fs.rmSync(path.join(dir, mail), { recursive: true });
    const c = run(dir);
    check('no instance with a mail/ folder exits 1 naming it', c.status === 1 && /no instance has a mail\/ folder/.test(c.stderr), `${c.status} ${c.stderr}`);
  }

  /* ---- the readers ---- */
  check('canonicalJson sorts keys (the record hashes the same whichever order)', canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }) === '{"a":[{"c":2,"d":1}],"b":1}');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n  mail: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-mail: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
