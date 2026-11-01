/**
 * The ramp of a season (seasonal Boss design, section 4): honeymoon, reign, meltdown. Which phase a
 * moment is in, and that phase's numbers, are plain arithmetic on the season's dates and the
 * settings; the Boss's own curve may override a number, but only up to a cap the engine holds for
 * every Boss, and each clamp is recorded the way a trimmed answer is (validate.ts's `Trim`), so
 * the meeting can tell the Boss that its curve was cut.
 *
 * Honeymoon is the season's first `honeymoon.days`; meltdown is the last `meltdown.days` before
 * the season's end; reign is between. A season too short for both gives the honeymoon its days
 * first and the meltdown whatever is left, so a playtest's three-week season still ends loud.
 */
import type { Settings } from '../rules/types.ts';
import type { Trim } from './validate.ts';

export const PHASES = ['honeymoon', 'reign', 'meltdown'] as const;
export type PhaseName = (typeof PHASES)[number];

/** What a phase gives the Boss: moves earned a week, the most it can bank, the longest a move of this phase may run. */
export interface PhaseNumbers {
  readonly weeklyMoves: number;
  readonly bankCap: number;
  readonly moveExpiryMostDays: number;
}

/** The honeymoon and the meltdown also have a length in days; the reign is what is between. */
export interface PhaseSettings {
  readonly honeymoon: PhaseNumbers & { readonly days: number };
  readonly reign: PhaseNumbers;
  readonly meltdown: PhaseNumbers & { readonly days: number };
}

/** A Boss's own numbers for any phase; any it leaves out stay the instance's. */
export type PhaseOverrides = { readonly [P in PhaseName]?: Partial<PhaseSettings[P]> };

/** The numbers each phase holds, in the order a settings row and a message list them. */
export const PHASE_KEYS: { readonly [P in PhaseName]: readonly (keyof PhaseSettings[P] & string)[] } = {
  honeymoon: ['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'],
  reign: ['weeklyMoves', 'bankCap', 'moveExpiryMostDays'],
  meltdown: ['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'],
};

/**
 * The most a Boss may override each number to, for every Boss in every instance: roomy enough for
 * a Boss that starts terrible and mellows (a subversion), tight enough that no persona can make the
 * board unplayable. Every number's least is 1.
 */
export const PHASE_CAPS: { readonly [P in PhaseName]: Readonly<PhaseSettings[P]> } = {
  honeymoon: { days: 42, weeklyMoves: 16, bankCap: 28, moveExpiryMostDays: 90 },
  reign: { weeklyMoves: 16, bankCap: 28, moveExpiryMostDays: 90 },
  meltdown: { days: 42, weeklyMoves: 16, bankCap: 28, moveExpiryMostDays: 90 },
};

/**
 * A season's span, in epoch milliseconds. The caller passes the end the database computes,
 * `coalesce(ends_at, starts_at + span_interval(...))` (`seasonLength` is a calendar span, not a
 * number of milliseconds), already as epoch ms.
 */
export interface SeasonSpan {
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface PhaseAt {
  readonly phase: PhaseName;
  readonly numbers: PhaseNumbers;
  /** Every override the caps cut (or raised to the least), whichever phase it was for. */
  readonly clamps: readonly Trim[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function phaseAt(season: SeasonSpan, now: number, settings: Settings, boss?: { readonly phases?: PhaseOverrides }): PhaseAt {
  for (const field of ['startsAt', 'endsAt'] as const) {
    if (!Number.isFinite(season[field])) throw new Error(`phaseAt: season.${field} must be a finite number of epoch milliseconds, got ${String(season[field])}`);
  }
  const clamps: Trim[] = [];
  const phases: { [P in PhaseName]: Record<string, number> } = { honeymoon: {}, reign: {}, meltdown: {} };
  for (const p of PHASES) {
    for (const key of PHASE_KEYS[p]) {
      let n = (settings.phases[p] as unknown as Record<string, number>)[key]!;
      const given = (boss?.phases?.[p] as Record<string, number> | undefined)?.[key];
      if (given !== undefined) {
        const cap = (PHASE_CAPS[p] as unknown as Record<string, number>)[key]!;
        const path = `phases.${p}.${key}`;
        // Every change to an override is recorded: a non-number counts as below the least, a fraction is made whole.
        const whole = typeof given === 'number' ? Math.floor(given) : Number.NaN;
        if (typeof given === 'number' && Number.isFinite(given) && whole !== given) clamps.push({ path, predicate: 'wholeNumber', before: given, after: whole });
        if (!(whole >= 1)) { clamps.push({ path, predicate: 'atLeast(1)', before: given, after: 1 }); n = 1; }
        else if (whole > cap) { clamps.push({ path, predicate: `atMost(${cap})`, before: given, after: cap }); n = cap; }
        else n = whole;
      }
      phases[p][key] = n;
    }
  }
  const honeymoonEnds = season.startsAt + phases.honeymoon.days! * DAY_MS;
  const meltdownStarts = Math.max(honeymoonEnds, season.endsAt - phases.meltdown.days! * DAY_MS);
  const phase: PhaseName = now < honeymoonEnds ? 'honeymoon' : now >= meltdownStarts ? 'meltdown' : 'reign';
  const { weeklyMoves, bankCap, moveExpiryMostDays } = phases[phase] as unknown as PhaseNumbers;
  return { phase, numbers: { weeklyMoves, bankCap, moveExpiryMostDays }, clamps };
}
