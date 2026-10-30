import type { Span } from '../../rules/types.ts';

/** A length of time as a player reads it: "7 days", "1 week". */
export function spanWords(span: Span): string {
  const unit = span.unit === 'minute' ? 'minute' : span.unit;
  return `${span.count} ${unit}${span.count === 1 ? '' : 's'}`;
}
