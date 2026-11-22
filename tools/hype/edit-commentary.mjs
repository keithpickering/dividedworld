/**
 * The commentary video's edit (docs/plans/2026-11-21-commentary-video-plan.md, tasks 8 and 8a; the design, sections 5, 5a and 6; revised by
 * docs/plans/2026-11-21-commentary-video-revision-plan.md and the revision design's section 11, the owner's rewrite): the takes, the voice clips and
 * the music assembled into one film, with captions.
 *
 *   node tools/hype/edit-commentary.mjs [--takes .runs/hype] [--voice .runs/hype/voice] [--music <recording>]
 *       [--out .runs/hype/commentary.mp4] [--part calm|frantic|coda] [--captions top|foot|off] [--clean] [--sheet] [--moves moves.json]
 *       [--recording full|mk-a|mk-b|mk-plus1|mk-plus2|mk-plus3] [--lead 4.5] [--cutlist <file>|none] [--preset veryfast] [--any-recording]
 *
 * This file is run with plain `node`: Node 22.18 and later strips the types of the instance's `commentary.ts` as it imports it (as
 * tools/check-guide.mjs reads the instance's `.ts`), so no flag is needed. The pure parts (`timeline`, `captions`, `srt`, `chooseVersion`,
 * `franticCurve`) are exported for the tests; `moves.mjs` holds the camera's arithmetic; nothing runs ffmpeg unless this file is the command.
 *
 * THE NODES are whatever `commentary.ts` says, in its order: nothing here knows an id. What the timeline reads from each is
 *   `role`   `calm` (the opening, in the narrator's control), `frantic` (the picture takes over and the music rises) or `end` (the one line over
 *            black, last). The old `part` is mapped when there is no role: 1 and 2 calm, 3 frantic, and the node `n11` the end.
 *   `after`  seconds of silence before the node (the clip before it owns them); absent, a breath of 0.35 s. The first node's is not read: the film's
 *            opening silence is `--lead` (4.5 s).
 *   `locked` (optional; the old part 1 is locked) the camera is locked off there: no move, punch or landing punch.
 *   `caption` (optional, a string or lines) is shown in place of the node's `lines` on the screen (the voice says the lines).
 * and its clip is `<voice folder>/<id>.<ext>`.
 *
 * THE FILM, beat by beat. It OPENS IN SILENCE on the first take: `--lead` seconds (4.5) before the first node's voice, the first node's shot owning
 * them. The calm nodes follow, then the frantic ones, the LAST frantic node ending 0.2 s before the coda's first chord. The coda is the mountain
 * king's last strikes: the picture is cut on each (`list.coda` directs the cuts, cutlist.mjs `directCoda`) until the strike the BLACK begins on: the
 * latest strike at or before the end line's start less 0.05 s, so the line sits wholly in full-range black and any strike inside it plays over
 * black. The end line ENDS 0.25 s before the final strike; at the final strike the take `c-title` starts at its frame 0 and runs to the film's end
 * (the final chord's end + 1.2 s), fading to black over the last 0.8 s; a missing one is a slate with the instance's `TITLE` and `TITLE_TAG`.
 *
 * THE MUSIC is laid from its END (`timeline`): the coda's first chord falls where the last frantic node ends + 0.2 s. Which VERSION of the recording
 * (the full one, `mk-a` and `mk-b` shortened and `mk-plus1` to `mk-plus3` lengthened; music-cut.mjs makes them) is the rule `chooseVersion`: the music
 * starts as soon as possible AFTER the first node ends: the version with the smallest start that is at least 1 s after the first node's voice ends
 * (the opening lines are in silence, then the music sneaks in under the calm narration); `--recording` fixes it. The run prints the version, the
 * start, where in the speech the second block and the full orchestra fall, and the ending.
 *
 * THE VOICE AGAINST THE MUSIC: through the frantic nodes the music's duck lessens (10 dB down at the first, 4 at the last) while the voice is
 * lifted (up to +4 dB at the last; `franticCurve`), and the voice goes through a gentle limiter so a scream does not clip.
 *
 * THE CUT LIST (`--cutlist`, default `instances/divided-world/ui/hype/cutlist.json`; cutlist.mjs says what a row is) gives every shot of the picture
 * from the first frame to the coda. A take's own notes (`<take>.json`: landings, a move, punches) apply to its shots, a row's `move` over them. A shot
 * with a move or punch in a frantic node is rendered with MOTION BLUR by default (`"blur": false` to refuse it): the camera's own, at 4x temporal
 * resolution, four sub-frame positions across a 180 degree shutter averaged (moves.mjs `blurRects`); `"blur": true` asks for it anywhere. A row may begin
 * with a WHIP: `"cut": "whip-left"` (or right, up, down), `"cutFrames": 6`: the outgoing shot's last frames slide off and the incoming one's slide in,
 * both blurred. `--cutlist none` cuts one take a node.
 *
 * TAKES are `c-<id>` per node (or the names a cut list gives), `.mp4` under `--takes`, 60 frames a second, 1920 x 1080 or larger (3840 x 2160 gives the
 * moves twice the room), and `c-title`. A take that is not there is replaced by a generated slate. A take is held on its last frame, or trimmed, to its cut.
 *
 * A TAKE'S NOTES are an optional `c-nXX.json` beside it: either an array of landings, or an object with any of:
 *   { "landed": [{ "what": "steel-chair", "frame": 150 }],       frames of the take (60 a second) where something lands
 *     "move": { "from": R, "to": R, "ease": "inOut" },          R is { "x", "y", "w", "roll" }: the top-left corner and width as
 *     "punch": 12,                                               shares of the frame, and a roll in degrees
 *     "punches": [{ "frame": 40, "percent": 8 }] }
 * A landing plays its game sound (`steel-chair` or `hit` the chair's hit, its impact on the landing's frame, `filing` a boo, `send` the send; any other kind
 * none) at its frame, and in a frantic node is a punch-in.
 *
 * MOVES (moves.mjs): for every output frame at 60 fps `perspective` samples the rectangle (turned by its roll) out of the take at a
 * fractional position (`zoompan` and `crop` step by whole pixels, which shows as judder); a push past twice the take's pixels is refused naming the cut.
 *
 * `--music` must be the recording the map was measured on: its length is checked against `music-map.json`'s `seconds` (0.05 s) and its sha1
 * against `sha1` (`--any-recording` waives the sha1 only); a version is checked against its recipe's length. The run prints a NOTE for every stand-in (no
 * voice, no music, a slate, no title take) and HELD for a take shorter than its cut.
 *
 * SOUND: the voice, lifted through the frantic nodes; the music 10 dB down under each clip (less in the frantic nodes), 150 ms to go down and 400 ms to
 * come back, and never ducked from the coda's first chord; the game's sounds on their landings.
 *
 * CAPTIONS: `<film>.srt` beside the film, and burned in (white on a translucent band, Verdana, else DejaVu Sans). `--captions top` (the
 * default) puts the band at the TOP of the frame, since the game's HUD (the class tag, the forecast) is at the foot; `foot` is the old place; `off`
 * burns nothing, and `--clean` is an alias of it. The band is as tall as its words need, one row or two. WITHOUT a voice folder each clip is silence of
 * 150 words a minute and every frame says PLACEHOLDER SOUND; a slate's frames say PLACEHOLDER PICTURE. `--sheet` prints the timing sheet (the lead,
 * every node's time, the version and the music's start, the block boundaries in the speech, each strike of the coda, the black and the line in it,
 * the title's strike and the film's end) and stops; `--part` assembles one part for a quick look.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { versionMap, expectedSeconds, beats, VERSIONS } from './music.mjs';
import { refusePush, corners, expressions, subframes, parseWhip, whipExpressions, SUBFRAMES } from './moves.mjs';
import { run, duration, videoInfo, fontFile, flag } from './cutting.mjs';
import { resolveList, directCoda, codaHits } from './cutlist.mjs';

export const F = 60;
export const BREATH = 0.35;
export const CODA_AFTER = 0.2;
/** The film opens in silence: seconds before the first node's voice. */
export const LEAD = 4.5;
/** The music starts at least this long after the first node's voice ends. */
export const AFTER_FIRST = 1;
/** The end line ends this long before the final strike, and the black begins at the latest strike at least this long before the line starts. */
export const LINE_BEFORE_FINAL = 0.25;
export const BLACK_BEFORE_LINE = 0.05;
export const WPM = 150;
export const TAIL = 1.2;
export const FADE = 0.8;
const CHORD_PUNCH = 10, LANDING_PUNCH = 5;

/** The voice's lift and the music's duck through the frantic nodes: from nothing and 10 dB at the first to +4 dB and 4 dB at the last. */
export const MAX_VOICE_DB = 4, DUCK_DB = -10, DUCK_LAST_DB = -4;

/**
 * The mix of the `index`th of `count` frantic nodes (from 0): the voice's gain and the music's duck depth in dB, both linear from the first to the last,
 * a single frantic node being the last. The orchestra is felt more and the voice louder as the film goes on. Pure.
 * @param {number} index @param {number} count
 */
export function franticCurve(index, count) {
  const p = count > 1 ? Math.min(1, Math.max(0, index / (count - 1))) : 1;
  return { voiceDb: MAX_VOICE_DB * p, duckDb: DUCK_DB + (DUCK_LAST_DB - DUCK_DB) * p };
}

/** ffmpeg's volume filter for a node's lift. @param {number} db */
export const voiceGain = (db) => (db === 0 ? 'volume=0dB' : `volume=${db.toFixed(2)}dB`);
/** A gentle limiter on the voice bus: a scream that was lifted does not clip (5 ms attack, 60 ms release, the ceiling just under full scale; no auto level). */
export const VOICE_LIMITER = 'alimiter=limit=0.89:attack=5:release=60:level=0';

/** The frames between two times of the film. @param {number} a @param {number} b */
export const framesBetween = (a, b) => Math.round(b * F) - Math.round(a * F);

/**
 * @typedef {import('./moves.mjs').Move} Move
 * @typedef {{ take: string, at: number, start: number, length: number, startFrame: number, frames: number, from: number, speed?: number, move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} Cut
 * @typedef {{ start: number, length: number }} Voice
 * @typedef {{ voiceDb: number, duckDb: number }} Mix
 * @typedef {{ id: string, role: 'calm' | 'frantic' | 'coda' | 'end', locked: boolean, start: number, end: number, length: number, frames: number, voice: Voice[], cuts: Cut[], hits: { what: string, at: number }[], mix: Mix }} NodeCut
 * @typedef {{ move?: Move, punch?: number, punches?: { frame: number, percent: number }[] }} Camera
 * @typedef {{ id: string, role?: string, part?: number, after?: number, locked?: boolean }} NodeSpec
 */

/**
 * The nodes as the timeline takes them: each with its role (the data's `role`, else the old `part` mapped, `n11` the end), its lock and its pause.
 * Refuses a role that is not `calm`, `frantic` or `end`, an order that is not calm, frantic, end, and anything but one end node, last.
 * @param {NodeSpec[]} specs
 * @returns {{ id: string, role: 'calm' | 'frantic' | 'end', locked: boolean, after?: number }[]}
 */
export function roles(specs) {
  /* The old data's lock-off was part 1 less its last node (the camera first moved in node 4). */
  const lastOne = specs.filter((n) => n.part === 1 && n.role === undefined).at(-1);
  const out = specs.map((n) => {
    const role = n.role ?? (n.id === 'n11' ? 'end' : n.part === 3 ? 'frantic' : 'calm');
    if (role !== 'calm' && role !== 'frantic' && role !== 'end') throw new Error(`${n.id} has the role ${JSON.stringify(role)}: a node is calm, frantic or end`);
    return { id: n.id, role: /** @type {'calm' | 'frantic' | 'end'} */ (role), locked: n.locked ?? (n.part === 1 && n !== lastOne), after: n.after };
  });
  const ends = out.filter((n) => n.role === 'end');
  if (ends.length === 0) throw new Error('no node has the role end: the film needs one line over black, last');
  if (ends.length > 1) throw new Error(`${ends.map((n) => n.id).join(' and ')} are both end nodes: the film has one end node`);
  if (out.at(-1)?.role !== 'end') throw new Error(`the end node ${ends[0].id} is not last: the line over black is the last node`);
  let rank = 0;
  for (const n of out.slice(0, -1)) {
    const r = n.role === 'calm' ? 0 : 1;
    if (r < rank) throw new Error(`${n.id} is calm after a frantic node: the roles run calm, then frantic`);
    rank = r;
  }
  if (out.length < 2) throw new Error('the film needs a spoken node before the end node');
  return out;
}

/** The nodes of `commentary.ts` as `timeline` takes them. @param {NodeSpec[]} commentary */
export const speechNodes = (commentary) => commentary.map((n) => ({ id: n.id, role: n.role, part: n.part, after: n.after, locked: n.locked }));

/**
 * The version of the recording the music is laid from: the smallest start that is at or after `threshold` (the first node ends, plus a second);
 * when none is, the one that starts latest, which is the shortest, and `met` is false. Ties go to the earlier in the object. Pure.
 * @param {Record<string, number>} starts the film second each version's own second 0 would be at
 * @param {number} threshold
 * @returns {{ version: string, met: boolean }}
 */
export function chooseVersion(starts, threshold) {
  const names = Object.keys(starts), ok = names.filter((n) => starts[n] >= threshold - 1e-9);
  if (ok.length) return { version: ok.reduce((a, b) => (starts[b] < starts[a] ? b : a)), met: true };
  return { version: names.reduce((a, b) => (starts[b] > starts[a] ? b : a)), met: false };
}

/**
 * The whole film's time, in seconds from its first frame, as a pure function of the clips' lengths and the music's map.
 *
 * The film opens in silence (`lead` s), then the narration runs node after node, a breath (or the node's `after`) between; the first node's shot owns
 * the lead. The last frantic node ends 0.2 s before the coda's first chord, and the music is laid from its END so that its first chord falls there; the
 * version is `chooseVersion`'s. A start before the film's first frame is trimmed: `music.start` is then 0 and `music.from` the seconds of the recording
 * skipped. The coda is cut on its strikes to the one the black begins on (the latest strike at or before the end line's start less 0.05 s); the end line
 * is placed to end 0.25 s before the final strike, refused when it would have to start before the coda's first chord; the title begins at the final
 * strike and the film ends at the final chord's end plus `TAIL` s, the picture fading over the last `FADE` s.
 *
 * @param {Record<string, number>} clips seconds a node, the end node's line included
 * @param {any} map the committed music map (music-map.json)
 * @param {{ nodes: NodeSpec[], lead?: number, recording?: string, breath?: number, moves?: Record<string, Camera>, sizes?: Record<string, number>, landed?: Record<string, { what: string, frame: number }[]> }} options
 *   `moves`: the camera's moves by node; `sizes`: each node's take's width in pixels (default 1920); `landed`: what lands in each node, and at which frame of its take.
 */
export function timeline(clips, map, { nodes: given, lead: leadGiven, recording, breath = BREATH, moves = {}, sizes = {}, landed = {} } = /** @type {any} */ ({})) {
  if (!given) throw new Error('timeline needs the nodes (commentary.ts): their roles and pauses decide the film');
  const order = roles(given);
  /* The first node's own `after` is not read: the lead is the opening silence. */
  const lead = leadGiven ?? LEAD;
  if (typeof lead !== 'number' || !Number.isFinite(lead) || lead < 0) throw new Error(`the lead is a number of seconds, zero or more, not ${JSON.stringify(lead)}`);
  const endNode = /** @type {typeof order[number]} */ (order.at(-1)), spoken = order.slice(0, -1);
  for (const { id } of order) if (clips[id] === undefined) throw new Error(`${id} has no clip: a length in seconds is needed for every node`);
  for (const [k, seconds] of Object.entries(clips)) if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error(`${k} has a clip length of ${JSON.stringify(seconds)}: a clip is a number of seconds, zero or more`);
  for (const n of order.filter((x) => x.locked)) if (moves[n.id] && Object.values(moves[n.id]).some((v) => v !== undefined)) throw new Error(`${n.id}: the camera is locked off here (the design, section 5a), so it carries no move, punch or landing punch`);

  /* The narration, node after node, from the lead. The first node's picture owns the lead. */
  /** @type {Record<string, number>} */
  const starts = {}, voiceStarts = {};
  let t = lead;
  spoken.forEach((n, i) => { if (i > 0) t += n.after ?? breath; voiceStarts[n.id] = t; starts[n.id] = i === 0 ? 0 : t; t += clips[n.id]; });
  const codaStart = t + CODA_AFTER;
  const firstEnd = voiceStarts[spoken[0].id] + clips[spoken[0].id];

  /* The music, laid from its end: the version whose start is the smallest at or after the first node's end plus a second. */
  const names = ['full', ...Object.keys(map.versions ?? {})];
  const startOf = (/** @type {string} */ name) => codaStart - versionMap(map, name).coda.chords[0].t;
  const threshold = firstEnd + AFTER_FIRST;
  /** @type {Record<string, number>} */
  const allStarts = Object.fromEntries(names.map((n) => [n, startOf(n)]));
  const notes = [];
  let version = recording;
  if (version === undefined) {
    const pick = chooseVersion(allStarts, threshold);
    version = pick.version;
    if (!pick.met) notes.push(`no version of the recording lets the music start ${AFTER_FIRST} s after the opening lines (the first node ends at ${firstEnd.toFixed(2)} s): ${version}, the shortest, starts at ${allStarts[version].toFixed(2)} s, before the speech allows`);
  } else if (!names.includes(version)) throw new Error(`there is no version ${JSON.stringify(version)}: the map's are ${names.join(', ')}`);
  const v = versionMap(map, version), musicStart = startOf(version);
  const at = (/** @type {number} */ musicTime) => musicStart + musicTime;

  /* The ending: the end line, the black, the title. */
  const strikes = v.coda.chords.map((c) => at(c.t));
  if (strikes.length < 2) throw new Error(`the coda has ${strikes.length} chord: the film needs a first chord and a final strike`);
  const finalStart = strikes[strikes.length - 1], lineEnd = finalStart - LINE_BEFORE_FINAL, line = clips[endNode.id], lineStart = lineEnd - line;
  const latest = lineStart - BLACK_BEFORE_LINE;
  let blackIndex = -1;
  strikes.slice(0, -1).forEach((s, i) => { if (s <= latest + 1e-9) blackIndex = i; });
  if (blackIndex < 0) throw new Error(`${endNode.id}'s line is ${line.toFixed(2)} s and would have to start ${(strikes[0] - latest).toFixed(2)} s before the coda's first chord (the black begins on a strike at least ${BLACK_BEFORE_LINE} s before the line, the line ends ${LINE_BEFORE_FINAL} s before the final strike): too long by ${(strikes[0] - latest).toFixed(2)} s`);
  const blackStart = strikes[blackIndex], end = at(v.coda.end.t) + TAIL;

  /** @type {NodeCut[]} */
  const cutNodes = [];
  const franticIds = order.filter((n) => n.role === 'frantic').map((n) => n.id);
  /** @param {string} id @returns {Mix} */
  const mixOf = (id) => {
    const i = franticIds.indexOf(id);
    if (i >= 0) return franticCurve(i, franticIds.length);
    if (id === endNode.id && franticIds.length) return franticCurve(franticIds.length - 1, franticIds.length);
    return { voiceDb: 0, duckDb: DUCK_DB };
  };
  /** @param {string} id @param {NodeCut['role']} role @param {boolean} locked @param {number} start @param {number} stop @param {Voice[]} voice @param {{ at: number }[] | null} bounds cut points inside the node; null: the node is not a take's */
  const add = (id, role, locked, start, stop, voice, bounds) => {
    const camera = moves[id] ?? {};
    const plays = landed[id] ?? [];
    const hits = plays.map((h) => ({ ...h, t: h.frame / F }));
    const times = bounds ? [0, ...bounds.map((b) => b.at), stop - start] : [];
    /** @type {Cut[]} */
    const cuts = !bounds || stop - start <= 0 ? [] : times.slice(0, -1).map((cutAt, k) => {
      const length = times[k + 1] - cutAt;
      const startFrame = Math.round((start + cutAt) * F), endFrame = k === times.length - 2 ? Math.round(stop * F) : Math.round((start + times[k + 1]) * F);
      /** @type {Cut} */
      const cut = { take: `c-${id}`, at: cutAt, start: start + cutAt, length, startFrame, frames: endFrame - startFrame, from: cutAt };
      if (camera.move) cut.move = camera.move;
      const punch = camera.punch ?? (role === 'coda' ? CHORD_PUNCH : undefined);
      if (punch) cut.punch = punch;
      /** @type {{ frame: number, percent: number }[]} */
      const punches = [...(camera.punches ?? [])];
      /* A play on the cut's own first frame, in a cut that already punches on its entry, is that punch. */
      if (role === 'frantic') for (const h of hits) if (h.t >= cutAt - 1e-9 && h.t < cutAt + length - 1e-9 && !(cut.punch && h.t - cutAt < 1.5 / F)) punches.push({ frame: Math.round((h.t - cutAt) * F), percent: LANDING_PUNCH });
      if (punches.length) cut.punches = punches;
      if (cut.move || cut.punch || cut.punches) refusePush(`${id} cut ${k + 1}`, cut, sizes[id] ?? 1920);
      return cut;
    });
    cutNodes.push({ id, role, locked, start, end: stop, length: stop - start, frames: Math.round(stop * F) - Math.round(start * F), voice, cuts, hits: hits.map((h) => ({ what: h.what, at: h.t })), mix: mixOf(id) });
  };

  spoken.forEach((n, i) => {
    const stop = i + 1 < spoken.length ? voiceStarts[spoken[i + 1].id] : codaStart;
    add(n.id, n.role, n.locked, starts[n.id], stop, [{ start: voiceStarts[n.id], length: clips[n.id] }], []);
  });
  add('coda', 'coda', false, codaStart, blackStart, [], strikes.slice(1, blackIndex).map((s) => ({ at: s - codaStart })));
  add(endNode.id, 'end', false, blackStart, finalStart, [{ start: lineStart, length: line }], null);

  /* Where the theme's second block and the full orchestra fall in the speech. */
  const place = (/** @type {number} */ musicTime) => {
    const film = at(musicTime), node = cutNodes.find((n) => n.role !== 'end' && n.role !== 'coda' && film >= n.start - 1e-9 && film < n.end - 1e-9);
    return { at: film, node: node?.id ?? 'coda', into: node ? film - node.voice[0].start : film - codaStart };
  };
  const firstOf = (/** @type {number} */ block) => /** @type {{ start: number }} */ (v.statements.find((s) => s.block === block)).start;

  const hits = cutNodes.flatMap((n) => n.hits.filter((h) => h.at < n.length).map((h) => ({ id: n.id, what: h.what, at: n.start + h.at }))).sort((a, b) => a.at - b.at);
  const firstFrantic = cutNodes.find((n) => n.role === 'frantic');
  return {
    lead,
    nodes: cutNodes,
    hits,
    codaStart,
    music: { version, start: Math.max(0, musicStart), from: Math.max(0, -musicStart), until: v.coda.end.t + TAIL, untilFilm: end, codaStart, notes, choice: { threshold, firstEnd, starts: allStarts }, second: place(firstOf(2)), third: place(firstOf(3)), statements: v.statements.map((s) => ({ n: s.n, copy: s.copy ?? 0, start: at(s.start), length: s.length })), beats: beats(map, version).map(at), strikes },
    part: { calm: [0, firstFrantic?.start ?? codaStart], frantic: [firstFrantic?.start ?? codaStart, codaStart], coda: [codaStart, end] },
    ending: { line: endNode.id, lineStart, lineEnd, blackStrike: blackIndex + 1, strikes: strikes.length, blackStart, finalStart, gap: finalStart - blackStart },
    out: { blackStart, finalStart, fadeStart: end - FADE, end },
    total: end,
  };
}

/** @typedef {ReturnType<typeof timeline>} Timeline */

/**
 * What a run says about the ending: where the black begins, the line in it, the title and the film's end.
 * @param {Timeline} tl
 */
export function endingText(tl) {
  const e = tl.ending, s = (/** @type {number} */ x) => x.toFixed(2);
  return [
    `ending: the coda's first chord is at ${s(tl.codaStart)} s and the final strike at ${s(e.finalStart)} s; black from strike ${e.blackStrike} of ${e.strikes} at ${s(e.blackStart)} s (a strike inside the black plays over black); the line ${e.line} plays ${s(e.lineStart)} to ${s(e.lineEnd)} s, ${LINE_BEFORE_FINAL} s before the final strike; black gap ${s(e.gap)} s`,
    `title: c-title from frame 0 at the final strike, ${s(e.finalStart)} s; the picture fades from ${s(tl.out.fadeStart)} s; the film ends at ${s(tl.out.end)} s, ${TAIL} s after the final chord ends`,
  ].join('\n');
}

/**
 * What a run says about the music's place: the version and why, where it starts, where in the speech the second block and the full orchestra fall, and the ending.
 * @param {Timeline} tl
 */
export function placementText(tl) {
  const m = tl.music, where = (/** @type {{ at: number, node: string, into: number }} */ p) => `${p.at.toFixed(2)} s, in ${p.node}, ${p.into.toFixed(2)} s in`;
  const starts = Object.entries(m.choice.starts).map(([k, x]) => `${k} ${x.toFixed(1)}`).join(', ');
  return [
    `music: ${m.version}, starts ${m.start.toFixed(2)} s into the film${m.from > 0 ? ` (the first ${m.from.toFixed(2)} s of the recording are left out)` : ''}; the first chord of the coda is at ${m.codaStart.toFixed(2)} s`,
    `  the rule: the smallest start at or after ${m.choice.threshold.toFixed(2)} s (the first node ends at ${m.choice.firstEnd.toFixed(2)} s, and a second more); the starts of the versions: ${starts}`,
    `block 2 (the violins) at ${where(m.second)}`,
    `full orchestra at ${where(m.third)}`,
    endingText(tl),
    ...m.notes.map((n) => `NOTE ${n}`),
  ].join('\n');
}

/**
 * The captions: each line of a node shown for its share of the node's clip, by its share of the node's characters; a node's `caption` is shown in place
 * of its `lines`. The coda has none, the end node's line is shown over its black, and nothing is captioned during the title.
 * @param {{ id: string, lines: readonly string[], caption?: string | readonly string[] }[]} commentary
 * @param {Timeline} tl
 * @returns {{ node: string, start: number, end: number, text: string }[]}
 */
export function captions(commentary, tl) {
  const cues = [];
  for (const node of tl.nodes) {
    const item = commentary.find((c) => c.id === node.id);
    const lines = item?.caption !== undefined ? [item.caption].flat() : item?.lines;
    if (!lines || !node.voice.length) continue;
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
 * The title's words from the instance's `commentary.ts`: `TITLE` and `TITLE_TAG` (the line under it, "INVITE ONLY") when it has them; until the data has
 * TITLE_TAG, what is there: `TITLE_NOTE`, else the deprecated `END_CARD` split at the first parenthesis (the title, then the parenthetical).
 * @param {{ TITLE?: string, TITLE_TAG?: string, TITLE_NOTE?: string, END_CARD?: string }} mod
 * @returns {{ title: string, tag: string }}
 */
export function titleWords(mod) {
  if (mod.TITLE !== undefined) return { title: mod.TITLE, tag: mod.TITLE_TAG ?? mod.TITLE_NOTE ?? '' };
  const m = mod.END_CARD?.match(/^(.*?)\s*(\(.*)$/su);
  if (m) return { title: m[1], tag: m[2] };
  if (mod.END_CARD) return { title: mod.END_CARD, tag: '' };
  throw new Error('the instance`s commentary.ts exports no TITLE (and no deprecated END_CARD): the film has no title to show');
}

/* ---- what the film is made of: the guards against one that looks finished and is not ---- */

/**
 * Which voice clips and takes a run uses, and what it refuses or must say (pure: it is given the folders' listings).
 *
 * - `voiceFiles` is the voice folder's file names, or null when there is no folder. No folder: every clip is silence the length of
 *   its words and `placeholderSound` is set. A folder that is missing any one node's clip (`<id>`, whatever extension) is refused naming that
 *   clip: a re-voice replaces the whole folder, and one clip silent in a film of voice is a film that looks finished and is not.
 * - `haveMusic` false also sets `placeholderSound`.
 * - `takeFiles` is the takes folder's file names. A node with no `c-<id>.mp4` is a slate (`slates`; the end node, which is over black, needs no take);
 *   `c-title.mp4` missing is a slate too (`titleSlate`), reported.
 * @param {{ commentary: { id: string, role?: string, part?: number, lines: readonly string[] }[], voiceFiles: string[] | null, takeFiles: string[], haveMusic: boolean }} input
 * @returns {{ voice: Record<string, string | null>, placeholderSound: boolean, slates: string[], titleSlate: boolean, notes: string[] }}
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
  /** @type {Record<string, string | null>} */
  const voice = {};
  for (const node of commentary) voice[node.id] = clipFile(node.id);
  const placeholderSound = !voiceFiles || !haveMusic;
  if (!voiceFiles) notes.push('no voice folder: every clip is silence the length of its words, and every frame says PLACEHOLDER SOUND');
  else if (!haveMusic) notes.push('no music: every frame says PLACEHOLDER SOUND');

  const slates = roles(speechNodes(commentary)).filter((n) => n.role !== 'end' && !takeFiles.includes(`c-${n.id}.mp4`)).map((n) => n.id);
  for (const id of slates) notes.push(`${id} has no take: a slate stands in for it, marked PLACEHOLDER PICTURE`);
  const titleSlate = !takeFiles.includes('c-title.mp4');
  if (titleSlate) notes.push('c-title has no take: a slate stands in for it, marked PLACEHOLDER PICTURE');
  return { voice, placeholderSound, slates, titleSlate, notes };
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

/**
 * The music's gain over the film as one expression of `t`: down by `db` while any clip plays (a ramp of `attack` s before it, a
 * ramp of `release` s after), and never from `until` on (the coda). Pure.
 *
 * The music's first note is never already ducked: a clip that begins with the music starts its `attack` ramp at `from`,
 * the music's first frame, so the first 150 ms ramp down rather than starting low. And a clip whose release would run into the coda releases
 * fully before it: its duck ends `release` s before `until`, so the music is back to full level when the coda's first chord sounds.
 * @param {{ start: number, length: number, db?: number }[]} spans each may carry its own depth `db` (the frantic nodes duck less)
 * @param {{ db: number, attack: number, release: number }} duck
 * @param {number} until
 * @param {number} [from] the film second the music begins
 */
export function duckExpression(spans, { db, attack, release }, until, from = -Infinity) {
  const ramps = spans.filter((s) => s.start < until).map((s) => {
    const dip = 1 - 10 ** ((s.db ?? db) / 20);
    const down = Math.max(s.start - attack, from), end = Math.min(s.start + s.length, until - release);
    return `${dip.toFixed(6)}*min(clip((t-${down.toFixed(4)})/${attack},0,1),clip((${(end + release).toFixed(4)}-t)/${release},0,1))`;
  });
  if (!ramps.length) return '1';
  const deep = ramps.reduce((a, b) => `max(${a},${b})`);
  return `1-(${deep})*lt(t,${until.toFixed(4)})`;
}

/**
 * The timing sheet (`--sheet`): the lead, each node's time, the version and the music's start, where in the speech the blocks fall, each strike of
 * the coda and what the picture does on it, the black and the line in it, the title's strike and the film's end. Pure.
 * @param {Timeline} tl
 * @param {{ id: string, lines?: readonly string[], caption?: string | readonly string[] }[]} [commentary]
 */
export function sheetText(tl, commentary = []) {
  const s = (/** @type {number} */ x) => x.toFixed(2), e = tl.ending, m = tl.music;
  const lines = [`lead: the film opens in silence for ${s(tl.lead)} s on the first take`];
  for (const n of tl.nodes) {
    const voice = n.voice.length ? `voice ${s(n.voice[0].start)} to ${s(n.voice[0].start + n.voice[0].length)} s` : 'no voice';
    const mix = n.role === 'frantic' || n.role === 'end' ? `, voice ${n.mix.voiceDb >= 0 ? '+' : ''}${n.mix.voiceDb.toFixed(1)} dB, music duck ${n.mix.duckDb.toFixed(1)} dB` : '';
    lines.push(`  ${n.id.padEnd(8)} ${n.role.padEnd(8)} ${s(n.start).padStart(7)} to ${s(n.end).padStart(7)} s  ${voice}${mix}`);
  }
  lines.push('the coda, strike by strike:');
  m.strikes.forEach((t, i) => {
    const what = i + 1 === e.strikes ? `the final strike: the title (c-title from its frame 0)` : i + 1 === e.blackStrike ? 'the picture cuts to black' : i + 1 < e.blackStrike ? `a cut (cut ${i + 1} of ${e.blackStrike - 1}; list.coda directs it)` : 'plays over black';
    lines.push(`  strike ${i + 1} of ${e.strikes} at ${s(t)} s: ${what}`);
  });
  void commentary;
  return lines.join('\n');
}

/* ================================================================================================================================ */
/* Everything below runs ffmpeg, and runs only when this file is the command. */

const SOUNDS = 'instances/divided-world/ui/sounds';
/** The game's sound for what lands; a kind not listed has none (the game has no sound for a posted reply's "send"). */
export const SOUND_FOR = { 'steel-chair': 'steel-chair-hit.mp3', hit: 'steel-chair-hit.mp3', filing: 'boo-1.mp3' };
/** Seconds into a sound file where its impact sits (measured: the chair's hit peaks 0.07 s in), so the impact falls on the landing's frame. */
export const SOUND_ONSET = { 'steel-chair-hit.mp3': 0.07 };
const DUCK = { db: DUCK_DB, attack: 0.15, release: 0.4 };
const MUSIC_LEVEL = 0.8;

/** @param {string} p an ffmpeg filter argument's path */
const esc = (p) => p.replace(/\\/gu, '/').replace(/:/gu, '\\:').replace(/'/gu, "\\'");
const FILM = '0x15171d';
/** The encode of every piece: the film's range and matrix are tagged so the join can copy. @param {string} preset */
const encodeArgs = (preset) => ['-r', String(F), '-an', '-c:v', 'libx264', '-preset', preset, '-crf', '17', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

/**
 * The filters of a motion-blurred, moved shot (after its picture is scaled to `w` by `h`): the picture held for each of four sub-frames
 * (`fps=240:round=down`: frame i fills sub-frames 4i to 4i+3), the camera's `perspective` evaluated at each sub-frame's own time
 * (moves.mjs `corners`, `sub`), four averaged (`tmix`), and the average taken at the last sub-frame of each frame (`select`): the camera's own blur,
 * sharp wherever the camera is still. Pure.
 * @param {Parameters<typeof corners>[0]} cut @param {number} w @param {number} h
 */
export function blurChain(cut, w, h) {
  const c = corners(cut, w, h, 'sub');
  return [`fps=${F * SUBFRAMES}:round=down`, `perspective=${Object.entries(c).map(([k, v]) => `${k}='${v}'`).join(':')}:interpolation=cubic:eval=frame`, `tmix=frames=${SUBFRAMES}`, `select='eq(mod(n,${SUBFRAMES}),${SUBFRAMES - 1})'`, `setpts=N/${F}/TB`];
}

/**
 * The filter graph of a whip: the outgoing shot's last `frames / 2` frames (input 0, its last frame held for the rest) slide off and the incoming
 * shot's first `frames / 2` (input 1, its first frame held before) slide on, over black, both averaged over four sub-frames. Pure.
 * @param {string} dir @param {number} frames
 */
export function whipGraph(dir, frames) {
  const half = frames / 2, e = whipExpressions(dir, frames, 1920, 1080), sub = F * SUBFRAMES, n = frames * SUBFRAMES;
  const at = (/** @type {string} */ x, /** @type {string} */ y) => `x='${x}':y='${y}':eval=frame`;
  return [
    `[0:v]tpad=stop=${frames}:stop_mode=clone,fps=${sub}:round=down,trim=end_frame=${n},setpts=N/${sub}/TB[a]`,
    `[1:v]tpad=start=${half}:start_mode=clone:stop=${frames}:stop_mode=clone,fps=${sub}:round=down,trim=end_frame=${n},setpts=N/${sub}/TB[b]`,
    `color=c=black:s=1920x1080:r=${sub}:d=${frames / F}[base]`,
    `[base][a]overlay=${at(e.ax, e.ay)}[t]`,
    `[t][b]overlay=${at(e.bx, e.by)},tmix=frames=${SUBFRAMES},select='eq(mod(n,${SUBFRAMES}),${SUBFRAMES - 1})',setpts=N/${F}/TB,format=yuv420p,setsar=1[w]`,
  ].join(';');
}

async function main() {
  const args = process.argv.slice(2);
  const has = (/** @type {string} */ n) => args.includes(`--${n}`);
  const TAKES = flag('takes', '.runs/hype'), VOICE = flag('voice', '.runs/hype/voice');
  const MUSIC = flag('music', '.runs/hype/music/mountain-king-musopen.flac');
  const OUT = flag('out', '.runs/hype/commentary.mp4'), PART = flag('part', ''), PRESET = flag('preset', 'veryfast');
  if (PART && !['calm', 'frantic', 'coda'].includes(PART)) throw new Error(`--part is calm, frantic or coda, not ${PART}`);

  const COMMENTARY = flag('commentary', 'instances/divided-world/ui/hype/commentary.ts');
  const { commentary, ...instance } = await import(pathToFileURL(path.resolve(COMMENTARY)).href);
  const { title: TITLE_WORDS, tag: TITLE_TAG_WORDS } = titleWords(instance);
  const map = JSON.parse(readFileSync(flag('map', 'instances/divided-world/ui/hype/music-map.json'), 'utf8'));
  const WORK = path.join(path.dirname(OUT), 'work');
  mkdirSync(WORK, { recursive: true });

  /* The voice: a folder of clips, or silence the length of the words; which takes there are; what the run must say (resolveInputs). */
  const takeFiles = existsSync(TAKES) ? readdirSync(TAKES) : [];
  const haveVoice = existsSync(VOICE), haveMusic = existsSync(MUSIC);
  const resolved = resolveInputs({ commentary, voiceFiles: haveVoice ? readdirSync(VOICE) : null, takeFiles, haveMusic });
  for (const note of resolved.notes) console.log(`NOTE ${note}`);
  const voiceFile = (/** @type {string | null} */ name) => (name ? path.join(VOICE, name) : null);
  /** @type {Record<string, number>} */
  const clips = {};
  /** @type {Record<string, string | null>} */
  const voices = {};
  for (const node of commentary) {
    voices[node.id] = voiceFile(resolved.voice[node.id]);
    clips[node.id] = voices[node.id] ? duration(/** @type {string} */ (voices[node.id])) : spoken(node.lines.join(' '));
  }
  /* The takes, their notes, and the camera's moves. */
  const takePath = (/** @type {string} */ stem) => path.join(TAKES, `${stem}.mp4`);
  /** @type {Record<string, Camera>} */
  const moves = {};
  /** @type {Record<string, { what: string, frame: number }[]>} */
  const landed = {};
  /** @type {Record<string, number>} */
  const sizes = {};
  const overrides = flag('moves', '') ? JSON.parse(readFileSync(flag('moves', ''), 'utf8')) : {};
  for (const node of commentary) {
    const id = node.id;
    const probe = takePath(`c-${id}`);
    if (existsSync(probe)) sizes[id] = videoInfo(probe).width;
    const notes = path.join(TAKES, `c-${id}.json`);
    const raw = existsSync(notes) ? JSON.parse(readFileSync(notes, 'utf8')) : {};
    const obj = Array.isArray(raw) ? { landed: raw } : raw;
    if (obj.landed?.length) landed[id] = obj.landed;
    const camera = { move: obj.move, punch: obj.punch, punches: obj.punches, ...overrides[id] };
    if (camera.move || camera.punch || camera.punches) moves[id] = camera;
  }

  const RECORDING = flag('recording', '');
  if (RECORDING && !VERSIONS.includes(RECORDING) && !map.versions?.[RECORDING]) throw new Error(`--recording is ${['full', ...Object.keys(map.versions ?? {})].join(', ')}, not ${RECORDING}`);
  const tl = timeline(clips, map, { nodes: speechNodes(commentary), lead: has('lead') ? Number(flag('lead', LEAD)) : undefined, recording: RECORDING || undefined, moves, sizes, landed });
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
    console.log(`cut list ${LIST}: ${cutList.shots.length} shots\n${cutList.blocks.map((b) => `  ${b.name.padEnd(16)} ${String(b.count).padStart(3)} shots, median ${b.median.toFixed(2)} s`).join('\n')}`);
  }
  const codaNode = /** @type {NodeCut} */ (tl.nodes.find((n) => n.role === 'coda'));
  const codaCuts = directCoda(codaNode.cuts, codaList, info);
  if (has('sheet')) {
    console.log(`\n${sheetText(tl, commentary)}`);
    return;
  }

  /* Fonts. */
  const sans = fontFile('Verdana') ? 'Verdana' : 'DejaVu Sans';
  const bold = fontFile('DejaVu Sans', 'bold') ?? fontFile('DejaVu Sans') ?? '';
  const stampFile = (/** @type {string} */ name, /** @type {string} */ text) => { const f = path.join(WORK, `${name}.txt`); writeFileSync(f, text); return f; };
  const stamp = (/** @type {string} */ name, /** @type {string} */ text, /** @type {string} */ place, /** @type {string} */ color) => `drawtext=fontfile='${esc(bold)}':textfile='${esc(stampFile(name, text))}':fontsize=34:fontcolor=white:box=1:boxcolor=${color}@0.85:boxborderw=10:${place}`;
  const soundStamp = resolved.placeholderSound ? stamp('sound', 'PLACEHOLDER SOUND', 'x=24:y=24', 'red') : null;

  /* Which of the film's pieces this run makes. */
  const [from, to] = PART ? tl.part[/** @type {'calm'} */ (PART)] : [0, tl.total];
  const fromFrame = Math.round(from * F), toFrame = Math.round(to * F);
  const inPart = (/** @type {{ startFrame: number }} */ c) => c.startFrame >= fromFrame && c.startFrame < toFrame;

  /** @typedef {{ name: string, startFrame: number, frames: number, take?: string, slate?: string[], black?: boolean, fadeAt?: number, cut?: Cut & { blur?: boolean, whip?: { dir: string, frames: number } } }} Piece */
  /** @type {Piece[]} */
  const pieces = [];
  const firstLine = (/** @type {string} */ id) => commentary.find((/** @type {{ id: string }} */ c) => c.id === id)?.lines[0] ?? '';
  for (const s of cutList?.shots ?? []) {
    const real = !stampsFor(resolved, { take: s.take }, takeFiles).slate;
    pieces.push({ name: `shot ${s.row}`, startFrame: s.startFrame, frames: s.frames, take: real ? takePath(s.take) : undefined, slate: real ? undefined : [s.take, ...wrap(firstLine(s.node), 36)], cut: s });
  }
  if (!cutList) for (const n of tl.nodes.filter((x) => x.role === 'calm' || x.role === 'frantic')) for (const [k, c] of n.cuts.entries()) {
    const real = !stampsFor(resolved, { take: c.take }, takeFiles).slate;
    pieces.push({ name: `${n.id} cut ${k + 1}`, startFrame: c.startFrame, frames: c.frames, take: real ? takePath(c.take) : undefined, slate: real ? undefined : [c.take, ...wrap(firstLine(n.id), 36)], cut: c });
  }
  /* The coda: a cut on each strike up to the one the black begins on. */
  for (const [k, c] of codaCuts.entries()) {
    const real = !stampsFor(resolved, { take: c.take }, takeFiles).slate;
    pieces.push({ name: `coda cut ${k + 1}`, startFrame: c.startFrame, frames: c.frames, take: real ? takePath(c.take) : undefined, slate: real ? undefined : [c.take, ...wrap(firstLine(tl.ending.line), 36)], cut: c });
  }
  /* The black: from the strike it begins on to the final strike, the end line in it. */
  pieces.push({ name: 'black', startFrame: Math.round(tl.out.blackStart * F), frames: framesBetween(tl.out.blackStart, tl.out.finalStart), black: true });
  /* The title: `c-title` from its frame 0 at the final strike to the film's end, fading over the last FADE s; a missing take is a slate. */
  pieces.push({ name: 'title', startFrame: Math.round(tl.out.finalStart * F), frames: framesBetween(tl.out.finalStart, tl.out.end), take: resolved.titleSlate ? undefined : takePath('c-title'), slate: resolved.titleSlate ? ['c-title', TITLE_WORDS, ...wrap(TITLE_TAG_WORDS, 30)] : undefined, fadeAt: tl.out.fadeStart - tl.out.finalStart, cut: { take: 'c-title', at: 0, start: tl.out.finalStart, length: tl.out.end - tl.out.finalStart, startFrame: Math.round(tl.out.finalStart * F), frames: framesBetween(tl.out.finalStart, tl.out.end), from: 0 } });
  pieces.sort((a, b) => a.startFrame - b.startFrame);

  const cues = cuesAll.filter((c) => c.end > from && c.start < to);
  writeFileSync(OUT.replace(/\.mp4$/u, '.srt'), srt(cues.map((c) => ({ ...c, start: Math.max(0, c.start - from), end: c.end - from }))));

  /* libass reads an .srt on a 288-line page, so FontSize 9 is 34 px of the 1080-line film, MarginV 4 is 15 px, and the margins 19 are 70 px. */
  /* One cut: its picture (the take, a slate or black; moved, and blurred when it asks), its captions and its stamps, encoded once. */
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
        if (cut.blur) {
          /* The camera's own motion blur: four sub-frames of the move averaged (blurChain). */
          chain.push(...blurChain({ ...cut, frames: p.frames }, w, h));
        } else {
          const c = corners({ ...cut, frames: p.frames }, w, h);
          chain.push(`perspective=${Object.entries(c).map(([k, v]) => `${k}='${v}'`).join(':')}:interpolation=cubic:eval=frame`);
        }
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
    const t0 = Date.now();
    run([...input, '-vf', chain.join(','), '-frames:v', String(p.frames), ...encodeArgs(PRESET), file], `encode ${p.name}`);
    console.log(`${(p.startFrame / F).toFixed(2).padStart(8)} s  ${p.name.padEnd(12)} ${p.frames} frames${p.take ? ` of ${path.basename(p.take)}` : p.black ? ' (black)' : p.slate ? ' (slate)' : ''}${p.cut?.move ? ' (move)' : ''}${p.cut?.punch || p.cut?.punches ? ' (punch)' : ''}${p.cut?.blur ? ` (blur, ${((Date.now() - t0) / 1000).toFixed(1)} s to render)` : ''}${p.cut?.whip ? ` (${p.cut.whip.frames}-frame whip in)` : ''}`);
    return file;
  };

  const mine = pieces.filter(inPart);
  const encoded = mine.map((p, i) => ({ p, file: encode(p, i), start: p.startFrame, frames: p.frames }));
  /** A whip on a piece's start replaces the outgoing piece's last half and the incoming piece's first half with a composite (whipGraph). @type {{ file: string, start: number }[]} */
  const sequence = [];
  const trim = (/** @type {string} */ file, /** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ out, /** @type {string[]} */ extra = []) => run(['-i', file, '-vf', `trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS`, ...encodeArgs(PRESET), ...extra, out], `trim ${path.basename(file)}`);
  encoded.forEach((e, k) => {
    const next = encoded[k + 1], own = e.p.cut?.whip, outgoing = next?.p.cut?.whip;
    const head = own ? own.frames / 2 : 0, tail = outgoing ? outgoing.frames / 2 : 0;
    if (!head && !tail) { sequence.push({ file: e.file, start: e.start }); return; }
    const main = e.file.replace(/\.mp4$/u, '-main.mp4');
    trim(e.file, head, e.frames - tail, main);
    sequence.push({ file: main, start: e.start + head });
    if (outgoing && next) {
      const half = outgoing.frames / 2, tailFile = e.file.replace(/\.mp4$/u, '-tail.mp4'), headFile = next.file.replace(/\.mp4$/u, '-head.mp4'), whipFile = next.file.replace(/\.mp4$/u, '-whip.mp4');
      trim(e.file, e.frames - half, e.frames, tailFile);
      trim(next.file, 0, half, headFile);
      const t0 = Date.now();
      run(['-i', tailFile, '-i', headFile, '-filter_complex', whipGraph(outgoing.dir, outgoing.frames), '-map', '[w]', '-frames:v', String(outgoing.frames), ...encodeArgs(PRESET), whipFile], `whip into ${next.p.name}`);
      console.log(`${((next.start - half) / F).toFixed(2).padStart(8)} s  whip-${outgoing.dir} ${outgoing.frames} frames (${((Date.now() - t0) / 1000).toFixed(1)} s to render)`);
      sequence.push({ file: whipFile, start: next.start - half });
    }
  });
  const files = sequence.sort((a, b) => a.start - b.start).map((x) => x.file);
  writeFileSync(path.join(WORK, 'list.txt'), files.map((f) => `file '${path.basename(f)}'`).join('\n'));
  const picture = path.join(WORK, 'picture.mp4');
  run(['-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'list.txt'), '-c', 'copy', picture], 'join the cuts');

  /* The sound. Built on the whole film's clock, then cut to the part. */
  const inputs = ['-i', picture], filters = [], voiceOut = [], mix = [];
  const input = (/** @type {string} */ f) => { inputs.push('-i', f); return inputs.filter((x) => x === '-i').length - 1; };
  const ms = (/** @type {number} */ s) => Math.round(s * 1000);
  for (const n of tl.nodes) {
    n.voice.forEach((v) => {
      const f = voices[n.id];
      if (!f) return;
      const k = input(f);
      /* Each node's voice is lifted by its place in the frantic run (franticCurve). */
      filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,${voiceGain(n.mix.voiceDb)},adelay=${ms(v.start)}:all=1[v${voiceOut.length}]`);
      voiceOut.push(`[v${voiceOut.length}]`);
    });
  }
  if (voiceOut.length) { filters.push(`${voiceOut.join('')}amix=inputs=${voiceOut.length}:normalize=0:duration=longest,${VOICE_LIMITER}[voice]`); mix.push('[voice]'); }
  if (haveMusic) {
    const k = input(musicFile), m = tl.music;
    /* The music ducks under each clip by its node's depth: less and less through the frantic nodes. */
    const duck = duckExpression(tl.nodes.flatMap((n) => n.voice.map((v) => ({ ...v, db: n.mix.duckDb }))).filter(() => haveVoice), DUCK, m.codaStart, m.start);
    filters.push(`[${k}:a]atrim=start=${m.from}:end=${m.until},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=${ms(m.start)}:all=1,volume=${MUSIC_LEVEL}[mu]`);
    filters.push(`[mu]volume='${duck}':eval=frame[music]`);
    mix.push('[music]');
  }
  /* The game's sounds on their landings: the shots' (a shot's take lands them at its own frames), and the coda's directed cuts'. */
  const hitList = (cutList ? [...cutList.shots.flatMap((/** @type {any} */ s) => s.hits.map((/** @type {{ what: string, at: number }} */ h) => ({ id: s.node, what: h.what, at: h.at }))), ...codaHits(codaCuts, info).map((h) => ({ id: 'coda', ...h }))] : tl.hits).sort((a, b) => a.at - b.at);
  const sounds = hitList.filter((h) => /** @type {Record<string, string>} */ (SOUND_FOR)[h.what]);
  sounds.forEach((h, i) => {
    const k = input(path.join(SOUNDS, /** @type {Record<string, string>} */ (SOUND_FOR)[h.what]));
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.8,adelay=${ms(Math.max(0, h.at - ((/** @type {Record<string, number>} */ (SOUND_ONSET))[/** @type {Record<string, string>} */ (SOUND_FOR)[h.what]] ?? 0)))}:all=1[s${i}]`);
    mix.push(`[s${i}]`);
  });
  filters.push(mix.length ? `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,alimiter=limit=0.95,apad=whole_dur=${tl.total.toFixed(3)},atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS[a]` : `anullsrc=r=48000:cl=stereo,atrim=0:${(to - from).toFixed(3)}[a]`);
  run([...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', ((toFrame - fromFrame) / F).toFixed(4), OUT], 'lay the sound under the picture');
  console.log(`wrote ${OUT}: ${((toFrame - fromFrame) / F).toFixed(2)} s${soundStamp ? ' (placeholder sound)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
