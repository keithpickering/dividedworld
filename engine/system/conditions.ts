/**
 * The conditions that unlock a beat (fangame split design, section 2): the engine's one fixed list of what the code checks before a beat's brief is shown. As
 * `engine/rules/predicates.ts` holds the rule predicates, this holds the conditions: `seed_instance` writes it to `condition_kinds` (supabase/functions/_shared/seed.ts), and
 * `beat_condition_holds` (supabase/migrations/0164_arcs.sql) has a branch for every key, which supabase/tests/0162-arcs.sql proves ("Two lists that must agree are one list").
 *
 * Every condition reads public facts only: posts per board, moves, demands, and beats. None reads who plays a character, a class, or who reacted ("A response never proves a
 * private fact"), so a condition can be checked by the tick on its own schedule and no response time varies with anything private.
 *
 * A word on names: an arc's "beat" is a step of a persona's plan. A Mod Bot's patrol `beats` (the boards it watches, `Persona.beats`) are another thing, and the SQL tables
 * that hold the arc's are called `arc_beat_events` and `persona_arcs` so the two cannot be confused.
 *
 * A parameter is bounded here, and a bound overshot is a beat rejected naming the predicate that failed, never a condition changed: a threshold nudged to fit would be a plan
 * nobody wrote. Pure: nothing here reads a clock or a database.
 */
import { UUID } from './moves.ts';
import { PHASES } from './phases.ts';

export interface Condition {
  readonly kind: string;
  readonly [param: string]: unknown;
}

export interface ConditionKind {
  readonly key: string;
  /** The condition in plain words, for an admin reading the catalog; travels in the seed to `condition_kinds`. */
  readonly plain: string;
}

export const CONDITIONS: readonly ConditionKind[] = [
  { key: 'phase', plain: 'a phase of the season has begun, or the season is within some days of its end' },
  { key: 'beatLanded', plain: 'an earlier beat\'s bundle has landed' },
  { key: 'boardActivity', plain: 'a board\'s posts over the last days are above or below a number, or above or below another board\'s' },
  { key: 'moveReversed', plain: 'an admin reversed one of this Boss\'s moves' },
  { key: 'demandResolved', plain: 'a demand on one of this Boss\'s moves was met, or failed' },
];

export const CONDITION_KEYS: readonly string[] = CONDITIONS.map((c) => c.key);

/** How far back a board's posts are counted: at least a day, at most 90, so a count is one bounded window. SQL reads the same window. */
export const ACTIVITY_DAYS = { least: 1, most: 90 } as const;
/** The most a board's post count is compared to. */
export const ACTIVITY_COUNT_MOST = 100_000;
/** The most days before the season's end a phase condition or a due point may name. */
export const DAYS_BEFORE_END_MOST = 365;

/** What a beat or a role may be called: the same style as a bundle role, so a key can name one in SQL. */
export const BEAT_KEY = /^[a-z][a-z0-9_-]{0,39}$/;

export interface ConditionProblem {
  /** The param that failed, or `kind` for the condition itself. */
  readonly path: string;
  /** The predicate that failed, in `repair`'s words (`atMost(90)`, `oneOf(...)`). */
  readonly predicate: string;
  /** The problem in a sentence that names what was wrong. */
  readonly said: string;
}

const problem = (path: string, predicate: string, said: string): ConditionProblem => ({ path, predicate, said });
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A whole number in a range: null when it holds, else the predicate. */
function whole(v: unknown, least: number, most: number): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return 'isInteger';
  return v < least ? `atLeast(${least})` : v > most ? `atMost(${most})` : null;
}

/** Params the condition does not take. */
function stray(c: Record<string, unknown>, allowed: readonly string[]): ConditionProblem | null {
  const extra = Object.keys(c).find((k) => k !== 'kind' && !allowed.includes(k));
  return extra === undefined ? null : problem(extra, 'noParam', `condition "${String(c['kind'])}" takes no "${extra}"`);
}

/**
 * A board named in a condition: a board's uuid, or a role a beat's bundle made, `{role, beat}` (the board that beat's part of that role made, read from the Acts that landed). A bare
 * `{role}` names a part of the bundle being queued, which no condition has.
 */
export function isBoardTarget(v: unknown): boolean {
  if (typeof v === 'string') return UUID.test(v);
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 2 && keys.includes('role') && keys.includes('beat') && typeof v['role'] === 'string' && typeof v['beat'] === 'string' && BEAT_KEY.test(v['role']) && BEAT_KEY.test(v['beat']);
}

const phaseProblem = (v: unknown, path: string): ConditionProblem | null =>
  typeof v === 'string' && (PHASES as readonly string[]).includes(v) ? null : problem(path, `oneOf(${PHASES.join(', ')})`, `"${String(v)}" is not a phase of the season (${PHASES.join(', ')})`);

/** A condition against the catalog: null when its key and params hold, else the one thing that failed. */
export function conditionProblem(c: unknown): ConditionProblem | null {
  if (!isObject(c) || typeof c['kind'] !== 'string') {
    return problem('kind', `oneOf(${CONDITION_KEYS.join(', ')})`, `a condition is an object with a "kind", one of ${CONDITION_KEYS.join(', ')}`);
  }
  const key = c['kind'];
  switch (key) {
    case 'phase': {
      const extra = stray(c, ['phase', 'daysBeforeEnd']);
      if (extra) return extra;
      const has = (k: string) => c[k] !== undefined;
      if (!has('phase') && !has('daysBeforeEnd')) return problem('phase', 'atLeastOneOf(phase, daysBeforeEnd)', 'a phase condition names a phase, or days before the end, or both');
      if (has('phase')) { const bad = phaseProblem(c['phase'], 'phase'); if (bad) return bad; }
      if (has('daysBeforeEnd')) {
        const bad = whole(c['daysBeforeEnd'], 1, DAYS_BEFORE_END_MOST);
        if (bad) return problem('daysBeforeEnd', bad, `daysBeforeEnd must be a whole number of days from 1 to ${DAYS_BEFORE_END_MOST} (${bad})`);
      }
      return null;
    }
    case 'beatLanded': {
      const extra = stray(c, ['beat']);
      if (extra) return extra;
      if (c['beat'] === undefined) return problem('beat', 'required', 'beatLanded names the beat that must have landed');
      if (typeof c['beat'] !== 'string') return problem('beat', 'isString', 'beatLanded\'s beat is a key, a string');
      return BEAT_KEY.test(c['beat']) ? null : problem('beat', 'isKey', `"${c['beat']}" is not a beat key (lowercase letters, digits, hyphens and underscores, from a letter)`);
    }
    case 'boardActivity': {
      const extra = stray(c, ['board', 'days', 'above', 'below']);
      if (extra) return extra;
      if (!isBoardTarget(c['board'])) return problem('board', 'isBoard', 'boardActivity\'s board is a board\'s uuid, or {role, beat}: the board that beat\'s part of that role made');
      if (c['days'] === undefined) return problem('days', 'required', 'boardActivity counts posts over some days');
      const days = whole(c['days'], ACTIVITY_DAYS.least, ACTIVITY_DAYS.most);
      if (days) return problem('days', days, `boardActivity's days is a whole number from ${ACTIVITY_DAYS.least} to ${ACTIVITY_DAYS.most} (${days})`);
      const sides = (['above', 'below'] as const).filter((k) => c[k] !== undefined);
      if (sides.length !== 1) return problem('above', 'exactlyOneOf(above, below)', 'boardActivity compares the count with exactly one of above and below');
      const side = sides[0]!;
      const to = c[side];
      if (typeof to === 'number') {
        const bad = whole(to, 0, ACTIVITY_COUNT_MOST);
        return bad ? problem(side, bad, `${side} is a whole number of posts from 0 to ${ACTIVITY_COUNT_MOST} (${bad})`) : null;
      }
      return isBoardTarget(to) ? null : problem(side, 'isBoard', `${side} is a number of posts, or another board: a uuid, or {role, beat}`);
    }
    case 'moveReversed':
      return stray(c, []);
    case 'demandResolved': {
      const extra = stray(c, ['outcome']);
      if (extra) return extra;
      if (c['outcome'] === undefined) return problem('outcome', 'required', 'demandResolved names an outcome, met or failed');
      return c['outcome'] === 'met' || c['outcome'] === 'failed' ? null : problem('outcome', 'oneOf(met, failed)', `"${String(c['outcome'])}" is not an outcome (met or failed)`);
    }
    default:
      return problem('kind', `oneOf(${CONDITION_KEYS.join(', ')})`, `condition "${key}" is not one of ${CONDITION_KEYS.join(', ')}`);
  }
}

/** What a beat's firmness says: due by a point of the season. A mini-arc is never due. */
export interface Due {
  readonly phase?: string;
  readonly daysIntoPhase?: number;
  readonly daysBeforeEnd?: number;
}

/** A due point's shape: a phase, days into it (which need it), or days before the season's end. */
export function dueProblem(d: unknown): ConditionProblem | null {
  if (!isObject(d)) return problem('due', 'isObject', 'a due point is an object: a phase, days into it, or days before the end');
  const extra = Object.keys(d).find((k) => !['phase', 'daysIntoPhase', 'daysBeforeEnd'].includes(k));
  if (extra !== undefined) return problem(extra, 'noParam', `a due point takes no "${extra}"`);
  const has = (k: string) => d[k] !== undefined;
  if (!has('phase') && !has('daysIntoPhase') && !has('daysBeforeEnd')) return problem('due', 'atLeastOneOf(phase, daysIntoPhase, daysBeforeEnd)', 'a due point names a phase, days into it, or days before the end');
  if (has('phase')) { const bad = phaseProblem(d['phase'], 'phase'); if (bad) return bad; }
  if (has('daysIntoPhase')) {
    if (!has('phase')) return problem('daysIntoPhase', 'requires(phase)', 'days into a phase need the phase they are into');
    const bad = whole(d['daysIntoPhase'], 0, DAYS_BEFORE_END_MOST);
    if (bad) return problem('daysIntoPhase', bad, `daysIntoPhase is a whole number of days from 0 to ${DAYS_BEFORE_END_MOST} (${bad})`);
  }
  if (has('daysBeforeEnd')) {
    const bad = whole(d['daysBeforeEnd'], 0, DAYS_BEFORE_END_MOST);
    if (bad) return problem('daysBeforeEnd', bad, `daysBeforeEnd is a whole number of days from 0 to ${DAYS_BEFORE_END_MOST} (${bad})`);
  }
  return null;
}
