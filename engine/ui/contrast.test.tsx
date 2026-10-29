import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contrastFailures, ratio, tokensOf } from './contrast.ts';

const read = (p: string) => readFileSync(join(process.cwd(), 'engine/ui', p), 'utf8');
const themes = readdirSync(join(process.cwd(), 'instances')).filter((d) => existsSync(join(process.cwd(), 'instances', d, 'ui/theme.css')));

describe('color contrast of the tokens, light and dark', () => {
  test('the ratio is the WCAG one', () => {
    expect(ratio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(ratio('#777', '#fff')).toBeCloseTo(4.48, 1);
  });

  test('the engine defaults hold', () => {
    expect(contrastFailures(read('./tokens.css'))).toEqual([]);
  });

  test('there is a theme to check', () => { expect(themes.length).toBeGreaterThan(0); });

  test.each(themes)('the %s theme holds, with the engine defaults under it', (name) => {
    const css = read(`../../instances/${name}/ui/theme.css`);
    expect(Object.keys(tokensOf(css).dark).length).toBeGreaterThan(10);
    expect(contrastFailures(css)).toEqual([]);
  });
});
