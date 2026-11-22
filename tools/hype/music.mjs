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
 * A LENGTHENED version is the same in reverse (the revision design, section 11): `{ repeat: [first, last], times, join: { out, in }, crossfadeMs }`
 * plays the recording to `out` (the rest before the statement after `last`), crossfades back to `in` (the rest before statement `first`'s downbeat)
 * and plays `first` to `last` again, `times` times in all, and on to the end. What is added is `times * (out - in)`, which is the length of the
 * repeated statements. Only a pair of block 1 may be repeated, for the reason a pair may be removed from it (one tempo, one level). The map of
 * such a version carries every statement, a repeated one with the recording's own `n` and a `copy` (0 for the original, 1 for its first repeat).
 *
 * A VERSION's map (`versionMap`) is the same shape with the removed statements gone and every later time earlier by what was removed.
 * The statement before the join is lengthened or shortened to end where the next one now begins, so each still ends where the next
 * begins. Only statements of block 1 may be removed: it is at a constant tempo and level, so a pair taken out of it leaves a step under
 * one percent; block 2 accelerates and a join there is audible.
 */

export const VERSIONS = ['full', 'mk-a', 'mk-b', 'mk-plus1', 'mk-plus2', 'mk-plus3'];

/** @typedef {{ n: number, block: number, start: number, length: number, beats: number, confident: boolean, original?: number, copy?: number }} Statement */
/** @typedef {{ name: string, seconds: number, drone: { start: number, end: number, confident: boolean }, statements: Statement[], coda: { chords: { t: number, confident: boolean }[], end: { t: number, confident: boolean } }, joins: { t: number, crossfadeMs: number }[] }} Version */

/** The seconds a version's file must run: the recording's length less what its join removes. @param {{ seconds: number, versions?: Record<string, any> }} map @param {string} name */
export function expectedSeconds(map, name) {
  if (name === 'full') return map.seconds;
  const r = recipe(map, name);
  return map.seconds + added(r);
}

/** The seconds a recipe adds to the recording: negative when it removes. @param {any} r */
const added = (r) => (r.repeat ? r.times * (r.join.out - r.join.in) : -(r.join.to - r.join.from));

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
  if (r.repeat) return repeated(map, name, r, base);
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

/** @param {any} map @param {string} name @param {any} r @param {{ drone: any, coda: any }} base @returns {Version} */
function repeated(map, name, r, base) {
  const [first, last] = r.repeat;
  const inBlockOne = (/** @type {number} */ n) => map.statements.find((/** @type {Statement} */ s) => s.n === n)?.block === 1;
  if (!Number.isInteger(r.times) || r.times < 1) throw new Error(`${name} repeats ${r.times} times: \`times\` is a whole number of repeats, 1 or more`);
  if (!(first > 1) || !(last >= first) || !inBlockOne(first) || !inBlockOne(last)) throw new Error(`${name} repeats statements ${first} to ${last}: only statements of block 1 after the first (statement 1 stays alone) may be repeated, in a constant tempo`);
  const loop = r.join.out - r.join.in, total = r.times * loop;
  /** @type {Statement[]} */
  const out = [];
  for (const s of map.statements) {
    if (s.n >= first && s.n <= last) for (let k = 0; k <= r.times; k++) out.push({ ...s, original: s.n, copy: k, start: s.start + k * loop });
    else out.push({ ...s, original: s.n, copy: 0, start: s.n > last ? s.start + total : s.start });
  }
  out.sort((a, b) => a.start - b.start);
  /* The statement a join leaves ends where the one it enters begins. */
  out.forEach((s, i) => { if (i + 1 < out.length && s.n === last) s.length = out[i + 1].start - s.start; });
  const shift = (/** @type {number} */ t) => t + total;
  const coda = { chords: base.coda.chords.map((/** @type {{ t: number, confident: boolean }} */ c) => ({ ...c, t: shift(c.t) })), end: { ...base.coda.end, t: shift(base.coda.end.t) } };
  const joins = Array.from({ length: r.times }, (_, k) => ({ t: r.join.out + k * loop, crossfadeMs: r.crossfadeMs }));
  return { name, seconds: map.seconds + total, drone: structuredClone(map.drone), statements: out, coda, joins };
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
 * The coda's strikes that matter to the ending (the revision design, section 9): the first chord, the TITLE's strike (the second-to-last chord,
 * where "DIVIDED WROLD" is shown) and the FINAL strike (the last chord, where the parenthetical is shown), and where the final chord ends. All
 * in seconds of the version. Refuses a coda with fewer than three chords: the title needs two strikes of its own after a first.
 * @param {Version} version
 * @returns {{ first: number, title: number, final: number, end: number }}
 */
export function titleStrikes(version) {
  const chords = version.coda.chords;
  if (chords.length < 3) throw new Error(`the coda has ${chords.length} chords: the title takes the last two strikes and the narration needs a first chord before them (3 chords at least)`);
  return { first: chords[0].t, title: chords[chords.length - 2].t, final: chords[chords.length - 1].t, end: version.coda.end.t };
}
