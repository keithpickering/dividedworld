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
import { drawLoose, GLINT_MIN, landAll, loose, makeFlakes, type Flake, type Flakes } from './flakes.ts';

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
let motion: 'full' | 'reduce' = 'full';
(globalThis as unknown as { document: unknown }).document = { documentElement: { getAttribute: () => motion }, defaultView: null };

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
/** A post with every flake landed, and one flake of it (plain, not winking, unless `holo`) left alone on it to aim the light at. */
function post(holo = false): { f: Flakes; aim: Flake } {
  const f = makeFlakes({ seed: 'glint', box: { w: 400, h: 200 }, inks: GLITTER, holo: HOLO, density: 70, glint: '#ffffff' });
  landAll(f);
  const inner = f as unknown as { settled: Flake[] };
  const aim = inner.settled.find((k) => (holo ? k.ink >= HOLO : k.ink < HOLO) && !k.tw)!;
  inner.settled = [aim];
  return { f, aim };
}
const L = (hex: string): number => luminanceOf(toLinear(hex));

describe('the dark board glints', () => {
  test('a flake facing the light glints out of the band, added, in its own hue at full brightness, with the white glint at its heart', () => {
    const { f, aim } = post();
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
    assert.equal(r.images.length, 2, 'a glint is two sprites: the hue and its heart');
    assert.ok(r.images.every((i) => i.op === 'lighter'), 'every glint is added to what is under it');
    const [hue, heart] = r.images as [Image, Image];
    assert.equal(colorOf(heart.sprite), '#ffffff', 'the instance\'s glint at its heart');
    assert.equal(heart.size, hue.size / 2, 'at half the hue\'s size');
    const lin = toLinear(colorOf(hue.sprite));
    assert.ok(L(colorOf(hue.sprite)) > dark.hi * 3, `the glint (${colorOf(hue.sprite)}) is far brighter than the band's ceiling ${dark.hi}`);
    assert.ok(Math.max(...lin) > 0.99, 'as bright as its hue goes');
    /* Its hue is its ink's: the same channel leads. */
    const ink = toLinear(GLITTER[aim.ink]!);
    assert.equal(lin.indexOf(Math.max(...lin)), ink.indexOf(Math.max(...ink)));
  });

  test('a holographic flake glints in one of the rainbow\'s hues at full brightness', () => {
    const { f, aim } = post(true);
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
    assert.equal(r.images.length, 2);
    const c = colorOf(r.images[0]!.sprite), lin = toLinear(c);
    assert.ok(L(c) > dark.hi * 3 && Math.max(...lin) > 0.99, c);
    const leads = (x: readonly number[]) => x.indexOf(Math.max(...x));
    assert.ok(GLITTER.slice(0, HOLO).some((h) => leads(toLinear(h)) === leads(lin)), `${c} leads with a rainbow ink's channel`);
    assert.ok(Math.max(...lin) - Math.min(...lin) > 0.5, `${c} is a hue, not the silver's near-white`);
  });

  test('the flakes themselves stay in the band: every fill is under the ceiling', () => {
    const f = makeFlakes({ seed: 'glint', box: { w: 400, h: 200 }, inks: GLITTER, holo: HOLO, density: 70, glint: '#ffffff' });
    landAll(f);
    const aim = (f as unknown as { settled: Flake[] }).settled[0]!;
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
    assert.ok(r.fills.length > 0 && r.images.length > 0);
    for (const c of r.fills) assert.ok(L(c) <= dark.hi, `${c} is past the ceiling ${dark.hi}`);
  });

  test('a flake lit only up to GLINT_MIN does not glint', () => {
    const { f, aim } = post();
    /* Litness is exp(-d^2 / 0.03): a light this far off leaves the one flake just under GLINT_MIN, and one this near just over. */
    const d = Math.sqrt(-0.03 * Math.log(GLINT_MIN));
    const under = recorder(), over = recorder();
    f.draw(under.ctx, { x: aim.nx + d * 1.02, y: aim.ny }, dark, 0, false);
    f.draw(over.ctx, { x: aim.nx + d * 0.5, y: aim.ny }, dark, 0, false);
    assert.equal(under.images.length, 0);
    assert.ok(over.images.length > 0);
  });

  /** A flare kept in the band: one sprite, drawn over and not added, in a hue under the ceiling. */
  const inBand = (r: ReturnType<typeof recorder>) => {
    assert.equal(r.images.length, 1, 'one sprite, no heart');
    const c = colorOf(r.images[0]!.sprite);
    assert.equal(r.images[0]!.op, 'source-over', 'drawn over, not added');
    assert.ok(L(c) <= dark.hi + 0.004, `${c} is under the ceiling ${dark.hi}`);
  };

  test('under reduced motion the light rests, so a flare stays in the band', () => {
    const { f, aim } = post();
    motion = 'reduce';
    try {
      const r = recorder();
      f.draw(r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
      inBand(r);
    } finally { motion = 'full'; }
  });

  test('loose glitter never glints out of the band: only a post\'s own settled flakes do', () => {
    const { aim } = post();
    const host = {};
    loose(host).push({ ...aim });
    const r = recorder();
    drawLoose(host, r.ctx, { x: aim.nx, y: aim.ny }, dark, 0, false);
    inBand(r);
  });

  test('the light board is as it was: one sprite a flare, the glint\'s, added', () => {
    const { f, aim } = post();
    const r = recorder();
    f.draw(r.ctx, { x: aim.nx, y: aim.ny }, light, 0, false);
    assert.equal(r.images.length, 1);
    assert.ok(r.images[0]!.op === 'lighter' && colorOf(r.images[0]!.sprite) === '#ffffff');
  });
});
