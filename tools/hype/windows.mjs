/**
 * The music's windows: where each commentary node of parts two and three sits in the recording, which cannot stretch, so a voice clip
 * must fit the window it is given (docs/plans/2026-11-21-commentary-video-design.md, section 5). Pure: it reads a map (music-map.mjs's
 * output) and arguments, and touches nothing else.
 *
 * Nodes 5 and 6 share block 1, 7 and 8 block 2, 9 and 10 block 3, each pair split at the block's fourth statement of the theme, so
 * every window starts and ends on a measured point and the windows run from the first note to the final chord's end with no gap and
 * no overlap. Node 11 is the coda: one gap between two chords to each of its lines. When the coda has more gaps than the node has
 * lines, the longest gaps are used, in the order they come, since a line is spoken into a gap and the longer the gap the more of
 * the line survives the next chord.
 */

/** @typedef {{ start: number, end: number, length: number }} Span */
/** @typedef {Span & { id: string, gaps?: Span[] }} Window */

const span = (start, end) => ({ start, end, length: end - start });

/**
 * @param {{ blocks: { start: number, end: number, entries: { t: number }[] }[], coda: { chords: { t: number }[], end: { t: number } } }} map
 * @param {{ fragments: number }} options how many lines node 11 has
 * @returns {Window[]}
 */
export function windows(map, { fragments }) {
  /** @type {Window[]} */
  const out = [];
  map.blocks.forEach((block, i) => {
    const middle = block.entries[3].t;
    out.push({ id: `n${String(5 + 2 * i).padStart(2, '0')}`, ...span(block.start, middle) });
    out.push({ id: `n${String(6 + 2 * i).padStart(2, '0')}`, ...span(middle, block.end) });
  });
  const chords = map.coda.chords.map((c) => c.t);
  const all = chords.slice(1).map((t, i) => span(chords[i], t));
  if (all.length < fragments) throw new Error(`n11 has ${fragments} lines but the coda has only ${all.length} gaps between its chords`);
  const keep = new Set([...all].sort((a, b) => b.length - a.length).slice(0, fragments));
  out.push({ id: 'n11', ...span(chords[0], map.coda.end.t), gaps: all.filter((g) => keep.has(g)) });
  return out;
}

/**
 * Each clip's slack in its window: a number a node, or an array a line for node 11. A node with no clip has none. A clip longer than
 * its window throws, naming the node, the window's length and the overrun.
 * @param {Window[]} ws
 * @param {Record<string, number | number[]>} clips seconds, by node id
 * @returns {Record<string, number | number[]>}
 */
export function fit(ws, clips) {
  /** @type {Record<string, number | number[]>} */
  const slack = {};
  for (const w of ws) {
    const clip = clips[w.id];
    if (clip === undefined) continue;
    const check = (/** @type {number} */ seconds, /** @type {Span} */ s, /** @type {string} */ what) => {
      if (seconds > s.length + 1e-9) throw new Error(`${what} runs ${seconds.toFixed(3)} s in a window of ${s.length.toFixed(2)} s: ${(seconds - s.length).toFixed(3)} s over`);
      return Math.max(0, s.length - seconds);
    };
    if (w.gaps) {
      const lines = /** @type {number[]} */ (clip);
      slack[w.id] = lines.map((seconds, i) => {
        const gap = w.gaps?.[i];
        if (!gap) throw new Error(`${w.id} has ${w.gaps?.length} gaps and a clip for line ${i + 1}`);
        return check(seconds, gap, `${w.id} line ${i + 1}`);
      });
    } else slack[w.id] = check(/** @type {number} */ (clip), w, w.id);
  }
  return slack;
}

/**
 * The timing sheet for whoever performs the lines: every window and every gap, with its length.
 * @param {Window[]} ws
 */
export function sheet(ws) {
  const row = (/** @type {string} */ name, /** @type {Span} */ s) => `${name.padEnd(12)}${s.start.toFixed(2).padStart(8)}${s.end.toFixed(2).padStart(8)}${s.length.toFixed(2).padStart(8)}`;
  const lines = [`${'node'.padEnd(12)}${'start'.padStart(8)}${'end'.padStart(8)}${'length'.padStart(8)}   (seconds into the music)`];
  for (const w of ws) {
    lines.push(row(w.id, w));
    w.gaps?.forEach((g, i) => lines.push(row(`  line ${i + 1}`, g)));
  }
  return lines.join('\n');
}
