/** An update's time, told in UTC so every player reads the same date (the Updates page and the preview in Write an update draw it the same). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** "Nov 2": a day in UTC, as the update's own time is told, so every player reads the same date. Nothing when it cannot be read. */
export function utcDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** "Nov 2 · 08:00 UTC". */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${utcDay(iso)} · ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}
