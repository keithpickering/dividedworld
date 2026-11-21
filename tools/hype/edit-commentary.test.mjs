/**
 * The commentary edit's pure parts: the timeline, the captions, and the camera's moves
 * (docs/plans/2026-11-21-commentary-video-plan.md, tasks 8 and 8a). Nothing here runs ffmpeg.
 *
 * The made-up map is made-up.mjs's: block 1 runs 10 to 70, block 2 70 to 100, block 3 100 to 130, the coda's chords sit at 130, 132,
 * 140, 141 and 150, and the last chord ends at 155. The title's strike is the one before the last: 141 (101 in mk-b), the final strike 150 (110). The music's first note is at 10, so it is 0 on the film where node 5 begins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { versionMap } from './music.mjs';
import { timeline, captions, srt, framesBetween, wrap, duckExpression, captionBand } from './edit-commentary.mjs';
import * as ec from "./edit-commentary.mjs";
import { madeUp } from './made-up.mjs';
import { cutRect, moveRect, punchScale, refusePush, pushLimit, expressions, corners, maxPush } from './moves.mjs';

const map = madeUp();
/* Speech to 111.15 s: the ten clips and nine breaths of 0.35 s. With these, the coda's first chord falls at 111.35 and mk-b (first chord at 90) is the longest version that starts 5 s in. */
const clips = { n01: 8, n02: 6, n03: 5, n04: 7, n05: 20, n06: 20, n07: 10, n08: 8, n09: 14, n10: 10, n11: [1, 2, 2] };
/** The clips with node 5 longer (or shorter) by `by` seconds, which moves the coda by as much. */
const longer = (/** @type {number} */ by) => ({ ...clips, n05: clips.n05 + by });
const F = 60;
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);

test('the narration is continuous: each node is its clip and a breath of 0.35 s, one after another from the first frame', () => {
  const t = timeline(clips, map);
  const one = t.nodes.filter((n) => n.part === 1);
  assert.deepEqual(one.map((n) => n.id), ['n01', 'n02', 'n03', 'n04']);
  one.forEach((n, i) => near(n.length, [8.35, 6.35, 5.35, 7.35][i], n.id));
  near(one[0].start, 0);
  near(one[0].voice[0].start, 0);
  assert.equal(one[0].voice[0].length, 8);
  near(one[1].start, 8.35);
  near(one[3].start, 20.05);
  assert.equal(one[0].cuts.length, 1, 'no cut inside a node before the cut list');
  const ids = ['n01', 'n02', 'n03', 'n04', 'n05', 'n06', 'n07', 'n08', 'n09', 'n10'];
  let at = 0;
  for (const id of ids) {
    const n = t.nodes.find((x) => x.id === id);
    near(n.start, at, `${id} starts when the clip before it and its breath are done`);
    near(n.voice[0].start, at, `${id}'s voice`);
    at += clips[id] + 0.35;
  }
  near(t.nodes.find((n) => n.id === 'n10').voice[0].start + clips.n10, 111.15, 'the speech ends');
});

test('a node that follows a pause starts that pause after the clip before it, in the data\'s order: n02b, 3 s after "politely."', () => {
  const nodes = [
    { id: 'n01', part: 1 }, { id: 'n02', part: 1 }, { id: 'n02b', part: 1, after: 3 }, { id: 'n03', part: 1 }, { id: 'n04', part: 1 },
    { id: 'n05', part: 2 }, { id: 'n06', part: 2 }, { id: 'n07', part: 2 }, { id: 'n08', part: 2 }, { id: 'n09', part: 3 }, { id: 'n10', part: 3 },
  ];
  const t = timeline({ ...clips, n02b: 2.3 }, map, { nodes });
  const at = (/** @type {string} */ id) => /** @type {any} */ (t.nodes.find((n) => n.id === id));
  assert.ok(t.nodes.some((n) => n.id === 'n02b'), 'n02b is a node of the timeline');
  near(at('n02b').start, 8.35 + 6 + 3, 'n02b starts 3 s after n02 ends, not after a breath of 0.35');
  near(at('n02b').voice[0].start, at('n02b').start);
  near(at('n03').start, 8.35 + 6 + 3 + 2.3 + 0.35, 'n03 follows n02b by the usual breath');
  near(at('n02').end, at('n02b').start, 'n02 runs to the pause end: its shot owns the silence');
  assert.equal(at('n02b').part, 1);
  assert.deepEqual(t.nodes.slice(0, 5).map((n) => n.id), ['n01', 'n02', 'n02b', 'n03', 'n04']);
  assert.deepEqual(t.part.one, [0, at('n05').start], 'part one runs to node 5, n02b inside it');
  assert.throws(() => timeline(clips, map, { nodes }), /n02b has no clip/);
  assert.throws(() => timeline({ ...clips, n02b: 2.3 }, map, { nodes, moves: { n02b: { punch: 5 } } }), /n02b.*part one.*locked off/);
});

test('the music is laid from its end: the version`s first coda chord falls 0.2 s after node 10`s last word', () => {
  const t = timeline(clips, map);
  const n10 = t.nodes.find((n) => n.id === 'n10'), n11 = t.nodes.find((n) => n.id === 'n11');
  near(n10.voice[0].start + clips.n10 + 0.2, n11.start, 'node 11 begins 0.2 s after node 10 is spoken');
  near(t.music.codaStart, n11.start);
  near(n10.end, n11.start, 'node 10 runs to the coda');
  const v = versionMap(map, t.music.version);
  near(t.music.start, 111.35 - v.coda.chords[0].t, 'the start is the coda less the first chord');
  near(t.music.until, v.coda.end.t + 1.2, 'the music plays on to the film`s end, 1.2 s past the final chord`s end');
  near(t.music.untilFilm, t.music.start + v.coda.end.t + 1.2);
});

test('the version is the longest of full, mk-a and mk-b whose music starts at least 5 s into the film', () => {
  /* speech end 111.15 + by: the coda at 111.35 + by; the start is that less 130 (full), 110 (mk-a), 90 (mk-b). */
  const pick = (/** @type {number} */ by) => { const t = timeline(longer(by), map); return { v: t.music.version, start: t.music.start }; };
  assert.equal(pick(0).v, 'mk-b');
  near(pick(0).start, 21.35, 'mk-b starts 21.35 s in');
  assert.equal(pick(3.6).v, 'mk-b', 'mk-a would start at 4.95 s');
  assert.equal(pick(3.7).v, 'mk-a');
  near(pick(10).start, 11.35, 'mk-a');
  assert.equal(pick(23.6).v, 'mk-a', 'full would start at 4.95 s');
  assert.equal(pick(23.7).v, 'full');
  near(pick(30).start, 11.35, 'full');
});

test('--recording fixes the version; a start before the film begins is trimmed from the head of the music', () => {
  const t = timeline(clips, map, { recording: 'full' });
  assert.equal(t.music.version, 'full');
  near(t.music.start, 0, 'the music starts on the first frame');
  near(t.music.from, 130 - 111.35, 'and begins 18.65 s into the recording');
  assert.equal(timeline(clips, map, { recording: 'mk-a' }).music.version, 'mk-a');
  near(timeline(clips, map, { recording: 'mk-a' }).music.start, 1.35, 'mk-a would start 1.35 s in, which the speech lets it do when asked');
  assert.throws(() => timeline(clips, map, { recording: 'mk-z' }), /mk-z/);
  const auto = timeline(clips, map);
  near(auto.music.from, 0, 'a start after the first frame is the recording from its first second');
});

test('when no version reaches 5 s the shortest is used, and the timeline says the music starts before the speech allows', () => {
  const t = timeline(longer(-18), map);
  assert.equal(t.music.version, 'mk-b');
  assert.ok(t.music.start < 5);
  assert.ok(t.music.notes.some((n) => /before the speech allows/.test(n)), t.music.notes.join('|'));
  assert.deepEqual(timeline(clips, map).music.notes, [], 'no note when the rule is met');
});

test('where the second block and the full orchestra fall in the speech: the node and how far into it', () => {
  const t = timeline(clips, map);
  /* mk-b: statement 7 is at 70 - 40 = 30 of the music, statement 13 at 60; the music starts at 21.35. */
  near(t.music.second?.at, 51.35, 'block 2');
  assert.equal(t.music.second?.node, 'n06');
  near(t.music.second?.into, 51.35 - 47.75 + 0, 'into n06');
  near(t.music.third?.at, 81.35, 'the full orchestra');
  assert.equal(t.music.third?.node, 'n08');
  near(t.music.third?.into, 81.35 - 78.45, 'into n08');
});

test('the title: its strike is the coda`s second-to-last chord, the final strike the last, and the film ends 1.2 s after the final chord`s end', () => {
  const t = timeline(clips, map), s = t.music.start, v = versionMap(map, 'mk-b');
  near(t.out.titleStart, s + 101, 'the title`s strike');
  near(t.out.finalStart, s + 110, 'the final strike');
  near(t.out.end, s + v.coda.end.t + 1.2, 'the film ends a tail after the final chord`s end');
  near(t.out.fadeStart, t.out.end - 0.8, 'the picture fades over the last 0.8 s');
  near(t.total, t.out.end);
  near(t.nodes.at(-1).start + t.nodes.at(-1).length, t.out.titleStart, 'node 11 runs to the title`s strike');
  near(t.music.untilFilm, t.out.end, 'the music plays to the end, its decay as recorded');
  assert.equal(t.out.blackStart, undefined, 'no held black');
  assert.equal(t.out.cardStart, undefined, 'no end card');
  assert.deepEqual(t.part.out, [t.out.titleStart, t.out.end]);
  assert.equal(t.part.three[1], t.out.titleStart);
});

test('the cuts of a node cover it frame for frame, and every node starts on the frame where the last ended', () => {
  const t = timeline(clips, map, { framings: { n09: ['wide', 'tight', 'turned'] } });
  let at = 0;
  for (const n of t.nodes) {
    assert.equal(Math.round(n.start * F), at, `${n.id} starts on frame ${at}`);
    assert.equal(n.cuts.reduce((s, c) => s + c.frames, 0), n.frames, `${n.id}'s cuts add up to its frames`);
    let k = Math.round(n.start * F);
    for (const c of n.cuts) { assert.equal(c.startFrame, k, `${n.id} cut at ${c.at}`); k += c.frames; }
    at += n.frames;
  }
  assert.equal(framesBetween(0, 1.0083), 60);
});

test('node 11`s lines are laid from the coda`s first chord to the title`s strike, in order, each at full length, with equal gaps', () => {
  for (const lengths of [[1, 2, 2], [1, 1.5, 2, 0.5]]) {
    const t = timeline({ ...clips, n11: lengths }, map), n11 = t.nodes.find((n) => n.id === 'n11'), s = t.music.start;
    assert.equal(n11.voice.length, lengths.length, 'one voice a line, however many lines');
    const gap = (11 - lengths.reduce((a, b) => a + b, 0)) / (lengths.length + 1);
    let at = s + 90 + gap;
    n11.voice.forEach((v, i) => { near(v.start, at, `line ${i + 1} starts`); near(v.length, lengths[i], `line ${i + 1} plays in full`); assert.ok(!v.cut, 'nothing is cut off'); at += lengths[i] + gap; });
    near(at, s + 101, 'the last gap runs to the title`s strike');
    assert.ok(n11.voice.at(-1).start + n11.voice.at(-1).length < t.out.titleStart, 'the last line ends before the title`s strike');
  }
});

test('node 11`s lines that do not fit between the first chord and the title`s strike are refused, naming the overrun', () => {
  assert.throws(() => timeline({ ...clips, n11: [4, 4, 4] }, map), /n11.*1(\.00)? s too long|overrun.*1(\.00)? s|1(\.00)? s.*(over|too long)/);
  assert.doesNotThrow(() => timeline({ ...clips, n11: [4, 4, 3] }, map));
});

test('a clip missing for a node is refused plainly', () => {
  const { n06: _gone, ...rest } = clips;
  assert.throws(() => timeline(rest, map), /n06.*no clip/);
});

test('part one carries no move: its cuts have none, and a move declared on it is refused', () => {
  const t = timeline(clips, map);
  for (const c of t.nodes.filter((n) => n.part === 1).flatMap((n) => n.cuts)) {
    assert.equal(c.move, undefined);
    assert.equal(c.punch, undefined);
    assert.equal(c.punches, undefined);
  }
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.25, w: 0.5, roll: 0 }, ease: 'inOut' };
  assert.throws(() => timeline(clips, map, { moves: { n03: { move } } }), /n03.*part one.*locked off/);
  assert.throws(() => timeline(clips, map, { moves: { n02: { punch: 10 } } }), /n02.*part one/);
});

test('a move declared on a part-two node reaches its cut, and a push past the take is refused naming the cut', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.25, w: 0.5, roll: 0 }, ease: 'inOut' };
  const t = timeline(clips, map, { moves: { n06: { move, punch: 12 } } });
  const cut = t.nodes.find((n) => n.id === 'n06').cuts[0];
  assert.deepEqual(cut.move, move);
  assert.equal(cut.punch, 12);
  const past = { from: move.from, to: { x: 0.4, y: 0.4, w: 0.2, roll: 0 }, ease: 'linear' };
  assert.throws(() => timeline(clips, map, { moves: { n06: { move: past } } }), (/** @type {Error} */ e) => /n06/.test(e.message) && /5\.00x/.test(e.message) && /2\.00x/.test(e.message));
  const wider = { from: move.from, to: { x: 0.35, y: 0.35, w: 0.3, roll: 0 }, ease: 'linear' };
  assert.doesNotThrow(() => timeline(clips, map, { moves: { n06: { move: wider } }, sizes: { n06: 3840 } }), 'a take of 3840 px gives 4x');
  assert.throws(() => timeline(clips, map, { moves: { n06: { move: wider } } }), /3\.33x/);
});

test('each chord of the coda is a hard cut with a punch-in', () => {
  const t = timeline(clips, map);
  const n11 = t.nodes.find((n) => n.id === 'n11');
  assert.equal(n11.cuts.length, 3, 'a cut to each chord up to the title`s strike, and none on the title`s two');
  assert.ok(n11.cuts.every((c) => c.punch === 10));
  near(n11.cuts[1].at, 2);
  near(n11.cuts.at(-1).at + n11.cuts.at(-1).length, 11, 'the last cut ends at the title`s strike');
});

test('a landing in part three is a punch at its frame, and its sound is placed at that frame of its node', () => {
  const t = timeline(clips, map, { landed: { n09: [{ what: 'steel-chair', frame: 150 }] } });
  const n09 = t.nodes.find((n) => n.id === 'n09');
  assert.deepEqual(n09.cuts[0].punches, [{ frame: 150, percent: 5 }]);
  assert.deepEqual(t.hits.map((h) => [h.what, h.at]), [['steel-chair', n09.start + 2.5]]);
  assert.equal(timeline(clips, map, { landed: { n06: [{ what: 'steel-chair', frame: 150 }] } }).nodes.find((n) => n.id === 'n06').cuts[0].punches, undefined, 'only in part three');
});

/* ---- captions ---- */

const commentary = [
  { id: 'n06', part: 2, lines: ['A card can be set to go off when somebody says a particular phrase.', 'This trains players to choose their words carefully,', 'which, on a forum, we think is new.'] },
  { id: 'n11', part: 3, lines: ['Please let me know—', '—what you think—', '—after you have had a chance—', '—to figure this out!'] },
];

test('captions: a node of three lines, each shown for its share of the clip by its characters', () => {
  const t = timeline(clips, map);
  const cues = captions(commentary, t).filter((c) => c.node === 'n06');
  assert.equal(cues.length, 3);
  const n06 = t.nodes.find((n) => n.id === 'n06');
  near(cues[0].start, n06.voice[0].start);
  near(cues[2].end, n06.voice[0].start + 20);
  near(cues[0].end, cues[1].start);
  near(cues[1].end, cues[2].start);
  const chars = commentary[0].lines.map((l) => l.length), total = chars.reduce((a, b) => a + b, 0);
  near(cues[0].end - cues[0].start, (20 * chars[0]) / total, 'line 1');
  near(cues[1].end - cues[1].start, (20 * chars[1]) / total, 'line 2');
  assert.deepEqual(cues.map((c) => c.text), commentary[0].lines);
});

test('captions: each line of node 11 is shown at its own time, for as long as it plays, and nothing is captioned during the title', () => {
  const t = timeline({ ...clips, n11: [1, 1.5, 2, 0.5] }, map);
  const cues = captions(commentary, t).filter((c) => c.node === 'n11');
  assert.equal(cues.length, 4);
  const n11 = t.nodes.find((n) => n.id === 'n11');
  cues.forEach((c, i) => { near(c.start, n11.voice[i].start, `cue ${i + 1}`); near(c.end - c.start, [1, 1.5, 2, 0.5][i]); });
  assert.ok(captions(commentary, t).every((c) => c.end <= t.out.titleStart + 1e-9), 'no caption in the title');
});

test('captions: a node with no commentary text has no cue, and the srt is numbered and timed in milliseconds', () => {
  const t = timeline(clips, map);
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

/* ---- the end card's words, and the music's ducking ---- */

test('the title`s words are TITLE and TITLE_NOTE when the instance has them, else the deprecated END_CARD split at its first parenthesis', () => {
  assert.deepEqual(ec.titleWords({ TITLE: 'DIVIDED WROLD', TITLE_NOTE: '(nonsense)', END_CARD: 'old (card)' }), { title: 'DIVIDED WROLD', note: '(nonsense)' });
  assert.deepEqual(ec.titleWords({ END_CARD: 'DIVIDED WROLD (misspelled) (put it in)' }), { title: 'DIVIDED WROLD', note: '(misspelled) (put it in)' });
  assert.throws(() => ec.titleWords({}), /TITLE/);
});

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

const nodes = [...['n01', 'n02', 'n03', 'n04', 'n05', 'n06', 'n07', 'n08', 'n09', 'n10'].map((id) => ({ id, lines: ['a line.'] })), { id: 'n11', lines: ['one', 'two', 'three'] }];
const fullVoice = [...nodes.slice(0, 10).map((n) => `${n.id}.mp3`), 'n11-1.mp3', 'n11-2.mp3', 'n11-3.mp3'];
const fullTakes = [...nodes.slice(0, 8).map((n) => `c-${n.id}.mp4`), 'c-n09-wide.mp4', 'c-n09-tight.mp4', 'c-n09-turned.mp4', 'c-n10.mp4', 'c-n11.mp4', 'c-title-1.mp4', 'c-title-2.mp4'];
const resolve = (over = {}) => ec.resolveInputs({ commentary: nodes, voiceFiles: fullVoice, takeFiles: fullTakes, haveMusic: true, ...over });

test('a full voice folder, every take and the music resolve with no stand-in, no note and no stamp', () => {
  const r = resolve();
  assert.deepEqual(r.notes, []);
  assert.equal(r.placeholderSound, false);
  assert.deepEqual(r.slates, []);
  assert.deepEqual(r.framings.n09, ['wide', 'tight', 'turned']);
  assert.deepEqual(r.voice.n11, ['n11-1.mp3', 'n11-2.mp3', 'n11-3.mp3']);
  assert.equal(r.voice.n05, 'n05.mp3');
  assert.deepEqual(ec.stampsFor(r, { take: 'c-n05' }, fullTakes), { slate: false, stamps: [] });
  assert.deepEqual(ec.stampsFor(r, { take: 'c-title-1' }, fullTakes), { slate: false, stamps: [] });
});

test('one clip missing from an otherwise full voice folder is refused, naming the clip', () => {
  assert.throws(() => resolve({ voiceFiles: fullVoice.filter((f) => f !== 'n07.mp3') }), /no clip named n07\b/);
  assert.throws(() => resolve({ voiceFiles: fullVoice.filter((f) => f !== 'n11-2.mp3') }), /no clip named n11-2\b/);
});

test('no voice folder is PLACEHOLDER SOUND on every frame, and so is music that is absent', () => {
  for (const [what, over] of /** @type {[string, object][]} */ ([['no voice folder', { voiceFiles: null }], ['no music', { haveMusic: false }]])) {
    const r = resolve(over);
    assert.equal(r.placeholderSound, true, what);
    assert.ok(r.notes.some((n) => /PLACEHOLDER SOUND/.test(n)), what);
    for (const piece of [{ take: 'c-n05' }, { take: 'c-title-2' }]) assert.ok(ec.stampsFor(r, piece, fullTakes).stamps.includes('PLACEHOLDER SOUND'), `${what}: ${JSON.stringify(piece)}`);
  }
  assert.deepEqual(resolve({ voiceFiles: null }).voice.n11, [null, null, null], 'a clip with no folder is silence, not a file');
});

test('a missing take is a slate that carries PLACEHOLDER PICTURE; a take that is there does not', () => {
  const takes = fullTakes.filter((f) => f !== 'c-n06.mp4');
  const r = resolve({ takeFiles: takes });
  assert.deepEqual(r.slates, ['n06']);
  assert.ok(r.notes.some((n) => /n06 has no take/.test(n)));
  assert.deepEqual(ec.stampsFor(r, { take: 'c-n06' }, takes), { slate: true, stamps: ['PLACEHOLDER PICTURE'] });
  assert.deepEqual(ec.stampsFor(r, { take: 'c-n05' }, takes).stamps, []);
  assert.deepEqual(ec.stampsFor(resolve({ takeFiles: takes, voiceFiles: null }), { take: 'c-n06' }, takes).stamps, ['PLACEHOLDER SOUND', 'PLACEHOLDER PICTURE'], 'both stamps, on a slate with no sound');
});

test('node 9 with only some of its three framings is reported naming the missing; with none it is a slate', () => {
  const some = fullTakes.filter((f) => f !== 'c-n09-tight.mp4' && f !== 'c-n09-turned.mp4');
  const r = resolve({ takeFiles: some });
  assert.deepEqual(r.framings.n09, ['wide']);
  assert.deepEqual(r.slates, [], 'a framing that is there is a take');
  assert.ok(r.notes.some((n) => /node 9 has only wide.*missing tight, turned/.test(n)), r.notes.join('|'));
  const none = resolve({ takeFiles: fullTakes.filter((f) => !/n09/.test(f)) });
  assert.deepEqual(none.slates, ['n09']);
  assert.equal(none.framings.n09, undefined);
});

test('a missing c-title-1 or c-title-2 is a slate like any take: reported, and stamped PLACEHOLDER PICTURE', () => {
  const takes = fullTakes.filter((f) => f !== 'c-title-2.mp4');
  const r = resolve({ takeFiles: takes });
  assert.deepEqual(r.slates, []);
  assert.deepEqual(r.titleSlates, ['c-title-2']);
  assert.ok(r.notes.some((n) => /c-title-2 has no take/.test(n)), r.notes.join('|'));
  assert.deepEqual(ec.stampsFor(r, { take: 'c-title-2' }, takes).stamps, ['PLACEHOLDER PICTURE']);
  assert.deepEqual(ec.stampsFor(r, { take: 'c-title-1' }, takes).stamps, []);
  assert.equal('endCard' in r, false, 'there is no end card');
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

test("a shortened version is checked against its own length, not the recording's; its sha1 is not the recording's and is not asked", () => {
  assert.doesNotThrow(() => ec.checkRecording(map, { seconds: 120.01, sha1: () => 'bbb' }, false, 'mk-b'));
  assert.doesNotThrow(() => ec.checkRecording(map, { seconds: 140, sha1: () => 'bbb' }, false, 'mk-a'));
  assert.throws(() => ec.checkRecording(map, { seconds: 140, sha1: () => 'bbb' }, false, 'mk-b'), (/** @type {Error} */ e) => /140\.000/.test(e.message) && /120\.000/.test(e.message) && /mk-b/.test(e.message));
  assert.throws(() => ec.checkRecording(map, { seconds: 120, sha1: () => 'aaa' }, false, 'full'), /120\.000.*160/, 'the full recording is its own length');
});

test('the placement text names the version, the start, and where the second block and the full orchestra fall in the speech', () => {
  const text = ec.placementText(timeline(clips, map));
  assert.match(text, /mk-b/);
  assert.match(text, /starts 21\.35 s into the film/);
  assert.match(text, /block 2 .*at 51\.35 s, in n06, 3\.60 s in/);
  assert.match(text, /full orchestra at 81\.35 s, in n08, 2\.90 s in/);
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

test('a clip length that is NaN, negative, infinite or not a number is refused naming the node', () => {
  for (const bad of [NaN, -1, Infinity, '5', null]) assert.throws(() => timeline({ ...clips, n05: /** @type {any} */ (bad) }, map), /n05 has a clip length/, String(bad));
  assert.throws(() => timeline({ ...clips, n11: [1, NaN, 2] }, map), /n11 has a clip length/);
});

test('the music carries what a cut list is cut to: the film time of every kept statement and of every beat, sixteen to a statement', () => {
  const t = timeline(clips, map);
  assert.deepEqual(t.music.statements.map((s) => s.n).slice(0, 3), [1, 6, 7], 'mk-b keeps statement 1 and then 6');
  assert.equal(t.music.beats.length, 16 * t.music.statements.length);
  near(t.music.beats[0], t.music.statements[0].start, 'the first beat is the first statement');
  near(t.music.beats[16], t.music.statements[1].start, 'the seventeenth is the second');
  near(t.music.statements[0].start, 21.35 + 10, 'statement 1 of the made-up map is at 10 in the recording');
});
