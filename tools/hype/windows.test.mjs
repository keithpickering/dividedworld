/**
 * The windows: where each commentary node of parts two and three sits in the music, on a made-up map whose numbers are easy to see.
 * Block 1 runs 10 to 70 (statements every 10 s), block 2 70 to 100 (every 5), block 3 100 to 130 (every 5), the coda's chords sit at
 * 130, 132, 140, 141, 150 and the last chord ends at 155.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windows, fit, sheet } from './windows.mjs';

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

test('two nodes to a block, split at the fourth statement', () => {
  const w = windows(map, { fragments: 3 });
  assert.deepEqual(w.slice(0, 6).map((x) => [x.start, x.end]), [[10, 40], [40, 70], [70, 85], [85, 100], [100, 115], [115, 130]]);
  assert.equal(w[0].length, 30);
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
  const slack = fit(w, { n05: 28.5, n07: 15, n11: [1.5, 7, 9] });
  assert.equal(slack.n05, 1.5);
  assert.equal(slack.n07, 0);
  assert.deepEqual(slack.n11, [0.5, 1, 0]);
  assert.equal('n06' in slack, false, 'a node with no clip has no slack');
});

test('a clip one frame too long throws, naming the node, the window and the overrun', () => {
  const w = windows(map, { fragments: 3 });
  assert.throws(() => fit(w, { n08: 15 + FRAME }), (/** @type {Error} */ e) => /n08/.test(e.message) && /15\.00 s/.test(e.message) && /0\.017 s/.test(e.message));
});

test('a line of node 11 that overruns its gap throws, naming the node and the line', () => {
  const w = windows(map, { fragments: 3 });
  assert.throws(() => fit(w, { n11: [1, 8, 9 + FRAME] }), (/** @type {Error} */ e) => /n11/.test(e.message) && /line 3/.test(e.message));
});

test('the timing sheet lists every window and every gap', () => {
  const text = sheet(windows(map, { fragments: 3 }));
  for (const id of ['n05', 'n06', 'n07', 'n08', 'n09', 'n10', 'n11']) assert.match(text, new RegExp(id));
  assert.match(text, /n05\s+10\.00\s+40\.00\s+30\.00/);
  assert.match(text, /line 3/);
});
