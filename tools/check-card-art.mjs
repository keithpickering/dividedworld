/**
 * Guard: a card's art folder is complete, is the right shape, and holds nothing that runs.
 *
 *   node tools/check-card-art.mjs [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-05-card-template-plan.md (Task 2), and, for a raster canvas,
 * docs/plans/2026-11-11-rendered-card-art-design.md (section 3). An instance keeps a card's art in
 * `ui/cards/<key>/`: a canvas (`art.svg` or `art.webp`, exactly one), `mark.svg` (its small emblem)
 * and `art.json` (who made it, and under what license). Plain files directly in `ui/cards/` are not
 * folders and are not read here, and neither is any other file in a card's folder (a `scene.py`
 * beside its art, say), nor a folder whose name could not be a card's key (lowercase words joined by
 * hyphens): `__pycache__` or a dot-folder is a tool's leavings, not a card. Every card folder, of
 * every instance, must pass:
 *
 * 1. mark.svg and art.json are there, and exactly one canvas: art.svg or art.webp, not neither and
 *    not both;
 * 2. art.svg's root `svg` has a viewBox of four numbers, exactly `0 0 540 840`;
 * 3. mark.svg's viewBox is square;
 * 4. art.json parses, and its `credit` and `license` are non-empty strings;
 * 5. art.svg is at most 200 KB, art.webp at most 400 KB, mark.svg at most 20 KB, art.json at most 2 KB;
 * 6. nothing in either SVG runs or reaches out, read case-insensitively over the whole file: no
 *    `<script`, `<foreignObject` or `<image`; no attribute whose name starts `on`; no `@import`;
 *    every `href`, `xlink:href` and `url(` value starts with `#`;
 * 7. art.webp is a WebP, read by its header alone (nothing is decoded): a RIFF file of form WEBP
 *    whose first chunk is `VP8 `, `VP8L` or `VP8X`, whose width and height are exactly 1080 by 1680
 *    (twice the SVG canvas), and which is not animated (a `VP8X` file with its animation flag set).
 *    An image runs nothing in an `<img>`, so this is a shape check, not a safety one.
 *
 * Beyond the plan's list, for a hostile file (a card is shown through `<img>`, where a browser runs
 * and loads nothing, so this is the second wall, for an editor or a raw view): no `<!DOCTYPE` or
 * `<!ENTITY` (an entity can expand to a URL after the checks above read the file); no `xml:base`
 * (it re-bases a relative reference); no `<set>` or `<animate...>` whose attributeName is an href
 * (it writes one after load); and no numeric character reference (`&#x6a;`, `&#106;`) inside an
 * attribute value, since it hides a character from the reading above. Not caught: a CSS escape in
 * a `<style>` (`u\72l(`), a `values`/`to` computed some other way, anything a viewer does with
 * a `data-` attribute, and a character reference in a `<style>` that spells `url(`; none of these
 * runs inside an `<img>`. Text and comments are read as markup, deliberately: a false positive is
 * cheap and a miss is not.
 *
 * Not caught in a WebP: a right header over corrupt image data (the browser draws nothing, and a card
 * with no picture is still a whole card); an extended header that claims 1080 by 1680 over a frame of
 * another size, since only the first chunk is read; and EXIF or XMP chunks, which are inert in an `<img>`.
 *
 * An instance's card back is one folder, `ui/card-back/` (docs/plans/2026-11-11-rendered-card-back-design.md,
 * section 3), read where it exists: `art.svg` or `art.webp`, exactly one (the back of every card), `hit.svg` or
 * `hit.webp`, at most one (the hit pull's), and `art.json`, as a card's. It has no `mark.svg`. Each picture is held to
 * what a card's canvas is (rules 2, 5, 6 and 7, with `hit.svg` at most 200 KB and `hit.webp` at most 400 KB), and
 * `art.json` to rule 4. A repository with no such folder passes.
 *
 * `cardArtFaults` is exported and reads only the root it is handed, so tools/test-card-art.mjs
 * drives it red over scratch folders. A repository with no card folder passes: there is nothing
 * to check, and no instance is named here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KB = 1024;
const CAPS = { 'art.svg': 200 * KB, 'art.webp': 400 * KB, 'hit.svg': 200 * KB, 'hit.webp': 400 * KB, 'mark.svg': 20 * KB, 'art.json': 2 * KB };
const CANVAS = [0, 0, 540, 840];
const RASTER = [1080, 1680];

/** The file at a path, or null when there is none. */
function read(file) {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return null;
    throw e;
  }
}

/**
 * Every `name=value` in a text, quoted either way or bare: [name, value] with the name's case kept. A name starts only
 * where the character before it cannot be part of one, so a long run of name characters with no `=` after it (a
 * comment, a title) is tried once, not again from each of its characters: the reading stays linear in the file.
 */
function attributes(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![^\s=<>"'/])([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gu)) out.push([m[1], m[2] ?? m[3] ?? m[4]]);
  return out;
}

/** The start tags in a text whose name matches `names` (a regex source), read past a `>` inside a quoted value. */
function tags(text, names) {
  return [...text.matchAll(new RegExp(`<(?:${names})(?![\\w:-])(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'giu'))].map((m) => m[0]);
}

/** The four numbers of a viewBox value, or null. */
function viewBoxOf(value) {
  const parts = value.trim().split(/\s+/u);
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(p) ? Number(p) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/** Faults of one SVG's root viewBox: [] when `ok(box)` holds. */
function rootFaults(name, text, what, ok) {
  const root = tags(text.replace(/<!--[\s\S]*?-->/gu, ''), 'svg')[0];
  if (!root) return [`${name}: has no <svg> root, so it has no viewBox; ${what}`];
  const vb = attributes(root).find(([n]) => n === 'viewBox');
  if (!vb) return [`${name}: its root svg has no viewBox; ${what}`];
  const box = viewBoxOf(vb[1]);
  if (!box) return [`${name}: its viewBox "${vb[1]}" is not four numbers; ${what}`];
  return ok(box) ? [] : [`${name}: its viewBox is "${vb[1].trim()}"; ${what}`];
}

/** Faults of an SVG that runs or reaches out (rule 6 and the hostile cases). */
function safetyFaults(name, text) {
  const out = [];
  const lower = text.toLowerCase();
  for (const bad of ['<script', '<foreignobject', '<image', '@import', '<!doctype', '<!entity']) {
    if (!lower.includes(bad)) continue;
    const shown = bad === '<foreignobject' ? '<foreignObject' : bad;
    out.push(`${name}: holds ${shown}; an art file is vector only and runs and fetches nothing${bad === '<!doctype' ? '; delete the DOCTYPE line' : ''}`);
  }
  for (const [n, v] of attributes(text)) {
    const attr = n.toLowerCase();
    if (attr.startsWith('on')) out.push(`${name}: has the event attribute ${n}; an art file runs nothing`);
    if (attr === 'xml:base') out.push(`${name}: has xml:base, which re-bases every relative reference`);
    if (/^(?:[\w-]+:)?href$/u.test(attr) && !v.startsWith('#')) out.push(`${name}: has ${n}="${v.slice(0, 60)}"; an href must start with # (a reference inside the file)`);
    if (/&#/u.test(v)) out.push(`${name}: has a numeric character reference in ${n}="${v.slice(0, 60)}"; write the character itself, since a reference hides it from this reading`);
  }
  for (const m of text.matchAll(/url\(\s*(["']?)\s*([^)]*)/giu)) {
    if (!m[2].startsWith('#')) out.push(`${name}: has url(${m[1]}${m[2].slice(0, 60)}; every url( must start with #`);
  }
  for (const t of tags(text, 'set|animate\\w*')) {
    for (const [n, v] of attributes(t)) {
      if (n.toLowerCase() === 'attributename' && /^\s*(?:(?:[\w-]+:)?href|xml:base)\s*$/iu.test(v)) out.push(`${name}: has a ${t.match(/^<\w+/u)[0]} writing ${v.trim()}, which sets a reference after load`);
    }
  }
  return out;
}

/** Faults of a WebP read by its header alone, decoding nothing: [] when it is a still 1080 by 1680 image. */
function webpFaults(name, bytes) {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return [`${name}: is not a WebP image`];
  const unreadable = [`${name}: is not a WebP image this guard can read`];
  const tag = bytes.toString('latin1', 12, 16);
  let width;
  let height;
  if (tag === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return unreadable;
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else if (tag === 'VP8L') {
    if (bytes[20] !== 0x2f) return unreadable;
    const v = bytes.readUInt32LE(21);
    width = (v & 0x3fff) + 1;
    height = ((v >>> 14) & 0x3fff) + 1;
  } else if (tag === 'VP8X') {
    width = bytes.readUIntLE(24, 3) + 1;
    height = bytes.readUIntLE(27, 3) + 1;
  } else return unreadable;
  const out = [];
  if (width !== RASTER[0] || height !== RASTER[1]) out.push(`${name}: is ${width} by ${height}; a raster canvas is exactly ${RASTER[0]} by ${RASTER[1]}`);
  if (tag === 'VP8X' && (bytes[20] & 2) !== 0) out.push(`${name}: is animated; a card's art is a still image`);
  return out;
}

/**
 * The faults of one canvas in a folder: `<base>.svg` or `<base>.webp`, where `base` is `art` or `hit`. Both there is a
 * fault; neither is a fault only when `required` (`holds` says what the folder holds, for that message); each file
 * gets its cap, and an SVG its viewBox and safety, a WebP its header.
 */
function canvasFaults(dir, base, required, holds) {
  const out = [];
  const svg = `${base}.svg`;
  const webp = `${base}.webp`;
  const files = {};
  for (const f of [svg, webp]) {
    files[f] = read(path.join(dir, f));
    if (files[f] !== null && files[f].length > CAPS[f]) out.push(`${path.join(dir, f)}: is ${files[f].length} bytes; it may be at most ${CAPS[f] / KB} KB`);
  }
  const at = (f) => path.join(dir, f);
  if (files[svg] === null && files[webp] === null && required) out.push(`${dir}: missing a canvas; ${holds}`);
  if (files[svg] !== null && files[webp] !== null) out.push(`${dir}: holds ${svg} and ${webp}; ${base === 'art' ? 'a card has one canvas' : 'a back has one hit canvas'}`);
  if (files[webp]) out.push(...webpFaults(at(webp), files[webp]));
  if (files[svg]) {
    const text = files[svg].toString('utf8');
    out.push(...rootFaults(at(svg), text, 'the canvas must be exactly 0 0 540 840', (b) => b.every((n, i) => n === CANVAS[i])));
    out.push(...safetyFaults(at(svg), text));
  }
  return out;
}

/** The faults of an `art.json` in a folder: present, JSON, `credit` and `license` non-empty strings. */
function manifestFaults(dir, holds) {
  const p = path.join(dir, 'art.json');
  const bytes = read(p);
  if (bytes === null) return [`${p}: missing; ${holds}`];
  const out = [];
  if (bytes.length > CAPS['art.json']) out.push(`${p}: is ${bytes.length} bytes; it may be at most ${CAPS['art.json'] / KB} KB`);
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    out.push(`${p}: is not JSON (${e.message})`);
  }
  if (data !== undefined) {
    for (const k of ['credit', 'license']) {
      if (data === null || typeof data !== 'object' || typeof data[k] !== 'string' || data[k].trim() === '') out.push(`${p}: ${k} must be a non-empty string`);
    }
  }
  return out;
}

const CARD_HOLDS = "a card's art folder holds art.svg or art.webp, mark.svg and art.json";
const BACK_HOLDS = "a card back's folder holds art.svg or art.webp, optionally hit.svg or hit.webp, and art.json";

/** The faults of one card folder. */
function folderFaults(dir) {
  const out = canvasFaults(dir, 'art', true, CARD_HOLDS);
  const mark = read(path.join(dir, 'mark.svg'));
  if (mark === null) out.push(`${path.join(dir, 'mark.svg')}: missing; ${CARD_HOLDS}`);
  else {
    if (mark.length > CAPS['mark.svg']) out.push(`${path.join(dir, 'mark.svg')}: is ${mark.length} bytes; it may be at most ${CAPS['mark.svg'] / KB} KB`);
    const text = mark.toString('utf8');
    out.push(...rootFaults(path.join(dir, 'mark.svg'), text, 'the mark must be square', (b) => b[2] > 0 && b[2] === b[3]));
    out.push(...safetyFaults(path.join(dir, 'mark.svg'), text));
  }
  out.push(...manifestFaults(dir, CARD_HOLDS));
  return out;
}

/** The faults of an instance's card-back folder: the back's canvas (required), the hit pull's (optional), art.json. */
function backFaults(dir) {
  return [...canvasFaults(dir, 'art', true, BACK_HOLDS), ...canvasFaults(dir, 'hit', false, BACK_HOLDS), ...manifestFaults(dir, BACK_HOLDS)];
}

/** What a card's key looks like: lowercase words joined by hyphens. A folder named any other way is not a card's. */
const CARD_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/**
 * Every `instances/*\/ui/cards/<key>/` directory under a root. A folder whose name could not be a card's key is a
 * tool's leavings (Python's `__pycache__` when a scene is run, a dot-folder) and is not read (the owner, 2026-11-11).
 */
function cardFolders(root) {
  const inst = path.join(root, 'instances');
  if (!fs.existsSync(inst)) return [];
  const out = [];
  for (const i of fs.readdirSync(inst, { withFileTypes: true })) {
    const cards = path.join(inst, i.name, 'ui', 'cards');
    if (!i.isDirectory() || !fs.existsSync(cards)) continue;
    for (const c of fs.readdirSync(cards, { withFileTypes: true })) if (c.isDirectory() && CARD_KEY.test(c.name)) out.push(path.join(cards, c.name));
  }
  return out.sort();
}

/** Every `instances/*\/ui/card-back/` directory under a root, where it exists. */
function backFolders(root) {
  const inst = path.join(root, 'instances');
  if (!fs.existsSync(inst)) return [];
  const out = [];
  for (const i of fs.readdirSync(inst, { withFileTypes: true })) {
    const back = path.join(inst, i.name, 'ui', 'card-back');
    if (i.isDirectory() && fs.existsSync(back) && fs.statSync(back).isDirectory()) out.push(back);
  }
  return out.sort();
}

/**
 * Every fault in the card-art and card-back folders under a root: a list of lines, each naming the file and the
 * rule it broke; empty when all is well.
 * @param {string} root
 */
export function cardArtFaults(root) {
  return [...cardFolders(root).flatMap(folderFaults), ...backFolders(root).flatMap(backFaults)];
}

function main() {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  const faults = cardArtFaults(root);
  const rel = (s) => s.split(root + path.sep).join('');
  if (faults.length) {
    console.error(`  card art: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${rel(f)}`);
    process.exit(1);
  }
  console.log(`  card art: ${cardFolders(root).length} card folder(s) and ${backFolders(root).length} card back folder(s) hold a canvas and a manifest, on the right canvas, running nothing`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
