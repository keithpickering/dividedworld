/**
 * Guard: a card's art folder is complete, is the right shape, and holds nothing that runs.
 *
 *   node tools/check-card-art.mjs [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-05-card-template-plan.md (Task 2). An instance keeps a card's
 * art in `ui/cards/<key>/`: `art.svg` (the card's canvas), `mark.svg` (its small emblem) and
 * `art.json` (who made it, and under what license). Plain files directly in `ui/cards/` are not
 * folders and are not read here. Every such folder, of every instance, must pass:
 *
 * 1. all three files are there;
 * 2. art.svg's root `svg` has a viewBox of four numbers, exactly `0 0 540 840`;
 * 3. mark.svg's viewBox is square;
 * 4. art.json parses, and its `credit` and `license` are non-empty strings;
 * 5. art.svg is at most 200 KB, mark.svg at most 20 KB, art.json at most 2 KB;
 * 6. nothing in either SVG runs or reaches out, read case-insensitively over the whole file: no
 *    `<script`, `<foreignObject` or `<image`; no attribute whose name starts `on`; no `@import`;
 *    every `href`, `xlink:href` and `url(` value starts with `#`.
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
 * `cardArtFaults` is exported and reads only the root it is handed, so tools/test-card-art.mjs
 * drives it red over scratch folders. A repository with no card folder passes: there is nothing
 * to check, and no instance is named here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KB = 1024;
const CAPS = { 'art.svg': 200 * KB, 'mark.svg': 20 * KB, 'art.json': 2 * KB };
const CANVAS = [0, 0, 540, 840];

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

/** The faults of one card folder. */
function folderFaults(dir) {
  const out = [];
  const files = {};
  for (const f of Object.keys(CAPS)) {
    const p = path.join(dir, f);
    files[f] = read(p);
    if (files[f] === null) out.push(`${p}: missing; a card's art folder holds art.svg, mark.svg and art.json`);
    else if (files[f].length > CAPS[f]) out.push(`${p}: is ${files[f].length} bytes; it may be at most ${CAPS[f] / KB} KB`);
  }
  const at = (f) => path.join(dir, f);
  if (files['art.svg']) {
    const text = files['art.svg'].toString('utf8');
    out.push(...rootFaults(at('art.svg'), text, 'the canvas must be exactly 0 0 540 840', (b) => b.every((n, i) => n === CANVAS[i])));
    out.push(...safetyFaults(at('art.svg'), text));
  }
  if (files['mark.svg']) {
    const text = files['mark.svg'].toString('utf8');
    out.push(...rootFaults(at('mark.svg'), text, 'the mark must be square', (b) => b[2] > 0 && b[2] === b[3]));
    out.push(...safetyFaults(at('mark.svg'), text));
  }
  if (files['art.json']) {
    let data;
    try {
      data = JSON.parse(files['art.json'].toString('utf8'));
    } catch (e) {
      out.push(`${at('art.json')}: is not JSON (${e.message})`);
    }
    if (data !== undefined) {
      for (const k of ['credit', 'license']) {
        if (data === null || typeof data !== 'object' || typeof data[k] !== 'string' || data[k].trim() === '') out.push(`${at('art.json')}: ${k} must be a non-empty string`);
      }
    }
  }
  return out;
}

/** Every `instances/*\/ui/cards/*\/` directory under a root. */
function cardFolders(root) {
  const inst = path.join(root, 'instances');
  if (!fs.existsSync(inst)) return [];
  const out = [];
  for (const i of fs.readdirSync(inst, { withFileTypes: true })) {
    const cards = path.join(inst, i.name, 'ui', 'cards');
    if (!i.isDirectory() || !fs.existsSync(cards)) continue;
    for (const c of fs.readdirSync(cards, { withFileTypes: true })) if (c.isDirectory()) out.push(path.join(cards, c.name));
  }
  return out.sort();
}

/**
 * Every fault in the card-art folders under a root: a list of lines, each naming the file and the
 * rule it broke; empty when all is well.
 * @param {string} root
 */
export function cardArtFaults(root) {
  return cardFolders(root).flatMap(folderFaults);
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
  console.log(`  card art: ${cardFolders(root).length} card folder(s) hold their three files, on the right canvas, running nothing`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
