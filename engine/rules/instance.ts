/**
 * What makes an instance whole: the checks the engine runs on what an instance hands it,
 * before it is trusted to settle anything. Each returns problems as sentences; [] is whole.
 */
import { QUADRANTS } from './types.ts';
import type { Instance, Settings, Span } from './types.ts';

const SPAN_UNITS: readonly Span['unit'][] = ['day', 'week', 'month'];
const isWhole = (n: unknown, min: number): n is number => Number.isInteger(n) && (n as number) >= min;
const isSpan = (s: unknown): s is Span =>
  typeof s === 'object' && s !== null && SPAN_UNITS.includes((s as Span).unit) && isWhole((s as Span).count, 1);
/** Five fields of digits, `*`, ranges, lists and steps: what pg_cron and every other cron read. */
const CRON = /^(\S+\s+){4}\S+$/;
const CRON_FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/;

/** Every setting the engine reads, each with what it must be. */
const SETTINGS: { readonly [K in keyof Settings]-?: (v: unknown) => string | null } = {
  walletCap: (v) => (isWhole(v, 1) ? null : 'a whole number of hundredths, at least 1'),
  vote: (v) => (isWhole(v, 1) ? null : 'a whole number of hundredths, at least 1'),
  halving: (v) => (typeof v === 'number' && v > 0 && v <= 1 ? null : 'a fraction above 0 and at most 1'),
  reactionCap: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  charactersPerPlayer: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  settlementCron: (v) =>
    typeof v === 'string' && CRON.test(v.trim()) && v.trim().split(/\s+/).every((f) => CRON_FIELD.test(f))
      ? null
      : 'a five-field cron expression',
  seasonLength: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count of at least 1'),
  turnCooldown: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count of at least 1'),
  registrationMode: (v) => (v === 'invite' || v === 'open' ? null : '"invite" or "open"'),
};

export function settingsProblems(settings: Settings): string[] {
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

/** The settings with some replaced: a new, frozen object; the defaults are never edited. */
export function withOverrides(settings: Settings, overrides: Partial<Settings>): Settings {
  return Object.freeze({ ...settings, ...overrides });
}
