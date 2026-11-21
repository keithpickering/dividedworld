/**
 * Node 9's plays moved to the theme's entries (the plan's Task 8): `retime` is pure arithmetic on seconds. A landing is a play's second of
 * the take; an entry is a second of the node's window (from its start) where the theme enters; the stretches between are played faster or
 * slower, never past a third either way, and what cannot be placed is reported with by how much.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retime, MOST } from './retime.mjs';

const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);
const lands = (/** @type {number[]} */ ts) => ts.map((t, i) => ({ what: `play-${i}`, t }));

test('landings already on the entries play at speed 1, in every stretch', () => {
  const r = retime(lands([5, 10, 15]), [5, 10, 15], 20);
  assert.equal(r.stretches.length, 4, 'one stretch before each entry, and the one after the last');
  for (const s of r.stretches) near(s.speed, 1, 'speed');
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(r.placed.map((p) => p.at), [5, 10, 15]);
});

test('a landing 20% late is reached by playing the stretch before it 1.2 times faster, and the next stretch makes the time back', () => {
  const r = retime(lands([6, 10, 15]), [5, 10, 15], 20);
  near(r.stretches[0].speed, 1.2, 'the stretch to the first entry');
  near(r.stretches[1].speed, 0.8, 'the next one slows by the same take');
  near(r.stretches[2].speed, 1);
  assert.deepEqual(r.unplaced, []);
  near(r.placed[0].at, 5, 'the late landing now plays on its entry');
  near(r.stretches[0].take[1], 6, 'the stretch consumes 6 s of the take in 5 s of the film');
});

test('a landing that would need more than a third is reported, and its stretch clamped', () => {
  const r = retime(lands([8, 10, 15]), [5, 10, 15], 20);
  near(r.stretches[0].speed, 1 + MOST, 'clamped to a third faster');
  assert.equal(r.unplaced.length, 1);
  const u = r.unplaced[0];
  assert.equal(u.what, 'play-0');
  near(u.needed, 1.6, 'what it would have needed');
  near(u.speed, 4 / 3, 'what it got');
  near(u.late, 2, 'the stretch reaches only 6.67 s of the take by its entry, so the play falls 2 s after it (in the next stretch, at 7)');
  near(r.placed[0].at, 7);
});

test('a landing early by more than a third is clamped the other way', () => {
  const r = retime(lands([3, 10, 15]), [5, 10, 15], 20);
  near(r.stretches[0].speed, 1 - MOST, 'a third slower');
  near(r.unplaced[0].needed, 0.6);
  near(r.unplaced[0].late, 3 / (2 / 3) - 5, 'it plays half a second before its entry');
  assert.ok(r.unplaced[0].late < 0);
});

test('each entry takes a play near it, later than the one the entry before took; the other plays ride along, mapped by their stretch', () => {
  const ts = [1, 2.4, 3.8, 5.2, 6.6, 8, 9.4, 10.8, 12.2, 13.6, 15, 21];
  const r = retime(lands(ts), [5.8, 11.6, 17.4], 22);
  const anchors = r.stretches.slice(0, 3).map((s) => s.anchor);
  assert.ok(anchors.every(Boolean), 'every entry has a play');
  const idx = anchors.map((a) => ts.indexOf(a.t));
  assert.deepEqual([...idx].sort((p, q) => p - q), idx, 'in the plays order');
  assert.equal(new Set(idx).size, 3, 'no play twice');
  for (const s of r.stretches) assert.ok(s.speed >= 2 / 3 - 1e-9 && s.speed <= 4 / 3 + 1e-9);
  assert.deepEqual(r.unplaced, []);
  assert.equal(r.placed.length, 12);
  for (let i = 1; i < r.placed.length; i++) assert.ok(r.placed[i].at > r.placed[i - 1].at, 'plays keep their order');
  for (const [k, a] of anchors.entries()) near(r.placed[ts.indexOf(a.t)].at, [5.8, 11.6, 17.4][k], 'the play is on its entry');
});

test('the last play is brought inside the window, with a tail, rather than left to fall after the node ends', () => {
  /* At speed 1 the finale (take 23 s) would fall at 23 s of a 22 s window: the stretch after the last entry is sped up to bring it in. */
  const r = retime(lands([5, 10, 23]), [5, 10], 22);
  const finale = r.placed.at(-1);
  assert.ok(finale.at <= 22 - 1 + 1e-9, `the finale falls at ${finale.at}`);
  assert.ok(r.stretches.at(-1).speed > 1);
});

test('with fewer landings than entries the stretch has no anchor and plays at speed 1; no entries is no change', () => {
  const r = retime(lands([5]), [5, 10], 20);
  near(r.stretches[1].speed, 1);
  assert.equal(r.stretches[1].anchor, undefined);
  const none = retime(lands([5, 7]), [], 20);
  assert.equal(none.stretches.length, 1);
  near(none.stretches[0].speed, 1);
  assert.deepEqual(none.placed.map((p) => p.at), [5, 7]);
});

test('the stretches tile the window with no gap, and the take is continuous across them', () => {
  const r = retime(lands([6, 10.5, 14]), [5, 10, 15], 20);
  assert.equal(r.stretches[0].out[0], 0);
  assert.equal(r.stretches.at(-1).out[1], 20);
  for (let i = 1; i < r.stretches.length; i++) { near(r.stretches[i].out[0], r.stretches[i - 1].out[1]); near(r.stretches[i].take[0], r.stretches[i - 1].take[1]); }
});
