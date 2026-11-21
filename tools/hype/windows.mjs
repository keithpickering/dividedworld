/**
 * The music's windows: where each commentary node of parts two and three sits in the recording, which cannot stretch, so a voice clip
 * must fit the window it is given (docs/plans/2026-11-21-commentary-video-design.md, section 5). Pure: it reads a map (music-map.json's
 * shape: music.mjs's) and arguments, and touches nothing else.
 *
 * Nodes 5 and 6 share block 1, 7 and 8 block 2, 9 and 10 block 3. A block is split between its two nodes by `shares` (default
 * [0.5, 0.5], [0.6, 0.4], [0.57, 0.43]), or, when `clips` gives the nodes' lengths in seconds, in proportion to those lengths with
 * neither node getting under 35% of the block; so the windows run from the first note to the final chord's end with no gap and no
 * overlap. Node 11 is the coda: one gap between two chords to each of its lines (`fragments`, default 3). When the coda has more gaps
 * than the node has lines, the longest gaps are used, in the order they come, since a line is spoken into a gap and the longer the gap
 * the more of the line survives the next chord.
 *
 * The map is music-map.json's (the recording's measured `statements`): a block is its six statements, the first from the drone's start, and
 * block 3 ends on the first coda chord.
 *
 * Each window and each gap carries `confident`: false when either of its ends is a time the music-map is not sure of or one this
 * function chose (the split between two nodes of a block is chosen, so those windows are always false).
 */

/** @typedef {{ start: number, end: number, length: number, confident: boolean }} Span */
/** @typedef {Span & { id: string, gaps?: Span[] }} Window */

const span = (/** @type {number} */ start, /** @type {number} */ end, /** @type {boolean} */ confident) => ({ start, end, length: end - start, confident });
const DEFAULT_SHARES = [[0.5, 0.5], [0.6, 0.4], [0.57, 0.43]];
const FLOOR = 0.35;
const id = (/** @type {number} */ n) => `n${String(n).padStart(2, '0')}`;

/** @typedef {{ drone: { start: number }, statements: { block: number, start: number, confident: boolean }[], coda: { chords: { t: number, confident?: boolean }[], end: { t: number, confident?: boolean } } }} Map */

/**
 * The three blocks of a map: where each begins and ends, and whether both of those are measured. Block 1 begins at the drone, block 3 ends on the first coda chord.
 * @param {Map} map
 */
export function blocksOf(map) {
  const first = (/** @type {number} */ b) => /** @type {{ start: number, confident: boolean }} */ (map.statements.find((s) => s.block === b));
  const edges = [{ t: map.drone.start, confident: true }, ...[2, 3].map((b) => ({ t: first(b).start, confident: first(b).confident })), { t: map.coda.chords[0].t, confident: map.coda.chords[0].confident !== false }];
  return [0, 1, 2].map((i) => ({ id: i + 1, start: edges[i].t, end: edges[i + 1].t, confident: edges[i].confident && edges[i + 1].confident }));
}

/**
 * @param {Map} map
 * @param {{ fragments?: number, shares?: number[][], clips?: Record<string, number | number[]> }} [options]
 * @returns {Window[]}
 */
export function windows(map, { fragments = 3, shares = DEFAULT_SHARES, clips = {} } = {}) {
  /** @type {Window[]} */
  const out = [];
  blocksOf(map).forEach((block, i) => {
    const a = id(5 + 2 * i), b = id(6 + 2 * i);
    const length = block.end - block.start;
    let share = shares[i][0] / (shares[i][0] + shares[i][1]);
    const ca = clips[a], cb = clips[b];
    if (typeof ca === 'number' && typeof cb === 'number' && ca + cb > 0) share = Math.min(1 - FLOOR, Math.max(FLOOR, ca / (ca + cb)));
    const middle = block.start + length * share;
    out.push({ id: a, ...span(block.start, middle, false) }, { id: b, ...span(middle, block.end, false) });
  });
  const chords = map.coda.chords;
  const all = chords.slice(1).map((c, i) => span(chords[i].t, c.t, chords[i].confident !== false && c.confident !== false));
  if (all.length < fragments) throw new Error(`n11 has ${fragments} lines but the coda has only ${all.length} gaps between its chords`);
  const keep = new Set([...all].sort((x, y) => y.length - x.length).slice(0, fragments));
  out.push({ id: 'n11', ...span(chords[0].t, map.coda.end.t, chords[0].confident !== false && map.coda.end.confident !== false), gaps: all.filter((g) => keep.has(g)) });
  return out;
}

/**
 * Each clip's slack in its window: a number a node, or an array a line, `{ slack, cut }`, for node 11, whose lines are meant to be cut
 * off by the chords (design, section 5): a line longer than its gap is returned with `cut`, the seconds the chord takes. Any other
 * clip longer than its window throws, naming the node, the window's length and the overrun, as does a clip with no window and a clip
 * of the wrong shape. A node with no clip has no slack.
 * @param {Window[]} ws
 * @param {Record<string, number | number[]>} clips seconds, by node id (node 11: one length a line)
 * @returns {Record<string, number | { slack: number, cut: number }[]>}
 */
export function fit(ws, clips) {
  for (const [k, v] of Object.entries(clips)) for (const seconds of Array.isArray(v) ? v : [v]) if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error(`${k} has a clip length of ${JSON.stringify(seconds)}: a clip is a number of seconds, zero or more`);
  for (const k of Object.keys(clips)) if (!ws.some((w) => w.id === k)) throw new Error(`${k} has a clip but no window: the windows are ${ws.map((w) => w.id).join(', ')}`);
  /** @type {Record<string, any>} */
  const slack = {};
  for (const w of ws) {
    const clip = clips[w.id];
    if (clip === undefined) continue;
    if (w.gaps) {
      if (!Array.isArray(clip)) throw new Error(`${w.id} needs one length a line (an array), not ${JSON.stringify(clip)}`);
      const gaps = w.gaps;
      if (clip.length > gaps.length) throw new Error(`${w.id} has ${clip.length} lines and only ${gaps.length} gaps`);
      slack[w.id] = clip.map((seconds, i) => ({ slack: Math.max(0, gaps[i].length - seconds), cut: Math.max(0, seconds - gaps[i].length) }));
    } else {
      if (typeof clip !== 'number') throw new Error(`${w.id} needs one length (a number), not ${JSON.stringify(clip)}`);
      if (clip > w.length + 1e-9) throw new Error(`${w.id} runs ${clip.toFixed(3)} s in a window of ${w.length.toFixed(2)} s: ${(clip - w.length).toFixed(3)} s over`);
      slack[w.id] = Math.max(0, w.length - clip);
    }
  }
  return slack;
}

/**
 * The timing sheet for whoever performs the lines: every window and every gap, with its length.
 * @param {Window[]} ws
 */
export function sheet(ws) {
  const row = (/** @type {string} */ name, /** @type {Span} */ s) => `${name.padEnd(12)}${s.start.toFixed(2).padStart(8)}${s.end.toFixed(2).padStart(8)}${s.length.toFixed(2).padStart(8)}${s.confident ? '' : '  ~'}`;
  const lines = [`${'node'.padEnd(12)}${'start'.padStart(8)}${'end'.padStart(8)}${'length'.padStart(8)}   (seconds into the music; ~ an end the map is not sure of, or one chosen)`];
  for (const w of ws) {
    lines.push(row(w.id, w));
    w.gaps?.forEach((g, i) => lines.push(row(`  line ${i + 1}`, g)));
  }
  return lines.join('\n');
}
