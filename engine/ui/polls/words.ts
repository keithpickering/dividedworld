/**
 * What a poll says in words, plain and true (the glass's voice, never a character's): when it closes, how it closed, and a ballot in a line. Pure, so a story and a test read them alone.
 */
import { dayAndTime } from '../characters/format.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 days", "5 hours", "40 minutes": the time left, in its nearest whole unit (a day from 36 hours, an hour from 90 minutes), never under a minute. */
export function timeLeft(ms: number): string {
  if (ms >= 36 * HOUR) return plural(Math.round(ms / DAY), 'day');
  if (ms >= 90 * MINUTE) return plural(Math.round(ms / HOUR), 'hour');
  return plural(Math.max(1, Math.ceil(ms / MINUTE)), 'minute');
}

/** "Nov 22, 2026": the day a poll closed, in the reader's zone. */
export const closedOn = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The head's last words: "closes in 2 days", "closed Nov 22, 2026", or "closed early by its author" or "by an admin" where a close ended it before its time. */
export function closing(poll: { readonly endsAt: string; readonly closed: boolean }, by: 'author' | 'admin' | null, nowMs: number): string {
  if (!poll.closed) return `closes in ${timeLeft(Date.parse(poll.endsAt) - nowMs)}`;
  if (by !== null) return `closed early by ${by === 'author' ? 'its author' : 'an admin'}`;
  return `closed ${closedOn(poll.endsAt)}`;
}

/** "Pipe Frame", "Pipe Frame and Badwagon", "A, B and C". */
export function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * One ballot of a public poll's record as a line: "Wario picked Badwagon, Nov 20, 3:12 PM", "Wario switched to Mr. Scooty, ...", "Wario withdrew, ...". It is a switch when the same
 * character's ballot before it picked something; `before` is whether that earlier ballot picked something (false where it has none, or where it was a withdrawal), or null where it is not known.
 */
export function ballotLine(name: string, picks: readonly string[], before: boolean | null, at: string): string {
  /* `before` null: the earlier ballot may be on a page not read yet, so the line does not say whether it switched. */
  const what = picks.length === 0 ? 'withdrew' : `${before === null ? 'voted for' : before ? 'switched to' : 'picked'} ${listed(picks)}`;
  return `${name} ${what}, ${dayAndTime(at)}`;
}
