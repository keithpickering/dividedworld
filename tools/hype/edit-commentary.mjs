/**
 * The commentary video's edit (docs/plans/2026-11-21-commentary-video-plan.md, tasks 8 and 8a; the design, sections 5, 5a and 6): the
 * takes, the voice clips and the music assembled into one film, with captions.
 *
 *   node tools/hype/edit-commentary.mjs [--takes .runs/hype] [--voice .runs/hype/voice] [--music <recording>] [--circus <recording>]
 *       [--out .runs/hype/commentary.mp4] [--part one|two|three|out] [--captions top|foot|off] [--clean] [--sheet] [--moves moves.json]
 *       [--entries entries.json] [--preset veryfast] [--any-recording]
 *
 * This file is run with plain `node`: Node 22.18 and later strips the types of the instance's `commentary.ts` as it imports it (as
 * tools/check-guide.mjs reads the instance's `.ts`), so no flag is needed. The pure parts (`timeline`, `captions`, `srt`) are exported
 * for the tests; `moves.mjs` holds the camera's arithmetic; nothing runs ffmpeg unless this file is the command.
 *
 * TAKES are `c-n01` to `c-n11` and `c-end`, as `.mp4` under `--takes`, 60 frames a second, 1920 x 1080 or larger (3840 x 2160 gives the
 * moves twice the room). A take that is not there is replaced by a generated slate (a dark frame, the node and its first caption line),
 * so the whole film can be assembled before it is filmed. Node 9 may have three framings, `c-n09-wide`, `c-n09-tight` and `c-n09-turned`,
 * filmed on one clock: part three cuts between them on the theme's entries and each cut shows the same moment of the page. Node 11 is
 * ONE take, `c-n11`, whose clock runs through the coda; the edit cuts it at every chord. Part one's take is held on its last frame, or
 * trimmed, to its clip and a breath; a take is likewise held or trimmed to its window.
 *
 * A TAKE'S NOTES are an optional `c-nXX.json` beside it: either an array of landings, or an object with any of:
 *   { "landed": [{ "what": "steel-chair", "frame": 150 }],       frames of the take (60 a second) where something lands
 *     "move": { "from": R, "to": R, "ease": "inOut" },          R is { "x", "y", "w", "roll" }: the top-left corner and width as
 *     "punch": 12,                                               shares of the frame, and a roll in degrees
 *     "punches": [{ "frame": 40, "percent": 8 }] }

 * NODE 9's PLAYS ON THE THEME (the plan's Task 8): a node in part three that has `landed` (nodes 9 and 10) is retimed by `retime`: each theme
 * entry inside its window takes the nearest play, and the stretch before it is played faster or slower (`speed` on each cut, `from` where
 * the take is by then), never past a third either way, the same for every framing of the node. What cannot be placed is in the node's
 * `retime.unplaced` and printed. Only the PICTURE is retimed: the voice and the music are laid from the clips' and the map's times on their own
 * tracks, and the plays' game sounds follow their plays. The theme's entries are the map's (block 3, derived) unless block 3 of
 * `music-map.json` has a `set` (seconds of the recording, hand-set) or `--entries <file>` gives a JSON array of them (a number, or `{ "t" }`).
 * A landing plays its game sound (`steel-chair` the chair's hit, `filing` a boo; any other kind none) at its frame of the node, and in
 * part three is a punch-in. `move`, `punch` and `punches` are the camera's: they apply to every cut of the node, are refused in part
 * one (locked off), and `--moves` takes the same fields by node id in one file, over the take's own.
 *
 * MOVES (moves.mjs): for every output frame at 60 fps `perspective` samples the rectangle (turned by its roll) out of the take at a
 * fractional position (`zoompan` and `crop` step by whole pixels, which shows as judder); a push past twice the take's pixels is refused naming the cut.
 *
 * `--music` must be the recording the map was measured on: its length is checked against `music-map.json`'s `seconds` (0.05 s) and its sha1
 * against `sha1` (`--any-recording` waives the sha1 only). The run prints a NOTE for every stand-in (no voice, no music, a slate, a missing
 * `c-end`, a node 9 with only some of its framings), HELD for a take shorter than its cut and CUT for a node 11 line the chord takes.
 *
 * SOUND: the voice at full level; the music 10 dB down under each clip, 150 ms to go down and 400 ms to come
 * back, and never ducked from the coda's first chord; the game's sounds on their landings. Part one has no music; the music's first
 * note is on node 5's first frame, and the film is black and silent for 5 s from the final chord's end, then the end card for 10 s
 * (take `c-end`, else a rainbow with the card's words, in Comic Sans MS, else a stand-in saying so) under `--circus` if given.
 *
 * CAPTIONS: `<film>.srt` beside the film, and burned in (white on a translucent band, Verdana, else DejaVu Sans). `--captions top` (the
 * default) puts the band at the TOP of the frame, since the game's HUD (the class tag, the forecast) is at the foot; `foot` is the old place; `off`
 * burns nothing, and `--clean` is an alias of it. The band is as tall as its words need, one row or two. WITHOUT a voice folder each clip is silence of 150 words a minute and every frame says PLACEHOLDER SOUND; a slate's frames
 * say PLACEHOLDER PICTURE. `--sheet` prints the timing sheet and stops; `--part` assembles one part for a quick look.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { windows, fit, sheet, checkMap } from './windows.mjs';
import { refusePush, corners } from './moves.mjs';
import { retime } from './retime.mjs';
import { run, duration, videoInfo, fontFile, flag } from './cutting.mjs';

export const F = 60;
export const BREATH = 0.4;
export const WPM = 150;
export const BLACK = 5;
export const CARD = 10;
export const PART_ONE = ['n01', 'n02', 'n03', 'n04'];
const THEME_PUNCH = 8, CHORD_PUNCH = 10, LANDING_PUNCH = 5;

/** The frames between two times of the film. @param {number} a @param {number} b */
export const framesBetween = (a, b) => Math.round(b * F) - Math.round(a * F);

/**
 * @typedef {import('./moves.mjs').Move} Move
 * @typedef {{ take: string, at: number, start: number, length: number, startFrame: number, frames: number, from: number, speed?: number, move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} Cut
 * @typedef {{ start: number, length: number, line?: number, cut?: number }} Voice
 * @typedef {{ id: string, part: 1 | 2 | 3, start: number, end: number, length: number, frames: number, voice: Voice[], cuts: Cut[], hits: { what: string, at: number }[], retime?: ReturnType<typeof retime> }} NodeCut
 * @typedef {{ move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} Camera
 */

/**
 * The whole film's time, in seconds from its first frame, as a pure function of the clips' lengths and the music's map.
 *
 * Part one is voice-led: each node is its clip and a breath. The music starts on node 5's first frame, and from there every node sits
 * in its window (windows.mjs, fitted to the clips: `fit`'s refusal passes through, and node 11's lines are cut by the chords). From the
 * final chord's end there are `black` seconds of black and then `card` seconds of the end card.
 *
 * @param {Record<string, number | number[]>} clips seconds a node (node 11: one a line)
 * @param {Parameters<typeof windows>[0] & { firstNote: { t: number }, blocks: { entries: { t: number }[] }[] }} map
 * @param {{ breath?: number, moves?: Record<string, Camera>, framings?: Record<string, string[]>, sizes?: Record<string, number>, landed?: Record<string, { what: string, frame: number }[]>, entries?: number[], black?: number, card?: number }} [options]
 *   `moves`: the camera's moves by node; `framings`: the takes a node is cut between, by node; `sizes`: each node's take's width in
 *   pixels (default 1920); `landed`: what lands in each node, and at which frame of its take; `entries`: the theme's entries in seconds of the
 *   music, hand-set (else block 3's `set`, else its derived entries).
 */
export function timeline(clips, map, { breath = BREATH, moves = {}, framings = {}, sizes = {}, landed = {}, entries: handSet, black = BLACK, card = CARD } = {}) {
  checkMap(map);
  for (const id of [...PART_ONE, 'n05', 'n06', 'n07', 'n08', 'n09', 'n10', 'n11']) if (clips[id] === undefined) throw new Error(`${id} has no clip: a length in seconds is needed for every node`);
  for (const id of PART_ONE) if (moves[id] && Object.values(moves[id]).some((v) => v !== undefined)) throw new Error(`${id}: part one is locked off (the design, section 5a), so it carries no move, punch or landing punch`);
  const n11 = clips.n11;
  if (!Array.isArray(n11)) throw new Error('n11 needs one length a line (an array)');
  /* Part one has no window: only nodes 5 to 11 are fitted to the music. */
  const sung = Object.fromEntries(Object.entries(clips).filter(([id]) => !PART_ONE.includes(id)));
  const ws = windows(map, { fragments: n11.length, clips: sung });
  const slack = fit(ws, sung);

  /** @type {NodeCut[]} */
  const nodes = [];
  /** @param {string} id @param {1 | 2 | 3} part @param {number} start @param {number} end @param {Voice[]} voice @param {{ at: number }[]} bounds cut points inside the node */
  const add = (id, part, start, end, voice, bounds, shifted = false) => {
    const times = [0, ...bounds.map((b) => b.at), end - start];
    const camera = moves[id] ?? {};
    /* A node in part three with landings is retimed so its plays fall on the theme's entries (retime.mjs): the picture only. */
    const plays = landed[id] ?? [];
    const retimed = shifted && plays.length ? retime(plays.map((h) => ({ what: h.what, t: h.frame / F })), bounds.map((b) => b.at), end - start) : undefined;
    const hits = plays.map((h, i) => ({ ...h, t: retimed ? retimed.placed[i].at : h.frame / F }));
    /** @type {Cut[]} */
    const cuts = times.slice(0, -1).map((at, k) => {
      const length = times[k + 1] - at;
      const startFrame = Math.round((start + at) * F), endFrame = k === times.length - 2 ? Math.round(end * F) : Math.round((start + times[k + 1]) * F);
      /** @type {Cut} */
      const cut = { take: part === 3 && framings[id] ? `${id}-${framings[id][k % framings[id].length]}` : id, at, start: start + at, length, startFrame, frames: endFrame - startFrame, from: at };
      if (retimed) { cut.from = retimed.stretches[k].take[0]; cut.speed = retimed.stretches[k].speed; }
      if (camera.move) cut.move = camera.move;
      const punch = camera.punch ?? (k > 0 || id === 'n11' ? (id === 'n11' ? CHORD_PUNCH : THEME_PUNCH) : undefined);
      if (punch) cut.punch = punch;
      /** @type {{ frame: number, percent: number }[]} */
      const punches = [...(camera.punches ?? [])];
      /* A play on the cut's own first frame, in a cut that already punches on its entry, is that punch. */
      if (part === 3) for (const h of hits) if (h.t >= at - 1e-9 && h.t < at + length - 1e-9 && !(cut.punch && h.t - at < 1.5 / F)) punches.push({ frame: Math.round((h.t - at) * F), percent: LANDING_PUNCH });
      if (punches.length) cut.punches = punches;
      if (cut.move || cut.punch || cut.punches) refusePush(`${id} cut ${k + 1}`, cut, sizes[id] ?? 1920);
      return cut;
    });
    nodes.push({ id, part, start, end, length: end - start, frames: Math.round(end * F) - Math.round(start * F), voice, cuts, hits: hits.map((h) => ({ what: h.what, at: h.t })), ...(retimed ? { retime: retimed } : {}) });
  };

  let t = 0;
  for (const id of PART_ONE) {
    const clip = /** @type {number} */ (clips[id]);
    add(id, 1, t, t + clip + breath, [{ start: t, length: clip }], []);
    t += clip + breath;
  }
  const p1 = t, at = (/** @type {number} */ musicTime) => p1 + (musicTime - map.firstNote.t);
  const theme = handSet ?? /** @type {{ set?: number[] }} */ (map.blocks[2]).set ?? map.blocks[2].entries.map((/** @type {{ t: number }} */ e) => e.t);
  for (const w of ws) {
    const start = at(w.start), end = at(w.end);
    if (w.gaps) {
      const lines = w.gaps.map((g, i) => ({ start: at(g.start), length: Math.min(/** @type {number[]} */ (n11)[i], g.length), line: i, cut: /** @type {any} */ (slack.n11)[i].cut }));
      const chords = map.coda.chords.map((c) => c.t);
      add(w.id, 3, start, end, lines, chords.slice(1).filter((c) => c < w.end - 1e-9).map((c) => ({ at: c - chords[0] })));
    } else {
      const part = Number(w.id.slice(1)) >= 9 ? 3 : 2;
      const inside = part === 3 ? theme.filter((e) => e > w.start + 1e-9 && e < w.start + w.length - 1e-9).map((e) => ({ at: e - w.start })) : [];
      add(w.id, part, start, end, [{ start, length: /** @type {number} */ (clips[w.id]) }], inside, part === 3);
    }
  }
  const blackStart = at(map.coda.end.t);
  const nine = nodes.find((n) => n.id === 'n09');
  const hits = nodes.flatMap((n) => n.hits.filter((h) => h.at < n.length).map((h) => ({ id: n.id, what: h.what, at: n.start + h.at }))).sort((a, b) => a.at - b.at);
  return {
    nodes,
    windows: ws,
    slack,
    hits,
    music: { start: p1, from: map.firstNote.t, until: map.coda.end.t, untilFilm: blackStart, codaStart: at(map.coda.chords[0].t) },
    part: { one: [0, p1], two: [p1, nine.start], three: [nine.start, blackStart], out: [blackStart, blackStart + black + card] },
    out: { blackStart, cardStart: blackStart + black, end: blackStart + black + card },
    total: blackStart + black + card,
  };
}

/** @typedef {ReturnType<typeof timeline>} Timeline */

/**
 * The captions: each line of a node shown for its share of the node's clip, by its share of the node's characters. A node whose voice
 * is a clip a line (node 11) shows each line for as long as its clip plays, cut off by the chord as the voice is.
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
 *   `c-end` missing is reported (`endCard: 'stand-in'`).
 * @param {{ commentary: { id: string, lines: readonly string[] }[], voiceFiles: string[] | null, takeFiles: string[], haveMusic: boolean }} input
 * @returns {{ voice: Record<string, string | null | (string | null)[]>, placeholderSound: boolean, framings: Record<string, string[]>, slates: string[], endCard: 'take' | 'stand-in', notes: string[] }}
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
  const slates = commentary.map((n) => n.id).filter((id) => (id === 'n09' ? !have.length && !has('n09') : !has(id)));
  for (const id of slates) notes.push(`${id} has no take: a slate stands in for it, marked PLACEHOLDER PICTURE`);
  const endCard = has('end') ? 'take' : 'stand-in';
  if (endCard === 'stand-in') notes.push('c-end is missing: the end card is a generated stand-in, marked PLACEHOLDER PICTURE');
  return { voice, placeholderSound, framings, slates, endCard, notes };
}

/**
 * The red stamps a piece of the film carries, and whether its picture is a slate: `PLACEHOLDER SOUND` on every frame when the sound
 * is a stand-in, `PLACEHOLDER PICTURE` on a slate and on a stand-in end card. A real take with real sound carries none.
 * @param {ReturnType<typeof resolveInputs>} resolved
 * @param {{ take?: string, black?: boolean, card?: boolean }} piece `take` is the take's name, as `n09-wide`
 * @param {string[]} takeFiles
 * @returns {{ slate: boolean, stamps: string[] }}
 */
export function stampsFor(resolved, piece, takeFiles) {
  const stamps = resolved.placeholderSound ? ['PLACEHOLDER SOUND'] : [];
  const slate = Boolean(piece.take) && !takeFiles.includes(`c-${piece.take}.mp4`);
  if (slate || (piece.card && resolved.endCard === 'stand-in')) stamps.push('PLACEHOLDER PICTURE');
  return { slate, stamps };
}

/**
 * The recording the music map was measured on: refuses another by its length (always) and its sha1 (unless `anyRecording`), naming
 * both the file's and the map's.
 * @param {{ seconds: number, sha1: string }} map
 * @param {{ seconds: number, sha1: () => string }} recording the length read from the file, and a way to hash it
 * @param {boolean} [anyRecording] allow another recording of the same length (the sha1 check only)
 */
export function checkRecording(map, recording, anyRecording = false) {
  if (Math.abs(recording.seconds - map.seconds) > 0.05) throw new Error(`the music is ${recording.seconds.toFixed(3)} s but the map was measured on a recording of ${map.seconds} s: this is not the recording the music map describes`);
  if (anyRecording) return;
  const sha1 = recording.sha1();
  if (sha1 !== map.sha1) throw new Error(`the music's sha1 is ${sha1} but the map was measured on ${map.sha1} (--any-recording allows another recording of the same length)`);
}

/**
 * The timing sheet and the clips against their windows, built before anything that can throw on an overrun, so that a clip that
 * does not fit is diagnosed by the sheet and not hidden by the refusal: an overrunning clip is marked OVER by how much.
 * @param {Parameters<typeof windows>[0]} map
 * @param {Record<string, number | number[]>} clips
 */
export function sheetText(map, clips) {
  const n11 = clips.n11;
  const ws = windows(map, { fragments: Array.isArray(n11) ? n11.length : 3, clips: Object.fromEntries(Object.entries(clips).filter(([id]) => !PART_ONE.includes(id))) });
  const rows = ['', 'clip     seconds   window   slack'];
  for (const w of ws) {
    const c = clips[w.id];
    if (c === undefined) continue;
    if (w.gaps && Array.isArray(c)) c.forEach((s, i) => { const g = w.gaps?.[i]; if (g) rows.push(`${w.id}-${i + 1}`.padEnd(8) + s.toFixed(2).padStart(8) + g.length.toFixed(2).padStart(9) + (s > g.length ? `   cut ${(s - g.length).toFixed(2)}` : `   ${(g.length - s).toFixed(2)}`)); });
    else if (typeof c === 'number') rows.push(w.id.padEnd(8) + c.toFixed(2).padStart(8) + w.length.toFixed(2).padStart(9) + (c > w.length + 1e-9 ? `   OVER by ${(c - w.length).toFixed(2)}` : `${(w.length - c).toFixed(2).padStart(8)}`));
  }
  return `${sheet(ws)}\n${rows.join('\n')}`;
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
  const MUSIC = flag('music', '.runs/hype/music/mountain-king-musopen.flac'), CIRCUS = flag('circus', '');
  const OUT = flag('out', '.runs/hype/commentary.mp4'), PART = flag('part', ''), PRESET = flag('preset', 'veryfast');
  if (PART && !['one', 'two', 'three', 'out'].includes(PART)) throw new Error(`--part is one, two, three or out, not ${PART}`);

  const { commentary, END_CARD } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
  const map = JSON.parse(readFileSync('instances/divided-world/ui/hype/music-map.json', 'utf8'));
  const WORK = path.join(path.dirname(OUT), 'work');
  mkdirSync(WORK, { recursive: true });

  /* The voice: a folder of clips, or silence the length of the words; which takes there are; what the run must say (resolveInputs). */
  const takeFiles = existsSync(TAKES) ? readdirSync(TAKES) : [];
  const haveVoice = existsSync(VOICE), haveMusic = existsSync(MUSIC);
  const resolved = resolveInputs({ commentary, voiceFiles: haveVoice ? readdirSync(VOICE) : null, takeFiles, haveMusic });
  for (const note of resolved.notes) console.log(`NOTE ${note}`);
  if (haveMusic) checkRecording(map, { seconds: duration(MUSIC), sha1: () => createHash('sha1').update(readFileSync(MUSIC)).digest('hex') }, has('any-recording'));
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
  /* The sheet goes out before anything that can throw on an overrun, so it can diagnose one. */
  if (has('sheet')) console.log(sheetText(map, clips));

  /* The takes, their notes, and the camera's moves. */
  const takePath = (/** @type {string} */ name) => path.join(TAKES, `c-${name}.mp4`);
  /** @type {Record<string, Camera>} */
  const moves = {};
  /** @type {Record<string, { what: string, frame: number }[]>} */
  const landed = {};
  /** @type {Record<string, number>} */
  const sizes = {};
  /** @type {Record<string, string[]>} */
  const framings = resolved.framings;
  const entriesFile = flag('entries', '');
  /** @type {number[] | undefined} */
  const entries = entriesFile ? JSON.parse(readFileSync(entriesFile, 'utf8')).map((/** @type {number | { t: number }} */ e) => (typeof e === 'number' ? e : e.t)) : undefined;
  const overrides = flag('moves', '') ? JSON.parse(readFileSync(flag('moves', ''), 'utf8')) : {};
  for (const node of commentary) {
    const id = node.id;
    const names = framings[id] ?? [];
    const probe = [takePath(id), ...names.map((f) => takePath(`${id}-${f}`))].find((f) => existsSync(f));
    if (probe) sizes[id] = videoInfo(probe).width;
    const notes = path.join(TAKES, `c-${id}.json`);
    const raw = existsSync(notes) ? JSON.parse(readFileSync(notes, 'utf8')) : {};
    const obj = Array.isArray(raw) ? { landed: raw } : raw;
    if (obj.landed?.length) landed[id] = obj.landed;
    const camera = { move: obj.move, punch: obj.punch, punches: obj.punches, ...overrides[id] };
    if (camera.move || camera.punch || camera.punches) moves[id] = camera;
  }

  const tl = timeline(clips, map, { moves, framings, sizes, landed, entries });
  const CAPTIONS = captionMode(args);
  const cuesAll = captions(commentary, tl);
  if (has('sheet')) {
    for (const n of tl.nodes) if (n.retime) {
      console.log(`\n${n.id} retimed to the theme (speed = take seconds a film second):`);
      n.retime.stretches.forEach((s, k) => console.log(`  cut ${k + 1}  film ${s.out[0].toFixed(2)}-${s.out[1].toFixed(2)}  take ${s.take[0].toFixed(2)}-${s.take[1].toFixed(2)}  speed ${s.speed.toFixed(3)}${s.anchor ? `  (${s.anchor.what} at ${s.anchor.t.toFixed(2)} on the entry at ${s.out[1].toFixed(2)})` : ''}`));
      for (const u of n.retime.unplaced) console.log(`  NOT PLACED: ${u.what} (take ${u.t.toFixed(2)} s) needs ${u.needed.toFixed(3)} for its entry at ${u.entry.toFixed(2)}, gets ${u.speed.toFixed(3)}, plays ${u.late.toFixed(2)} s ${u.late < 0 ? 'before' : 'after'} it`);
    }
    console.log(`\npart one 0 to ${tl.part.one[1].toFixed(2)} s; two to ${tl.part.two[1].toFixed(2)}; three to ${tl.part.three[1].toFixed(2)}; black to ${tl.out.cardStart.toFixed(2)}; card to ${tl.out.end.toFixed(2)} s`);
    return;
  }

  /* Fonts. */
  const sans = fontFile('Verdana') ? 'Verdana' : 'DejaVu Sans';
  const bold = fontFile('DejaVu Sans', 'bold') ?? fontFile('DejaVu Sans') ?? '';
  const comic = fontFile('Comic Sans MS');
  const stampFile = (/** @type {string} */ name, /** @type {string} */ text) => { const f = path.join(WORK, `${name}.txt`); writeFileSync(f, text); return f; };
  const stamp = (/** @type {string} */ name, /** @type {string} */ text, /** @type {string} */ place, /** @type {string} */ color) => `drawtext=fontfile='${esc(bold)}':textfile='${esc(stampFile(name, text))}':fontsize=34:fontcolor=white:box=1:boxcolor=${color}@0.85:boxborderw=10:${place}`;
  const soundStamp = resolved.placeholderSound ? stamp('sound', 'PLACEHOLDER SOUND', 'x=24:y=24', 'red') : null;

  /* Which of the film's pieces this run makes. */
  const [from, to] = PART ? tl.part[/** @type {'one'} */ (PART)] : [0, tl.total];
  const fromFrame = Math.round(from * F), toFrame = Math.round(to * F);
  const inPart = (/** @type {{ startFrame: number, frames: number }} */ c) => c.startFrame >= fromFrame && c.startFrame + c.frames <= toFrame;

  /** @typedef {{ name: string, startFrame: number, frames: number, take?: string, slate?: string[], black?: boolean, card?: boolean, cut?: Cut }} Piece */
  /** @type {Piece[]} */
  const pieces = [];
  for (const n of tl.nodes) {
    const first = commentary.find((/** @type {{ id: string }} */ c) => c.id === n.id)?.lines[0] ?? '';
    for (const [k, c] of n.cuts.entries()) {
      const take = takePath(c.take);
      const real = !stampsFor(resolved, { take: c.take }, takeFiles).slate;
      pieces.push({ name: `${n.id} cut ${k + 1}`, startFrame: c.startFrame, frames: c.frames, take: real ? take : undefined, slate: real ? undefined : [c.take, ...wrap(first, 36)], cut: c });
    }
  }
  pieces.push({ name: 'black', startFrame: Math.round(tl.out.blackStart * F), frames: framesBetween(tl.out.blackStart, tl.out.cardStart), black: true });
  pieces.push({ name: 'end card', startFrame: Math.round(tl.out.cardStart * F), frames: framesBetween(tl.out.cardStart, tl.out.end), card: true, take: resolved.endCard === 'take' ? takePath('end') : undefined });
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
    } else if (p.black) {
      input = ['-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=${F}`];
    } else if (p.card) {
      const lines = wrap(END_CARD, 22);
      const size = comic ? 118 : 108, step = size * 1.25, top = (1080 - lines.length * step) / 2;
      const font = comic ?? bold;
      input = ['-f', 'lavfi', '-i', `gradients=s=1920x1080:r=${F}:n=7:c0=0xff0000:c1=0xff9900:c2=0xffee00:c3=0x00cc44:c4=0x00aaff:c5=0x5a3cff:c6=0xff00cc:x0=0:y0=0:x1=1920:y1=300:speed=0.00001`];
      lines.forEach((text, k) => chain.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(stampFile(`card-${k}`, text))}':fontsize=${size}:fontcolor=white:borderw=8:bordercolor=black:x=(w-text_w)/2:y=${Math.round(top + k * step)}`));
      if (!comic) chain.push(stamp('font', 'FONT MISSING: Comic Sans MS', 'x=24:y=h-th-24', 'red'));
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
    if (p.slate || (p.card && !p.take)) chain.push(stamp('picture', 'PLACEHOLDER PICTURE', soundStamp ? 'x=24:y=84' : 'x=24:y=24', 'red'));
    if (soundStamp) chain.push(soundStamp);
    const local = cues.filter((c) => c.end > p.startFrame / F && c.start < (p.startFrame + p.frames) / F).map((c) => ({ ...c, start: Math.max(0, c.start - p.startFrame / F), end: c.end - p.startFrame / F }));
    if (local.length && CAPTIONS !== 'off') {
      const f = path.join(WORK, `cap-${String(i).padStart(3, '0')}.srt`);
      writeFileSync(f, srt(local));
      chain.push(...captionFilters(CAPTIONS, f, sans));
    }
    run([...input, '-vf', chain.join(','), '-frames:v', String(p.frames), '-r', String(F), '-an', '-c:v', 'libx264', '-preset', PRESET, '-crf', '17', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file], `encode ${p.name}`);
    console.log(`${(p.startFrame / F).toFixed(2).padStart(8)} s  ${p.name.padEnd(12)} ${p.frames} frames${p.take ? ` of ${path.basename(p.take)}` : p.slate ? ' (slate)' : ''}${p.cut?.move ? ' (move)' : ''}${p.cut?.punch || p.cut?.punches ? ' (punch)' : ''}`);
    return file;
  };

  for (const n of tl.nodes) if (n.id === 'n11') (/** @type {{ cut: number }[]} */ (tl.slack.n11)).forEach((l, i) => { if (l.cut > 0) console.log(`CUT n11 line ${i + 1}: cut off by the chord by ${l.cut.toFixed(2)} s`); });
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
      filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,${v.cut ? `atrim=0:${v.length.toFixed(3)},afade=t=out:st=${Math.max(0, v.length - 0.03).toFixed(3)}:d=0.03,` : ''}adelay=${ms(v.start)}:all=1[v${voiceOut.length}]`);
      voiceOut.push(`[v${voiceOut.length}]`);
    });
  }
  if (voiceOut.length) { filters.push(`${voiceOut.join('')}amix=inputs=${voiceOut.length}:normalize=0:duration=longest[voice]`); mix.push('[voice]'); }
  if (haveMusic) {
    const k = input(MUSIC), m = tl.music;
    const duck = duckExpression(tl.nodes.flatMap((n) => n.voice).filter(() => haveVoice), DUCK, m.codaStart, m.start);
    filters.push(`[${k}:a]atrim=start=${m.from}:end=${m.until},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=${(m.until - m.from - 0.25).toFixed(3)}:d=0.25,adelay=${ms(m.start)}:all=1,volume=${MUSIC_LEVEL}[mu]`);
    filters.push(`[mu]volume='${duck}':eval=frame[music]`);
    mix.push('[music]');
  }
  const sounds = tl.hits.filter((h) => /** @type {Record<string, string>} */ (SOUND_FOR)[h.what]);
  sounds.forEach((h, i) => {
    const k = input(path.join(SOUNDS, /** @type {Record<string, string>} */ (SOUND_FOR)[h.what]));
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.8,adelay=${ms(h.at)}:all=1[s${i}]`);
    mix.push(`[s${i}]`);
  });
  if (CIRCUS && existsSync(CIRCUS)) {
    const k = input(CIRCUS);
    filters.push(`[${k}:a]atrim=0:${CARD},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.05,afade=t=out:st=${CARD - 0.6}:d=0.6,adelay=${ms(tl.out.cardStart)}:all=1[circus]`);
    mix.push('[circus]');
  }
  filters.push(mix.length ? `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,alimiter=limit=0.95,apad=whole_dur=${tl.total.toFixed(3)},atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS[a]` : `anullsrc=r=48000:cl=stereo,atrim=0:${(to - from).toFixed(3)}[a]`);
  run([...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', ((toFrame - fromFrame) / F).toFixed(4), OUT], 'lay the sound under the picture');
  console.log(`wrote ${OUT}: ${((toFrame - fromFrame) / F).toFixed(2)} s${soundStamp ? ' (placeholder sound)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
