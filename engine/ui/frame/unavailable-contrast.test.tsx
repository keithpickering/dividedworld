/**
 * The sheet of "The page cannot be displayed" carries its own colors (--kb-sheet-* in engine/ui/tokens.css), not the theme's, so
 * engine/ui/contrast.test.tsx and web/contrast.test.tsx, which hold the theme's token pairs, never see them. This holds the
 * sheet's own pairs, light and dark, each read as the browser reads it: the dark blocks laid over the light ones. The text
 * pairs need 4.5:1 and the rule 3:1, as engine/ui/contrast.ts holds the theme's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { ratio } from '../contrast.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { CannotDisplay } from './Unavailable.tsx';

const css = readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8');

const PAIRS: readonly (readonly [string, string, number])[] = [
  ['--kb-sheet-fg', '--kb-sheet-bg', 4.5],
  ['--kb-sheet-link', '--kb-sheet-bg', 4.5],
  ['--kb-sheet-muted', '--kb-sheet-bg', 4.5],
  ['--kb-sheet-rule', '--kb-sheet-bg', 3],
];

/** The --kb-sheet-* declarations of every block whose selector is about the sheet and satisfies `want`. */
function sheetVars(source: string, dark: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const stripped = source.replace(/\/\*[\s\S]*?\*\//gu, '');
  for (const m of stripped.matchAll(/([^{}]*?)\{([^{}]*)\}/gu)) {
    const selector = m[1]!.replace(/@media[^{]*$/u, '').trim();
    if (!/^:root(\[data-kb-mode="dark"\]|:not\(\[data-kb-mode="light"\]\))?$/u.test(selector)) continue;
    const isDark = /data-kb-mode="dark"|:not\(\[data-kb-mode="light"\]\)/u.test(selector);
    if (isDark && !dark) continue;
    for (const d of m[2]!.matchAll(/(--kb-sheet-[a-z-]+)\s*:\s*([^;]+);/gu)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

/** One line for each pair under its ratio, in each mode. */
export function sheetFailures(source: string): string[] {
  const lines: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const vars = sheetVars(source, mode === 'dark');
    for (const [fg, bg, need] of PAIRS) {
      if (!vars[fg] || !vars[bg]) { lines.push(`${mode}: ${fg} or ${bg} is not declared`); continue; }
      const got = ratio(vars[fg], vars[bg]);
      if (got < need) lines.push(`${mode}: ${fg} ${vars[fg]} on ${bg} ${vars[bg]} is ${got.toFixed(2)}:1, needs ${need}:1`);
    }
  }
  return lines;
}

describe('the cannot-display sheet\'s own colors', () => {
  test('every pair holds in light and in dark', () => {
    expect(sheetFailures(css)).toEqual([]);
  });

  test('a muted gray planted on the dark sheet fails', () => {
    const planted = css.replaceAll('--kb-sheet-muted: #b0b0b0;', '--kb-sheet-muted: #444;');
    expect(planted).not.toBe(css);
    const f = sheetFailures(planted);
    expect(f.some((x) => x.startsWith('dark: --kb-sheet-muted') && /needs 4\.5:1/u.test(x))).toBe(true);
    expect(f.some((x) => x.startsWith('light: '))).toBe(false);
  });

  test('a low-contrast link planted on the light sheet fails', () => {
    const planted = css.replace('--kb-sheet-link: #000;', '--kb-sheet-link: #999;');
    const f = sheetFailures(planted);
    expect(f.some((x) => x.startsWith('light: --kb-sheet-link'))).toBe(true);
  });

  test('every link on the sheet, the contact link included, takes the sheet\'s link color', () => {
    const takesLinkColor = (rules: string) => /\.kb-unavailable-sheet a \{\s*color: var\(--kb-sheet-link\);/u.test(rules);
    const rules = readFileSync(join(process.cwd(), 'engine/ui/frame/unavailable.css'), 'utf8');
    expect(takesLinkColor(rules)).toBe(true);
    expect(takesLinkColor(rules.replace('.kb-unavailable-sheet a {', '.kb-unavailable-sheet p {'))).toBe(false);
    for (const kind of ['server', 'broken'] as const) {
      const { unmount } = renderIn(buildWorld(), <main><CannotDisplay kind={kind} address="/b/x" onRetry={() => {}} /></main>, { path: '/' });
      expect(screen.getByRole('link', { name: 'tell an admin' }).closest('.kb-unavailable-sheet')).not.toBeNull();
      unmount();
    }
  });

  test('a pair left undeclared fails', () => {
    expect(sheetFailures(css.replaceAll('--kb-sheet-fg:', '--kb-sheet-x:')).some((x) => /not declared/u.test(x))).toBe(true);
  });
});
