import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf, type Mode } from '../contrast.ts';
import { bandOf, shineIsReadable, toLinear, toSrgb8, type Band } from './band.ts';
import { REST } from './light.ts';
import { makeFoil, sampleFoil, type FoilCanvas } from './foil.ts';

const tokens = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8'));
type Board = 'light' | 'dark';
const bands: Record<Board, Band> = { light: bandOf(tokens.light), dark: bandOf(tokens.dark) };

/* Feelin' Fab's two six-stop palettes, copied from FAB_STOPS in instances/divided-world/ui/feelin-fab/Effect.tsx (the engine
 * may not import an instance). */
const PALETTES: Record<Board, readonly string[]> = {
  light: ['#ffb9be', '#ffc09f', '#fff2a0', '#a8e6a1', '#9fd3ff', '#d8c0ff'],
  dark: ['#7f0c1e', '#682d06', '#4a3d00', '#0d471e', '#133b84', '#522191'],
};
const PATTERNS = ['pearl', 'bands', 'prism'] as const;
const modeOf = (band: Band): Board => (band.hi < 0.5 ? 'dark' : 'light');
const foilFor = (pattern: (typeof PATTERNS)[number], mode: Board, seed = 'play:post', palette = PALETTES[mode]) =>
  makeFoil({ seed, pattern, palette, stars: 8 });

describe('the foil', () => {
  test('one seed gives the same cells twice, and Math.random is never read', () => {
    const spy = mock.method(Math, 'random', () => { throw new Error('Math.random was read'); });
    try {
      for (const pattern of PATTERNS) {
        for (const mode of ['light', 'dark'] as const) {
          const box = { w: 300, h: 120 };
          const a = sampleFoil(foilFor(pattern, mode), box, REST, bands[mode]);
          const b = sampleFoil(foilFor(pattern, mode), box, REST, bands[mode]);
          assert.ok(a.length === 100 * 40, 'one color per 3px cell');
          assert.deepEqual(a, b);
        }
      }
    } finally {
      spy.mock.restore();
    }
    assert.notDeepEqual(
      sampleFoil(foilFor('prism', 'light', 'one'), { w: 300, h: 120 }, REST, bands.light),
      sampleFoil(foilFor('prism', 'light', 'two'), { w: 300, h: 120 }, REST, bands.light),
    );
  });

  test('every cell holds 4.5:1 against every ink at every light, on both boards, for all patterns and both palettes', () => {
    for (const pattern of PATTERNS) {
      /* Four modes in the engine's list; each is sampled with the band its own tokens give and the palette of its board. */
      const foils = new Map<string, ReturnType<typeof foilFor>>();
      const failures = shineIsReadable(tokens, (mode, light) => {
        const band = bandOf(tokens[mode]);
        if (!foils.has(mode)) foils.set(mode, foilFor(pattern, modeOf(band)));
        return new Set(sampleFoil(foils.get(mode)!, { w: 240, h: 120 }, light, band));
      });
      assert.deepEqual(failures.slice(0, 3), [], `${pattern}`);
    }
  });

  test('POISON: a white stop on the dark board with no clamp is caught; the clamp holds it', () => {
    const white = [...PALETTES.dark.slice(0, 5), '#ffffff'];
    const open: Band = { lo: 0, hi: 1 };
    for (const pattern of PATTERNS) {
      const foil = foilFor(pattern, 'dark', 'play:post', white);
      const red = shineIsReadable(tokens, (mode, light) =>
        modeOf(bandOf(tokens[mode])) === 'dark' ? new Set(sampleFoil(foil, { w: 240, h: 120 }, light, open)) : []);
      assert.ok(red.length > 0, `${pattern}: an unclamped white stop must fail the check`);
      const held = shineIsReadable(tokens, (mode, light) =>
        modeOf(bandOf(tokens[mode])) === 'dark' ? new Set(sampleFoil(foil, { w: 240, h: 120 }, light, bandOf(tokens[mode]))) : []);
      assert.deepEqual(held.slice(0, 3), [], `${pattern}: the clamp holds a white stop`);
    }
  });

  /** HSL hue in degrees of an sRGB8 color, in linear light (the clamp keeps hue exactly there). */
  function hueOf(r: number, g: number, b: number): number {
    const [lr, lg, lb] = toLinear(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
    const mx = Math.max(lr, lg, lb), d = mx - Math.min(lr, lg, lb);
    if (d < 1e-6) return NaN;
    const h = mx === lr ? ((lg - lb) / d) % 6 : mx === lg ? (lb - lr) / d + 2 : (lr - lg) / d + 4;
    return (h * 60 + 360) % 360;
  }
  const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  test('the whole rainbow: all six of the palette hues cover at least 2% of a 988 x 300 post, at rest light', () => {
    const shares: string[] = [];
    for (const pattern of PATTERNS) {
      for (const mode of ['light', 'dark'] as const) {
        const palette = PALETTES[mode];
        const stopHue = palette.map((hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return hueOf(r!, g!, b!); });
        const box = { w: 988, h: 300 };
        const foil = foilFor(pattern, mode);
        const px = new Uint8ClampedArray(Math.ceil(box.w / 3) * Math.ceil(box.h / 3) * 4);
        foil.render(box, REST, bands[mode], px);
        const count = new Array<number>(6).fill(0);
        let n = 0;
        for (let o = 0; o < px.length; o += 4) {
          const h = hueOf(px[o]!, px[o + 1]!, px[o + 2]!);
          if (Number.isNaN(h)) continue;
          let best = 0;
          for (let k = 1; k < 6; k++) if (hueDist(h, stopHue[k]!) < hueDist(h, stopHue[best]!)) best = k;
          count[best]!++; n++;
        }
        const min = Math.min(...count) / n;
        shares.push(`${pattern}/${mode} min ${(min * 100).toFixed(1)}%`);
        count.forEach((c, k) => assert.ok(c / n >= 0.02, `${pattern}/${mode}: stop ${k} holds ${(100 * c / n).toFixed(1)}%`));
      }
    }
    console.log('sextant shares:', shares.join('; '));
  });

  test('prism facets average 15 to 20px across', () => {
    const box = { w: 988, h: 300 };
    const map = foilFor('prism', 'light').facets(box);
    const count = new Set(map).size;
    const across = Math.sqrt((box.w * box.h) / count);
    console.log(`facet size ${across.toFixed(1)}px (${count} facets)`);
    assert.ok(across >= 15 && across <= 20, `${across}`);
  });

  test('one 988 x 300 render takes under 40ms in Node', () => {
    const box = { w: 988, h: 300 };
    const px = new Uint8ClampedArray(Math.ceil(box.w / 3) * Math.ceil(box.h / 3) * 4);
    const times: string[] = [];
    for (const pattern of PATTERNS) {
      for (const mode of ['light', 'dark'] as const) {
        const foil = foilFor(pattern, mode);
        foil.render(box, REST, bands[mode], px);
        const t0 = performance.now();
        foil.render(box, { x: 0.2, y: 0.1 }, bands[mode], px);
        const ms = performance.now() - t0;
        times.push(`${pattern}/${mode} ${ms.toFixed(1)}ms`);
        assert.ok(ms < 40, `${pattern}/${mode} took ${ms}ms`);
      }
    }
    console.log('render times:', times.join('; '));
  });
});

type Call = [string, ...unknown[]];
function fakeCanvas(calls: Call[], name: string): FoilCanvas {
  const ctx = {
    imageSmoothingEnabled: false as boolean, imageSmoothingQuality: '' as string, globalAlpha: 1, globalCompositeOperation: 'source-over',
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (...a: unknown[]) => calls.push([`${name}.putImageData`, ...a]),
    drawImage: (...a: unknown[]) => calls.push([`${name}.drawImage`, ...a]),
    setTransform: (...a: unknown[]) => calls.push([`${name}.setTransform`, ...a]),
    clearRect: (...a: unknown[]) => calls.push([`${name}.clearRect`, ...a]),
    fillRect: () => {}, fillStyle: '', createRadialGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {}, ellipse: () => {}, fill: () => {}, save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
    set _g(_v: unknown) {},
  };
  return { width: 0, height: 0, getContext: () => ctx } as unknown as FoilCanvas;
}

describe('draw, against a fake context', () => {
  function run(mode: Board, now: number, idle: boolean, light = REST) {
    const calls: Call[] = [];
    let n = 0;
    const foil = makeFoil({ seed: 's', pattern: 'prism', palette: PALETTES[mode], stars: 8, createCanvas: () => fakeCanvas(calls, `c${n++}`) });
    const ctx = fakeCanvas(calls, 'ctx').getContext('2d') as unknown as CanvasRenderingContext2D;
    foil.draw(ctx, { w: 300, h: 120 }, 2, light, bands[mode], now, idle);
    return { calls, foil, ctx };
  }
  const names = (c: Call[]) => c.map((x) => x[0]);

  test('puts the grid, draws it scaled to the box at the density, then the starbursts on top', () => {
    const { calls } = run('light', 0, false);
    const n = names(calls);
    assert.ok(n.some((x) => x.endsWith('putImageData')));
    const grid = calls.find((c) => c[0] === 'ctx.drawImage' && c[4] === 300 && c[5] === 120);
    assert.ok(grid, 'the grid is drawn scaled to 300 x 120 CSS px');
    assert.ok(calls.some((c) => c[0] === 'ctx.setTransform' && c[1] === 2 && c[4] === 2), 'at the density');
    const stars = calls.filter((c) => c[0] === 'ctx.drawImage' && c !== grid);
    assert.ok(stars.length > 0 && stars.length <= 8);
    assert.ok(calls.indexOf(stars[0]!) > calls.indexOf(grid!), 'stars come after');
  });

  test('on the dark board the starbursts have no alpha and are not drawn', () => {
    const { calls } = run('dark', 0, true);
    assert.equal(calls.filter((c) => c[0] === 'ctx.drawImage').length, 1, 'only the grid');
  });

  test('the idle wink raises a starburst that the light is not facing', () => {
    const alphas = (idle: boolean, now: number) => {
      const seen: number[] = [];
      const calls: Call[] = [];
      const foil = makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.light, stars: 10, createCanvas: () => fakeCanvas(calls, 'c') });
      const ctx = fakeCanvas(calls, 'ctx').getContext('2d') as unknown as CanvasRenderingContext2D;
      const orig = ctx.drawImage.bind(ctx);
      (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage = (...a: unknown[]) => { seen.push(ctx.globalAlpha); orig(...(a as Parameters<typeof orig>)); };
      foil.draw(ctx, { w: 600, h: 200 }, 1, { x: 1.5, y: 1.5 }, bands.light, now, idle);
      return Math.max(...seen.slice(1));
    };
    let best = 0;
    for (let ms = 0; ms < 8000; ms += 250) best = Math.max(best, alphas(true, ms) - alphas(false, ms));
    assert.ok(best > 0.3, `the wink adds ${best}`);
  });

  test('release drops the image and the facet map; drawing again builds them again', () => {
    const { foil, ctx } = run('light', 0, false);
    assert.ok(foil.holds());
    foil.release();
    assert.ok(!foil.holds());
    foil.draw(ctx, { w: 300, h: 120 }, 1, REST, bands.light, 0, false);
    assert.ok(foil.holds());
  });
});

void toSrgb8;
