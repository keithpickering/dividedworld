/**
 * music-cut.mjs's pure parts: the ffmpeg filter a recipe makes, and the refusal when the file it made is not the recipe's length.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutFilter, checkLength } from './music-cut.mjs';

const recipe = { remove: [2, 5], join: { from: 13.408, to: 49.103583 }, crossfadeMs: 40 };

test('the filter plays the recording to the join, crossfades into it at the join`s other end, equal power, and plays on', () => {
  const f = cutFilter(recipe, 48000);
  assert.match(f, /atrim=start_sample=0:end_sample=643584\b/, 'the first part ends at 13.408 s');
  assert.match(f, /atrim=start_sample=2355052\b/, 'the second begins a crossfade before 49.103583 s: 49.0636 s is sample 2355052 (49.103583 s is the analysis`s 2356972)');
  assert.match(f, /acrossfade=d=0\.04[0-9]*:c1=qsin:c2=qsin/);
  assert.match(f, /asetpts=PTS-STARTPTS/, 'each part restarts its clock');
  assert.doesNotMatch(f, /atempo|rubberband|volume|afade/, 'no stretch, no gain: the recording is played as it is');
});

test('a file whose length is not the recipe`s to 5 ms is refused, naming both', () => {
  assert.doesNotThrow(() => checkLength(118.395, 118.3954));
  assert.doesNotThrow(() => checkLength(118.399, 118.395), '4 ms over is allowed');
  assert.throws(() => checkLength(118.402, 118.395, 'mk-b'), (/** @type {Error} */ e) => /mk-b/.test(e.message) && /118\.402/.test(e.message) && /118\.395/.test(e.message));
  assert.throws(() => checkLength(118.389, 118.395), /118\.389/);
});
