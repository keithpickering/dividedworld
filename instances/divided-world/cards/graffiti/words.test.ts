/**
 * Graffiti's words (plan Task 10; design sections 8, 9 and 11): the names the toolbar gives its cans, caps, stencils and spots, and the plain
 * words a drawing is described in for the Lens and the log, from the Act's public payload alone (the colors and the stencil are on the Act; no
 * owner, no class). The glass's voice: plain, true, American English.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANS, CAPS } from '../graffiti.ts';
import { STENCIL_KEYS } from './stencils.ts';
import { CAN_NAMES, CAP_NAMES, SPOT_NAMES, STENCIL_NAMES, LOG_DRAW, LOG_WASH, describeDraw } from './words.ts';

const stroke = (can: string) => ({ can, cap: 'stock', aspect: 1.5, points: [[0.1, 0.1], [0.2, 0.2]] });

test('every can is named by its color, every cap by its cap, every stencil by what it is, and the nine spots from Top left to Bottom right', () => {
  assert.deepEqual(Object.keys(CAN_NAMES), Object.keys(CANS));
  assert.deepEqual(Object.values(CAN_NAMES), ['Black', 'White', 'Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Teal', 'Cyan', 'Blue', 'Purple', 'Pink', 'Brown', 'Silver']);
  assert.deepEqual(CAP_NAMES, { skinny: 'Skinny', stock: 'Stock', fat: 'Fat' });
  assert.deepEqual(Object.keys(CAP_NAMES), Object.keys(CAPS));
  assert.deepEqual(Object.keys(STENCIL_NAMES), [...STENCIL_KEYS]);
  assert.deepEqual(Object.values(STENCIL_NAMES), ['Mustache', 'Horns', 'Crown', 'Kilroy was here', 'Big X', 'Smiley']);
  assert.equal(SPOT_NAMES.length, 9);
  assert.equal(SPOT_NAMES[0], 'Top left');
  assert.equal(SPOT_NAMES[4], 'Middle center');
  assert.equal(SPOT_NAMES[8], 'Bottom right');
});

test('a drawing is described by its colors, once each, in the order they were first used', () => {
  assert.equal(describeDraw({ strokes: [stroke('pink')] }), 'pink');
  assert.equal(describeDraw({ strokes: [stroke('pink'), stroke('lime'), stroke('pink')] }), 'pink and lime');
  assert.equal(describeDraw({ strokes: [stroke('red'), stroke('lime'), stroke('blue'), stroke('red')] }), 'red, lime and blue');
});

test('a stencil is described by what it is and its color', () => {
  assert.equal(describeDraw({ stencil: 'crown', can: 'pink', spot: 1, strokes: [stroke('pink')] }), 'a crown in pink');
  assert.equal(describeDraw({ stencil: 'kilroy', can: 'red', spot: 4, strokes: [] }), 'Kilroy was here in red');
  assert.equal(describeDraw({ stencil: 'x', can: 'black', spot: 4, strokes: [] }), 'a big X in black');
});

test('a payload it cannot read is described as a tag and nothing more, and never throws', () => {
  for (const bad of [null, undefined, 4, 'x', {}, { strokes: 'no' }, { strokes: [null, { can: 'chartreuse' }] }, { stencil: 'gone', can: 'red' }]) assert.equal(describeDraw(bad), 'a tag');
});

test('the log says a draw tagged and a wash washed, of the wall', () => {
  assert.deepEqual(LOG_DRAW, { verb: 'tagged', noun: 'tag', nouns: 'tags', surface: 'the wall' });
  assert.deepEqual(LOG_WASH, { verb: 'washed' });
});
