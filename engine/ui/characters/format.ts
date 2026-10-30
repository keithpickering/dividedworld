import type { Span } from '../../rules/types.ts';

/** Aura in hundredths as the board writes it: 1420 is "14.20". */
export const figure = (hundredths: number) => (hundredths / 100).toFixed(2);

/** "a Face", "an Underdog". */
export const withArticle = (name: string) => `${/^[aeiou]/iu.test(name) ? 'an' : 'a'} ${name}`;

/** A span the way a player says it: "30 days", "1 month". */
export function spanWords(span: Span): string {
  const unit = span.unit === 'minute' ? 'minute' : span.unit;
  return `${span.count} ${unit}${span.count === 1 ? '' : 's'}`;
}

/** "Oct 30, 1:17 AM": a day and a time in the reader's zone. */
export const dayAndTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "in 13 days": how far off a time is, in whole days, never under one. */
export function inDays(iso: string, nowMs = Date.now()): string {
  const days = Math.max(1, Math.ceil((Date.parse(iso) - nowMs) / 86_400_000));
  return `in ${days} ${days === 1 ? 'day' : 'days'}`;
}
