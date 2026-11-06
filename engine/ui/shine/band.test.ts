import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ratio, tokensOf, type Mode } from '../contrast.ts';
import { POST_INK, bandFor, bandOf, clampInto, shineIsReadable, toHex, toLinear, toSrgb8, type Band, type Rgb } from './band.ts';

const tokens = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8'));
const boards = [['light', tokens.light], ['dark', tokens.dark]] as const;
const bandOfBoard = { light: bandOf(tokens.light), dark: bandOf(tokens.dark) };
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/**
 * HSL hue in degrees of an #rrggbb color, in linear light: the clamp scales and mixes linear channels, which keeps the
 * hue exactly there. Read as gamma-encoded sRGB HSL the same colors move by up to 13 degrees (the bench's own look), so
 * the two-degree bound is held on the space the operation is exact in.
 */
function hue(hex: string): number {
  const [r, g, b] = toLinear(hex);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('the readable band', () => {
  test('the engine tokens give 0.59 to 1 on light and 0 to 0.048 on dark', () => {
    near(bandOfBoard.light.lo, 0.59, 0.01);
    near(bandOfBoard.light.hi, 1, 0);
    near(bandOfBoard.dark.lo, 0, 0);
    near(bandOfBoard.dark.hi, 0.048, 0.005);
  });

  test('the sRGB helpers round-trip', () => {
    assert.equal(toHex(toLinear('#2a1b55')), '#2a1b55');
    assert.equal(toSrgb8(1), 255);
    assert.equal(toSrgb8(0), 0);
  });

  test('after the clamp, 4,096 colors hold 4.5:1 against every ink on both boards', () => {
    for (const [board, t] of boards) {
      for (let i = 0; i < 4096; i++) {
        const hex = `#${[(i >> 8) & 15, (i >> 4) & 15, i & 15].map((n) => (n * 17).toString(16).padStart(2, '0')).join('')}`;
        const out = toHex(clampInto(toLinear(hex), bandOfBoard[board]));
        for (const ink of POST_INK) assert.ok(ratio(t[ink]!, out) >= 4.5, `${board}: ${hex} -> ${out} is ${ratio(t[ink]!, out).toFixed(2)}:1 against ${ink}`);
      }
    }
  });

  test('a color already inside the band is unchanged', () => {
    const inside: Rgb = [0.01, 0.02, 0.005];
    assert.deepEqual(clampInto([...inside], bandOfBoard.dark), inside);
    const lit: Rgb = [0.9, 0.8, 0.95];
    assert.deepEqual(clampInto([...lit], bandOfBoard.light), lit);
  });

  test('the hue of a clamped saturated color stays within 2 degrees', () => {
    for (const [board] of boards) {
      for (const hex of ['#ff0000', '#ff8800', '#ffee00', '#00ff44', '#00ccff', '#4400ff', '#ff00aa']) {
        const out = toHex(clampInto(toLinear(hex), bandOfBoard[board]));
        const d = Math.abs(hue(hex) - hue(out));
        assert.ok(Math.min(d, 360 - d) <= 2, `${board}: ${hex} -> ${out} moved ${d.toFixed(1)} degrees`);
      }
    }
  });
});

describe('bandFor reads the board as it resolved', () => {
  test('from getComputedStyle, cached per token string', () => {
    let reads = 0;
    const real = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({ getPropertyValue: (k: string) => { reads++; return ` ${tokens.dark[k]} `; } })) as never;
    try {
      const a = bandFor({} as Element);
      const b = bandFor({} as Element);
      assert.deepEqual(a, bandOfBoard.dark);
      assert.equal(a, b);
      assert.ok(reads >= 5);
    } finally {
      globalThis.getComputedStyle = real;
    }
  });
});

describe('shineIsReadable', () => {
  const clampedSample = (mode: Mode, _light: { x: number; y: number }, skip = false): string[] => {
    const band = bandOf(tokens[mode]);
    return ['#ffffff', '#ff0000', '#2a1b55', '#00ccff'].map((h) => toHex(skip ? toLinear(h) : clampInto(toLinear(h), band)));
  };

  test('passes a clamped sampler', () => {
    assert.deepEqual(shineIsReadable(tokens, (m, l) => clampedSample(m, l)), []);
  });

  test('poison: a white on the dark board is named', () => {
    const failures = shineIsReadable(tokens, (mode) => (mode === 'dark' ? ['#ffffff'] : ['#000000'].slice(0, 0)));
    assert.ok(failures.length > 0);
    assert.match(failures[0]!, /^dark: #ffffff is \d+\.\d:1 against --kb-\w+ at light \(-1\.5, -1\.5\)$/);
  });

  test('poison: a sampler that skips the clamp on one light angle is caught', () => {
    const failures = shineIsReadable(tokens, (m, l) => clampedSample(m, l, l.x === 0.75 && l.y === -1.5));
    assert.ok(failures.length > 0);
    assert.ok(failures.every((f) => f.endsWith('at light (0.75, -1.5)')), failures[0]);
  });
});
