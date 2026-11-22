/**
 * Makes a shortened version of the recording with ffmpeg alone (docs/plans/2026-11-21-commentary-video-revision-design.md, section 1):
 *
 *   node tools/hype/music-cut.mjs [--recording .runs/hype/music/mountain-king-musopen.flac] [--out .runs/hype/music] [--listen .runs/hype/musiccut]
 *
 * It writes `mk-a.flac`, `mk-b.flac` and the lengthened `mk-plus1.flac` to `mk-plus3.flac` (every version of `music-map.json`'s `versions`) into `--out`, by the recipe in the map: the
 * recording to the join's `from`, an equal-power crossfade of `crossfadeMs` into the recording at the join's `to`, and on to the end. No
 * stretch and no gain: it is `atrim` (to the sample), `acrossfade` and nothing else, so a version is the recording itself with a part
 * played once. It checks each file's length against the recipe's (`music.mjs`'s `expectedSeconds`) to 5 ms and refuses otherwise. The
 * lengthened versions also get a 192k MP3 and a 6 s excerpt around each join in `--listen`. The versions' maps are not written: `music.mjs`'s `versionMap` computes them from the same recipe.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, duration, flag } from './cutting.mjs';
import { expectedSeconds, versionMap, VERSIONS } from './music.mjs';

/**
 * The filter graph of one recipe, sample-exact at `rate`. Pure. A repeat reads the recording as `times + 1` inputs (`inputs`): one `asplit` of it stalls on parts that far apart.
 * @param {any} recipe a `remove` recipe (`join: { from, to }`) or a `repeat` one (`repeat`, `times`, `join: { out, in }`) @param {number} rate samples a second
 */
export function cutFilter(recipe, rate) {
  const xf = recipe.crossfadeMs / 1000;
  if (recipe.repeat) {
    /* A repeat: to the out point; then `times` times a crossfade back to the in point (the part begins a crossfade before it, so the fade ends on it) and on to the out point again, the last on to the end. */
    const out = Math.round(recipe.join.out * rate), back = Math.round((recipe.join.in - xf) * rate), n = recipe.times;
    const parts = [`[0:a]atrim=start_sample=0:end_sample=${out},asetpts=PTS-STARTPTS[p0]`];
    for (let k = 1; k <= n; k++) parts.push(k < n ? `[${k}:a]atrim=start_sample=${back}:end_sample=${out},asetpts=PTS-STARTPTS[p${k}]` : `[${k}:a]atrim=start_sample=${back},asetpts=PTS-STARTPTS[p${k}]`);
    let chain = 'p0';
    const joins = [];
    for (let k = 1; k <= n; k++) { joins.push(`[${chain}][p${k}]acrossfade=d=${xf}:c1=qsin:c2=qsin[x${k}]`); chain = `x${k}`; }
    return `${parts.join(';')};${joins.join(';')};[${chain}]anull[out]`;
  }
  const a = Math.round(recipe.join.from * rate), b = Math.round((recipe.join.to - xf) * rate);
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
  const recording = flag('recording', '.runs/hype/music/mountain-king-musopen.flac'), out = flag('out', '.runs/hype/music'), listen = flag('listen', '.runs/hype/musiccut');
  const map = JSON.parse(readFileSync('instances/divided-world/ui/hype/music-map.json', 'utf8'));
  const sha1 = createHash('sha1').update(readFileSync(recording)).digest('hex');
  if (sha1 !== map.sha1) throw new Error(`the recording's sha1 is ${sha1} but the map was measured on ${map.sha1}`);
  checkLength(duration(recording), map.seconds, 'the recording');
  const rate = sampleRate(recording);
  for (const name of VERSIONS.filter((v) => v !== 'full')) {
    const file = path.join(out, `${name}.flac`);
    run([...Array.from({ length: (map.versions[name].times ?? 0) + 1 }).flatMap(() => ['-i', recording]), '-filter_complex', cutFilter(map.versions[name], rate), '-map', '[out]', '-c:a', 'flac', file], `cut ${name}`);
    checkLength(duration(file), expectedSeconds(map, name), name);
    console.log(`wrote ${file}: ${duration(file).toFixed(3)} s (recipe ${expectedSeconds(map, name).toFixed(3)} s)`);
    /* For the owner's ear: a 192k MP3 of each lengthened version and a 6 s excerpt around each of its joins. */
    if (map.versions[name].repeat && listen) {
      mkdirSync(listen, { recursive: true });
      run(['-i', file, '-b:a', '192k', path.join(listen, `${name}.mp3`)], `write ${name}.mp3`);
      versionMap(map, name).joins.forEach((j, k) => run(['-ss', String(Math.max(0, j.t - 3)), '-t', '6', '-i', file, '-b:a', '192k', path.join(listen, `${name}-join${k + 1}.mp3`)], `excerpt ${name} join ${k + 1}`));
    }
  }
}
