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
