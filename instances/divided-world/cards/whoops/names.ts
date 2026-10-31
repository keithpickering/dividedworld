/**
 * Whoops!'s inks in words. The play form offers its swatches (ConfigForm.tsx), and the plate's readout names a
 * layer's ink so it never says a hex code ("top: Spritey's yellow", the plays-on-a-post design, section 5): the
 * swatch's name when the ink is one, else the swatch nearest it in hue. An ink with no hue to speak of (black, white,
 * a gray) is called by its lightness, since a hue would name it a color it is not. Nothing new is saved on the play.
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

/** Below this saturation an ink has no hue worth naming. */
const GRAY = 0.15;

/** Hue in degrees, saturation and lightness from 0 to 1. */
function hsl([r, g, b]: readonly [number, number, number]): { readonly h: number; readonly s: number; readonly l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const around = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const HUES = SWATCHES.map((s) => ({ name: s.name.toLowerCase(), color: s.color, h: hsl(rgbOf(s.color)).h }));

/** An ink's name for a sentence, lowercased ("yellow"); "ink" for one that cannot be read. */
export function inkName(color: string): string {
  let rgb: [number, number, number];
  try { rgb = rgbOf(color); } catch { return 'ink'; }
  const exact = HUES.find((s) => s.color === `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`);
  if (exact) return exact.name;
  const { h, s, l } = hsl(rgb);
  if (s < GRAY || l < 0.08 || l > 0.95) return l < 0.25 ? 'black' : l > 0.85 ? 'white' : 'gray';
  return HUES.reduce((best, x) => (around(x.h, h) < around(best.h, h) ? x : best)).name;
}
