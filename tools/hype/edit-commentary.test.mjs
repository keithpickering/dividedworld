/**
 * The commentary edit's pure parts: the timeline, the captions, and the camera's moves
 * (docs/plans/2026-11-21-commentary-video-plan.md, tasks 8 and 8a). Nothing here runs ffmpeg.
 *
 * The made-up map is windows.test.mjs's: block 1 runs 10 to 70, block 2 70 to 100, block 3 100 to 130, the coda's chords sit at 130, 132,
 * 140, 141 and 150, and the last chord ends at 155. The music's first note is at 10, so it is 0 on the film where node 5 begins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { timeline, captions, srt, framesBetween, wrap, duckExpression, captionBand } from './edit-commentary.mjs';
import { cutRect, moveRect, punchScale, refusePush, pushLimit, expressions, corners, maxPush } from './moves.mjs';

const entries = (from, step) => Array.from({ length: 6 }, (_, i) => ({ t: from + i * step, confident: false, derived: true }));
const map = {
  firstNote: { t: 10, confident: true },
  blocks: [
    { id: 1, start: 10, end: 70, confident: false, entries: entries(10, 10) },
    { id: 2, start: 70, end: 100, confident: false, entries: entries(70, 5) },
    { id: 3, start: 100, end: 130, confident: true, entries: entries(100, 5) },
  ],
  coda: { chords: [130, 132, 140, 141, 150].map((t) => ({ t, confident: true })), end: { t: 155, confident: true } },
};
const clips = { n01: 8, n02: 6, n03: 5, n04: 7, n05: 20, n06: 20, n07: 10, n08: 8, n09: 14, n10: 10, n11: [1.5, 6, 8] };
const F = 60;
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);

test('part one follows the clips: each node is its clip and a breath of 0.4 s, one after another from 0', () => {
  const t = timeline(clips, map);
  const one = t.nodes.filter((n) => n.part === 1);
  assert.deepEqual(one.map((n) => n.id), ['n01', 'n02', 'n03', 'n04']);
  one.forEach((n, i) => near(n.length, [8.4, 6.4, 5.4, 7.4][i], n.id));
  near(one[0].start, 0);
  near(one[1].start, 8.4);
  near(one[3].start, 20.2);
  near(one[0].voice[0].start, 0);
  assert.equal(one[0].voice[0].length, 8);
  assert.equal(one[0].cuts.length, 1, 'no cut inside a node of part one');
});

test('part two starts where part one ends, and the music with it', () => {
  const t = timeline(clips, map);
  const p1 = 27.6;
  near(t.nodes.find((n) => n.id === 'n05').start, p1, 'n05');
  near(t.music.start, p1, 'music');
  near(t.music.from, 10);
  near(t.part.two[0], p1);
  near(t.part.one[1], p1);
});

test('the windows are the clips fitted: nodes 5 to 10 sit at their window, node 11 across the coda', () => {
  const t = timeline(clips, map);
  const p1 = 27.6;
  const n07 = t.nodes.find((n) => n.id === 'n07');
  const w = t.windows.find((x) => x.id === 'n07');
  near(n07.start, p1 + (w.start - 10), 'n07 start');
  near(n07.length, w.length, 'n07 length');
  near(n07.voice[0].start, n07.start, 'the voice begins with its window');
  const n11 = t.nodes.find((n) => n.id === 'n11');
  near(n11.start, p1 + 120, 'n11 begins on the first chord');
  assert.equal(n11.voice.length, 3);
  near(n11.voice[1].start, p1 + (132 - 10), 'line 2 is spoken from the gap that begins at the second chord');
});

test('the black and the end card follow the last chord: 5 s of black, then 10 s of card', () => {
  const t = timeline(clips, map);
  const p1 = 27.6;
  near(t.out.blackStart, p1 + (155 - 10), 'black');
  near(t.out.cardStart, t.out.blackStart + 5, 'card');
  near(t.out.end, t.out.cardStart + 10, 'end');
  near(t.total, t.out.end);
  near(t.music.untilFilm, t.out.blackStart, 'the music stops where the black begins');
  near(t.nodes.at(-1).start + t.nodes.at(-1).length, t.out.blackStart, 'node 11 runs to the final chord');
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

test('a clip that overruns its window is refused as fit refuses it, naming the node', () => {
  assert.throws(() => timeline({ ...clips, n08: 40 }, map), (/** @type {Error} */ e) => /n08/.test(e.message) && /over/.test(e.message));
});

test('a node 11 line longer than its gap is kept, cut off by the chord, and says by how much', () => {
  const t = timeline({ ...clips, n11: [1.5, 6, 10] }, map);
  const n11 = t.nodes.find((n) => n.id === 'n11');
  near(n11.voice[2].length, 9, 'line 3 plays only its gap');
  near(n11.voice[2].cut, 1, 'and the chord takes a second');
  assert.equal(t.slack.n11[2].cut, 1);
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

test('part three is cut to the theme: node 9 changes framing on every entry inside its window, on one clock', () => {
  const t = timeline(clips, map, { framings: { n09: ['wide', 'tight', 'turned'] } });
  const n09 = t.nodes.find((n) => n.id === 'n09');
  const w = t.windows.find((x) => x.id === 'n09');
  const inside = map.blocks[2].entries.map((e) => e.t).filter((x) => x > w.start + 1e-9 && x < w.end - 1e-9);
  assert.equal(n09.cuts.length, inside.length + 1);
  assert.deepEqual(n09.cuts.map((c) => c.take).slice(0, 4), ['n09-wide', 'n09-tight', 'n09-turned', 'n09-wide']);
  for (const c of n09.cuts) near(c.from, c.at, 'every framing plays the same moment');
  near(n09.cuts[1].at, inside[0] - w.start, 'the first cut is on the first entry');
  assert.equal(n09.cuts[1].punch, 8, 'a cut on an entry is a punch');
  assert.equal(n09.cuts[0].punch, undefined);
});

test('each chord of the coda is a hard cut with a punch-in', () => {
  const t = timeline(clips, map);
  const n11 = t.nodes.find((n) => n.id === 'n11');
  assert.equal(n11.cuts.length, 5);
  assert.ok(n11.cuts.every((c) => c.punch === 10));
  near(n11.cuts[1].at, 2);
  near(n11.cuts.at(-1).at + n11.cuts.at(-1).length, 25);
});

test('a landing in part three is a punch at its frame, wherever the retime has put it', () => {
  const t = timeline(clips, map, { landed: { n09: [{ what: 'steel-chair', frame: 150 }] } });
  const n09 = t.nodes.find((n) => n.id === 'n09');
  const at = n09.retime.placed[0].at;
  const cut = n09.cuts.find((c) => c.at <= at + 1e-9 && c.at + c.length > at);
  assert.deepEqual(cut.punches, [{ frame: Math.round((at - cut.at) * F), percent: 5 }]);
  assert.deepEqual(t.hits.map((h) => [h.what, Math.round((h.at - n09.start) * F)]), [['steel-chair', Math.round(at * F)]]);
});

/* ---- captions ---- */

const commentary = [
  { id: 'n06', part: 2, lines: ['A card can be set to go off when somebody says a particular phrase.', 'This trains players to choose their words carefully,', 'which, on a forum, we think is new.'] },
  { id: 'n11', part: 3, lines: ['Please let me know—', '—what you think—', '—after you have had a chance—'] },
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

test('captions: each line of node 11 is shown in its own gap, for as long as it plays', () => {
  const t = timeline({ ...clips, n11: [1.5, 6, 10] }, map);
  const cues = captions(commentary, t).filter((c) => c.node === 'n11');
  assert.equal(cues.length, 3);
  near(cues[0].end - cues[0].start, 1.5);
  near(cues[2].end - cues[2].start, 9, 'cut off by the chord');
  near(cues[1].start, 27.6 + (132 - 10));
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

test('the end card wraps its words without losing or changing one', async () => {
  const { END_CARD } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
  const lines = wrap(END_CARD, 22);
  assert.equal(lines.join(' '), END_CARD);
  assert.ok(lines.every((l) => l.length <= 22), lines.join(' | '));
  assert.ok(lines.length >= 3);
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
  assert.equal(top.alignment, 8, 'the words are top-centered');
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

test('a node with landings in part three is retimed to the theme: speeds on its cuts, one clock for every framing, the voice untouched', () => {
  const landed = { n09: [{ what: 'a', frame: 1 * 60 }, { what: 'b', frame: 4 * 60 }, { what: 'c', frame: 10 * 60 }, { what: 'd', frame: 16 * 60 }] };
  const t = timeline(clips, map, { framings: { n09: ['wide', 'tight', 'turned'] }, landed });
  const n09 = t.nodes.find((n) => n.id === 'n09');
  assert.ok(n09.cuts.every((c) => typeof c.speed === 'number'), 'every cut of node 9 has a speed');
  assert.ok(n09.cuts.every((c) => c.speed >= 2 / 3 - 1e-9 && c.speed <= 4 / 3 + 1e-9), 'never past a third');
  assert.ok(n09.cuts.some((c) => Math.abs(c.speed - 1) > 1e-6), 'and at least one is not 1');
  near(n09.cuts[0].from, 0);
  for (let k = 1; k < n09.cuts.length; k++) near(n09.cuts[k].from, n09.cuts[k - 1].from + n09.cuts[k - 1].speed * n09.cuts[k - 1].length, 'the take is continuous across the cut');
  assert.ok(n09.retime, 'the node carries what the retime did');
  const plain = timeline(clips, map, { framings: { n09: ['wide', 'tight', 'turned'] } });
  const p9 = plain.nodes.find((n) => n.id === 'n09');
  assert.deepEqual(p9.voice, n09.voice, 'the voice is not retimed');
  assert.equal(p9.cuts[0].speed, undefined, 'a node with no landings is not retimed');
  assert.deepEqual(t.music, plain.music, 'nor is the music');
});

test('hand-set entries replace the derived ones: the cuts are on them', () => {
  const w = timeline(clips, map).windows.find((x) => x.id === 'n09');
  const hand = [w.start + 3, w.start + 9];
  const t = timeline(clips, map, { entries: hand });
  const n09 = t.nodes.find((n) => n.id === 'n09');
  assert.equal(n09.cuts.length, 3);
  near(n09.cuts[1].at, 3);
  near(n09.cuts[2].at, 9);
});

test("a landing's sound is placed where its play now lands in the film", () => {
  const landed = { n09: [{ what: 'steel-chair', frame: 6 * 60 }, { what: 'x', frame: 10 * 60 }] };
  const t = timeline(clips, map, { landed });
  const n09 = t.nodes.find((n) => n.id === 'n09');
  const hit = t.hits.find((h) => h.what === 'steel-chair');
  const r = n09.retime.placed.find((p) => p.what === 'steel-chair');
  near(hit.at, n09.start + r.at);
});
