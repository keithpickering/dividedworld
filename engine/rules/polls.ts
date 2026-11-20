/**
 * A poll's rules in TypeScript: what a draft must be, and the arithmetic of a poll's counts. `pollDraftProblems` says each refusal in the
 * words `poll_written` says it in (supabase/migrations/0381_polls.sql, held beside it in polls.test.ts by supabase/tests/0381-polls.sql's
 * sentences); `countedBallots` and `pollCounts` are `poll_counts`'s arithmetic (0381, section 7), for a client's preview of a live event
 * and for the fake. The engine knows no instance: the limits come from the settings it is handed.
 */
import type { Span } from './types.ts';

/** The five settings a draft is held against. */
export interface PollSettings {
  readonly pollOptionsMax: number;
  readonly pollQuestionMax: number;
  readonly pollOptionMax: number;
  readonly pollLastsMin: Span;
  readonly pollLastsMax: Span;
}

/**
 * A poll as its author drafts it. `lasts` is a span ({unit, count}), which is what the client sends; the database also takes any interval
 * string; this takes only one number and one unit ("3 days"), so it is a preview, never the authority. The poll closes at the time of writing plus it.
 */
export interface PollDraft {
  readonly question: string;
  readonly options: readonly string[];
  readonly pick: number;
  readonly secret: boolean;
  readonly lasts: Span | string;
}

/** A ballot as the counts read it: who, which options (indices, a withdrawal is empty), when, and its Act's id for a tie in time. */
export interface CountedBallot {
  readonly act?: string;
  readonly character: string | null;
  readonly picks: readonly number[];
  readonly at: string;
}

const HOURS = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 720 } as const;
/** The same blank `within` (supabase/migrations/0005) and `actions.ts` hold: whitespace, line terminators and the zero-width ones. */
const BLANK = /^[\s​-‍⁠﻿]*$/u;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** `span_words` (0055): "1 hour", "14 days". */
export const spanWords = (s: Span): string => plural(s.count, s.unit);

const isSpan = (v: unknown): v is Span => typeof v === 'object' && v !== null && typeof (v as Span).count === 'number' && typeof (v as Span).unit === 'string' && (v as Span).unit in HOURS;
const length = (s: string) => [...s].length;

/** A draft's `lasts` in hours: a span, or an interval string of one number and one unit ("3 days"); null for anything else. */
export function lastsHours(lasts: unknown): number | null {
  if (isSpan(lasts)) return Number.isFinite(lasts.count) ? lasts.count * HOURS[lasts.unit] : null;
  if (typeof lasts !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(minute|hour|day|week|month)s?\s*$/i.exec(lasts);
  return m ? Number(m[1]) * HOURS[m[2]!.toLowerCase() as keyof typeof HOURS] : null;
}

/**
 * The first predicate a draft fails, as `poll_written` says it, in an array of one (none when the draft is well formed): the database
 * refuses at the first too, in this order: the question, each option in turn, the number of options, the pick, the secret, the length.
 * (The count of options is read first by the database, then the options one by one.)
 */
export function pollDraftProblems(draft: unknown, settings: PollSettings): string[] {
  const d = (typeof draft === 'object' && draft !== null ? draft : {}) as Record<string, unknown>;
  const q = typeof d.question === 'string' ? d.question : null;
  const field = (name: string, value: string | null, most: number): string | null =>
    value === null || BLANK.test(value) ? `${name} is empty` : length(value) > most ? `${name} is longer than ${most} characters` : null;
  const asked = field('question', q, settings.pollQuestionMax);
  if (asked) return [asked];
  const opts = d.options;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > settings.pollOptionsMax) return [`a poll has 2 to ${settings.pollOptionsMax} options`];
  const seen: string[] = [];
  for (const o of opts) {
    const s = typeof o === 'string' ? o : null;
    const bad = field('option', s, settings.pollOptionMax);
    if (bad) return [bad];
    if (seen.includes(s!.trim())) return ['no two options are the same'];
    seen.push(s!.trim());
  }
  const n = opts.length;
  if (typeof d.pick !== 'number' || !Number.isInteger(d.pick) || d.pick < 1 || d.pick > n) return [`a poll lets 1 to ${n} options be picked`];
  if (typeof d.secret !== 'boolean') return ["a poll's ballots are public or secret"];
  const hours = lastsHours(d.lasts);
  if (hours === null || hours < settings.pollLastsMin.count * HOURS[settings.pollLastsMin.unit] || hours > settings.pollLastsMax.count * HOURS[settings.pollLastsMax.unit]) {
    return [`a poll lasts from ${spanWords(settings.pollLastsMin)} to ${spanWords(settings.pollLastsMax)}`];
  }
  return [];
}

/** `cast_ballot`'s refusal of too many picks, in its words: singular for one. */
export const pickRefusal = (pick: number): string => `pick up to ${pick} option${pick === 1 ? '' : 's'}`;

/** A poll's end is the earlier of its own end and its close's time; it is closed once `now` reaches it. */
export function pollClosed(poll: { readonly endsAt: string }, close: { readonly createdAt: string } | null, now: number | string | Date): boolean {
  const end = Math.min(Date.parse(poll.endsAt), close ? Date.parse(close.createdAt) : Infinity);
  return new Date(now).getTime() >= end;
}

/**
 * Each character's counted ballot: its latest by (time, id) created before the poll's end (`poll_counts`). A character that is unknown
 * (null, a secret ballot's projection) is not counted here: its ballots are never in what a reader holds.
 */
export function countedBallots<B extends CountedBallot>(ballots: readonly B[], endsAt: string): B[] {
  const end = Date.parse(endsAt);
  const latest = new Map<string, B>();
  for (const b of ballots) {
    if (b.character === null || !(Date.parse(b.at) < end)) continue;
    const had = latest.get(b.character);
    if (!had || Date.parse(b.at) > Date.parse(had.at) || (Date.parse(b.at) === Date.parse(had.at) && (b.act ?? '') > (had.act ?? ''))) latest.set(b.character, b);
  }
  return [...latest.values()];
}

/** `poll_counts`'s counts for a poll: one entry for each option (picks past the options are ignored), and voters, the characters whose counted ballot picks something. */
export function pollCounts(poll: { readonly options: readonly unknown[]; readonly endsAt: string }, ballots: readonly CountedBallot[]): { counts: number[]; voters: number } {
  const counts = poll.options.map(() => 0);
  let voters = 0;
  for (const b of countedBallots(ballots, poll.endsAt)) {
    const picks = [...new Set(b.picks)].filter((p) => Number.isInteger(p) && p >= 0 && p < counts.length);
    if (picks.length === 0) continue;
    voters++;
    for (const p of picks) counts[p]!++;
  }
  return { counts, voters };
}

/** A count's percent of all the picks, a whole number: 0 when nothing is picked. */
export function percent(count: number, total: number): number {
  return total <= 0 ? 0 : Math.round((count / total) * 100);
}
