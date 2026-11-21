/**
 * The commentary video's edit (docs/plans/2026-11-21-commentary-video-plan.md, tasks 8 and 8a; the design, sections 5, 5a and 6; revised by
 * docs/plans/2026-11-21-commentary-video-revision-plan.md, Tasks R1 to R3): the takes, the voice clips and the music assembled into one film, with captions.
 *
 *   node tools/hype/edit-commentary.mjs [--takes .runs/hype] [--voice .runs/hype/voice] [--music <recording>]
 *       [--out .runs/hype/commentary.mp4] [--part one|two|three|out] [--captions top|foot|off] [--clean] [--sheet] [--moves moves.json]
 *       [--recording full|mk-a|mk-b] [--cutlist <file>|none] [--preset veryfast] [--any-recording]
 *
 * This file is run with plain `node`: Node 22.18 and later strips the types of the instance's `commentary.ts` as it imports it (as
 * tools/check-guide.mjs reads the instance's `.ts`), so no flag is needed. The pure parts (`timeline`, `captions`, `srt`) are exported
 * for the tests; `moves.mjs` holds the camera's arithmetic; nothing runs ffmpeg unless this file is the command.
 *
 * THE CUT LIST (`--cutlist`, default `instances/divided-world/ui/hype/cutlist.json`; cutlist.mjs says what a row is) gives every shot of the picture
 * from the first frame to the coda, each naming a take (a file under `--takes`, without `.mp4`: `c-n06`, `b-scrub-2`) and where in it the shot starts, on a beat
 * of the music or on a word of the narration. The run prints the shots and their median length for part one and each block of the music. A take's own
 * notes (below) apply to its shots, a row's `move` over them; `--moves` then names takes, not nodes. `--cutlist none` cuts one take a node. The list's
 * optional `coda` array directs the coda's cuts (one to a chord; cutlist.mjs `directCoda`): a take and a place in it for each, or null for node 11's own.
 *
 * TAKES are `c-n01` to `c-n11`, `c-title-1` and `c-title-2`, as `.mp4` under `--takes`, 60 frames a second, 1920 x 1080 or larger (3840 x 2160 gives the
 * moves twice the room). A take that is not there is replaced by a generated slate (a dark frame, the node and its first caption line),
 * so the whole film can be assembled before it is filmed. Node 9 may have three framings, `c-n09-wide`, `c-n09-tight` and `c-n09-turned`,
 * filmed on one clock (until the cut list names them, node 9 shows the first). Node 11 is ONE take, `c-n11`, whose clock runs through
 * the coda; the edit cuts it at every chord up to the title's strike. THE TITLE (the owner, 2026-11-21): on the coda's last two strikes of the
 * mountain king, `c-title-1` (from its frame 0) from the title's strike (the second-to-last chord) to the final strike, and `c-title-2` (from
 * its frame 0) from the final strike to the film's end; the instance's `TITLE` and `TITLE_NOTE` are what a slate for a missing one says. A take is held on its last frame, or trimmed, to its node's length.
 *
 * A TAKE'S NOTES are an optional `c-nXX.json` beside it: either an array of landings, or an object with any of:
 *   { "landed": [{ "what": "steel-chair", "frame": 150 }],       frames of the take (60 a second) where something lands
 *     "move": { "from": R, "to": R, "ease": "inOut" },          R is { "x", "y", "w", "roll" }: the top-left corner and width as
 *     "punch": 12,                                               shares of the frame, and a roll in degrees
 *     "punches": [{ "frame": 40, "percent": 8 }] }

 * THE NARRATION AND THE MUSIC (`timeline`): the voice runs node after node from the first frame, and the music is laid under it from its end, so
 * the coda's first chord falls just after node 10's last word. The version of the recording is the longest of the full one, `mk-a` and `mk-b`
 * (music-cut.mjs makes the last two, beside the recording) whose start is at least 5 s into the film; `--recording` fixes it. The run prints
 * the version, the start and where in the speech the second block and the full orchestra fall.
 * A landing plays its game sound (`steel-chair` the chair's hit, `filing` a boo; any other kind none) at its frame of the node, and in
 * part three is a punch-in. `move`, `punch` and `punches` are the camera's: they apply to every cut of the node, are refused in part
 * one (locked off), and `--moves` takes the same fields by node id in one file, over the take's own.
 *
 * MOVES (moves.mjs): for every output frame at 60 fps `perspective` samples the rectangle (turned by its roll) out of the take at a
 * fractional position (`zoompan` and `crop` step by whole pixels, which shows as judder); a push past twice the take's pixels is refused naming the cut.
 *
 * `--music` must be the recording the map was measured on: its length is checked against `music-map.json`'s `seconds` (0.05 s) and its sha1
 * against `sha1` (`--any-recording` waives the sha1 only); a shortened version is checked against its recipe's length. The run prints a NOTE for every stand-in (no voice, no music, a slate, a missing
 * title take, a node 9 with only some of its framings) and HELD for a take shorter than its cut.
 *
 * SOUND: the voice at full level; the music 10 dB down under each clip, 150 ms to go down and 400 ms to come
 * back, and never ducked from the coda's first chord; the game's sounds on their landings. The film ends 1.2 s after the final chord's end, the picture fading to
 * black over its last 0.8 s and the music's own decay left as recorded: no held black, no end card.
 *
 * CAPTIONS: `<film>.srt` beside the film, and burned in (white on a translucent band, Verdana, else DejaVu Sans). `--captions top` (the
 * default) puts the band at the TOP of the frame, since the game's HUD (the class tag, the forecast) is at the foot; `foot` is the old place; `off`
 * burns nothing, and `--clean` is an alias of it. The band is as tall as its words need, one row or two. WITHOUT a voice folder each clip is silence of 150 words a minute and every frame says PLACEHOLDER SOUND; a slate's frames
 * say PLACEHOLDER PICTURE. `--sheet` prints the timing sheet (node 11's lines, the title's two strikes and the film's end) and stops; `--part` assembles one part for a quick look.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { versionMap, titleStrikes, expectedSeconds, beats, VERSIONS } from './music.mjs';
import { refusePush, corners } from './moves.mjs';
import { run, duration, videoInfo, fontFile, flag } from './cutting.mjs';
import { resolveList, directCoda } from './cutlist.mjs';

export const F = 60;
export const BREATH = 0.35;
export const CODA_AFTER = 0.2;
export const MUSIC_FROM = 5;
export const WPM = 150;
export const TAIL = 1.2;
export const FADE = 0.8;
export const PART_ONE = ['n01', 'n02', 'n03', 'n04'];
/** The spoken nodes as the timeline took them before the data gave their order: n01 to n10, a breath between. */
const DEFAULT_NODES = ['n01', 'n02', 'n03', 'n04', 'n05', 'n06', 'n07', 'n08', 'n09', 'n10'].map((id, i) => ({ id, part: /** @type {1 | 2 | 3} */ (i < 4 ? 1 : i < 8 ? 2 : 3), after: undefined }));

/**
 * The spoken nodes (every node but the coda's n11) in the data's order, each with its part and the pause before it (`after`, seconds; absent: the usual breath).
 * @param {{ id: string, part: 1 | 2 | 3, after?: number }[]} commentary
 */
export const speechNodes = (commentary) => commentary.filter((n) => n.id !== 'n11').map((n) => ({ id: n.id, part: n.part, after: n.after }));
const CHORD_PUNCH = 10, LANDING_PUNCH = 5;

/** The frames between two times of the film. @param {number} a @param {number} b */
export const framesBetween = (a, b) => Math.round(b * F) - Math.round(a * F);

/**
 * @typedef {import('./moves.mjs').Move} Move
 * @typedef {{ take: string, at: number, start: number, length: number, startFrame: number, frames: number, from: number, speed?: number, move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} Cut
 * @typedef {{ start: number, length: number, line?: number, cut?: number }} Voice
 * @typedef {{ id: string, part: 1 | 2 | 3, start: number, end: number, length: number, frames: number, voice: Voice[], cuts: Cut[], hits: { what: string, at: number }[] }} NodeCut
 * @typedef {{ move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} Camera
 */

/**
 * The whole film's time, in seconds from its first frame, as a pure function of the clips' lengths and the music's map.
 *
 * The narration leads (design, section 1): node after node, a breath between, from the first frame. The music is laid under it from its
 * END: the first chord of the coda falls `CODA_AFTER` s after node 10's last word, so the recording's own second 0 is at the film
 * second `music.start = that - the version's first chord`. The version is the longest of `full`, `mk-a` and `mk-b` whose start is at least
 * `MUSIC_FROM` s into the film (so the music begins as early as the speech allows); `recording` fixes it; when none reaches that the
 * shortest is used and `music.notes` says so. A start before the film's first frame is trimmed: `music.start` is then 0 and `music.from`
 * the seconds of the recording skipped. Node 11's lines are laid in order from the coda's first chord to the TITLE's strike (the coda's
 * second-to-last chord), each at full length, with equal gaps before the first, between them and after the last; lines that do not fit are
 * refused naming the overrun. The title is shown on the coda's last two strikes: `c-title-1` from the title's strike to the final strike,
 * `c-title-2` from the final strike to the film's end, which is the final chord's end plus `TAIL` s, the picture fading to black over the
 * last `FADE` s and the music's own decay left as recorded.
 *
 * The spoken nodes are taken in the data's order (`nodes`: id, part, and `after`, the pause before a node, default `breath`); a node that follows a
 * pause (n02b, three seconds after "politely.") starts that long after the clip before it ends, and the clip before it owns the silence.
 *
 * Until the cut list gives them (cutlist.mjs) a node is one cut of its take; the coda is cut on its chords.
 *
 * @param {Record<string, number | number[]>} clips seconds a node (node 11: one a line)
 * @param {any} map the committed music map (music-map.json)
 * @param {{ nodes?: { id: string, part: 1 | 2 | 3, after?: number }[], recording?: string, breath?: number, moves?: Record<string, Camera>, framings?: Record<string, string[]>, sizes?: Record<string, number>, landed?: Record<string, { what: string, frame: number }[]> }} [options]
 *   `recording`: `full`, `mk-a` or `mk-b` to fix the version; `moves`: the camera's moves by node; `framings`: the framings of a node with several (node 9's
 *   cut uses the first); `sizes`: each node's take's width in pixels (default 1920); `landed`: what lands in each node, and at which frame of its take.
 */
export function timeline(clips, map, { nodes: order = DEFAULT_NODES, recording, breath = BREATH, moves = {}, framings = {}, sizes = {}, landed = {} } = {}) {
  const speech = order.map((n) => n.id);
  for (const id of [...speech, 'n11']) if (clips[id] === undefined) throw new Error(`${id} has no clip: a length in seconds is needed for every node`);
  for (const id of order.filter((n) => n.part === 1).map((n) => n.id)) if (moves[id] && Object.values(moves[id]).some((v) => v !== undefined)) throw new Error(`${id}: part one is locked off (the design, section 5a), so it carries no move, punch or landing punch`);
  const n11 = clips.n11;
  if (!Array.isArray(n11)) throw new Error('n11 needs one length a line (an array)');
  for (const [k, v] of Object.entries(clips)) for (const seconds of Array.isArray(v) ? v : [v]) if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error(`${k} has a clip length of ${JSON.stringify(seconds)}: a clip is a number of seconds, zero or more`);

  /* The narration, node after node. */
  /** @type {Record<string, number>} */
  const starts = {};
  let t = 0;
  order.forEach((n, i) => { if (i > 0) t += n.after ?? breath; starts[n.id] = t; t += /** @type {number} */ (clips[n.id]); });
  const last = speech[speech.length - 1];
  const codaStart = starts[last] + /** @type {number} */ (clips[last]) + CODA_AFTER;

  /* The music, laid from its end. */
  const notes = [];
  const startOf = (/** @type {string} */ name) => codaStart - versionMap(map, name).coda.chords[0].t;
  let version = recording;
  if (version === undefined) {
    version = VERSIONS.find((name) => startOf(name) >= MUSIC_FROM);
    if (version === undefined) {
      version = /** @type {string} */ (VERSIONS.at(-1));
      notes.push(`no version of the recording lets the music start ${MUSIC_FROM} s into the film: ${version}, the shortest, starts at ${startOf(version).toFixed(2)} s, before the speech allows`);
    }
  }
  const v = versionMap(map, version), musicStart = startOf(version);
  const at = (/** @type {number} */ musicTime) => musicStart + musicTime;
  const strikes = titleStrikes(v);
  const lengths = /** @type {number[]} */ (n11), spoken11 = lengths.reduce((a, b) => a + b, 0), span = strikes.title - strikes.first;
  if (spoken11 > span + 1e-9) throw new Error(`n11's ${lengths.length} lines come to ${spoken11.toFixed(2)} s but only ${span.toFixed(2)} s lie between the coda's first chord and the title's strike: ${(spoken11 - span).toFixed(2)} s too long (the overrun)`);
  const gap = (span - spoken11) / (lengths.length + 1);

  /** @type {NodeCut[]} */
  const nodes = [];
  /** @param {string} id @param {1 | 2 | 3} part @param {number} start @param {number} end @param {Voice[]} voice @param {{ at: number }[]} bounds cut points inside the node */
  const add = (id, part, start, end, voice, bounds) => {
    const times = [0, ...bounds.map((b) => b.at), end - start];
    const camera = moves[id] ?? {};
    const plays = landed[id] ?? [];
    const hits = plays.map((h) => ({ ...h, t: h.frame / F }));
    /** @type {Cut[]} */
    const cuts = times.slice(0, -1).map((cutAt, k) => {
      const length = times[k + 1] - cutAt;
      const startFrame = Math.round((start + cutAt) * F), endFrame = k === times.length - 2 ? Math.round(end * F) : Math.round((start + times[k + 1]) * F);
      /** @type {Cut} */
      const cut = { take: framings[id] ? `c-${id}-${framings[id][0]}` : `c-${id}`, at: cutAt, start: start + cutAt, length, startFrame, frames: endFrame - startFrame, from: cutAt };
      if (camera.move) cut.move = camera.move;
      const punch = camera.punch ?? (id === 'n11' ? CHORD_PUNCH : undefined);
      if (punch) cut.punch = punch;
      /** @type {{ frame: number, percent: number }[]} */
      const punches = [...(camera.punches ?? [])];
      /* A play on the cut's own first frame, in a cut that already punches on its entry, is that punch. */
      if (part === 3) for (const h of hits) if (h.t >= cutAt - 1e-9 && h.t < cutAt + length - 1e-9 && !(cut.punch && h.t - cutAt < 1.5 / F)) punches.push({ frame: Math.round((h.t - cutAt) * F), percent: LANDING_PUNCH });
      if (punches.length) cut.punches = punches;
      if (cut.move || cut.punch || cut.punches) refusePush(`${id} cut ${k + 1}`, cut, sizes[id] ?? 1920);
      return cut;
    });
    nodes.push({ id, part, start, end, length: end - start, frames: Math.round(end * F) - Math.round(start * F), voice, cuts, hits: hits.map((h) => ({ what: h.what, at: h.t })) });
  };

  speech.forEach((id, i) => {
    const start = starts[id], end = i + 1 < speech.length ? starts[speech[i + 1]] : codaStart;
    add(id, order[i].part, start, end, [{ start, length: /** @type {number} */ (clips[id]) }], []);
  });
  const chords = v.coda.chords.map((c) => c.t);
  let lineAt = strikes.first + gap;
  const lines = lengths.map((length, i) => { const line = { start: at(lineAt), length, line: i }; lineAt += length + gap; return line; });
  const titleStart = at(strikes.title), finalStart = at(strikes.final), end = at(strikes.end) + TAIL;
  add('n11', 3, codaStart, titleStart, lines, chords.slice(1).filter((c) => c < strikes.title - 1e-9).map((c) => ({ at: c - chords[0] })));

  /* Where the theme's second block and the full orchestra fall in the speech. */
  const place = (/** @type {number} */ musicTime) => {
    const film = at(musicTime), node = nodes.find((n) => n.id !== 'n11' && film >= n.start - 1e-9 && film < n.end - 1e-9);
    return { at: film, node: node?.id ?? 'n11', into: node ? film - node.voice[0].start : film - codaStart };
  };
  const firstOf = (/** @type {number} */ block) => /** @type {{ start: number }} */ (v.statements.find((s) => s.block === block)).start;

  const nine = /** @type {NodeCut} */ (nodes.find((n) => n.id === 'n09'));
  const hits = nodes.flatMap((n) => n.hits.filter((h) => h.at < n.length).map((h) => ({ id: n.id, what: h.what, at: n.start + h.at }))).sort((a, b) => a.at - b.at);
  return {
    nodes,
    hits,
    music: { version, start: Math.max(0, musicStart), from: Math.max(0, -musicStart), until: strikes.end + TAIL, untilFilm: end, codaStart, notes, second: place(firstOf(2)), third: place(firstOf(3)), statements: v.statements.map((s) => ({ n: s.n, start: at(s.start), length: s.length })), beats: beats(map, version).map(at) },
    part: { one: [0, starts.n05], two: [starts.n05, nine.start], three: [nine.start, titleStart], out: [titleStart, end] },
    out: { titleStart, finalStart, fadeStart: end - FADE, end },
    total: end,
  };
}

/**
 * What a run says about the music's place: the version, where it starts, and where in the speech the second block and the full orchestra fall.
 * @param {Timeline} tl
 */
export function placementText(tl) {
  const m = tl.music, where = (/** @type {{ at: number, node: string, into: number }} */ p) => `${p.at.toFixed(2)} s, in ${p.node}, ${p.into.toFixed(2)} s in`;
  return [
    `music: ${m.version}, starts ${m.start.toFixed(2)} s into the film${m.from > 0 ? ` (the first ${m.from.toFixed(2)} s of the recording are left out)` : ''}; the first chord of the coda is at ${m.codaStart.toFixed(2)} s, the film ends at ${m.untilFilm.toFixed(2)} s, ${TAIL} s after the final chord ends`,
    `block 2 (the violins) at ${where(m.second)}`,
    `full orchestra at ${where(m.third)}`,
    ...m.notes.map((n) => `NOTE ${n}`),
  ].join('\n');
}

/** @typedef {ReturnType<typeof timeline>} Timeline */

/**
 * The captions: each line of a node shown for its share of the node's clip, by its share of the node's characters. A node whose voice
 * is a clip a line (node 11) shows each line for as long as its clip plays. Nothing is captioned during the title.
 * @param {{ id: string, lines: readonly string[] }[]} commentary
 * @param {Timeline} tl
 * @returns {{ node: string, start: number, end: number, text: string }[]}
 */
export function captions(commentary, tl) {
  const cues = [];
  for (const node of tl.nodes) {
    const lines = commentary.find((c) => c.id === node.id)?.lines;
    if (!lines) continue;
    if (node.voice.length > 1 || node.voice[0]?.line !== undefined) {
      node.voice.forEach((v, i) => { if (lines[v.line ?? i] !== undefined) cues.push({ node: node.id, start: v.start, end: v.start + v.length, text: lines[v.line ?? i] }); });
      continue;
    }
    const v = node.voice[0], total = lines.reduce((s, l) => s + l.length, 0);
    let from = v.start;
    for (const text of lines) {
      const to = from + (v.length * text.length) / total;
      cues.push({ node: node.id, start: from, end: to, text });
      from = to;
    }
  }
  return cues;
}

/**
 * Where the burned-in caption sits, for a cue's words: `top` (the default; the game's HUD is at the foot), `foot`, or `off` (null).
 * The band is a pill, no wider than its words plus their padding (libass's own opaque box, BorderStyle 3, which hugs each row of text), so as little
 * of the page as the words need is covered: the first cut's full-width bar dimmed the breadcrumb and brushed the thread title. It is as tall as its
 * words need, one row or two (a line of more than 70 characters wraps to a second; never a third): rows of 40 px (FontSize 9 on libass's 288-line
 * page is 34 px). `force_style`'s Alignment is the legacy SSA numbering: 2 is bottom-center and 6 top-center (8 would be mid-height) and a margin of
 * 8 px above and below. `marginV` is libass's, on that 288-line page; `h` is the band's height in the film's pixels (the most it can cover).
 * @param {'top' | 'foot' | 'off'} mode @param {string} text
 * @returns {{ y: number, h: number, alignment: 2 | 6, marginV: number } | null}
 */
export function captionBand(mode, text) {
  if (mode === 'off') return null;
  const rows = text.length > 70 ? 2 : 1, h = 8 + rows * 40 + 8;
  return mode === 'top' ? { y: 0, h, alignment: 6, marginV: 2 } : { y: 1080 - h, h, alignment: 2, marginV: 3 };
}

/**
 * The filters that burn a cut's captions in: one `subtitles` filter, its words in a translucent pill (an opaque box libass draws behind each
 * row, in the outline's color: black at 62%) with the padding of its outline, and no full-width bar. Pure.
 * @param {'top' | 'foot' | 'off'} mode @param {string} srtFile @param {string} font the family
 * @returns {string[]}
 */
export function captionFilters(mode, srtFile, font) {
  const edge = captionBand(mode, '');
  if (!edge) return [];
  const style = `FontName=${font},FontSize=9,PrimaryColour=&HFFFFFF&,OutlineColour=&H61000000&,BackColour=&HFF000000&,BorderStyle=3,Outline=2,Shadow=0,Alignment=${edge.alignment},MarginV=${edge.marginV},MarginL=19,MarginR=19`;
  return [`subtitles=filename='${esc(srtFile)}':original_size=1920x1080:force_style='${style}'`];
}

/** The caption mode the command line asks for: `--captions top|foot|off`, `--clean` being `off`. @param {string[]} args @returns {'top' | 'foot' | 'off'} */
export function captionMode(args) {
  const i = args.indexOf('--captions');
  if (i < 0) return args.includes('--clean') ? 'off' : 'top';
  const v = args[i + 1];
  if (v !== 'top' && v !== 'foot' && v !== 'off') throw new Error(`--captions is foot, top or off, not ${v}`);
  return v;
}

/** An .srt file's text. @param {{ start: number, end: number, text: string }[]} cues */
export function srt(cues) {
  const stamp = (/** @type {number} */ s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const p = (/** @type {number} */ v, /** @type {number} */ n = 2) => String(v).padStart(n, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
}

/** Words wrapped to at most `width` characters a line, joined back with single spaces they are the words. @param {string} text @param {number} width */
export function wrap(text, width) {
  /** @type {string[]} */
  const lines = [];
  for (const word of text.split(/\s+/u)) {
    if (lines.length && `${lines.at(-1)} ${word}`.length <= width) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** Seconds of silence for the words at 150 a minute. @param {string} text */
export const spoken = (text) => (text.split(/\s+/u).filter(Boolean).length * 60) / WPM;

/**
 * The title's words from the instance's `commentary.ts`: `TITLE` and `TITLE_NOTE` when it has them, else its deprecated `END_CARD` split at the
 * first parenthesis (the title, then the parenthetical).
 * @param {{ TITLE?: string, TITLE_NOTE?: string, END_CARD?: string }} mod
 * @returns {{ title: string, note: string }}
 */
export function titleWords(mod) {
  if (mod.TITLE !== undefined) return { title: mod.TITLE, note: mod.TITLE_NOTE ?? '' };
  const m = mod.END_CARD?.match(/^(.*?)\s*(\(.*)$/su);
  if (m) return { title: m[1], note: m[2] };
  if (mod.END_CARD) return { title: mod.END_CARD, note: '' };
  throw new Error('the instance`s commentary.ts exports no TITLE (and no deprecated END_CARD): the film has no title to show');
}

/* ---- what the film is made of: the guards against one that looks finished and is not ---- */

/**
 * Which voice clips, takes and framings a run uses, and what it refuses or must say (pure: it is given the folders' listings).
 *
 * - `voiceFiles` is the voice folder's file names, or null when there is no folder. No folder: every clip is silence the length of
 *   its words and `placeholderSound` is set. A folder that is missing any one clip (`n01` to `n10`, `n11-1` to `n11-N`, whatever
 *   extension) is refused naming that clip: a re-voice replaces the whole folder, and one clip silent in a film of voice is a film
 *   that looks finished and is not.
 * - `haveMusic` false also sets `placeholderSound`.
 * - `takeFiles` is the takes folder's file names. A node with no `c-<id>.mp4` is a slate (`slates`); node 9 is not if it has any
 *   of its framings (`c-n09-wide`, `-tight`, `-turned`), and has only some of them is reported in `notes`, naming the missing;
 *   `c-title-1` or `c-title-2` missing is a slate too (`titleSlates`), reported.
 * @param {{ commentary: { id: string, lines: readonly string[] }[], voiceFiles: string[] | null, takeFiles: string[], haveMusic: boolean }} input
 * @returns {{ voice: Record<string, string | null | (string | null)[]>, placeholderSound: boolean, framings: Record<string, string[]>, slates: string[], titleSlates: string[], notes: string[] }}
 */
export function resolveInputs({ commentary, voiceFiles, takeFiles, haveMusic }) {
  /** @type {string[]} */
  const notes = [];
  const clipFile = (/** @type {string} */ stem) => {
    if (!voiceFiles) return null;
    const hit = voiceFiles.find((f) => f.replace(/\.[^.]+$/u, '') === stem);
    if (!hit) throw new Error(`the voice folder has no clip named ${stem}: a re-voice replaces the whole folder`);
    return hit;
  };
  /** @type {Record<string, string | null | (string | null)[]>} */
  const voice = {};
  for (const node of commentary) voice[node.id] = node.id === 'n11' ? node.lines.map((_, i) => clipFile(`n11-${i + 1}`)) : clipFile(node.id);
  const placeholderSound = !voiceFiles || !haveMusic;
  if (!voiceFiles) notes.push('no voice folder: every clip is silence the length of its words, and every frame says PLACEHOLDER SOUND');
  else if (!haveMusic) notes.push('no music: every frame says PLACEHOLDER SOUND');

  const has = (/** @type {string} */ name) => takeFiles.includes(`c-${name}.mp4`);
  /** @type {Record<string, string[]>} */
  const framings = {};
  const all = ['wide', 'tight', 'turned'], have = all.filter((f) => has(`n09-${f}`));
  if (have.length) framings.n09 = have;
  if (have.length && have.length < all.length) notes.push(`node 9 has only ${have.join(', ')} of its three framings (missing ${all.filter((f) => !have.includes(f)).join(', ')}): its cuts rotate through those alone`);
  const slates = commentary.map((n) => n.id).filter((id) => (id === 'n09' ? !have.length && !has('n09') : id === 'n02b' ? false : !has(id)));
  for (const id of slates) notes.push(`${id} has no take: a slate stands in for it, marked PLACEHOLDER PICTURE`);
  const titleSlates = ['c-title-1', 'c-title-2'].filter((t) => !takeFiles.includes(`${t}.mp4`));
  for (const t of titleSlates) notes.push(`${t} has no take: a slate stands in for it, marked PLACEHOLDER PICTURE`);
  return { voice, placeholderSound, framings, slates, titleSlates, notes };
}

/**
 * The red stamps a piece of the film carries, and whether its picture is a slate: `PLACEHOLDER SOUND` on every frame when the sound
 * is a stand-in, `PLACEHOLDER PICTURE` on a slate. A real take with real sound carries none.
 * @param {ReturnType<typeof resolveInputs>} resolved
 * @param {{ take?: string }} piece `take` is the take's file name without `.mp4`, as `c-n09-wide`
 * @param {string[]} takeFiles
 * @returns {{ slate: boolean, stamps: string[] }}
 */
export function stampsFor(resolved, piece, takeFiles) {
  const stamps = resolved.placeholderSound ? ['PLACEHOLDER SOUND'] : [];
  const slate = Boolean(piece.take) && !takeFiles.includes(`${piece.take}.mp4`);
  if (slate) stamps.push('PLACEHOLDER PICTURE');
  return { slate, stamps };
}

/**
 * The recording the music map was measured on, or one of its shortened versions: refuses another by its length (always; the version's
 * own, `music.mjs`'s `expectedSeconds`) and, for the full recording, its sha1 (unless `anyRecording`), naming both the file's and the map's.
 * A shortened version is rendered by `music-cut.mjs` from the recording, so its sha1 is not the map's and is not asked.
 * @param {{ seconds: number, sha1: string, versions?: Record<string, any> }} map
 * @param {{ seconds: number, sha1: () => string }} recording the length read from the file, and a way to hash it
 * @param {boolean} [anyRecording] allow another recording of the same length (the sha1 check only)
 * @param {string} [version] `full` (the default), `mk-a` or `mk-b`
 */
export function checkRecording(map, recording, anyRecording = false, version = 'full') {
  const expected = expectedSeconds(map, version);
  if (Math.abs(recording.seconds - expected) > 0.05) throw new Error(`the music is ${recording.seconds.toFixed(3)} s but ${version === 'full' ? `the map was measured on a recording of ${map.seconds} s` : `${version} is ${expected.toFixed(3)} s by its recipe (node tools/hype/music-cut.mjs makes it)`}: this is not the recording the music map describes`);
  if (anyRecording || version !== 'full') return;
  const sha1 = recording.sha1();
  if (sha1 !== map.sha1) throw new Error(`the music's sha1 is ${sha1} but the map was measured on ${map.sha1} (--any-recording allows another recording of the same length)`);
}

/* ================================================================================================================================ */
/* Everything below runs ffmpeg, and runs only when this file is the command. */

const SOUNDS = 'instances/divided-world/ui/sounds';
/** The game's sound for what lands; a kind not listed has none. */
export const SOUND_FOR = { 'steel-chair': 'steel-chair-hit.mp3', filing: 'boo-1.mp3' };
const DUCK = { db: -10, attack: 0.15, release: 0.4 };
const MUSIC_LEVEL = 0.8;

/**
 * The music's gain over the film as one expression of `t`: down by `db` while any clip plays (a ramp of `attack` s before it, a
 * ramp of `release` s after), and never from `until` on (the coda). Pure.
 *
 * The music's first note is never already ducked: a clip that begins with the music (node 5's does) starts its `attack` ramp at `from`,
 * the music's first frame, so the first 150 ms ramp down rather than starting low. (The other choice, delaying the voice, would
 * move a clip inside a window that is already fitted to its length.) And a clip whose release would run into the coda releases
 * fully before it: its duck ends `release` s before `until`, so the music is back to full level when the coda's first chord sounds.
 * @param {{ start: number, length: number }[]} spans
 * @param {{ db: number, attack: number, release: number }} duck
 * @param {number} until
 * @param {number} [from] the film second the music begins
 */
export function duckExpression(spans, { db, attack, release }, until, from = -Infinity) {
  const dip = 1 - 10 ** (db / 20);
  const ramps = spans.filter((s) => s.start < until).map((s) => {
    const down = Math.max(s.start - attack, from), end = Math.min(s.start + s.length, until - release);
    return `min(clip((t-${down.toFixed(4)})/${attack},0,1),clip((${(end + release).toFixed(4)}-t)/${release},0,1))`;
  });
  if (!ramps.length) return '1';
  const deep = ramps.reduce((a, b) => `max(${a},${b})`);
  return `1-${dip.toFixed(6)}*(${deep})*lt(t,${until.toFixed(4)})`;
}

/** @param {string} p an ffmpeg filter argument's path */
const esc = (p) => p.replace(/\\/gu, '/').replace(/:/gu, '\\:').replace(/'/gu, "\\'");
const FILM = '0x15171d';

async function main() {
  const args = process.argv.slice(2);
  const has = (/** @type {string} */ n) => args.includes(`--${n}`);
  const TAKES = flag('takes', '.runs/hype'), VOICE = flag('voice', '.runs/hype/voice');
  const MUSIC = flag('music', '.runs/hype/music/mountain-king-musopen.flac');
  const OUT = flag('out', '.runs/hype/commentary.mp4'), PART = flag('part', ''), PRESET = flag('preset', 'veryfast');
  if (PART && !['one', 'two', 'three', 'out'].includes(PART)) throw new Error(`--part is one, two, three or out, not ${PART}`);

  const { commentary, ...instance } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
  const { title: TITLE_WORDS, note: TITLE_NOTE_WORDS } = titleWords(instance);
  const map = JSON.parse(readFileSync('instances/divided-world/ui/hype/music-map.json', 'utf8'));
  const WORK = path.join(path.dirname(OUT), 'work');
  mkdirSync(WORK, { recursive: true });

  /* The voice: a folder of clips, or silence the length of the words; which takes there are; what the run must say (resolveInputs). */
  const takeFiles = existsSync(TAKES) ? readdirSync(TAKES) : [];
  const haveVoice = existsSync(VOICE), haveMusic = existsSync(MUSIC);
  const resolved = resolveInputs({ commentary, voiceFiles: haveVoice ? readdirSync(VOICE) : null, takeFiles, haveMusic });
  for (const note of resolved.notes) console.log(`NOTE ${note}`);
  const voiceFile = (/** @type {string | null} */ name) => (name ? path.join(VOICE, name) : null);
  /** @type {Record<string, number | number[]>} */
  const clips = {};
  /** @type {Record<string, string | string[] | null>} */
  const voices = {};
  for (const node of commentary) {
    const named = resolved.voice[node.id];
    if (node.id === 'n11') {
      const files = /** @type {(string | null)[]} */ (named).map(voiceFile);
      voices.n11 = /** @type {string[]} */ (files);
      clips.n11 = node.lines.map((/** @type {string} */ l, /** @type {number} */ i) => (files[i] ? duration(files[i]) : spoken(l)));
    } else {
      voices[node.id] = voiceFile(/** @type {string | null} */ (named));
      clips[node.id] = voices[node.id] ? duration(/** @type {string} */ (voices[node.id])) : spoken(node.lines.join(' '));
    }
  }
  /* The takes, their notes, and the camera's moves. */
  const takePath = (/** @type {string} */ stem) => path.join(TAKES, `${stem}.mp4`);
  /** @type {Record<string, Camera>} */
  const moves = {};
  /** @type {Record<string, { what: string, frame: number }[]>} */
  const landed = {};
  /** @type {Record<string, number>} */
  const sizes = {};
  /** @type {Record<string, string[]>} */
  const framings = resolved.framings;
  const overrides = flag('moves', '') ? JSON.parse(readFileSync(flag('moves', ''), 'utf8')) : {};
  for (const node of commentary) {
    const id = node.id;
    const names = framings[id] ?? [];
    const probe = [takePath(`c-${id}`), ...names.map((f) => takePath(`c-${id}-${f}`))].find((f) => existsSync(f));
    if (probe) sizes[id] = videoInfo(probe).width;
    const notes = path.join(TAKES, `c-${id}.json`);
    const raw = existsSync(notes) ? JSON.parse(readFileSync(notes, 'utf8')) : {};
    const obj = Array.isArray(raw) ? { landed: raw } : raw;
    if (obj.landed?.length) landed[id] = obj.landed;
    const camera = { move: obj.move, punch: obj.punch, punches: obj.punches, ...overrides[id] };
    if (camera.move || camera.punch || camera.punches) moves[id] = camera;
  }

  const RECORDING = flag('recording', '');
  if (RECORDING && !VERSIONS.includes(RECORDING)) throw new Error(`--recording is ${VERSIONS.join(', ')}, not ${RECORDING}`);
  const tl = timeline(clips, map, { nodes: speechNodes(commentary), recording: RECORDING || undefined, moves, framings, sizes, landed });
  console.log(placementText(tl));
  /* The version's file: the recording itself, or the cut `music-cut.mjs` made of it beside it. */
  const musicFile = tl.music.version === 'full' ? MUSIC : path.join(path.dirname(MUSIC), `${tl.music.version}.flac`);
  if (haveMusic && !existsSync(musicFile)) throw new Error(`the music for ${tl.music.version} is not at ${musicFile}: node tools/hype/music-cut.mjs makes it from the recording`);
  if (haveMusic) checkRecording(map, { seconds: duration(musicFile), sha1: () => createHash('sha1').update(readFileSync(musicFile)).digest('hex') }, has('any-recording'), tl.music.version);
  const CAPTIONS = captionMode(args);
  const cuesAll = captions(commentary, tl);

  /* The cut list: the shots of every picture before the coda (cutlist.mjs), from the takes there are and their notes; `--cutlist none` cuts one take a node. */
  const LIST = flag('cutlist', 'instances/divided-world/ui/hype/cutlist.json');
  /** @type {ReturnType<typeof resolveList> | null} */
  let cutList = null;
  /** @type {any[] | undefined} */
  let codaList;
  /** @type {Record<string, any>} */
  const info = {};
  if (LIST !== 'none') {
    const list = JSON.parse(readFileSync(LIST, 'utf8'));
    codaList = list.coda;
    for (const stem of new Set([...list.rows, ...(list.coda ?? []).filter(Boolean)].map((/** @type {{ take: string }} */ r) => r.take))) {
      const file = takePath(stem);
      if (!existsSync(file)) continue;
      const notes = [`${stem}.json`, `${stem.replace(/-(wide|tight|turned)$/u, '')}.json`].map((f) => path.join(TAKES, f)).find((f) => existsSync(f));
      const raw = notes ? JSON.parse(readFileSync(notes, 'utf8')) : {};
      const obj = Array.isArray(raw) ? { landed: raw } : raw;
      info[stem] = { seconds: duration(file), width: videoInfo(file).width, landed: obj.landed ?? [], move: obj.move, punch: obj.punch, punches: obj.punches, ...overrides[stem] };
    }
    cutList = resolveList(list, { tl, cues: cuesAll, takes: info });
    for (const t of cutList.slates) console.log(`NOTE ${t} is a slate in the cut list: no take, a placeholder stands in, marked PLACEHOLDER PICTURE`);
    console.log(`cut list ${LIST}: ${cutList.shots.length} shots\n${cutList.blocks.map((b) => `  ${b.name.padEnd(12)} ${String(b.count).padStart(3)} shots, median ${b.median.toFixed(2)} s`).join('\n')}`);
  }
  if (has('sheet')) {
    const n11 = /** @type {typeof tl.nodes[number]} */ (tl.nodes.find((x) => x.id === 'n11'));
    console.log(`\npart one 0 to ${tl.part.one[1].toFixed(2)} s; two to ${tl.part.two[1].toFixed(2)}; three to ${tl.part.three[1].toFixed(2)}`);
    for (const v of n11.voice) console.log(`  n11 line ${(v.line ?? 0) + 1}: ${v.start.toFixed(2)} to ${(v.start + v.length).toFixed(2)} s`);
    console.log(`  the title's strike (c-title-1) ${tl.out.titleStart.toFixed(2)} s; the final strike (c-title-2) ${tl.out.finalStart.toFixed(2)} s; the picture fades from ${tl.out.fadeStart.toFixed(2)} s; the film ends at ${tl.out.end.toFixed(2)} s`);
    return;
  }

  /* Fonts. */
  const sans = fontFile('Verdana') ? 'Verdana' : 'DejaVu Sans';
  const bold = fontFile('DejaVu Sans', 'bold') ?? fontFile('DejaVu Sans') ?? '';
  const stampFile = (/** @type {string} */ name, /** @type {string} */ text) => { const f = path.join(WORK, `${name}.txt`); writeFileSync(f, text); return f; };
  const stamp = (/** @type {string} */ name, /** @type {string} */ text, /** @type {string} */ place, /** @type {string} */ color) => `drawtext=fontfile='${esc(bold)}':textfile='${esc(stampFile(name, text))}':fontsize=34:fontcolor=white:box=1:boxcolor=${color}@0.85:boxborderw=10:${place}`;
  const soundStamp = resolved.placeholderSound ? stamp('sound', 'PLACEHOLDER SOUND', 'x=24:y=24', 'red') : null;

  /* Which of the film's pieces this run makes. */
  const [from, to] = PART ? tl.part[/** @type {'one'} */ (PART)] : [0, tl.total];
  const fromFrame = Math.round(from * F), toFrame = Math.round(to * F);
  const inPart = (/** @type {{ startFrame: number, frames: number }} */ c) => c.startFrame >= fromFrame && c.startFrame < toFrame;

  /** @typedef {{ name: string, startFrame: number, frames: number, take?: string, slate?: string[], fadeAt?: number, cut?: Cut }} Piece */
  /** @type {Piece[]} */
  const pieces = [];
  const firstLine = (/** @type {string} */ id) => commentary.find((/** @type {{ id: string }} */ c) => c.id === id)?.lines[0] ?? '';
  for (const s of cutList?.shots ?? []) {
    const real = !stampsFor(resolved, { take: s.take }, takeFiles).slate;
    pieces.push({ name: `shot ${s.row}`, startFrame: s.startFrame, frames: s.frames, take: real ? takePath(s.take) : undefined, slate: real ? undefined : [s.take, ...wrap(firstLine(s.node), 36)], cut: s });
  }
  for (const n of tl.nodes.filter((x) => !cutList || x.id === 'n11')) {
    const first = firstLine(n.id);
    for (const [k, c] of (n.id === 'n11' ? directCoda(n.cuts, codaList, info) : n.cuts).entries()) {
      const take = takePath(c.take);
      const real = !stampsFor(resolved, { take: c.take }, takeFiles).slate;
      pieces.push({ name: `${n.id} cut ${k + 1}`, startFrame: c.startFrame, frames: c.frames, take: real ? take : undefined, slate: real ? undefined : [c.take, ...wrap(first, 36)], cut: c });
    }
  }
  /* The title: c-title-1 from the title's strike, c-title-2 from the final strike, each from its own frame 0; a missing take is a slate. */
  for (const [k, [name, a, b, words]] of /** @type {[string, number, number, string[]][]} */ ([['c-title-1', tl.out.titleStart, tl.out.finalStart, [TITLE_WORDS]], ['c-title-2', tl.out.finalStart, tl.out.end, wrap(TITLE_NOTE_WORDS, 30)]]).entries()) {
    const real = !resolved.titleSlates.includes(name);
    pieces.push({ name: `title ${k + 1}`, startFrame: Math.round(a * F), frames: framesBetween(a, b), take: real ? takePath(name) : undefined, slate: real ? undefined : [name, ...words], fadeAt: k === 1 ? tl.out.fadeStart - a : undefined, cut: { take: name, at: 0, start: a, length: b - a, startFrame: Math.round(a * F), frames: framesBetween(a, b), from: 0 } });
  }
  const mine = pieces.filter(inPart);

  const cues = cuesAll.filter((c) => c.end > from && c.start < to);
  writeFileSync(OUT.replace(/\.mp4$/u, '.srt'), srt(cues.map((c) => ({ ...c, start: Math.max(0, c.start - from), end: c.end - from }))));

  /* libass reads an .srt on a 288-line page, so FontSize 9 is 34 px of the 1080-line film, MarginV 4 is 15 px, and the margins 19 are 70 px. */
  /* One cut: its picture (the take or a slate, moved), its captions and its stamps, encoded once. */
  const encode = (/** @type {Piece} */ p, /** @type {number} */ i) => {
    const file = path.join(WORK, `cut-${String(i).padStart(3, '0')}.mp4`);
    const seconds = p.frames / F;
    const chain = [];
    /** @type {string[]} */
    let input;
    let srcWidth = 1920;
    if (p.take) {
      const info = videoInfo(p.take);
      srcWidth = info.width;
      const from0 = Math.min(p.cut?.from ?? 0, Math.max(0, duration(p.take) - 2 / F));
      /* A take shorter than its cut is frozen on its last frame (tpad): say so, and by how long. */
      const speed = p.cut?.speed ?? 1, have = Math.max(0, (duration(p.take) - from0) / speed), short = seconds - have;
      if (short > 1 / F) console.log(`HELD ${p.name}: ${path.basename(p.take)} runs ${have.toFixed(2)} s of its ${seconds.toFixed(2)} s, held ${short.toFixed(2)} s on its last frame`);
      input = ['-ss', from0.toFixed(4), '-i', p.take];
      if (p.cut?.speed !== undefined && Math.abs(p.cut.speed - 1) > 1e-9) chain.push(`setpts=PTS/${p.cut.speed.toFixed(6)}`);
      chain.push(`fps=${F}`, `tpad=stop_mode=clone:stop_duration=${Math.ceil(seconds) + 2}`);
    } else {
      input = ['-f', 'lavfi', '-i', `color=c=${FILM}:s=1920x1080:r=${F}`];
      const [label, ...text] = /** @type {string[]} */ (p.slate);
      chain.push(`drawtext=fontfile='${esc(bold)}':textfile='${esc(stampFile(`slate-${p.name.replace(/\W+/gu, '-')}`, label))}':fontsize=190:fontcolor=0x9aa4b8:x=90:y=110`);
      text.forEach((l, k) => chain.push(`drawtext=fontfile='${esc(bold)}':textfile='${esc(stampFile(`slate-${p.name.replace(/\W+/gu, '-')}-${k}`, l))}':fontsize=64:fontcolor=white:x=90:y=${380 + k * 90}`));
    }
    /* Every picture is brought to the film's range and matrix (limited, bt709): black is then black, whatever range the take was filmed in. */
    chain.push('scale=in_range=auto:out_range=tv:out_color_matrix=bt709:flags=lanczos');
    if (p.take || p.slate) {
      const cut = p.cut;
      const moved = cut && (cut.move || cut.punch || cut.punches);
      if (moved) {
        /* `perspective` takes the rectangle (turned by its roll) out of the picture at its own size, at fractional positions; a take larger than the film is then scaled down. */
        const w = Math.max(srcWidth, 1920), h = Math.round((w * 9) / 16);
        chain.push(`scale=${w}:${h}:flags=lanczos`);
        const c = corners({ ...cut, frames: p.frames }, w, h);
        chain.push(`perspective=${Object.entries(c).map(([k, v]) => `${k}='${v}'`).join(':')}:interpolation=cubic:eval=frame`);
        if (w !== 1920) chain.push('scale=1920:1080:flags=lanczos');
      } else chain.push('scale=1920:1080:flags=lanczos');
    }
    chain.push('format=yuv420p', 'setsar=1');
    if (p.slate) chain.push(stamp('picture', 'PLACEHOLDER PICTURE', soundStamp ? 'x=24:y=84' : 'x=24:y=24', 'red'));
    if (soundStamp) chain.push(soundStamp);
    const local = cues.filter((c) => c.end > p.startFrame / F && c.start < (p.startFrame + p.frames) / F).map((c) => ({ ...c, start: Math.max(0, c.start - p.startFrame / F), end: c.end - p.startFrame / F }));
    if (local.length && CAPTIONS !== 'off') {
      const f = path.join(WORK, `cap-${String(i).padStart(3, '0')}.srt`);
      writeFileSync(f, srt(local));
      chain.push(...captionFilters(CAPTIONS, f, sans));
    }
    /* The last piece's picture goes to black over the film's last FADE s: stamps and all. */
    if (p.fadeAt !== undefined) chain.push(`fade=t=out:st=${p.fadeAt.toFixed(4)}:d=${FADE}:color=black`);
    run([...input, '-vf', chain.join(','), '-frames:v', String(p.frames), '-r', String(F), '-an', '-c:v', 'libx264', '-preset', PRESET, '-crf', '17', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], `encode ${p.name}`);
    console.log(`${(p.startFrame / F).toFixed(2).padStart(8)} s  ${p.name.padEnd(12)} ${p.frames} frames${p.take ? ` of ${path.basename(p.take)}` : p.slate ? ' (slate)' : ''}${p.cut?.move ? ' (move)' : ''}${p.cut?.punch || p.cut?.punches ? ' (punch)' : ''}`);
    return file;
  };

  const files = mine.sort((a, b) => a.startFrame - b.startFrame).map(encode);
  writeFileSync(path.join(WORK, 'list.txt'), files.map((f) => `file '${path.basename(f)}'`).join('\n'));
  const picture = path.join(WORK, 'picture.mp4');
  run(['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'list.txt'), '-c', 'copy', picture], 'join the cuts');

  /* The sound. Built on the whole film's clock, then cut to the part. */
  const inputs = ['-i', picture], filters = [], voiceOut = [], mix = [];
  const input = (/** @type {string} */ f) => { inputs.push('-i', f); return inputs.filter((x) => x === '-i').length - 1; };
  const ms = (/** @type {number} */ s) => Math.round(s * 1000);
  for (const n of tl.nodes) {
    n.voice.forEach((v, i) => {
      const f = n.id === 'n11' ? /** @type {string[]} */ (voices.n11)[i] : /** @type {string} */ (voices[n.id]);
      if (!f) return;
      const k = input(f);
      filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(v.start)}:all=1[v${voiceOut.length}]`);
      voiceOut.push(`[v${voiceOut.length}]`);
    });
  }
  if (voiceOut.length) { filters.push(`${voiceOut.join('')}amix=inputs=${voiceOut.length}:normalize=0:duration=longest[voice]`); mix.push('[voice]'); }
  if (haveMusic) {
    const k = input(musicFile), m = tl.music;
    const duck = duckExpression(tl.nodes.flatMap((n) => n.voice).filter(() => haveVoice), DUCK, m.codaStart, m.start);
    filters.push(`[${k}:a]atrim=start=${m.from}:end=${m.until},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(m.start)}:all=1,volume=${MUSIC_LEVEL}[mu]`);
    filters.push(`[mu]volume='${duck}':eval=frame[music]`);
    mix.push('[music]');
  }
  /* The game's sounds on their landings: the shots' (a shot's take lands them at its own frames), and node 11's. */
  const hitList = (cutList ? [...cutList.shots.flatMap((/** @type {any} */ s) => s.hits.map((/** @type {{ what: string, at: number }} */ h) => ({ id: s.node, what: h.what, at: h.at }))), ...tl.hits.filter((h) => h.id === 'n11')] : tl.hits).sort((a, b) => a.at - b.at);
  const sounds = hitList.filter((h) => /** @type {Record<string, string>} */ (SOUND_FOR)[h.what]);
  sounds.forEach((h, i) => {
    const k = input(path.join(SOUNDS, /** @type {Record<string, string>} */ (SOUND_FOR)[h.what]));
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.8,adelay=${ms(h.at)}:all=1[s${i}]`);
    mix.push(`[s${i}]`);
  });
  filters.push(mix.length ? `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,alimiter=limit=0.95,apad=whole_dur=${tl.total.toFixed(3)},atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS[a]` : `anullsrc=r=48000:cl=stereo,atrim=0:${(to - from).toFixed(3)}[a]`);
  run([...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', ((toFrame - fromFrame) / F).toFixed(4), OUT], 'lay the sound under the picture');
  console.log(`wrote ${OUT}: ${((toFrame - fromFrame) / F).toFixed(2)} s${soundStamp ? ' (placeholder sound)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
