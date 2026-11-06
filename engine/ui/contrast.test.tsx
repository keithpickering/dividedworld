import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contrastFailures, darkBlocksDisagree, ratio, resolveToken, tokensOf } from './contrast.ts';

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

describe('the skin tokens: gradients are read stop by stop', () => {
  test('a head band running #fff to #2b2b2b under a #fff head text fails on the light stop', () => {
    const f = fails(THEME_LIGHT('--kb-head-bg: linear-gradient(#fff, #2b2b2b); --kb-head-fg: #fff;'));
    expect(f.some((x) => x.startsWith('light: ') && /head/u.test(x) && /1\.00:1/u.test(x))).toBe(true);
  });
  test('the same band under dark text fails on the dark stop, and a band both ends carry passes', () => {
    expect(fails(THEME_LIGHT('--kb-head-bg: linear-gradient(#fff, #2b2b2b); --kb-head-fg: #000;')).some((x) => /head/u.test(x))).toBe(true);
    expect(fails(THEME_LIGHT('--kb-head-bg: linear-gradient(to bottom, #fff 0%, #ddd 100%); --kb-head-fg: #000;')).filter((x) => /head/u.test(x))).toEqual([]);
  });
  test('layers are read too: every comma-separated layer, gradient or plain color', () => {
    const band = 'linear-gradient(#fff, #eee), repeating-linear-gradient(45deg, #ddd 0 2px, #2b2b2b 2px 4px), #fff';
    expect(fails(THEME_LIGHT(`--kb-head-bg: ${band}; --kb-head-fg: #000;`)).some((x) => /head/u.test(x))).toBe(true);
    expect(fails(THEME_LIGHT('--kb-head-bg: radial-gradient(circle at 50% 0%, #fff, #eee), #fff; --kb-head-fg: #000;')).filter((x) => /head/u.test(x))).toEqual([]);
  });
  test('a value it cannot parse fails the check rather than passing', () => {
    for (const bad of ['url(x.png)', 'linear-gradient(red, blue)', 'linear-gradient(#fff, rgb(0 0 0 / 0.5))', 'linear-gradient(#fff', 'conic-gradient(#fff, banana)']) {
      const f = fails(THEME_LIGHT(`--kb-head-bg: ${bad}; --kb-head-fg: #000;`));
      expect(f.some((x) => /head/u.test(x) && /cannot (be )?read/u.test(x)), bad).toBe(true);
    }
  });
  test('a text color that is a gradient fails too', () => {
    expect(fails(THEME_LIGHT('--kb-head-fg: linear-gradient(#000, #111);')).some((x) => /head/u.test(x) && /cannot (be )?read/u.test(x))).toBe(true);
  });
  test('rgb() without alpha is read', () => {
    expect(fails(THEME_LIGHT('--kb-head-bg: linear-gradient(rgb(255 255 255), rgb(255, 255, 255)); --kb-head-fg: #000;')).filter((x) => /head/u.test(x))).toEqual([]);
  });
  test('var() in a value is followed, to its fallback when unset, and a loop fails', () => {
    expect(fails(THEME_LIGHT('--kb-head-bg: var(--kb-bg); --kb-head-fg: var(--kb-fg);')).filter((x) => /head/u.test(x))).toEqual([]);
    expect(fails(THEME_LIGHT('--kb-head-bg: var(--kb-nope, #fff); --kb-head-fg: #000;')).filter((x) => /head/u.test(x))).toEqual([]);
    expect(fails(THEME_LIGHT('--kb-head-bg: var(--kb-head-bg); --kb-head-fg: #000;')).some((x) => /head/u.test(x) && /cannot (be )?read/u.test(x))).toBe(true);
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
    bad('--kb-input-bg: #222;', /input|text box/u);
    bad('--kb-row-2: #222;', /row/u);
  });
});

describe('the skin tokens: the defaults draw today\'s board', () => {
  const seen = tokensOf(engine);
  const MAP: Record<string, string> = {
    '--kb-grid': '--kb-rule', '--kb-frame': '--kb-rule',
    '--kb-row-1': '--kb-bg', '--kb-row-2': '--kb-bg', '--kb-row-3': '--kb-bg',
    '--kb-head-bg': '--kb-bg', '--kb-head-fg': '--kb-fg', '--kb-bar-bg': '--kb-bg', '--kb-bar-fg': '--kb-fg',
    '--kb-banner-bg': '--kb-bg', '--kb-logo-fg': '--kb-fg', '--kb-nav-bg': '--kb-bg', '--kb-nav-fg': '--kb-link',
    '--kb-link-hover': '--kb-link', '--kb-input-bg': '--kb-bg', '--kb-input-edge': '--kb-rule',
    '--kb-button-bg': '--kb-bg', '--kb-button-edge': '--kb-rule', '--kb-button-fg': '--kb-fg',
    '--kb-button-primary-bg': '--kb-fg', '--kb-button-primary-fg': '--kb-bg',
    '--kb-badge-a': '--kb-fg', '--kb-badge-a-fg': '--kb-bg', '--kb-badge-b': '--kb-bg', '--kb-badge-b-fg': '--kb-fg',
  };
  const PLAIN: Record<string, string> = {
    '--kb-head-shadow': 'none', '--kb-bar-shadow': 'none', '--kb-logo-shadow': 'none', '--kb-input-shadow': 'none',
    '--kb-button-fg-shadow': 'none', '--kb-button-case': 'none', '--kb-button-radius': '0',
    '--kb-scrollbar-thumb': 'auto', '--kb-scrollbar-track': 'auto',
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
