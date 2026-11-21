/**
 * A contact sheet of a take, for looking a film over without playing it: the named frames, two across.
 *
 *   node tools/hype/sheet.mjs <film.mp4> <frame,frame,...> [crop as w:h:x:y]
 *
 * Writes <film>-sheet.jpg beside the film.
 */
import { spawnSync } from 'node:child_process';

const [film, frames, crop] = process.argv.slice(2);
if (!film || !frames) throw new Error('usage: node tools/hype/sheet.mjs <film.mp4> <frame,frame,...> [w:h:x:y]');
const list = frames.split(',').map(Number);
const select = list.map((n) => `eq(n\\,${n})`).join('+');
const out = film.replace(/\.mp4$/u, '-sheet.jpg');
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', film, '-vf', `select='${select}',${crop ? `crop=${crop},` : ''}scale=760:-1,tile=2x${Math.ceil(list.length / 2)}`, '-frames:v', '1', '-vsync', '0', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(out);
