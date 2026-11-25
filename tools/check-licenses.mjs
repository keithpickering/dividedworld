/**
 * Guard: every media file's terms are declared, exactly once, where the file's folder can be read.
 *
 *   node tools/check-licenses.mjs [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-25-licensing-design.md, section 6. Under `engine/`, `instances/`, `web/` and
 * `supabase/` (never `node_modules`), every file with a media extension (png jpg jpeg gif webp svg ico mp3 ogg wav mp4
 * webm woff woff2 ttf otf, in any case) must be declared by exactly one of:
 *
 * 1. an `art.json`, which declares its own folder's `art.svg`, `art.webp`, `mark.svg` and `relief.webp`, those that are
 *    there: its `license` is the terms and its `credit` the maker, and tools/check-card-art.mjs holds the file's shape;
 * 2. a `sounds.json`, which declares each row's `file`, relative to its folder (tools/check-sounds.mjs holds the rest);
 * 3. a `CREDITS.md`, which declares each file named in backticks in the first column of a table row, relative to its
 *    folder;
 * 4. a `licenses.json`, an array of rows `{ files, maker, terms, work?, source?, note?, licenseFile? }`, whose `files`
 *    are paths relative to the `licenses.json`'s folder. `terms` is "layer" (the layer's own terms) or `{ name, url }`
 *    for terms of its own; a row with terms of its own names its `source`; a font (woff woff2 ttf otf) with terms of
 *    its own names a `licenseFile` that is a file in the font's folder.
 *
 * It fails on a media file declared nowhere, a file declared twice (the line names both declarations), a declared file
 * that is not there, a blank `maker`, terms that are neither "layer" nor a `{ name, url }` with both non-blank, terms
 * of its own with no `source`, a font with terms of its own and no license text beside it, and a `licenses.json` that is
 * not JSON or not an array. Only a file named exactly `art.json`, `sounds.json`, `CREDITS.md` or `licenses.json`
 * declares anything, so a stray picture beside a card's `scene.py` is not covered by the card's `art.json`.
 *
 * `licenseFaults` is a pure function of `{ repository path: content }` (content is read only for a declaring file, and
 * is "" for the rest), so tools/test-licenses.mjs drives it red over fixtures. It reads only the repository's files, so
 * no database question arises.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOP = ['engine', 'instances', 'web', 'supabase'];
const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.otf']);
const FONT = new Set(['.woff', '.woff2', '.ttf', '.otf']);
const ART_FILES = ['art.svg', 'art.webp', 'mark.svg', 'relief.webp'];
const DECLARING = new Set(['art.json', 'sounds.json', 'CREDITS.md', 'licenses.json']);

const ext = (p) => path.posix.extname(p).toLowerCase();
const isMedia = (p) => MEDIA.has(ext(p));
const blank = (v) => typeof v !== 'string' || v.trim() === '';

/**
 * Every fault in a repository's licensing declarations: a list of lines, each naming the path and the predicate it
 * broke; empty when all is well.
 * @param {Record<string, string>} files
 */
export function licenseFaults(files) {
  const out = [];
  const present = new Set(Object.keys(files));
  /** @type {Map<string, string[]>} media file -> the declarations that name it */
  const declared = new Map();
  const declare = (file, by) => declared.set(file, [...(declared.get(file) ?? []), by]);
  /** A declaration naming `rel` from `declFile`'s folder: resolved, checked for existence, recorded. */
  const names = (declFile, rel, by) => {
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(declFile), rel));
    if (!present.has(file)) {
      out.push(`${file}: declared by ${by} but does not exist`);
      return null;
    }
    declare(file, by);
    return file;
  };

  for (const [p, content] of Object.entries(files)) {
    const base = path.posix.basename(p);
    if (!DECLARING.has(base)) continue;
    const dir = path.posix.dirname(p);
    if (base === 'art.json') {
      for (const f of ART_FILES) if (present.has(path.posix.join(dir, f))) declare(path.posix.join(dir, f), p);
    } else if (base === 'sounds.json') {
      let rows;
      try {
        rows = JSON.parse(content);
      } catch (e) {
        out.push(`${p}: is not JSON (${e.message})`);
        continue;
      }
      if (!Array.isArray(rows)) {
        out.push(`${p}: must be an array of rows`);
        continue;
      }
      for (const r of rows) if (r && typeof r.file === 'string') names(p, r.file, p);
    } else if (base === 'CREDITS.md') {
      for (const line of content.split('\n')) {
        const m = /^\|\s*`([^`]+)`\s*\|/u.exec(line);
        if (m) names(p, m[1], p);
      }
    } else out.push(...rowsFaults(p, content, files, names));
  }

  for (const f of Object.keys(files).sort()) {
    if (!isMedia(f)) continue;
    const by = declared.get(f);
    if (!by) out.push(`${f}: is a media file declared nowhere; give it a row in a licenses.json, or declare it in its folder's art.json, sounds.json or CREDITS.md`);
    else if (by.length > 1) out.push(`${f}: is declared twice, by ${by.join(' and ')}; a file is declared exactly once`);
  }
  return out;
}

/** The faults of one `licenses.json`, declaring the files of its rows through `names`. */
function rowsFaults(p, content, files, names) {
  let rows;
  try {
    rows = JSON.parse(content);
  } catch (e) {
    return [`${p}: is not JSON (${e.message})`];
  }
  if (!Array.isArray(rows)) return [`${p}: must be an array of rows`];
  const out = [];
  rows.forEach((r, i) => {
    const at = `${p}: row ${i + 1}`;
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      out.push(`${at} is not an object`);
      return;
    }
    if (!Array.isArray(r.files) || r.files.length === 0 || r.files.some((f) => blank(f))) out.push(`${at}: files must be a non-empty list of paths`);
    if (blank(r.maker)) out.push(`${at}: maker must be a non-empty string`);
    const own = r.terms !== 'layer';
    if (own && (r.terms === null || typeof r.terms !== 'object' || blank(r.terms.name) || blank(r.terms.url))) {
      out.push(`${at}: terms must be "layer" or { name, url } with both non-blank`);
    } else if (own && blank(r.source)) out.push(`${at}: terms of its own need a source`);
    for (const f of Array.isArray(r.files) ? r.files.filter((x) => !blank(x)) : []) {
      const file = names(p, f, p);
      if (file === null || !own || !FONT.has(ext(file))) continue;
      const lic = r.licenseFile;
      if (blank(lic) || !Object.hasOwn(files, path.posix.join(path.posix.dirname(file), lic))) out.push(`${file}: a font with terms of its own needs a licenseFile that is a file in the font's folder (${p} row ${i + 1})`);
    }
  });
  return out;
}

/** Every file under the four top folders, as repository-relative paths, and its content where it declares something. */
function readTree(root) {
  /** @type {Record<string, string>} */
  const files = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.isFile()) files[rel] = DECLARING.has(e.name) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';
    }
  };
  for (const t of TOP) if (fs.existsSync(path.join(root, t))) walk(t);
  return files;
}

function main() {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  const files = readTree(root);
  const faults = licenseFaults(files);
  if (faults.length) {
    console.error(`  licenses: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`  licenses: ${Object.keys(files).filter(isMedia).length} media file(s), each declared exactly once`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
