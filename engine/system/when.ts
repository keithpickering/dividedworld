/**
 * Relative times and amounts, said as a person says them (docs/plans/2026-11-25-reads-see-the-board-design.md, sections 1 and 3).
 * Pure: `now` is passed in, never read from the clock. Every span floors, never rounds up.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A count with its unit, singular for one: "a minute", "12 minutes". */
function phrase(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** The span of `ms` as a phrase without its frame ("12 minutes"), or null under a minute (and for NaN). */
function span(ms: number): string | null {
  if (!(ms >= MINUTE)) return null;
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return phrase(minutes, 'a minute', 'minutes');
  const hours = Math.floor(ms / HOUR);
  if (hours < 48) return phrase(hours, 'an hour', 'hours');
  const days = Math.floor(ms / DAY);
  if (days < 60) return phrase(days, 'a day', 'days');
  const months = Math.floor(days / 30);
  if (months < 24) return phrase(months, 'a month', 'months');
  return phrase(Math.floor(days / 365), 'a year', 'years');
}

/** "just now" for a past time; "in under a minute" for a future one, or a `then` that does not parse. */
export function ago(then: string, now: number): string {
  const s = span(now - Date.parse(then));
  return s === null ? 'just now' : `${s} ago`;
}

/** The future twin of `ago`: "in under a minute", "in 12 minutes"; a past or unparseable `then` reads in under a minute. */
export function until(then: string, now: number): string {
  const s = span(Date.parse(then) - now);
  return s === null ? 'in under a minute' : `in ${s}`;
}

/** A share in [0, 1] (clamped) as a word: none, a bit, some, about half, most, almost all, all. NaN reads none. */
export function amountWords(share: number): string {
  if (Number.isNaN(share)) return 'none';
  const s = Math.min(1, Math.max(0, share));
  if (s === 0) return 'none';
  if (s === 1) return 'all';
  if (s < 0.15) return 'a bit';
  if (s < 0.4) return 'some';
  if (s < 0.6) return 'about half';
  if (s < 0.85) return 'most';
  return 'almost all';
}
