/** A Whoops! ink's name in words, for the plate's readout: the table's two-stage OKLCh rule (see names.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkName, oklch, SWATCHES } from './names.ts';

test('a swatch\'s ink is called by the swatch\'s name, lowercased for the sentence', () => {
  assert.deepEqual(SWATCHES.map((s) => inkName(s.color)), ['magenta', 'cyan', 'yellow', 'green', 'orange', 'violet']);
  assert.equal(inkName('#FFD93D'), 'yellow');
});

test('an ink off the swatches is called by the swatch nearest it in OKLCh hue, lightness at half', () => {
  assert.equal(inkName('#ffe066'), 'yellow');
  assert.equal(inkName('#0080ff'), 'violet');
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
  /* Pale enough to be below the chroma gate: nearest neutral by lightness. (#97's dark pre-check is gone: #112233 has chroma .04, so it is cyan.) */
  assert.equal(inkName('#fff0f0'), 'white');
  assert.equal(inkName('not a color'), 'ink');
});

/* The ink names' second rule (marks and the lens, design section 6): the table is the swatches plus the neutrals, each
   entry classed by its own chroma in OKLCh, so a swatch added later names its own family without code naming one. */
const NEUTRALS = [
  { name: 'Black', color: '#000000' },
  { name: 'White', color: '#ffffff' },
  { name: 'Gray', color: '#808080' },
] as const;
const SHIPPED = [...SWATCHES, ...NEUTRALS];
const WITH_BROWN = [...SHIPPED, { name: 'Brown', color: '#7a4a24' }];
const WITH_SILVER = [...SHIPPED, { name: 'Silver', color: '#c0c0c0' }];

test('each swatch and each neutral names itself', () => {
  assert.deepEqual(SHIPPED.map((s) => inkName(s.color, SHIPPED)), ['magenta', 'cyan', 'yellow', 'green', 'orange', 'violet', 'black', 'white', 'gray']);
});

test('with the table as it ships, dark oranges are orange and a dark green is green', () => {
  for (const c of ['#6b4423', '#c08040', '#3b2a1e']) assert.equal(inkName(c, SHIPPED), 'orange', c);
  assert.equal(inkName('#004400', SHIPPED), 'green');
  assert.equal(inkName('#0000ff', SHIPPED), 'violet');
  assert.equal(inkName('#202020', SHIPPED), 'black');
  assert.equal(inkName('#7f7f90', SHIPPED), 'gray');
  assert.equal(inkName('#a0a0a0', SHIPPED), 'gray');
  assert.equal(inkName('#e0e0e0', SHIPPED), 'white');
  assert.equal(inkName('violet', SHIPPED), 'violet');
});

test('a Brown added to the table wins the dark oranges and nothing else', () => {
  for (const c of ['#3b2a1e', '#4a3020', '#6b4423', '#806040', '#8b5a2b']) assert.equal(inkName(c, WITH_BROWN), 'brown', c);
  assert.equal(inkName('#c08040', WITH_BROWN), 'orange');
  assert.equal(inkName('#004400', WITH_BROWN), 'green');
  assert.equal(inkName('#202020', WITH_BROWN), 'black');
});

test('a Silver added to the table is neutral, so it competes with gray', () => {
  assert.equal(inkName('#a0a0a0', WITH_SILVER), 'silver');
  assert.equal(inkName('#0000ff', WITH_SILVER), 'violet');
});

test('the OKLab conversion matches known values', () => {
  const near = (a: number, b: number, eps: number, what: string) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
  const white = oklch('#ffffff');
  near(white.L, 1, 1e-3, 'white L');
  near(white.C, 0, 1e-3, 'white C');
  const black = oklch('#000000');
  near(black.L, 0, 1e-6, 'black L');
  near(black.C, 0, 1e-6, 'black C');
  const red = oklch('#ff0000');
  near(red.L, 0.628, 2e-3, 'red L');
  near(red.C, 0.2577, 2e-3, 'red C');
  near(red.h, 29.23, 0.1, 'red h');
  const blue = oklch('#0000ff');
  near(blue.L, 0.452, 2e-3, 'blue L');
  near(blue.C, 0.313, 2e-3, 'blue C');
  near(blue.h, 264.05, 0.1, 'blue h');
});
