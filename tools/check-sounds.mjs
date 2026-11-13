/**
 * Guard: an instance's sound folder lists every sound it holds, credits it, and holds only MP3s of a sane size.
 *
 *   node tools/check-sounds.mjs [--root <directory>]     (default: the repository)
 *
 * The design is docs/plans/2026-11-11-laugh-track-plan.md (Task 6). An instance keeps its sounds in
 * `ui/sounds/`: `.mp3` files and `sounds.json`, a list of `{ file, source, license, maker, lufs,
 * peak, sha256 }`: the first four non-empty strings, `file` a name in the same folder, and the last three
 * its measurement. Every such folder, of every instance, must pass:
 *
 * 1. every `.mp3` has a manifest entry;
 * 2. every entry names a file that is in the folder;
 * 3. every entry's `source`, `license` and `maker` is a non-blank string;
 * 4. no file has two entries;
 * 5. no file is over 300 KB;
 * 6. every file is an MP3: it starts with `ID3`, or with an MPEG frame sync (`0xFF`, then a byte whose
 *    top three bits are set, the version bits not the reserved `01` and the layer bits not `00`, which
 *    is what AAC's ADTS header, `0xFF 0xF1`, has). Only the first bytes are read; nothing is decoded;
 * 7. the folder holds nothing but `.mp3` regular files and `sounds.json`: a `.wav`, a `.mp3.bak` or
 *    a directory is a fault of its own, named.
 *
 * An empty manifest in an empty folder passes, and so does a repository with no sounds folder.
 *
 * `soundsFaults` is exported and reads only the root it is handed, so tools/test-sounds.mjs drives it
 * red over scratch folders. No instance is named here.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 300 * 1024;
const FIELDS = ['source', 'license', 'maker'];

/** Every `instances/*\/ui/sounds/` directory under a root. */
function soundFolders(root) {
  const inst = path.join(root, 'instances');
  if (!fs.existsSync(inst)) return [];
  const out = [];
  for (const i of fs.readdirSync(inst, { withFileTypes: true })) {
    const dir = path.join(inst, i.name, 'ui', 'sounds');
    if (i.isDirectory() && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) out.push(dir);
  }
  return out.sort();
}

function isMp3(head) {
  if (head.length >= 3 && head.subarray(0, 3).toString('latin1') === 'ID3') return true;
  return head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x18) !== 0x08 && (head[1] & 0x06) !== 0;
}

function folderFaults(dir) {
  const faults = [];
  const at = (name, text) => faults.push(`${path.join(dir, name)}: ${text}`);
  const files = [];
  for (const n of fs.readdirSync(dir).sort()) {
    if (n === 'sounds.json') continue;
    if (!fs.statSync(path.join(dir, n)).isFile()) at(n, 'is not a regular file');
    else if (!n.toLowerCase().endsWith('.mp3')) at(n, 'is not an MP3 file name (only .mp3 files and sounds.json belong here)');
    else files.push(n);
  }

  let manifest = [];
  const manifestFile = path.join(dir, 'sounds.json');
  if (fs.existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      at('sounds.json', 'is not valid JSON');
    }
    if (!Array.isArray(manifest)) {
      at('sounds.json', 'is not a list');
      manifest = [];
    }
  }

  const seen = new Set();
  for (const e of manifest) {
    const file = e && typeof e.file === 'string' ? e.file : '';
    if (!file.trim()) {
      at('sounds.json', 'an entry has no file name');
      continue;
    }
    if (seen.has(file)) at(file, 'has two manifest entries');
    seen.add(file);
    if (!files.includes(file)) at(file, 'names no file in the folder');
    for (const f of FIELDS) if (typeof e[f] !== 'string' || !e[f].trim()) at(file, `${f} is blank or missing`);
    for (const f of ['lufs', 'peak']) {
      if (typeof e[f] !== 'number' || !Number.isFinite(e[f])) at(file, `${f} is not a finite number (run node tools/measure-sounds.mjs)`);
    }
    if (typeof e.lufs === 'number' && Number.isFinite(e.lufs) && e.lufs > 0) at(file, 'lufs is above 0 (run node tools/measure-sounds.mjs)');
    if (typeof e.sha256 !== 'string' || !e.sha256) at(file, 'sha256 is missing (run node tools/measure-sounds.mjs)');
    else if (files.includes(file) && e.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')) {
      at(file, "sha256 is not the file's (the file was replaced; run node tools/measure-sounds.mjs)");
    }
  }

  for (const name of files) {
    if (!seen.has(name)) at(name, 'has no manifest entry');
    const full = path.join(dir, name);
    if (fs.statSync(full).size > MAX) at(name, 'is over 300 KB');
    const fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(3);
    const n = fs.readSync(fd, head, 0, 3, 0);
    fs.closeSync(fd);
    if (!isMp3(head.subarray(0, n))) at(name, 'is not an MP3 (no ID3 tag and no MPEG frame sync)');
  }
  return faults;
}

/**
 * Every fault in the sound folders under a root: a list of lines, each naming the file and the rule
 * it broke; empty when all is well.
 * @param {string} root
 */
export function soundsFaults(root) {
  return soundFolders(root).flatMap(folderFaults);
}

function main() {
  const i = process.argv.indexOf('--root');
  if (i !== -1 && !process.argv[i + 1]) {
    console.error('  usage: node tools/check-sounds.mjs [--root <directory>]');
    process.exit(1);
  }
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  const faults = soundsFaults(root);
  const rel = (s) => s.split(root + path.sep).join('');
  if (faults.length) {
    console.error(`  sounds: ${faults.length} fault(s):`);
    for (const f of faults) console.error(`    ${rel(f)}`);
    process.exit(1);
  }
  console.log(`  sounds: ${soundFolders(root).length} sound folder(s) list every file, credit it, measure it, and hold only MP3s under 300 KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
