/**
 * Graffiti's own rules: its draws, its washes, its stencils and their bounds (docs/plans/2026-11-27-graffiti-everywhere-design.md, sections 1, 2, 4 and 8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANS, CAPS, graffiti } from './graffiti.ts';
import * as sizes from './graffiti.ts';
import { STENCILS } from './graffiti/stencils.ts';
import { LOG_DRAW, describeDraw } from './graffiti/words.ts';
import { SURFACE_WORDS, olderWords } from '../../../engine/ui/cards/lens-words.ts';
import { GRID, cellsOf, count, type Cells } from '../../../engine/rules/surface.ts';
import { decideDraw, decideWash } from '../../../engine/rules/cards.ts';
import { seenOf, surf } from './test-kit.ts';

/* Graffiti (docs/plans/2026-11-11-graffiti-plan.md, Task 7; the draw's new shape is docs/plans/2026-11-27-graffiti-everywhere-plan.md, Task 3). */
const CAPS_EM = sizes.CAPS_EM as { skinny: number; stock: number; fat: number };
const STENCIL_EM = sizes.STENCIL_EM as number;
const SPONGE_EM = sizes.SPONGE_EM as number;
const draw = (input: unknown) => surf.validateDraw(input);
const wash = (input: unknown, draws: ReadonlyMap<string, unknown> = new Map()) => surf.validateWash(input, draws);
const covered = (cells: Cells, x: number, y: number) => (cells[(y * GRID + x) >> 3]! & (0x80 >> ((y * GRID + x) & 7))) !== 0;
const stroke = (over: Record<string, unknown> = {}) => ({ can: 'red', cap: 'stock', points: [[-1, 0.5], [1, -0.5]], ...over });
const text = { kind: 'text', version: 'v1', at: 12, len: 5, dx: 0.5, dy: 0.4 };
const image = { kind: 'image', version: 'v1', n: 0, src: 'https://x.test/a.png', nth: 0, x: 0.4, y: 0.6 };
const group = (over: Record<string, unknown> = {}) => ({ at: [0.5, 0.5], anchor: text, unit: 'em', strokes: [stroke()], ...over });
const box = { w: 60, h: 40 };
const drawn = (groups: unknown[], b: unknown = box) => ({ box: b, groups });
const STENCIL_KEYS = ['mustache', 'horns', 'crown', 'kilroy', 'x', 'smiley'] as const;
const strokesOf = (v: ReturnType<typeof draw>) => { assert.equal(v.ok, true, JSON.stringify(v)); return v.ok ? v.value.strokes : []; };
const why = (v: { ok: boolean; why?: string }) => (v.ok ? '' : v.why ?? '');

test('Graffiti: the sizes are in ems, and the card gives its coats', () => {
  assert.deepEqual(CAPS_EM, { skinny: 0.4, stock: 1.07, fat: 2.67 });
  assert.equal(SPONGE_EM, 4);
  assert.equal(STENCIL_EM, 12);
  assert.deepEqual(surf.coats, { line: 20, most: 40 });
  assert.deepEqual(CAPS, { skinny: 0.006, stock: 0.016, fat: 0.04 }, 'the old caps stay, for reading stored draws');
});

test('Graffiti: a draw of two groups is kept as given, and its strokes are framed where `at` puts them, in the cap\'s width', () => {
  const input = drawn([
    group({ at: [0.25, 0.5] }),
    group({ at: [0.75, 0.5], anchor: image, unit: 'image', em: 20, strokes: [stroke({ points: [[0, 0], [0.5, 0.25]] })] }),
  ]);
  const v = draw(input);
  assert.equal(v.ok, true, why(v));
  if (!v.ok) return;
  assert.deepEqual(v.value.payload, input);
  const [a, b] = v.value.strokes;
  assert.ok(Math.abs(a!.width - 1.07 / 60) < 1e-9, `${a!.width}`);
  assert.ok(Math.abs(b!.width - 1.07 / 60) < 1e-9, 'the same cap in an image group has the same width');
  assert.ok(Math.abs(a!.aspect - 1.5) < 1e-9);
  // Ems: across is 1 / box.w, down is 1 / box.h.
  assert.ok(Math.abs(a!.points[0]![0] - (0.25 - 1 / 60)) < 1e-9 && Math.abs(a!.points[0]![1] - (0.5 + 0.5 / 40)) < 1e-9, JSON.stringify(a!.points));
  // Image widths: em / box.w across, em / box.h down.
  assert.ok(Math.abs(b!.points[1]![0] - (0.75 + (0.5 * 20) / 60)) < 1e-9 && Math.abs(b!.points[1]![1] - (0.5 + (0.25 * 20) / 40)) < 1e-9, JSON.stringify(b!.points));
});

const cellsFor = (g: unknown, b: unknown = box) => { const v = draw(drawn([g], b)); assert.equal(v.ok, true, why(v)); return count(cellsOf(v.ok ? v.value.strokes : [])); };
const zigzag = (n: number, w: number, h: number) => Array.from({ length: n }, (_, i): [number, number] => [i % 2 === 0 ? -w / 2 : w / 2, -h / 2 + (h * i) / (n - 1)]);

test('Graffiti: a group larger than the box is shrunk evenly into it for the count, and the payload keeps the points as drawn', () => {
  const v = draw(drawn([group({ at: [0.9, 0.9], strokes: [stroke({ points: [[0, 0], [60, 40]] })] })]));
  assert.equal(v.ok, true, why(v));
  if (!v.ok) return;
  assert.deepEqual((v.value.payload as { groups: { strokes: { points: number[][] }[] }[] }).groups[0]!.strokes[0]!.points[1], [60, 40]);
  for (const s of v.value.strokes) for (const [x, y] of s.points) assert.ok(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, `${x}, ${y}`);
});

test('Graffiti: a hostile em-400 zigzag in a 5-em box counts as many cells as the same scribble scaled into the box', () => {
  const small = { w: 5, h: 40 };
  const points = zigzag(40, 400, 40).map(([x, y]): [number, number] => [Math.max(-200, Math.min(200, x)), y]);
  const hostile = cellsFor(group({ strokes: [stroke({ points })] }), small);
  // The same scribble, scaled evenly (its stroke width too) until it is as wide as the box: k is the box over the extent (the zigzag plus the cap).
  const k = 1 / (400 / 5 + 1.07 / 5);
  const scaled = count(cellsOf([{ width: (1.07 / 5) * k, aspect: 5 / 40, points: points.map(([x, y]): [number, number] => [0.5 + (x * k) / 5, 0.5 + (y * k) / 40]) }]));
  assert.ok(hostile > 0 && hostile === scaled, `${hostile} against ${scaled}`);
  const widths = strokesOf(draw(drawn([group({ strokes: [stroke({ points: [[-200, 0], [200, 0]] })] })], small))).map((s) => s.width);
  assert.ok(widths[0]! < 1.07 / 5, 'the stroke width shrinks with the group');
});

test('Graffiti: a group hanging off the right edge is moved in, not squashed', () => {
  const pts = [[-3, -1], [3, 1], [-3, 1], [3, -1]];
  const inside = cellsFor(group({ at: [0.5, 0.5], strokes: [stroke({ points: pts })] }));
  const off = cellsFor(group({ at: [0.97, 0.5], strokes: [stroke({ points: pts })] }));
  assert.ok(Math.abs(off - inside) <= inside * 0.1, `${off} against ${inside}`);
  const v = draw(drawn([group({ at: [0.97, 0.5], strokes: [stroke({ points: pts })] })]));
  const xs = strokesOf(v).flatMap((s) => s.points.map((p) => p[0]));
  assert.ok(Math.max(...xs) <= 1 && Math.abs(Math.max(...xs) + 0.5 * 1.07 / 60 - 1) < 1e-9, `${Math.max(...xs)}`);
});

test('Graffiti: a wash press at a group\'s point lands on the same framed spot as the draw\'s point, for a group that was shrunk and moved', () => {
  const live = drawn([group({ at: [0.95, 0.1], strokes: [stroke({ points: [[-300 / 2, 3], [100, -50], [150, 20]] })] })], { w: 5, h: 40 });
  const d = draw(live);
  assert.equal(d.ok, true, why(d));
  if (!d.ok) return;
  const v = wash({ cuts: [{ draw: 'd1', group: 0, presses: [[-150, 3], [100, -50], [150, 20]] }] }, new Map([['d1', d.value.payload]]));
  assert.equal(v.ok, true, why(v));
  if (!v.ok) return;
  v.value.cuts[0]!.presses.forEach((p, i) => { const q = d.value.strokes[0]!.points[i]!; assert.ok(Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9, `${i}: ${p} against ${q}`); });
});

test('Graffiti: control characters in a version or a src are refused', () => {
  for (const bad of ['a\u0000b', 'a\u001fb', 'a\u007fb', 'a\nb']) {
    assert.equal(draw(drawn([group({ anchor: { ...text, version: bad } })])).ok, false, JSON.stringify(bad));
    assert.equal(draw(drawn([group({ anchor: { ...image, src: bad }, unit: 'image', em: 10 })])).ok, false, JSON.stringify(bad));
  }
  assert.equal(draw(drawn([group({ anchor: { ...image, src: 'https://x.test/a b.png' }, unit: 'image', em: 10 })])).ok, true);
});

const imageGroup = (src: string, x = 0) => group({ anchor: { ...image, src }, unit: 'image', em: 10, strokes: [stroke({ points: [[x, 0]] })] });

test('Graffiti: the stored size counts as Postgres writes it, and a colon or comma inside a string is not a separator', () => {
  // One group as jsonb text, the separators written out by hand: only the structural ones have a space after them.
  const src = ':,'.repeat(1000);
  const one = `{"at": [0.5, 0.5], "anchor": {"kind": "image", "version": "v1", "n": 0, "src": "${src}", "nth": 0, "x": 0.4, "y": 0.6}, "unit": "image", "em": 10, "strokes": [{"can": "red", "cap": "stock", "points": [[0, 0]]}]}`;
  const fits = (n: number) => Buffer.byteLength(`{"box": {"w": 60, "h": 40}, "groups": [${Array(n).fill(one).join(', ')}]}`);
  // 29 of these fit as Postgres writes them, and would not if every colon and comma in the string were doubled.
  assert.ok(fits(29) < 65_536 && fits(29) + 29 * 2000 > 65_536, `${fits(29)}`);
  assert.equal(draw(drawn(Array.from({ length: 29 }, () => imageGroup(src)))).ok, true);
});

test('Graffiti: a draw just under 64 KiB is kept and one just over is refused', () => {
  const unit = (src: string) => Buffer.byteLength(`{"at": [0.5, 0.5], "anchor": {"kind": "image", "version": "v1", "n": 0, "src": "${src}", "nth": 0, "x": 0.4, "y": 0.6}, "unit": "image", "em": 10, "strokes": [{"can": "red", "cap": "stock", "points": [[0, 0]]}]}`);
  const head = Buffer.byteLength('{"box": {"w": 60, "h": 40}, "groups": []}');
  // Thirty groups with a src of n characters take head + 30 * unit + 2 * 29 bytes; pick n so that the total is exactly the limit, then one over.
  const total = (n: number) => head + 30 * unit('a'.repeat(n)) + 2 * 29;
  let n = 0;
  while (total(n + 1) <= 65_536) n++;
  assert.ok(n > 0 && n <= 2048, `${n}`);
  assert.ok(total(n) <= 65_536 && total(n + 1) > 65_536);
  const under = draw(drawn(Array.from({ length: 30 }, () => imageGroup('a'.repeat(n)))));
  assert.equal(under.ok, true, why(under));
  const over = draw(drawn(Array.from({ length: 30 }, () => imageGroup('a'.repeat(n + 1)))));
  assert.equal(over.ok, false);
  assert.match(why(over), /64 KiB/);
});

test('Graffiti: NaN and Infinity are refused for a draw point, a wash press, the box and at', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(draw(drawn([group({ strokes: [stroke({ points: [[bad, 0]] })] })])).ok, false, `point ${bad}`);
    assert.equal(draw(drawn([group({ strokes: [stroke({ points: [[0, bad]] })] })])).ok, false, `point ${bad}`);
    assert.equal(draw(drawn([group()], { w: bad, h: 40 })).ok, false, `box.w ${bad}`);
    assert.equal(draw(drawn([group()], { w: 60, h: bad })).ok, false, `box.h ${bad}`);
    assert.equal(draw(drawn([group({ at: [bad, 0.5] })])).ok, false, `at ${bad}`);
    assert.equal(wash({ cuts: [{ draw: 'd1', group: 0, presses: [[bad, 0]] }] }, new Map([['d1', drawn([group()])]])).ok, false, `press ${bad}`);
  }
});

test('Graffiti: the wash of an old-shape draw names the old sponge as a share of the box', () => {
  const old = { strokes: [{ can: 'red', cap: 'stock', aspect: 2, points: [[0.1, 0.2]] }] };
  const v = wash({ cuts: [{ draw: 'd1', group: 0, presses: [[0.5, 0.5]] }] }, new Map([['d1', old]]));
  assert.equal(v.ok, true, why(v));
  if (v.ok) assert.equal(v.value.cuts[0]!.radius, (sizes as unknown as { SPONGE: number }).SPONGE / 2);
});

test('Graffiti: each bound refuses one over and names its predicate', () => {
  assert.equal(draw(drawn([group({ strokes: Array.from({ length: 120 }, () => stroke()) })])).ok, true);
  assert.match(why(draw(drawn([group({ strokes: Array.from({ length: 121 }, () => stroke()) })]))), /at most 120 strokes/);
  assert.equal(draw(drawn([group({ strokes: [stroke({ points: Array(300).fill([0, 0]) })] })])).ok, true);
  assert.match(why(draw(drawn([group({ strokes: [stroke({ points: Array(301).fill([0, 0]) })] })]))), /stroke 1: a stroke has 1 to 300 points/);
  const ten = Array.from({ length: 10 }, () => stroke({ points: Array(300).fill([0, 0]) }));
  assert.equal(draw(drawn([group({ strokes: ten })])).ok, true);
  assert.match(why(draw(drawn([group({ strokes: [...ten, stroke()] })]))), /at most 3000 points in all/);
  assert.equal(draw(drawn(Array.from({ length: 120 }, () => group()))).ok, true);
  assert.match(why(draw(drawn(Array.from({ length: 121 }, () => group())))), /at most 120 groups/);
  assert.equal(draw(drawn([group({ anchor: image, unit: 'image', em: 0.5 })])).ok, true);
  assert.match(why(draw(drawn([group({ anchor: image, unit: 'image', em: 0.4 })]))), /em .*0\.5 to 400/);
  assert.match(why(draw(drawn([group({ anchor: image, unit: 'image' })]))), /em/);
  assert.equal(draw(drawn([group()], { w: 5, h: 1 })).ok, true);
  assert.match(why(draw(drawn([group()], { w: 4.9, h: 40 }))), /box.*w.*5 to 200/);
  assert.match(why(draw(drawn([group()], { w: 60, h: 4001 }))), /box.*h.*1 to 4000/);
  assert.match(why(draw(drawn([group({ anchor: image })]))), /image attachment.*unit/);
  assert.match(why(draw(drawn([group({ anchor: { kind: 'box' }, unit: 'image', em: 10 })]))), /unit.*em/);
  assert.equal(draw(drawn([group({ strokes: [stroke({ points: [[200, -200]] })] })])).ok, true);
  assert.match(why(draw(drawn([group({ strokes: [stroke({ points: [[200.1, 0]] })] })]))), /point 1: .*-200 to 200/);
  assert.match(why(draw(drawn([group({ anchor: image, unit: 'image', em: 10, strokes: [stroke({ points: [[10.1, 0]] })] })]))), /-10 to 10/);
  assert.match(why(draw(drawn([group({ at: [1.1, 0.5] })]))), /at .*0 to 1/);
  assert.equal(draw(drawn([])).ok, false, 'a draw with no group is nothing');
  assert.equal(draw(drawn([group({ strokes: [] })])).ok, false, 'a group with no stroke is nothing');
});

test('Graffiti: an unknown can or cap is refused, and the refusal lists the cans', () => {
  const v = draw(drawn([group({ strokes: [stroke({ can: 'chartreuse' })] })]));
  assert.equal(v.ok, false);
  for (const can of Object.keys(CANS)) assert.match(why(v), new RegExp(can));
  assert.equal(draw(drawn([group({ strokes: [stroke({ cap: 'huge' })] })])).ok, false);
});

test('Graffiti: a draw keeps a stroke\'s can and cap and drops a sent width or aspect', () => {
  const v = draw(drawn([group({ strokes: [stroke({ width: 0.9, aspect: 3 })] })]));
  assert.equal(v.ok, true, why(v));
  if (!v.ok) return;
  assert.deepEqual((v.value.payload as { groups: { strokes: unknown[] }[] }).groups[0]!.strokes[0], { can: 'red', cap: 'stock', points: [[-1, 0.5], [1, -0.5]] });
});

test('Graffiti: a draw of the old shape is refused', () => {
  assert.equal(draw({ strokes: [{ can: 'red', cap: 'stock', aspect: 1.5, points: [[0.1, 0.2], [0.3, 0.4]] }] }).ok, false);
  assert.equal(draw(null).ok, false);
});

test('Graffiti: a stencil gives one box-attached group at its spot\'s center, STENCIL_EM across', () => {
  assert.deepEqual(Object.keys(STENCILS).sort(), [...STENCIL_KEYS].sort());
  for (const key of STENCIL_KEYS) for (let spot = 0; spot < 9; spot++) {
    const v = draw({ stencil: key, can: 'teal', spot });
    assert.equal(v.ok, true, `${key} ${spot}`);
    if (!v.ok) continue;
    const p = v.value.payload as { stencil: string; can: string; spot: number; box: { w: number; h: number }; groups: { at: number[]; anchor: unknown; unit: string; strokes: { can: string; cap: string; points: number[][] }[] }[] };
    assert.deepEqual([p.stencil, p.can, p.spot], [key, 'teal', spot]);
    assert.deepEqual(p.box, { w: 65.9, h: 46.7 });
    assert.equal(p.groups.length, 1);
    const g = p.groups[0]!;
    assert.deepEqual(g.anchor, { kind: 'box' });
    assert.equal(g.unit, 'em');
    const [col, row] = [spot % 3, Math.floor(spot / 3)];
    assert.deepEqual(g.at, [Number(((col + 0.5) / 3).toFixed(4)), Number(((row + 0.5) / 3).toFixed(4))]);
    assert.ok(g.strokes.length >= 1 && g.strokes.length <= 120);
    assert.ok(g.strokes.every((s) => s.can === 'teal' && s.cap in CAPS));
    const xs = g.strokes.flatMap((s) => s.points.map((q) => q[0]!)), ys = g.strokes.flatMap((s) => s.points.map((q) => q[1]!));
    assert.ok(Math.min(...xs) >= -STENCIL_EM / 2 - 1e-6 && Math.max(...xs) <= STENCIL_EM / 2 + 1e-6, `${key} across`);
    assert.ok(Math.min(...ys) >= -STENCIL_EM / 2 - 1e-6 && Math.max(...ys) <= STENCIL_EM / 2 + 1e-6, `${key} down`);
    assert.ok(Math.max(...xs) - Math.min(...xs) > STENCIL_EM * 0.5, `${key} is about ${STENCIL_EM} ems across`);
    assert.ok(v.value.strokes.length === g.strokes.length);
    for (const s of v.value.strokes) assert.ok(Math.abs(s.aspect - 65.9 / 46.7) < 1e-9);
  }
});

test('Graffiti: stencil x at spot 4 covers the center cell, and each stencil at spot 4 covers a modest share of the grid', () => {
  const x = draw({ stencil: 'x', can: 'black', spot: 4 });
  assert.equal(covered(cellsOf(x.ok ? x.value.strokes : []), 50, 50), true);
  assert.equal(covered(cellsOf(x.ok ? x.value.strokes : []), 5, 5), false);
  for (const key of STENCIL_KEYS) {
    const v = draw({ stencil: key, can: 'black', spot: 4 });
    const n = count(cellsOf(v.ok ? v.value.strokes : []));
    assert.ok(n > 30 && n < 1200, `${key} covers ${n} cells`);
  }
});

test('Graffiti: a stencil draw is a stencil with a known key, a can and a spot 0 to 8, and not also groups', () => {
  for (const bad of [{ stencil: 'nope', can: 'red', spot: 0 }, { stencil: 'x', can: 'nope', spot: 0 }, { stencil: 'x', can: 'red', spot: 9 }, { stencil: 'x', can: 'red', spot: -1 }, { stencil: 'x', can: 'red', spot: 1.5 }, { stencil: 'x', can: 'red' }, { stencil: 'x', can: 'red', spot: 0, groups: [group()], box }, { stencil: 'toString', can: 'red', spot: 0 }, {}, null])
    assert.equal(draw(bad).ok, false, JSON.stringify(bad));
});

test('Graffiti: a wash cuts draws it is given, names the draw\'s radius and aspect, and frames presses as a draw\'s points are', () => {
  const live = drawn([group({ at: [0.5, 0.5] }), group({ at: [0.2, 0.2], anchor: image, unit: 'image', em: 10, strokes: [stroke({ points: [[0, 0]] })] })]);
  const draws = new Map<string, unknown>([['d1', live]]);
  const v = wash({ cuts: [{ draw: 'd1', group: 0, presses: [[0, 0], [3, 2]] }, { draw: 'd1', group: 1, presses: [[0.1, 0.1]] }] }, draws);
  assert.equal(v.ok, true, why(v));
  if (!v.ok) return;
  assert.equal(v.value.cuts.length, 2);
  const [a, b] = v.value.cuts;
  assert.equal(a!.draw, 'd1');
  assert.deepEqual(a!.presses[0], [0.5, 0.5], 'a group at the center lands at the center');
  assert.ok(Math.abs(a!.presses[1]![0] - (0.5 + 3 / 60)) < 1e-9 && Math.abs(a!.presses[1]![1] - (0.5 + 2 / 40)) < 1e-9);
  assert.ok(Math.abs(a!.radius - 4 / 2 / 60) < 1e-9);
  assert.ok(Math.abs(a!.aspect - 1.5) < 1e-9);
  assert.ok(Math.abs(b!.presses[0]![0] - (0.2 + (0.1 * 10) / 60)) < 1e-9 && Math.abs(b!.presses[0]![1] - (0.2 + (0.1 * 10) / 40)) < 1e-9);
  assert.deepEqual(v.value.payload, { cuts: [{ draw: 'd1', group: 0, presses: [[0, 0], [3, 2]] }, { draw: 'd1', group: 1, presses: [[0.1, 0.1]] }] });
});

test('Graffiti: a wash of a draw not given, or of a group it lacks, is refused; and the presses are bounded', () => {
  const draws = new Map<string, unknown>([['d1', drawn([group()])]]);
  assert.match(why(wash({ cuts: [{ draw: 'd2', group: 0, presses: [[0, 0]] }] }, draws)), /d2/);
  assert.match(why(wash({ cuts: [{ draw: 'd1', group: 1, presses: [[0, 0]] }] }, draws)), /group/);
  assert.equal(wash({ cuts: [{ draw: 'd1', group: 0, presses: [[0, 0]] }] }, draws).ok, true);
  assert.equal(wash({ cuts: [] }, draws).ok, false);
  assert.equal(wash({ cuts: [{ draw: 'd1', group: 0, presses: [] }] }, draws).ok, false);
  assert.equal(wash({ cuts: [{ draw: 'd1', group: 0, presses: Array(3000).fill([0, 0]) }] }, draws).ok, true);
  assert.match(why(wash({ cuts: [{ draw: 'd1', group: 0, presses: Array(1500).fill([0, 0]) }, { draw: 'd1', group: 0, presses: Array(1501).fill([0, 0]) }] }, draws)), /at most 3000 presses/);
  assert.match(why(wash({ cuts: [{ draw: 'd1', group: 0, presses: [[200.1, 0]] }] }, draws)), /cut 1, press 1: a press is across and down/);
  assert.equal(wash({ cuts: [{ draw: 'd1', group: 0, presses: [[0, 0]], can: 'red' }] }, draws).ok, true, 'a sent can is dropped');
});

test('Graffiti: a wash of the old shape is refused, and a draw of the old shape can still be washed', () => {
  const old = { strokes: [{ can: 'red', cap: 'stock', aspect: 2, points: [[0.1, 0.2], [0.3, 0.4]] }] };
  assert.equal(wash({ strokes: [{ aspect: 1, points: [[0.5, 0.5]] }] }, new Map([['d1', old]])).ok, false);
  assert.equal(wash({ strokes: [{ aspect: 1, points: [[0.5, 0.5]] }], cells: '0'.repeat(10_000) }, new Map([['d1', old]])).ok, false);
  const v = wash({ cuts: [{ draw: 'd1', group: 0, presses: [[0.5, 0.5]] }] }, new Map([['d1', old]]));
  assert.equal(v.ok, true, why(v));
  if (v.ok) assert.deepEqual([v.value.cuts[0]!.presses[0], v.value.cuts[0]!.aspect], [[0.5, 0.5], 2], 'an old draw is one group in its own shares');
});

test('Graffiti: the engine decides a draw to a coat string and a wash to one take for each cut draw', () => {
  const d = decideDraw(graffiti, { cardSettings: { 'graffiti.limit': 40 } } as never, drawn([group({ strokes: [stroke({ cap: 'fat', points: [[-5, 0], [5, 0]] })] })]));
  assert.equal(d.ok, true, why(d));
  if (!d.ok) return;
  assert.equal(d.value.coats.length, 10_000);
  const w = decideWash(graffiti, {} as never, { cuts: [{ draw: 'd1', group: 0, presses: [[0, 0]] }] }, new Map([['d1', d.value.payload]]));
  assert.equal(w.ok, true, why(w));
  if (w.ok) assert.deepEqual(w.value.takes.map((t) => t.draw), ['d1']);
});

test('Graffiti: the largest draw fits 64 KiB as Postgres writes it, and one that would not is refused', () => {
  const longest = (o: object) => Object.keys(o).reduce((a, b) => (b.length > a.length ? b : a));
  const strokes = Array.from({ length: 120 }, () => stroke({ can: longest(CANS), cap: longest(CAPS), points: Array(25).fill([-123.456789, 98.7654321]) }));
  const input = drawn([group({ strokes })]);
  const v = draw(input);
  assert.equal(v.ok, true, why(v));
  const asPostgres = JSON.stringify(v.ok && v.value.payload).replace(/([,:])/g, '$1 ');
  assert.ok(Buffer.byteLength(asPostgres) < 65_536, `${Buffer.byteLength(asPostgres)} bytes`);
  const fat = drawn(Array.from({ length: 120 }, () => group({ anchor: { ...text, version: 'v'.repeat(36) }, strokes: [stroke({ points: Array(25).fill([-123.456789, 98.7654321]) })] })));
  const f = draw(fat);
  if (f.ok) assert.ok(Buffer.byteLength(JSON.stringify(f.value.payload).replace(/([,:])/g, '$1 ')) <= 65_536);
  else assert.match(why(f), /64 KiB/);
  const huge = draw(drawn([group({ anchor: { ...text, version: 'v'.repeat(70_000) } })]));
  assert.equal(huge.ok, false);
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

test('Graffiti: a refusal names the group, the stroke and the point that failed', () => {
  const v = draw(drawn([group(), group({ strokes: [stroke(), stroke(), stroke({ points: [[0, 0], [0, 300]] })] })]));
  assert.equal(v.ok, false);
  assert.match(why(v), /^group 2, stroke 3, point 2: a point is across and down from -200 to 200/);
  assert.match(why(draw(drawn([group({ strokes: [stroke({ can: 'nope' })] })]))), /^group 1, stroke 1: the can is one of/);
  assert.match(why(draw(drawn([group({ strokes: [stroke(), [1, 2]] })]))), /^group 1, stroke 2: a stroke is an object with/);
});

test('Graffiti: every stencil at the last spot fits 64 KiB as Postgres writes it, and a stencil lands in its own ninth', () => {
  for (const key of STENCIL_KEYS) {
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

test('Graffiti: a stored draw of any shape is described by its colors', () => {
  assert.equal(describeDraw({ strokes: [{ can: 'pink', cap: 'fat', aspect: 1, points: [[0, 0]] }, { can: 'lime' }, { can: 'pink' }] }), 'pink and lime');
  assert.equal(describeDraw({ strokes: [{ can: 'pink' }], cells: '0' }), 'pink');
  assert.equal(describeDraw(drawn([group({ strokes: [stroke({ can: 'red' }), stroke({ can: 'blue' })] }), group({ strokes: [stroke({ can: 'red' })] })])), 'red and blue');
  assert.equal(describeDraw({ stencil: 'crown', can: 'pink', spot: 4, box, groups: [] }), 'a crown in pink');
  assert.equal(describeDraw({ stencil: 'crown', can: 'pink', spot: 4, strokes: [] }), 'a crown in pink');
  assert.equal(describeDraw({}), 'a tag');
  assert.equal(describeDraw(null), 'a tag');
});

test('Graffiti says what is drawn and, where the reader gives it, how much of the wall is covered', () => {
  assert.equal(seenOf('graffiti'), 'Wario turned this post into a wall, 2 days ago: any character can spray it, and its own character can scrub it.');
  assert.match(seenOf('graffiti', { by: null }), /^Someone turned this post into a wall/);
  assert.equal(seenOf('graffiti', { config: { stencil: 'crown', can: 'pink', spot: 4 } }), 'Wario sprayed a crown in pink spray paint across this post, 2 days ago; any character can add to the wall, and its own character can scrub it.');
  const covered = (cells: number) => seenOf('graffiti', { covered: cells / 10_000 });
  assert.doesNotMatch(covered(0), /covered in paint/, 'none says nothing');
  for (const [cells, words] of [[500, 'A bit'], [2000, 'Some'], [5000, 'About half'], [7000, 'Most'], [9500, 'Almost all'], [10_000, 'All']] as const) {
    assert.match(covered(cells), new RegExp(`${words} of the wall is covered in paint\\.$`), words);
  }
  assert.doesNotMatch(seenOf('graffiti', { covered: null }), /covered in paint/, 'no share says nothing');
  assert.doesNotMatch(seenOf('graffiti', { config: { stencil: 'nope', can: 'pink' } }), /undefined/, 'an unknown stencil falls back');
});

test('Graffiti: the Lens\'s line for drawings no longer live reads "washed off"', () => {
  assert.equal(olderWords(14, { ...SURFACE_WORDS, ...LOG_DRAW }), 'and 14 older tags, washed off');
  assert.equal(olderWords(1, { ...SURFACE_WORDS, ...LOG_DRAW }), 'and 1 older tag, washed off');
});
