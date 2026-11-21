/**
 * What the film's two edits share: running ffmpeg and refusing when it fails, writing an expression inside a filter, asking ffprobe
 * about a file, and finding a font by the name it was asked for. Nothing here touches a take; `edit.mjs` (round 1's) and
 * `edit-commentary.mjs` each use it.
 */
import { spawnSync } from 'node:child_process';

/** The value after a flag on the command line, or `otherwise`. @param {string} name @param {any} otherwise @returns {any} */
export function flag(name, otherwise) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : otherwise;
}

/** Run ffmpeg, quietly, and throw naming `label` if it fails. @param {string[]} args @param {string} label */
export const run = (args, label) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg could not ${label}`);
};

/** An expression inside a filter: its commas are the filter graph's unless they are escaped. @param {string} e */
export const expr = (e) => e.replace(/,/gu, '\\,');

/** A file's duration in seconds, read by ffprobe. @param {string} file */
export function duration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const seconds = Number(r.stdout.trim());
  if (r.status !== 0 || !Number.isFinite(seconds)) throw new Error(`ffprobe could not read the length of ${file}`);
  return seconds;
}

/** A file's first video stream's size and frame rate, read by ffprobe. @param {string} file @returns {{ width: number, height: number, fps: number }} */
export function videoInfo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [width, height, rate] = r.stdout.trim().split(',');
  if (r.status !== 0 || !rate) throw new Error(`ffprobe could not read the picture of ${file}`);
  const [a, b] = rate.split('/').map(Number);
  return { width: Number(width), height: Number(height), fps: a / (b || 1) };
}

/**
 * The font file of the family asked for, or null. fontconfig always answers with its nearest match, so the answer counts only when
 * the family it names is the one asked for.
 * @param {string} family
 * @param {string} [style] such as `bold`
 * @returns {string | null}
 */
export function fontFile(family, style = '') {
  const r = spawnSync('fc-match', ['-f', '%{family}\n%{file}', style ? `${family}:${style}` : family], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const [found, file] = r.stdout.split('\n');
  return found.split(',').some((f) => f.trim().toLowerCase() === family.toLowerCase()) ? file : null;
}
