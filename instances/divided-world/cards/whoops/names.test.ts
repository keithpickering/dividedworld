/** A Whoops! ink's name in words, for the plate's readout: the play form's swatch, else the swatch nearest it in hue. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkName, SWATCHES } from './names.ts';

test('a swatch\'s ink is called by the swatch\'s name, lowercased for the sentence', () => {
  assert.deepEqual(SWATCHES.map((s) => inkName(s.color)), ['magenta', 'cyan', 'yellow', 'green', 'orange', 'violet']);
  assert.equal(inkName('#FFD93D'), 'yellow');
});

test('an ink off the swatches is called by the swatch nearest it in hue', () => {
  assert.equal(inkName('#ffe066'), 'yellow');
  assert.equal(inkName('#0080ff'), 'cyan');
  assert.equal(inkName('#ff0080'), 'magenta');
  assert.equal(inkName('#1980e6'), 'cyan');
  assert.equal(inkName('#00ff40'), 'green');
  assert.equal(inkName('#ff6600'), 'orange');
  assert.equal(inkName('#7700ff'), 'violet');
});

test('an ink the player named is called by that name, never another\'s', () => {
  assert.equal(inkName('violet'), 'violet');
  assert.equal(inkName('Red'), 'red');
  assert.equal(inkName('teal'), 'teal');
});

test('an ink with no hue is called by its lightness, and one it cannot read is called ink, never a hex code', () => {
  assert.equal(inkName('#101010'), 'black');
  assert.equal(inkName('white'), 'white');
  assert.equal(inkName('#808080'), 'gray');
  /* Dark or pale enough that a hue would name a color the eye does not see. */
  assert.equal(inkName('#112233'), 'black');
  assert.equal(inkName('#fff0f0'), 'white');
  assert.equal(inkName('not a color'), 'ink');
});
