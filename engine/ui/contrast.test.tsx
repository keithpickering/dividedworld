import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contrastFailures, darkBlocksDisagree, ratio, tokensOf } from './contrast.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const engine = read('engine/ui/tokens.css');
const themes = readdirSync(join(process.cwd(), 'instances')).filter((d) => existsSync(join(process.cwd(), 'instances', d, 'ui/theme.css')));

describe('color contrast of the tokens, light and dark', () => {
  test('the ratio is the WCAG one', () => {
    expect(ratio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(ratio('#777', '#fff')).toBeCloseTo(4.48, 1);
  });

  test('the engine defaults hold', () => {
    expect(contrastFailures(engine)).toEqual([]);
    expect(darkBlocksDisagree(engine)).toEqual([]);
  });

  test('there is a theme to check', () => { expect(themes.length).toBeGreaterThan(0); });

  test.each(themes)('the %s theme, laid over the engine defaults as the page loads them, holds in light, chosen dark and device dark', (name) => {
    const theme = read(`instances/${name}/ui/theme.css`);
    const seen = tokensOf(engine, theme);
    expect(Object.keys(seen.dark).length).toBeGreaterThan(10);
    expect(seen['dark (device)']).toEqual(seen.dark);
    expect(darkBlocksDisagree(theme)).toEqual([]);
    expect(contrastFailures(engine, theme)).toEqual([]);
  });
});
