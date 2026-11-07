/**
 * A card's chosen ink (`CardUi.tag`) as the glass draws it. The ink is a player's choice (Whoops!'s splat color), so it can
 * be any color, black among them, while the glass it is drawn on is dark in every mode: the Lens fills its open tab in the
 * ink and writes on it in `--kb-glass-ink-neon`, and edges a play's plate, a mark and a moment's ring in it. So an ink too
 * dark to read there is mixed toward white, keeping its hue, until the tab's words on it meet 4.5:1 (which also puts its
 * edge past 3:1 on the glass's fields; ink.test.ts reads both from glass/tokens.css). Only the glass's rendition is lifted:
 * the effect on the post (the splat itself) keeps the color as chosen. An ink this cannot read (a token, a name, a color with
 * alpha) cannot be checked, so none is given and the card's alignment draws the tag.
 *
 * The words on the tab are the theme's (`onInk`, the value `--kb-glass-ink-neon` resolves to where the glass is drawn: an
 * instance's glass.json sets it, and its high key may set another), so the caller reads the token and passes it; this file
 * holds no color of its own (tools/check-ui-tokens.mjs). Where the token cannot be read either, nothing can be measured,
 * and no ink is given.
 */
import { parseColor, ratio } from '../contrast.ts';

const READS = 4.5;

const hex = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Parsed, or null where the color cannot be read. */
const read = (color: string): [number, number, number] | null => {
  try {
    return parseColor(color);
  } catch {
    return null;
  }
};

/** `color` as the glass draws it, under words in `onInk` (`--kb-glass-ink-neon` as resolved). */
export function glassInk(color: string, onInk: string): string | undefined {
  const rgb = read(color);
  const on = read(onInk);
  if (!rgb || !on) return undefined;
  const ON_INK = hex(on);
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
