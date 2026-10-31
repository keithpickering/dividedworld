/**
 * Whoops!'s inks in words. The play form offers its swatches (ConfigForm.tsx), and the plate's readout names a
 * layer's ink so it never says a hex code ("top: Spritey's yellow", the plays-on-a-post design, section 5): the
 * swatch's name when the ink is one, else the swatch nearest it by the two-stage OKLCh rule below. An ink the player gave by name ("violet") is
 * called by that name. Nothing new is saved on the play.
 *
 * The names come from one table (`NAMES`): the swatches plus black, white and gray. Each entry is classed by its own
 * chroma in OKLCh, neutral below `GRAY_GATE` and chromatic above, so no code names a color family: a Brown added to the
 * swatches is chromatic and wins the dark oranges on lightness, a Silver is neutral and competes with gray. An ink
 * below the gate takes the neutral nearest in lightness; one above it takes the chromatic entry nearest in hue, with
 * lightness weighed at half. (#97's rule weighed hue alone, which called a brown "orange" and needed HSL pre-checks to
 * keep dark inks from being named for a hue; the gate does that now.)
 *
 * The swatches live here, not in the form, so the names have one list and a Node test can read it.
 */
import { rgbOf } from './splat.ts';

/** The play form's inks, by name. */
export const SWATCHES = [
  { name: 'Magenta', color: '#ff2bd6' },
  { name: 'Cyan', color: '#19e3ff' },
  { name: 'Yellow', color: '#ffd93d' },
  { name: 'Green', color: '#2ef0a0' },
  { name: 'Orange', color: '#ff9a3d' },
  { name: 'Violet', color: '#b46cff' },
] as const;

/** One entry of the naming table. */
export interface InkEntry { readonly name: string; readonly color: string }

/** The swatches plus the neutrals: every name an ink can be given when the player did not give one. */
export const NAMES: readonly InkEntry[] = [
  ...SWATCHES,
  { name: 'Black', color: '#000000' },
  { name: 'White', color: '#ffffff' },
  { name: 'Gray', color: '#808080' },
];

/** Below this OKLCh chroma an ink, or a table entry, is neutral: it has no hue worth naming. */
const GRAY_GATE = 0.03;

/** An sRGB color as OKLCh (Ottosson's OKLab): lightness 0 to 1, chroma, and hue in degrees from 0 to 360. */
export function oklch(color: string): { readonly L: number; readonly C: number; readonly h: number } {
  const [r, g, b] = rgbOf(color).map((c) => c / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

/** The shortest difference between two hue angles, in degrees. */
const around = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** An ink's name for a sentence, lowercased ("yellow"); "ink" for one that cannot be read. */
export function inkName(color: string, names: readonly InkEntry[] = NAMES): string {
  let rgb: [number, number, number];
  try { rgb = rgbOf(color); } catch { return 'ink'; }
  const hex = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const exact = names.find((n) => n.color === hex);
  if (exact) return exact.name.toLowerCase();
  /* An ink the player gave by its name ("violet") is called what they called it, and never an entry's that differs. */
  if (/^[a-z]+$/iu.test(color.trim())) return color.trim().toLowerCase();
  const ink = oklch(hex);
  const entries = names.map((n) => ({ name: n.name.toLowerCase(), ...oklch(n.color) }));
  const neutral = ink.C < GRAY_GATE;
  const pool = entries.filter((e) => (e.C < GRAY_GATE) === neutral);
  if (pool.length === 0) return 'ink';
  /* Hue is scaled so 180 degrees is 1, the unit the half lightness weight is set against (lightness spans 0 to 1). */
  const distance = (e: { L: number; h: number }) => (neutral ? Math.abs(e.L - ink.L) : Math.hypot(0.5 * (e.L - ink.L), around(e.h, ink.h) / 180));
  return pool.reduce((best, e) => (distance(e) < distance(best) ? e : best)).name;
}
