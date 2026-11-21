/**
 * The measured recording and its shortened versions (docs/plans/2026-11-21-commentary-video-revision-design.md, section 1). Pure: it reads
 * `music-map.json`'s shape and touches nothing else; `music-cut.mjs` renders the versions with ffmpeg.
 *
 * The map holds the recording's `drone` (the held note before the theme), its eighteen `statements` (`n`, `block`, `start`, `length`,
 * `beats` 16, `confident`), the coda's `chords` and the final chord's `end`, all in seconds of the recording, and `versions`: a recipe
 * for each shortened one, `{ remove: [first, last], join: { from, to }, crossfadeMs }`. A recipe takes statements `first` to `last` out
 * by playing the recording up to `from`, crossfading (equal power, `crossfadeMs`) into it again at `to`, and on to the end. Both times
 * are in the recording, and both fall in the rests before a statement's downbeat; what is removed is `to - from`, which is the length
 * of the statements removed within 20 ms (the analysis put the entering downbeat a few ms off the grid).
 *
 * A VERSION's map (`versionMap`) is the same shape with the removed statements gone and every later time earlier by what was removed.
 * The statement before the join is lengthened or shortened to end where the next one now begins, so each still ends where the next
 * begins. Only statements of block 1 may be removed: it is at a constant tempo and level, so a pair taken out of it leaves a step under
 * one percent; block 2 accelerates and a join there is audible.
 */

export const VERSIONS = ['full', 'mk-a', 'mk-b'];

/** @typedef {{ n: number, block: number, start: number, length: number, beats: number, confident: boolean, original?: number }} Statement */
/** @typedef {{ name: string, seconds: number, drone: { start: number, end: number, confident: boolean }, statements: Statement[], coda: { chords: { t: number, confident: boolean }[], end: { t: number, confident: boolean } }, joins: { t: number, crossfadeMs: number }[] }} Version */

/** The seconds a version's file must run: the recording's length less what its join removes. @param {{ seconds: number, versions?: Record<string, any> }} map @param {string} name */
export function expectedSeconds(map, name) {
  if (name === 'full') return map.seconds;
  const r = recipe(map, name);
  return map.seconds - (r.join.to - r.join.from);
}

/** @param {{ versions?: Record<string, any> }} map @param {string} name */
function recipe(map, name) {
  const r = map.versions?.[name];
  if (!r) throw new Error(`there is no version ${JSON.stringify(name)}: the map's are ${['full', ...Object.keys(map.versions ?? {})].join(', ')}`);
  return r;
}

/**
 * @param {any} map the committed music map
 * @param {string} name `full` or a version of the map
 * @returns {Version}
 */
export function versionMap(map, name) {
  const base = { drone: map.drone, coda: map.coda };
  if (name === 'full') return { name, seconds: map.seconds, ...structuredClone(base), statements: map.statements.map((/** @type {Statement} */ s) => ({ ...s, original: s.n })), joins: [] };
  const r = recipe(map, name);
  const [first, last] = r.remove;
  const inBlockOne = (/** @type {number} */ n) => map.statements.find((/** @type {Statement} */ s) => s.n === n)?.block === 1;
  if (!(first > 1) || !(last >= first) || !inBlockOne(first) || !inBlockOne(last)) throw new Error(`${name} removes statements ${first} to ${last}: only statements of block 1 after the first may be removed (a join in block 2's accelerando is audible)`);
  const removed = r.join.to - r.join.from;
  const shift = (/** @type {number} */ t) => t - removed;
  /** @type {Statement[]} */
  const statements = map.statements.filter((/** @type {Statement} */ s) => s.n < first || s.n > last).map((/** @type {Statement} */ s) => ({ ...s, original: s.n, start: s.n > last ? shift(s.start) : s.start }));
  const at = statements.findIndex((s) => s.n > last);
  statements[at - 1].length = statements[at].start - statements[at - 1].start;
  const coda = { chords: map.coda.chords.map((/** @type {{ t: number, confident: boolean }} */ c) => ({ ...c, t: shift(c.t) })), end: { ...map.coda.end, t: shift(map.coda.end.t) } };
  return { name, seconds: map.seconds - removed, drone: structuredClone(map.drone), statements, coda, joins: [{ t: r.join.from, crossfadeMs: r.crossfadeMs }] };
}

/**
 * Every beat of a version, in seconds of the version: sixteen to a statement, evenly within it. Statement 1's first beat is its start.
 * @param {any} map @param {string} name
 * @returns {number[]}
 */
export function beats(map, name) {
  return versionMap(map, name).statements.flatMap((s) => Array.from({ length: s.beats }, (_, k) => s.start + (k * s.length) / s.beats));
}

/**
 * The `lines` longest gaps between the coda's chords, in the order they come: a line is spoken into a gap, and the longer the gap the
 * more of the line survives the next chord. Each is `{ start, end, length, confident }`. Refuses when the coda has fewer gaps than lines.
 * @param {Version} version @param {number} lines
 */
export function codaGaps(version, lines) {
  const chords = version.coda.chords;
  const all = chords.slice(1).map((c, i) => ({ start: chords[i].t, end: c.t, length: c.t - chords[i].t, confident: chords[i].confident !== false && c.confident !== false }));
  if (all.length < lines) throw new Error(`n11 has ${lines} lines but the coda has only ${all.length} gaps between its chords`);
  const keep = new Set([...all].sort((x, y) => y.length - x.length).slice(0, lines));
  return all.filter((g) => keep.has(g));
}
