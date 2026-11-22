/**
 * The cut list's reader (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R3) on the made-up map and made-up takes, and the
 * committed list's check that it reads. The nodes are made up (their ids mean nothing to the reader: roles and `locked` decide).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { wordTime, resolveList, directCoda, codaHits } from './cutlist.mjs';
import { timeline, captions, speechNodes, spoken } from './edit-commentary.mjs';
import { madeUp } from './made-up.mjs';

const F = 60;
const map = madeUp();
const clips = { n01: 8, n02: 6, n03: 5, n04: 7, n05: 20, n06: 20, n07: 10, n08: 8, n09: 14, n10: 10, n11: 4 };
/** n01 to n03 are locked off (the camera first moves in n04), n09 and n10 are frantic, n11 is the line over black. */
const nodes = ['n01', 'n02', 'n03', 'n04', 'n05', 'n06', 'n07', 'n08', 'n09', 'n10', 'n11'].map((id, i) => ({ id, role: i < 8 ? 'calm' : i < 10 ? 'frantic' : 'end', locked: i < 3 }));
const longer56 = () => ({ ...clips, n10: clips.n10 + 56.5 });
const commentary = [
  { id: 'n06', lines: ['A card can be set to go off when somebody says a particular phrase.', 'This trains players to choose their words carefully,', 'which, on a forum, we think is new.'] },
];
const tl = timeline(clips, map, { nodes });
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
  assert.deepEqual(blocks.map((b) => b.name), ['before the music', 'first block', 'second block', 'third block']);
  assert.equal(blocks.reduce((n, b) => n + b.count, 0), 5);
  const second = blocks.find((b) => b.name === 'second block');
  assert.ok(second.count >= 1 && second.median > 0);
});

/* ---- the committed list ---- */

test('the committed list is well formed: a take and a place for every row, only the fields the reader knows, and a coda that is an array', () => {
  const list = JSON.parse(readFileSync(new URL('../../instances/divided-world/ui/hype/cutlist.json', import.meta.url), 'utf8'));
  /* What it reads against, the film its own commentary makes, is the cut list's author's: its timing depends on the voice, which a build does not have. */
  assert.ok(Array.isArray(list.rows) && list.rows.length > 0);
  for (const r of list.rows) {
    assert.equal(typeof r.take, 'string', `a row names a take: ${JSON.stringify(r)}`);
    assert.ok((r.node === undefined) !== (r.statement === undefined), `a row is on a node or a statement: ${JSON.stringify(r)}`);
  }
  assert.ok(list.coda === undefined || Array.isArray(list.coda));
});

test('the committed list is cut for the v4 script: its nodes are the script`s, it uses only sharp takes, f-fold is cut once, on "Making games is hard!", and the coda is the five leaving posts then all five', async () => {
  const list = JSON.parse(readFileSync(new URL('../../instances/divided-world/ui/hype/cutlist.json', import.meta.url), 'utf8'));
  const { commentary: script } = await import(new URL('../../instances/divided-world/ui/hype/commentary.ts', import.meta.url).href);
  const ids = script.filter((n) => n.role !== 'end').map((n) => n.id);
  for (const r of list.rows.filter((x) => x.node !== undefined)) assert.ok(ids.includes(r.node), `${r.node} is not a node of the script (${ids.join(', ')}): ${JSON.stringify(r)}`);
  /* The half-density takes (c-n*, b-*, s-*) are soft; only the o-, g-, f- takes and c-title are sharp. */
  for (const r of [...list.rows, ...(list.coda ?? [])]) assert.match(r.take, /^(o|g|f)-[a-z0-9-]+$/u, `${r.take} is not one of the sharp takes`);
  const fold = list.rows.filter((r) => r.take === 'f-fold');
  assert.equal(fold.length, 1, 'f-fold is cut once in the whole film');
  assert.equal(fold[0].statement, 16, 'the fold is in the statement that holds "Making games is hard!"');
  assert.equal(fold[0].sync, 'open', 'the fold`s landing is pinned to the word');
  assert.equal(typeof fold[0].lead, 'number');
  assert.ok(!(list.coda ?? []).some((r) => r.take === 'f-fold'));
  for (const r of list.rows.filter((x) => x.sync !== undefined)) assert.equal(typeof r.expect, 'number', `a pinned landing names the frame it was written for: ${JSON.stringify(r)}`);
  const first = list.rows[0];
  assert.deepEqual([first.node, first.take, first.sync], ['v01', 'o-open', 'node-click'], 'the film opens on the click that starts the voice');
  const gpt2 = list.rows.find((r) => r.take === 'f-gpt2');
  assert.ok(gpt2 && gpt2.statement !== undefined && gpt2.statement >= 15, 'the You Were Saying? take is late in the montage');
  /* every statement the list cuts is cut whole */
  const beats = {};
  for (const r of list.rows.filter((x) => x.statement !== undefined)) beats[r.statement] = (beats[r.statement] ?? 0) + r.beats;
  for (const [n, sum] of Object.entries(beats)) assert.equal(sum, 16, `statement ${n} is cut in ${sum} beats`);
  assert.deepEqual(list.coda.map((r) => r.take), ['f-leave-1', 'f-leave-2', 'f-leave-3', 'f-leave-4', 'f-leave-5', 'f-leave-all']);
  /* the montage is the frantic half: it ends on the heap, and every whip is one the reader knows */
  const lastShot = list.rows.filter((r) => r.statement !== undefined).at(-1);
  assert.match(lastShot.take, /^f-heap-/u, 'the montage ends on the heap');
  for (const r of list.rows.filter((x) => x.cut !== undefined)) assert.match(r.cut, /^whip-(left|right|up|down)$/u);
});

test('a coda entry may say "hold": true, and then a take shorter than its chord gap is held on its last frame instead of refused', () => {
  const cuts = [{ start: 168.62, frames: 178, from: 0, take: 'c-n11' }];
  const short = { 'f-leave-2': { seconds: 1.8 } };
  assert.throws(() => directCoda(cuts, [{ take: 'f-leave-2', from: 0 }], short), /coda cut 1.*f-leave-2/);
  const out = directCoda(cuts, [{ take: 'f-leave-2', from: 0, hold: true }], short);
  assert.equal(out[0].take, 'f-leave-2');
  assert.equal(out[0].frames, 178);
  assert.throws(() => directCoda(cuts, [{ take: 'f-leave-2', from: 1.9, hold: true }], short), /coda cut 1.*starts after/);
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
  assert.throws(() => read(rows), /locked off/);
});

test('the lock-off is the data`s: a locked node refuses a move, and the next, unlocked, may carry one', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.05, y: 0.03, w: 0.9, roll: 0 }, ease: 'inOut' };
  const n4 = tl.nodes.find((n) => n.id === 'n04'), n3 = tl.nodes.find((n) => n.id === 'n03');
  const rows = [{ node: 'n01', take: 'c-n01' }, { node: 'n04', take: 'c-n05', move, punch: 8 }];
  const out = read(rows, { takes: { ...takes, 'c-n05': { seconds: 1000, landed: [], move: { ...move, ease: 'linear' }, punches: [{ frame: 0, percent: 5 }] } } });
  assert.deepEqual(out.shots[1].move, move, 'a row in node 4 has its move');
  assert.equal(out.shots[1].punch, 8);
  const own = read([rows[0], { node: 'n04', take: 'c-n05' }], { takes: { ...takes, 'c-n05': { seconds: 1000, landed: [], move } } });
  assert.deepEqual(own.shots[1].move, move, 'and a take`s own camera is applied there');
  assert.throws(() => read([rows[0], { node: 'n03', at: 0, take: 'c-n05', move }, rows[1]]), /locked off/);
  assert.equal(n3.end, n4.start);
});

test('the coda`s cuts can be directed: a take and a place in it for a chord, the rest left as they are, and what cannot be shot is refused', () => {
  const cuts = tl.nodes.find((n) => n.id === 'coda').cuts;
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
  assert.throws(() => directCoda(cuts, new Array(cuts.length + 1).fill(null), t), /one to a strike.*black begins on strike \d+.*at or after it/);
});

test('a synced landing must fall inside its shot: a next cut that comes before it is refused', () => {
  const rows = base();
  const word = wordTime(cues, 'n06', 'phrase') - tl.nodes.find((n) => n.id === 'n06').start;
  rows[2] = { node: 'n06', word: 'phrase', take: 'c-n06', sync: 'steel-chair', lead: 60 };
  assert.doesNotThrow(() => read(rows), 'a lead of a second is fine with no cut in it');
  assert.throws(() => read([...rows, { node: 'n06', at: word - 0.85, take: 'c-n05' }]), (/** @type {Error} */ e) => /steel-chair/.test(e.message) && /before it lands|next cut/.test(e.message));
});

test('a landing inside a directed coda cut is a hit at its frame of the film: the chair\'s hit in a coda cut plays its sound', () => {
  const cuts = [{ start: 168.62, frames: 178, from: 0, take: 'c-n11' }, { start: 171.59, frames: 57, from: 0, take: 'c-n11' }];
  const taken = { 'b-chair': { seconds: 5.15, landed: [{ what: 'throw', frame: 46 }, { what: 'hit', frame: 81 }] }, 's-quiz': { seconds: 2.1, landed: [{ what: 'press', frame: 49 }] } };
  const directed = directCoda(cuts, [{ take: 'b-chair', from: 0.55 }, { take: 's-quiz', from: 0 }], taken);
  const hits = codaHits(directed, taken);
  assert.deepEqual(hits.map((h) => [h.what, +h.at.toFixed(3)]), [['throw', +(168.62 + (46 - 33) / 60).toFixed(3)], ['hit', +(168.62 + (81 - 33) / 60).toFixed(3)], ['press', +(171.59 + 49 / 60).toFixed(3)]]);
  assert.deepEqual(codaHits(cuts, taken), [], 'a cut that names its own take (node 11) has none of these');
});

test('a row that syncs with no word and no time is on the first node`s VOICE: its lead is the whole lead, so the shot begins on the first frame and the click lands on the first word', () => {
  const clicks = { ...takes, 'c-n01': { seconds: 120, landed: [{ what: 'node-click', frame: 270 }] } };
  const out = read([{ node: 'n01', take: 'c-n01', sync: 'node-click', expect: 270 }, ...base().slice(1)], { takes: clicks });
  assert.equal(out.shots[0].startFrame, 0, 'the film begins on the first frame');
  near(out.shots[0].from, 0, 'at the take`s first frame: the take`s click is 270 frames (4.5 s) in');
  near(out.shots[0].start + 270 / F, tl.nodes[0].voice[0].start, 'and the click falls where the voice starts');
  assert.throws(() => read([{ node: 'n01', take: 'c-n01', sync: 'node-click' }, ...base().slice(1)], { takes: { ...takes, 'c-n01': { seconds: 120, landed: [{ what: 'node-click', frame: 100 }] } } }), /before the start of c-n01/);
});

test('rows in a frantic node with a move or punch are blurred by default, "blur": false refuses it, and "blur": true asks for it anywhere', () => {
  const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.1, y: 0.1, w: 0.8, roll: 0 }, ease: 'linear' };
  const rows = [{ node: 'n01', take: 'c-n01' }, { node: 'n05', take: 'c-n05', move }, { node: 'n09', take: 'c-n05', move }, { node: 'n09', at: 3, take: 'c-n05', punch: 8 }, { node: 'n09', at: 6, take: 'c-n05', move, blur: false }, { node: 'n10', take: 'c-n05' }, { node: 'n10', at: 2, take: 'c-n05', blur: true }];
  const out = read(rows);
  assert.deepEqual(out.shots.map((s) => s.blur ?? false), [false, false, true, true, false, false, true], 'calm: none; frantic with a move or a punch: yes; a still frantic one: no');
});

test('a row may begin with a whip: whip-left, -right, -up or -down, six frames unless cutFrames says; the first shot, a bad name and a shot too short for its whips are refused', () => {
  const rows = base();
  const out = read([rows[0], { ...rows[1], cut: 'whip-left' }, { ...rows[2], cut: 'whip-up', cutFrames: 8 }, rows[3], rows[4]]);
  assert.deepEqual(out.shots[1].whip, { dir: 'left', frames: 6 });
  assert.deepEqual(out.shots[2].whip, { dir: 'up', frames: 8 });
  assert.equal(out.shots[3].whip, undefined);
  assert.throws(() => read([{ ...rows[0], cut: 'whip-left' }, ...rows.slice(1)]), /first shot.*whip/);
  assert.throws(() => read([rows[0], { ...rows[1], cut: 'whip-diagonal' }, ...rows.slice(2)]), /whip-diagonal/);
  assert.throws(() => read([rows[0], { ...rows[1], cutFrames: 6 }, ...rows.slice(2)]), /cutFrames.*not a whip/);
  /* a shot of 18 frames cannot give half of two 20-frame whips and keep a frame of its own */
  assert.throws(() => read([rows[0], { node: 'n07', at: 0, take: 'c-n05', cut: 'whip-right', cutFrames: 20 }, { node: 'n07', at: 0.3, take: 'c-n05', cut: 'whip-left', cutFrames: 20 }]), /18 frames, but the whips at its ends take 20/);
});

test('the rows of a lengthened version`s repeated statement are named by `copy`; the first is copy 0', () => {
  const plus = timeline(longer56(), map, { nodes });
  assert.equal(plus.music.version, 'mk-plus1');
  const rows = [{ node: 'n01', take: 'c-n01' }, { statement: 2, copy: 1, beats: 16, take: 'c-n05' }, { statement: 2, beats: 16, take: 'c-n05' }];
  const out = resolveList({ rows }, { tl: plus, cues: captions(commentary, plus), takes });
  const twice = plus.music.statements.filter((s) => s.n === 2);
  assert.equal(twice.length, 2);
  assert.equal(out.shots[1].startFrame, Math.round(twice[0].start * F), 'copy 0 first');
  assert.equal(out.shots[2].startFrame, Math.round(twice[1].start * F));
  assert.throws(() => resolveList({ rows: [rows[0], { ...rows[1], copy: 2 }, rows[2]] }, { tl: plus, cues: [], takes }), /statement 2 \(repeat 2\)/);
});

test('the list cuts the narrated nodes only: the coda and the line over black are the edit`s', () => {
  assert.throws(() => read([{ node: 'n01', take: 'c-n01' }, { node: 'n11', take: 'c-n05' }]), /n11.*not a node the list cuts/);
  assert.throws(() => read([{ node: 'n01', take: 'c-n01' }, { node: 'coda', take: 'c-n05' }]), /coda.*not a node the list cuts/);
});
