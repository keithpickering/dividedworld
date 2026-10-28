/**
 * What makes an instance whole: the checks the engine runs on what an instance hands it,
 * before it is trusted to settle anything. Each returns problems as sentences; [] is whole.
 */
import { QUADRANTS } from './types.ts';
import type { Instance, Settings, Span } from './types.ts';

const SPAN_UNITS: readonly Span['unit'][] = ['day', 'week', 'month'];
const isWhole = (n: unknown, min: number): n is number => Number.isSafeInteger(n) && (n as number) >= min;
const isSpan = (s: unknown): s is Span =>
  typeof s === 'object' && s !== null && SPAN_UNITS.includes((s as Span).unit) && isWhole((s as Span).count, 1);
/**
 * Five fields of numbers, `*`, ranges, lists and steps, each inside its own range (minute,
 * hour, day of month, month, day of week with 0 and 7 both Sunday): what pg_cron and every
 * other cron read. Names (MON, JAN) are refused on purpose, so the setting reads one way only.
 */
const CRON_RANGES: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function cronFieldOk(field: string, [lo, hi]: readonly [number, number]): boolean {
  return field.split(',').every((part) => {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    if (m[4] !== undefined && Number(m[4]) < 1) return false;
    if (m[1] === '*') return true;
    const a = Number(m[2]);
    const b = m[3] === undefined ? a : Number(m[3]);
    return a >= lo && b <= hi && a <= b;
  });
}
const isCron = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  const fields = v.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f, i) => cronFieldOk(f, CRON_RANGES[i]!));
};

/** Every setting the engine reads, each with what it must be. */
const SETTINGS: { readonly [K in keyof Settings]-?: (v: unknown) => string | null } = {
  walletCap: (v) => (isWhole(v, 1) ? null : 'a whole number of hundredths, at least 1'),
  vote: (v) => (isWhole(v, 1) ? null : 'a whole number of hundredths, at least 1'),
  halving: (v) => (typeof v === 'number' && v > 0 && v <= 1 ? null : 'a fraction above 0 and at most 1'),
  reactionCap: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  charactersPerPlayer: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  settlementCron: (v) => (isCron(v) ? null : 'a five-field cron expression, each field inside its range'),
  seasonLength: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count of at least 1'),
  turnCooldown: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count of at least 1'),
  registrationMode: (v) => (v === 'invite' || v === 'open' ? null : '"invite" or "open"'),
  postMaxLength: (v) => (isWhole(v, 1) ? null : 'a whole number of characters, at least 1'),
  titleMaxLength: (v) => (isWhole(v, 1) ? null : 'a whole number of characters, at least 1'),
};

export function settingsProblems(settings: Settings): string[] {
  if (typeof settings !== 'object' || settings === null) return ['the settings are missing'];
  const out: string[] = [];
  for (const [key, rule] of Object.entries(SETTINGS) as [keyof Settings, (v: unknown) => string | null][]) {
    if (!(key in settings) || settings[key] === undefined) { out.push(`setting "${key}" is missing`); continue; }
    const why = rule(settings[key]);
    if (why) out.push(`setting "${key}" is ${JSON.stringify(settings[key])}; it must be ${why}`);
  }
  return out;
}

function duplicates<T>(items: readonly T[], key: (t: T) => string): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) twice.add(k);
    seen.add(k);
  }
  return [...twice];
}

export function instanceProblems(instance: Instance): string[] {
  const out: string[] = [];
  const lists = ['classes', 'cards', 'reactions', 'boards'] as const;
  for (const key of lists) if (!Array.isArray(instance[key])) out.push(`the instance has no ${key} list`);
  if (out.length) return [...out, ...settingsProblems(instance.settings)];
  for (const k of duplicates(instance.reactions, (r) => r.key)) out.push(`reaction key "${k}" is used twice`);
  for (const e of duplicates(instance.reactions, (r) => r.emoji)) out.push(`reaction emoji "${e}" is used twice`);
  for (const r of instance.reactions) {
    if (!QUADRANTS.includes(r.quadrant)) out.push(`reaction "${r.key}" has no quadrant (${JSON.stringify(r.quadrant)} is not one of ${QUADRANTS.join(', ')})`);
  }
  if (!instance.classes.length) out.push('the instance has no class');
  for (const k of duplicates(instance.classes, (c) => c.key)) out.push(`class key "${k}" is used twice`);
  for (const k of duplicates(instance.cards, (c) => c.key)) out.push(`card key "${k}" is used twice`);
  if (!instance.boards.length) out.push('the instance has no board');
  for (const s of duplicates(instance.boards, (b) => b.slug)) out.push(`board slug "${s}" is used twice`);
  out.push(...settingsProblems(instance.settings));
  return out;
}

/** An object frozen all the way down. */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'object' && value !== null && !seen.has(value)) {
    seen.add(value);
    for (const v of Object.values(value)) deepFreeze(v, seen);
    Object.freeze(value);
  }
  return value;
}

/**
 * The settings with some replaced: a new object, frozen all the way down; the defaults are
 * never edited. An override left undefined keeps the default rather than erasing it.
 */
export function withOverrides(settings: Settings, overrides: Partial<Settings>): Settings {
  const given = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return deepFreeze({ ...settings, ...given });
}
