/**
 * The measured recording and its shortened versions (docs/plans/2026-11-21-commentary-video-revision-plan.md, Task R1), on the committed
 * `music-map.json` and on made-up maps for what only a made-up map can show.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionMap, beats, expectedSeconds, titleStrikes, VERSIONS } from './music.mjs';
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
  assert.deepEqual(VERSIONS, ['full', 'mk-a', 'mk-b', 'mk-plus1', 'mk-plus2', 'mk-plus3']);
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
  for (const [name, kept] of /** @type {[string, number][]} */ ([['full', 18], ['mk-a', 16], ['mk-b', 14], ['mk-plus1', 20], ['mk-plus3', 24]])) {
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

test('the title`s strikes: the coda`s last two chords, and the first chord; a coda of fewer than three chords is refused', () => {
  const v = versionMap(madeUp(), 'full');
  assert.deepEqual(titleStrikes(v), { first: 130, title: 141, final: 150, end: 155 });
  assert.deepEqual(titleStrikes(versionMap(madeUp(), 'mk-b')), { first: 90, title: 101, final: 110, end: 115 }, 'a version`s are shifted');
  const short = structuredClone(v);
  short.coda.chords = short.coda.chords.slice(0, 2);
  assert.throws(() => titleStrikes(short), /3 chords|two strikes/);
});

test('the committed map`s coda has the title`s two strikes after its first chord, in every version', () => {
  for (const name of VERSIONS) { const t = titleStrikes(versionMap(map, name)); assert.ok(t.first < t.title && t.title < t.final && t.final < t.end, name); }
});

test('a LENGTHENED version repeats a pair of block 1: statements 2 and 3 again, after 3, `times` times, every later time later by what is added', () => {
  const r = map.versions['mk-plus2'], loop = r.join.out - r.join.in;
  assert.deepEqual(r.repeat, [2, 3]);
  assert.equal(r.times, 2);
  near(loop, map.statements[3].start - map.statements[1].start, 0.002, 'a loop is statements 2 and 3');
  for (const [name, times] of /** @type {[string, number][]} */ ([['mk-plus1', 1], ['mk-plus2', 2], ['mk-plus3', 3]])) {
    const v = versionMap(map, name), added = times * loop;
    assert.deepEqual(v.statements.map((/** @type {{ n: number }} */ s) => s.n).slice(0, 4 + 2 * times), [1, ...Array.from({ length: times + 1 }).flatMap(() => [2, 3]), 4], name);
    assert.equal(v.statements.length, 18 + 2 * times, name);
    near(v.seconds, map.seconds + added, 1e-9, `${name}: length`);
    assert.equal(expectedSeconds(map, name), v.seconds);
    near(v.coda.chords[0].t, map.coda.chords[0].t + added, 1e-9, `${name}: first chord`);
    near(v.statements.find((/** @type {{ n: number }} */ s) => s.n === 7).start, map.statements[6].start + added, 1e-9, `${name}: statement 7`);
    const copies = v.statements.filter((/** @type {{ n: number }} */ s) => s.n === 2);
    assert.deepEqual(copies.map((/** @type {{ copy: number }} */ s) => s.copy), Array.from({ length: times + 1 }, (_, k) => k), 'copy 0 is the original');
    near(copies[1].start, map.statements[1].start + loop, 1e-9, `${name}: the repeat of statement 2`);
    v.statements.forEach((/** @type {any} */ s, /** @type {number} */ i) => { if (i) near(v.statements[i - 1].start + v.statements[i - 1].length, s.start, 0.002, `${name}: ${s.n} follows`); });
    assert.equal(v.joins.length, times, `${name}: a join for each repeat`);
    near(v.joins[0].t, r.join.out, 1e-9);
    near(v.joins.at(-1).t, r.join.out + (times - 1) * loop, 1e-9);
  }
});

test('a repeat that begins in block 2, repeats nothing, or starts at statement 1 is refused', () => {
  const bad = structuredClone(map);
  bad.versions['mk-x'] = { repeat: [7, 8], times: 1, join: { out: 74, in: 58 }, crossfadeMs: 40 };
  assert.throws(() => versionMap(bad, 'mk-x'), /block 1/);
  bad.versions['mk-x'] = { repeat: [2, 3], times: 0, join: { out: 31, in: 13 }, crossfadeMs: 40 };
  assert.throws(() => versionMap(bad, 'mk-x'), /times/);
  bad.versions['mk-x'] = { repeat: [1, 3], times: 1, join: { out: 31, in: 4 }, crossfadeMs: 40 };
  assert.throws(() => versionMap(bad, 'mk-x'), /first|statement 1/);
});
