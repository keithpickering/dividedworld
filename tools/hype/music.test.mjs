/**
 * The measured recording and its shortened versions (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R1), on the committed
 * `music-map.json` and on made-up maps for what only a made-up map can show.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionMap, beats, expectedSeconds, codaGaps, VERSIONS } from './music.mjs';
import { madeUp } from './made-up.mjs';

const map = JSON.parse(readFileSync(new URL('../../instances/divided-world/ui/hype/music-map.json', import.meta.url), 'utf8'));
const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ tol, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('the committed map has eighteen statements of sixteen beats, six to a block, ascending, each ending where the next begins', () => {
  assert.equal(map.statements.length, 18);
  map.statements.forEach((s, i) => {
    assert.equal(s.n, i + 1);
    assert.equal(s.beats, 16);
    assert.equal(s.block, 1 + Math.floor(i / 6));
    assert.equal(typeof s.confident, 'boolean');
    if (i) {
      assert.ok(s.start > map.statements[i - 1].start, `statement ${s.n} starts after statement ${s.n - 1}`);
      near(map.statements[i - 1].start + map.statements[i - 1].length, s.start, 0.002, `statement ${s.n - 1} ends where ${s.n} begins:`);
    }
  });
  assert.ok(map.drone.end <= map.statements[0].start + 1e-9, 'the drone ends where the theme begins');
  assert.ok(map.coda.chords[0].t > map.statements[17].start + map.statements[17].length, 'the coda follows the last statement');
});

test('every version removes statements from block 1 only, and its map keeps the rest, ascending and contiguous', () => {
  assert.deepEqual(VERSIONS, ['full', 'mk-a', 'mk-b']);
  for (const name of VERSIONS) {
    const v = versionMap(map, name);
    const ns = v.statements.map((/** @type {{ n: number }} */ s) => s.n);
    for (const s of map.statements.filter((s) => s.block > 1)) assert.ok(ns.includes(s.n), `${name} keeps statement ${s.n}`);
    assert.equal(ns[0], 1, `${name} keeps the first statement`);
    v.statements.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      if (!i) return;
      assert.ok(s.start > v.statements[i - 1].start, `${name}: starts ascend`);
      near(v.statements[i - 1].start + v.statements[i - 1].length, s.start, 0.002, `${name}: statement ${v.statements[i - 1].n} ends where ${s.n} begins:`);
    });
  }
  assert.deepEqual(versionMap(map, 'mk-a').statements.map((/** @type {{ n: number }} */ s) => s.n).slice(0, 3), [1, 4, 5]);
  assert.deepEqual(versionMap(map, 'mk-b').statements.map((/** @type {{ n: number }} */ s) => s.n).slice(0, 3), [1, 6, 7]);
});

test('a version is shifted by what its join removes: its length, its coda and its later statements', () => {
  const b = versionMap(map, 'mk-b'), recipe = map.versions['mk-b'];
  const removed = recipe.join.to - recipe.join.from;
  near(b.seconds, map.seconds - removed, 1e-9, 'length');
  assert.equal(expectedSeconds(map, 'mk-b'), b.seconds);
  assert.equal(expectedSeconds(map, 'full'), map.seconds);
  near(b.seconds, 118.395, 0.01, "the analysis's mk-B");
  near(versionMap(map, 'mk-a').seconds, 136.364, 0.02, "the analysis's mk-A");
  const s7 = b.statements.find((/** @type {{ n: number }} */ s) => s.n === 7), o7 = map.statements[6];
  near(s7.start, o7.start - removed, 1e-9, 'statement 7');
  near(b.coda.chords[0].t, map.coda.chords[0].t - removed, 1e-9, 'first chord');
  near(b.coda.end.t, map.coda.end.t - removed, 1e-9, 'final chord end');
  near(b.drone.end, map.drone.end, 1e-9, 'the drone is before the join');
  near(removed, map.statements[5].start - map.statements[1].start, 0.02, 'what is removed is statements 2 to 5');
  assert.equal(b.joins.length, 1);
  near(b.joins[0].t, recipe.join.from, 1e-9, 'the join in the output is where the first part ends');
  assert.deepEqual(versionMap(map, 'full').joins, []);
  assert.equal(versionMap(map, 'full').statements.length, 18);
});

test('beats: sixteen to a statement, evenly within it, ascending', () => {
  for (const [name, kept] of /** @type {[string, number][]} */ ([['full', 18], ['mk-a', 16], ['mk-b', 14]])) {
    const bs = beats(map, name);
    assert.equal(bs.length, 16 * kept, name);
    for (let i = 1; i < bs.length; i++) assert.ok(bs[i] > bs[i - 1], `${name}: beat ${i} after ${i - 1}`);
  }
  const bs = beats(map, 'full'), s = map.statements[0];
  near(bs[0], s.start, 1e-9, 'the first beat is the first statement');
  near(bs[1] - bs[0], s.length / 16, 1e-9, 'a beat');
  near(bs[16], map.statements[1].start, 1e-9, 'the seventeenth beat begins statement 2');
});

test('a recipe that removes from block 2 or 3, or an unknown version, is refused', () => {
  const bad = structuredClone(map);
  bad.versions['mk-x'] = { remove: [7, 8], join: { from: 58, to: 74 }, crossfadeMs: 40 };
  assert.throws(() => versionMap(bad, 'mk-x'), /block 1/);
  assert.throws(() => versionMap(map, 'mk-z'), /mk-z/);
  const gone = structuredClone(map);
  gone.versions['mk-a'].remove = [1, 3];
  assert.throws(() => versionMap(gone, 'mk-a'), /statement 1|first/);
});

test('the coda`s gaps: the longest three, in the order they come, each with its length; fewer gaps than lines is refused', () => {
  const v = versionMap(madeUp(), 'full');
  const gaps = codaGaps(v, 3);
  assert.deepEqual(gaps.map((g) => [g.start, g.end, g.length]), [[130, 132, 2], [132, 140, 8], [141, 150, 9]]);
  assert.deepEqual(codaGaps(v, 1).map((g) => g.start), [141], 'the longest alone');
  assert.deepEqual(codaGaps(versionMap(madeUp(), 'mk-b'), 3).map((g) => g.start), [90, 92, 101], 'a version`s gaps are shifted');
  assert.throws(() => codaGaps(v, 5), /5 lines.*4 gaps/);
});

test('the committed map`s coda has gaps for the three lines of node 11, in every version', () => {
  for (const name of VERSIONS) assert.equal(codaGaps(versionMap(map, name), 3).length, 3, name);
});
