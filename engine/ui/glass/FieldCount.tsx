import type { ReactNode } from 'react';

/**
 * The line under a text field: its hint at the left and its count at the right, on a line of its own
 * (docs/plans/2026-11-05-backfill-boards-design.md, section 5), so a count is never left floating
 * between its field and the next label. The field names it in `aria-describedby`, so a screen reader
 * hears the hint and then the count. The count is of characters as a player counts them (a pair of
 * code units is one), and says "N of MAX" in words, a sign past the most and not a color alone.
 * New character, Edit profile, the Reveal modal and Write update use it.
 */
export function FieldCount({ id, hint, text, max }: {
  readonly id: string;
  readonly hint?: ReactNode;
  /** The field's text: its length in characters is the count. */
  readonly text: string;
  readonly max: number;
}) {
  const count = [...text].length;
  return (
    <p id={id} className="kb-glass-field-count">
      <span className="kb-glass-field-hint">{hint}</span>{' '}
      <span className="kb-glass-field-tally" data-kb-over={count > max ? '' : undefined}>{count} of {max}</span>
    </p>
  );
}
