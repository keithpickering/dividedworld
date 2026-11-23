/**
 * A persona's visits in a day (the chattier staff design; its plan, Task 2), in plain code: `drawSessions` says when a staff
 * persona is awake. A session is `{ start, end }` in minutes from 00:00 UTC, on the 15-minute grid, so it holds whole rounds. The
 * draw reads only the persona's habits, the pool's defaults and a seeded generator; nothing private, nothing from a database.
 *
 * Portable by construction: no vendor client is imported, and the engine knows no instance.
 */
import type { Persona, PoolSettings } from '../rules/types.ts';

export interface DrawnSession {
  readonly start: number;
  readonly end: number;
}

const GRID = 15;
const DAY_MINUTES = 24 * 60;

/** The whole UTC hours of the waking span, `to` exclusive, wrapping past midnight when `to` is below `from`; `from === to` is the whole day. */
function wakingHours(from: number, to: number): number[] {
  const hours: number[] = [];
  const count = to === from ? 24 : (to - from + 24) % 24;
  for (let i = 0; i < count; i++) hours.push((from + i) % 24);
  return hours;
}

/** A random whole number from `least` to `most`, both included. */
function between(rng: () => number, least: number, most: number): number {
  return least + Math.floor(rng() * (most - least + 1));
}

/**
 * The sessions a persona keeps on a day, sorted by start. `perDay` of them (the persona's `habits`, else the pool's), each a length drawn
 * from `minutes` and rounded up to a multiple of 15 (never under 15), starting on the grid inside the favored hours (`habits.hours`, else
 * the waking span). None overlaps another or crosses midnight (one drawn to cross is cut at 24:00). Where the hours cannot hold them
 * all, fewer are drawn.
 */
export function drawSessions(persona: Persona, day: string, pool: PoolSettings, rng: () => number): DrawnSession[] {
  void day; // the day is in the rng's seed; the argument keeps the call's shape the plan names
  const habits = persona.habits;
  const perDay = habits?.perDay ?? pool.sessions.perDay;
  const minutes = habits?.minutes ?? pool.sessions.minutes;
  const hours = habits?.hours ?? wakingHours(pool.sessions.waking.from, pool.sessions.waking.to);
  const placed: DrawnSession[] = [];
  for (let n = 0; n < perDay; n++) {
    const raw = between(rng, minutes.least, minutes.most);
    const length = Math.max(Math.ceil(raw / GRID) * GRID, GRID);
    const starts: number[] = [];
    for (const hour of [...new Set(hours)].sort((a, b) => a - b)) {
      for (let start = hour * 60; start < hour * 60 + 60; start += GRID) {
        const end = Math.min(start + length, DAY_MINUTES);
        if (placed.every((s) => end <= s.start || start >= s.end)) starts.push(start);
      }
    }
    if (starts.length === 0) break;
    const start = starts[Math.floor(rng() * starts.length)]!;
    placed.push({ start, end: Math.min(start + length, DAY_MINUTES) });
  }
  return placed.sort((a, b) => a.start - b.start);
}
