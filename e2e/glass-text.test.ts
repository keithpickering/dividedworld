// @vitest-environment node
/**
 * The rendered glass measurement's self-test: the judgment e2e/glass-text.spec.ts makes of every
 * text node on a glass page (e2e/glass-text.ts), driven red on plain data by each defect it exists
 * to catch. A Vitest file, not a Playwright spec (vitest.config.ts includes `e2e/**\/*.test.ts`),
 * because the judgment needs no browser: the spec gathers each node's facts in the page and hands
 * them to these same functions. Each poison starts from a node that passes and breaks one thing, so
 * a check that has gone quiet cannot pass the case that breaks it, and the first case asserts the
 * clean node passes.
 *
 * The poisons are the web plan's five (the glass amendment to Task 12: a calm moved off its text, a
 * feather that reaches into the text, a 19px label, a translucent text color, under high contrast a
 * line left on the smoke) and the glass plan's section 6 two (on a `calmAll` surface the heading
 * moved out of its calm; a class's large text on a surface the engine's list says does not draw
 * it). The ceilings are the committed ones (e2e/glass-ceilings.json), the palette Divided World's.
 */
import { readFileSync } from 'node:fs';
// @ts-expect-error jsdom ships no declarations in this repository; only the document it builds is used.
import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import {
  isSkipped, judge, paletteOf, pixelStats, within, type Backing, type CeilingsFile, type GlassColors, type TextFact,
} from './glass-text.ts';

const glass = JSON.parse(readFileSync(new URL('../instances/divided-world/ui/glass.json', import.meta.url), 'utf8')) as GlassColors;
const ceilings = (JSON.parse(readFileSync(new URL('./glass-ceilings.json', import.meta.url), 'utf8')) as CeilingsFile)['divided-world']!.surfaces;
const standard = paletteOf(glass, 'standard');
const high = paletteOf(glass, 'high');

const TEXT: TextFact['color'] = [241, 236, 255, 1]; // --kb-glass-text
const TEXT_2: TextFact['color'] = [228, 222, 247, 1]; // --kb-glass-text-2
const LINE = { x: 100, y: 200, width: 400, height: 25 };
/** A calm around LINE: its backing reaches the feather past the words, so its interior is the words' own block. */
const calmAround = (box = LINE, feather = 32): TextFact['calm'] => ({
  backing: { x: box.x - feather, y: box.y - feather, width: box.width + 2 * feather, height: box.height + 2 * feather },
  feather,
  box,
  opacity: 0.85,
});

/** A 21px body line of --kb-glass-text-2 in a calm on the rankings page, over a quiet pixel: it passes. */
const body: TextFact = {
  name: '"Every character this season" in p.kb-rankings-lead',
  surface: 'rankings',
  box: LINE,
  color: TEXT_2,
  family: 'Barlow Condensed',
  size: 21,
  weight: 600,
  ink: 18.9,
  calm: calmAround(),
  calmOpacity: 0.85,
  panels: [],
  brightest: 0.02,
  smoke: 40,
};
/** A 52px Anton heading of --kb-glass-text on the full smoke of the rankings page: large, so no calm, under the large ceiling. */
const heading: TextFact = {
  ...body, name: '"Rankings" in h1.kb-rankings-title', color: TEXT, family: 'Anton', size: 52, ink: 51.5, weight: 400, calm: null, brightest: 0.23,
};
const judged = (fact: TextFact, surface = fact.surface, opts: { phone?: boolean; palette?: typeof standard; high?: boolean } = {}) =>
  judge(fact, { ceilings: ceilings[surface], palette: opts.palette ?? standard, phone: opts.phone ?? false, high: opts.high ?? false });

describe('the clean nodes pass', () => {
  test('a body line in its calm, and a large heading on the full smoke under its large ceiling', () => {
    expect(judged(body)).toEqual([]);
    expect(judged(heading)).toEqual([]);
  });

  test('a body line on a panel at least as solid as the calm needs no calm of its own', () => {
    const panel: Backing = { box: { x: 0, y: 0, width: 1440, height: 85 }, opacity: 0.88 };
    expect(judged({ ...body, calm: null, box: { x: 40, y: 30, width: 90, height: 25 }, panels: [panel] })).toEqual([]);
  });

  test('a class\'s large text on a surface whose list draws it on the full smoke, under that class\'s ceiling', () => {
    const face: TextFact = { ...heading, name: '"Face" in span.kb-turn-class', surface: 'turn', color: [143, 214, 255, 1], family: 'Anton', size: 40, ink: 39.6, brightest: 0.11 };
    expect(judged(face)).toEqual([]);
  });

  test('a class\'s large color at WCAG\'s large size stands on its surface\'s smoke, as the React picker\'s labels do (#54)', () => {
    /* The quadrant labels: a class's large colors at 24px of Anton, bare on the react smoke. */
    const heat: TextFact = { ...heading, name: '"Heat" in div.kb-picker-label', surface: 'react', color: [255, 149, 159, 1], size: 24, ink: 23.8, weight: 400, brightest: 0.08 };
    expect(judged(heat)).toEqual([]);
  });

  test('under that size a class\'s large color takes the body path, and Heel\'s fails bare on the react smoke', () => {
    /* #ff959f's 4.5:1 ceiling, worked out from its color, is 0.0617; the react recipe's full worst is 0.0875. */
    const heat: TextFact = { ...heading, name: '"Heat" in div.kb-picker-label', surface: 'react', color: [255, 149, 159, 1], size: 22, ink: 21.8, weight: 400, brightest: 0.04 };
    expect(judged(heat)).toEqual([
      '"Heat" in div.kb-picker-label (surface react): stands in no calm and on no panel as solid as the calm (0.85), and its recipe\'s full worst, 0.0875, is not under the ceiling 0.0617 for class heel\'s large color as body text on surface react (recipe react); a class\'s large color under WCAG\'s large size (this is 22px at weight 400) stands in a calm on surface react (recipe react)',
    ]);
    expect(judged({ ...heat, calm: calmAround() })).toEqual([]);
  });

  test('a token tagged large stands on the full smoke from WCAG\'s large size: 18.66px at weight 700 or more', () => {
    const label: TextFact = { ...body, name: '"Season 1" in p.kb-rankings-season', color: TEXT, size: 20, ink: 18.4, weight: 800, calm: null, brightest: 0.2 };
    expect(judged(label)).toEqual([]);
    expect(judged({ ...label, weight: 600 })[0]).toMatch(/stands in no calm/);
  });

  test('a color a token and a class share reads as whichever the surface allows', () => {
    /* #ffe27a is --kb-glass-ready-text (body only) and Jabroni's large text: large on react, it is Jabroni's. */
    const gold: TextFact = { ...heading, surface: 'react', color: [255, 226, 122, 1], brightest: 0.08 };
    expect(judged(gold)).toEqual([]);
  });
});

describe('the web plan\'s five poisons', () => {
  test('a calm moved off its text', () => {
    const moved = calmAround({ ...LINE, x: LINE.x + 600 });
    const found = judged({ ...body, calm: moved });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^"Every character this season" in p\.kb-rankings-lead \(surface rankings\): lies outside its calm's interior/);
  });

  test('a feather that reaches into the text', () => {
    /* The backing drawn on the words' own box: its 32px feather ramps over the words' edges. */
    const tight = { backing: LINE, feather: 32, box: { x: LINE.x + 32, y: LINE.y + 32, width: LINE.width - 64, height: 0 }, opacity: 0.85 };
    const found = judged({ ...body, calm: tight });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/lies outside its calm's interior \(its backing inset by its 32px feather\)/);
  });

  test('a 19px label', () => {
    const found = judged({ ...body, name: '"Rankings" in a.kb-glass-menu-tab', size: 19, ink: 17.29 });
    expect(found).toEqual(['"Rankings" in a.kb-glass-menu-tab (surface rankings): inks 17.3px at 19px of Barlow Condensed, under the floor of 18px of ink']);
  });

  test('on the phone the floor is 16px of computed size', () => {
    expect(judged({ ...body, size: 16, ink: 14.4 }, 'rankings', { phone: true })).toEqual([]);
    expect(judged({ ...body, size: 15, ink: 13.5 }, 'rankings', { phone: true })).toEqual([
      '"Every character this season" in p.kb-rankings-lead (surface rankings): is 15px of Barlow Condensed, under the phone\'s floor of 16px',
    ]);
  });

  test('a translucent text color', () => {
    const found = judged({ ...body, color: [241, 236, 255, 0.8] });
    expect(found).toEqual(['"Every character this season" in p.kb-rankings-lead (surface rankings): its color rgba(241, 236, 255, 0.8) is translucent; glass type is opaque']);
  });

  test('under high contrast, one line left on the smoke', () => {
    const solid: TextFact = { ...body, color: [241, 236, 255, 1], smoke: 0 };
    expect(judged(solid, 'rankings', { palette: high, high: true })).toEqual([]);
    const found = judged({ ...solid, smoke: 37 }, 'rankings', { palette: high, high: true });
    expect(found).toEqual(['"Every character this season" in p.kb-rankings-lead (surface rankings): under high contrast the smoke shows through under it (it changes a channel by 37 levels), not solid ground']);
  });

  test('under high contrast, a line on solid ground that is too bright for its color', () => {
    /* #ffffff at 7:1 needs ground under 0.1 of luminance: a solid ground of 0.2 is no smoke and still too bright. */
    const white: TextFact = { ...body, color: [255, 255, 255, 1], smoke: 0, brightest: 0.2 };
    expect(judged({ ...white, brightest: 0.02 }, 'rankings', { palette: high, high: true })).toEqual([]);
    expect(judged(white, 'rankings', { palette: high, high: true })).toEqual([
      '"Every character this season" in p.kb-rankings-lead (surface rankings): under high contrast its brightest pixel, luminance 0.2000, is not under the 7:1 ceiling 0.1 for its color, rgb(255, 255, 255)',
    ]);
  });

  test('under high contrast an ink is read on its fill, not against a ceiling over a ground', () => {
    const ink: TextFact = { ...body, color: [0, 0, 0, 1], smoke: 0, brightest: 0.62, calm: null };
    expect(judged({ ...ink, panels: [{ box: { x: 90, y: 190, width: 420, height: 45 }, opacity: 1 }] }, 'rankings', { palette: high, high: true })).toEqual([]);
    expect(judged(ink, 'rankings', { palette: high, high: true })[0]).toMatch(/is ink, and stands on no opaque fill/);
  });

  test('under high contrast, a line in a color the high key does not name', () => {
    /* #e4def7 is the standard key's --kb-glass-text-2; the high key lifts it to #f1ecff. */
    const found = judged({ ...body, color: [228, 222, 247, 1], smoke: 0 }, 'rankings', { palette: high, high: true });
    expect(found).toEqual(['"Every character this season" in p.kb-rankings-lead (surface rankings): its color rgb(228, 222, 247) is not one of the glass\'s text colors in the high key']);
  });
});

describe('a recipe dim enough (the owner\'s answer on #53)', () => {
  /* A body line of --kb-glass-text-2 with no calm and no panel, on the bare smoke. */
  const bare: TextFact = { ...body, calm: null, panels: [], brightest: 0.05 };

  test('on a recipe whose full worst is under its color\'s ceiling, a line needs no calm', () => {
    /* The turn recipe's full worst, 0.116, is under --kb-glass-text-2's body ceiling, 0.1288. */
    expect(judged({ ...bare, surface: 'turn' })).toEqual([]);
  });

  test('the same line on a brighter recipe still needs one, and says the worst and the ceiling', () => {
    expect(judged({ ...bare, surface: 'characters' })).toEqual([
      '"Every character this season" in p.kb-rankings-lead (surface characters): stands in no calm and on no panel as solid as the calm (0.85), and its recipe\'s full worst, 0.196, is not under the ceiling 0.1288 for --kb-glass-text-2 as body text on surface characters (recipe characters); text under the large size (this inks 18.9px at 21px) stands in a calm on surface characters (recipe characters)',
    ]);
  });

  test('a color whose ceiling is under the dim recipe\'s worst still needs a calm there', () => {
    /* --kb-glass-salty-text's body ceiling is 0.0697, under the turn recipe's 0.116. */
    expect(judged({ ...bare, surface: 'turn', color: [255, 156, 192, 1] })[0]).toMatch(/its recipe's full worst, 0\.1167, is not under the ceiling 0\.0697 for --kb-glass-salty-text/);
  });

  test('on the phone the worst is the larger of the recipe\'s layers and its narrow ones', () => {
    /* The hud recipe: 0.2161 wide, 0.2492 narrow; neither is under any body ceiling. */
    expect(judged({ ...bare, surface: 'hud' }, 'hud', { phone: true })[0]).toMatch(/its recipe's full worst, 0\.2492, is not under/);
  });

  test('a calmAll surface still needs a calm, whatever its worst', () => {
    expect(judged({ ...bare, surface: 'settlement' })[0]).toMatch(/is calmAll: every text node on it stands in a calm/);
  });
});

describe('the ceilings', () => {
  test('a pixel at a body ceiling fails, naming the token, the tag, the surface and the ceiling', () => {
    const found = judged({ ...body, brightest: 0.1288 });
    expect(found).toEqual(['"Every character this season" in p.kb-rankings-lead (surface rankings): its brightest pixel, luminance 0.1288, is not under the ceiling 0.1288 for --kb-glass-text-2 as body text on surface rankings (recipe page)']);
  });

  test('a large heading over its large ceiling fails', () => {
    expect(judged({ ...heading, brightest: 0.26 })[0]).toMatch(/luminance 0\.2600, is not under the ceiling 0\.253 for --kb-glass-text as large text on surface rankings/);
  });

  test('large text in a token not tagged large needs a calm like body text', () => {
    /* #9ef4ff is body and waiting, never large: a large heading in it takes a calm (the design, section 4). */
    expect(judged({ ...heading, color: [158, 244, 255, 1] })[0]).toMatch(/stands in no calm and on no panel as solid as the calm/);
  });

  test('a color that is no text token fails by name', () => {
    expect(judged({ ...body, color: [255, 43, 214, 1] })).toEqual([
      '"Every character this season" in p.kb-rankings-lead (surface rankings): its color rgb(255, 43, 214) is not one of the glass\'s text colors in the standard key',
    ]);
  });

  test('ink on a fill stands on that fill, opaque, and has no ceiling over the smoke', () => {
    const ink: TextFact = { ...body, color: [3, 20, 26, 1], calm: null, brightest: 0.7 };
    expect(judged({ ...ink, panels: [{ box: { x: 90, y: 190, width: 420, height: 45 }, opacity: 1 }] })).toEqual([]);
    expect(judged(ink)[0]).toMatch(/is ink, and stands on no opaque fill/);
  });

  test('a panel thinner than the calm is not one', () => {
    const thin: Backing = { box: { x: 0, y: 0, width: 1440, height: 400 }, opacity: 0.72 };
    expect(judged({ ...body, calm: null, panels: [thin] })[0]).toMatch(/stands in no calm and on no panel as solid as the calm \(0\.85\)/);
  });
});

describe('the glass plan\'s section 6', () => {
  test('on a calmAll surface the heading moved out of its calm fails, large as it is', () => {
    const settled: TextFact = { ...heading, name: '"Settled" in h1.kb-settlement-head', surface: 'settlement', brightest: 0.02 };
    expect(judged({ ...settled, calm: calmAround() })).toEqual([]);
    expect(judged(settled)).toEqual([
      '"Settled" in h1.kb-settlement-head (surface settlement): stands in no calm and on no panel as solid as the calm (0.85); surface settlement (recipe settlement) is calmAll: every text node on it stands in a calm, large or not',
    ]);
  });

  test('a class\'s large text on a surface the list says does not draw it fails: there is no ceiling for it', () => {
    const face: TextFact = { ...heading, name: '"Face" in span.x', surface: 'characters', color: [143, 214, 255, 1], calm: calmAround(), brightest: 0.02 };
    expect(judged(face)).toEqual([
      '"Face" in span.x (surface characters): is class face\'s large text, and surface characters draws no class\'s large text (classLargeText says none), so it has no ceiling there',
    ]);
  });

  test('where the list says a class\'s large text is drawn in a calm, it needs one', () => {
    const face: TextFact = { ...heading, name: '"Face" in span.x', surface: 'settlement', color: [143, 214, 255, 1], brightest: 0.02 };
    expect(judged({ ...face, calm: calmAround() })).toEqual([]);
    expect(judged(face)[0]).toMatch(/stands in no calm/);
  });
});

describe('the geometry and the pixels', () => {
  test('within allows half a pixel and no more', () => {
    const outer = { x: 0, y: 0, width: 100, height: 20 };
    expect(within({ x: -0.5, y: 0, width: 100.5, height: 20 }, outer)).toBe(true);
    expect(within({ x: -0.6, y: 0, width: 100, height: 20 }, outer)).toBe(false);
  });

  test('the brightest pixel, and what the smoke changes, are read inside the box only', () => {
    const w = 4;
    const h = 3;
    const shot = () => new Uint8ClampedArray(w * h * 4);
    const put = (data: Uint8ClampedArray, x: number, y: number, rgb: [number, number, number]) => data.set([...rgb, 255], (y * w + x) * 4);
    const data = shot();
    const bare = shot();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { put(data, x, y, [10, 10, 10]); put(bare, x, y, [10, 10, 10]); }
    put(data, 3, 0, [255, 255, 255]); // outside the box
    put(data, 1, 1, [77, 126, 247]); // the smoke's worst, inside
    put(data, 2, 2, [40, 40, 40]); // a glow, there with or without the smoke
    put(bare, 2, 2, [40, 40, 40]);
    const got = pixelStats(data, w, h, { x: 0, y: 1, width: 3, height: 2 }, bare);
    expect(got.brightest).toBeCloseTo(0.2321, 3);
    /* The smoke moved the blue channel from 10 to 247; the glow is the same in both and is no smoke. */
    expect(got.smoke).toBe(237);
    expect(pixelStats(bare, w, h, { x: 0, y: 1, width: 3, height: 2 }, bare).smoke).toBe(0);
    /* With no smokeless shot there is nothing to compare: no smoke is read. */
    expect(pixelStats(data, w, h, { x: 0, y: 1, width: 3, height: 2 }).smoke).toBe(0);
  });
});

describe('what the measurement does not read', () => {
  const page = (new JSDOM(`<body>
    <div class="kb-glass-overlay">
      <p id="outside">Glass words</p>
      <article class="kb-hold-post"><b id="inside">The board's post</b><span><i id="deeper">deeper still</i></span></article>
      <p class="kb-hold-post-line" id="lookalike">A glass line whose class only starts like the board's</p>
      <span data-kb-art><b id="art">VEND</b></span>
      <div class="kb-hand-board-post-bar"><span id="bar">Spritey · #41</span></div>
      <div class="kb-hand-board-post-foot"><span id="foot">quote</span></div>
      <p class="kb-hand-board-post-barely" id="barLookalike">A glass line whose class only starts like the bar's</p>
      <p class="kb-hand-board-post-footer" id="footLookalike">A glass line whose class only starts like the foot's</p>
    </div></body>`) as { window: { document: Document } }).window.document;
  const at = (id: string) => page.getElementById(id)!;

  test('a node inside the post Stick Around lifts is skipped, however deep, and a glass line beside it is not', () => {
    expect(isSkipped(at('inside'))).toBe(true);
    expect(isSkipped(at('deeper'))).toBe(true);
    expect(isSkipped(at('outside'))).toBe(false);
    expect(isSkipped(at('lookalike'))).toBe(false);
  });

  test('a node inside the 2003 window\'s post bar or foot on the hand sheet\'s story is skipped, and one outside them is not', () => {
    expect(isSkipped(at('bar'))).toBe(true);
    expect(isSkipped(at('foot'))).toBe(true);
    expect(isSkipped(at('outside'))).toBe(false);
    expect(isSkipped(at('barLookalike'))).toBe(false);
    expect(isSkipped(at('footLookalike'))).toBe(false);
  });

  test('the instance\'s art is skipped too', () => {
    expect(isSkipped(at('art'))).toBe(true);
  });
});
