/**
 * A card name's lines. A name longer than `NAME_WRAP_AT` characters that holds a space may break onto two lines at the slot and
 * the phone (Postcard.tsx), so each line can stay a legible size on a plate that is only so wide (postcard.css). The break is at a
 * word boundary, the one that makes the longer line shortest; a name with no space has nowhere to break and stays one line.
 * The name is never changed, only where it breaks: the two lines read back as the name with one space between them.
 */

/** A name this long or shorter is always one line. */
export const NAME_WRAP_AT = 14;

export interface NameLines {
  readonly lines: readonly string[];
  /** The longest line's length in characters: what the stylesheet sizes the type by (`--kb-name-chars`). */
  readonly longest: number;
}

export function nameLines(name: string): NameLines {
  const words = name.split(/\s+/u).filter((w) => w !== '');
  const whole = words.join(' ');
  if (whole.length <= NAME_WRAP_AT || words.length < 2) return { lines: [name], longest: name.length };
  let best: { lines: string[]; longest: number } | null = null;
  for (let i = 1; i < words.length; i += 1) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const longest = Math.max(lines[0]!.length, lines[1]!.length);
    if (best === null || longest < best.longest) best = { lines, longest };
  }
  return best!;
}
