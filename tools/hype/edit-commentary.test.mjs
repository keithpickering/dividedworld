/**
 * The commentary edit's pure parts: the timeline, the captions, and the camera's moves
 * (docs/plans/2026-11-21-commentary-video-plan.md, tasks 8 and 8a; the revision design, section 11). Nothing here runs ffmpeg.
 *
 * The nodes are made up and their ids mean nothing: the timeline reads each node's ROLE (`calm`, `frantic`, `end`) and `after`. The made-up
 * map is made-up.mjs's: block 1 runs 10 to 70, block 2 70 to 100, block 3 100 to 130, the coda's chords sit at 130, 132, 140, 141 and 150, and
 * the last chord ends at 155. mk-a's first chord is at 110, mk-b's at 90, mk-plus1's at 150 and mk-plus2's at 170.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { versionMap } from './music.mjs';
import { timeline, captions, srt, framesBetween, wrap, duckExpression, captionBand, chooseVersion, franticCurve, endingText } from './edit-commentary.mjs';
import * as ec from "./edit-commentary.mjs";
import { madeUp } from './made-up.mjs';
import { cutRect, moveRect, punchScale, refusePush, pushLimit, expressions, corners, maxPush } from './moves.mjs';

const map = madeUp();
/** Seven nodes whose ids say nothing: three calm (the third after a pause of 2 s), three frantic, the line over black. */
const nodes = [
  { id: 'v01', role: 'calm' }, { id: 'v02', role: 'calm' }, { id: 'v03', role: 'calm', after: 2 },
  { id: 'v04', role: 'frantic' }, { id: 'v05', role: 'frantic' }, { id: 'v06', role: 'frantic' }, { id: 'z', role: 'end' },
];
/* Speech: 8 + 6 + 5 + 30 + 30 + 20 = 99 s of clips, a pause of 2 and three breaths of 0.35: the last frantic node ends at 4.5 + 99 + 3.05 + 2 = 108.55... see below. */
const clips = { v01: 8, v02: 6, v03: 5, v04: 30, v05: 30, v06: 20, z: 4.4 };
/** The clips with the last frantic node longer (or shorter) by `by` seconds, which moves the coda by as much. */
const longer = (/** @type {number} */ by) => ({ ...clips, v06: clips.v06 + by });
const F = 60;
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);
const at = (/** @type {any} */ t, /** @type {string} */ id) => t.nodes.find((/** @type {{ id: string }} */ n) => n.id === id);
/* The last frantic node (v06) ends at 4.5 + (8 + 6 + 5 + 30 + 30 + 20) + 0.35 * 4 + 2 = 106.9, so the coda's first chord is at 107.1. */
const CODA = 107.1;

test('the film opens in silence: the first node`s voice starts `lead` seconds in (4.5 by default), and its shot owns the lead', () => {
  const t = timeline(clips, map, { nodes });
  near(t.lead, 4.5);
  near(at(t, 'v01').start, 0, 'the first node`s picture begins on the first frame');
  near(at(t, 'v01').voice[0].start, 4.5, 'its voice after the lead');
  near(at(t, 'v01').end, at(t, 'v02').start, 'it runs to the next node');
  near(at(t, 'v02').start, 4.5 + 8 + 0.35, 'the next node follows the clip and a breath');
  near(timeline(clips, map, { nodes, lead: 2 }).nodes[0].voice[0].start, 2);
  near(timeline(clips, map, { nodes, lead: 0 }).nodes[0].voice[0].start, 0);
  assert.throws(() => timeline(clips, map, { nodes, lead: -1 }), /lead/);
});

test('nodes are whatever the data says: roles and `after` decide, never an id; a pause follows the clip before it', () => {
  const t = timeline(clips, map, { nodes });
  assert.deepEqual(t.nodes.map((n) => n.id), ['v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'coda', 'z']);
  assert.deepEqual(t.nodes.map((n) => n.role), ['calm', 'calm', 'calm', 'frantic', 'frantic', 'frantic', 'coda', 'end']);
  near(at(t, 'v03').start, 4.5 + 8 + 0.35 + 6 + 2, 'v03 starts 2 s after v02 ends');
  near(at(t, 'v02').end, at(t, 'v03').start, 'v02 runs to the pause end: its shot owns the silence');
  near(at(t, 'v04').start, at(t, 'v03').start + 5 + 0.35);
  near(t.codaStart, CODA, 'the coda`s first chord falls 0.2 s after the last frantic node`s last word');
  near(at(t, 'v06').voice[0].start + 20 + 0.2, CODA);
  near(t.part.calm[1], at(t, 'v04').start, 'the calm part runs to the first frantic node');
  near(t.part.frantic[0], at(t, 'v04').start);
  near(t.part.frantic[1], CODA, 'the frantic part to the coda');
  near(t.part.coda[0], CODA);
  near(t.part.coda[1], t.total);
  /* the same shape under other ids, a different count and an earlier end */
  const other = [{ id: 'q', role: 'calm' }, { id: 'r', role: 'frantic' }, { id: 's', role: 'frantic' }, { id: 'last', role: 'end' }];
  const u = timeline({ q: 30, r: 40, s: 40, last: 3 }, map, { nodes: other, recording: 'mk-b' });
  near(at(u, 's').end, u.codaStart);
  assert.equal(u.nodes.filter((n) => n.role === 'frantic').length, 2);
});

test('the roles must run calm, frantic, then one end node last: anything else is refused naming the node', () => {
  const bad = (/** @type {any[]} */ list, /** @type {RegExp} */ re) => assert.throws(() => timeline(clips, map, { nodes: list }), re);
  bad(nodes.slice(0, 6), /end/);
  bad([...nodes.slice(0, 6), { id: 'z', role: 'end' }, { id: 'zz', role: 'end' }], /one end node|zz/);
  bad([{ id: 'z', role: 'end' }, ...nodes.slice(0, 6)], /z.*last|end node.*last/);
  bad([nodes[0], nodes[3], nodes[1], ...nodes.slice(4)], /v02.*calm.*frantic|calm.*after/);
  bad([...nodes.slice(0, 3), { id: 'v04', role: 'strange' }, ...nodes.slice(4)], /v04.*role/);
  assert.throws(() => timeline({ ...clips, z: undefined }, map, { nodes }), /z has no clip/);
});

test('the roles may be mapped from the old data: part 1 and 2 calm, part 3 frantic, n11 the end, and part 1 is locked off', () => {
  const old = [{ id: 'n01', part: 1 }, { id: 'n02', part: 1 }, { id: 'n03', part: 2 }, { id: 'n04', part: 3 }, { id: 'n11', part: 3 }];
  const t = timeline({ n01: 20, n02: 20, n03: 30, n04: 40, n11: 3 }, map, { nodes: old, recording: 'mk-b' });
  assert.deepEqual(t.nodes.map((n) => n.role), ['calm', 'calm', 'calm', 'frantic', 'coda', 'end']);
  assert.deepEqual(t.nodes.map((n) => n.locked), [true, false, false, false, false, false], 'the old lock-off was part 1 less its last node: the camera first moved in node 4');
});

test('the music is laid from its end: the first chord of the version falls 0.2 s after the last frantic node`s last word', () => {
  const t = timeline(clips, map, { nodes });
  const v = versionMap(map, t.music.version);
  near(t.music.start, CODA - v.coda.chords[0].t, 'the start is the coda less the first chord');
  near(t.music.until, v.coda.end.t + 1.2, 'the music plays to 1.2 s past the final chord`s end');
  near(t.music.untilFilm, t.music.start + v.coda.end.t + 1.2);
  near(t.total, t.music.untilFilm, 'and that is the film`s end');
});

test('the version: the smallest music start that is at least 1 s after the first node ends (the opening lines are in silence)', () => {
  /* the first node ends at 4.5 + 8 = 12.5, so the music may start from 13.5; the starts are CODA + by - 130, 110, 90, 150, 170. */
  const pick = (/** @type {number} */ by) => { const t = timeline(longer(by), map, { nodes }); return { v: t.music.version, start: t.music.start }; };
  assert.equal(pick(0).v, 'mk-b');
  near(pick(0).start, 17.1, 'mk-b starts 17.1 s in');
  assert.equal(pick(11).v, 'mk-b', 'mk-a would start at 8.1 s, inside the opening lines');
  assert.equal(pick(16.3).v, 'mk-b', 'mk-a would start at 13.4, under 13.5');
  assert.equal(pick(16.5).v, 'mk-a', 'mk-a at 13.6 is the smallest that qualifies');
  near(pick(16.5).start, 13.6);
  assert.equal(pick(36.5).v, 'full', 'the recording itself at 13.6');
  assert.equal(pick(56.5).v, 'mk-plus1', 'a lengthened version when the speech is long enough');
  assert.equal(pick(76.5).v, 'mk-plus2');
  near(pick(76.5).start, 13.6);
  assert.deepEqual(timeline(clips, map, { nodes }).music.notes, [], 'no note when the rule is met');
});

test('chooseVersion: the smallest start at or after the threshold; when none qualifies the shortest, and it says so', () => {
  assert.deepEqual(chooseVersion({ full: 30, 'mk-a': 50, 'mk-b': 70, 'mk-plus1': 10 }, 13.5), { version: 'full', met: true });
  assert.deepEqual(chooseVersion({ full: 13.5, 'mk-a': 50 }, 13.5), { version: 'full', met: true }, 'at the threshold qualifies');
  assert.deepEqual(chooseVersion({ full: 3, 'mk-a': 8, 'mk-b': 12 }, 13.5), { version: 'mk-b', met: false }, 'every version starts too early: the one that starts latest is the shortest');
  assert.deepEqual(chooseVersion({ only: 40 }, 13.5), { version: 'only', met: true });
});

test('--recording fixes the version; a start before the film begins is trimmed from the head of the music', () => {
  const t = timeline(clips, map, { nodes, recording: 'full' });
  assert.equal(t.music.version, 'full');
  near(t.music.start, 0, 'the music starts on the first frame');
  near(t.music.from, 130 - CODA, 'and begins that far into the recording');
  assert.throws(() => timeline(clips, map, { nodes, recording: 'mk-z' }), /mk-z/);
});

test('when no version starts after the opening lines the shortest is used, and the timeline says the music starts before the speech allows', () => {
  const t = timeline(longer(-10), map, { nodes });
  assert.equal(t.music.version, 'mk-b');
  assert.ok(t.music.start < 13.5);
  assert.ok(t.music.notes.some((n) => /before the speech allows|opening/.test(n)), t.music.notes.join('|'));
});

test('where the second block and the full orchestra fall in the speech: the node and how far into it', () => {
  const t = timeline(clips, map, { nodes });
  /* mk-b: statement 7 is at 70 - 40 = 30 of the music, statement 13 at 60; the music starts at 17.1. */
  near(t.music.second.at, 47.1, 'block 2');
  assert.equal(t.music.second.node, 'v04');
  near(t.music.second.into, 47.1 - at(t, 'v04').start, 'into v04');
  near(t.music.third.at, 77.1, 'the full orchestra');
  assert.equal(t.music.third.node, 'v05');
});

test('the ending: the line ends 0.25 s before the final strike, and the picture is black from the latest strike at or before the line`s start less 0.3 s', () => {
  /* mk-b: the music starts at 17.1, so its chords are at 107.1, 109.1, 117.1, 118.1 and the final strike at 127.1; its end at 132.1 (+ 1.2). */
  const run = (/** @type {number} */ line) => timeline({ ...clips, z: line }, map, { nodes, recording: 'mk-b' });
  const short = run(4.4);
  near(short.out.finalStart, 127.1);
  near(at(short, 'z').voice[0].start + 4.4, 127.1 - 0.25, 'the line ends 0.25 s before the final strike');
  assert.equal(short.ending.blackStrike, 4, 'the second-to-last of the five strikes: its index counts from 1 here');
  near(short.out.blackStart, 118.1, 'black on the second-to-last strike');
  near(short.ending.gap, 9, 'the gap between the black and the final strike');
  assert.ok(at(short, 'z').voice[0].start >= short.out.blackStart + 0.3 - 1e-9, 'the line sits wholly in the black, 0.3 s in at least');
  /* a longer line starts earlier, and the black one strike earlier: a strike inside the black plays over black */
  const longer1 = run(8.7);
  near(longer1.out.blackStart, 117.1, 'black one strike earlier');
  assert.equal(longer1.ending.blackStrike, 3);
  assert.equal(run(19.4).ending.blackStrike, 1, 'a line that starts 0.3 s after the first chord leaves the black on the first');
  /* a line that would start before the first chord is refused, naming the overrun */
  assert.throws(() => run(20), (/** @type {Error} */ e) => /z/.test(e.message) && /first chord/.test(e.message) && /0\.55 s/.test(e.message));
  /* the film: the title from the final strike to 1.2 s after the final chord's end, fading over the last 0.8 s */
  near(short.out.end, 17.1 + 115 + 1.2);
  near(short.out.fadeStart, short.out.end - 0.8);
  near(short.total, short.out.end);
});

test('the coda is a cut to each strike up to the one the black begins on; the end node holds the black, and the film is in frame-exact pieces', () => {
  const t = timeline(clips, map, { nodes, recording: 'mk-b' });
  const coda = at(t, 'coda'), z = at(t, 'z');
  assert.equal(coda.cuts.length, 3, 'a cut from each strike to the next, the last into the black');
  assert.ok(coda.cuts.every((c) => c.punch === 10), 'each chord is a hard cut with a punch-in');
  near(coda.cuts[1].at, 2);
  near(coda.cuts.at(-1).at + coda.cuts.at(-1).length, t.out.blackStart - t.codaStart, 'the last cut ends where the black begins');
  near(coda.end, t.out.blackStart);
  near(z.start, t.out.blackStart);
  near(z.end, t.out.finalStart);
  assert.equal(z.cuts.length, 0, 'the black is not a take');
  let frame = 0;
  for (const n of t.nodes) {
    assert.equal(Math.round(n.start * F), frame, `${n.id} starts on frame ${frame}`);
    assert.equal(n.cuts.reduce((s, c) => s + c.frames, 0) || n.frames, n.frames);
    frame += n.frames;
  }
  assert.equal(frame, Math.round(t.out.finalStart * F), 'the nodes run to the final strike, where the title begins');
  assert.equal(framesBetween(0, 1.0083), 60);
});

test('the voice and the music through the frantic nodes: the duck lessens and the voice rises, the last a full +4 dB', () => {
  assert.deepEqual(franticCurve(0, 3), { voiceDb: 0, duckDb: -10 });
  assert.deepEqual(franticCurve(2, 3), { voiceDb: 4, duckDb: -4 }, 'the last frantic node: the voice up 4 dB, the music only 4 dB down');
  const mid = franticCurve(1, 3);
  assert.ok(mid.voiceDb > 0 && mid.voiceDb < 4 && mid.duckDb > -10 && mid.duckDb < -4);
  for (let i = 1; i < 6; i++) { const a = franticCurve(i - 1, 6), b = franticCurve(i, 6); assert.ok(b.voiceDb > a.voiceDb && b.duckDb > a.duckDb, `node ${i} louder and less ducked than the one before`); }
  assert.deepEqual(franticCurve(0, 1), { voiceDb: 4, duckDb: -4 }, 'a single frantic node is the last');
  const t = timeline(clips, map, { nodes });
  assert.deepEqual(t.nodes.filter((n) => n.role === 'calm').map((n) => n.mix), [{ voiceDb: 0, duckDb: -10 }, { voiceDb: 0, duckDb: -10 }, { voiceDb: 0, duckDb: -10 }]);
  assert.deepEqual(t.nodes.filter((n) => n.role === 'frantic').map((n) => n.mix), [0, 1, 2].map((i) => franticCurve(i, 3)));
  assert.deepEqual(at(t, 'z').mix, { voiceDb: 4, duckDb: -4 }, 'the line over black is as loud as the last');
});

test('a clip missing for a node is refused plainly, and so is a length that is not a number of seconds', () => {
  const { v05: _gone, ...rest } = clips;
  assert.throws(() => timeline(rest, map, { nodes }), /v05.*no clip/);
  for (const bad of [NaN, -1, Infinity, '5', null]) assert.throws(() => timeline({ ...clips, v05: /** @type {any} */ (bad) }, map, { nodes }), /v05 has a clip length/, String(bad));
});

test('a locked node carries no move, punch or landing punch: its cuts have none, and a move declared on it is refused', () => {
  const lockedNodes = nodes.map((n) => (n.id === 'v02' ? { ...n, locked: true } : n));
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.25, w: 0.5, roll: 0 }, ease: 'inOut' };
  assert.throws(() => timeline(clips, map, { nodes: lockedNodes, moves: { v02: { move } } }), /v02.*locked off/);
  assert.throws(() => timeline(clips, map, { nodes: lockedNodes, moves: { v02: { punch: 10 } } }), /v02.*locked off/);
  assert.doesNotThrow(() => timeline(clips, map, { nodes: lockedNodes, moves: { v03: { move } } }), 'an unlocked calm node may move');
});

test('a move declared on a node reaches its cut, and a push past the take is refused naming the cut', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.25, w: 0.5, roll: 0 }, ease: 'inOut' };
  const t = timeline(clips, map, { nodes, moves: { v04: { move, punch: 12 } } });
  const cut = at(t, 'v04').cuts[0];
  assert.deepEqual(cut.move, move);
  assert.equal(cut.punch, 12);
  const past = { from: move.from, to: { x: 0.4, y: 0.4, w: 0.2, roll: 0 }, ease: 'linear' };
  assert.throws(() => timeline(clips, map, { nodes, moves: { v04: { move: past } } }), (/** @type {Error} */ e) => /v04/.test(e.message) && /5\.00x/.test(e.message) && /2\.00x/.test(e.message));
  const wider = { from: move.from, to: { x: 0.35, y: 0.35, w: 0.3, roll: 0 }, ease: 'linear' };
  assert.doesNotThrow(() => timeline(clips, map, { nodes, moves: { v04: { move: wider } }, sizes: { v04: 3840 } }), 'a take of 3840 px gives 4x');
});

test('a landing in a frantic node is a punch at its frame, and its sound is placed at that frame of its node; in a calm node it is only the sound', () => {
  const t = timeline(clips, map, { nodes, landed: { v05: [{ what: 'steel-chair', frame: 150 }], v02: [{ what: 'steel-chair', frame: 60 }] } });
  assert.deepEqual(at(t, 'v05').cuts[0].punches, [{ frame: 150, percent: 5 }]);
  assert.equal(at(t, 'v02').cuts[0].punches, undefined, 'only in a frantic node');
  assert.deepEqual(t.hits.map((h) => [h.what, +h.at.toFixed(3)]), [['steel-chair', +(at(t, 'v02').start + 1).toFixed(3)], ['steel-chair', +(at(t, 'v05').start + 2.5).toFixed(3)]]);
});

/* ---- captions ---- */

const commentary = [
  { id: 'v04', lines: ['A card can be set to go off when somebody says a particular phrase.', 'This trains players to choose their words carefully,', 'which, on a forum, we think is new.'] },
  { id: 'v05', lines: ['Spoken line.'], caption: ['What the screen says instead.'] },
  { id: 'z', lines: ['*sigh* Well, at least it`s better than anime.'] },
];

test('captions: a node of three lines, each shown for its share of the clip by its characters', () => {
  const t = timeline(clips, map, { nodes });
  const cues = captions(commentary, t).filter((c) => c.node === 'v04');
  assert.equal(cues.length, 3);
  const v04 = at(t, 'v04');
  near(cues[0].start, v04.voice[0].start);
  near(cues[2].end, v04.voice[0].start + 30);
  near(cues[0].end, cues[1].start);
  const chars = commentary[0].lines.map((l) => l.length), total = chars.reduce((a, b) => a + b, 0);
  near(cues[0].end - cues[0].start, (30 * chars[0]) / total, 'line 1');
  assert.deepEqual(cues.map((c) => c.text), commentary[0].lines);
});

test('captions: a node`s caption override is shown in place of its lines, and the end node`s line is shown over its black', () => {
  const t = timeline(clips, map, { nodes, recording: 'mk-b' });
  const cues = captions(commentary, t);
  assert.deepEqual(cues.filter((c) => c.node === 'v05').map((c) => c.text), ['What the screen says instead.']);
  const z = cues.find((c) => c.node === 'z');
  near(z.start, at(t, 'z').voice[0].start);
  near(z.end, at(t, 'z').voice[0].start + 4.4);
  assert.ok(z.start >= t.out.blackStart && z.end <= t.out.finalStart, 'in the black');
  assert.ok(cues.every((c) => c.end <= t.out.finalStart + 1e-9), 'nothing is captioned during the title');
});

test('captions: a node with no commentary text has no cue, and the srt is numbered and timed in milliseconds', () => {
  const t = timeline(clips, map, { nodes });
  const text = srt(captions(commentary, t));
  assert.match(text, /^1\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\nA card can be set/u);
  assert.match(text, /\n\n2\n/u);
  assert.equal(srt([{ start: 3661.5, end: 3662, text: 'late' }]), '1\n01:01:01,500 --> 01:01:02,000\nlate\n');
});

/* ---- the camera's moves ---- */

const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.1, w: 0.5, roll: 4 }, ease: 'linear' };

test('a move at its first frame is its from rectangle, at its middle halfway, at its last its to rectangle', () => {
  const cut = { frames: 101, move };
  assert.deepEqual(cutRect(cut, 0), { x: 0, y: 0, w: 1, roll: 0 });
  const mid = cutRect(cut, 50);
  near(mid.w, 0.75); near(mid.x, 0.125); near(mid.y, 0.05); near(mid.roll, 2);
  const end = cutRect(cut, 100);
  near(end.x, 0.25); near(end.y, 0.1); near(end.w, 0.5); near(end.roll, 4);
  assert.equal(moveRect({ ...move, ease: 'inOut' }, 25, 101).w, 1 + (0.5 - 1) * 0.15625, 'an ease moves slower at the start');
});

test('a push past 2x is refused naming the cut, and a larger take allows more', () => {
  const too = { frames: 60, move: { from: move.from, to: { x: 0.4, y: 0.4, w: 0.45, roll: 0 } } };
  assert.throws(() => refusePush('n06 cut 1', too, 1920), /n06 cut 1.*2\.22x.*2\.00x/);
  assert.doesNotThrow(() => refusePush('n06 cut 1', too, 3840));
  assert.equal(pushLimit(1920), 2);
  assert.equal(pushLimit(3840), 4);
  near(maxPush({ frames: 60, move: { from: move.from, to: { x: 0, y: 0, w: 0.5, roll: 0 } } }), 2);
});

test('a punch of n percent is pushed in on its first frame and is back to the full frame in eight', () => {
  const cut = { frames: 30, punch: 20 };
  near(cutRect(cut, 0).w, 1 / 1.2, 'frame 0');
  const widths = Array.from({ length: 10 }, (_, i) => cutRect(cut, i).w);
  for (let i = 1; i < 8; i++) assert.ok(widths[i] > widths[i - 1], `frame ${i} has eased back a little more`);
  near(widths[8], 1, 'frame 8 is the full frame');
  near(widths[9], 1);
  assert.deepEqual(cutRect(cut, 8), { x: 0, y: 0, w: 1, roll: 0 });
  near(punchScale(20, 0), 1.2);
  near(punchScale(20, 8), 1);
  const centred = cutRect(cut, 0);
  near(centred.x, (1 - centred.w) / 2, 'the punch is about the centre');
});

test('a punch lands at a frame of the cut, not only at its start', () => {
  const cut = { frames: 100, punches: [{ frame: 40, percent: 10 }] };
  near(cutRect(cut, 39).w, 1);
  near(cutRect(cut, 40).w, 1 / 1.1);
  near(cutRect(cut, 48).w, 1);
});

/* The expressions are the arithmetic of cutRect, written for ffmpeg. JavaScript lacks `if`, `st`, `ld` and the `;` between them: they are
 * supplied here (the registers are an array, and `;` is the comma operator). */
const evaluate = (/** @type {string} */ source, /** @type {number} */ on) => {
  const reg = [0, 0, 0, 0, 0];
  const body = `(${source.replace(/\bif\(/gu, 'if_(').replace(/\bst\(/gu, 'st_(').replace(/\bld\(/gu, 'ld_(').replace(/;/gu, ',')})`;
  return new Function('on', 'PI', 'if_', 'gte', 'lt', 'min', 'max', 'cos', 'sin', 'st_', 'ld_', `return ${body};`)(
    on, Math.PI, (/** @type {number} */ c, /** @type {number} */ a, /** @type {number} */ b) => (c ? a : b),
    (/** @type {number} */ a, /** @type {number} */ b) => +(a >= b), (/** @type {number} */ a, /** @type {number} */ b) => +(a < b),
    Math.min, Math.max, Math.cos, Math.sin,
    (/** @type {number} */ i, /** @type {number} */ v) => (reg[i] = v), (/** @type {number} */ i) => reg[i],
  );
};

const cuts = [
  { frames: 90, move: { ...move, ease: 'inOut' }, punch: 15, punches: [{ frame: 30, percent: 8 }] },
  { frames: 45, move: { from: { x: 0.1, y: 0.2, w: 0.6, roll: -3 }, to: { x: 0.5, y: 0.5, w: 0.5, roll: 3 }, ease: 'out' } },
  { frames: 20, punch: 10 },
  { frames: 60, move: { from: move.from, to: move.to, ease: 'in' } },
];

test('the expressions handed to ffmpeg give the same rectangle as cutRect on every frame', () => {
  for (const cut of cuts) {
    const e = expressions(cut);
    for (let i = 0; i < cut.frames; i++) {
      const r = cutRect(cut, i);
      near(evaluate(e.w, i), r.w, `w at ${i}`);
      near(evaluate(e.cx, i) - evaluate(e.w, i) / 2, r.x, `x at ${i}`);
      near(evaluate(e.cy, i) - evaluate(e.w, i) / 2, r.y, `y at ${i}`);
      near(evaluate(e.roll, i), (r.roll * Math.PI) / 180, `roll at ${i}`);
    }
  }
});

test('the corners handed to the perspective filter are the rectangle, turned by its roll about its centre, in source pixels', () => {
  const W = 3840, H = 2160;
  for (const cut of cuts) {
    const c = corners(cut, W, H);
    for (let i = 0; i < cut.frames; i++) {
      const r = cutRect(cut, i), th = (r.roll * Math.PI) / 180;
      const p = ['x0', 'y0', 'x1', 'y1', 'x2', 'y2', 'x3', 'y3'].map((k) => evaluate(c[k], i));
      const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
      near((x0 + x1 + x2 + x3) / 4, (r.x + r.w / 2) * W, `centre x at ${i}`);
      near((y0 + y1 + y2 + y3) / 4, (r.y + r.w / 2) * H, `centre y at ${i}`);
      near(Math.hypot(x1 - x0, y1 - y0), r.w * W, `top edge at ${i}`);
      near(Math.hypot(x2 - x0, y2 - y0), r.w * H, `left edge at ${i}`);
      near(Math.atan2(y1 - y0, x1 - x0), th, `the top edge is turned by the roll at ${i}`);
      if (r.roll === 0) { near(x0, r.x * W, `left at ${i}`); near(y0, r.y * H, `top at ${i}`); near(x3, (r.x + r.w) * W, `right at ${i}`); near(y3, (r.y + r.w) * H, `bottom at ${i}`); }
    }
  }
});


/* ---- the music's ducking ---- */

test('the music is 10 dB down under a clip, 150 ms to go down and 400 ms to come back, and never ducked in the coda', () => {
  const gain = (/** @type {string} */ source, /** @type {number} */ t) =>
    new Function('t', 'clip', 'min', 'max', 'lt', `return ${source};`)(t, (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, v)), Math.min, Math.max, (/** @type {number} */ a, /** @type {number} */ b) => +(a < b));
  const about = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-5, `${what}: ${a} is not ${b}`);
  const dip = 10 ** (-10 / 20);
  const e = duckExpression([{ start: 10, length: 5 }, { start: 30, length: 4 }, { start: 90, length: 3 }], { db: -10, attack: 0.15, release: 0.4 }, 80);
  about(gain(e, 5), 1, 'before');
  about(gain(e, 12), dip, 'under a clip');
  about(gain(e, 9.925), (1 + dip) / 2, 'half way down, 75 ms before the clip');
  about(gain(e, 9.85), 1, 'a clip begins 150 ms after the music starts down');
  about(gain(e, 15.2), (1 + dip) / 2, 'half way up, 200 ms after the clip');
  about(gain(e, 15.4), 1, 'back up 400 ms after');
  about(gain(e, 32), dip);
  about(gain(e, 91), 1, 'a clip in the coda does not duck it');
});


/* ---- where the caption band sits ---- */

test('the caption band is at the top of the frame by default, two rows at most, and is the same height wherever it sits', () => {
  const top = captionBand('top', 'A short line.');
  assert.equal(top.y, 0, 'the top band starts at the top edge');
  assert.equal(top.alignment, 6, 'the words are top-centered (force_style takes the legacy SSA numbers: 6 is top-center, 8 mid-height)');
  const one = top.h, two = captionBand('top', 'x'.repeat(86)).h;
  assert.ok(two > one, 'a line that wraps to two rows has a taller band');
  assert.ok(two <= 120, `two rows need no more than 120 px of the 1080, not ${two}`);
  assert.equal(captionBand('top', 'x'.repeat(200)).h, two, 'never more than two rows');
  const foot = captionBand('foot', 'A short line.');
  assert.equal(foot.alignment, 2);
  near(foot.y + foot.h, 1080, 'the foot band ends at the foot');
  assert.equal(captionBand('off', 'anything'), null);
});

test('the top band never reaches the HUD at the foot, and the captions flag is read by name, --clean being off', async () => {
  const { captionMode } = await import('./edit-commentary.mjs');
  assert.equal(captionMode([]), 'top', 'the default is the top');
  assert.equal(captionMode(['--captions', 'foot']), 'foot');
  assert.equal(captionMode(['--captions', 'off']), 'off');
  assert.equal(captionMode(['--clean']), 'off');
  assert.throws(() => captionMode(['--captions', 'middle']), /foot, top or off/);
});


/* ---- the guards against a film that looks finished and is not ---- */

const parts = [...['a', 'b', 'c', 'd'].map((id) => ({ id: `s-${id}`, role: 'calm', lines: ['a line.'] })), { id: 's-e', role: 'frantic', lines: ['a line.'] }, { id: 'last', role: 'end', lines: ['one', 'two'] }];
const fullVoice = parts.map((n) => `${n.id}.mp3`);
const fullTakes = [...parts.filter((n) => n.role !== 'end').map((n) => `c-${n.id}.mp4`), 'c-title.mp4'];
const resolve = (over = {}) => ec.resolveInputs({ commentary: parts, voiceFiles: fullVoice, takeFiles: fullTakes, haveMusic: true, ...over });

test('a full voice folder, every take and the music resolve with no stand-in, no note and no stamp', () => {
  const r = resolve();
  assert.deepEqual(r.notes, []);
  assert.equal(r.placeholderSound, false);
  assert.deepEqual(r.slates, []);
  assert.equal(r.titleSlate, false);
  assert.equal(r.voice.last, 'last.mp3', 'the end node is one clip like any other');
  assert.equal(r.voice['s-e'], 's-e.mp3');
  assert.deepEqual(ec.stampsFor(r, { take: 'c-s-b' }, fullTakes), { slate: false, stamps: [] });
  assert.deepEqual(ec.stampsFor(r, { take: 'c-title' }, fullTakes), { slate: false, stamps: [] });
});

test('one clip missing from an otherwise full voice folder is refused, naming the clip', () => {
  assert.throws(() => resolve({ voiceFiles: fullVoice.filter((f) => f !== 's-c.mp3') }), /no clip named s-c\b/);
  assert.throws(() => resolve({ voiceFiles: fullVoice.filter((f) => f !== 'last.mp3') }), /no clip named last\b/);
});

test('no voice folder is PLACEHOLDER SOUND on every frame, and so is music that is absent', () => {
  for (const [what, over] of /** @type {[string, object][]} */ ([['no voice folder', { voiceFiles: null }], ['no music', { haveMusic: false }]])) {
    const r = resolve(over);
    assert.equal(r.placeholderSound, true, what);
    assert.ok(r.notes.some((n) => /PLACEHOLDER SOUND/.test(n)), what);
    for (const piece of [{ take: 'c-s-e' }, { take: 'c-title' }]) assert.ok(ec.stampsFor(r, piece, fullTakes).stamps.includes('PLACEHOLDER SOUND'), `${what}: ${JSON.stringify(piece)}`);
  }
  assert.equal(resolve({ voiceFiles: null }).voice.last, null, 'a clip with no folder is silence, not a file');
});

test('a missing take is a slate that carries PLACEHOLDER PICTURE; a take that is there does not; the end node needs none', () => {
  const takes = fullTakes.filter((f) => f !== 'c-s-c.mp4');
  const r = resolve({ takeFiles: takes });
  assert.deepEqual(r.slates, ['s-c'], 'the line over black has no take and is not a slate');
  assert.ok(r.notes.some((n) => /s-c has no take/.test(n)));
  assert.deepEqual(ec.stampsFor(r, { take: 'c-s-c' }, takes), { slate: true, stamps: ['PLACEHOLDER PICTURE'] });
  assert.deepEqual(ec.stampsFor(r, { take: 'c-s-b' }, takes).stamps, []);
  assert.deepEqual(ec.stampsFor(resolve({ takeFiles: takes, voiceFiles: null }), { take: 'c-s-c' }, takes).stamps, ['PLACEHOLDER SOUND', 'PLACEHOLDER PICTURE'], 'both stamps, on a slate with no sound');
});

test('a missing c-title is a slate like any take: reported, and stamped PLACEHOLDER PICTURE', () => {
  const takes = fullTakes.filter((f) => f !== 'c-title.mp4');
  const r = resolve({ takeFiles: takes });
  assert.deepEqual(r.slates, []);
  assert.equal(r.titleSlate, true);
  assert.ok(r.notes.some((n) => /c-title has no take/.test(n)), r.notes.join('|'));
  assert.deepEqual(ec.stampsFor(r, { take: 'c-title' }, takes).stamps, ['PLACEHOLDER PICTURE']);
  assert.equal('titleSlates' in r, false, 'one title take, not two');
});

test('the title`s words: TITLE and TITLE_TAG when the instance has them, else what is there (TITLE_NOTE, END_CARD split at its parenthesis)', () => {
  assert.deepEqual(ec.titleWords({ TITLE: 'DIVIDED WORLD', TITLE_TAG: 'INVITE ONLY', TITLE_NOTE: '(old)' }), { title: 'DIVIDED WORLD', tag: 'INVITE ONLY' });
  assert.deepEqual(ec.titleWords({ TITLE: 'DIVIDED WROLD', TITLE_NOTE: '(nonsense)' }), { title: 'DIVIDED WROLD', tag: '(nonsense)' });
  assert.deepEqual(ec.titleWords({ END_CARD: 'DIVIDED WROLD (misspelled) (put it in)' }), { title: 'DIVIDED WROLD', tag: '(misspelled) (put it in)' });
  assert.deepEqual(ec.titleWords({ TITLE: 'DIVIDED WORLD' }), { title: 'DIVIDED WORLD', tag: '' });
  assert.throws(() => ec.titleWords({}), /TITLE/);
});

/* ---- the recording, the map's anchors, the sheet ---- */

test('the music must be the recording the map was measured on: its length within 0.05 s and its sha1, named in the refusal', () => {
  const m = { seconds: 154.09, sha1: 'aaa' };
  assert.doesNotThrow(() => ec.checkRecording(m, { seconds: 154.091, sha1: () => 'aaa' }));
  assert.throws(() => ec.checkRecording(m, { seconds: 154.2, sha1: () => 'aaa' }), /154\.200.*154\.09/);
  assert.throws(() => ec.checkRecording(m, { seconds: 154.09, sha1: () => 'bbb' }), /bbb.*aaa/);
  assert.doesNotThrow(() => ec.checkRecording(m, { seconds: 154.09, sha1: () => 'bbb' }, true), '--any-recording waives the sha1');
  assert.throws(() => ec.checkRecording(m, { seconds: 160, sha1: () => 'aaa' }, true), /160\.000/, 'but never the length');
});

test("a shortened or lengthened version is checked against its own length, not the recording's; its sha1 is not the recording's and is not asked", () => {
  assert.doesNotThrow(() => ec.checkRecording(map, { seconds: 120.01, sha1: () => 'bbb' }, false, 'mk-b'));
  assert.doesNotThrow(() => ec.checkRecording(map, { seconds: 140, sha1: () => 'bbb' }, false, 'mk-a'));
  assert.doesNotThrow(() => ec.checkRecording(map, { seconds: 180, sha1: () => 'bbb' }, false, 'mk-plus1'), 'the made-up repeat adds 20 s');
  assert.throws(() => ec.checkRecording(map, { seconds: 140, sha1: () => 'bbb' }, false, 'mk-b'), (/** @type {Error} */ e) => /140\.000/.test(e.message) && /120\.000/.test(e.message) && /mk-b/.test(e.message));
  assert.throws(() => ec.checkRecording(map, { seconds: 120, sha1: () => 'aaa' }, false, 'full'), /120\.000.*160/, 'the full recording is its own length');
});

test('the placement text names the version and why, where the second block and the full orchestra fall in the speech, and the ending', () => {
  const text = ec.placementText(timeline(clips, map, { nodes, recording: 'mk-b' }));
  assert.match(text, /mk-b/);
  assert.match(text, /starts 17\.10 s into the film/);
  assert.match(text, /block 2 .*at 47\.10 s, in v04, \d+\.\d\d s in/);
  assert.match(text, /full orchestra at 77\.10 s, in v05, \d+\.\d\d s in/);
  assert.match(text, /black from strike 4 of 5 at 118\.10 s.*the line z .*122\.45.*126\.85 s.*gap 9\.00 s/s);
  assert.match(text, /title.*127\.10 s/);
  assert.match(endingText(timeline(clips, map, { nodes, recording: 'mk-b' })), /film ends at 133\.30 s/);
});

/* ---- ducking at the edges ---- */

test('each clip may duck by its own depth: a node that is less ducked leaves more of the music, and the ramps are the same', () => {
  const gain = (/** @type {string} */ source, /** @type {number} */ t) =>
    new Function('t', 'clip', 'min', 'max', 'lt', `return ${source};`)(t, (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, v)), Math.min, Math.max, (/** @type {number} */ a, /** @type {number} */ b) => +(a < b));
  const e = duckExpression([{ start: 10, length: 5 }, { start: 30, length: 5, db: -4 }], { db: -10, attack: 0.15, release: 0.4 }, 100);
  assert.ok(Math.abs(gain(e, 12) - 10 ** (-10 / 20)) < 1e-5, 'the first clip: the default 10 dB');
  assert.ok(Math.abs(gain(e, 32) - 10 ** (-4 / 20)) < 1e-5, 'the second: its own 4 dB');
  assert.ok(Math.abs(gain(e, 5) - 1) < 1e-9);
  assert.ok(Math.abs(gain(e, 29.925) - (1 + (1 - (1 - 10 ** (-4 / 20)) * 0.5) - 1)) < 1e-5, 'half way down by half of its own depth');
});

test('the voice is raised by its node`s gain and the voice bus is limited: the filters are one expression each, in dB', () => {
  assert.equal(ec.voiceGain(0), 'volume=0dB');
  assert.equal(ec.voiceGain(4), 'volume=4.00dB');
  assert.match(ec.VOICE_LIMITER, /^alimiter=limit=0\.\d+:attack=\d+:release=\d+/);
});

/* ---- ducking at the edges ---- */

test("the music's first note is not already ducked: a clip that begins with it ramps the duck down over the first 150 ms", () => {
  const gain = (/** @type {string} */ source, /** @type {number} */ t) =>
    new Function('t', 'clip', 'min', 'max', 'lt', `return ${source};`)(t, (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, v)), Math.min, Math.max, (/** @type {number} */ a, /** @type {number} */ b) => +(a < b));
  const dip = 10 ** (-10 / 20);
  const e = ec.duckExpression([{ start: 27.6, length: 20 }], { db: -10, attack: 0.15, release: 0.4 }, 100, 27.6);
  assert.ok(Math.abs(gain(e, 27.6) - 1) < 1e-6, `at the first note the gain is ${gain(e, 27.6)}, not 1`);
  assert.ok(Math.abs(gain(e, 27.675) - (1 + dip) / 2) < 1e-5, 'half down at 75 ms');
  assert.ok(Math.abs(gain(e, 27.75) - dip) < 1e-5, 'fully down at 150 ms');
});

test('a clip whose release would run into the coda releases fully before it', () => {
  const gain = (/** @type {string} */ source, /** @type {number} */ t) =>
    new Function('t', 'clip', 'min', 'max', 'lt', `return ${source};`)(t, (/** @type {number} */ v, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, v)), Math.min, Math.max, (/** @type {number} */ a, /** @type {number} */ b) => +(a < b));
  const e = ec.duckExpression([{ start: 70, length: 9.9 }], { db: -10, attack: 0.15, release: 0.4 }, 80, 0);
  assert.ok(Math.abs(gain(e, 79.999) - 1) < 5e-3, `just before the coda the gain is ${gain(e, 79.999)}, not back to full`);
  assert.ok(Math.abs(gain(e, 79.8) - (1 + 10 ** (-10 / 20)) / 2) < 1e-3, 'half way up 200 ms before the coda: the release began 400 ms before it');
  assert.ok(gain(e, 75) < 0.7, 'and down in the middle of the clip');
});

test('a move of one frame is its from rectangle, as the ffmpeg expression has it', () => {
  const from = { x: 0.1, y: 0.2, w: 0.5, roll: 0 }, to = { x: 0.3, y: 0.3, w: 0.4, roll: 0 };
  assert.deepEqual(moveRect({ from, to }, 0, 1), from);
  const cut = { frames: 1, move: { from, to } };
  const e = expressions(cut);
  /* The expression's progress is on/max(1, n - 1): at frame 0 of one frame, 0. */
  assert.match(e.w, /min\(1,on\/1\)/);
  near(cutRect(cut, 0).w, from.w);
});

test('the caption is a pill no wider than its words: libass\'s own box, never a bar the width of the frame', () => {
  const [filter, ...rest] = ec.captionFilters('top', '/tmp/cap.srt', 'Verdana');
  assert.equal(rest.length, 0, 'one filter: no drawbox beside it');
  assert.doesNotMatch(filter, /drawbox/);
  assert.match(filter, /BorderStyle=3/, 'an opaque box drawn behind each row of text, as wide as that row');
  assert.match(filter, /Alignment=6/);
  assert.match(filter, /OutlineColour=&H61000000&/, 'black at 62%, as the band was');
  assert.deepEqual(ec.captionFilters('off', '/tmp/cap.srt', 'Verdana'), []);
  assert.match(ec.captionFilters('foot', '/tmp/cap.srt', 'Verdana')[0], /Alignment=2/);
});


test('the music carries what a cut list is cut to: the film time of every kept statement and of every beat, sixteen to a statement, a repeated one with its copy', () => {
  const t = timeline(clips, map, { nodes });
  assert.deepEqual(t.music.statements.map((s) => s.n).slice(0, 3), [1, 6, 7], 'mk-b keeps statement 1 and then 6');
  assert.equal(t.music.beats.length, 16 * t.music.statements.length);
  near(t.music.beats[0], t.music.statements[0].start, 'the first beat is the first statement');
  near(t.music.beats[16], t.music.statements[1].start, 'the seventeenth is the second');
  near(t.music.statements[0].start, 17.1 + 10, 'statement 1 of the made-up map is at 10 in the recording');
  const plus = timeline(longer(56.5), map, { nodes });
  assert.equal(plus.music.version, 'mk-plus1');
  assert.deepEqual(plus.music.statements.slice(0, 6).map((s) => [s.n, s.copy]), [[1, 0], [2, 0], [3, 0], [2, 1], [3, 1], [4, 0]]);
});
