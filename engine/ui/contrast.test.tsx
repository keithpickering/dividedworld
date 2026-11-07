import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { PAIRS, backgroundStops, contrastFailures, darkBlocksDisagree, ratio, resolveToken, tokensOf, worstRatio } from './contrast.ts';

const engine = readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8');

/* The engine knows no instance: each instance's theme is swept in web/contrast.test.tsx, through the composition root. */
describe('color contrast of the engine tokens, light and dark', () => {
  test('the ratio is the WCAG one', () => {
    expect(ratio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(ratio('#777', '#fff')).toBeCloseTo(4.48, 1);
  });

  test('the engine defaults hold', () => {
    expect(contrastFailures(engine)).toEqual([]);
    expect(darkBlocksDisagree(engine)).toEqual([]);
  });
});

/* The period skin's tokens (docs/plans/2026-11-06-board-look-plan.md, Task 1). */
const THEME_LIGHT = (extra: string) => `${engine}\n:root { ${extra} }`;
const fails = (css: string) => contrastFailures(css);
/* A failure about the head band's text; the ring on the band is its own pair, held below. */
const headMsg = (x: string) => /head/u.test(x) && !/focus ring/u.test(x);

describe('the skin tokens: gradients are read stop by stop', () => {
  test('a head band running #fff to #2b2b2b under a #fff head text fails on the light stop', () => {
    const f = fails(THEME_LIGHT('--kb-head-bg: linear-gradient(#fff, #2b2b2b); --kb-head-fg: #fff;'));
    expect(f.some((x) => x.startsWith('light: ') && headMsg(x) && /1\.00:1/u.test(x))).toBe(true);
  });
  test('the same band under dark text fails on the dark stop, and a band both ends carry passes', () => {
    expect(fails(THEME_LIGHT('--kb-head-bg: linear-gradient(#fff, #2b2b2b); --kb-head-fg: #000;')).some((x) => headMsg(x))).toBe(true);
    expect(fails(THEME_LIGHT('--kb-head-bg: linear-gradient(to bottom, #fff 0%, #ddd 100%); --kb-head-fg: #000;')).filter((x) => headMsg(x))).toEqual([]);
  });
  test('layers are read too: every comma-separated layer, gradient or plain color', () => {
    const band = 'linear-gradient(#fff, #eee), repeating-linear-gradient(45deg, #ddd 0 2px, #2b2b2b 2px 4px), #fff';
    expect(fails(THEME_LIGHT(`--kb-head-bg: ${band}; --kb-head-fg: #000;`)).some((x) => headMsg(x))).toBe(true);
    expect(fails(THEME_LIGHT('--kb-head-bg: radial-gradient(circle at 50% 0%, #fff, #eee), #fff; --kb-head-fg: #000;')).filter((x) => headMsg(x))).toEqual([]);
  });
  test('a value it cannot parse fails the check rather than passing', () => {
    for (const bad of ['url(x.png)', 'linear-gradient(red, blue)', 'linear-gradient(#fff, rgb(0 0 0 / 0.5))', 'linear-gradient(#fff', 'conic-gradient(#fff, banana)']) {
      const f = fails(THEME_LIGHT(`--kb-head-bg: ${bad}; --kb-head-fg: #000;`));
      expect(f.some((x) => headMsg(x) && /cannot (be )?read/u.test(x)), bad).toBe(true);
    }
  });
  test('a transparent stop lets the layers under it show: they are all read, and a layer left unbacked fails', () => {
    const grid = 'repeating-linear-gradient(90deg, #8aa6ff 0 3px, transparent 3px 4px), linear-gradient(#3a5be0, #0a1468)';
    expect(backgroundStops(grid)).toEqual(['#8aa6ff', '#3a5be0', '#0a1468']);
    /* The stripe is a stop like any: lettering must hold on it, and on the band under it. */
    expect(fails(THEME_LIGHT(`--kb-head-bg: ${grid}; --kb-head-fg: #22d4ff;`)).some((x) => headMsg(x))).toBe(true);
    expect(fails(THEME_LIGHT(`--kb-head-bg: ${grid.replace('#8aa6ff', '#2a45c8')}; --kb-head-fg: #fff;`)).filter((x) => headMsg(x))).toEqual([]);
    /* Nothing under the last layer: the page shows through, and what it is is not known. */
    expect(() => backgroundStops('linear-gradient(#fff, transparent)')).toThrow(/transparent/u);
    expect(() => backgroundStops('linear-gradient(#fff, #eee), repeating-linear-gradient(90deg, #ddd 0 3px, transparent 3px 4px)')).toThrow(/transparent/u);
    expect(() => backgroundStops('linear-gradient(transparent, transparent)')).toThrow();
  });
  test('a text color that is a gradient fails too', () => {
    expect(fails(THEME_LIGHT('--kb-head-fg: linear-gradient(#000, #111);')).some((x) => headMsg(x) && /cannot (be )?read/u.test(x))).toBe(true);
  });
  test('rgb() without alpha is read', () => {
    expect(fails(THEME_LIGHT('--kb-head-bg: linear-gradient(rgb(255 255 255), rgb(255, 255, 255)); --kb-head-fg: #000;')).filter((x) => headMsg(x))).toEqual([]);
  });
  test('var() in a value is followed, to its fallback when unset, and a loop fails', () => {
    expect(fails(THEME_LIGHT('--kb-head-bg: var(--kb-bg); --kb-head-fg: var(--kb-fg);')).filter((x) => headMsg(x))).toEqual([]);
    expect(fails(THEME_LIGHT('--kb-head-bg: var(--kb-nope, #fff); --kb-head-fg: #000;')).filter((x) => headMsg(x))).toEqual([]);
    expect(fails(THEME_LIGHT('--kb-head-bg: var(--kb-head-bg); --kb-head-fg: #000;')).some((x) => headMsg(x) && /cannot (be )?read/u.test(x))).toBe(true);
  });
  test('the logo and the badges are held at 3:1, not 4.5:1', () => {
    expect(fails(THEME_LIGHT('--kb-banner-bg: #fff; --kb-logo-fg: #949494;')).filter((x) => /logo/u.test(x))).toEqual([]);
    expect(fails(THEME_LIGHT('--kb-banner-bg: #fff; --kb-logo-fg: #bbb;')).some((x) => /logo/u.test(x) && /needs 3:1/u.test(x))).toBe(true);
    expect(fails(THEME_LIGHT('--kb-badge-a: #fff; --kb-badge-a-fg: #bbb;')).some((x) => /badge/u.test(x))).toBe(true);
  });
  test('each new pair is checked: nav, bar, button, primary button, input, rows', () => {
    const bad = (css: string, word: RegExp) => expect(fails(THEME_LIGHT(css)).some((x) => word.test(x)), css).toBe(true);
    bad('--kb-nav-bg: #fff; --kb-nav-fg: #ddd;', /nav/u);
    bad('--kb-bar-bg: #fff; --kb-bar-fg: #ddd;', /light band/u);
    bad('--kb-button-bg: #fff; --kb-button-fg: #ddd;', /Chrome button/u);
    bad('--kb-button-primary-bg: #fff; --kb-button-primary-fg: #ddd;', /primary/u);
    bad('--kb-button-hover-bg: #fff; --kb-button-hover-fg: #ddd;', /under the pointer/u);
    bad('--kb-button-primary-hover-bg: #fff; --kb-button-primary-hover-fg: #ddd;', /primary Chrome button's label under/u);
    bad('--kb-input-bg: #222;', /input|text box/u);
    bad('--kb-row-2: #222;', /row/u);
  });
  test('a hovered link on the boards\' bar is held on the bar, not only on the page', () => {
    /* The Silver bar is #5e5e5e to #3a3a3a, and a gray hover that reads on the page is about 1:1 on it. */
    const bar = '--kb-nav-bg: linear-gradient(#5e5e5e, #3a3a3a); --kb-nav-fg: #fff;';
    expect(fails(THEME_LIGHT(`${bar} --kb-nav-hover: #4a4a4a;`)).some((x) => /^light: hovered links on the boards' bar/u.test(x) && /1\.\d\d:1/u.test(x))).toBe(true);
    expect(fails(THEME_LIGHT(`${bar} --kb-nav-hover: #fff;`)).filter((x) => /nav|bar/u.test(x))).toEqual([]);
    expect(fails(THEME_LIGHT(bar)).filter((x) => /nav|bar/u.test(x))).toEqual([]);
  });
  test('the focus ring is held at 3:1 on every band it can land on', () => {
    const bad = (css: string, word: RegExp) => expect(fails(THEME_LIGHT(css)).some((x) => word.test(x)), css).toBe(true);
    bad('--kb-focus: #000; --kb-row-1: #222;', /focus ring on table row 1/u);
    bad('--kb-focus: #000; --kb-row-3: #222;', /focus ring on table row 3/u);
    bad('--kb-focus: #000; --kb-head-bg: linear-gradient(#6a6a6a, #2b2b2b); --kb-head-focus: #000;', /focus ring on the column-title band/u);
    bad('--kb-focus: #000; --kb-bar-bg: #222;', /focus ring on the light band/u);
    bad('--kb-focus: #000; --kb-banner-bg: #222;', /focus ring on the banner/u);
    expect(fails(THEME_LIGHT('--kb-focus: #000;')).filter((x) => /focus/u.test(x))).toEqual([]);
  });
});

/* Each "passes" below also shows the pair was read: it is in PAIRS, and its worst ratio is the number the stops give. */
const checked = (fg: string, bg: string) => expect(PAIRS.some((p) => p[0] === fg && p[1] === bg), `${fg} on ${bg} is in PAIRS`).toBe(true);
const worst = (css: string, fg: string, bg: string) => worstRatio(tokensOf(THEME_LIGHT(css)).light, fg, bg);
const headFails = (css: string) => fails(THEME_LIGHT(css)).filter((x) => x.startsWith('light: ') && headMsg(x));

describe('the skin tokens: every stop, layer and var() is really read', () => {
  test('a failing MIDDLE stop of a three-stop gradient fails, and the same gradient with a passing middle is clean', () => {
    const bad = '--kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, #2b2b2b 50%, #fff);';
    expect(headFails(bad).length).toBe(1);
    const good = '--kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, #eee 50%, #fff);';
    checked('--kb-head-fg', '--kb-head-bg');
    expect(headFails(good)).toEqual([]);
    expect(worst(good, '--kb-head-fg', '--kb-head-bg')).toBeCloseTo(ratio('#000', '#eee'), 5);
  });
  test('a failing plain-color layer under a passing gradient layer fails', () => {
    expect(headFails('--kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, #eee), #2b2b2b;').length).toBe(1);
    expect(headFails('--kb-head-fg: #000; --kb-head-bg: #2b2b2b, linear-gradient(#fff, #eee);').length).toBe(1);
    expect(headFails('--kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, #eee), #fff;')).toEqual([]);
    expect(worst('--kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, #eee), #fff;', '--kb-head-fg', '--kb-head-bg')).toBeCloseTo(ratio('#000', '#eee'), 5);
  });
  test('a var() whose fallback is a gradient is followed into it', () => {
    expect(headFails('--kb-head-fg: #000; --kb-head-bg: var(--kb-nope, linear-gradient(#fff, #2b2b2b));').length).toBe(1);
    const ok = '--kb-head-fg: #000; --kb-head-bg: var(--kb-nope, linear-gradient(#fff, #eee));';
    expect(headFails(ok)).toEqual([]);
    expect(worst(ok, '--kb-head-fg', '--kb-head-bg')).toBeCloseTo(ratio('#000', '#eee'), 5);
  });
  test('a var() inside a gradient stop is followed', () => {
    expect(headFails('--kb-dark: #2b2b2b; --kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, var(--kb-dark));').length).toBe(1);
    const ok = '--kb-mid: #eee; --kb-head-fg: #000; --kb-head-bg: linear-gradient(#fff, var(--kb-mid));';
    expect(headFails(ok)).toEqual([]);
    expect(worst(ok, '--kb-head-fg', '--kb-head-bg')).toBeCloseTo(ratio('#000', '#eee'), 5);
  });
  test('a var() as the text color is followed', () => {
    expect(headFails('--kb-pale: #ddd; --kb-head-bg: #fff; --kb-head-fg: var(--kb-pale);').length).toBe(1);
    const ok = '--kb-ink: #111; --kb-head-bg: #fff; --kb-head-fg: var(--kb-ink);';
    expect(headFails(ok)).toEqual([]);
    expect(worst(ok, '--kb-head-fg', '--kb-head-bg')).toBeCloseTo(ratio('#111', '#fff'), 5);
  });
  test('a trailing !important is not part of the value', () => {
    const ok = '--kb-head-fg: #000 !important; --kb-head-bg: linear-gradient(#fff, #eee) !important;';
    expect(headFails(ok)).toEqual([]);
    expect(worst(ok, '--kb-head-fg', '--kb-head-bg')).toBeCloseTo(ratio('#000', '#eee'), 5);
    expect(headFails('--kb-head-fg: #ddd !important; --kb-head-bg: #fff !important;').length).toBe(1);
  });
  test('a gradient argument that is neither a color nor valid shape syntax fails closed, and valid syntax still reads', () => {
    for (const bad of ['circle banana', 'ellipse #zzz', 'to nowhere', 'closest-side 12 junk', 'at middle', 'from sideways', 'in nothing'])
      expect(() => backgroundStops(`radial-gradient(${bad}, #fff, #eee)`), bad).toThrow();
    for (const ok of ['circle', 'ellipse', 'closest-side', 'circle at center', 'circle closest-side at 50% 0%', 'ellipse farthest-corner at 10px 20px', 'to right', 'to bottom left', '45deg', '0.25turn', 'from 45deg at 50% 50%', 'in oklab', 'at center'])
      expect(backgroundStops(`radial-gradient(${ok}, #fff, #eee)`), ok).toEqual(['#fff', '#eee']);
  });
  test('--kb-link-hover is held on the page and on the table rows', () => {
    for (const bg of ['--kb-bg', '--kb-hud-bg', '--kb-row-1', '--kb-row-2', '--kb-row-3']) checked('--kb-link-hover', bg);
    expect(fails(THEME_LIGHT('--kb-link-hover: #ddd;')).some((x) => x.startsWith('light: ') && /hover/u.test(x))).toBe(true);
    expect(fails(THEME_LIGHT('--kb-link-hover: #000;')).filter((x) => x.startsWith('light: ') && /hover/u.test(x))).toEqual([]);
  });
});

describe('the skin tokens: the defaults draw today\'s board', () => {
  const seen = tokensOf(engine);
  const MAP: Record<string, string> = {
    '--kb-page-bg': '--kb-bg', '--kb-grid': '--kb-rule', '--kb-frame': '--kb-rule',
    '--kb-row-1': '--kb-bg', '--kb-row-2': '--kb-bg', '--kb-row-3': '--kb-bg',
    '--kb-head-bg': '--kb-bg', '--kb-head-fg': '--kb-fg', '--kb-bar-bg': '--kb-bg', '--kb-bar-fg': '--kb-fg',
    '--kb-banner-bg': '--kb-bg', '--kb-logo-fg': '--kb-fg', '--kb-nav-bg': '--kb-bg', '--kb-nav-fg': '--kb-link', '--kb-nav-hover': '--kb-nav-fg', '--kb-head-focus': '--kb-focus',
    '--kb-link-hover': '--kb-link', '--kb-input-bg': '--kb-bg', '--kb-input-edge': '--kb-rule',
    '--kb-button-bg': '--kb-bg', '--kb-button-edge': '--kb-rule', '--kb-button-fg': '--kb-fg',
    '--kb-button-primary-bg': '--kb-fg', '--kb-button-primary-fg': '--kb-bg',
    '--kb-button-hover-bg': '--kb-fg', '--kb-button-hover-fg': '--kb-bg',
    '--kb-button-primary-hover-bg': '--kb-fg', '--kb-button-primary-hover-fg': '--kb-bg',
    '--kb-badge-a': '--kb-fg', '--kb-badge-a-fg': '--kb-bg', '--kb-badge-b': '--kb-bg', '--kb-badge-b-fg': '--kb-fg',
    '--kb-scrollbar-thumb': '--kb-muted', '--kb-scrollbar-track': '--kb-bg',
  };
  const PLAIN: Record<string, string> = {
    '--kb-head-shadow': 'none', '--kb-bar-shadow': 'none', '--kb-logo-shadow': 'none', '--kb-input-shadow': 'none',
    '--kb-button-fg-shadow': 'none', '--kb-button-case': 'none', '--kb-button-radius': '0',
  };
  test.each(['light', 'light (chosen)', 'dark', 'dark (device)'] as const)('%s: every token resolves to the board\'s own color or to nothing', (mode) => {
    const t = seen[mode];
    for (const [name, to] of Object.entries(MAP)) expect(resolveToken(t, name), `${mode} ${name}`).toBe(resolveToken(t, to));
    for (const [name, v] of Object.entries(PLAIN)) expect(t[name], `${mode} ${name}`).toBe(v);
    for (const n of ['ink', 'back', 'front', 'new', 'hi', 'line', 'hot']) expect(t[`--kb-icon-${n}`], `${mode} icon ${n}`).toBeDefined();
  });
  test('the tokens that already existed keep their values', () => {
    expect(seen.light).toMatchObject({ '--kb-fg': '#000', '--kb-bg': '#fff', '--kb-rule': '#000', '--kb-link': '#000', '--kb-muted': '#555' });
    expect(seen.dark).toMatchObject({ '--kb-fg': '#fff', '--kb-bg': '#000', '--kb-rule': '#fff', '--kb-link': '#fff', '--kb-muted': '#aaa' });
  });
});

describe('the page\'s own ground (--kb-page-bg) is held as the page is', () => {
  const pageFails = (css: string) => fails(THEME_LIGHT(css)).filter((x) => /page/u.test(x));
  test('text is held on every stop of a tiled page, and a tile under the text color fails', () => {
    const tiled = 'repeating-linear-gradient(0deg, #000 0 14px, transparent 14px 20px), repeating-linear-gradient(90deg, #000 0 20px, transparent 20px 26px), #0a1448';
    expect(pageFails(`--kb-fg: #fff; --kb-muted: #fff; --kb-link: #fff; --kb-link-visited: #fff; --kb-link-hover: #fff; --kb-rule: #fff; --kb-focus: #fff; --kb-pip: #fff; --kb-page-bg: ${tiled};`)).toEqual([]);
    expect(pageFails(`--kb-fg: #fff; --kb-muted: #fff; --kb-link: #fff; --kb-link-visited: #fff; --kb-link-hover: #fff; --kb-rule: #fff; --kb-focus: #fff; --kb-pip: #fff; --kb-page-bg: ${tiled.replace('#0a1448', '#cccccc')};`).length).toBeGreaterThan(0);
  });
  test('every pair held against --kb-bg whose element sits on the page is held on the page ground too', () => {
    /* A dark page ground under light inks passes; one light tile in the ground fails each of them, by the name of its own pair. */
    const inks = '--kb-bg: #000; --kb-fg: #fff; --kb-muted: #fff; --kb-link: #fff; --kb-link-visited: #fff; --kb-link-hover: #fff; --kb-rule: #fff; --kb-focus: #fff; --kb-pip: #fff;';
    expect(pageFails(`${inks} --kb-page-bg: #000;`)).toEqual([]);
    const f = pageFails(`${inks} --kb-page-bg: linear-gradient(#000, #fff);`);
    for (const what of ['body text', 'muted text', 'links', 'visited links', 'hovered links', 'rules and control borders', 'the focus ring', 'a full pip']) {
      expect(f.some((x) => x.includes(what) && /page ground/u.test(x)), `${what} on the page ground\n${f.join('\n')}`).toBe(true);
    }
  });
  test('a page ground it cannot read fails closed', () => {
    expect(pageFails('--kb-page-bg: url(x.png);').some((x) => /cannot (be )?read/u.test(x))).toBe(true);
  });
});

describe('a pressed Chrome button is held too (the pressed filter dims face and label together)', () => {
  /* #767676 on white is 4.54:1, which passes; the pressed filter's brightness takes both toward 0.92 of themselves and lands under 4.5. */
  const reskin = THEME_LIGHT('--kb-button-bg: #fff; --kb-button-fg: #767676; --kb-button-hover-bg: #fff; --kb-button-hover-fg: #767676;');

  test('a face and label that pass at rest but fail pressed are caught, and the message says pressed', () => {
    const f = fails(reskin);
    expect(f.some((x) => /^light: a Chrome button's label \(/u.test(x)), 'the pair at rest passes').toBe(false);
    expect(f.some((x) => /^light: a pressed Chrome button's label/u.test(x)), f.join('\n')).toBe(true);
  });

  test('the factor is read from --kb-button-pressed-brightness, so a theme that dims less passes', () => {
    expect(fails(THEME_LIGHT('--kb-button-bg: #fff; --kb-button-fg: #767676; --kb-button-hover-bg: #fff; --kb-button-hover-fg: #767676; --kb-button-pressed-brightness: 1;')).filter((x) => /pressed/u.test(x))).toEqual([]);
  });

  test('the engine defaults hold pressed, primary and hovered included', () => {
    expect(fails(engine).filter((x) => /pressed/u.test(x))).toEqual([]);
  });
});
