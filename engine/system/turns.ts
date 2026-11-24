/**
 * Turns: what a round answers (the chattier staff design; its plan, Task 3), in plain code. A round is one run of the chatter function; a
 * persona with a session open spends turns in it, each answering the waiting replies in one thread. Two pure functions:
 *
 *   roundShare(spentToday, perDay, slot, cronMinutes)     how many characters this round may spend (the day earned evenly, a slice a round)
 *   planTurns(open, sessions, turns, slot)                which turns the caps allow, hottest thread first
 *   pacer(available)                                      whether the next turn may start, as each turn's size is learned
 *
 * Every input is public play (a persona's threads, the replies waiting on it, the public reaction total on its turns, the sessions drawn
 * for it): nothing here reads who owns a character, a class or who reacted. A seeded tie-break from the slot makes a rerun of a round plan
 * the same. Portable by construction: no vendor client is imported, and the engine knows no instance.
 */
import type { PoolSettings } from '../rules/types.ts';
import { byUnit, seededRng } from './pool.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A reply waiting on a persona's post. `at` is when it was written (ISO), which gives the wait its age. */
export interface WaitingReply { readonly act: string; readonly author: string; readonly at: string }

/** A persona's thread with replies waiting, newest last, and the public reaction total on the persona's turns there. */
export interface OpenThread {
  readonly staff: string;
  readonly thread: string;
  readonly replies: readonly WaitingReply[];
  readonly heat: number;
}

/** A persona's session open now, with the turns it has spent in it in all and per thread. */
export interface AwakeSession {
  readonly staff: string;
  readonly session: number;
  readonly spent: number;
  readonly spentByThread: Readonly<Record<string, number>>;
}

/** One turn to write: the reply it quotes (the newest waiting) and every reply it answers. */
export interface PlannedTurn {
  readonly staff: string;
  readonly session: number;
  readonly thread: string;
  readonly quoting: string;
  readonly answers: readonly string[];
}

/**
 * How many characters this round may spend. Its callers pass characters: `spentToday` is the day's characters charged and `perDay` the
 * day's character budget, though the arithmetic is unit-free. The day's budget is earned evenly, one slice per round, so no round
 * front-loads the day. `slot` is the round's time in epoch milliseconds, and rounds fall every `cronMinutes` from the start of the UTC
 * day: round k = floor(intoDay / step) of N = ceil(DAY / step) a day. By round k the day has earned floor(perDay x (k + 1) / N); the
 * round may spend what is earned and not yet spent, never below 0. A quiet morning leaves its earnings available later; the last round
 * has earned the whole day.
 */
export function roundShare(spentToday: number, perDay: number, slot: number, cronMinutes: number): number {
  const step = Math.max(cronMinutes, 1) * 60 * 1000;
  const intoDay = ((slot % DAY_MS) + DAY_MS) % DAY_MS;
  const rounds = Math.ceil(DAY_MS / step);
  const k = Math.floor(intoDay / step); // below `rounds`, since intoDay < DAY_MS
  const earned = Math.floor((perDay * (k + 1)) / rounds);
  return Math.max(earned - spentToday, 0);
}

/**
 * The round's turns: personas in session only, ranked by heat, then by how many replies wait, then by the oldest wait,
 * then a tie-break seeded from the slot; one turn per persona per thread, inside `perThread` and `perSession`. Every turn the caps
 * allow is returned, in ranked order; the round decides how many to start (`pacer`).
 */
export function planTurns(
  open: readonly OpenThread[],
  sessions: readonly AwakeSession[],
  turns: PoolSettings['turns'],
  slot: number,
): PlannedTurn[] {
  // A persona's sessions in a fixed order; a turn goes to the first with room.
  const sessionsOf = new Map<string, AwakeSession[]>();
  for (const s of [...sessions].sort((a, b) => a.session - b.session)) {
    const held = sessionsOf.get(s.staff);
    if (held) held.push(s); else sessionsOf.set(s.staff, [s]);
  }
  // The candidates in a fixed order, each given its tie-breaker from the one generator, so the same slot and the same threads plan the
  // same whatever order they arrive in. One per persona per thread.
  const seen = new Set<string>();
  const ordered = open
    .filter((o) => o.replies.length > 0 && sessionsOf.has(o.staff))
    .sort((a, b) => byUnit(a.staff, b.staff) || byUnit(a.thread, b.thread))
    .filter((o) => { const k = `${o.staff}\u0000${o.thread}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const rng = seededRng(`kayfabb-turns:${slot}`);
  const ranked = ordered.map((o) => {
    const oldest = Math.min(...o.replies.map((r) => Date.parse(r.at)));
    return { o, tie: rng(), waiting: o.replies.length, oldest: Number.isNaN(oldest) ? Infinity : oldest };
  }).sort((a, b) => b.o.heat - a.o.heat || b.waiting - a.waiting || a.oldest - b.oldest || b.tie - a.tie);

  const planned: PlannedTurn[] = [];
  const spentNow = new Map<number, number>();
  for (const { o } of ranked) {
    const s = (sessionsOf.get(o.staff) ?? []).find((x) =>
      x.spent + (spentNow.get(x.session) ?? 0) < turns.perSession && (x.spentByThread[o.thread] ?? 0) < turns.perThread);
    if (!s) continue;
    spentNow.set(s.session, (spentNow.get(s.session) ?? 0) + 1);
    planned.push({ staff: o.staff, session: s.session, thread: o.thread, quoting: o.replies.at(-1)!.act, answers: o.replies.map((r) => r.act) });
  }
  return planned;
}

/**
 * Pacing a round by characters. A turn's size is known only after it is built, so the round asks `mayStart()` before each turn and
 * `charge(size)` after it: a turn may start while anything is available (`available > 0`) and may overdraw, so `remaining()` goes negative.
 */
export function pacer(available: number): { mayStart(): boolean; charge(size: number): void; remaining(): number } {
  let left = available;
  return { mayStart: () => left > 0, charge: (size) => { left -= size; }, remaining: () => left };
}
