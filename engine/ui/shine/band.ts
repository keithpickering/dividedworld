/**
 * The readable band of the shine. Every pixel the shine draws over a post's words must hold 4.5:1 against every ink a
 * post's words use, on both boards, at every light (docs/plans/2026-11-06-shine-design.md section 5). From the inks and
 * the board's ground each board has a luminance band; the shine's colors are moved into it, keeping their hue.
 *
 * Units: the band is in WCAG relative luminance. `clampInto` works IN PLACE on a color in LINEAR light, [r, g, b] each in
 * 0..1 (not sRGB, not 0..255), as the approved bench does; `toLinear` takes a sRGB hex into that space and `toSrgb8` takes
 * one linear channel back to an 8-bit sRGB value, through a 4,097-entry lookup table so a draw never calls `pow`.
 * The band is computed from the tokens as the board resolves them, never written down twice.
 *
 * Engine code: it names no card and no instance.
 */
import { MODES, ratio, type Mode, type Tokens } from '../contrast.ts';

/** The tokens that color text inside a post: its words, links, visited links, and muted words such as a quote's byline. */
export const POST_INK = ['--kb-fg', '--kb-link', '--kb-link-visited', '--kb-muted'] as const;

export type Band = { readonly lo: number; readonly hi: number };
export type Rgb = [number, number, number];
export type Light = { readonly x: number; readonly y: number };

/** Rounding a color to 8 bits can move its luminance a little; each bound is moved inward by this much so it cannot cross. */
const MARGIN = 0.004;

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear light to 8-bit sRGB, 4,097 entries. */
const LUT = new Uint8ClampedArray(4097);
for (let i = 0; i <= 4096; i++) {
  const l = i / 4096;
  LUT[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
}

/** One linear channel (0..1) as an 8-bit sRGB value. */
export const toSrgb8 = (l: number): number => LUT[Math.max(0, Math.min(4096, Math.round(l * 4096)))]!;

/** A `#rrggbb` or `#rgb` color as linear [r, g, b], each 0..1. */
export const toLinear = (hex: string): Rgb => {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  return [1, 3, 5].map((i) => s2l(parseInt(h.slice(i, i + 2), 16) / 255)) as Rgb;
};

/** Linear [r, g, b] as `#rrggbb`. */
export const toHex = (c: Readonly<Rgb>): string =>
  `#${c.map((v) => toSrgb8(v).toString(16).padStart(2, '0')).join('')}`;

export const luminanceOf = (c: Readonly<Rgb>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The linear luminance of one token, or a named error: a band computed from a color that did not parse would be NaN. */
function luminanceOfToken(tokens: Tokens, k: string): number {
  const v = tokens[k];
  if (typeof v !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(v)) {
    throw new Error(`shine band: ${k} is not a hex color (${JSON.stringify(v ?? null)})`);
  }
  return luminanceOf(toLinear(v));
}

/** The luminance a post's inks leave free on the board these tokens describe; throws when none is left. */
export function bandOf(tokens: Tokens): Band {
  const L = POST_INK.map((k) => luminanceOfToken(tokens, k));
  const bg = luminanceOfToken(tokens, '--kb-bg');
  if (Math.max(...L) < bg) {
    /* Dark inks on a light ground: the shine must stay light enough. */
    const lo = Math.max(...L.map((l) => 4.5 * (l + 0.05) - 0.05)) + MARGIN;
    if (lo > 1) throw new Error('shine band: no luminance is readable against inks that light on a light ground');
    return { lo, hi: 1 };
  }
  const hi = Math.min(...L.map((l) => (l + 0.05) / 4.5 - 0.05)) - MARGIN;
  if (hi < 0) throw new Error('shine band: no luminance is readable against inks that dark on a dark ground');
  return { lo: 0, hi };
}

const BAND_TOKENS = ['--kb-bg', ...POST_INK] as const;
const cache = new Map<string, Band>();

/** The band where `el` sits, from the tokens as the board resolved them (device, player's choice, instance theme). */
export function bandFor(el: Element): Band {
  const style = getComputedStyle(el);
  const tokens: Record<string, string> = {};
  for (const k of BAND_TOKENS) tokens[k] = style.getPropertyValue(k).trim();
  const key = BAND_TOKENS.map((k) => tokens[k]).join('|');
  let band = cache.get(key);
  if (!band) {
    band = bandOf(tokens);
    cache.set(key, band);
  }
  return band;
}

/** Move a linear color into the band in place, keeping hue: scale down past `hi`, mix toward white under `lo`. */
export function clampInto(c: Rgb, band: Band): Rgb {
  const L = luminanceOf(c);
  if (L > band.hi) {
    const k = band.hi / L;
    c[0] *= k; c[1] *= k; c[2] *= k;
  } else if (L < band.lo) {
    const k = (band.lo - L) / (1 - L);
    c[0] += (1 - c[0]) * k; c[1] += (1 - c[1]) * k; c[2] += (1 - c[2]) * k;
  }
  return c;
}

const GRID = 9;
const SPAN = 1.5;

/**
 * Every sampled color that fails 4.5:1 against any ink, in words; empty when the shine is readable. For each mode, the
 * sampler is asked for the colors the shine draws at each of a 9 x 9 grid of lights over [-1.5, 1.5] squared.
 */
export function shineIsReadable(
  tokensByMode: Readonly<Record<Mode, Tokens>>,
  sample: (mode: Mode, light: Light) => Iterable<string>,
): string[] {
  const failures: string[] = [];
  for (const mode of MODES) {
    const tokens = tokensByMode[mode];
    if (!tokens) {
      failures.push(`${mode}: no tokens to check against`);
      continue;
    }
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const light = { x: -SPAN + (2 * SPAN * i) / (GRID - 1), y: -SPAN + (2 * SPAN * j) / (GRID - 1) };
        for (const color of sample(mode, light)) {
          for (const ink of POST_INK) {
            const r = ratio(tokens[ink]!, color);
            if (r < 4.5) failures.push(`${mode}: ${color} is ${r.toFixed(1)}:1 against ${ink} at light (${light.x}, ${light.y})`);
          }
        }
      }
    }
  }
  return failures;
}
