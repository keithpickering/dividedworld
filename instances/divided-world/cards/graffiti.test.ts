/**
 * Graffiti's own rules: its draws, its washes, its stencils and their bounds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANS, CAPS, graffiti } from './graffiti.ts';
import { STENCILS } from './graffiti/stencils.ts';
import { GRID, cellsOf, count, type Cells } from '../../../engine/rules/surface.ts';
import { seenOf, surf } from './test-kit.ts';

/* Graffiti (docs/plans/2026-11-11-graffiti-plan.md, Task 7). */
const draw = (input: unknown) => surf.validateDraw(input);
const wash = (input: unknown) => surf.validateWash(input);
const covered = (cells: Cells, x: number, y: number) => (cells[(y * GRID + x) >> 3]! & (0x80 >> ((y * GRID + x) & 7))) !== 0;
const stroke = (over: Record<string, unknown> = {}) => ({ can: 'red', cap: 'stock', aspect: 1.5, points: [[0.1, 0.2], [0.3, 0.4]], ...over });
const strokesOf = (v: ReturnType<typeof draw>) => { assert.equal(v.ok, true, JSON.stringify(v)); return v.ok ? v.value.strokes : []; };
const STENCIL_KEYS_FOR_TEST = ['mustache', 'horns', 'crown', 'kilroy', 'x', 'smiley'] as const;
const STENCIL_KEYS = ['mustache', 'horns', 'crown', 'kilroy', 'x', 'smiley'] as const;

test('Graffiti: a draw keeps a stroke\'s can and cap and drops a sent width; the engine gets the cap\'s width', () => {
  const v = draw({ strokes: [stroke({ width: 0.9, aspect: 1.23456 })] });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.deepEqual(v.value.payload, { strokes: [{ can: 'red', cap: 'stock', aspect: 1.23, points: [[0.1, 0.2], [0.3, 0.4]] }] });
  assert.deepEqual(v.value.strokes, [{ width: CAPS.stock, aspect: 1.23, points: [[0.1, 0.2], [0.3, 0.4]] }]);
});

test('Graffiti: an unknown can or cap is refused, and the refusal lists the cans', () => {
  const v = draw({ strokes: [stroke({ can: 'chartreuse' })] });
  assert.equal(v.ok, false);
  for (const can of Object.keys(CANS)) assert.match(!v.ok ? v.why : '', new RegExp(can));
  assert.equal(draw({ strokes: [stroke({ cap: 'huge' })] }).ok, false);
});

test('Graffiti: a draw has at most 120 strokes, 300 points a stroke and 3,000 points in all', () => {
  assert.equal(draw({ strokes: Array.from({ length: 120 }, () => stroke()) }).ok, true);
  assert.equal(draw({ strokes: Array.from({ length: 121 }, () => stroke()) }).ok, false);
  assert.equal(draw({ strokes: [] }).ok, false, 'a draw with no stroke is nothing');
  assert.equal(draw({ strokes: [stroke({ points: Array(300).fill([0.5, 0.5]) })] }).ok, true);
  assert.equal(draw({ strokes: [stroke({ points: Array(301).fill([0.5, 0.5]) })] }).ok, false);
  assert.equal(draw({ strokes: Array.from({ length: 10 }, () => stroke({ points: Array(300).fill([0.5, 0.5]) })) }).ok, true);
  assert.equal(draw({ strokes: [...Array.from({ length: 10 }, () => stroke({ points: Array(300).fill([0.5, 0.5]) })), stroke()] }).ok, false);
  assert.equal(wash({ strokes: Array.from({ length: 121 }, () => ({ aspect: 1, points: [[0, 0]] })) }).ok, false, 'a wash has the same bounds');
});

test('Graffiti: a point outside 0 to 1 is refused, and points are kept to a ten-thousandth', () => {
  for (const p of [[1.0001, 0.5], [0.5, -0.0001], [0.5, 1.5], [NaN, 0.5]]) assert.equal(draw({ strokes: [stroke({ points: [p] })] }).ok, false, JSON.stringify(p));
  assert.equal(draw({ strokes: [stroke({ points: [[0.5], [0.5, 0.5]] })] }).ok, false);
  assert.equal(draw({ strokes: [stroke({ points: [] })] }).ok, false);
  assert.equal(draw({ strokes: [stroke({ aspect: 0 })] }).ok, false);
  assert.equal(draw({ strokes: [stroke({ aspect: 'wide' })] }).ok, false);
  assert.deepEqual(strokesOf(draw({ strokes: [stroke({ points: [[0.123456, 1]] })] }))[0]!.points, [[0.1235, 1]]);
});

test('Graffiti: a stencil expands to strokes inside its spot, in the can named, at aspect 1', () => {
  assert.deepEqual(Object.keys(STENCILS).sort(), [...STENCIL_KEYS].sort());
  for (const key of STENCIL_KEYS) for (let spot = 0; spot < 9; spot++) {
    const v = draw({ stencil: key, can: 'teal', spot });
    assert.equal(v.ok, true, `${key} ${spot}`);
    if (!v.ok) continue;
    const [col, row] = [spot % 3, Math.floor(spot / 3)];
    assert.ok(v.value.strokes.length >= 1 && v.value.strokes.length <= 120, `${key}: ${v.value.strokes.length} strokes`);
    for (const s of v.value.strokes) {
      assert.equal(s.aspect, 1);
      for (const [x, y] of s.points) assert.ok(x >= col / 3 - 1e-4 && x <= (col + 1) / 3 + 1e-4 && y >= row / 3 - 1e-4 && y <= (row + 1) / 3 + 1e-4, `${key} ${spot}: ${x},${y}`);
    }
    const payload = v.value.payload as { stencil: string; can: string; spot: number; strokes: { can: string; cap: string }[] };
    assert.deepEqual([payload.stencil, payload.can, payload.spot], [key, 'teal', spot]);
    assert.ok(payload.strokes.every((s) => s.can === 'teal' && s.cap in CAPS));
  }
});

test('Graffiti: stencil x at spot 4 covers the center cell, and each stencil at spot 4 covers under 12% of the grid', () => {
  const x = draw({ stencil: 'x', can: 'black', spot: 4 });
  assert.equal(covered(cellsOf(x.ok ? x.value.strokes : []), 50, 50), true);
  assert.equal(covered(cellsOf(x.ok ? x.value.strokes : []), 5, 5), false);
  for (const key of STENCIL_KEYS) {
    const v = draw({ stencil: key, can: 'black', spot: 4 });
    const n = count(cellsOf(v.ok ? v.value.strokes : []));
    assert.ok(n > 30 && n < 1200, `${key} covers ${n} cells`);
  }
});

test('Graffiti: a stencil draw is a stencil with a known key, a can and a spot 0 to 8, and not also strokes', () => {
  for (const bad of [{ stencil: 'nope', can: 'red', spot: 0 }, { stencil: 'x', can: 'nope', spot: 0 }, { stencil: 'x', can: 'red', spot: 9 }, { stencil: 'x', can: 'red', spot: -1 }, { stencil: 'x', can: 'red', spot: 1.5 }, { stencil: 'x', can: 'red' }, { stencil: 'x', can: 'red', spot: 0, strokes: [stroke()] }, { stencil: 'toString', can: 'red', spot: 0 }, {}, null])
    assert.equal(draw(bad).ok, false, JSON.stringify(bad));
});

test('Graffiti: a wash keeps {aspect, points}, drops a sent can or width, and has the sponge\'s width', () => {
  const v = wash({ strokes: [{ can: 'red', cap: 'fat', width: 0.001, aspect: 2.34567, points: [[0.123456, 0.5]] }] });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.deepEqual(v.value.payload, { strokes: [{ aspect: 2.35, points: [[0.1235, 0.5]] }] });
  assert.deepEqual(v.value.strokes, [{ width: 0.06, aspect: 2.35, points: [[0.1235, 0.5]] }]);
  assert.equal(wash({ strokes: [{ aspect: 1, points: [[2, 0]] }] }).ok, false);
});

test('Graffiti: the largest draw fits 64 KiB as Postgres writes it', () => {
  const longest = (o: object) => Object.keys(o).reduce((a, b) => (b.length > a.length ? b : a));
  const strokes = Array.from({ length: 120 }, () => ({ can: longest(CANS), cap: longest(CAPS), aspect: 0.00123456, points: Array(25).fill([0.12345678, 0.98765432]) }));
  const v = draw({ strokes });
  assert.equal(v.ok, true);
  const asPostgres = JSON.stringify(v.ok && v.value.payload).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) < 65_536, `${Buffer.byteLength(asPostgres)} bytes`);
  const washed = wash({ strokes: strokes.map(({ aspect, points }) => ({ aspect, points })) });
  assert.ok(Buffer.byteLength(JSON.stringify(washed.ok && washed.value.payload).replace(/([,:])/g, '$1 ')) < 65_536);
});

test('Graffiti: every staff config is a valid draw, and a Mod Bot\'s options are one too', () => {
  const configs = graffiti.staffConfigs!;
  assert.ok(configs.length >= 6);
  assert.deepEqual(new Set(configs.map((c) => c.stencil)), new Set(STENCIL_KEYS), 'each stencil is offered');
  for (const c of configs) { assert.equal(draw(c).ok, true, JSON.stringify(c)); assert.equal(graffiti.validateConfig(c).ok, true); }
  assert.deepEqual(graffiti.validateConfig({ stencil: 'horns', can: 'red', spot: 4, junk: 1 }), { ok: true, value: { stencil: 'horns', can: 'red', spot: 4 } });
  assert.equal(graffiti.validateConfig({ stencil: 'horns', can: 'nope', spot: 4 }).ok, false);
  const schema = graffiti.staffOptions!.schema as { properties: Record<string, { enum: unknown[] }> };
  assert.deepEqual(schema.properties.stencil!.enum, [...STENCIL_KEYS]);
  assert.deepEqual(schema.properties.can!.enum, Object.keys(CANS));
  for (const word of [...STENCIL_KEYS, ...Object.keys(CANS)]) assert.match(graffiti.staffOptions!.prompt, new RegExp(word));
});

test('Graffiti: a refusal names the stroke and the point that failed', () => {
  const v = draw({ strokes: [stroke(), stroke(), stroke({ points: [[0.5, 0.5], [0.5, 2]] })] });
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.why : '', /^stroke 3, point 2: a point is across and down from 0 to 1/);
  assert.match((draw({ strokes: [stroke({ can: 'nope' })] }) as { why: string }).why, /^stroke 1: the can is one of/);
  assert.match((draw({ strokes: [stroke(), [1, 2]] }) as { why: string }).why, /^stroke 2: a stroke is an object with/);
  assert.match((wash({ strokes: [{ aspect: 1, points: [[0, 0]] }, { aspect: 0, points: [[0, 0]] }] }) as { why: string }).why, /^stroke 2: /);
});

test('Graffiti: every stencil at the last spot fits 64 KiB as Postgres writes it, and a stencil lands in its own ninth', () => {
  for (const key of STENCIL_KEYS_FOR_TEST) {
    const v = draw({ stencil: key, can: 'orange', spot: 8 });
    assert.equal(v.ok, true, key);
    assert.ok(Buffer.byteLength(JSON.stringify(v.ok && v.value.payload).replace(/([,:])/g, '$1 ')) < 65_536, key);
  }
  const top = draw({ stencil: 'x', can: 'black', spot: 0 });
  const cells = cellsOf(top.ok ? top.value.strokes : []);
  let inTopLeft = false;
  for (let y = 0; y < 34; y++) for (let x = 0; x < 34; x++) inTopLeft ||= covered(cells, x, y);
  assert.equal(inTopLeft, true);
  assert.equal(covered(cells, 50, 50), false);
});

test('Graffiti says what is drawn and, where the reader gives it, how much of the wall is covered', () => {
  assert.equal(seenOf('graffiti'), 'Wario turned this post into a wall, 2 days ago: any character can spray it, and its own character can scrub it.');
  assert.match(seenOf('graffiti', { by: null }), /^Someone turned this post into a wall/);
  assert.equal(seenOf('graffiti', { config: { stencil: 'crown', can: 'pink', spot: 4 } }), 'Wario sprayed a crown in pink spray paint across this post, 2 days ago; any character can add to the wall, and its own character can scrub it.');
  const covered = (cells: number) => seenOf('graffiti', { state: { covered: cells } });
  assert.doesNotMatch(covered(0), /covered in paint/, 'none says nothing');
  for (const [cells, words] of [[500, 'A bit'], [2000, 'Some'], [5000, 'About half'], [7000, 'Most'], [9500, 'Almost all'], [10_000, 'All']] as const) {
    assert.match(covered(cells), new RegExp(`${words} of the wall is covered in paint\\.$`), words);
  }
  assert.doesNotMatch(seenOf('graffiti', { config: { stencil: 'nope', can: 'pink' } }), /undefined/, 'an unknown stencil falls back');
});
