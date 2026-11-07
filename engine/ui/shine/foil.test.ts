import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf, type Mode } from '../contrast.ts';
import { bandOf, shineIsReadable, toLinear, type Band } from './band.ts';
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
/* Divided World's glint (instances/divided-world has the real one; the engine may not import it). */
const GLINT = '#ffffff';
const PATTERNS = ['pearl', 'bands', 'prism'] as const;
const modeOf = (band: Band): Board => (band.hi < 0.5 ? 'dark' : 'light');
const foilFor = (pattern: (typeof PATTERNS)[number], mode: Board, seed = 'play:post', palette = PALETTES[mode]) =>
  makeFoil({ seed, pattern, palette, stars: 8, glint: GLINT });

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
        modeOf(bandOf(tokens[mode])) === 'dark' ? new Set(sampleFoil(foil, { w: 60, h: 30 }, light, open)) : []);
      assert.ok(red.length > 0, `${pattern}: an unclamped white stop must fail the check`);
      const held = shineIsReadable(tokens, (mode, light) =>
        modeOf(bandOf(tokens[mode])) === 'dark' ? new Set(sampleFoil(foil, { w: 120, h: 60 }, light, bandOf(tokens[mode]))) : []);
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

  test('the cell map holds more than 65,535 facets without wrapping', () => {
    const map = foilFor('prism', 'light').facets({ w: 800, h: 24000 });
    assert.ok(map instanceof Uint32Array);
    let max = 0;
    for (let i = 0; i < map.length; i++) if (map[i]! > max) max = map[i]!;
    assert.ok(max > 65535, `the largest facet id is ${max}`);
  });

  /* The bytes of every pattern on both boards, at two boxes (one ragged) and six lights, as the bench's per-cell code wrote them
   * before the render precomputed what the light does not move (3d6e4fa). The faster render must write the same bytes. */
  const BYTES: Record<string, string> = {
    'pearl/light': '635afb47213222bf2911710f023f25371eb7004607e93295c0f39e9dc447f4f7',
    'pearl/dark': '8a83d47ce72381ccce2143559f4714162ab9f7d7a2428940e9be5f52cb99c5c7',
    'bands/light': '3e25f9eef716cc751b9070662b6d30fe440b98b7ee6a011480acd41b795bf3e5',
    'bands/dark': 'cd1005e3c5f9579e644c7c8044843d69da0d815c0d3b823f60355cb801484ae3',
    'prism/light': '33ef4409f395f93ac67eae0c7f310d7703b5f2be19c1071ad32a8e43feb9a289',
    'prism/dark': 'e5a27e75964abd4ed6cc5163c7a857abd595155eb918e0d44bcbb7bfb6b13736',
  };
  const LIGHTS = [REST, { x: -1.5, y: -1.5 }, { x: 1.5, y: 1.5 }, { x: 0.4, y: -0.3 }, { x: -0.9, y: 1.2 }, { x: 0.05, y: 0.77 }];
  const digest = (pattern: (typeof PATTERNS)[number], mode: Board, palette = PALETTES[mode]): string => {
    const h = createHash('sha256');
    for (const box of [{ w: 988, h: 300 }, { w: 301, h: 121 }]) {
      const foil = foilFor(pattern, mode, 'play:post', palette);
      const px = new Uint8ClampedArray(Math.ceil(box.w / 3) * Math.ceil(box.h / 3) * 4);
      for (const light of LIGHTS) { foil.render(box, light, bands[mode], px); h.update(px); }
    }
    return h.digest('hex');
  };

  test('every pattern writes the bench\'s bytes, to the last bit, on both boards at six lights', () => {
    for (const pattern of PATTERNS) {
      for (const mode of ['light', 'dark'] as const) assert.equal(digest(pattern, mode), BYTES[`${pattern}/${mode}`], `${pattern}/${mode}`);
    }
  });

  test('POISON: one stop moved by one step of eight bits changes the digest', () => {
    const moved = ['#ffb9bf', ...PALETTES.light.slice(1)];
    for (const pattern of PATTERNS) assert.notEqual(digest(pattern, 'light', moved), BYTES[`${pattern}/light`], pattern);
  });

  /* A scroll redraws every post in view each frame, about five of them (the design's section 6), so one render is a fifth of the
   * page's frame at most. Measured at 1.1 to 1.8 ms a render here (the bench's per-cell code took 5.4 to 9.4); the bound is
   * about twice the slowest, so a render that slides back toward the old cost goes red. The best of three renders is timed, so
   * one collector pause on a busy machine does not count. */
  test('one 988 x 300 render takes under 4ms in Node', () => {
    const box = { w: 988, h: 300 };
    const px = new Uint8ClampedArray(Math.ceil(box.w / 3) * Math.ceil(box.h / 3) * 4);
    const times: string[] = [];
    for (const pattern of PATTERNS) {
      for (const mode of ['light', 'dark'] as const) {
        const foil = foilFor(pattern, mode);
        for (let k = 0; k < 20; k++) foil.render(box, { x: k * 0.05, y: -k * 0.03 }, bands[mode], px);
        let ms = Infinity;
        for (let k = 0; k < 3; k++) {
          const t0 = performance.now();
          foil.render(box, { x: 0.2 + k * 0.01, y: 0.1 }, bands[mode], px);
          ms = Math.min(ms, performance.now() - t0);
        }
        times.push(`${pattern}/${mode} ${ms.toFixed(1)}ms`);
        assert.ok(ms < 4, `${pattern}/${mode} took ${ms}ms`);
      }
    }
    console.log('render times:', times.join('; '));
  });
});

type Call = [string, ...unknown[]];
type Fake = FoilCanvas & { name: string };
function fakeCanvas(calls: Call[], name: string, w = 0, h = 0, getNull = false): Fake {
  const ctx = {
    imageSmoothingEnabled: false as boolean, imageSmoothingQuality: '' as string, globalAlpha: 1, globalCompositeOperation: 'source-over',
    createImageData: (cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
    putImageData: (img: ImageData, ...a: unknown[]) => calls.push([`${name}.putImageData`, new Uint8ClampedArray(img.data), ...a]),
    drawImage: (...a: unknown[]) => calls.push([`${name}.drawImage`, ...a]),
    setTransform: (...a: unknown[]) => calls.push([`${name}.setTransform`, ...a]),
    clearRect: (...a: unknown[]) => calls.push([`${name}.clearRect`, ...a]),
    fillRect: () => {}, fillStyle: '', createRadialGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {}, ellipse: () => {}, fill: () => {}, translate: () => {}, rotate: () => {},
    rect: (...a: unknown[]) => calls.push([`${name}.rect`, ...a]), clip: () => calls.push([`${name}.clip`]),
    save: () => calls.push([`${name}.save`]), restore: () => calls.push([`${name}.restore`]),
  };
  const canvas = { name, width: w, height: h, getContext: () => (getNull ? null : ctx) } as unknown as Fake;
  Object.assign(ctx, { canvas });
  return canvas;
}

describe('a coarser cell (FoilOptions.cell)', () => {
  /* A body twice the words' area is drawn with as many cells as the words had (engine/ui/cards/body.ts `paintScale`): the work is a cell's. */
  test('a foil of cell 6 works a quarter of the cells of one of cell 3, each in the band, and the default is 3', () => {
    const box = { w: 300, h: 120 };
    for (const pattern of PATTERNS) {
      for (const mode of ['light', 'dark'] as const) {
        const fine = makeFoil({ seed: 's', pattern, palette: PALETTES[mode], stars: 8, glint: GLINT });
        const coarse = makeFoil({ seed: 's', pattern, palette: PALETTES[mode], stars: 8, glint: GLINT, cell: 6 });
        assert.equal(fine.cell, 3);
        assert.equal(coarse.cell, 6);
        const a = sampleFoil(fine, box, REST, bands[mode]), b = sampleFoil(coarse, box, REST, bands[mode]);
        assert.equal(a.length, 100 * 40);
        assert.equal(b.length, 50 * 20);
      }
      /* The coarse cells are as readable under every ink as the fine ones: the check every foil passes. */
      const coarse = new Map<string, ReturnType<typeof makeFoil>>();
      const failures = shineIsReadable(tokens, (mode, light) => {
        const band = bandOf(tokens[mode]);
        if (!coarse.has(mode)) coarse.set(mode, makeFoil({ seed: 'play:post', pattern, palette: PALETTES[modeOf(band)], stars: 8, glint: GLINT, cell: 6 }));
        return new Set(sampleFoil(coarse.get(mode)!, { w: 240, h: 120 }, light, band));
      });
      assert.deepEqual(failures.slice(0, 3), [], `${pattern}`);
    }
  });
  test('a cell under 3, or one that is not a number, is 3', () => {
    for (const cell of [1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.light, stars: 0, glint: GLINT, cell }).cell, 3, String(cell));
    }
  });
});

describe('draw, against a fake context', () => {
  function run(mode: Board, now: number, idle: boolean, light = REST) {
    const calls: Call[] = [];
    const made: Fake[] = [];
    const foil = makeFoil({ seed: 's', pattern: 'prism', palette: PALETTES[mode], stars: 8, glint: GLINT, createCanvas: (w, h) => { const c = fakeCanvas(calls, `c${made.length}`, w, h); made.push(c); return c; } });
    const ctx = fakeCanvas(calls, 'ctx', 600, 240).getContext('2d') as unknown as CanvasRenderingContext2D;
    foil.draw(ctx, { w: 300, h: 120 }, 2, light, bands[mode], now, idle);
    return { calls, foil, ctx, made };
  }
  const names = (c: Call[]) => c.map((x) => x[0]);

  test('puts the grid, draws it scaled over every device pixel of the canvas with bilinear smoothing and no clear, then the starbursts on top at the density', () => {
    const calls: Call[] = [];
    const smoothing: string[] = [];
    const foil = makeFoil({ seed: 's', pattern: 'prism', palette: PALETTES.light, stars: 8, glint: GLINT, createCanvas: (w, h) => fakeCanvas(calls, 'c', w, h) });
    const ctx = fakeCanvas(calls, 'ctx', 600, 240).getContext('2d') as unknown as CanvasRenderingContext2D;
    const draw = ctx.drawImage.bind(ctx);
    (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage = (...a: unknown[]) => { smoothing.push(`${ctx.imageSmoothingEnabled}:${ctx.imageSmoothingQuality}`); draw(...(a as Parameters<typeof draw>)); };
    foil.draw(ctx, { w: 300, h: 120 }, 2, REST, bands.light, 0, false);
    const n = names(calls);
    assert.ok(n.some((x) => x.endsWith('putImageData')));
    const at = calls.findIndex((c) => c[0] === 'ctx.drawImage');
    assert.deepEqual(calls[at]!.slice(2), [0, 0, 100, 40, 0, 0, 600, 240], 'the whole grid over the whole 600 x 240 canvas');
    assert.ok(calls.slice(0, at).some((c) => c[0] === 'ctx.setTransform' && c[1] === 1 && c[4] === 1), 'in device px');
    /* A 'high' smoothing of a post-sized canvas every frame, and a clear before it, cost a slow machine a frame in two (foil.ts). */
    assert.equal(smoothing[0], 'true:low', 'bilinear');
    assert.ok(!n.includes('ctx.clearRect'), 'the opaque grid covers the canvas: no clear');
    assert.ok(calls.slice(at).some((c) => c[0] === 'ctx.setTransform' && c[1] === 2 && c[4] === 2), 'the starbursts at the density');
    const stars = calls.filter((c, i) => c[0] === 'ctx.drawImage' && i !== at);
    assert.ok(stars.length > 0 && stars.length <= 8);
    assert.ok(calls.indexOf(stars[0]!) > at, 'stars come after');
  });

  test('the starburst sprite is built from the glint it is handed', () => {
    const stops: string[] = [];
    const calls: Call[] = [];
    const sprite = (w: number, h: number) => {
      const c = fakeCanvas(calls, 's', w, h);
      const ctx = c.getContext('2d') as unknown as { createRadialGradient: () => unknown };
      const orig = ctx.createRadialGradient.bind(ctx);
      ctx.createRadialGradient = () => { const gr = orig() as { addColorStop: (o: number, s: string) => void }; const add = gr.addColorStop.bind(gr); gr.addColorStop = (o, s) => { stops.push(s); add(o, s); }; return gr; };
      return c;
    };
    for (const glint of ['#ffeecc', '#ffffff']) {
      const foil = makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.light, stars: 3, glint, createCanvas: sprite });
      const ctx = fakeCanvas(calls, 'ctx').getContext('2d') as unknown as CanvasRenderingContext2D;
      foil.draw(ctx, { w: 300, h: 120 }, 1, REST, bands.light, 0, false);
      assert.ok(stops.length >= 8, `${stops.length} stops`);
      assert.ok(stops.every((c) => c.startsWith(glint)), `${glint}: ${stops.join(' ')}`);
      assert.ok(stops.includes(`${glint}f2`) && stops.includes(`${glint}00`), 'the falloff keeps its alphas (0.95 and 0)');
      stops.length = 0;
    }
  });

  test('a glint that is not #rrggbb is refused by name', () => {
    assert.throws(() => makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.light, stars: 1, glint: 'white' }), /glint/);
  });

  test('on the dark board the starbursts have no alpha and are not drawn', () => {
    const { calls } = run('dark', 0, true);
    assert.equal(calls.filter((c) => c[0] === 'ctx.drawImage').length, 1, 'only the grid');
  });

  test('a dark board whose ceiling lets some light through still draws no white starburst', () => {
    // Pure white is inside a band only when its ceiling is 1; on any lower ceiling, ‘lighter’ white could lift a cell out.
    const calls: Call[] = [];
    const foil = makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.dark, stars: 10, glint: GLINT, createCanvas: () => fakeCanvas(calls, 'c') });
    const ctx = fakeCanvas(calls, 'ctx').getContext('2d') as unknown as CanvasRenderingContext2D;
    foil.draw(ctx, { w: 600, h: 200 }, 1, { x: 0, y: 0 }, { lo: 0, hi: 0.3 }, 0, false);
    assert.equal(calls.filter((c) => c[0] === 'ctx.drawImage').length, 1, 'only the grid');
  });

  test('the idle wink raises a starburst that the light is not facing', () => {
    const alphas = (idle: boolean, now: number) => {
      const seen: number[] = [];
      const calls: Call[] = [];
      const foil = makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.light, stars: 10, glint: GLINT, createCanvas: () => fakeCanvas(calls, 'c') });
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

  test('release drops the buffers and shrinks the canvases to nothing; drawing again builds them again', () => {
    const { foil, ctx, made } = run('light', 0, false);
    assert.ok(foil.holds());
    assert.ok(made.length >= 2 && made.every((c) => c.width > 0 && c.height > 0), 'a grid canvas and a sprite, both with size');
    foil.release();
    assert.ok(!foil.holds());
    assert.ok(made.every((c) => c.width === 0 && c.height === 0), 'every canvas it made is zeroed');
    foil.draw(ctx, { w: 300, h: 120 }, 1, REST, bands.light, 0, false);
    assert.ok(foil.holds());
  });

  test('a sub-pixel resize keeps the grid canvas, the image and the cell map', () => {
    const { foil, ctx, made } = run('light', 0, false);
    foil.draw(ctx, { w: 988, h: 300 }, 1, REST, bands.light, 0, false);
    const after = made.length;
    const map = foil.facets({ w: 988, h: 300 });
    foil.draw(ctx, { w: 988.4, h: 300.3 }, 1, REST, bands.light, 0, false);
    assert.equal(made.length, after, 'no canvas is made for a 0.4px change');
    assert.equal(foil.facets({ w: 988.4, h: 300.3 }), map, 'the same cell map');
  });

  test('a resize to a new whole-pixel size zeroes the old grid canvas before replacing it', () => {
    const { foil, ctx, made } = run('light', 0, false);
    foil.draw(ctx, { w: 600, h: 200 }, 1, REST, bands.light, 0, false);
    const old = made.filter((c) => c.width > 0).find((c) => c.width === Math.ceil(600 / 3));
    assert.ok(old, 'the 600px layout made a grid canvas');
    foil.draw(ctx, { w: 700, h: 200 }, 1, REST, bands.light, 0, false);
    assert.ok(old!.width === 0 && old!.height === 0, 'the old grid canvas is zeroed');
  });

  test('a box that is not a finite size does nothing: nothing is allocated, nothing throws', () => {
    const { foil, ctx, made, calls } = run('light', 0, false);
    foil.release();
    made.length = 0; calls.length = 0;
    for (const box of [{ w: NaN, h: 100 }, { w: 100, h: NaN }, { w: Infinity, h: 100 }, { w: 100, h: -Infinity }]) {
      foil.draw(ctx, box, 1, REST, bands.light, 0, false);
      foil.render(box, REST, bands.light, new Uint8ClampedArray(4));
      assert.equal(foil.facets(box).length, 0);
      assert.deepEqual(sampleFoil(foil, box, REST, bands.light), []);
    }
    assert.equal(made.length, 0, 'no canvas');
    assert.equal(calls.length, 0, 'no drawing');
    assert.ok(!foil.holds());
  });

  test('draw puts into the image the same bytes render gives for the same inputs', () => {
    const calls: Call[] = [];
    const foil = makeFoil({ seed: 's', pattern: 'prism', palette: PALETTES.light, stars: 0, glint: GLINT, createCanvas: (w, h) => fakeCanvas(calls, 'g', w, h) });
    const ctx = fakeCanvas(calls, 'ctx').getContext('2d') as unknown as CanvasRenderingContext2D;
    const box = { w: 301, h: 121 }, light = { x: 0.4, y: -0.3 };
    foil.draw(ctx, box, 1, light, bands.light, 0, false);
    const put = calls.find((c) => c[0] === 'g.putImageData')![1] as Uint8ClampedArray;
    const want = new Uint8ClampedArray(Math.ceil(301 / 3) * Math.ceil(121 / 3) * 4);
    foil.render(box, light, bands.light, want);
    assert.deepEqual(put, want);
  });

  test('draw leaves the context as it found it: save first, restore last, even when the grid canvas has no context', () => {
    const { calls } = run('light', 0, false);
    const mine = calls.filter((c) => c[0].startsWith('ctx.')).map((c) => c[0]);
    assert.equal(mine[0], 'ctx.save');
    assert.equal(mine[mine.length - 1], 'ctx.restore');
    assert.equal(mine.filter((x) => x === 'ctx.save').length, 1);
    assert.equal(mine.filter((x) => x === 'ctx.restore').length, 1);

    const calls2: Call[] = [];
    const foil = makeFoil({ seed: 's', pattern: 'pearl', palette: PALETTES.light, stars: 4, glint: GLINT, createCanvas: (w, h) => fakeCanvas(calls2, 'n', w, h, true) });
    const ctx = fakeCanvas(calls2, 'ctx').getContext('2d') as unknown as CanvasRenderingContext2D;
    foil.draw(ctx, { w: 300, h: 120 }, 1, REST, bands.light, 0, false);
    assert.deepEqual(calls2.map((c) => c[0]), ['ctx.save', 'ctx.restore']);
  });
});


/*
 * A draw handed a span (engine/ui/shine/loop.ts `ShineFrame.span`, issue #304) redraws only the rows of the box on screen: it renders
 * the grid's rows the span covers (and one more each side, so the smoothing at the span's edge reads fresh cells), puts only those, and
 * draws the grid clipped to the span. What is outside keeps the last draw's pixels, so a span is honored only after a whole draw of
 * this layout on a canvas of this size: a first draw, or one after a resize or a release, is whole.
 */
describe('a draw with a span', () => {
  const box = { w: 300, h: 600 };
  const gw = 100, gh = 200;
  function setup(pattern: (typeof PATTERNS)[number] = 'prism') {
    const calls: Call[] = [];
    const foil = makeFoil({ seed: 's', pattern, palette: PALETTES.light, stars: 8, glint: GLINT, createCanvas: (w, h) => fakeCanvas(calls, 'g', w, h) });
    const canvas = fakeCanvas(calls, 'ctx', 600, 1200);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    return { calls, foil, canvas, ctx };
  }
  const puts = (calls: Call[]) => calls.filter((c) => c[0] === 'g.putImageData');

  test('after a whole draw, it renders and puts only the span\'s rows and one either side, and clips the canvas draw to the span', () => {
    for (const pattern of PATTERNS) {
      const { calls, foil, ctx } = setup(pattern);
      foil.draw(ctx, box, 2, REST, bands.light, 0, false);
      const whole = puts(calls)[0]!;
      assert.deepEqual(whole.slice(2), [0, 0], `${pattern}: the first draw puts the whole grid`);
      calls.length = 0;
      const light = { x: 0.6, y: -0.4 };
      foil.draw(ctx, box, 2, light, bands.light, 0, false, { top: 150, bottom: 300 });
      const put = puts(calls)[0]!;
      /* Rows 150/3 - 1 = 49 to 300/3 + 1 = 101: 52 rows of the grid. */
      assert.deepEqual(put.slice(2), [0, 0, 0, 49, gw, 52], `${pattern}: only the span's rows are put`);
      const want = new Uint8ClampedArray(gw * gh * 4);
      foil.render(box, light, bands.light, want);
      const img = put[1] as Uint8ClampedArray, before = whole[1] as Uint8ClampedArray;
      const row = (a: Uint8ClampedArray, j: number) => a.subarray(j * gw * 4, (j + 1) * gw * 4);
      for (const j of [49, 75, 100]) assert.deepEqual(row(img, j), row(want, j), `${pattern}: row ${j} is this light's`);
      for (const j of [0, 48, 101, 199]) assert.deepEqual(row(img, j), row(before, j), `${pattern}: row ${j} is left as it was`);
      const clip = calls.findIndex((c) => c[0] === 'ctx.clip'), drawn = calls.findIndex((c) => c[0] === 'ctx.drawImage');
      assert.ok(clip >= 0 && clip < drawn, `${pattern}: clipped before the grid is drawn`);
      assert.deepEqual(calls.filter((c) => c[0] === 'ctx.rect')[0]!.slice(1), [0, 300, 600, 300], `${pattern}: the clip is the span, in device px`);
    }
  });

  test('a span on the first draw, after a resize, or after a release is ignored: the draw is whole', () => {
    const { calls, foil, canvas, ctx } = setup();
    const span = { top: 150, bottom: 300 };
    foil.draw(ctx, box, 2, REST, bands.light, 0, false, span);
    assert.deepEqual(puts(calls)[0]!.slice(2), [0, 0], 'the first draw');
    assert.ok(!calls.some((c) => c[0] === 'ctx.clip'));
    calls.length = 0;
    canvas.width = 640;
    foil.draw(ctx, box, 2, REST, bands.light, 0, false, span);
    assert.deepEqual(puts(calls)[0]!.slice(2), [0, 0], 'after the canvas was resized');
    calls.length = 0;
    foil.release();
    foil.draw(ctx, box, 2, REST, bands.light, 0, false, span);
    assert.deepEqual(puts(calls)[0]!.slice(2), [0, 0], 'after a release');
    calls.length = 0;
    foil.draw(ctx, box, 2, REST, bands.light, 0, false, span);
    assert.deepEqual(puts(calls)[0]!.slice(2), [0, 0, 0, 49, gw, 52], 'and then it is honored');
  });

  test('a span that covers the whole box, or none at all, draws whole', () => {
    const { calls, foil, ctx } = setup();
    foil.draw(ctx, box, 2, REST, bands.light, 0, false);
    calls.length = 0;
    foil.draw(ctx, box, 2, REST, bands.light, 0, false, { top: 0, bottom: 600 });
    assert.deepEqual(puts(calls)[0]!.slice(2), [0, 0]);
    assert.ok(!calls.some((c) => c[0] === 'ctx.clip'));
    calls.length = 0;
    foil.draw(ctx, box, 2, REST, bands.light, 0, false, null);
    assert.deepEqual(puts(calls)[0]!.slice(2), [0, 0]);
  });
});
