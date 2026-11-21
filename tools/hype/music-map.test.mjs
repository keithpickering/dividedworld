/**
 * The music map's detectors, on envelopes made up to have the recording's shape: silence, a quiet block of low strings, the violins
 * stepping up (the high band), a long crescendo to the full orchestra, a plateau, and a coda of hammered chords that each fall away.
 * The times below are the ones the made-up envelopes were built with.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFromEnvelopes } from './music-map.mjs';

const HOP = 0.05, CHORDS = [131, 133, 137, 138, 144];
const at = (/** @type {number} */ t) => Math.round(t / HOP);
const FRAMES = at(150);
const db = Array.from({ length: FRAMES }, (_, i) => {
  const t = i * HOP;
  if (t < 2) return 0;
  if (t < 60) return 45;
  if (t < 100) return 50 + ((t - 60) / 40) * 15;
  if (t < 102) return 65 + ((t - 100) / 2) * 10;
  let level = 75;
  if (t >= 129.5) {
    const last = CHORDS.filter((c) => c <= t).at(-1);
    level = last === undefined ? 50 : last === 144 ? Math.max(0, 78 - 25 * (t - 144)) : Math.max(48, 78 - 25 * (t - last));
  }
  return level;
});
const hb = Array.from({ length: FRAMES }, (_, i) => (i * HOP < 64 ? 20 : 44));
const map = mapFromEnvelopes({ db, hb, hop: HOP });

test('the first note is where the sound first rises out of silence', () => {
  assert.equal(map.firstNote.t, 2);
  assert.equal(map.firstNote.confident, true);
});

test('block 2 begins where the high band steps up, and is not claimed with confidence', () => {
  assert.ok(Math.abs(map.blocks[1].start - 64) <= HOP, `block 2 at ${map.blocks[1].start}`);
  assert.equal(map.blocks[1].confident, false);
  assert.equal(map.blocks[0].end, map.blocks[1].start);
});

test('the tutti entrance is where the crescendo reaches the full orchestra', () => {
  const t = map.blocks[2].start;
  assert.ok(t >= 100 && t <= 102, `tutti at ${t}`);
  assert.equal(map.blocks[1].end, t);
});

test('the coda has each hammered chord, and its first chord ends block 3', () => {
  assert.deepEqual(map.coda.chords.map((c) => Math.round(c.t)), CHORDS);
  assert.equal(map.blocks[2].end, map.coda.chords[0].t);
});

test('the final chord ends where it has fallen thirty-five decibels', () => {
  assert.ok(map.coda.end.t > 144 && map.coda.end.t < 148, `end at ${map.coda.end.t}`);
});

test('each block has six statements of the theme, dividing it evenly, marked derived and unsure', () => {
  assert.equal(map.blocks.length, 3);
  for (const b of map.blocks) {
    assert.equal(b.entries.length, 6);
    assert.equal(b.entries[0].t, b.start);
    const step = (b.end - b.start) / 6;
    b.entries.forEach((e, i) => { assert.ok(Math.abs(e.t - (b.start + i * step)) < 1e-9); assert.equal(e.confident, false); assert.equal(e.derived, true); });
  }
});
