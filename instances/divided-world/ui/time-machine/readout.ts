/** The read-out's date, kept apart from Effect.tsx so the card's screen entry (ui.ts) can say it without loading the effect. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** A time as the read-out writes it, in the reader's own time zone: `NOV 14 9:02PM`. Empty for a time that is none. */
export function readOut(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hour = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${hour}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
