/**
 * The cut list's reader (docs/plans/2026-11-21-commentary-video-revision-design.md, section 2; the plan's Task R3). Pure: it is given the
 * list, the timeline, the captions and what is known of each take, and returns the shots of the film's pictures from its first frame to
 * the coda, or refuses naming the row. The edit (edit-commentary.mjs) cuts the film from the shots; the coda is cut on its chords by the
 * edit itself, as it was.
 *
 * THE LIST (`instances/divided-world/ui/hype/cutlist.json`) is `{ "rows": [...] }`. A row is a shot, and runs to the next row's start (the
 * last to the coda). Two kinds start on different things:
 *
 *   on the music:   { "statement": 9, "beats": 8, "take": "b-scrub-2", "from": 120 }
 *       Statement 9's beats, in order: the rows of one statement fill its sixteen beats, and each starts on the next beat. `statement` is the
 *       recording's own number (a version that removed it refuses the row).
 *   on the speech:  { "node": "n06", "word": "phrase", "take": "c-n06", "sync": "steel-chair", "lead": 20, "expect": 410 }
 *       Starts on a word of the node's captions (its time is its caption's start plus the word's share of the caption by characters;
 *       `occurrence` picks the nth), or `at` seconds into the node (default 0), less `lead` frames. With `sync`, the take's landing of that
 *       name falls on the word and the shot starts `lead` frames before it. `expect` is the landing's frame when the row was written:
 *       a take filmed again with the landing elsewhere is refused, not silently shifted.
 *
 * Both take `take` (a file's name without `.mp4`), `from` (seconds into the take, default 0, or by `sync`), `move` (the camera's, over the take's
 * own), `punch` (percent, on the shot's first frame), `hold` (the take may be held on its last frame) and `slate` (the take is not filmed
 * yet; a placeholder stands in and the run says so). `note` is the author's, and ignored. The rows are put in time order.
 *
 * REFUSED: a statement whose beats do not add up to 16, or that the version has not got; a take that is neither on disk nor a slate; a shot
 * under 6 frames; a shot past its take's end without `hold`; two cuts on one frame; a first row that does not start the film; a landing named
 * that the take has not, or that has moved from `expect`; a start before the take's; a row's own move or punch in part one (locked off; a take's
 * own camera is simply not applied there).
 *
 * A TAKE is `{ seconds, width?, landed?, move?, punch?, punches? }`: its notes (the edit reads them from `<take>.json`). Its own `move` and
 * `punch` apply to its shots (a row's replaces them), its `punches` where they fall in a shot, and in part three every landing is a small punch.
 */
import { refusePush } from './moves.mjs';

export const F = 60;
export const MIN_FRAMES = 6;
const LANDING_PUNCH = 5;
const KEYS = ['node', 'statement', 'beats', 'at', 'word', 'occurrence', 'sync', 'lead', 'expect', 'take', 'from', 'move', 'punch', 'hold', 'slate', 'note'];

/**
 * The time, in the film, of a word of a node's captions: its caption's start plus the word's share of the caption by characters (the
 * characters before it over the caption's length, of its duration). Words are whole and case-blind; `occurrence` is the nth, from 1.
 * @param {{ node: string, start: number, end: number, text: string }[]} cues
 * @param {string} node @param {string} word @param {number} [occurrence]
 */
export function wordTime(cues, node, word, occurrence = 1) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}'’])${word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}'’])`, 'giu');
  let seen = 0;
  for (const cue of cues.filter((c) => c.node === node)) {
    for (const m of cue.text.matchAll(re)) if (++seen === occurrence) return cue.start + ((m.index ?? 0) / cue.text.length) * (cue.end - cue.start);
  }
  throw new Error(`${node} has no word ${JSON.stringify(word)} in its captions${occurrence > 1 ? ` (occurrence ${occurrence} was asked for)` : ''}`);
}

/** @param {number[]} a */
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * @typedef {{ seconds: number, width?: number, landed?: { what: string, frame: number }[], move?: any, punch?: number, punches?: { frame: number, percent: number }[] }} TakeInfo
 * @param {{ rows: any[] }} list
 * @param {{ tl: any, cues: { node: string, start: number, end: number, text: string }[], takes: Record<string, TakeInfo> }} ctx
 */
export function resolveList(list, { tl, cues, takes }) {
  const rows = list.rows ?? [];
  const label = (/** @type {any} */ r, /** @type {number} */ i) => `row ${i + 1} (${r.statement !== undefined ? `statement ${r.statement}` : r.node}${r.word ? ` at "${r.word}"` : r.at ? ` at ${r.at} s` : ''}${r.take ? `, ${r.take}` : ''})`;
  const music = tl.music;
  /** @type {Record<number, number>} */
  const used = {};
  const timed = rows.map((r, i) => {
    for (const k of Object.keys(r)) if (!KEYS.includes(k)) throw new Error(`${label(r, i)} has an unknown field "${k}"`);
    if ((r.node === undefined) === (r.statement === undefined)) throw new Error(`${label(r, i)} has to be on a node or a statement, and not both`);
    if (typeof r.take !== 'string') throw new Error(`${label(r, i)} names no take`);
    if (r.statement !== undefined) {
      const ord = music.statements.findIndex((/** @type {{ n: number }} */ s) => s.n === r.statement);
      if (ord < 0) throw new Error(`${label(r, i)}: statement ${r.statement} is not in ${music.version}, which removed it`);
      if (!Number.isInteger(r.beats) || r.beats < 1) throw new Error(`${label(r, i)} needs a whole number of beats`);
      const b0 = used[r.statement] ?? 0;
      used[r.statement] = b0 + r.beats;
      if (used[r.statement] > 16) throw new Error(`${label(r, i)}: statement ${r.statement}'s rows come to ${used[r.statement]} beats by here, not 16`);
      return { r, i, t: music.beats[ord * 16 + b0] };
    }
    const node = tl.nodes.find((/** @type {{ id: string }} */ n) => n.id === r.node);
    if (!node || r.node === 'n11') throw new Error(`${label(r, i)}: ${r.node} is not a node the list cuts (n01 to n10)`);
    const base = r.word !== undefined ? wordTime(cues, r.node, r.word, r.occurrence) : node.start + (r.at ?? 0);
    return { r, i, t: base - (r.lead ?? 0) / F };
  });
  for (const [n, sum] of Object.entries(used)) if (sum !== 16) throw new Error(`statement ${n}: its rows' beats add up to ${sum}, not 16`);

  const order = [...timed].sort((a, b) => a.t - b.t || a.i - b.i);
  const coda = Math.round(music.codaStart * F);
  const starts = order.map((o) => Math.round(o.t * F));
  if (starts[0] !== 0) throw new Error(`the film must begin at its first frame: the first row, ${label(order[0].r, order[0].i)}, starts at ${order[0].t.toFixed(2)} s`);
  /** @type {any[]} */
  const shots = [];
  order.forEach((o, k) => {
    const { r, i } = o, startFrame = starts[k], endFrame = k + 1 < order.length ? starts[k + 1] : coda, frames = endFrame - startFrame;
    if (startFrame >= coda) throw new Error(`${label(r, i)} starts at frame ${startFrame}, after the coda begins at ${coda}`);
    if (k + 1 < order.length && starts[k + 1] === startFrame) throw new Error(`${label(r, i)} is on the same frame (${startFrame}) as ${label(order[k + 1].r, order[k + 1].i)}`);
    if (frames < MIN_FRAMES) throw new Error(`${label(r, i)} is ${frames} frames, under ${MIN_FRAMES} frames: a shot that short is a flash, not a cut`);
    const info = takes[r.take], slate = info === undefined;
    if (slate && r.slate !== true) throw new Error(`${label(r, i)} names ${r.take}, which is not a take on disk and is not marked "slate": true`);
    let from = r.from ?? 0;
    if (r.sync !== undefined && !slate) {
      if (r.from !== undefined) throw new Error(`${label(r, i)} has both from and sync`);
      const landing = (info.landed ?? []).find((l) => l.what === r.sync);
      if (!landing) throw new Error(`${label(r, i)}: ${r.take} has no landing named "${r.sync}" (it has ${(info.landed ?? []).map((l) => l.what).join(', ') || 'none'})`);
      if (r.expect !== undefined && r.expect !== landing.frame) throw new Error(`${label(r, i)}: ${r.take}'s ${r.sync} now lands at frame ${landing.frame}, where the list was written for ${r.expect}: the take was filmed again`);
      from = (landing.frame - (r.lead ?? 0)) / F;
      if (from < -1e-9) throw new Error(`${label(r, i)} starts ${(-from).toFixed(2)} s before the start of ${r.take}: its lead is longer than the landing's frames`);
      if ((r.lead ?? 0) >= frames) throw new Error(`${label(r, i)}: the next cut comes ${frames} frames after it starts, before ${r.take}'s ${r.sync} lands (${r.lead ?? 0} frames in)`);
    }
    if (!slate && !r.hold && from + frames / F > info.seconds + 0.5 / F) throw new Error(`${label(r, i)} runs to ${(from + frames / F).toFixed(2)} s of ${r.take}, which is ${info.seconds.toFixed(2)} s: add "hold": true to hold it on its last frame, or cut it shorter`);
    const node = tl.nodes.find((/** @type {{ start: number, end: number }} */ n) => startFrame >= Math.round(n.start * F) && startFrame < Math.round(n.end * F));
    const part1 = startFrame < Math.round(tl.part.one[1] * F);
    /** @type {any} */
    const shot = { take: r.take, at: 0, start: startFrame / F, length: frames / F, startFrame, frames, from, node: node?.id, row: i + 1, slate, hold: r.hold === true };
    if (r.statement !== undefined) shot.statement = r.statement;
    if (part1 && (r.move || r.punch)) throw new Error(`${label(r, i)} is in part one, which is locked off: a row there carries no move or punch`);
    /* A take's own camera is dropped in part one: the take belongs to another node, and part one is locked off. */
    const move = r.move ?? (part1 ? undefined : info?.move);
    if (move) shot.move = move;
    const punch = r.punch ?? (part1 ? undefined : info?.punch);
    if (punch) shot.punch = punch;
    const first = Math.round(from * F);
    /** @type {{ frame: number, percent: number }[]} */
    const punches = (part1 ? [] : info?.punches ?? []).filter((p) => p.frame >= first && p.frame < first + frames).map((p) => ({ frame: p.frame - first, percent: p.percent }));
    shot.hits = [];
    for (const l of info?.landed ?? []) if (l.frame >= first && l.frame < first + frames) {
      shot.hits.push({ what: l.what, at: startFrame / F + (l.frame - first) / F });
      if (startFrame >= Math.round(tl.part.three[0] * F) && !punches.some((p) => Math.abs(p.frame - (l.frame - first)) < 2) && !(punch && l.frame - first < 2)) punches.push({ frame: l.frame - first, percent: LANDING_PUNCH });
    }
    if (punches.length) shot.punches = punches;
    if (shot.move || shot.punch || shot.punches) refusePush(label(r, i), shot, info?.width ?? 1920);
    shots.push(shot);
  });

  const edges = [music.statements[0].start, music.second.at, music.third.at];
  const names = ['part one', 'first block', 'second block', 'third block'];
  const blocks = names.map((name, b) => {
    const mine = shots.filter((s) => (b === 0 || s.start >= edges[b - 1]) && (b === 3 || s.start < edges[b]));
    return { name, count: mine.length, median: mine.length ? median(mine.map((s) => s.length)) : 0 };
  });
  return { shots, slates: [...new Set(shots.filter((s) => s.slate).map((s) => s.take))], blocks };
}
