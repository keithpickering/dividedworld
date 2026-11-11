/**
 * Tests for the guard in tools/check-sounds.mjs.
 *
 *   node tools/test-sounds.mjs
 *
 * The guard fails an instance's ui/sounds/ folder that holds an .mp3 with no manifest entry, an entry
 * with no file, an entry with a blank or missing source, license or maker, two entries for one file, a
 * file over 300 KB, or a file that is not an MP3 (docs/plans/2026-11-11-laugh-track-plan.md, Task 6).
 * This reads no file in the repository: each case writes a repository-shaped scratch folder in
 * os.tmpdir() and runs the check's function over it, and once the command, whose exit code is what
 * the build reads.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { soundsFaults } from './check-sounds.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-sounds.mjs');
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

const ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(13)]);
const SYNC = Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(14)]);
const entry = (file, over = {}) => ({ file, source: 'https://example.org/' + file, license: 'CC0', maker: 'A Maker', ...over });

/** A scratch repository with one instance whose sounds folder holds `files` and whose manifest is `manifest`. */
function scratch(files, manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-'));
  const dir = path.join(root, 'instances', 'x', 'ui', 'sounds');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    if (data === null) fs.mkdirSync(path.join(dir, name));
    else fs.writeFileSync(path.join(dir, name), data);
  }
  if (manifest !== undefined) fs.writeFileSync(path.join(dir, 'sounds.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return root;
}

function red(name, root, predicate) {
  try {
    let faults;
    try {
      faults = soundsFaults(root);
    } catch (e) {
      faults = ['threw ' + e.code];
    }
    check(name + ': refused with its predicate', faults.some((f) => predicate.test(f)), faults.length ? faults.join(' | ') : 'no fault');
    const run = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
    check(name + ': the command exits 1', run.status === 1, 'exit ' + run.status);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function green(name, root) {
  try {
    const faults = soundsFaults(root);
    check(name + ': no fault', faults.length === 0, faults.join(' | '));
    const run = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
    check(name + ': the command exits 0', run.status === 0, 'exit ' + run.status);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

red('an mp3 with no manifest entry', scratch({ 'a.mp3': ID3 }, []), /a\.mp3.*has no manifest entry/);
red('an mp3 with no manifest at all', scratch({ 'a.mp3': ID3 }), /a\.mp3.*has no manifest entry/);
red('an entry with no file', scratch({}, [entry('gone.mp3')]), /gone\.mp3.*names no file in the folder/);
for (const field of ['source', 'license', 'maker']) {
  red(`a blank ${field}`, scratch({ 'a.mp3': ID3 }, [entry('a.mp3', { [field]: '  ' })]), new RegExp(`a\\.mp3.*${field} is blank or missing`));
  const e = entry('a.mp3');
  delete e[field];
  red(`a missing ${field}`, scratch({ 'a.mp3': ID3 }, [e]), new RegExp(`a\\.mp3.*${field} is blank or missing`));
}
red('two entries for one file', scratch({ 'a.mp3': ID3 }, [entry('a.mp3'), entry('a.mp3')]), /a\.mp3.*has two manifest entries/);
red('a file over 300 KB', scratch({ 'a.mp3': Buffer.concat([ID3, Buffer.alloc(300 * 1024)]) }, [entry('a.mp3')]), /a\.mp3.*is over 300 KB/);
red('a file that is not an MP3', scratch({ 'a.mp3': Buffer.from('RIFF....WAVEfmt ') }, [entry('a.mp3')]), /a\.mp3.*is not an MP3/);
red('a frame sync with the wrong top bits', scratch({ 'a.mp3': Buffer.from([0xff, 0x1b, 0, 0]) }, [entry('a.mp3')]), /a\.mp3.*is not an MP3/);
red('an empty file', scratch({ 'a.mp3': Buffer.alloc(0) }, [entry('a.mp3')]), /a\.mp3.*is not an MP3/);

red('a wav file', scratch({ 'a.wav': Buffer.from('RIFF') }, []), /a\.wav.*is not an MP3 file name/);
red('an ogg file', scratch({ 'a.ogg': Buffer.from('OggS') }, []), /a\.ogg.*is not an MP3 file name/);
red('a backup of an mp3', scratch({ 'a.mp3.bak': ID3 }, []), /a\.mp3\.bak.*is not an MP3 file name/);
red('a directory named like an mp3', scratch({ 'd.mp3': null }, []), /d\.mp3.*is not a regular file/);
red('an AAC ADTS header', scratch({ 'a.mp3': Buffer.from([0xff, 0xf1, 0x50, 0x80]) }, [entry('a.mp3')]), /a\.mp3.*is not an MP3/);
red('a reserved MPEG version', scratch({ 'a.mp3': Buffer.from([0xff, 0xeb, 0x90, 0x00]) }, [entry('a.mp3')]), /a\.mp3.*is not an MP3/);
red('invalid JSON in the manifest', scratch({}, '{nope'), /sounds\.json.*is not valid JSON/);
red('a manifest that is not a list', scratch({}, { file: 'a.mp3' }), /sounds\.json.*is not a list/);
red('an entry with no file name', scratch({}, [{ source: 's', license: 'l', maker: 'm' }]), /sounds\.json.*an entry has no file name/);
{
  const run = spawnSync(process.execPath, [script, '--root'], { encoding: 'utf8' });
  check('--root with no value: exits 1 with a usage line', run.status === 1 && /usage/i.test(run.stderr) && !/\n\s+at /.test(run.stderr), 'exit ' + run.status + ' ' + run.stderr.split('\n')[0]);
}

green('a file of exactly 300 KB', scratch({ 'a.mp3': Buffer.concat([ID3, Buffer.alloc(300 * 1024 - ID3.length)]) }, [entry('a.mp3')]));
green('an empty manifest in an empty folder', scratch({}, []));
green('a folder with one valid ID3 file', scratch({ 'a.mp3': ID3 }, [entry('a.mp3')]));
green('a folder with one valid frame-sync file', scratch({ 'a.mp3': SYNC }, [entry('a.mp3')]));
green('a repository with no instance', fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-')));

console.log(`\n  sounds: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-sounds: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
