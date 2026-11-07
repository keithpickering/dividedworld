/**
 * What the rank bar's face paints, so its lettering can be measured (GroupBar.tsx draws it; postbit.css holds the same shares, and
 * GroupBar.test.tsx fails if the two drift). A group's color is the instance's, so the bar's colors are computed from it here, stop by
 * stop, as `color-mix(in srgb, ...)` computes them: the glossy top, the group's own color, the dark lip under the middle, and for a
 * striped group the two stripes.
 *
 * The lettering is the `ink` token with a crisp `halo` outline. A face that holds the ink alone at 4.5:1 needs no outline; a face that does not (a
 * light group color) is read at the glyph's edge, where the ink meets the outline blended with the face (EDGE_SHARE). That measurement can fail: a weak
 * halo color, or a face too light for the blend, drops it under 4.5. `reading` gives both, for the test to name.
 */
import { parseColor, ratio, resolveToken, type Tokens } from '../contrast.ts';

/** The share of the gloss token mixed into the top stop, of the halo token into the lip, and of the halo token into the dark stripe. */
export const GLOSS_SHARE = 10;
export const LIP_SHARE = 20;
export const STRIPE_SHARE = 30;
/**
 * How much of the pixels around a glyph is the outline: postbit.css draws the halo as a crisp 1px outline (the glyph's eight neighbors), so a pixel at
 * the glyph's edge is mostly halo, and the rest is face showing through antialiasing and the outline's gaps. 70% halo to 30% face is the conservative read.
 */
export const EDGE_SHARE = 70;
/** The least ratio for lettering. */
export const LETTERING = 4.5;

type Rgb = [number, number, number];
const hex = (c: Rgb): string => `#${c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
/** `color-mix(in srgb, a (100 - share)%, b share%)`. */
const mix = (a: Rgb, b: Rgb, share: number): Rgb => a.map((n, i) => (n * (100 - share) + b[i]! * share) / 100) as Rgb;

/** Every color the face paints, as hex. */
export function faceStops(color: string, tokens: Tokens, stripe: boolean): string[] {
  const g = parseColor(color);
  const dark = parseColor(resolveToken(tokens, '--kb-group-bar-halo'));
  if (stripe) return [hex(g), hex(mix(g, dark, STRIPE_SHARE))];
  const gloss = parseColor(resolveToken(tokens, '--kb-group-bar-gloss'));
  return [hex(mix(g, gloss, GLOSS_SHARE)), hex(g), hex(mix(g, dark, LIP_SHARE))];
}

export interface Reading {
  /** The ink's worst ratio over the face's stops, with no outline. */
  readonly ink: number;
  /** Whether the ink alone holds. */
  readonly alone: boolean;
  /** The ink's worst ratio against what surrounds a glyph: the outline blended with the face (EDGE_SHARE). */
  readonly edge: number;
}

export function reading(color: string, tokens: Tokens, stripe: boolean): Reading {
  const ink = resolveToken(tokens, '--kb-group-bar-ink');
  const halo = parseColor(resolveToken(tokens, '--kb-group-bar-halo'));
  const stops = faceStops(color, tokens, stripe);
  const ratios = stops.map((s) => ratio(ink, s));
  const edges = stops.map((s) => ratio(ink, hex(mix(parseColor(s), halo, EDGE_SHARE))));
  const worst = Math.min(...ratios);
  return { ink: worst, alone: worst >= LETTERING, edge: Math.min(...edges) };
}
