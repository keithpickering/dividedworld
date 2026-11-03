/**
 * Guard: the site's icons are there, are what the design says they are, were made from their
 * sources, and were served by the build.
 *
 *   node tools/check-icons.mjs [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-02-favicon-design.md. An instance's icon sources (the owner's
 * 16px sprite, coin-16.png, and the vector every larger size is drawn from, coin.svg) sit in its
 * `ui/icon/`, and the files a browser is given (favicon.ico and apple-touch-icon.png) in its
 * `ui/public/`, which the web build copies to the site's root. The two served files are committed,
 * not built: the build has no browser to draw the vector with (tools/build.mjs, OUTSIDE_THE_BUILD),
 * so tools/make-icons.mjs makes them by hand and writes `ui/icon/icons.json`, a record of each
 * source's and each output's SHA-256. What the build can read is whether the files still are what
 * that record says, and what the design says they must be:
 *
 * 1. all five files are there;
 * 2. the ICO holds exactly three images, of 16, 32 and 48px, each a PNG whose own size agrees with
 *    its directory entry;
 * 3. its 16px image is coin-16.png byte for byte: the 16px icon is the owner's sprite, never a
 *    rendering, and a re-encode can change its colors through a gamma or color-profile chunk;
 * 4. apple-touch-icon.png is 180 by 180 and opaque, since iOS fills a transparent pixel with black;
 * 5. every hash in the record matches its file, so a sprite or vector edited without the script
 *    run again fails, naming the script.
 *
 * And for the site: web/index.html names both files (6), and web/dist/ holds both, each byte for
 * byte one instance's public/ file (7). Without that a request for /favicon.ico falls through the
 * single-page redirect and is answered with index.html. An empty or missing web/dist/ fails as
 * "nothing built", as tools/check-web-bundle.mjs does, because a build that never ran would
 * otherwise have nothing wrong in it. A repository with no instance holding an icon/ folder fails
 * too: the site would have no icon.
 *
 * `iconFaults` is exported and reads only the folders it is handed, so tools/test-icons.mjs drives
 * it red over scratch folders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pngInfo, pngOpaque, readIco, sha256 } from './icons.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The command that makes an instance's icons again. */
const remake = (ui) => `node tools/make-icons.mjs ${path.join(ui, 'icon')} ${path.join(ui, 'public')}`;

const SOURCES = ['coin-16.png', 'coin.svg'];
const OUTPUTS = ['favicon.ico', 'apple-touch-icon.png'];
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZE = 180;

/** The file at a path, or null when there is none. */
function read(file) {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return null;
    throw e;
  }
}

/** The faults of one instance's icons, each naming the file and what was found. */
function instanceFaults(ui) {
  const out = [];
  const at = (dir, f) => path.join(ui, dir, f);
  const files = {};
  for (const [dir, f] of [['icon', 'coin-16.png'], ['icon', 'coin.svg'], ['icon', 'icons.json'], ['public', 'favicon.ico'], ['public', 'apple-touch-icon.png']]) {
    files[f] = read(at(dir, f));
    if (files[f] === null) out.push(`${at(dir, f)}: missing`);
  }

  /* (2) and (3): the ICO. */
  const ico = files['favicon.ico'];
  if (ico) {
    const name = at('public', 'favicon.ico');
    try {
      const images = readIco(ico);
      const sizes = images.map((i) => i.width);
      if (images.length !== 3 || images.some((img, k) => img.width !== ICO_SIZES[k] || img.height !== ICO_SIZES[k])) {
        out.push(`${name}: holds ${images.length} image(s) (${images.map((i) => `${i.width}x${i.height}`).join(', ') || 'none'}); it must hold exactly three, of 16, 32, 48px, in that order`);
      }
      for (const img of images) {
        const info = pngInfo(img.bytes);
        if (info.width !== img.width || info.height !== img.height) {
          out.push(`${name}: the ${img.width}x${img.height} entry holds a ${info.width}x${info.height} PNG`);
        }
      }
      const sixteen = images[sizes.indexOf(16)];
      if (sixteen && files['coin-16.png'] && !sixteen.bytes.equals(files['coin-16.png'])) {
        out.push(`${name}: its 16px image is not ${at('icon', 'coin-16.png')} byte for byte; the 16px icon is the owner's sprite as drawn, never a rendering or a re-encode`);
      }
    } catch (e) {
      out.push(`${name}: ${e.message}`);
    }
  }

  /* (4): the home-screen icon. */
  const apple = files['apple-touch-icon.png'];
  if (apple) {
    const name = at('public', 'apple-touch-icon.png');
    try {
      const info = pngInfo(apple);
      if (info.width !== APPLE_SIZE || info.height !== APPLE_SIZE) out.push(`${name}: is ${info.width}x${info.height}; it must be ${APPLE_SIZE}x${APPLE_SIZE}`);
      if (!pngOpaque(apple)) out.push(`${name}: has a pixel whose alpha is below 255; iOS fills a transparent pixel with black, so every pixel must be opaque`);
    } catch (e) {
      out.push(`${name}: ${e.message}`);
    }
  }

  /* (5): the record. */
  const recordFile = files['icons.json'];
  if (recordFile) {
    const name = at('icon', 'icons.json');
    let record;
    try {
      record = JSON.parse(recordFile.toString('utf8'));
    } catch (e) {
      out.push(`${name}: is not JSON (${e.message}); ${remake(ui)} writes it again`);
    }
    if (record) {
      for (const [group, list, dir] of [['sources', SOURCES, 'icon'], ['outputs', OUTPUTS, 'public']]) {
        for (const f of list) {
          const want = record[group]?.[f];
          if (!files[f]) continue;
          const have = sha256(files[f]);
          if (want !== have) {
            out.push(`${at(dir, f)}: its SHA-256 is ${have}, but ${name} records ${want ?? 'none'} under ${group}; ${remake(ui)} makes the icons and the record again`);
          }
        }
      }
    }
  }
  return out;
}

/** Whether an HTML file has a `<link>` with exactly this rel and this href. */
function hasLink(html, rel, href) {
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const attr = (n) => tag.match(new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu'));
    const r = attr('rel');
    const h = attr('href');
    if (r && h && (r[1] ?? r[2]).trim().toLowerCase() === rel && (h[1] ?? h[2]) === href) return true;
  }
  return false;
}

/** Every file under a directory, as paths relative to it; [] for a directory that is not there. */
function filesUnder(dir, rel = '') {
  if (!fs.existsSync(path.join(dir, rel))) return [];
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(dir, next));
    else if (entry.isFile()) out.push(next);
  }
  return out;
}

/**
 * Every fault in the icons of these instances and the site: a list of lines, each naming the file
 * and what was found; empty when all is well.
 *
 * @param {{ instanceUi: string[], indexHtml: string, dist: string }} input
 *   instanceUi: each instance's `ui/` folder that has an `icon/` folder; indexHtml: the page's
 *   source; dist: the built site.
 */
export function iconFaults({ instanceUi, indexHtml, dist }) {
  const out = [];
  if (instanceUi.length === 0) out.push('no instance has an icon/ folder (instances/<name>/ui/icon/), so the site has no icon');
  for (const ui of instanceUi) out.push(...instanceFaults(ui));

  /* (6) */
  const html = read(indexHtml);
  if (html === null) out.push(`${indexHtml}: missing`);
  else {
    const text = html.toString('utf8');
    if (!hasLink(text, 'icon', '/favicon.ico')) out.push(`${indexHtml}: has no <link rel="icon" href="/favicon.ico">`);
    if (!hasLink(text, 'apple-touch-icon', '/apple-touch-icon.png')) out.push(`${indexHtml}: has no <link rel="apple-touch-icon" href="/apple-touch-icon.png">`);
  }

  /* (7) */
  if (filesUnder(dist).length === 0) {
    out.push(`${dist}: nothing built: it is missing or empty, so there is no site to check (run npm run build:web first)`);
  } else {
    for (const f of OUTPUTS) {
      const served = read(path.join(dist, f));
      if (served === null) {
        out.push(`${path.join(dist, f)}: missing, so the single-page redirect would answer /${f} with index.html`);
        continue;
      }
      const match = instanceUi.some((ui) => {
        const own = read(path.join(ui, 'public', f));
        return own !== null && own.equals(served);
      });
      if (!match) out.push(`${path.join(dist, f)}: is not byte for byte any instance's ui/public/${f}, so the build copied the wrong folder`);
    }
  }
  return out;
}

/** Every `instances/*\/ui/` under a root that has an `icon/` folder. */
function instancesWithIcons(root) {
  const dir = path.join(root, 'instances');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'ui', 'icon')))
    .map((e) => path.join(dir, e.name, 'ui'))
    .sort();
}

function main() {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  const instanceUi = instancesWithIcons(root);
  const faults = iconFaults({ instanceUi, indexHtml: path.join(root, 'web', 'index.html'), dist: path.join(root, 'web', 'dist') });
  const rel = (s) => s.split(root + path.sep).join('');
  if (faults.length) {
    console.error(`  icons: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${rel(f)}`);
    process.exit(1);
  }
  console.log(`  icons: ${instanceUi.map((u) => rel(u)).join(', ')} hold their five files as recorded, and web/ names and serves them`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
