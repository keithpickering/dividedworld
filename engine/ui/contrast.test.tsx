import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { contrastFailures, darkBlocksDisagree, inkOn, ratio, tokensOf } from './contrast.ts';

const engine = readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8');

/* The engine knows no instance: each instance's theme is swept in web/contrast.test.tsx, through the composition root. */
describe('color contrast of the engine tokens, light and dark', () => {
  test('the ratio is the WCAG one', () => {
    expect(ratio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(ratio('#777', '#fff')).toBeCloseTo(4.48, 1);
  });

  test('the better ink agrees with the ratio, black on a tie', () => {
    for (const bg of ['#ffff00', '#000080', '#808080', '#767676', '#777777', '#ffa500', '#4b0082', '#fff', '#000']) {
      const [b, w] = [ratio('#000', bg), ratio('#fff', bg)];
      expect(inkOn(bg), bg).toBe(b >= w ? 'black' : 'white');
    }
  });

  test('the engine defaults hold', () => {
    expect(contrastFailures(engine)).toEqual([]);
    expect(darkBlocksDisagree(engine)).toEqual([]);
  });
});

describe('the rainbow text', () => {
  test('each of the six stops reads on the page it is drawn on, in both modes', () => {
    const modes = tokensOf(engine);
    const failures: string[] = [];
    for (const [mode, tokens] of Object.entries(modes)) {
      for (let i = 1; i <= 6; i++) {
        const [stop, ground] = [tokens[`--kb-rainbow-${i}`], tokens['--kb-bg']];
        if (!stop || !ground) { failures.push(`${mode}: --kb-rainbow-${i} or --kb-bg is not set`); continue; }
        const got = ratio(stop, ground);
        if (got < 4.5) failures.push(`${mode}: --kb-rainbow-${i} ${stop} on ${ground} is ${got.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('the stops differ, so it is a rainbow', () => {
    for (const tokens of Object.values(tokensOf(engine))) {
      expect(new Set([1, 2, 3, 4, 5, 6].map((i) => tokens[`--kb-rainbow-${i}`])).size).toBe(6);
    }
  });
});
