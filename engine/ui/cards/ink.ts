/**
 * A card's chosen ink (`CardUi.tag`) as the glass draws it. The ink is a player's choice (Whoops!'s splat color), so it can
 * be any color, black among them, while the glass it is drawn on is dark in every mode: the Lens fills its open tab in the
 * ink and writes on it in `--kb-glass-ink-neon`, and edges a play's plate, a mark and a moment's ring in it. So an ink too
 * dark to read there is mixed toward white, keeping its hue, until the tab's words on it meet 4.5:1 (which also puts its
 * edge past 3:1 on the glass's fields; ink.test.ts reads both from glass/tokens.css). Only the glass's rendition is lifted:
 * the effect on the post (the splat itself) keeps the color as chosen. An ink this cannot read (a token, a name, a color with
 * alpha) cannot be checked, so none is given and the card's alignment draws the tag.
 */
import { parseColor, ratio } from '../contrast.ts';

/** `--kb-glass-ink-neon`, the words on a filled tab (glass/tokens.css). */
const ON_INK = '#000000';
const READS = 4.5;

const hex = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

export function glassInk(color: string): string | undefined {
  let rgb: [number, number, number];
  try {
    rgb = parseColor(color);
  } catch {
    return undefined;
  }
  if (ratio(hex(rgb), ON_INK) >= READS) return color;
  /* The least mix toward white that reads, found by halving: the contrast only grows as the mix does. */
  const mix = (t: number) => hex(rgb.map((c) => c + (255 - c) * t));
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (ratio(mix(mid), ON_INK) >= READS) hi = mid;
    else lo = mid;
  }
  return mix(hi);
}
