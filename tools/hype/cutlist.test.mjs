/**
 * The cut list's reader (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R3) on the made-up map and made-up takes, and the
 * committed list's check: its shots' median length falls from part one through the three blocks of the music.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { wordTime, resolveList, directCoda } from './cutlist.mjs';
import { timeline, captions } from './edit-commentary.mjs';
import { madeUp } from './made-up.mjs';

const F = 60;
const map = madeUp();
const clips = { n01: 8, n02: 6, n03: 5, n04: 7, n05: 20, n06: 20, n07: 10, n08: 8, n09: 14, n10: 10, n11: [1, 2, 2] };
const commentary = [
  { id: 'n06', part: 2, lines: ['A card can be set to go off when somebody says a particular phrase.', 'This trains players to choose their words carefully,', 'which, on a forum, we think is new.'] },
  { id: 'n11', part: 3, lines: ['Please let me know—', '—what you think—', '—after you have had a chance—', '—to figure this out!'] },
];
const tl = timeline(clips, map);
const cues = captions(commentary, tl);
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);
/** Every take is long and has the landings the rows ask for. */
/** @type {Record<string, any>} */
const takes = {
  'c-n01': { seconds: 120, landed: [] },
  'c-n05': { seconds: 1000, landed: [] },
  'c-n06': { seconds: 40, landed: [{ what: 'steel-chair', frame: 410 }, { what: 'lens', frame: 583 }] },
  'c-n09-wide': { seconds: 1000, landed: [] },
};
/** @returns {any[]} */
const base = () => [
  { node: 'n01', take: 'c-n01' },
  { statement: 7, beats: 16, take: 'c-n05', from: 0 },
  { node: 'n06', word: 'phrase', take: 'c-n06', sync: 'steel-chair', lead: 20 },
  { statement: 8, beats: 8, take: 'c-n05', from: 5 },
  { statement: 8, beats: 8, take: 'c-n09-wide', from: 0 },
];
const read = (/** @type {any[]} */ rows, /** @type {any} */ over = {}) => resolveList({ rows }, { tl, cues, takes, ...over });

test('a word`s time is its caption`s start plus its share of the caption by characters', () => {
  const cue = cues.find((c) => c.text.startsWith('A card can be'));
  const line = commentary[0].lines[0], at = line.indexOf('phrase');
  near(wordTime(cues, 'n06', 'phrase'), cue.start + (at / line.length) * (cue.end - cue.start), 'phrase');
  near(wordTime(cues, 'n06', 'A'), cue.start, 'the first word is the caption`s start');
  const second = cues.find((c) => c.text.startsWith('This trains'));
  near(wordTime(cues, 'n06', 'carefully'), second.start + (commentary[0].lines[1].indexOf('carefully') / commentary[0].lines[1].length) * (second.end - second.start));
  near(wordTime(cues, 'n06', 'a', 2), cue.start + (line.indexOf('a particular') / line.length) * (cue.end - cue.start), 'the second "a" is a whole word, case-blind: "a particular"');
  assert.throws(() => wordTime(cues, 'n06', 'tomatoes'), /n06.*tomatoes/);
  assert.throws(() => wordTime(cues, 'n06', 'phrase', 2), /n06.*phrase.*2/);
});

test('rows become shots in time order, each running to the next cut, the last to the coda', () => {
  const { shots } = read(base());
  assert.equal(shots.length, 5);
  assert.equal(shots[0].startFrame, 0, 'the film begins with the first shot');
  const phrase = wordTime(cues, 'n06', 'phrase');
  assert.equal(shots[2].startFrame, Math.round((phrase - 20 / F) * F), 'a row on a word starts lead frames before it');
  near(shots[2].from, 410 / F - 20 / F, 'and the take is where its landing is lead frames from the word');
  assert.equal(shots[1].startFrame, Math.round(tl.music.statements.find((s) => s.n === 7).start * F), 'a row on a statement starts on its first beat');
  assert.equal(shots[3].startFrame, Math.round(tl.music.beats[16 * 3] * F), 'a second row of the statement starts on its ninth beat: 8 beats in');
  assert.equal(shots[4].startFrame, Math.round(tl.music.beats[16 * 3 + 8] * F));
  shots.forEach((s, i) => { if (i) assert.equal(s.startFrame, shots[i - 1].startFrame + shots[i - 1].frames, `shot ${i} follows shot ${i - 1}`); });
  const end = shots.at(-1);
  assert.equal(end.startFrame + end.frames, Math.round(tl.music.codaStart * F), 'the last runs to the coda');
  assert.deepEqual(shots.map((s) => s.take), ['c-n01', 'c-n05', 'c-n06', 'c-n05', 'c-n09-wide']);
  assert.equal(shots[3].from, 5);
});

test('rows out of order in the list are put in time order; two cuts on one frame are refused', () => {
  const rows = base();
  const out = read([rows[3], rows[0], rows[2], rows[1], rows[4]]);
  assert.deepEqual(out.shots.map((s) => s.take), ['c-n01', 'c-n05', 'c-n06', 'c-n05', 'c-n09-wide'], 'the film is in time order whatever the list`s');
  assert.deepEqual(out.shots.map((s) => s.row), [2, 4, 3, 1, 5], 'each shot says which row it came from');
  assert.throws(() => read([...rows, { node: 'n06', word: 'phrase', take: 'c-n05', from: 0, lead: 20 }]), /same frame/);
});

test('the film must begin at its first frame', () => {
  assert.throws(() => read(base().slice(1)), /first frame|begins/);
});

test('a statement whose beats do not sum to 16 is refused, naming it and the sum', () => {
  assert.throws(() => read([...base().slice(0, 4)]), (/** @type {Error} */ e) => /statement 8/.test(e.message) && /8/.test(e.message) && /16/.test(e.message));
  assert.throws(() => read([...base(), { statement: 8, beats: 4, take: 'c-n05', from: 0 }]), /statement 8.*20.*16/);
});

test('a take that is neither on disk nor allowed as a slate is refused naming the row; a slate row is allowed and reported', () => {
  const rows = base();
  rows[1] = { statement: 7, beats: 16, take: 'b-scrub-2', from: 0 };
  assert.throws(() => read(rows), /b-scrub-2/);
  rows[1] = { statement: 7, beats: 16, take: 'b-scrub-2', from: 0, slate: true };
  const out = read(rows);
  assert.deepEqual(out.slates, ['b-scrub-2']);
  assert.equal(out.shots[1].slate, true);
  assert.deepEqual(read(base()).slates, []);
});

test('a shot under 6 frames is refused, naming its row', () => {
  assert.ok(read(base()).shots.every((s) => s.frames >= 6));
  /* a beat is 0.3125 s here, 18 frames; two cuts 0.05 s apart are 3 frames */
  assert.throws(() => read([...base(), { node: 'n07', at: 0.1, take: 'c-n05' }, { node: 'n07', at: 0.15, take: 'c-n05' }]), (/** @type {Error} */ e) => /under 6 frames/.test(e.message) && /n07/.test(e.message));
});

test('a row past its take`s end is refused unless it holds', () => {
  const rows = base();
  rows[0] = { node: 'n01', take: 'c-n01', from: 118 };
  assert.throws(() => read(rows), (/** @type {Error} */ e) => /c-n01/.test(e.message) && /hold/.test(e.message));
  rows[0] = { node: 'n01', take: 'c-n01', from: 118, hold: true };
  assert.doesNotThrow(() => read(rows));
  assert.equal(read(rows).shots[0].hold, true);
});

test('a sync names a landing of the take: a missing one, a start before the take, and a landing that has moved are refused', () => {
  const rows = base();
  rows[2] = { node: 'n06', word: 'phrase', take: 'c-n06', sync: 'no-such-landing', lead: 20 };
  assert.throws(() => read(rows), /c-n06.*no-such-landing/);
  rows[2] = { node: 'n06', word: 'phrase', take: 'c-n06', sync: 'steel-chair', lead: 600 };
  assert.throws(() => read(rows), /before the start of c-n06/);
  rows[2] = { node: 'n06', word: 'phrase', take: 'c-n06', sync: 'steel-chair', lead: 20, expect: 410 };
  assert.doesNotThrow(() => read(rows));
  const moved = { ...takes, 'c-n06': { seconds: 40, landed: [{ what: 'steel-chair', frame: 450 }] } };
  assert.throws(() => read(rows, { takes: moved }), (/** @type {Error} */ e) => /steel-chair/.test(e.message) && /410/.test(e.message) && /450/.test(e.message));
});

test('a row with a statement the version removed, an unknown field, or both a node and a statement is refused', () => {
  const rows = base();
  assert.throws(() => read([rows[0], { statement: 3, beats: 16, take: 'c-n05', from: 0 }]), /statement 3.*mk-b/);
  assert.throws(() => read([rows[0], { ...rows[1], beat: 4 }]), /unknown field "beat"/);
  assert.throws(() => read([rows[0], { ...rows[1], node: 'n05' }]), /node or a statement/);
  assert.throws(() => read([rows[0], { node: 'n99', take: 'c-n05' }]), /n99/);
});

test('a row`s move overrides the take`s, and the take`s own move and punches apply to its shots', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.25, w: 0.5, roll: 0 }, ease: 'inOut' };
  const rowMove = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.1, y: 0.1, w: 0.8, roll: 0 }, ease: 'linear' };
  const notes = { ...takes, 'c-n05': { seconds: 1000, width: 3840, landed: [], move, punches: [{ frame: 330, percent: 9 }] } };
  const rows = base();
  const out = read(rows, { takes: notes });
  assert.deepEqual(out.shots[1].move, move);
  rows[3] = { ...rows[3], move: rowMove };
  const over = read(rows, { takes: notes });
  assert.deepEqual(over.shots[3].move, rowMove, 'the row`s move wins');
  const s = over.shots[3], first = s.from * F;
  assert.deepEqual(s.punches ?? [], first <= 330 && 330 < first + s.frames ? [{ frame: 330 - first, percent: 9 }] : [], 'a punch of the take falls where it is in the shot');
  const inside = read([rows[0], { statement: 7, beats: 16, take: 'c-n05', from: 5 }], { takes: notes });
  assert.deepEqual(inside.shots[1].punches, [{ frame: 330 - 300, percent: 9 }]);
});

test('per block: the count of shots and their median length, by where each starts', () => {
  const { blocks } = read(base());
  assert.deepEqual(blocks.map((b) => b.name), ['part one', 'first block', 'second block', 'third block']);
  assert.equal(blocks.reduce((n, b) => n + b.count, 0), 5);
  const second = blocks.find((b) => b.name === 'second block');
  assert.ok(second.count >= 1 && second.median > 0);
});

/* ---- the committed list ---- */

test('the committed list, read against the placeholder voice, falls: part one, then the first, second and third blocks, each with a shorter median', async () => {
  const dir = new URL('../../instances/divided-world/ui/hype/', import.meta.url);
  const list = JSON.parse(readFileSync(new URL('cutlist.json', dir), 'utf8'));
  const real = JSON.parse(readFileSync(new URL('music-map.json', dir), 'utf8'));
  const { commentary: text } = await import(pathToFileURL(path.resolve('instances/divided-world/ui/hype/commentary.ts')).href);
  /* The placeholder voice's clip lengths (.runs/hype/voice, seconds), so the film this list is cut to is the one the edit makes of it; a new voice is new numbers here. */
  const voice = { n01: 31.556, n02: 20.767, n03: 16.196, n04: 16.771, n05: 13.166, n06: 8.202, n07: 12.591, n08: 7.967, n09: 18.129, n10: 10.266, n11: [2.0, 1.4, 2.2, 2.4] };
  assert.deepEqual(Object.keys(voice), text.map((/** @type {{ id: string }} */ n) => n.id), 'a clip for every node');
  const c = voice;
  const t = timeline(c, real);
  /* Every take the list names is there and long enough; every landing it syncs to is where its `expect` says. */
  /** @type {Record<string, any>} */
  const have = {};
  for (const r of list.rows) if (r.take) {
    const at = (have[r.take] ??= { seconds: 1e6, landed: [] });
    if (r.sync && !at.landed.some((l) => l.what === r.sync)) at.landed.push({ what: r.sync, frame: r.expect });
  }
  const { blocks, slates, shots } = resolveList(list, { tl: t, cues: captions(text, t), takes: have });
  /* The owner's note on the third cut: no shot holds on nothing, waiting for the music. From the second block on no shot is long, and the third block's are quick. */
  const edges = [t.music.second.at, t.music.third.at];
  const longest = shots.filter((x) => x.start >= edges[0]).reduce((a, x) => (x.length > a.length ? x : a));
  assert.ok(longest.length <= 6, `the second and third blocks have no shot over 6 s, but row ${longest.row} (${longest.take}) runs ${longest.length.toFixed(2)} s`);
  const third = blocks.find((b) => b.name === 'third block');
  assert.ok(third.median < 1.5, `the third block's median shot is under 1.5 s, not ${third.median.toFixed(2)} s`);
  const medians = blocks.map((b) => b.median);
  console.log(blocks.map((b) => `${b.name}: ${b.count} shots, median ${b.median.toFixed(2)} s`).join('\n'));
  assert.ok(blocks.every((b) => b.count > 0), 'every stretch has shots');
  for (let i = 1; i < medians.length; i++) assert.ok(medians[i] < medians[i - 1], `${blocks[i].name} (${medians[i].toFixed(2)} s) is shorter than ${blocks[i - 1].name} (${medians[i - 1].toFixed(2)} s)`);
  const coda = directCoda(t.nodes.find((/** @type {{ id: string }} */ n) => n.id === 'n11').cuts, list.coda, new Proxy({}, { get: () => ({ seconds: 1e6 }) }));
  assert.ok(coda.length > 0, 'the coda is directed from the list');
  for (const r of list.rows) if (!r.slate) assert.ok(!slates.includes(r.take), `${r.take} is named by a row not marked as a slate`);
});

test('part one is locked off: a row there with a move is refused, and a take`s own camera is not applied to a shot there', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.25, y: 0.25, w: 0.5, roll: 0 }, ease: 'inOut' };
  const withMove = { ...takes, 'c-n05': { seconds: 1000, landed: [], move, punch: 8 }, 'c-n01': { seconds: 120, landed: [], move, punch: 8, punches: [{ frame: 0, percent: 5 }] } };
  const rows = base();
  const out = read(rows, { takes: withMove });
  assert.equal(out.shots[0].move, undefined, 'the first shot is in part one');
  assert.equal(out.shots[0].punch, undefined);
  assert.equal(out.shots[0].punches, undefined);
  assert.deepEqual(out.shots[1].move, move, 'a shot of part two has its take`s');
  rows[0] = { node: 'n01', take: 'c-n01', move };
  assert.throws(() => read(rows), /part one.*locked off/);
});

test('the lock-off ends where node 4 begins: a row there may carry a move or punch, and one in node 3 may not', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.05, y: 0.03, w: 0.9, roll: 0 }, ease: 'inOut' };
  const n4 = tl.nodes.find((n) => n.id === 'n04'), n3 = tl.nodes.find((n) => n.id === 'n03');
  assert.ok(n4.start < tl.part.one[1], 'node 4 is inside part one, whose lock-off the film`s first design set');
  const rows = [{ node: 'n01', take: 'c-n01' }, { node: 'n04', take: 'c-n05', move, punch: 8 }];
  const out = read(rows, { takes: { ...takes, 'c-n05': { seconds: 1000, landed: [], move: { ...move, ease: 'linear' }, punches: [{ frame: 0, percent: 5 }] } } });
  assert.deepEqual(out.shots[1].move, move, 'a row in node 4 has its move');
  assert.equal(out.shots[1].punch, 8);
  const own = read([rows[0], { node: 'n04', take: 'c-n05' }], { takes: { ...takes, 'c-n05': { seconds: 1000, landed: [], move } } });
  assert.deepEqual(own.shots[1].move, move, 'and a take`s own camera is applied there');
  assert.throws(() => read([rows[0], { node: 'n03', at: 0, take: 'c-n05', move }, rows[1]]), /part one.*locked off/);
  assert.equal(n3.end, n4.start);
});

test('the coda`s cuts can be directed: a take and a place in it for a chord, the rest left as they are, and what cannot be shot is refused', () => {
  const cuts = tl.nodes.find((n) => n.id === 'n11').cuts;
  assert.ok(cuts.length >= 3, 'the made-up coda has chords to cut on');
  const t = { 's-a': { seconds: 3 }, 'b-x': { seconds: 20 } };
  const out = directCoda(cuts, [{ take: 's-a', from: 1 }, null, { take: 'b-x', from: 0.2, punch: 7, move: { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.1, y: 0.1, w: 0.8, roll: 0 } } }], t);
  assert.equal(out.length, cuts.length);
  assert.equal(out[0].take, 's-a');
  assert.equal(out[0].from, 1);
  assert.equal(out[0].punch, cuts[0].punch, 'the chord`s punch stays');
  assert.deepEqual(out[1], cuts[1], 'a null entry leaves the cut as it is');
  assert.equal(out[2].punch, 7);
  assert.equal(out[2].move.to.w, 0.8);
  assert.equal(out[0].startFrame, cuts[0].startFrame, 'the cut keeps its time');
  assert.equal(directCoda(cuts, undefined, t), cuts, 'no direction, no change');
  assert.throws(() => directCoda(cuts, [{ take: 'nope', from: 0 }], t), /coda cut 1.*nope/);
  assert.throws(() => directCoda(cuts, [{ take: 's-a', from: 2.9 }], t), /coda cut 1.*s-a/);
  assert.throws(() => directCoda(cuts, new Array(cuts.length + 1).fill(null), t), /one to a chord.*title/);
});

test('a synced landing must fall inside its shot: a next cut that comes before it is refused', () => {
  const rows = base();
  const word = wordTime(cues, 'n06', 'phrase') - tl.nodes.find((n) => n.id === 'n06').start;
  rows[2] = { node: 'n06', word: 'phrase', take: 'c-n06', sync: 'steel-chair', lead: 60 };
  assert.doesNotThrow(() => read(rows), 'a lead of a second is fine with no cut in it');
  assert.throws(() => read([...rows, { node: 'n06', at: word - 0.85, take: 'c-n05' }]), (/** @type {Error} */ e) => /steel-chair/.test(e.message) && /before it lands|next cut/.test(e.message));
});
