/**
 * Writes each sound's measurement into its manifest entry.
 *
 *   node tools/measure-sounds.mjs [--root <directory>]     (default: the repository)
 *
 * A tool run by hand after a sound is added or replaced, outside the build: the build needs no decoder, and
 * tools/check-sounds.mjs only holds that the numbers are true to the file's bytes. For every
 * `instances/*\/ui/sounds/` folder, for every entry of `sounds.json`, it runs
 * `ffmpeg -hide_banner -nostats -i <file> -af ebur128=peak=true -f null -`, reads the summary's `I:` (integrated
 * loudness, LUFS) and `Peak:` (true peak, dBFS), and writes `lufs` and `peak` (one decimal) and `sha256` (hex, of
 * the file's bytes) into the entry, keeping every other field and the file's order and formatting. It says which
 * entries changed. With no ffmpeg on the path it says so and exits 1, changing nothing.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function measure(file) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  if (run.error) return { error: `ffmpeg could not be run on ${file}: ${run.error.message}` };
  // The summary is the last block of stderr; the running lines before it also carry `I:`.
  const summary = run.stderr.slice(run.stderr.lastIndexOf('Summary:'));
  const lufs = /^\s*I:\s+(-?[\d.]+|-inf)\s+LUFS/m.exec(summary);
  const peak = /^\s*Peak:\s+(-?[\d.]+|-inf)\s+dBFS/m.exec(summary);
  if (run.status !== 0 || !lufs || !peak) return { error: `ffmpeg gave no loudness summary for ${file}` };
  const values = { lufs: Number(lufs[1]), peak: Number(peak[1]) };
  // `-inf` matches the patterns and is not a number: a silent file has no level to write.
  if (!Number.isFinite(values.lufs) || !Number.isFinite(values.peak)) return { error: `${file} has no measurable level (silent)` };
  return values;
}

function main() {
  const i = process.argv.indexOf('--root');
  if (i !== -1 && !process.argv[i + 1]) {
    console.error('  usage: node tools/measure-sounds.mjs [--root <directory>]');
    process.exit(1);
  }
  const root = path.resolve(i === -1 ? repoRoot : process.argv[i + 1]);
  if (spawnSync('ffmpeg', ['-version']).error) {
    console.error('  measure-sounds: ffmpeg is not on the path; nothing changed');
    process.exit(1);
  }
  const inst = path.join(root, 'instances');
  const folders = fs.existsSync(inst)
    ? fs.readdirSync(inst).sort().map((n) => path.join(inst, n, 'ui', 'sounds')).filter((d) => fs.existsSync(path.join(d, 'sounds.json')))
    : [];
  const writes = [];
  let changed = 0;
  for (const dir of folders) {
    const manifestFile = path.join(dir, 'sounds.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const next = [];
    for (const e of manifest) {
      const file = path.join(dir, e.file);
      if (!fs.existsSync(file)) {
        console.error(`  measure-sounds: ${file} is in the manifest and not in the folder; nothing changed`);
        process.exit(1);
      }
      const m = measure(file);
      if (m.error) {
        console.error('  measure-sounds: ' + m.error + '; nothing changed');
        process.exit(1);
      }
      const measured = {
        lufs: Math.round(m.lufs * 10) / 10,
        peak: Math.round(m.peak * 10) / 10,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      };
      const moved = Object.keys(measured).filter((k) => e[k] !== measured[k]);
      if (moved.length) {
        changed++;
        console.log(`  ${e.file}: ${moved.join(', ')} (lufs ${measured.lufs}, peak ${measured.peak})`);
      }
      next.push({ ...e, ...measured });
    }
    writes.push([manifestFile, JSON.stringify(next, null, 2) + '\n']);
  }
  for (const [f, text] of writes) fs.writeFileSync(f, text);
  console.log(`  measure-sounds: ${changed} entr${changed === 1 ? 'y' : 'ies'} changed in ${folders.length} folder(s)`);
}

main();
