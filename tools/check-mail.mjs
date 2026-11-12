/**
 * Guard: an instance's email assets and Auth templates are there, are what the design says they are, were
 * made from the glass, and are what the composition root renders.
 *
 *   node tools/check-mail.mjs [--write] [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-07-glass-mail-design.md. An instance with a `mail/` folder holds its email
 * theme (`mail/index.ts`) and the record of how its baked images were made (`mail/assets.json`, written by
 * tools/make-mail-assets.mjs); the images and fonts are in `ui/public/mail/`, which the web build serves at
 * `/mail/`. The composition root's `authTemplates()` (supabase/functions/_shared/mail/auth.ts) renders the two
 * Supabase Auth emails, committed as `supabase/templates/*.html`. It fails, naming the file and what it found,
 * when:
 *
 * 1. one of the four images (smoke.jpg, cut-panel.png, cut-button.png, coin.png) or one of the theme's fonts is
 *    missing from `ui/public/mail/`;
 * 2. smoke.jpg is not a 1200 by 360 JPEG, or is over 60KB (61440 bytes); a corner is not a 24 by 24 opaque PNG;
 *    coin.png is not 80 by 80 and opaque (a transparent pixel is filled black by some clients);
 * 3. a font in `ui/public/mail/fonts/` differs from its namesake in `ui/fonts/`;
 * 4. a hash in assets.json differs from its file or from its source (the canonical slice of glass.json, the
 *    coin vector, the fonts), saying `node tools/make-mail-assets.mjs <ui>` makes the assets again;
 * 5. a committed `supabase/templates/*.html` differs from what `authTemplates()` writes (`--write` writes them,
 *    then checks, as tools/check-glass-contrast.mjs --write does);
 * 6. a rendered email is over 102400 bytes, where Gmail clips it;
 * 7. the theme's text colors (text, text2, hi, neonText and violet, the last as label text) are under 4.5:1
 *    against `ground` or against `field`, or `ink` is under 4.5:1 on `neon`;
 * 8. the masthead name's color (`text`, as engine/mail/render.ts writes it) is under 3:1 against the `page`
 *    recipe's full worst, read with tools/check-glass-contrast.mjs's `recipeWorsts` and `contrastRatio`, never
 *    a second model of the smoke;
 * 9. a committed or rendered Auth template holds `{{ .ConfirmationURL }}`, or its button's href (the first link in
 *    the email) is not exactly `{{ .RedirectTo }}#token_hash={{ .TokenHash }}`: Auth's redirect carries the
 *    player's `next` in its query, and the hash stays in the fragment, which no server sees.
 *
 * `mailFaults` is exported and pure over what it is handed (shapes at its definition), so tools/test-mail.mjs
 * drives each fault red. `loadRoot` reads a repository root into those arguments; `--root` points it at a
 * scratch folder, as tools/check-icons.mjs does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contrastRatio, recipeWorsts } from './check-glass-contrast.mjs';
import { pngInfo, pngOpaque } from './icons.mjs';
import { CORNER, COIN, SMOKE, sha256, sourceSlices } from './mail-assets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where Gmail clips a message, in bytes. */
export const GMAIL_CLIP = 102400;
const IMAGES = ['smoke.jpg', 'cut-panel.png', 'cut-button.png', 'coin.png'];
const TEMPLATE_PATH = /^supabase\/templates\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.html$/;
/** The button's href in both Auth emails: Auth's own redirect for the request, then the token's hash in the fragment. */
const AUTH_LINK = '{{ .RedirectTo }}#token_hash={{ .TokenHash }}';
const TEXT_COLORS = ['text', 'text2', 'hi', 'neonText', 'violet'];

/** A JPEG's `{ width, height }` from its first SOF marker, or null if it is not a JPEG or has none. */
export function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return i + 9 <= b.length ? { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) } : null;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * The faults of one instance, as strings naming the file and what was found.
 *
 * - `ui`: `{ path, glass, coinSvg, fonts, mail }`: the ui folder's path, its parsed glass.json (or null), its
 *   icon/coin.svg (Buffer or null), `fonts` as `{ file: Buffer }` from `ui/fonts/`, and `mail` as
 *   `{ relativePath: Buffer }` for everything under `ui/public/mail/` (fonts as `fonts/<file>`).
 * - `mailDir`: `{ path, theme, record }`: the instance's mail/ folder, its `mailTheme`, and its parsed
 *   assets.json (or null if missing).
 * - `templates`: `[{ path, text }]`, each committed template (text null where the file is missing).
 * - `rendered`: `[{ path, html }]`, what `authTemplates()` writes.
 */
export function mailFaults({ ui, mailDir, templates, rendered }) {
  const out = [];
  const at = (rel) => path.join(ui.path, 'public', 'mail', rel);
  const theme = mailDir.theme;
  const fontFiles = [...new Set((theme?.fonts ?? []).map((f) => path.posix.basename(new URL(f.url).pathname)))].sort();
  const remake = `run  node tools/make-mail-assets.mjs ${ui.path}  to make the assets again`;

  /* 1 */
  const present = {};
  for (const name of [...IMAGES, ...fontFiles.map((f) => `fonts/${f}`)]) {
    if (ui.mail[name]) present[name] = ui.mail[name];
    else out.push(`${at(name)}: missing`);
  }

  /* 2 */
  const smoke = present['smoke.jpg'];
  if (smoke) {
    const size = jpegSize(smoke);
    if (!size) out.push(`${at('smoke.jpg')}: not a JPEG`);
    else if (size.width !== SMOKE.width || size.height !== SMOKE.height) out.push(`${at('smoke.jpg')}: is ${size.width}x${size.height}, must be ${SMOKE.width}x${SMOKE.height}`);
    if (smoke.length > SMOKE.maxBytes) out.push(`${at('smoke.jpg')}: is ${smoke.length} bytes, over ${SMOKE.maxBytes}`);
  }
  const png = (name, side) => {
    const b = present[name];
    if (!b) return;
    try {
      const info = pngInfo(b);
      if (info.width !== side || info.height !== side) out.push(`${at(name)}: is ${info.width}x${info.height}, must be ${side}x${side}`);
      if (!pngOpaque(b)) out.push(`${at(name)}: is not opaque (a pixel has alpha under 255)`);
    } catch (e) {
      out.push(`${at(name)}: ${e.message}`);
    }
  };
  png('cut-panel.png', CORNER);
  png('cut-button.png', CORNER);
  png('coin.png', COIN);

  /* 3 */
  for (const f of fontFiles) {
    const baked = present[`fonts/${f}`];
    if (!baked) continue;
    const own = ui.fonts[f];
    if (!own) out.push(`${at(`fonts/${f}`)}: ${path.join(ui.path, 'fonts', f)} is missing, so it cannot be compared`);
    else if (!baked.equals(own)) out.push(`${at(`fonts/${f}`)}: differs from ${path.join(ui.path, 'fonts', f)}`);
  }

  /* 4 */
  const recordFile = path.join(mailDir.path, 'assets.json');
  const record = mailDir.record;
  if (!record || typeof record.outputs !== 'object' || typeof record.sources !== 'object' || !record.outputs || !record.sources) {
    out.push(`${recordFile}: ${record === null ? 'missing' : 'not a record of outputs and sources'}; ${remake}`);
  } else {
    for (const [name, bytes] of Object.entries(present)) {
      const want = record.outputs[name];
      if (want === undefined) out.push(`${recordFile}: records no hash for ${at(name)}; ${remake}`);
      else if (want !== sha256(bytes)) out.push(`${recordFile}: ${at(name)} is not the file the record hashed; ${remake}`);
    }
    const sources = {};
    try {
      for (const [k, text] of Object.entries(sourceSlices(ui.glass))) sources[k] = sha256(Buffer.from(text));
    } catch (e) {
      out.push(`${path.join(ui.path, 'glass.json')}: ${e.message}`);
    }
    if (ui.coinSvg) sources['icon/coin.svg'] = sha256(ui.coinSvg);
    else out.push(`${path.join(ui.path, 'icon', 'coin.svg')}: missing`);
    for (const f of fontFiles) if (ui.fonts[f]) sources[`fonts/${f}`] = sha256(ui.fonts[f]);
    for (const [name, hash] of Object.entries(sources)) {
      const where = name.startsWith('glass.json#') ? `${path.join(ui.path, 'glass.json')} (${name.slice('glass.json#'.length)})` : path.join(ui.path, name);
      if (record.sources[name] === undefined) out.push(`${recordFile}: records no source hash for ${where}; ${remake}`);
      else if (record.sources[name] !== hash) out.push(`${where}: changed since ${recordFile} recorded it, so the baked assets are stale; ${remake}`);
    }
  }

  /* 5 */
  const made = new Map(rendered.map((r) => [r.path, r.html]));
  for (const t of templates) {
    const html = made.get(t.path);
    if (html === undefined) out.push(`${t.path}: is not a template authTemplates() writes; delete it`);
    else if (t.text === null) out.push(`${t.path}: missing; run  node tools/check-mail.mjs --write  and commit it`);
    else if (t.text !== html) out.push(`${t.path}: differs from what authTemplates() writes; run  node tools/check-mail.mjs --write  and commit it`);
  }

  /* 9 */
  for (const [where, list] of [['committed', templates.map((t) => ({ path: t.path, html: t.text }))], ['rendered', rendered]]) {
    for (const t of list) {
      if (typeof t.html !== 'string') continue;
      const href = /<a\s[^>]*?href="([^"]*)"/.exec(t.html)?.[1];
      if (t.html.includes('{{ .ConfirmationURL }}')) out.push(`${t.path}: the ${where} template holds {{ .ConfirmationURL }}; the link is ${AUTH_LINK}`);
      else if (href !== AUTH_LINK) out.push(`${t.path}: the ${where} template's button's href is ${JSON.stringify(href ?? null)}, not ${AUTH_LINK}`);
    }
  }

  const committed = new Set(templates.map((t) => t.path));
  for (const r of rendered) if (!committed.has(r.path)) out.push(`${r.path}: authTemplates() writes it, but it is not among the committed templates; run  node tools/check-mail.mjs --write  and commit it`);

  /* 6 */
  for (const r of rendered) {
    const bytes = Buffer.byteLength(r.html);
    if (bytes > GMAIL_CLIP) out.push(`${r.path}: renders to ${bytes} bytes, over ${GMAIL_CLIP}, where Gmail clips an email`);
  }

  /* 7 */
  const c = theme?.colors;
  if (!c) {
    out.push(`${path.join(mailDir.path, 'index.ts')}: mailTheme has no colors`);
  } else {
    for (const k of TEXT_COLORS) {
      for (const bg of ['ground', 'field']) {
        const r = contrastRatio(c[k], c[bg]);
        if (!(r >= 4.5)) out.push(`${path.join(mailDir.path, 'index.ts')}: ${k} ${c[k]} on ${bg} ${c[bg]} is ${r.toFixed(2)}:1, under 4.5:1`);
      }
    }
    const ink = contrastRatio(c.ink, c.neon);
    if (!(ink >= 4.5)) out.push(`${path.join(mailDir.path, 'index.ts')}: ink ${c.ink} on neon ${c.neon} is ${ink.toFixed(2)}:1, under 4.5:1`);

    /* 8 */
    const page = ui.glass ? recipeWorsts(ui.glass).page : undefined;
    if (!page) {
      out.push(`${path.join(ui.path, 'glass.json')}: has no page recipe to read the masthead's smoke from`);
    } else {
      const r = contrastRatio(c.text, page.full.rgb);
      if (!(r >= 3)) out.push(`${path.join(mailDir.path, 'index.ts')}: the masthead name (text ${c.text}) on the smoke's worst pixel is ${r.toFixed(2)}:1, under 3:1`);
    }
  }
  return out;
}

const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);

/** Every file under a folder as `{ relativePath: Buffer }`, with `/` separators; none for a missing folder. */
function tree(dir, prefix = '') {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) Object.assign(out, tree(path.join(dir, e.name), `${prefix}${e.name}/`));
    else out[prefix + e.name] = fs.readFileSync(path.join(dir, e.name));
  }
  return out;
}

const importTs = async (file) => import(pathToFileURL(file).href);

/**
 * Reads a repository root into `mailFaults`'s arguments, one per instance with a `mail/` folder. The
 * templates are the composition root's, so they come with each. With `write`, the rendered templates are
 * written first.
 * @returns {Promise<{ ui: any, mailDir: any, templates: any[], rendered: any[] }[]>}
 */
export async function loadRoot(root, { write = false } = {}) {
  const instances = path.join(root, 'instances');
  const names = fs.existsSync(instances)
    ? fs.readdirSync(instances, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(instances, e.name, 'mail'))).map((e) => e.name).sort()
    : [];
  if (names.length === 0) return [];
  const rendered = (await importTs(path.join(root, 'supabase', 'functions', '_shared', 'mail', 'auth.ts'))).authTemplates();
  /* --write writes where authTemplates() says, so a path outside supabase/templates/*.html is refused before anything is written. */
  for (const r of rendered) {
    if (!TEMPLATE_PATH.test(r.path)) throw new Error(`authTemplates() names ${JSON.stringify(r.path)}, which is not supabase/templates/<name>.html; refusing to write or read it`);
  }
  if (write) {
    for (const r of rendered) {
      fs.mkdirSync(path.dirname(path.join(root, r.path)), { recursive: true });
      fs.writeFileSync(path.join(root, r.path), r.html);
    }
  }
  const dir = path.join(root, 'supabase', 'templates');
  const files = new Set(rendered.map((r) => r.path));
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) files.add(`supabase/templates/${f}`);
  const templates = [...files].sort().map((p) => ({ path: p, text: fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null }));
  const rel = (p) => path.relative(root, p) || p;
  const out = [];
  for (const name of names) {
    const uiDir = path.join(instances, name, 'ui');
    const mailPath = path.join(instances, name, 'mail');
    const glassFile = readIf(path.join(uiDir, 'glass.json'));
    const recordFile = readIf(path.join(mailPath, 'assets.json'));
    out.push({
      ui: {
        path: rel(uiDir),
        glass: glassFile ? JSON.parse(glassFile.toString('utf8')) : null,
        coinSvg: readIf(path.join(uiDir, 'icon', 'coin.svg')),
        fonts: tree(path.join(uiDir, 'fonts')),
        mail: tree(path.join(uiDir, 'public', 'mail')),
      },
      mailDir: {
        path: rel(mailPath),
        theme: (await importTs(path.join(mailPath, 'index.ts'))).mailTheme,
        record: recordFile ? JSON.parse(recordFile.toString('utf8')) : null,
      },
      templates,
      rendered,
    });
  }
  return out;
}

async function main() {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  let loaded;
  try {
    loaded = await loadRoot(root, { write: process.argv.includes('--write') });
  } catch (e) {
    console.error(`  mail: ${e.message}`);
    process.exit(1);
  }
  if (loaded.length === 0) {
    console.error('  mail: no instance has a mail/ folder, so there is nothing to check; refusing to report a pass on nothing');
    process.exit(1);
  }
  /* The templates are the composition root's, passed with every instance; a fault of theirs is named once. */
  const faults = [...new Set(loaded.flatMap((args) => mailFaults(args)))];
  if (faults.length) {
    console.error(`  mail: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`  mail: ${loaded.map((l) => l.mailDir.path).join(', ')} hold their images and fonts as recorded, and ${loaded[0].templates.length} Auth template(s) are as rendered`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
