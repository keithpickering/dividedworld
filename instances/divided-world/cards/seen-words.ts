/**
 * The small words the cards' `seen` sentences share (docs/plans/2026-11-25-reads-see-the-board-design.md, section 3). A `seen` is read by a model,
 * never shown to a player: it says what a reader of the board sees of one play, in the fiction's voice, and never a mechanic, a number a player cannot see,
 * or a name the board does not show. Its inputs are data from outside, so each reader here falls back to nothing, never throws.
 */
import type { SeenPlay } from '../../../engine/rules/cards.ts';

/** The caster as the board names them, or "Someone" where it names none. */
export const who = (p: Pick<SeenPlay, 'by'>): string => (typeof p.by === 'string' && p.by.trim() !== '' ? p.by : 'Someone');

/** A field of a play's configuration or state, or undefined for anything that is not an object holding it. */
export const field = (from: unknown, key: string): unknown => (typeof from === 'object' && from !== null && !Array.isArray(from) ? (from as Record<string, unknown>)[key] : undefined);

/** A text field, trimmed and cut to `most` characters with an ellipsis; null where it is missing, not text or empty. */
export function textField(from: unknown, key: string, most = 120): string | null {
  const v = field(from, key);
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/gu, ' ');
  if (t === '') return null;
  const all = [...t];
  return all.length > most ? `${all.slice(0, most).join('').trimEnd()}…` : t;
}

/** A color as a word to sit in a sentence: a named color as it is, a hex color as null (the board shows it as a color, and a model cannot read hex as one). */
export const colorWord = (from: unknown, key = 'color'): string | null => {
  const t = textField(from, key, 30);
  return t !== null && /^[a-z]+$/iu.test(t) ? t.toLowerCase() : null;
};

/** The first letter capitalized, to start a sentence with an amount ("a bit" becomes "A bit"). */
export const capital = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));
