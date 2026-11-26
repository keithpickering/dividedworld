const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Oct 2026" from the calendar month the server gave (a date on the first of it, or a time): the
 * month, and never the day or the time. It is shown as given, in UTC, whatever the reader's zone:
 * a month is not an instant. Nothing when it cannot be read.
 */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Oct 3": a day in the reader's own zone, like every other date and time on a forum page. Nothing when it cannot be read. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Whether a date is in the current year, in the reader's zone, by the clock the page reads (`nowMs`, the backend's: `api.now()`). */
export function sameYear(d: Date, nowMs: number): boolean {
  return d.getFullYear() === new Date(nowMs).getFullYear();
}

/**
 * A time the screens say in a line: "2:02 PM" for a time on the reader's own day by the clock the page reads (`nowMs`, the backend's:
 * `api.now()`), and "Nov 20, 2:02 PM" for one on another day this year, and "Nov 20, 2025, 2:02 PM" for one in another year, in the reader's zone like every other time on a forum page. Nothing when it cannot be read.
 */
export function shortTime(iso: string, nowMs: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(nowMs).toDateString()) return time;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${sameYear(d, nowMs) ? '' : `${d.getFullYear()}, `}${time}`;
}
