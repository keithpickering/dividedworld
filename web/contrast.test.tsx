/**
 * Each instance's theme holds the contrast floor, laid over the engine's defaults as the page loads them.
 * It lives in web/ (the composition root) because the engine never reads an instance, by import or by the
 * filesystem (tools/check-engine-boundary.mjs); the pure check it calls, engine/ui/contrast.ts, stays in the engine.
 */
import { describe, expect, test } from 'vitest';
import { contrastFailures, darkBlocksDisagree, tokensOf } from '../engine/ui/contrast.ts';
import engine from '../engine/ui/tokens.css?raw';

const found = import.meta.glob<string>('../instances/*/ui/theme.css', { eager: true, query: '?raw', import: 'default' });
const themes = Object.entries(found).map(([path, css]) => [path.split('/')[2]!, css] as const);

describe('color contrast of each instance theme, light and dark', () => {
  test('there is a theme to check', () => { expect(themes.length).toBeGreaterThan(0); });

  test.each(themes)('the %s theme, laid over the engine defaults as the page loads them, holds in light, chosen dark and device dark', (_name, theme) => {
    const seen = tokensOf(engine, theme);
    expect(Object.keys(seen.dark).length).toBeGreaterThan(10);
    expect(seen['dark (device)']).toEqual(seen.dark);
    expect(darkBlocksDisagree(theme)).toEqual([]);
    expect(contrastFailures(engine, theme)).toEqual([]);
  });
});
