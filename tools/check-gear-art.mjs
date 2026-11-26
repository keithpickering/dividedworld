/**
 * Guard: a gear item's art folder lists its views, holds a picture for each and no other picture, and every picture is
 * the right shape and runs nothing.
 *
 *   node tools/check-gear-art.mjs [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-23-rendered-gear-design.md (section 3), and the plan is
 * docs/plans/2026-11-23-rendered-gear-plan.md (Task 5). An instance keeps an item's art in `ui/gear/<key>/`: a
 * `views.json` and, for each view it lists, one picture, `<view>.webp` (a rendered view) or `<view>.svg` (a drawn one).
 * Any other file in the folder (`model.blend`, a `rig` input) is not a picture and is not read, and neither is a plain
 * file directly in `ui/gear/` (a README) nor a folder whose name could not be an item's key (lowercase words joined by
 * hyphens): `__pycache__` or a dot-folder is a tool's leavings, not an item. Every item folder, of every instance, must
 * pass:
 *
 * 1. views.json is there, parses to an object, and is at most 2 KB; its `views` is an object with at least one view,
 *    and every key of it is one of the five the engine names (front, three-quarter-left, three-quarter-right,
 *    side-left, side-right); its `default` is a key of its `views`;
 * 2. each listed view has exactly one picture, `<view>.webp` or `<view>.svg`, not neither and not both; and no
 *    `<name>.webp` or `<name>.svg` is there for a view not listed, or for a name that is no view at all;
 * 3. each view's `width` and `height` are whole numbers above 0, and its `pivot.x` is from 0 to `width` and its
 *    `pivot.y` from 0 to `height` (the pivot is where the item sits on a head, in the picture's own pixels);
 * 4. a WebP is read by its header alone (nothing is decoded), through tools/art-files.mjs: its width and height are
 *    views.json's, its longest side is at most 1024, it has an alpha channel, it is not animated, and it is at most
 *    200 KB;
 * 5. an SVG's viewBox has views.json's width and height (its origin is free), it is held to the card art's safety
 *    reading (tools/art-files.mjs `safetyFaults`: nothing in it runs or reaches out), and it is at most 50 KB;
 * 6. a flat `ui/gear/<key>.svg` (the layout before folders) is a fault naming the file and the new layout.
 *
 * Not caught in a WebP, as in a card's: a right header over corrupt image data, an extended header that claims a size
 * over a frame of another, and an alpha flag over a file with no alpha data. A picture is shown through `<img>`, where
 * a browser runs and loads nothing, so these are shape checks.
 *
 * `gearArtFaults` is exported and reads only the root it is handed, so tools/test-gear-art.mjs drives it red over
 * scratch folders. A repository with no gear folder passes: there is nothing to check, and no instance is named here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KEY, read, rootFaults, safetyFaults, webpInfo } from './art-files.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KB = 1024;
const CAPS = { 'views.json': 2 * KB, webp: 200 * KB, svg: 50 * KB };
const LONGEST = 1024;
/** The five views the engine names. */
const VIEWS = ['front', 'three-quarter-left', 'three-quarter-right', 'side-left', 'side-right'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v) => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** The faults of one view's geometry in views.json: its width and height whole numbers, its pivot inside the picture. */
function geometryFaults(p, view, v) {
  if (!isObject(v)) return [`${p}: ${view} must be an object with width, height and pivot`];
  const out = [];
  for (const k of ['width', 'height']) if (!whole(v[k])) out.push(`${p}: ${view}: ${k} must be a whole number above 0`);
  for (const [k, side] of [['x', 'width'], ['y', 'height']]) {
    const at = isObject(v.pivot) ? v.pivot[k] : undefined;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || (whole(v[side]) && at > v[side])) {
      out.push(`${p}: ${view}: pivot.${k} must be a number from 0 to its ${side}${whole(v[side]) ? ` (${v[side]})` : ''}`);
    }
  }
  return out;
}

/** The faults of one view's picture: the WebP or the SVG the folder holds for it, read against what views.json says. */
function pictureFaults(file, bytes, ext, v) {
  const out = [];
  if (bytes.length > CAPS[ext]) out.push(`${file}: is ${bytes.length} bytes; it may be at most ${CAPS[ext] / KB} KB`);
  if (ext === 'webp') {
    const info = webpInfo(bytes);
    if ('fault' in info) return [...out, `${file}: ${info.fault}`];
    if (info.width !== v.width || info.height !== v.height) out.push(`${file}: is ${info.width} by ${info.height}; views.json says ${v.width} by ${v.height}`);
    if (Math.max(info.width, info.height) > LONGEST) out.push(`${file}: its longest side is ${Math.max(info.width, info.height)}; it may be at most ${LONGEST} pixels`);
    if (!info.alpha) out.push(`${file}: has no alpha channel; a view is cut out, so it is transparent around the item`);
    if (info.animated) out.push(`${file}: is animated; a view is a still image`);
  } else {
    const text = bytes.toString('utf8');
    out.push(...rootFaults(file, text, `the viewBox must be ${v.width} by ${v.height}, as views.json says`, (b) => b[2] === v.width && b[3] === v.height));
    out.push(...safetyFaults(file, text));
  }
  return out;
}

/** The faults of one item folder. */
function itemFaults(dir) {
  const p = path.join(dir, 'views.json');
  const bytes = read(p);
  if (bytes === null) return [`${p}: missing; an item's gear folder holds views.json and a <view>.webp or <view>.svg for each view it lists`];
  const out = [];
  if (bytes.length > CAPS['views.json']) out.push(`${p}: is ${bytes.length} bytes; it may be at most ${CAPS['views.json'] / KB} KB`);
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    return [...out, `${p}: is not JSON (${e.message})`];
  }
  if (!isObject(data)) return [...out, `${p}: must be an object with a default and its views`];
  if (!isObject(data.views) || Object.keys(data.views).length === 0) return [...out, `${p}: views must be an object with at least one view`];
  const listed = Object.keys(data.views);
  for (const v of listed) if (!VIEWS.includes(v)) out.push(`${p}: view "${v}" is not one of the five (${VIEWS.join(', ')})`);
  if (typeof data.default !== 'string' || !listed.includes(data.default)) out.push(`${p}: default "${data.default}" is not one of its views (${listed.join(', ')})`);

  const names = fs.readdirSync(dir);
  for (const view of listed) {
    out.push(...geometryFaults(p, view, data.views[view]));
    const has = ['webp', 'svg'].filter((ext) => names.includes(`${view}.${ext}`));
    if (has.length === 0) out.push(`${dir}: lists ${view} but has no ${view}.webp or ${view}.svg`);
    if (has.length === 2) out.push(`${dir}: holds ${view}.webp and ${view}.svg; a view has one picture, not both`);
    for (const ext of has) {
      const file = path.join(dir, `${view}.${ext}`);
      const body = read(file);
      if (body !== null && isObject(data.views[view])) out.push(...pictureFaults(file, body, ext, data.views[view]));
    }
  }
  for (const name of names) {
    const m = /^(.+)\.(?:webp|svg)$/u.exec(name);
    if (!m || listed.includes(m[1])) continue;
    const file = path.join(dir, name);
    out.push(VIEWS.includes(m[1]) ? `${file}: ${m[1]} is not listed in views.json, so this picture is never shown` : `${file}: names no view; a picture is named for one of the five (${VIEWS.join(', ')})`);
  }
  return out;
}

/** Every `instances/*\/ui/gear` directory under a root. */
function gearDirs(root) {
  const inst = path.join(root, 'instances');
  if (!fs.existsSync(inst)) return [];
  const out = [];
  for (const i of fs.readdirSync(inst, { withFileTypes: true })) {
    const gear = path.join(inst, i.name, 'ui', 'gear');
    if (i.isDirectory() && fs.existsSync(gear) && fs.statSync(gear).isDirectory()) out.push(gear);
  }
  return out.sort();
}

/** The item folders of a gear directory: those named as an item's key could be. */
function itemFolders(gear) {
  return fs.readdirSync(gear, { withFileTypes: true }).filter((e) => e.isDirectory() && KEY.test(e.name)).map((e) => path.join(gear, e.name)).sort();
}

/**
 * Every fault in the gear folders under a root: a list of lines, each naming the file and the rule it broke; empty
 * when all is well.
 * @param {string} root
 */
export function gearArtFaults(root) {
  const out = [];
  for (const gear of gearDirs(root)) {
    for (const e of fs.readdirSync(gear, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.svg')) out.push(`${path.join(gear, e.name)}: is the old layout, one flat file per item; an item's art is a folder, ui/gear/<key>/, with views.json and a <view>.webp or <view>.svg for each view`);
    }
    for (const dir of itemFolders(gear)) out.push(...itemFaults(dir));
  }
  return out;
}

function main() {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  const faults = gearArtFaults(root);
  const rel = (s) => s.split(root + path.sep).join('');
  if (faults.length) {
    console.error(`  gear art: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${rel(f)}`);
    process.exit(1);
  }
  console.log(`  gear art: ${gearDirs(root).flatMap(itemFolders).length} item folder(s) list their views, hold one right-sized picture for each, and run nothing`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
