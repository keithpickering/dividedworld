import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contrastFailures, darkBlocksDisagree, ratio } from './contrast.ts';

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
