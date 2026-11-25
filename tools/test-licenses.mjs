/**
 * Tests for the guard in tools/check-licenses.mjs.
 *
 *   node tools/test-licenses.mjs
 *
 * The guard fails a media file whose terms are declared nowhere or twice, a declaration of a file that is not
 * there, a bad `licenses.json` row, and a font with terms of its own and no license text beside it
 * (docs/plans/2026-11-25-licensing-design.md, section 6; the plan's Task 1). `licenseFaults` is a pure function
 * of a map from repository path to content, so every case here feeds it a fixture and reads no file in the
 * repository; the last cases write a scratch folder and run the command, whose exit code is what the build reads.
 *
 * A clean fixture must pass, and each of the five poisons the plan names must be refused, with the predicate and
 * the path in the line. The extra cases hold the edges a first reading misses: a stray picture in a card folder,
 * a row with terms of its own and no source, and a `licenses.json` that is not an array.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenseFaults } from './check-licenses.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-licenses.mjs');
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

const OFL = { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' };
const row = (over = {}) => ({ files: ['fonts/x.woff2'], maker: 'A Foundry', terms: OFL, source: 'https://github.com/a/x', licenseFile: 'OFL.txt', ...over });
const json = (v) => JSON.stringify(v);

/** A clean fixture: one of each declaration kind, every media file declared exactly once. */
function clean() {
  return {
    'instances/i/ui/cards/a-card/art.json': json({ credit: 'Me', license: 'CC0' }),
    'instances/i/ui/cards/a-card/art.webp': '',
    'instances/i/ui/cards/a-card/mark.svg': '',
    'instances/i/ui/cards/a-card/scene.py': '',
    'instances/i/ui/sounds/sounds.json': json([{ file: 'boo.mp3', source: 'S', license: 'L', maker: 'M' }]),
    'instances/i/ui/sounds/boo.mp3': '',
    'instances/i/ui/theme/CREDITS.md': '# Credits\n\n| File | Author |\n| --- | --- |\n| `fire.gif` | Nevit |\n',
    'instances/i/ui/theme/fire.gif': '',
    'instances/i/licenses.json': json([
      row({ files: ['ui/fonts/x.woff2'] }),
      { files: ['ui/icon.png'], maker: 'Divided World', terms: 'layer', note: 'Made by tools/make-icons.mjs' },
    ]),
    'instances/i/ui/fonts/x.woff2': '',
    'instances/i/ui/fonts/OFL.txt': 'license text',
    'instances/i/ui/icon.png': '',
    'engine/ui/readme.md': '',
  };
}

/** The fixture with `edit(files)` applied. */
function poisoned(edit) {
  const f = clean();
  edit(f);
  return f;
}

check('clean fixture passes', licenseFaults(clean()).length === 0, licenseFaults(clean()).join(' | '));

/** Asserts a fixture is refused with a line naming `path` and matching `predicate`. */
function refused(name, files, at, predicate) {
  const faults = licenseFaults(files);
  check(name, faults.some((f) => f.includes(at) && predicate.test(f)), faults.length ? faults.join(' | ') : 'no fault at all');
}

// The five poisons the plan names.
refused('poison 1: an undeclared x.woff2', poisoned((f) => { f['instances/i/ui/fonts/loose/x.woff2'] = ''; }), 'ui/fonts/loose/x.woff2', /declared nowhere/u);
refused(
  'poison 2: a licenses.json row listing gone.png, which does not exist',
  poisoned((f) => { f['instances/i/licenses.json'] = json([...JSON.parse(f['instances/i/licenses.json']), { files: ['gone.png'], maker: 'M', terms: 'layer' }]); }),
  'instances/i/gone.png',
  /does not exist/u,
);
refused(
  'poison 3: art.webp declared by its folder\'s art.json and again by licenses.json',
  poisoned((f) => { f['instances/i/licenses.json'] = json([...JSON.parse(f['instances/i/licenses.json']), { files: ['ui/cards/a-card/art.webp'], maker: 'M', terms: 'layer' }]); }),
  'instances/i/ui/cards/a-card/art.webp',
  /declared twice.*art\.json.*licenses\.json/u,
);
refused(
  'poison 4: a row with terms { name: "", url: "https://x" }',
  poisoned((f) => { f['instances/i/licenses.json'] = json([row({ files: ['ui/fonts/x.woff2'], terms: { name: '', url: 'https://x' } }), { files: ['ui/icon.png'], maker: 'M', terms: 'layer' }]); }),
  'instances/i/licenses.json',
  /terms/u,
);
refused(
  'poison 5: a font row with terms of its own and no licenseFile',
  poisoned((f) => { f['instances/i/licenses.json'] = json([row({ files: ['ui/fonts/x.woff2'], licenseFile: undefined }), { files: ['ui/icon.png'], maker: 'M', terms: 'layer' }]); }),
  'instances/i/ui/fonts/x.woff2',
  /licenseFile/u,
);

// The edges.
refused('a licenseFile that names no file in the font\'s folder', poisoned((f) => { delete f['instances/i/ui/fonts/OFL.txt']; }), 'instances/i/ui/fonts/x.woff2', /licenseFile/u);
refused('a stray .png in a card folder is not covered by art.json', poisoned((f) => { f['instances/i/ui/cards/a-card/stray.png'] = ''; }), 'a-card/stray.png', /declared nowhere/u);
refused('a blank maker', poisoned((f) => { f['instances/i/licenses.json'] = json([row({ files: ['ui/fonts/x.woff2'], maker: ' ' }), { files: ['ui/icon.png'], maker: 'M', terms: 'layer' }]); }), 'instances/i/licenses.json', /maker/u);
refused('a row with terms of its own and no source', poisoned((f) => { f['instances/i/licenses.json'] = json([row({ files: ['ui/fonts/x.woff2'], source: undefined }), { files: ['ui/icon.png'], maker: 'M', terms: 'layer' }]); }), 'instances/i/licenses.json', /source/u);
refused('a licenses.json that is not JSON', poisoned((f) => { f['instances/i/licenses.json'] = '[{'; }), 'instances/i/licenses.json', /not JSON/u);
refused('a licenses.json that is not an array', poisoned((f) => { f['instances/i/licenses.json'] = json({ files: [] }); }), 'instances/i/licenses.json', /array/u);
refused('a licenseFile that is not a bare file name (../OFL.txt)', poisoned((f) => { f['instances/i/ui/OFL.txt'] = 'x'; f['instances/i/licenses.json'] = json([row({ files: ['ui/fonts/x.woff2'], licenseFile: '../OFL.txt' }), { files: ['ui/icon.png'], maker: 'M', terms: 'layer' }]); }), 'instances/i/ui/fonts/x.woff2', /licenseFile/u);
refused('a licenseFile in a subfolder (sub/OFL.txt)', poisoned((f) => { f['instances/i/ui/fonts/sub/OFL.txt'] = 'x'; f['instances/i/licenses.json'] = json([row({ files: ['ui/fonts/x.woff2'], licenseFile: 'sub/OFL.txt' }), { files: ['ui/icon.png'], maker: 'M', terms: 'layer' }]); }), 'instances/i/ui/fonts/x.woff2', /licenseFile/u);
refused('a licenses.json file reaching out of its folder with ../', poisoned((f) => { f['instances/other.png'] = ''; f['instances/i/licenses.json'] = json([...JSON.parse(f['instances/i/licenses.json']), { files: ['../other.png'], maker: 'M', terms: 'layer' }]); }), 'instances/other.png', /outside/u);
refused('a sounds.json file reaching out of its folder with ../', poisoned((f) => { f['instances/i/ui/other.mp3'] = ''; f['instances/i/ui/sounds/sounds.json'] = json([{ file: '../other.mp3', source: 'S', license: 'L', maker: 'M' }]); }), 'instances/i/ui/other.mp3', /outside/u);
refused('a backticked name in a non-first CREDITS.md column declares nothing', poisoned((f) => { f['instances/i/ui/theme/CREDITS.md'] = '| File | Work |\n| --- | --- |\n| Fire | `fire.gif` |\n'; }), 'instances/i/ui/theme/fire.gif', /declared nowhere/u);
refused('a sounds.json row naming a missing mp3', poisoned((f) => { delete f['instances/i/ui/sounds/boo.mp3']; }), 'instances/i/ui/sounds/boo.mp3', /does not exist/u);
refused('a CREDITS.md row naming a missing file', poisoned((f) => { delete f['instances/i/ui/theme/fire.gif']; }), 'instances/i/ui/theme/fire.gif', /does not exist/u);
refused('a sounds.json and a licenses.json both declaring a file', poisoned((f) => { f['instances/i/licenses.json'] = json([...JSON.parse(f['instances/i/licenses.json']), { files: ['ui/sounds/boo.mp3'], maker: 'M', terms: 'layer' }]); }), 'ui/sounds/boo.mp3', /declared twice/u);
check('a media extension in capitals is still media', licenseFaults(poisoned((f) => { f['instances/i/ui/LOUD.PNG'] = ''; })).some((x) => x.includes('LOUD.PNG')));
check('a file that is not media needs no declaration', licenseFaults(poisoned((f) => { f['instances/i/ui/notes.txt'] = ''; })).length === 0);

// The command: the exit code the build reads.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'licenses-'));
function write(files) {
  for (const [p, c] of Object.entries(files)) {
    const full = path.join(scratch, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, c);
  }
}
write(clean());
check('the command exits 0 over the clean fixture', spawnSync('node', [script, '--root', scratch], { encoding: 'utf8' }).status === 0);
write({ 'instances/i/ui/undeclared.gif': '' });
const bad = spawnSync('node', [script, '--root', scratch], { encoding: 'utf8' });
check('the command exits 1 and names the file over a poisoned tree', bad.status === 1 && bad.stderr.includes('undeclared.gif'), bad.stderr);
fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
