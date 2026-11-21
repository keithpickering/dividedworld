/**
 * The windows: where each commentary node of parts two and three sits in the music, on a made-up map whose numbers are easy to see.
 * Block 1 runs 10 to 70 (statements every 10 s), block 2 70 to 100 (every 5), block 3 100 to 130 (every 5), the coda's chords sit at
 * 130, 132, 140, 141, 150 and the last chord ends at 155.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windows, fit, sheet, checkMap } from './windows.mjs';

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
const FRAME = 1 / 60;

test('the windows cover the music from the first note to the last chord with no gap and no overlap', () => {
  const w = windows(map, { fragments: 3 });
  assert.deepEqual(w.map((x) => x.id), ['n05', 'n06', 'n07', 'n08', 'n09', 'n10', 'n11']);
  assert.equal(w[0].start, 10);
  for (let i = 1; i < w.length; i++) assert.equal(w[i].start, w[i - 1].end, `${w[i].id} starts where ${w[i - 1].id} ends`);
  assert.equal(w.at(-1).end, 155);
});

test('fragments defaults to 3', () => {
  assert.equal(windows(map).at(-1).gaps.length, 3);
});

test('two nodes to a block, split by the shares: 50/50, 60/40 and 57/43 by default', () => {
  const w = windows(map);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  assert.deepEqual(w.slice(0, 4).map((x) => [x.start, x.end]), [[10, 40], [40, 70], [70, 88], [88, 100]]);
  close(w[4].end, 117.1);
  close(w[5].start, 117.1);
  assert.equal(w[0].length, 30);
  assert.deepEqual(windows(map, { shares: [[0.25, 0.75], [0.5, 0.5], [0.5, 0.5]] })[0].end, 25);
});

test('clips split a block in proportion to their lengths, and neither node gets under 35 percent of it', () => {
  const w = windows(map, { clips: { n05: 10, n06: 30, n07: 1, n08: 29 } });
  assert.equal(w[0].end, 31, 'n05: 10 of 40 is a quarter, which is raised to 35 percent of the block: 10 + 21');
  assert.equal(w[0].length, 21);
  assert.equal(w[1].length, 39);
  assert.equal(w[2].length, 10.5, 'n07 would be 1 of 30 and gets 35 percent of 30');
  const even = windows(map, { clips: { n09: 20, n10: 20 } });
  assert.equal(even[4].length, 15);
  const one = windows(map, { clips: { n09: 20 } });
  assert.ok(Math.abs(one[4].length - 17.1) < 1e-9, 'a block with one clip keeps the default shares');
});

test('each window and each node 11 gap says whether both its ends are measured', () => {
  const w = windows(map);
  assert.equal(w[0].confident, false, 'its split is derived');
  const m = structuredClone(map);
  const all = windows(m);
  assert.equal(all.at(-1).confident, true, 'n11 runs from a confident chord to a confident end');
  assert.deepEqual(all.at(-1).gaps.map((g) => g.confident), [true, true, true]);
  m.coda.chords[2].confident = false;
  const g = windows(m, { fragments: 4 }).at(-1).gaps;
  assert.deepEqual(g.map((x) => x.confident), [true, false, false, true]);
});

test('node 11 gets as many gaps as it has lines, the longest of the coda, in order', () => {
  const w = windows(map, { fragments: 3 });
  const gaps = w.at(-1).gaps;
  assert.equal(gaps.length, 3);
  assert.deepEqual(gaps.map((g) => [g.start, g.end, g.length]), [[130, 132, 2], [132, 140, 8], [141, 150, 9]]);
  assert.deepEqual(windows(map, { fragments: 1 }).at(-1).gaps.map((g) => g.length), [9]);
});

test('node 11 throws when the map has fewer coda gaps than it has lines', () => {
  assert.throws(() => windows(map, { fragments: 5 }), /n11.*5 lines.*4 gaps/);
});

test('a clip that fits returns its slack, and node 11 returns one slack a fragment', () => {
  const w = windows(map, { fragments: 3 });
  const slack = fit(w, { n05: 28.5, n07: 18, n11: [1.5, 7, 9] });
  assert.equal(slack.n05, 1.5);
  assert.equal(slack.n07, 0);
  assert.deepEqual(slack.n11, [{ slack: 0.5, cut: 0 }, { slack: 1, cut: 0 }, { slack: 0, cut: 0 }]);
  assert.equal('n06' in slack, false, 'a node with no clip has no slack');
});

test('a clip one frame too long throws, naming the node, the window and the overrun', () => {
  const w = windows(map, { fragments: 3 });
  assert.throws(() => fit(w, { n08: 12 + FRAME }), (/** @type {Error} */ e) => /n08/.test(e.message) && /12\.00 s/.test(e.message) && /0\.017 s/.test(e.message));
});

test('a line of node 11 that overruns its gap is cut off by the chord, not refused, and says how much', () => {
  const w = windows(map, { fragments: 3 });
  const out = /** @type {any} */ (fit(w, { n11: [1, 8, 9.5] }));
  assert.deepEqual(out.n11.map((x) => x.cut), [0, 0, 0.5]);
  assert.equal(out.n11[2].slack, 0);
});

test('a clip id that matches no window, and a wrong shape for node 11, throw plainly', () => {
  const w = windows(map);
  assert.throws(() => fit(w, { n99: 3 }), /n99.*no window/);
  assert.throws(() => fit(w, { n11: 3 }), /n11.*one length a line/);
  assert.throws(() => fit(w, { n05: [3] }), /n05.*one length/);
  assert.throws(() => fit(w, { n11: [1, 1, 1, 1] }), /n11.*3 gaps/);
});

test('the timing sheet lists every window and every gap', () => {
  const text = sheet(windows(map, { fragments: 3 }));
  for (const id of ['n05', 'n06', 'n07', 'n08', 'n09', 'n10', 'n11']) assert.match(text, new RegExp(id));
  assert.match(text, /n05\s+10\.00\s+40\.00\s+30\.00/);
  assert.match(text, /line 3/);
});

test('the timing sheet marks a window with an unsure or chosen end with a tilde', () => {
  const lines = sheet(windows(map)).split('\n');
  assert.match(lines.find((l) => l.startsWith('n05')), /~$/);
  assert.doesNotMatch(lines.find((l) => l.startsWith('n11')), /~/);
  assert.doesNotMatch(lines.find((l) => l.includes('line 1')), /~/);
});

test('fit refuses a clip length that is NaN, negative, infinite or not a number, naming the node', () => {
  const ws = windows(map, { fragments: 3 });
  for (const bad of [NaN, -1, Infinity, '5', null]) assert.throws(() => fit(ws, /** @type {any} */ ({ n05: bad })), /n05 has a clip length/, String(bad));
  assert.throws(() => fit(ws, { n11: [1, NaN, 2] }), /n11 has a clip length/);
  assert.throws(() => fit(ws, { n11: [1, -2, 2] }), /n11 has a clip length/);
  assert.doesNotThrow(() => fit(ws, { n05: 0, n11: [1, 2, 3] }));
});

test("a map whose first note is not block 1's start, or whose block 3 does not end on the first coda chord, is refused naming both times", () => {
  assert.doesNotThrow(() => checkMap(map));
  assert.throws(() => checkMap({ ...map, firstNote: { t: 10.5 } }), /first note \(10\.5\).*block 1 starts \(10\)/);
  assert.throws(() => checkMap({ ...map, blocks: [map.blocks[0], map.blocks[1], { ...map.blocks[2], end: 129 }] }), /block 3 ends at 129.*first coda chord \(130\)/);
});
