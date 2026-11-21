/**
 * Makes a shortened version of the recording with ffmpeg alone (docs/plans/2026-11-21-commentary-video-revision-design.md, section 1):
 *
 *   node tools/hype/music-cut.mjs [--recording .runs/hype/music/mountain-king-musopen.flac] [--out .runs/hype/music]
 *
 * It writes `mk-a.flac` and `mk-b.flac` (every version of `music-map.json`'s `versions`) into `--out`, by the recipe in the map: the
 * recording to the join's `from`, an equal-power crossfade of `crossfadeMs` into the recording at the join's `to`, and on to the end. No
 * stretch and no gain: it is `atrim` (to the sample), `acrossfade` and nothing else, so a version is the recording itself with a part
 * played once. It checks each file's length against the recipe's (`music.mjs`'s `expectedSeconds`) to 5 ms and refuses otherwise. The
 * versions' maps are not written: `music.mjs`'s `versionMap` computes them from the same recipe.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, duration, flag } from './cutting.mjs';
import { expectedSeconds, VERSIONS } from './music.mjs';

/**
 * The filter graph of one recipe, sample-exact at `rate`. Pure.
 * @param {{ join: { from: number, to: number }, crossfadeMs: number }} recipe @param {number} rate samples a second
 */
export function cutFilter(recipe, rate) {
  const xf = recipe.crossfadeMs / 1000, a = Math.round(recipe.join.from * rate), b = Math.round((recipe.join.to - xf) * rate);
  return `[0:a]atrim=start_sample=0:end_sample=${a},asetpts=PTS-STARTPTS[a0];[0:a]atrim=start_sample=${b},asetpts=PTS-STARTPTS[a1];[a0][a1]acrossfade=d=${xf}:c1=qsin:c2=qsin[out]`;
}

/**
 * Refuses a file whose length is not the recipe's, to 5 ms. @param {number} actual @param {number} expected @param {string} [name]
 */
export function checkLength(actual, expected, name = 'the version') {
  if (Math.abs(actual - expected) > 0.005) throw new Error(`${name} came out ${actual.toFixed(3)} s but its recipe makes ${expected.toFixed(3)} s: more than 5 ms apart, so the join is not where the map says`);
}

/** The sample rate of a file's audio, read by ffprobe. @param {string} file */
const sampleRate = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim());

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const recording = flag('recording', '.runs/hype/music/mountain-king-musopen.flac'), out = flag('out', '.runs/hype/music');
  const map = JSON.parse(readFileSync('instances/divided-world/ui/hype/music-map.json', 'utf8'));
  const sha1 = createHash('sha1').update(readFileSync(recording)).digest('hex');
  if (sha1 !== map.sha1) throw new Error(`the recording's sha1 is ${sha1} but the map was measured on ${map.sha1}`);
  checkLength(duration(recording), map.seconds, 'the recording');
  const rate = sampleRate(recording);
  for (const name of VERSIONS.filter((v) => v !== 'full')) {
    const file = path.join(out, `${name}.flac`);
    run(['-i', recording, '-filter_complex', cutFilter(map.versions[name], rate), '-map', '[out]', '-c:a', 'flac', file], `cut ${name}`);
    checkLength(duration(file), expectedSeconds(map, name), name);
    console.log(`wrote ${file}: ${duration(file).toFixed(3)} s (recipe ${expectedSeconds(map, name).toFixed(3)} s)`);
  }
}
