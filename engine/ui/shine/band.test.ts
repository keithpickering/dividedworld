import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, ratio, tokensOf, type Mode } from '../contrast.ts';
import { POST_INK, bandFor, bandOf, clampInto, shineIsReadable, toHex, toHexA, toLinear, toSrgb8, type Rgb } from './band.ts';

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

  test('every one of the 256 sRGB values round-trips through linear light and the lookup table', () => {
    for (let v = 0; v < 256; v++) {
      const h = v.toString(16).padStart(2, '0');
      for (const hex of [`#${h}${h}${h}`, `#${h}0000`, `#00${h}00`, `#0000${h}`]) assert.equal(toHex(toLinear(hex)), hex);
    }
  });

  test('a clamp lands on the band edge it was moved to, not somewhere inside', () => {
    const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const board of ['light', 'dark'] as const) {
      const band = bandOfBoard[board];
      const bright = clampInto([1, 0.9, 0.8], band);
      const dim = clampInto([0.001, 0.002, 0.001], band);
      if (board === 'dark') near(lum(bright), band.hi, 0.01);
      else near(lum(dim), band.lo, 0.01);
    }
    /* The other direction, on a band with room on both sides. */
    const mid = { lo: 0.3, hi: 0.6 };
    near(lum(clampInto([1, 1, 1], mid)), mid.hi, 0.01);
    near(lum(clampInto([0, 0, 0], mid)), mid.lo, 0.01);
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

  test('a different board reads a different band, never the cached one', () => {
    const real = globalThis.getComputedStyle;
    const board = { current: tokens.dark };
    globalThis.getComputedStyle = (() => ({ getPropertyValue: (k: string) => board.current[k] ?? '' })) as never;
    try {
      const dark = bandFor({} as Element);
      board.current = tokens.light;
      const light = bandFor({} as Element);
      assert.deepEqual(dark, bandOfBoard.dark);
      assert.deepEqual(light, bandOfBoard.light);
    } finally {
      globalThis.getComputedStyle = real;
    }
  });

  test('an unparseable or empty token throws a named error, and nothing is cached', () => {
    const real = globalThis.getComputedStyle;
    try {
      for (const bad of ['rgb(1,2,3)', '', 'red']) {
        globalThis.getComputedStyle = (() => ({ getPropertyValue: (k: string) => (k === '--kb-fg' ? bad : tokens.dark[k]) })) as never;
        assert.throws(() => bandFor({} as Element), /shine band: --kb-fg is not a hex color/, bad);
        assert.throws(() => bandOf({ ...tokens.dark, '--kb-fg': bad }), /shine band: --kb-fg is not a hex color/, bad);
      }
      globalThis.getComputedStyle = (() => ({ getPropertyValue: (k: string) => (k === '--kb-bg' ? '' : tokens.dark[k]) })) as never;
      assert.throws(() => bandFor({} as Element), /shine band: --kb-bg is not a hex color/);
    } finally {
      globalThis.getComputedStyle = real;
    }
  });
});

describe('bandOf with no room', () => {
  const flat = (ink: string, bg: string) => ({ '--kb-bg': bg, '--kb-fg': ink, '--kb-link': ink, '--kb-link-visited': ink, '--kb-muted': ink });

  test('mid-gray inks on a lighter ground leave no light band: it throws, naming the board', () => {
    assert.throws(() => bandOf(flat('#808080', '#ffffff')), /shine band: no luminance is readable against inks that light on a light ground/);
  });

  test('black inks on a black ground leave no dark band: it throws', () => {
    assert.throws(() => bandOf(flat('#000000', '#000000')), /shine band: no luminance is readable against inks that dark on a dark ground/);
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
    const failures = shineIsReadable(tokens, (mode) => (mode === 'dark' ? ['#ffffff'] : []));
    assert.ok(failures.length > 0);
    assert.match(failures[0]!, /^dark: #ffffff is \d+\.\d:1 against --kb-\w+ at light \(-1\.5, -1\.5\)$/);
  });

  test('a mode missing from the tokens is named, never skipped', () => {
    const { dark: _dark, ...rest } = tokens;
    const failures = shineIsReadable(rest as typeof tokens, (m, l) => clampedSample(m, l));
    assert.deepEqual(failures, ['dark: no tokens to check against']);
  });

  test('all four modes are walked: a sampler is asked for each, and a missing chosen or device mode is named', () => {
    const asked = new Set<Mode>();
    shineIsReadable(tokens, (m, l) => { asked.add(m); return clampedSample(m, l); });
    assert.deepEqual([...asked].sort(), [...MODES].sort());
    for (const gone of ['light (chosen)', 'dark (device)'] as const) {
      const { [gone]: _g, ...rest } = tokens;
      assert.deepEqual(shineIsReadable(rest as typeof tokens, (m, l) => clampedSample(m, l)), [`${gone}: no tokens to check against`]);
    }
  });

  test('the 4.5 edge: about 4.4 against the tightest ink is named, about 4.6 passes', () => {
    const minRatio = (t: Record<string, string>, hex: string) => Math.min(...POST_INK.map((k) => ratio(t[k]!, hex)));
    const grays = Array.from({ length: 256 }, (_, v) => `#${v.toString(16).padStart(2, '0').repeat(3)}`);
    const t = tokens.light;
    const below = grays.filter((g) => minRatio(t, g) < 4.5).sort((a, b) => minRatio(t, b) - minRatio(t, a))[0]!;
    const above = grays.filter((g) => minRatio(t, g) >= 4.5).sort((a, b) => minRatio(t, a) - minRatio(t, b))[0]!;
    near(minRatio(t, below), 4.4, 0.15);
    near(minRatio(t, above), 4.6, 0.15);
    const only = (c: string) => shineIsReadable(tokens, (m) => (m === 'light' ? [c] : []));
    assert.ok(only(below).length > 0, `${below} at ${minRatio(t, below).toFixed(2)}:1 should be named`);
    assert.ok(only(below).every((f) => f.includes(below)));
    assert.deepEqual(only(above), [], `${above} at ${minRatio(t, above).toFixed(2)}:1 should pass`);
  });

  test('poison: a sampler that skips the clamp on one light angle is caught', () => {
    const failures = shineIsReadable(tokens, (m, l) => clampedSample(m, l, l.x === 0.75 && l.y === -1.5));
    assert.ok(failures.length > 0);
    assert.ok(failures.every((f) => f.endsWith('at light (0.75, -1.5)')), failures[0]);
  });
});

describe('toHexA', () => {
  test('is toHex with the alpha as two more hex digits, and round-trips through toLinear', () => {
    for (const hex of ['#000000', '#ffffff', '#ffeecc', '#2a1b55', '#00ccff']) {
      assert.equal(toHexA(toLinear(hex), 1), `${hex}ff`);
      assert.equal(toHexA(toLinear(hex), 0), `${hex}00`);
      assert.equal(toHexA(toLinear(hex), 0.45).slice(0, 7), hex);
    }
  });

  test('rounds alpha to 8 bits: 0.45 is 0x73, 0.95 is 0xf2, 0.5 is 0x80', () => {
    const c = toLinear('#ffffff');
    assert.equal(toHexA(c, 0.45), '#ffffff73');
    assert.equal(toHexA(c, 0.95), '#fffffff2');
    assert.equal(toHexA(c, 0.5), '#ffffff80');
  });

  test('clamps alpha to 0..1, and a NaN alpha is clear', () => {
    const c = toLinear('#336699');
    assert.equal(toHexA(c, 2), '#336699ff');
    assert.equal(toHexA(c, -1), '#33669900');
    assert.equal(toHexA(c, Infinity), '#336699ff');
    assert.equal(toHexA(c, NaN), '#33669900');
  });

  test('holds a linear channel outside 0..1 to the nearest color, as toHex does', () => {
    assert.equal(toHexA([2, -1, 0.5], 1).slice(0, 7), toHex([2, -1, 0.5]));
  });
});
