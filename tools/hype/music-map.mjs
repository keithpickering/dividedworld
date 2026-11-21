/**
 * The music's map: the times in a recording of "In the Hall of the Mountain King" that the commentary video is cut to
 * (docs/plans/2026-11-21-commentary-video-design.md, sections 2 and 5), measured rather than taken from the score.
 *
 *   node tools/hype/music-map.mjs [recording] [--source url] [--out instances/divided-world/ui/hype/music-map.json]
 *
 * Two envelopes are read through ffmpeg, as `onsets` in edit.mjs reads its samples: the loudness, and the loudness above 2 kHz (where
 * the violins are). From them:
 *
 *   - the first note: the first moment the sound passes 20 dB (confident);
 *   - block 2, where the violins take the theme: the first moment the high band is 22 dB over what it was through the middle of block
 *     1. It is a long crescendo with no edge, so the time is good to about a second (not confident);
 *   - the tutti entrance, which begins block 3: the first moment a quarter second of loudness is within 4 dB of the loud plateau
 *     (confident);
 *   - each hammered chord of the coda: a rise of 8 dB in one frame that peaks 2 dB over the plateau within half a second, after block 3 has
 *     begun to fall away (confident when the rise is 12 dB or more);
 *   - the final chord's end: where the last chord has fallen 35 dB from its peak.
 *
 * The recording gives no clean edge for the theme's separate entries, so each block is divided evenly into six, each marked
 * `derived: true, confident: false`. Everything is in seconds. The output also carries `source`, `seconds` and `sha1`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 10000, HOP_SAMPLES = 500, HOP = HOP_SAMPLES / RATE;

/** @param {number[]} a @param {number} q */
const quantile = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];

/**
 * @param {{ db: number[], hb: number[], hop: number }} e loudness and high-band loudness in dB, a value a `hop` seconds
 */
export function mapFromEnvelopes({ db, hb, hop }) {
  const at = (/** @type {number} */ i) => i * hop;
  const first = db.findIndex((v) => v >= 20);
  if (first < 0) throw new Error('the recording never passes 20 dB');
  const plateau = quantile(db, 0.8);

  const baseline = quantile(hb.slice(Math.round(20 / hop), Math.round(50 / hop)), 0.5);
  const b2 = hb.findIndex((v, i) => at(i) > 40 && v >= baseline + 22);
  if (b2 < 0) throw new Error('the high band never steps up');

  const quarter = Math.round(0.25 / hop);
  const mean = (/** @type {number} */ i) => db.slice(i - quarter + 1, i + 1).reduce((x, y) => x + y, 0) / quarter;
  let tutti = -1;
  for (let i = Math.max(b2, quarter); i < db.length; i++) if (mean(i) >= plateau - 4) { tutti = i; break; }
  if (tutti < 0) throw new Error('the music never reaches its plateau');

  const fallen = db.findIndex((v, i) => i > tutti + Math.round(5 / hop) && v < plateau - 8);
  if (fallen < 0) throw new Error('block 3 never falls away');
  const rise = (/** @type {number} */ i) => db[i] - Math.min(db[i - 1], db[i - 2], db[i - 3]);
  const half = Math.round(0.5 / hop);
  /** @type {{ i: number, confident: boolean }[]} */
  const chords = [];
  for (let i = fallen; i < db.length - half; i++) {
    if (rise(i) < 8 || Math.max(...db.slice(i, i + half + 1)) < plateau + 2) continue;
    if (chords.length && at(i) - at(chords.at(-1).i) < 0.6) continue;
    chords.push({ i, confident: rise(i) >= 12 });
  }
  if (!chords.length) throw new Error('the coda has no chords');
  const last = chords.at(-1).i;
  const peak = Math.max(...db.slice(last, last + half + 1));
  const end = db.findIndex((v, i) => i > last + half && v <= peak - 35);

  const entries = (/** @type {number} */ a, /** @type {number} */ b) => Array.from({ length: 6 }, (_, k) => ({ t: a + (k * (b - a)) / 6, confident: false, derived: true }));
  const edges = [at(first), at(b2), at(tutti), at(chords[0].i)];
  return {
    firstNote: { t: at(first), confident: true },
    blocks: [1, 2, 3].map((id, k) => ({ id, start: edges[k], end: edges[k + 1], confident: k === 0 || k === 2, entries: entries(edges[k], edges[k + 1]) })),
    coda: {
      chords: chords.map((c) => ({ t: at(c.i), confident: c.confident })),
      end: { t: end < 0 ? at(db.length) : at(end), confident: end >= 0 },
    },
  };
}

/** The two envelopes of a recording, read through ffmpeg. @param {string} file */
export function envelopes(file) {
  const read = (/** @type {string[]} */ filter) => {
    const pcm = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, ...filter, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 29 }).stdout;
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const out = [];
    for (let i = 0; i + HOP_SAMPLES <= samples.length; i += HOP_SAMPLES) {
      let e = 0;
      for (let j = i; j < i + HOP_SAMPLES; j++) e += samples[j] * samples[j];
      out.push(10 * Math.log10(1 + e / HOP_SAMPLES));
    }
    return out;
  };
  return { db: read([]), hb: read(['-af', 'highpass=f=2000']), hop: HOP };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (/** @type {string} */ name, /** @type {string} */ dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? '.runs/hype/music/mountain-king-musopen.flac';
  const e = envelopes(file);
  const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString());
  const map = {
    source: flag('source', 'https://archive.org/download/MusopenCollectionAsFlac/Greig_PeerGynt/EdvardGrieg-PeerGyntSuiteNo.1Op.46-04-InTheHallOfTheMountainKing.flac'),
    seconds: Math.round(seconds * 100) / 100,
    sha1: createHash('sha1').update(readFileSync(file)).digest('hex'),
    ...mapFromEnvelopes(e),
  };
  const out = flag('out', '');
  const text = JSON.stringify(map, (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 2) + '\n';
  if (out) writeFileSync(out, text); else process.stdout.write(text);
}
