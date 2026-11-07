/**
 * The dark board's glints (docs/plans/2026-11-06-shine-design.md section 5, issue #340): a flake facing the light flares out of
 * the band, in its own hue at full brightness with the instance's glint at its heart, added to what is under it; and the
 * settled field stays inside. A file of its own because a sprite needs a canvas: this one gives the process a stand-in
 * `OffscreenCanvas` before any sprite is made, and flakes.ts keeps its sprites for the life of the process.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf } from '../contrast.ts';
import { bandOf, luminanceOf, toLinear } from './band.ts';
import { GLINT_MIN, landAll, makeFlakes, type Flake, type Flakes } from './flakes.ts';

/** A stand-in canvas: a sprite drawn on it remembers the colors of its gradient's stops. */
class FakeCanvas {
  readonly stops: string[] = [];
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  getContext(): CanvasRenderingContext2D {
    const stops = this.stops;
    return new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => (k === 'createRadialGradient' ? () => ({ addColorStop: (_o: number, c: string) => stops.push(c) }) : () => undefined),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
  }
}
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeCanvas;
(globalThis as unknown as { document: unknown }).document = { documentElement: { getAttribute: () => 'full' }, defaultView: null };

const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];
const HOLO = 7;
const tokens = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8'));
const dark = bandOf(tokens.dark), light = bandOf(tokens.light);

type Image = { sprite: FakeCanvas; size: number; alpha: number; op: string };
/** A context that records each image drawn, with the alpha and the compositing it was drawn under, and each fill. */
function recorder() {
  const images: Image[] = [];
  const fills: string[] = [];
  let alpha = 1, op = 'source-over';
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (k === 'drawImage'
      ? (s: FakeCanvas, _x: number, _y: number, w: number) => images.push({ sprite: s, size: w, alpha, op })
      : () => undefined),
    set: (_t, k: string, v) => {
      if (k === 'globalAlpha') alpha = v as number;
      if (k === 'globalCompositeOperation') op = v as string;
      if (k === 'fillStyle') fills.push(v as string);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, images, fills };
}

/** The color a sprite was made in: its first stop, without the alpha. */
const colorOf = (s: FakeCanvas): string => s.stops[0]!.slice(0, 7);
/** A post with every flake landed, and a plain (not holographic) flake to aim the light at. */
function post(): { f: Flakes; aim: Flake } {
  const f = makeFlakes({ seed: 'glint', box: { w: 400, h: 200 }, inks: GLITTER, holo: HOLO, density: 70, glint: '#ffffff' });
  landAll(f);
  const aim = (f as unknown as { settled: Flake[] }).settled.find((k) => k.ink < HOLO && !k.tw)!;
  return { f, aim };
}

describe('the dark board glints', () => {
  test('a flake facing the light glints out of the band, added, in its own hue at full brightness, with the white glint at its heart', () => {
    const { f, aim } = post();
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
    assert.ok(r.images.length >= 2, 'a glint is two sprites: the hue and its heart');
    assert.ok(r.images.every((i) => i.op === 'lighter'), 'every glint is added to what is under it');
    const hue = r.images.find((i) => colorOf(i.sprite) !== '#ffffff')!;
    const heart = r.images.find((i) => colorOf(i.sprite) === '#ffffff' && i.size < hue.size);
    assert.ok(heart, 'the instance\'s glint is drawn smaller, over the hue');
    const lin = toLinear(colorOf(hue.sprite));
    assert.ok(luminanceOf(lin) > dark.hi * 3, `the glint (${colorOf(hue.sprite)}) is far brighter than the band's ceiling ${dark.hi}`);
    assert.ok(Math.max(...lin) > 0.99, 'as bright as its hue goes');
    /* Its hue is its ink's: the same channel leads. */
    const ink = toLinear(GLITTER[aim.ink]!);
    assert.equal(lin.indexOf(Math.max(...lin)), ink.indexOf(Math.max(...ink)));
  });

  test('the flakes themselves stay in the band: every fill is under the ceiling', () => {
    const { f, aim } = post();
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
    assert.ok(r.fills.length > 0);
    for (const c of r.fills) assert.ok(luminanceOf(toLinear(c)) <= dark.hi, `${c} is past the ceiling ${dark.hi}`);
  });

  test('a flake lit only up to GLINT_MIN does not glint', () => {
    const { f, aim } = post();
    (f as unknown as { settled: Flake[] }).settled = [aim];
    /* Litness is exp(-d^2 / 0.03): a light this far off leaves the one flake just under GLINT_MIN, and one this near just over. */
    const d = Math.sqrt(-0.03 * Math.log(GLINT_MIN));
    const under = recorder(), over = recorder();
    f.draw(under.ctx, { x: aim.nx + d * 1.02, y: aim.ny }, dark, 0, false);
    f.draw(over.ctx, { x: aim.nx + d * 0.5, y: aim.ny }, dark, 0, false);
    assert.equal(under.images.length, 0);
    assert.ok(over.images.length > 0);
  });

  test('the light board is as it was: the glint\'s sprite alone, added', () => {
    const { f, aim } = post();
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, light, 0, false);
    assert.ok(r.images.length >= 1);
    assert.ok(r.images.every((i) => i.op === 'lighter' && colorOf(i.sprite) === '#ffffff'));
  });
});
