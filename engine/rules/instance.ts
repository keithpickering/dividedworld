/**
 * What makes an instance whole: the checks the engine runs on what an instance hands it,
 * before it is trusted to settle anything. Each returns problems as sentences; [] is whole.
 */
import { ALIGNMENTS, QUADRANTS } from './types.ts';
import { groupsProblems } from './groups.ts';
import { ALERT_KINDS } from './alerts.ts';
import type { DeveloperPersona, EconomyRead, Instance, Persona, Settings, QuizQuestion, Span, SystemContent } from './types.ts';
import { DIGEST_MOST } from '../system/digest.ts';
import { BEAT_KEY, conditionProblem, dueProblem } from '../system/conditions.ts';
import { MOVE_KINDS } from '../system/moves.ts';
import { DUTIES } from '../system/duties.ts';
import { PHASES, PHASE_CAPS, PHASE_KEYS } from '../system/phases.ts';
import { POSTING_OFFICES, TRIGGERS as POOL_TRIGGERS } from '../system/pool.ts';
import { PRONOUN_FORMS, STAFF_TOKENS, STOCK_LINE_KEYS, STOCK_LINE_TOKENS } from '../system/stock.ts';
import { pronounProblems } from './pronouns.ts';
import { BEYOND_POST, GIMMICK_KINDS, INT4_MAX, PLAYS, RARITIES, REACHES, TRIGGERS, atOrBelow, spanMs } from './cards.ts';
import type { CardRules } from './cards.ts';
import type { Pull, SlotSeed } from './packs.ts';
import type { EventLine } from './cosmetics.ts';

/**
 * What a Mod Bot's bribe may cost, in hundredths of an orb, for every bot in every instance: dear enough to be a
 * choice, cheap enough that a character can pay it from a wallet.
 */
export const BRIBE_BOUNDS = { least: 25, most: 500 } as const;

const SPAN_UNITS: readonly Span['unit'][] = ['day', 'week', 'month'];
/** A card's time up may count hours: a use card for a day and a half. No setting does. */
const LASTS_UNITS: readonly Span['unit'][] = ['hour', ...SPAN_UNITS];
/** A grace may be minutes long (editGrace), and so may presence's window; nothing else is. */
const GRACE_UNITS: readonly Span['unit'][] = ['minute', ...SPAN_UNITS];
/** The most of a unit a span counts, as settings_spans_hold (0007) holds it: past any instance's life, inside span_interval's integer. */
export const SPAN_MOST = 1000;
const isWhole = (n: unknown, min: number): n is number => Number.isSafeInteger(n) && (n as number) >= min;
const isSpan = (s: unknown, units: readonly Span['unit'][] = SPAN_UNITS): s is Span =>
  typeof s === 'object' && s !== null && units.includes((s as Span).unit) && isWhole((s as Span).count, 1) && (s as Span).count <= SPAN_MOST;
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

/** An object of named numbers: the economy's shape, and a card's screen settings'. */
function namedNumbers(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'an object of named numbers';
  const bad = Object.entries(v).filter(([, n]) => typeof n !== 'number' || !Number.isFinite(n)).map(([k]) => k);
  return bad.length ? `an object of named numbers, and ${bad.map((k) => `"${k}"`).join(', ')} is not a number` : null;
}

/**
 * The hints setting (engine/rules/hints.ts): a least of whole reactions, a share above one half (so no two quadrants can both
 * lead), a split of at most one half (both sides cannot each hold more than half), and a window that may count minutes.
 */
function hintsRule(v: unknown): string | null {
  const shape = 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
  const h = v as Record<string, unknown>;
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  return isWhole(h.least, 1) && num(h.share) && h.share > 0.5 && h.share <= 1 && num(h.split) && h.split > 0 && h.split <= 0.5 && isSpan(h.window, GRACE_UNITS) ? null : shape;
}

/** The toast defaults: a list of alert kinds, each named once (none at all is a choice: nothing toasts until a player says so). */
function toastDefaultsRule(v: unknown): string | null {
  const shape = `a list of the kinds of alert that toast (${ALERT_KINDS.join(', ')}), each named once`;
  if (!Array.isArray(v)) return shape;
  const unknown = v.filter((k) => !(ALERT_KINDS as readonly unknown[]).includes(k));
  if (unknown.length) return `${shape}; ${unknown.map((k) => JSON.stringify(k)).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not one`;
  return new Set(v).size === v.length ? null : `${shape}; one is named twice`;
}

/** The phases setting: each phase holds its numbers as whole numbers, at least 1. */
function phasesRule(v: unknown): string | null {
  const shape = 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
  const given = v as Record<string, Record<string, unknown> | undefined>;
  for (const p of PHASES) {
    const phase = given[p];
    if (typeof phase !== 'object' || phase === null || Array.isArray(phase)) return `${shape}; "${p}" is missing`;
    for (const key of PHASE_KEYS[p]) if (!isWhole(phase[key], 1)) return `${shape}; "${p}.${key}" is not`;
    const extra = Object.keys(phase).filter((k) => !(PHASE_KEYS[p] as readonly string[]).includes(k));
    if (extra.length) return `${shape}; "${p}.${extra[0]}" is not a number a phase holds`;
  }
  return null;
}
const whole = (min: number, what: string, most?: number) => (v: unknown): string | null => (isWhole(v, min) && (most === undefined || v <= most) ? null : `a whole number of ${what}, at least ${min}${most === undefined ? '' : ` and at most ${most}`}`);

/** A setting that gives each reach beyond a post (character, thread, board) one value, and nothing else. */
function perReach(holds: (v: unknown) => boolean, shape: string) {
  return (v: unknown): string | null => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
    const given = v as Record<string, unknown>;
    const keys = Object.keys(given);
    return keys.length === BEYOND_POST.length && BEYOND_POST.every((r) => r in given && holds(given[r])) ? null : shape;
  };
}

/**
 * The pool's settings (`Settings.pool`): exactly the fields of PoolSettings, each held as its own words say. Mirrors `setting_pool` in
 * supabase/migrations/0077_settings_held.sql, and supabase/tests/0079-settings-held.sql lists its poisons and goods.
 */
const POOL_WHOLE = { weekly: 1, threadsWeekly: 0, priorityDays: 1, notesRead: 1, chatterThreadPosts: 1 } as const;
const POOL_KEYS = [...Object.keys(POOL_WHOLE), 'holdback', 'cardRarityMost', 'strengths', 'chatterCron'].sort();
function poolRule(v: unknown): string | null {
  const shape = 'an object giving weekly, priorityDays, notesRead and chatterThreadPosts (whole numbers, at least 1), threadsWeekly (a whole number, at least 0), holdback (from 0 to 0.5), cardRarityMost (common, uncommon, rare or legendary), strengths (a whole number, at least 1, for each of ' + POOL_TRIGGERS.join(', ') + ') and chatterCron (a five-field cron expression, each field inside its range)';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
  const given = v as Record<string, unknown>;
  const extra = Object.keys(given).find((k) => !POOL_KEYS.includes(k));
  if (extra !== undefined) return `${shape}; "${extra}" is not one of its fields`;
  for (const [k, least] of Object.entries(POOL_WHOLE)) if (!isWhole(given[k], least)) return `${shape}; "${k}" is not`;
  if (!(typeof given.holdback === 'number' && given.holdback >= 0 && given.holdback <= 0.5)) return `${shape}; "holdback" is not`;
  if (!RARITIES.includes(given.cardRarityMost as never)) return `${shape}; "cardRarityMost" is not`;
  if (!isCron(given.chatterCron)) return `${shape}; "chatterCron" is not`;
  const strengths = given.strengths;
  if (typeof strengths !== 'object' || strengths === null || Array.isArray(strengths)) return `${shape}; "strengths" is not`;
  const s = strengths as Record<string, unknown>;
  const stray = Object.keys(s).find((k) => !(POOL_TRIGGERS as readonly string[]).includes(k));
  if (stray !== undefined) return `${shape}; "strengths.${stray}" is not a trigger`;
  for (const t of POOL_TRIGGERS) if (!isWhole(s[t], 1)) return `${shape}; "strengths.${t}" is not`;
  return null;
}

/**
 * The Mod Bots' settings (`Settings.modBots`): exactly the fields of ModBotSettings, each held as its own words say. Mirrors `setting_modbots`
 * in supabase/migrations/0103_orders.sql, and supabase/tests/0079-settings-held.sql lists its poisons and goods.
 */
const MOD_BOTS_WHOLE = { allowanceMost: 1, ruleDaysMost: 1, patrolsPerDay: 0, reportPrice: 0, reportsPerDay: 1, judgmentsPerDay: 1, filingLinesPerDay: 1, appealPrice: 0, tailHours: 1, filingGraceMinutes: 1 } as const;
/** The most a patrol's judgment reads: a bounded read. */
export const PATROL_SAMPLE_MOST = 25;
const MOD_BOTS_KEYS = [...Object.keys(MOD_BOTS_WHOLE), 'patrolSample', 'visitHours', 'cap', 'filingCron'].sort();
function modBotsRule(v: unknown): string | null {
  const shape = `an object giving allowanceMost, ruleDaysMost, reportsPerDay, judgmentsPerDay, filingLinesPerDay, tailHours and filingGraceMinutes (whole numbers, at least 1), patrolsPerDay, reportPrice and appealPrice (whole numbers, at least 0), patrolSample (a whole number from 1 to ${PATROL_SAMPLE_MOST}), visitHours (least and most, whole hours, at least 1, most not below least), cap (punishments and days, whole numbers, at least 1) and filingCron (a five-field cron expression, each field inside its range)`;
  const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!object(v)) return shape;
  const extra = Object.keys(v).find((k) => !MOD_BOTS_KEYS.includes(k));
  if (extra !== undefined) return `${shape}; "${extra}" is not one of its fields`;
  for (const [k, least] of Object.entries(MOD_BOTS_WHOLE)) if (!isWhole(v[k], least)) return `${shape}; "${k}" is not`;
  if (!isWhole(v.patrolSample, 1) || (v.patrolSample as number) > PATROL_SAMPLE_MOST) return `${shape}; "patrolSample" is not`;
  const pair = (name: 'visitHours' | 'cap', a: string, b: string): string | null => {
    const o = v[name];
    if (!object(o) || Object.keys(o).length !== 2 || !isWhole(o[a], 1) || !isWhole(o[b], 1)) return `${shape}; "${name}" is not`;
    return null;
  };
  const hours = pair('visitHours', 'least', 'most');
  if (hours) return hours;
  const vh = v.visitHours as { least: number; most: number };
  if (vh.most < vh.least) return `${shape}; "visitHours" is not`;
  const cap = pair('cap', 'punishments', 'days');
  if (cap) return cap;
  if (!isCron(v.filingCron)) return `${shape}; "filingCron" is not`;
  return null;
}

/**
 * The warn bar's settings (`Settings.warnBar`): a bar of whole points, three bands each from 1 to the bar's size, a decay span (minutes allowed, so
 * a test can set it short) and a ladder of ban days. Mirrors `setting_warnbar` in supabase/migrations/0104_warn_bar.sql, and
 * supabase/tests/0079-settings-held.sql lists its poisons and goods.
 */
const WARN_BAR_BANDS = ['minor', 'moderate', 'severe'] as const;
function warnBarRule(v: unknown): string | null {
  const shape = 'an object giving size (a whole number, at least 1), bands (minor, moderate and severe, whole numbers from 1 to size), decay (a span: a unit of minute, day, week or month and a whole count from 1 to 1000) and banDays (a list of one or more whole numbers of days, each at least 1)';
  const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!object(v)) return shape;
  const extra = Object.keys(v).find((k) => !['size', 'bands', 'decay', 'banDays'].includes(k));
  if (extra !== undefined) return `${shape}; "${extra}" is not one of its fields`;
  if (!isWhole(v.size, 1)) return `${shape}; "size" is not`;
  const bands = v.bands;
  if (!object(bands) || Object.keys(bands).length !== WARN_BAR_BANDS.length) return `${shape}; "bands" is not`;
  for (const b of WARN_BAR_BANDS) if (!isWhole(bands[b], 1) || (bands[b] as number) > v.size) return `${shape}; "bands.${b}" is not`;
  if (!isSpan(v.decay, GRACE_UNITS)) return `${shape}; "decay" is not`;
  if (!Array.isArray(v.banDays) || v.banDays.length < 1 || !v.banDays.every((d) => isWhole(d, 1))) return `${shape}; "banDays" is not`;
  return null;
}

/**
 * The member groups' settings (`Settings.apology`): exactly the fields of ApologySettings, each a whole number, at least 1. Mirrors `setting_apology` in
 * supabase/migrations/0130_bars_apologies.sql, and supabase/tests/0079-settings-held.sql lists its poisons and goods.
 */
const APOLOGY_KEYS = ['apologyEveryHours', 'apologyJudgeBatch', 'apologyRulingMaxWords'] as const;
function apologyRule(v: unknown): string | null {
  const shape = 'an object giving apologyEveryHours (the hours between a character\'s apologies to one move), apologyJudgeBatch (the most apologies one run of the judge hears) and apologyRulingMaxWords (the most words of a ruling), each a whole number, at least 1';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
  const extra = Object.keys(v).find((k) => !(APOLOGY_KEYS as readonly string[]).includes(k));
  if (extra !== undefined) return `${shape}; "${extra}" is not one of its fields`;
  for (const k of APOLOGY_KEYS) if (!isWhole((v as Record<string, unknown>)[k], 1)) return `${shape}; "${k}" is not`;
  return null;
}

/** The code of conduct's numbers (`Settings.conduct`): the most open reports an account holds, and the admin address replies go to (null until the owner sets it). */
const CONDUCT_KEYS = ['openReportsMost', 'adminAddress'] as const;
function conductRule(v: unknown): string | null {
  const shape = 'an object giving openReportsMost (the most reports to admins one account holds open, a whole number, at least 1) and adminAddress (null, or an email address containing "@")';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
  const extra = Object.keys(v).find((k) => !(CONDUCT_KEYS as readonly string[]).includes(k));
  if (extra !== undefined) return `${shape}; "${extra}" is not one of its fields`;
  const o = v as Record<string, unknown>;
  if (!isWhole(o['openReportsMost'], 1)) return `${shape}; "openReportsMost" is not`;
  const a = o['adminAddress'];
  if (a !== null && !(typeof a === 'string' && a.includes('@'))) return `${shape}; "adminAddress" is not`;
  return null;
}

/**
 * The cosmetics' settings (`Settings.cosmetics`): exactly the fields of CosmeticsSettings, each held as its own words say. Every
 * weight is a positive whole number, and only an event's `none` may be 0.
 */
const COSMETICS_OUTCOMES = ['line', 'gear', 'card'] as const;
function cosmeticsRule(v: unknown): string | null {
  const shape = 'an object giving gear (wornMost, a whole number, at least 1; reach, a fraction of the portrait\'s width from 0 to 2), trophies (shownMost, a whole number, at least 1) and events (windowMinutes, a whole number from 1 to 1440; dayMost, a whole number, at least 1; outcomes, a positive whole weight for line, gear and card and an optional whole weight, at least 0, for none; gearRarity and cardRarity, each a positive whole weight for one or more of ' + RARITIES.join(', ') + ')';
  const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const exactly = (x: unknown, keys: readonly string[], name: string): string | null => {
    if (!object(x)) return name === 'cosmetics' ? shape : `"${name}" must be an object giving ${keys.join(', ')}`;
    const extra = Object.keys(x).find((k) => !keys.includes(k));
    return extra === undefined ? null : `"${name}.${extra}" is not one of ${name}'s fields (${keys.join(', ')})`;
  };
  const weights = (x: unknown, keys: readonly string[], name: string, zeroOk: readonly string[] = []): string | null => {
    const bad = exactly(x, keys, name);
    if (bad) return bad;
    const o = x as Record<string, unknown>;
    if (!Object.keys(o).length) return `"${name}" must give at least one weight`;
    for (const [k, w] of Object.entries(o)) if (!isWhole(w, zeroOk.includes(k) ? 0 : 1)) return `"${name}.${k}" has a weight of ${JSON.stringify(w)}, and a weight is a positive whole number`;
    return null;
  };
  const top = exactly(v, ['gear', 'trophies', 'events'], 'cosmetics');
  if (top) return top;
  const c = v as Record<string, unknown>;
  const gear = exactly(c.gear, ['wornMost', 'reach'], 'gear');
  if (gear) return gear;
  const g = c.gear as Record<string, unknown>;
  if (!isWhole(g.wornMost, 1)) return `"gear.wornMost" must be a whole number, at least 1`;
  if (!(typeof g.reach === 'number' && g.reach >= 0 && g.reach <= 2)) return `"gear.reach" must be a number from 0 to 2`;
  const trophies = exactly(c.trophies, ['shownMost'], 'trophies');
  if (trophies) return trophies;
  if (!isWhole((c.trophies as Record<string, unknown>).shownMost, 1)) return `"trophies.shownMost" must be a whole number, at least 1`;
  const events = exactly(c.events, ['windowMinutes', 'dayMost', 'outcomes', 'gearRarity', 'cardRarity'], 'events');
  if (events) return events;
  const e = c.events as Record<string, unknown>;
  if (!isWhole(e.windowMinutes, 1) || e.windowMinutes > 1440) return `"events.windowMinutes" must be a whole number from 1 to 1440`;
  if (!isWhole(e.dayMost, 1)) return `"events.dayMost" must be a whole number, at least 1`;
  const outcomes = weights(e.outcomes, [...COSMETICS_OUTCOMES, 'none'], 'events.outcomes', ['none']);
  if (outcomes) return outcomes;
  const o = e.outcomes as Record<string, unknown>;
  for (const k of COSMETICS_OUTCOMES) if (!(k in o)) return `"events.outcomes.${k}" is missing; it must be a positive whole weight`;
  return weights(e.gearRarity, RARITIES, 'events.gearRarity') ?? weights(e.cardRarity, RARITIES, 'events.cardRarity');
}

/** Every setting the engine reads, each with what it must be. */
const SETTINGS: { readonly [K in keyof Settings]-?: (v: unknown) => string | null } = {
  walletCap: (v) => (isWhole(v, 1) ? null : 'a whole number of hundredths, at least 1'),
  vote: (v) => (isWhole(v, 1) ? null : 'a whole number of hundredths, at least 1'),
  halving: (v) => (typeof v === 'number' && v > 0 && v <= 1 ? null : 'a fraction above 0 and at most 1'),
  reactionCap: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  charactersPerPlayer: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  settlementCron: (v) => (isCron(v) ? null : 'a five-field cron expression, each field inside its range'),
  viewCountCron: (v) => (isCron(v) ? null : 'a five-field cron expression, each field inside its range'),
  settlementLength: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count from 1 to 1000'),
  seasonLength: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count from 1 to 1000'),
  turnCooldown: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count from 1 to 1000'),
  registrationMode: (v) => (v === 'open' || v === 'invite' || v === 'closed' ? null : '"open", "invite" or "closed"'),
  invitesPerPlayer: (v) => (isWhole(v, 1) ? null : 'a whole number, at least 1'),
  inviteLifetime: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count from 1 to 1000'),
  editGrace: (v) => (isSpan(v, GRACE_UNITS) ? null : 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000'),
  postMaxLength: (v) => (isWhole(v, 1) ? null : 'a whole number of characters, at least 1'),
  titleMaxLength: (v) => (isWhole(v, 1) ? null : 'a whole number of characters, at least 1'),
  postsPerPage: (v) => (isWhole(v, 1) ? null : 'a whole number of posts, at least 1'),
  hotReplies: (v) => (isWhole(v, 1) ? null : 'a whole number of replies, at least 1'),
  // A name only: whether the database holds a configuration of that name is the settings trigger's check (supabase/migrations/0117_search.sql), which has the same words.
  searchLanguage: (v) => (typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v) ? null : 'the name of a text search configuration this database holds (english or simple, for example)'),
  searchRankPool: (v) => (isWhole(v, 100) && (v as number) <= 100_000 ? null : 'a whole number of matches from 100 to 100,000'),
  presenceWindow: (v) => (isSpan(v, GRACE_UNITS) ? null : 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000'),
  presenceNames: (v) => (isWhole(v, 1) ? null : 'a whole number of names, at least 1'),
  // At least 10, so no instance is polled into load; at most 300, so the window still means something.
  presencePollSeconds: (v) => (isWhole(v, 10) && (v as number) <= 300 ? null : 'a whole number of seconds from 10 to 300'),
  setLasts: (v) => (isSpan(v) ? null : 'a span: a unit of day, week or month and a whole count from 1 to 1000'),
  reachRarity: perReach((r) => RARITIES.includes(r as never), 'an object giving character, thread and board each a rarity (common, uncommon, rare or legendary)'),
  reachLasts: perReach((r) => isSpan(r), 'an object giving character, thread and board each a span: a unit of day, week or month and a whole count from 1 to 1000'),
  economy: namedNumbers,
  cardSettings: namedNumbers,
  systemEnabled: (v) => (typeof v === 'boolean' ? null : 'true or false'),
  oldVoice: (v) => (typeof v === 'boolean' ? null : 'true or false'),
  cardWriteSettleSeconds: whole(0, 'seconds', 600),
  oldVoiceWindow: (v) => (isWhole(v, 64) && v <= 1_000_000 ? null : 'a whole number of tokens from 64 to 1,000,000'),
  oldVoiceTokenizer: (v) => (v === 'gpt2' || v === 'bytes' ? null : '"gpt2" or "bytes"'),
  oldVoicePromptFloor: whole(1, 'tokens'),
  cardWriteFullShare: (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? null : 'a number from 0 to 1'),
  cardWriteTopUps: (v) => (isWhole(v, 0) && v <= 5 ? null : 'a whole number from 0 to 5'),
  pronouns: (v) => { const p = pronounProblems(v); return p.length ? p.join('; ') : null; },
  meetingCron: (v) => (isCron(v) ? null : 'a five-field cron expression, each field inside its range'),
  phases: phasesRule,
  hints: hintsRule,
  toastDefaults: toastDefaultsRule,
  inheritanceGraceDays: whole(0, 'days'),
  rosterRecentExcluded: whole(0, 'Bosses'),
  structuralHoldHours: whole(1, 'hours'),
  microEventDailyCalls: whole(0, 'calls'),
  digestThreads: whole(1, 'threads', DIGEST_MOST.threads),
  digestBoards: whole(1, 'boards', DIGEST_MOST.boards),
  digestBoardDays: whole(1, 'days', DIGEST_MOST.boardDays),
  /** A year at most: a stub is a pointer for a while, not a second index of where threads went. SQL's settings_held holds the same. */
  movedStubDays: whole(1, 'days', 365),
  /** A month at most (720 hours): the window before a season's end in which the Boss writes its farewell and its handoff. SQL's settings_held holds the same. */
  farewellWindowHours: whole(1, 'hours', 720),
  /** A bundle holds one to sixteen parts, as SQL's settings_held holds: a composed bundle is bounded by a setting, never by what a model proposes. */
  bundleMostParts: whole(1, 'parts', 16),
  bundleAuthoredMostParts: whole(1, 'parts', 16),
  digestExcerpts: whole(1, 'posts', DIGEST_MOST.excerpts),
  digestExcerptChars: whole(1, 'characters', DIGEST_MOST.excerptChars),
  memoryOpinions: whole(1, 'opinions'),
  memoryGrudges: whole(1, 'grudges'),
  memoryWheelhouse: whole(1, 'subjects'),
  memoryRealWorld: whole(1, 'subjects'),
  pool: poolRule,
  modBots: modBotsRule,
  warnBar: warnBarRule,
  apology: apologyRule,
  conduct: conductRule,
  boardNameMaxLength: whole(1, 'characters'),
  moveExpiryMostDays: whole(1, 'days'),
  moveExpiryLeastHours: whole(1, 'hours'),
  demandCheckMinutes: whole(1, 'minutes', 1440),
  demandChecksPerTick: whole(1, 'moves', 1000),
  modelTiers: (v) => {
    const shape = 'an object naming a model id for "strong" and for "light"';
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return shape;
    const t = v as Record<string, unknown>;
    return ['strong', 'light'].every((k) => typeof t[k] === 'string' && (t[k] as string).trim() !== '') ? null : shape;
  },
  cosmetics: cosmeticsRule,
};

export function settingsProblems(settings: Settings): string[] {
  if (typeof settings !== 'object' || settings === null) return ['the settings are missing'];
  const out: string[] = [];
  for (const [key, rule] of Object.entries(SETTINGS) as [keyof Settings, (v: unknown) => string | null][]) {
    if (!(key in settings) || settings[key] === undefined) { out.push(`setting "${key}" is missing`); continue; }
    const why = rule(settings[key]);
    if (why) out.push(`setting "${key}" is ${JSON.stringify(settings[key])}; it must be ${why}`);
  }
  // No sentence relates the window to the floor: SQL's settings_held checks each row alone, and writeTokensMost computes the most from the pair, never
  // below 1, so no pair of valid rows stops the instance (design section 4; the owner's answer on #582).
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

/** The most a developer's name or tagline may be: a character's name, and what a profile's title holds (0043, 0062). */
export const DEVELOPER_NAME_MAX = 40;
export const DEVELOPER_TAGLINE_MAX = 40;

/** The staff key the developer persona is seeded under (supabase/migrations/0062_updates.sql): reserved, so no Boss or Mod Bot has it. */
export const DEVELOPER_STAFF_KEY = 'developer';

/** The developer persona an instance gets when it names none: plain, as the engine is. */
export const DEFAULT_DEVELOPER: DeveloperPersona = Object.freeze({ name: 'The developers', tagline: '' });

/** Problems with `instance.developer`, each a sentence naming what is wrong; none when it is left out. */
function developerProblems(d: Instance['developer']): string[] {
  if (d === undefined) return [];
  const out: string[] = [];
  if (typeof d.name !== 'string' || d.name.trim() === '') out.push('the developer has no name');
  else {
    if (d.name !== d.name.trim()) out.push('the developer name has a space at its start or end; a character\'s name has none');
    if (d.name.length > DEVELOPER_NAME_MAX) out.push(`the developer name is ${d.name.length} characters; a character\'s name is at most ${DEVELOPER_NAME_MAX}`);
  }
  if (typeof d.tagline !== 'string') out.push('the developer tagline is not text');
  else if (d.tagline.length > DEVELOPER_TAGLINE_MAX) out.push(`the developer tagline is ${d.tagline.length} characters; the seed keeps at most ${DEVELOPER_TAGLINE_MAX} and cuts the rest in silence`);
  if (d.pronouns !== undefined) for (const p of pronounProblems(d.pronouns)) out.push(`the developer's pronouns: ${p}`);
  if (d.avatar !== undefined && (typeof d.avatar !== 'string' || d.avatar.trim() === '')) out.push('the developer avatar is blank; leave it out for none, or name the instance\'s picture');
  return out;
}

/** Problems with the packs and the machine's slots, each a sentence naming what is wrong. */
function packProblems(instance: Instance): string[] {
  const out: string[] = [];
  const packs = Array.isArray(instance.packs) ? instance.packs : (out.push('the instance has no packs list'), []);
  const machine = Array.isArray(instance.machine) ? instance.machine : (out.push('the instance has no machine list'), []);
  for (const k of duplicates(packs, (p) => p.key)) out.push(`pack key "${k}" is used twice`);
  for (const pack of packs) {
    if (!Array.isArray(pack.pulls) || !pack.pulls.length) { out.push(`pack "${pack.key}" has no pulls`); continue; }
    for (const k of pack.leaves ?? []) if (!instance.cards.some((c) => c.key === k)) out.push(`pack "${pack.key}" leaves out "${k}", and the instance has no such card`);
    (pack.pulls as readonly Pull[]).forEach((pull, i) => {
      const where = `pack "${pack.key}", pull ${i + 1}`;
      const weights = Object.entries(pull.weights ?? {});
      if (!weights.length) out.push(`${where} has no weights`);
      for (const [rarity, w] of weights) {
        if (!isWhole(w, 1)) out.push(`${where} has a weight of ${JSON.stringify(w)} for ${rarity}; a weight is a positive whole number`);
        const eligible = instance.cards.some((c) => c.rarity === rarity && !(pack.leaves ?? []).includes(c.key));
        if (!eligible) out.push(`${where} names ${rarity}, and the pack has no eligible card of that rarity`);
      }
    });
  }
  const names = (s: SlotSeed) => ('card' in s.item ? `card "${s.item.card}"` : `pack "${s.item.pack}"`);
  for (const slot of machine) {
    const who = `the slot for ${names(slot)}`;
    if ('card' in slot.item) { if (!instance.cards.some((c) => c.key === (slot.item as { card: string }).card)) out.push(`${who} names a card, and the instance has no such card`); }
    else if (!packs.some((p) => p.key === (slot.item as { pack: string }).pack)) out.push(`${who} names a pack, and the instance has no such pack`);
    if (!isWhole(slot.price, 1) || slot.price > INT4_MAX) out.push(`${who} has a price of ${JSON.stringify(slot.price)}; a price is a whole number of hundredths from 1 to ${INT4_MAX}`);
    if (!['onSale', 'soldOut', 'hidden'].includes(slot.availability)) out.push(`${who} has the availability ${JSON.stringify(slot.availability)}; it is onSale, soldOut or hidden`);
  }
  for (const k of duplicates(machine, names)) out.push(`two slots sell ${k}`);
  return out;
}

/** Problems with the gear, the trophy catalog, the event lines and the odds that draw from them, each a sentence naming what is wrong. */
function cosmeticsProblems(instance: Instance): string[] {
  const out: string[] = [];
  const gear = Array.isArray(instance.gear) ? instance.gear : (out.push('the instance has no gear list'), []);
  const catalog = instance.trophies;
  const lines: readonly EventLine[] = Array.isArray(instance.events?.lines) ? instance.events.lines : (out.push('the instance has no event lines list'), []);
  for (const k of duplicates(gear, (g) => g.key)) out.push(`gear key "${k}" is used twice`);
  for (const g of gear) {
    if (instance.cards.some((c) => c.key === g.key)) out.push(`gear key "${g.key}" is also a card's key; the log's lines name both`);
    if (!RARITIES.includes(g.rarity)) out.push(`gear "${g.key}" has the rarity ${JSON.stringify(g.rarity)}; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
  }
  if (typeof catalog !== 'object' || catalog === null || !Array.isArray(catalog.kinds)) out.push('the instance has no trophy catalog');
  else {
    for (const k of duplicates(catalog.kinds, (t) => t.key)) out.push(`trophy key "${k}" is used twice`);
    // What trophy_kinds holds (supabase/migrations/0206_trophies.sql): a key of lower-case words, never the admin page's `made-` prefix, a short name, short words.
    for (const t of catalog.kinds) {
      if (typeof t.key === 'string' && t.key.startsWith('made-')) out.push(`trophy key "${t.key}" begins "made-", which is the admin page's`);
      else if (typeof t.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(t.key)) out.push(`trophy key "${String(t.key)}" is not lower-case words (letters, digits and hyphens, beginning with a letter)`);
      if (typeof t.name !== 'string' || t.name.length < 1 || t.name.length > 60) out.push(`trophy "${t.key}" has a name of ${typeof t.name === 'string' ? t.name.length : 0} characters; a name is 1 to 60`);
      if (t.line !== undefined && t.line.length > 200) out.push(`trophy "${t.key}" has words of ${t.line.length} characters; at most 200`);
    }
    const kind = (key: string) => catalog.kinds.find((t) => t.key === key);
    const named = (who: string, key: string) => (kind(key) ? true : (out.push(`${who} "${key}", and the instance has no such kind`), false));
    (Array.isArray(catalog.seasonPlaces) ? catalog.seasonPlaces : []).forEach((key, i) => {
      if (named(`season place ${i + 1} names the trophy`, key) && kind(key)!.belt) out.push(`season place ${i + 1} is the belt "${key}"; a belt has one holder, and a place is given to each who earns it`);
    });
    if (!Array.isArray(catalog.seasonPlaces) || catalog.seasonPlaces.length !== 3) out.push('the trophy catalog names three season places: first, second and third');
    for (const key of catalog.boss ?? []) named('the Boss\'s trophies name', key);
    if (named('the trophy for a met demand names', catalog.demandMet) && kind(catalog.demandMet)!.belt) out.push(`the trophy for a met demand is the belt "${catalog.demandMet}"; every counted character gets it, and a belt has one holder`);
  }
  for (const k of duplicates(lines, (l) => l.key)) out.push(`event line key "${k}" is used twice`);
  for (const l of lines) {
    if (typeof l.text !== 'string' || l.text.trim() === '') out.push(`event line "${l.key}" has no text`);
    else if ((l.outcome === 'gear' || l.outcome === 'card') && !l.text.includes('{item}')) out.push(`event line "${l.key}" is a ${l.outcome} line and does not say {item}, the found item's name`);
    if (!(COSMETICS_OUTCOMES as readonly string[]).includes(l.outcome)) out.push(`event line "${l.key}" has the outcome ${JSON.stringify(l.outcome)}; an outcome is line, gear or card`);
  }
  // Settings are checked on their own; the odds read here only once they hold.
  const events = instance.settings?.cosmetics?.events;
  if (cosmeticsRule(instance.settings?.cosmetics) === null && events) {
    for (const o of COSMETICS_OUTCOMES) if (!lines.some((l) => l.outcome === o)) out.push(`the events' outcome "${o}" has no event line, and a Random Event that picks it would have nothing to say`);
    for (const rarity of Object.keys(events.gearRarity)) if (!gear.some((g) => g.rarity === rarity)) out.push(`events.gearRarity names ${rarity}, and the instance has no gear of that rarity`);
    for (const rarity of Object.keys(events.cardRarity)) if (!instance.cards.some((c) => c.rarity === rarity)) out.push(`events.cardRarity names ${rarity}, and the instance has no card of that rarity`);
  }
  return out;
}
export function instanceProblems(instance: Instance): string[] {
  const out: string[] = [];
  const lists = ['classes', 'cards', 'reactions', 'boards', 'ranks', 'pipStyles'] as const;
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
  for (const c of instance.cards) {
    if (c.stack !== undefined && !isWhole(c.stack, 1)) out.push(`card "${c.key}" stacks ${JSON.stringify(c.stack)}; a stack is a whole number, at least 1`);
    out.push(...surfaceProblems(c));
    out.push(...playProblems(c, new Set(instance.reactions.map((r) => r.key))), ...reachProblems(c, instance.settings), ...drawProblems(c), ...driveProblems(c, instance.settings), ...needsMessageProblems(c));
  }
  if (!instance.boards.length) out.push('the instance has no board');
  for (const s of duplicates(instance.boards, (b) => b.slug)) out.push(`board slug "${s}" is used twice`);
  const systems = instance.boards.filter((b) => b.system === true);
  if (!systems.length) out.push('no board is The System\'s: exactly one board sets system: true, where The System posts');
  if (systems.length > 1) out.push(`${systems.length} boards are The System's (${systems.map((b) => b.slug).join(', ')}); exactly one is`);
  if (instance.boards.length && systems.length === instance.boards.length) out.push('the instance has no board for players: every board is The System\'s');
  out.push(...developerProblems(instance.developer), ...packProblems(instance), ...cosmeticsProblems(instance));
  out.push(...groupsProblems(instance.groups));
  if (!instance.ranks.length) out.push('the instance has no rank');
  instance.ranks.forEach((r, i) => {
    if (typeof r.name !== 'string' || r.name.trim() === '') out.push('a rank has no name');
    if (!Number.isSafeInteger(r.from)) out.push(`rank "${r.name}" is from ${r.from}; a rank is from a whole number of hundredths`);
    else if (i === 0 && r.from !== 0) out.push(`the first rank is from 0, not ${r.from}`);
    else if (i > 0 && !(r.from > instance.ranks[i - 1]!.from)) out.push(`rank "${r.name}" is from ${r.from}, not above the rank before it`);
  });
  for (const k of duplicates(instance.pipStyles, (p) => p.key)) out.push(`pip style "${k}" is used twice`);
  if (!instance.pipStyles.some((p) => p.key === 'default')) out.push('there is no pip style "default", every character\'s until its player picks another');
  for (const p of instance.pipStyles) {
    if (typeof p.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.key)) out.push(`pip style key "${p.key}" is not lowercase words joined by hyphens`);
    for (const part of ['name', 'full', 'empty'] as const) if (typeof p[part] !== 'string' || p[part].trim() === '') out.push(`pip style "${p.key}" has no ${part}`);
  }
  const title = instance.copy?.announcementsThreadTitle;
  if (typeof title !== 'string' || title.trim() === '') out.push('the instance has no copy for announcementsThreadTitle');
  else if (!title.includes('{season}')) out.push('the copy for announcementsThreadTitle does not say which season ({season})');
  const settingsSay = settingsProblems(instance.settings);
  out.push(...settingsSay);
  // Every economy number a class or card reads is one the settings hold.
  const economy = instance.settings?.economy;
  if (economy && typeof economy === 'object' && !Array.isArray(economy)) {
    const check = (who: string, read: EconomyRead) => {
      const { key, whole = false, min = undefined, max = undefined } = typeof read === 'string' ? { key: read } : read;
      const n = economy[key];
      if (typeof n !== 'number' || !Number.isFinite(n)) return `${who} reads economy "${key}", which the settings do not hold`;
      if (whole && !Number.isSafeInteger(n)) return `${who} reads economy "${key}" as ${n}; it must be a whole number`;
      if (min !== undefined && n < min) return `${who} reads economy "${key}" as ${n}; it must be at least ${min}`;
      if (max !== undefined && n > max) return `${who} reads economy "${key}" as ${n}; it must be at most ${max}`;
      return null;
    };
    for (const c of instance.classes) for (const r of c.reads ?? []) { const why = check(`class "${c.key}"`, r); if (why) out.push(why); }
    for (const c of instance.cards) {
      for (const r of c.reads ?? []) { const why = check(`card "${c.key}"`, r); if (why) out.push(why); }
    }
  }
  // Every number a card reads for the screens is one the card settings hold, within the card's bounds.
  const held = instance.settings?.cardSettings;
  if (held && typeof held === 'object' && !Array.isArray(held)) {
    for (const c of instance.cards ?? []) {
      for (const r of c.screenReads ?? []) {
        const { key, whole = false, min = undefined, max = undefined } = typeof r === 'string' ? { key: r } : r;
        const n = held[key];
        const who = `card "${c.key}" reads card setting "${key}"`;
        if (typeof n !== 'number' || !Number.isFinite(n)) out.push(`${who}, which the settings do not hold`);
        else if (whole && !Number.isSafeInteger(n)) out.push(`${who} as ${n}; it must be a whole number`);
        else if (min !== undefined && n < min) out.push(`${who} as ${n}; it must be at least ${min}`);
        else if (max !== undefined && n > max) out.push(`${who} as ${n}; it must be at most ${max}`);
      }
    }
  }
  out.push(...systemProblems(instance));
  return out;
}

/** A surface card is a cast card on a post with a stack of 1 (surface design), and its limit is one of its screenReads, so the settings hold it within bounds. */
function surfaceProblems(c: CardRules): string[] {
  if (c.surface === undefined) return [];
  const out: string[] = [];
  const who = `card "${c.key}" has a surface`;
  if ((c.play ?? 'cast') !== 'cast') out.push(`${who}, and only a cast card does`);
  if (c.reaches !== undefined && !(c.reaches.length === 1 && c.reaches[0] === 'post')) out.push(`${who}, and a card that does reaches a post alone`);
  if ((c.stack ?? 1) !== 1) out.push(`${who} and a stack of ${JSON.stringify(c.stack)}; a surface card has a stack of 1`);
  if (!(c.screenReads ?? []).some((r) => (typeof r === 'string' ? r : r.key) === c.surface?.limitKey)) out.push(`${who} whose limit "${c.surface.limitKey}" is not one of its screenReads`);
  if (!isWhole(c.surface.mostLive, 1)) out.push(`${who} whose most live draws is ${JSON.stringify(c.surface.mostLive)}; it is a whole number, at least 1`);
  return out;
}

/**
 * A card's rarity, play, trap and gimmick, each refused naming the card (the card types design, sections 4 and 5). Only a set card has a
 * trap, only a use card has a gimmick, and each says its way out. seed_instance holds the same pairings.
 */
function playProblems(c: CardRules, reactionKeys: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const who = `card "${c.key}"`;
  if (c.rarity === undefined) out.push(`${who} has no rarity; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
  else if (!RARITIES.includes(c.rarity)) out.push(`${who} has the rarity ${JSON.stringify(c.rarity)}; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
  const play = c.play ?? 'cast';
  if (!PLAYS.includes(play)) out.push(`${who} is played ${JSON.stringify(play)}; a card is cast, used, set or kept`);
  if (play === 'keep') out.push(`${who} is kept, and Keep is not built until it is designed`);
  if (c.trap !== undefined && play !== 'set') out.push(`${who} has a trap, and only a set card has one`);
  if (play === 'set' && c.trap === undefined) out.push(`${who} is a set card with no trap`);
  const castEarn = play === 'cast' && c.gimmick?.kind === 'earn' && Array.isArray(c.reaches) && c.reaches.length === 1 && c.reaches[0] === 'character';
  if (c.gimmick !== undefined && play !== 'use' && !castEarn) out.push(`${who} has a gimmick, and only a use card has one, or a cast card on a character an earn`);
  if (castEarn) out.push(...gimmickProblems(c.gimmick, who, reactionKeys));
  if (play === 'use') {
    if (c.gimmick === undefined) out.push(`${who} is a use card with no gimmick`);
    else out.push(...gimmickProblems(c.gimmick, who, reactionKeys));
    if (c.lasts === undefined) out.push(`${who} is a use card with no time up (lasts); a use card ends at its time`);
    const outside = Array.isArray(c.reaches) ? c.reaches.filter((r) => r !== 'post' && r !== 'character' && r !== 'thread') : [];
    if (outside.length) out.push(`${who} is a use card and reaches ${outside.map((r) => (r === 'board' ? 'a board' : JSON.stringify(r))).join(' and ')}; a use card reaches a post, a character or a thread`);
  }
  const beyond = Array.isArray(c.reaches) && c.reaches.some((r) => r !== 'post');
  const postAlone = !beyond;
  if (c.lasts !== undefined && play !== 'use' && !beyond && c.skim === undefined) out.push(`${who} has a time up (lasts), and only a use card or a card reaching beyond a post does`);
  if (c.lasts !== undefined && !isSpan(c.lasts, LASTS_UNITS)) out.push(`${who} lasts ${JSON.stringify(c.lasts)}; it must be a span: a unit of hour, day, week or month and a whole count from 1 to 1000`);
  const on = (c.trap?.trigger as { on?: unknown } | undefined)?.on;
  if (c.trap !== undefined && !TRIGGERS.includes(on as never)) out.push(`${who} springs on ${on === undefined || on === null ? 'nothing' : JSON.stringify(on)}; a set card springs on ${TRIGGERS.join(' or ')}`);
  const match = c.trap?.match;
  if (c.trap !== undefined && c.catches === undefined && match === undefined && on === 'cast') out.push(`${who} springs on a cast and names no card to catch (catches) or match (match)`);
  if (match !== undefined && c.catches !== undefined) out.push(`${who} names a card (catches) and has a match; a set card has one of the two`);
  if (match !== undefined && play === 'set' && on !== 'cast') out.push(`${who} has a match, and only a set card that springs on a cast does`);
  else if (match !== undefined && play === 'set') out.push(...matchProblems(match, who));
  if (c.catches !== undefined && typeof c.catches !== 'function') out.push(`${who} has a catch that is not a function`);
  else if (c.catches !== undefined && !(play === 'set' && on === 'cast')) out.push(`${who} has a catch, and only a set card that springs on a cast does`);
  if (c.gimmick?.kind === 'noQuote' && c.reaches !== undefined && !(Array.isArray(c.reaches) && c.reaches.length === 1 && c.reaches[0] === 'post')) out.push(`${who} stops quotes, and a card that stops quotes reaches a post alone`);
  if (c.gimmick?.kind === 'ride' && postAlone === false) out.push(`${who} has a ride, and a card with a ride reaches a post alone`);
  if (c.trap?.outcome !== undefined) out.push(...outcomeProblems(c.trap.outcome, who, play, on, match));
  if (c.skim !== undefined) out.push(...skimProblems(c, who, play));
  if (c.scoresAs !== undefined) {
    if (c.scoresAs !== true) out.push(`${who} has scoresAs ${JSON.stringify(c.scoresAs)}; scoresAs is true or left out`);
    else {
      if (play !== 'cast') out.push(`${who} scores as a class, and only a cast card does`);
      if (!(Array.isArray(c.reaches) && c.reaches.length === 1 && c.reaches[0] === 'character')) out.push(`${who} scores as a class, and a card that does reaches a character alone`);
    }
  }
  if (c.writes !== undefined && (typeof c.writes !== 'object' || c.writes === null || typeof c.writes.tokens !== 'function' || typeof c.writes.frame !== 'function')) out.push(`${who} has writes that are not a tokens function and a frame function`);
  else if (c.writes !== undefined && Array.isArray(c.reaches) && c.reaches.some((r) => r !== 'post')) out.push(`${who} writes, and a card that writes reaches a post alone`);
  // A card that writes is a cast card, cast face up: never a set card, which springs later, nor a use card; and decideSet refuses to set it face down.
  if (c.writes !== undefined && play !== 'cast') out.push(`${who} writes, and only a cast card does: it is cast face up, never set face down`);
  if (c.replies !== undefined) {
    if (c.replies !== true) out.push(`${who} replies ${JSON.stringify(c.replies)}; replies is true or left out`);
    else {
      if (play !== 'cast') out.push(`${who} replies, and only a cast card does`);
      if (!(c.reaches === undefined || (Array.isArray(c.reaches) && c.reaches.length === 1 && c.reaches[0] === 'post'))) out.push(`${who} replies, and a card that replies reaches a post alone`);
      if (c.stack !== undefined && c.stack !== 1) out.push(`${who} replies, and a card that replies has a stack of 1`);
      if (c.writes !== undefined) out.push(`${who} replies and writes; a card that replies does not write`);
    }
  }
  if (c.keeps !== undefined) {
    if (c.keeps !== true) out.push(`${who} keeps ${JSON.stringify(c.keeps)}; keeps is true or left out`);
    // A thread's play or a character's (docs/plans/2026-11-12-glitter-keeps-plan.md). SQL mirrors none of this (0348_post_under.sql).
    else if (!(play === 'cast' && Array.isArray(c.reaches) && c.reaches.length === 1 && ['thread', 'character'].includes(c.reaches[0] as string) && c.lasts !== undefined)) out.push(`${who} keeps, and only a cast card that reaches one thread or one character, with a time up, does`);
  }
  if (c.setPhrase !== undefined && typeof c.setPhrase !== 'function') out.push(`${who} has a set phrase that is not a function`);
  else if (c.setPhrase !== undefined && play !== 'cast') out.push(`${who} has a set phrase, and only a cast card has one`);
  return out;
}

/** A ride's or a skim's share: a fraction of a vote, above 0 and at most 1. `said` is how the card's words name what holds it ("a ride", "an outcome of share"). */
function shareProblem(e: Record<string, unknown>, who: string, what: string, said: string): string | null {
  if (e.share === undefined) return `${who} has ${what} with no share; share is above 0 and at most 1`;
  if (typeof e.share !== 'number' || !(e.share > 0 && e.share <= 1)) return `${who} has ${said} ${JSON.stringify(e.share)}; share is above 0 and at most 1`;
  return null;
}

/** A cast trap's outcome (Part 6 of the card notes): a ride, on a set card that springs on a cast and names its card, never one that matches. */
function outcomeProblems(o: unknown, who: string, play: string, on: unknown, match: unknown): string[] {
  if (typeof o !== 'object' || o === null) return [`${who} has an outcome that is not an object`];
  if (play !== 'set' || on !== 'cast') return [`${who} has an outcome, and only a set card that springs on a cast does`];
  const e = o as Record<string, unknown>;
  const out: string[] = [];
  if (match !== undefined) out.push(`${who} has an outcome beside a match; a ride outcome names its card (catches)`);
  if (e.kind !== 'ride') out.push(`${who} has an outcome of kind ${JSON.stringify(e.kind)}; an outcome is ride`);
  else { const why = shareProblem(e, who, 'an outcome', 'an outcome of share'); if (why) out.push(why); }
  return out;
}

/** A skim: a cast card that reaches a post alone, lasts and does not write, with a share of a vote. */
function skimProblems(c: CardRules, who: string, play: string): string[] {
  const k = c.skim as unknown;
  if (typeof k !== 'object' || k === null) return [`${who} has a skim that is not an object`];
  const out: string[] = [];
  const why = shareProblem(k as Record<string, unknown>, who, 'a skim', 'a skim of');
  if (why) out.push(why);
  if (play !== 'cast') out.push(`${who} has a skim, and only a cast card does`);
  if (Array.isArray(c.reaches) && c.reaches.some((r) => r !== 'post')) out.push(`${who} has a skim, and a card with a skim reaches a post alone`);
  if (c.lasts === undefined) out.push(`${who} has a skim with no time up (lasts); a skim ends at its time`);
  if (c.writes !== undefined) out.push(`${who} has a skim and writes; a card with a skim does not write`);
  return out;
}

const flavorsBad = (v: unknown): boolean => !Array.isArray(v) || v.some((f) => !ALIGNMENTS.includes(f as never));

/** A cast trap's match: at least a flavor list or a rarity, each from the engine's lists. */
function matchProblems(match: { flavors?: unknown; upTo?: unknown }, who: string): string[] {
  const out: string[] = [];
  if (typeof match !== 'object' || match === null) return [`${who} has a match that is not an object`];
  if (match.flavors === undefined && match.upTo === undefined) out.push(`${who} has a match that names no flavor and no rarity`);
  if (match.flavors !== undefined && (flavorsBad(match.flavors) || (match.flavors as unknown[]).length === 0)) out.push(`${who} has a match of the flavors ${JSON.stringify(match.flavors)}; a flavor is ${ALIGNMENTS.join(', ')}`);
  if (match.upTo !== undefined && !RARITIES.includes(match.upTo as never)) out.push(`${who} has a match up to ${JSON.stringify(match.upTo)}; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
  return out;
}

/** A use card's gimmick: one of the engine's kinds, each with the numbers it needs (the card types design, section 5). */
function gimmickProblems(g: unknown, who: string, reactionKeys: ReadonlySet<string>): string[] {
  if (typeof g !== 'object' || g === null) return [`${who} has a gimmick that is not an object`];
  const e = g as Record<string, unknown>;
  const out: string[] = [];
  const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;
  if (e.kind === 'ward') {
    if (e.upTo === undefined && e.flavors === undefined && e.cards === undefined) out.push(`${who} has a ward that names no rarity, flavor or card`);
    if (e.upTo !== undefined && !RARITIES.includes(e.upTo as never)) out.push(`${who} has a ward up to ${JSON.stringify(e.upTo)}; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
    if (e.flavors !== undefined && (!list(e.flavors) || flavorsBad(e.flavors))) out.push(`${who} has a ward of the flavors ${JSON.stringify(e.flavors)}; a flavor is ${ALIGNMENTS.join(', ')}`);
    if (e.cards !== undefined && (!list(e.cards) || e.cards.some((k) => typeof k !== 'string'))) out.push(`${who} has a ward of the cards ${JSON.stringify(e.cards)}; cards are named by key`);
  } else if (e.kind === 'earn') {
    if (typeof e.by !== 'number' || !(e.by > 0 && e.by <= 1)) out.push(e.by === undefined ? `${who} has an earn with no by; by is above 0 and at most 1` : `${who} has an earn of ${JSON.stringify(e.by)}; by is above 0 and at most 1`);
    if (e.quadrants === undefined && e.reactions === undefined) out.push(`${who} has an earn that names no quadrant and no reaction`);
    if (e.group !== undefined && (typeof e.group !== 'string' || e.group === '')) out.push(`${who} has an earn with the group ${JSON.stringify(e.group)}; a group is a word`);
    if (e.quadrants !== undefined) {
      if (!list(e.quadrants)) out.push(`${who} has an earn naming no quadrant; a quadrant is ${QUADRANTS.join(', ')}`);
      else for (const q of e.quadrants) if (!QUADRANTS.includes(q as never)) out.push(`${who} has an earn naming the quadrant ${JSON.stringify(q)}; a quadrant is ${QUADRANTS.join(', ')}`);
    }
    if (e.reactions !== undefined) {
      if (!list(e.reactions)) out.push(`${who} has an earn naming no reaction`);
      else for (const r of e.reactions) if (typeof r !== 'string' || !reactionKeys.has(r)) out.push(`${who} has an earn naming the reaction ${JSON.stringify(r)}, which the instance does not have`);
    }
  } else if (e.kind === 'price') {
    if (!list(e.flavors) || flavorsBad(e.flavors)) out.push(`${who} has a price with no flavors; name at least one of ${ALIGNMENTS.join(', ')}`);
    if (!Number.isSafeInteger(e.add) || (e.add as number) <= 0) out.push(`${who} has a price that adds ${JSON.stringify(e.add)}; add is a positive whole number`);
  } else if (e.kind === 'ride') {
    const why = shareProblem(e, who, 'a ride', 'a ride of');
    if (why) out.push(why);
  } else if (e.kind === 'noQuote') {
    // It has no numbers: a card that stops quotes stops them all, and what it reaches is playProblems'.
  } else {
    out.push(`${who} has a gimmick of kind ${JSON.stringify(e.kind)}; a gimmick is ${GIMMICK_KINDS.slice(0, -1).join(', ')} or ${GIMMICK_KINDS.at(-1)}`);
  }
  return out;
}

const spanWords = (s: Span): string => `${s.count} ${s.unit}${s.count === 1 ? '' : 's'}`;

/**
 * A card's reaches (the card mechanic's design, section 7), each refused naming the card: a list of the four reaches, each once;
 * none beyond its rarity's (`reachRarity`); a time up for every card beyond a post, at most its reach's bound (`reachLasts`); and
 * a Set on a post alone. seed_instance (supabase/migrations/0055_card_reach.sql) holds the same.
 */
function reachProblems(c: CardRules, settings: Settings): string[] {
  if (c.reaches === undefined) return c.pins !== undefined ? [`card "${c.key}" pins ${JSON.stringify(c.pins)}; only a card that reaches a thread pins, and pins is true or left out`] : [];
  const who = `card "${c.key}"`;
  const reaches: readonly unknown[] = c.reaches;
  if (!Array.isArray(reaches) || !reaches.length || reaches.some((r) => !REACHES.includes(r as never)) || new Set(reaches).size !== reaches.length) {
    return [`${who} reaches ${JSON.stringify(c.reaches)}; a card reaches a list of post, character, thread or board, each once`];
  }
  const out: string[] = [];
  const beyond = BEYOND_POST.filter((r) => c.reaches!.includes(r));
  if ((c.play ?? 'cast') === 'set' && beyond.length) out.push(`${who} is a set card, and a set card lands only on a post`);
  if (c.pins !== undefined && (c.pins !== true || !c.reaches.includes('thread'))) out.push(`${who} pins ${JSON.stringify(c.pins)}; only a card that reaches a thread pins, and pins is true or left out`);
  if (beyond.length && c.lasts === undefined) out.push(`${who} reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time`);
  const least = settings?.reachRarity;
  const longest = settings?.reachLasts;
  for (const r of beyond) {
    const floor = least?.[r];
    if (RARITIES.includes(floor) && RARITIES.includes(c.rarity) && !atOrBelow(floor, c.rarity)) out.push(`${who} reaches a ${r}, which takes a card of ${floor} or rarer; it is ${c.rarity}`);
    const bound = longest?.[r];
    if (c.lasts !== undefined && isSpan(c.lasts, LASTS_UNITS) && bound !== undefined && isSpan(bound) && spanMs(c.lasts) > spanMs(bound)) {
      out.push(`${who} lasts ${spanWords(c.lasts)}, longer than a ${r} effect may (reachLasts.${r}, ${spanWords(bound)})`);
    }
  }
  return out;
}

/** A drive's span counts hours, days or weeks, never months: SQL's span_interval takes a month as a calendar month and spanMs as 30 days, so a monthly close could differ between them. */
const DRIVE_UNITS: readonly Span['unit'][] = ['hour', 'day', 'week'];

/** The most days a drive may last after its latest play: a month's drive would never close in play, and the close is computed from the plays. */
const DRIVE_LASTS_MOST_DAYS = 30;

/** A card's draw: a real list of distinct keys the server can store on a play, each naming the card (Jimmy Wails plan, Task 1). */
function drawProblems(c: CardRules): string[] {
  if (c.draws === undefined) return [];
  const who = `card "${c.key}"`;
  if (!Array.isArray(c.draws)) return [`${who} draws ${JSON.stringify(c.draws)}; draws is a list of keys`];
  if (!c.draws.length) return [`${who} draws nothing; a card with a draw lists at least one key, or leaves draws out`];
  const out: string[] = [];
  for (const k of c.draws) if (typeof k !== 'string' || !/^[a-z0-9-]{1,40}$/.test(k)) out.push(`${who} draws ${JSON.stringify(k)}; a draw is lowercase letters, digits and hyphens, 1 to 40`);
  for (const k of duplicates(c.draws.filter((k) => typeof k === 'string'), (k) => k)) out.push(`${who} draws "${k}" twice`);
  return out;
}

/** The longest the words a blank message is refused with may be: the same bound as a caster's own message (MESSAGE_MOST). */
const NEEDS_MESSAGE_MOST = 200;

/** A card that needs a message: the refusal's words are a sentence, and only a cast or a use carries a message to need. */
function needsMessageProblems(c: CardRules): string[] {
  if (c.needsMessage === undefined) return [];
  const who = `card "${c.key}"`;
  if (typeof c.needsMessage !== 'string') return [`${who} needsMessage ${JSON.stringify(c.needsMessage)}; it is the sentence a blank message is refused with`];
  if (c.needsMessage.trim() === '') return [`${who} needs a message, and its refusal is empty`];
  const out: string[] = [];
  if (c.needsMessage.length > NEEDS_MESSAGE_MOST) out.push(`${who} needsMessage is longer than ${NEEDS_MESSAGE_MOST} characters`);
  if ((c.play ?? 'cast') === 'set') out.push(`${who} needs a message, and only a cast or a use carries one`);
  return out;
}

/**
 * A card's drive: a Cast reaching a post alone, with a span of at most 30 days, gift amounts and an overhead that are economy numbers
 * in range. The amounts are read from the economy as it stands, since the economy may be tuned later (the SQL reads it again at each gift).
 */
function driveProblems(c: CardRules, settings: Settings): string[] {
  const d = c.drive;
  if (d === undefined) return [];
  const who = `card "${c.key}" has a drive`;
  const out: string[] = [];
  if ((c.play ?? 'cast') !== 'cast') out.push(`${who}, and only a cast card does`);
  const reaches = c.reaches ?? ['post'];
  if (!Array.isArray(reaches) || reaches.length !== 1 || reaches[0] !== 'post') out.push(`${who}, and a drive card reaches a post alone`);
  if (typeof d !== 'object' || d === null) return [...out, `${who} that is not an object of lasts, gifts and overhead`];
  if (!isSpan(d.lasts, DRIVE_UNITS)) out.push(`${who} that lasts ${JSON.stringify(d.lasts)}; it must be a span: a unit of hour, day or week and a whole count from 1 to 1000`);
  else if (spanMs(d.lasts) > DRIVE_LASTS_MOST_DAYS * 86_400_000) out.push(`${who} that lasts ${spanWords(d.lasts)}, longer than the ${DRIVE_LASTS_MOST_DAYS} days a drive may`);
  const economy = settings?.economy;
  const held = economy !== null && typeof economy === 'object' && !Array.isArray(economy) ? economy : {};
  const gifts: readonly unknown[] = Array.isArray(d.gifts) ? d.gifts : [];
  if (!Array.isArray(d.gifts) || !gifts.length) out.push(`${who} with no gift amounts (gifts); a drive lists the economy keys of at least one`);
  for (const k of duplicates(gifts.filter((k) => typeof k === 'string'), (k) => k)) out.push(`${who} that lists gift "${k}" twice`);
  for (const k of gifts) {
    const n = typeof k === 'string' ? held[k] : undefined;
    if (typeof n !== 'number' || !Number.isFinite(n)) out.push(`${who} gift ${JSON.stringify(k)}, which is not a number the economy holds`);
    else if (!isWhole(n, 1) || n > settings.walletCap) out.push(`${who} gift ${JSON.stringify(k)} of ${n}; a gift is a positive whole number of hundredths, at most the wallet's cap (${settings.walletCap})`);
  }
  const over = typeof d.overhead === 'string' ? held[d.overhead] : undefined;
  if (typeof over !== 'number' || !Number.isFinite(over)) out.push(`${who} overhead ${JSON.stringify(d.overhead)}, which is not a number the economy holds`);
  else if (!isWhole(over, 0) || over > 100) out.push(`${who} overhead of ${over}; it is a whole number from 0 to 100`);
  return out;
}

/** The longest a persona's title and signature may be: what the seed writes into a profile (0043 cuts them in silence). */
export const STAFF_TITLE_MAX = 40;
export const STAFF_SIGNATURE_MAX = 500;

/** Checks of `instance.system`, the content The System reads, each a sentence naming what is wrong. */
/** The most beats one persona's arc and mini-arcs hold together: each is read by the tick, so the pass is bounded by the persona's file and never by the instance's history. */
export const ARC_BEATS_MOST = 24;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Problems with a persona's arc, mini-arcs and held-back kinds (fangame split design, sections 1 to 3), each naming the predicate that failed in parentheses. The beats are in one
 * order, the arc's and then the mini-arcs': a `beatLanded` names a beat before it (so no two wait on each other), and a role from another beat names a beat before it whose bundle makes it.
 * `authoredMostParts` is `bundleAuthoredMostParts`, null where the settings are not whole enough to say.
 */
function arcProblems(who: string, p: Persona, authoredMostParts: number | null): string[] {
  const out: string[] = [];
  const lists: [string, unknown][] = [['arc', p.arc], ['miniArcs', p.miniArcs], ['holdsBack', p.holdsBack]];
  for (const [name, list] of lists) if (list !== undefined && !Array.isArray(list)) out.push(`${who} has ${name} that is no list (isArray)`);
  const arc = Array.isArray(p.arc) ? p.arc : [];
  const minis = Array.isArray(p.miniArcs) ? p.miniArcs : [];
  const beats = [...arc.map((b) => ({ b, mini: false })), ...minis.map((b) => ({ b, mini: true }))];
  if (beats.length > ARC_BEATS_MOST) out.push(`${who} has ${beats.length} beats between its arc and mini-arcs, more than the ${ARC_BEATS_MOST} the tick reads for one persona (atMost(${ARC_BEATS_MOST}))`);
  const at = new Map<string, number>();
  beats.forEach(({ b }, i) => { if (isObj(b) && typeof b.key === 'string' && !at.has(b.key)) at.set(b.key, i); });
  for (const k of duplicates(beats.filter(({ b }) => isObj(b)), ({ b }) => String(b.key))) out.push(`${who}: beat "${k}" is used twice (isUnique)`);
  const bundleOf = (key: string) => beats[at.get(key) ?? -1]?.b.bundle;
  /** A role of a template's part, from another beat: `{role, beat}`; the beat is the persona's, its bundle makes the role, and (for a part) it comes before the beat that names it. */
  const ref = (pre: string, r: Record<string, unknown>, from: number, mustPrecede: boolean): string | null => {
    const beat = String(r['beat']);
    const role = String(r['role']);
    const i = at.get(beat);
    if (i === undefined) return `${pre} names role "${role}" of beat "${beat}", which is no beat of the persona (beatOfPersona)`;
    const parts = beats[i]!.b.bundle?.parts;
    if (!Array.isArray(parts) || !parts.some((x) => x.role === role && x.kind === 'createBoard')) return `${pre} names role "${role}" of beat "${beat}", which that beat's bundle never makes (roleMade)`;
    if (mustPrecede && i >= from) return `${pre} names role "${role}" of beat "${beat}", which is not before it (earlierBeat)`;
    return null;
  };
  const kinds = MOVE_KINDS.map((k) => k.key);
  beats.forEach(({ b, mini }, from) => {
    if (!isObj(b)) { out.push(`${who} has a beat that is no object (isObject)`); return; }
    const pre = `${who} beat "${String(b.key)}"`;
    if (typeof b.key !== 'string' || !BEAT_KEY.test(b.key)) out.push(`${pre} is not a key: lowercase letters, digits, hyphens and underscores, from a letter, at most 40 (isKey)`);
    if (typeof b.brief !== 'string' || b.brief.trim() === '') out.push(`${pre} has no brief: it is the Boss's private intent, shown once the beat unlocks (required)`);
    if (!Array.isArray(b.unlock) || b.unlock.length < 1) out.push(`${pre} has no unlock condition: it needs at least one (atLeast(1))`);
    else b.unlock.forEach((c: unknown, i: number) => {
      const bad = conditionProblem(c);
      if (bad) { out.push(`${pre} unlock ${i + 1}: ${bad.said} (${bad.predicate})`); return; }
      const cond = c as Record<string, unknown>;
      if (cond['kind'] === 'beatLanded') {
        const to = at.get(String(cond['beat']));
        if (to === undefined) out.push(`${pre} unlock ${i + 1} waits on "${String(cond['beat'])}", which is no beat of the persona (beatOfPersona)`);
        else if (to >= from) out.push(`${pre} unlock ${i + 1} waits on "${String(cond['beat'])}", which is not before it (earlierBeat)`);
      } else if (cond['kind'] === 'boardActivity') {
        for (const side of ['board', 'above', 'below']) {
          const r = cond[side];
          if (isObj(r)) { const why = ref(`${pre} unlock ${i + 1}`, r, from, false); if (why) out.push(why); }
        }
      }
    });
    if (b.due !== undefined) {
      if (mini) out.push(`${pre} is a mini-arc and has a due point, which a mini-arc never has (noDueOnMiniArc)`);
      else { const bad = dueProblem(b.due); if (bad) out.push(`${pre} due: ${bad.said} (${bad.predicate})`); }
    }
    if (b.repeatable !== undefined && b.repeatable !== false && !mini) out.push(`${pre} is repeatable, which only a mini-arc may be (miniArcOnly)`);
    const t = b.bundle;
    if (t === undefined) return;
    if (!isObj(t) || !Array.isArray(t.parts)) { out.push(`${pre} has a bundle that is no template with parts (isObject)`); return; }
    if (typeof t.name !== 'string' || t.name.trim() === '' || t.name.length > 120) out.push(`${pre} has a bundle with no name, or one over 120 characters (atMost(120))`);
    if (t.parts.length < 1) out.push(`${pre} has a bundle with no part (atLeast(1))`);
    if (authoredMostParts !== null && t.parts.length > authoredMostParts) out.push(`${pre} has a bundle of ${t.parts.length} parts, more than bundleAuthoredMostParts allows (atMost(${authoredMostParts}))`);
    const made = new Set<string>();
    for (const r of duplicates(t.parts, (x) => String(x?.role))) out.push(`${pre}: role "${r}" is used twice in its bundle (isUnique)`);
    for (const part of t.parts) {
      if (!isObj(part)) { out.push(`${pre} has a part that is no object (isObject)`); continue; }
      const at2 = `${pre} part "${String(part.role)}"`;
      if (typeof part.role !== 'string' || !BEAT_KEY.test(part.role)) out.push(`${at2} has a role that is not a key (isKey)`);
      if (!kinds.includes(String(part.kind))) out.push(`${at2} is "${String(part.kind)}", which is not a move kind (oneOf(${kinds.join(', ')}))`);
      const fixed = isObj(part.params) ? part.params : {};
      const slots = isObj(part.slots) ? part.slots : {};
      for (const [name, slot] of Object.entries(slots)) {
        if (name in fixed) out.push(`${at2} has slot "${name}", which is also a fixed param (notFixed)`);
        if (!isObj(slot) || slot.default === undefined || typeof slot.hint !== 'string' || slot.hint.trim() === '') out.push(`${at2} has slot "${name}" with no default or no hint (required)`);
      }
      for (const v of [...Object.values(fixed), ...Object.values(slots).map((x) => (isObj(x) ? x.default : undefined))]) {
        if (!isObj(v) || typeof v['role'] !== 'string') continue;
        if (Object.keys(v).length === 1) {
          if (!made.has(v['role'])) out.push(`${at2} names role "${v['role']}", which no earlier part of its bundle makes (roleMade)`);
        } else if (Object.keys(v).length === 2 && typeof v['beat'] === 'string') {
          const why = ref(at2, v, from, true);
          if (why) out.push(why);
        }
      }
      if (part.kind === 'createBoard' && typeof part.role === 'string') made.add(part.role);
    }
  });
  const hb = Array.isArray(p.holdsBack) ? p.holdsBack : [];
  for (const h of hb) {
    if (!isObj(h)) { out.push(`${who} holdsBack has an entry that is no object (isObject)`); continue; }
    if (!kinds.includes(String(h.kind))) out.push(`${who} holdsBack "${String(h.kind)}" is not a move kind (oneOf(${kinds.join(', ')}))`);
    if (typeof h.until !== 'string' || !at.has(h.until)) out.push(`${who} holdsBack "${String(h.kind)}" until "${String(h.until)}", which is no beat of the persona (beatOfPersona)`);
  }
  for (const k of duplicates(hb.filter(isObj), (h) => String(h.kind))) out.push(`${who} holdsBack "${k}" is named twice (isUnique)`);
  return out;
}

function systemProblems(instance: Instance): string[] {
  const sys: SystemContent | undefined = instance.system;
  if (typeof sys !== 'object' || sys === null) return ['the instance has no system content (system)'];
  const out: string[] = [];
  const roster = Array.isArray(sys.roster) ? sys.roster : [];
  if (!roster.length) out.push('the instance\'s roster is empty (system.roster)');
  const rosterKeys = new Set(roster.map((p) => p.key));
  // Each office that posts has a frame: a premise and answer rules the engine sets around a persona's own words (`personaPrompt`).
  const frames: Record<string, { premise?: unknown; answerRules?: unknown } | undefined> = sys.offices !== null && typeof sys.offices === 'object' ? sys.offices : {};
  for (const office of POSTING_OFFICES) {
    const frame = frames[office];
    if (frame === undefined || frame === null || typeof frame !== 'object') { out.push(`system.offices has no "${office}" frame`); continue; }
    for (const part of ['premise', 'answerRules'] as const) if (typeof frame[part] !== 'string' || frame[part].trim() === '') out.push(`system.offices.${office} has a blank ${part}`);
  }
  for (const k of duplicates(roster, (p) => p.key)) out.push(`persona key "${k}" is used twice`);
  /* The developer persona's staff key is the engine's (0062): a roster member under it would be the character the persona is seeded as, or be left unmade. */
  if (rosterKeys.has(DEVELOPER_STAFF_KEY)) out.push(`persona key "${DEVELOPER_STAFF_KEY}" is reserved for the developer persona, which a model never plays`);
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  for (const p of roster) {
    const who = `persona "${p.key}"`;
    for (const part of ['name', 'title', 'signature', 'selfPrompt', 'startingHobby', 'temperament', 'persuadedBy'] as const) if (!text(p[part])) out.push(`${who} has no ${part}`);
    if (typeof p.title === 'string' && p.title.length > STAFF_TITLE_MAX) out.push(`${who} has a title of ${p.title.length} characters; the seed keeps at most ${STAFF_TITLE_MAX} and cuts the rest in silence`);
    if (typeof p.signature === 'string' && p.signature.length > STAFF_SIGNATURE_MAX) out.push(`${who} has a signature of ${p.signature.length} characters; the seed keeps at most ${STAFF_SIGNATURE_MAX} and cuts the rest in silence`);
    for (const list of ['beats', 'petRules'] as const) if (!Array.isArray(p[list])) out.push(`${who} has no ${list}`);
    if (p.officeLines !== undefined && p.officeLines !== null && typeof p.officeLines === 'object') {
      for (const [office, line] of Object.entries(p.officeLines)) {
        if (!(POSTING_OFFICES as readonly string[]).includes(office)) out.push(`${who} has an office line for "${office}", which is not an office that posts (${POSTING_OFFICES.join(', ')})`);
        else if (!text(line)) out.push(`${who} has a blank office line for "${office}"`);
      }
    }
    if (p.pronouns !== undefined) for (const why of pronounProblems(p.pronouns)) out.push(`${who} has pronouns that fail: ${why}`);
    const authoredMost = instance.settings?.bundleAuthoredMostParts;
    out.push(...arcProblems(who, p, typeof authoredMost === 'number' && Number.isInteger(authoredMost) ? authoredMost : null));
    if (p.strictness === undefined || p.strictness === null) out.push(`${who} has no strictness`);
    if (p.inheritsMemoryOf !== undefined && (p.inheritsMemoryOf === p.key || !rosterKeys.has(p.inheritsMemoryOf))) out.push(`${who} inherits the memory of "${p.inheritsMemoryOf}", who is not another persona in the roster`);
    for (const ph of PHASES) {
      const given = p.phases?.[ph] as Record<string, unknown> | undefined;
      for (const key of Object.keys(given ?? {})) {
        const n = given![key];
        const cap = (PHASE_CAPS[ph] as unknown as Record<string, number>)[key];
        if (cap === undefined) out.push(`${who} overrides ${ph} ${key}, which is not a number that phase holds`);
        else if (!isWhole(n, 1) || n > cap) out.push(`${who} overrides ${ph} ${key} as ${JSON.stringify(n)}; it must be a whole number from 1 to ${cap} (the engine's cap)`);
      }
    }
    const w = p.weakness;
    if (w?.kind === 'quiz') {
      if (!Array.isArray(w.questions) || !w.questions.length) out.push(`${who} has a quiz with no question; a quiz needs at least one question`);
      else w.questions.forEach((q: QuizQuestion, i: number) => {
        const at = `${who}'s quiz question ${i + 1}`;
        if (typeof q.question !== 'string' || !q.question.trim() || q.question.length > 280) out.push(`${at} has no question to ask; a question is text of at most 280 characters`);
        if (Array.isArray(q.choices) && (q.choices.length > 8 || q.choices.some((c) => typeof c !== 'string' || !c.trim() || c.length > 200))) out.push(`${at} has more than eight choices, or a choice that is blank or over 200 characters`);
        if (typeof q.question === 'string' && q.question !== q.question.trim()) out.push(`${at} has a space at the start or the end of its question`);
        if (Array.isArray(q.choices) && q.choices.some((c) => typeof c === 'string' && c !== c.trim())) out.push(`${at} has a choice with a space at the start or the end`);
        if (!Array.isArray(q.choices) || q.choices.length < 2) out.push(`${at} has fewer than two choices; it needs at least two choices`);
        else if (new Set(q.choices).size !== q.choices.length) out.push(`${at} lists a choice twice`);
        if (!Array.isArray(q.choices) || !q.choices.includes(q.answer)) out.push(`${at} has the answer ${JSON.stringify(q.answer)}, which is not one of its choices`);
      });
    } else if (w?.kind === 'bribe') {
      if (!isWhole(w.price, BRIBE_BOUNDS.least) || w.price > BRIBE_BOUNDS.most) out.push(`${who} has a bribe with a price of ${JSON.stringify(w.price)}; a price is a whole number of hundredths from ${BRIBE_BOUNDS.least} to ${BRIBE_BOUNDS.most}`);
      else if (typeof instance.settings?.walletCap === 'number' && w.price > instance.settings.walletCap) out.push(`${who} has a bribe priced at ${w.price}, more than a wallet holds (walletCap ${instance.settings.walletCap}); no one could pay it`);
    } else if (w?.kind !== 'distraction') out.push(`${who} has no weakness: a quiz, a bribe or a distraction`);
    if (p.voice === undefined) out.push(`${who} has no voice`);
    else if (p.voice !== 'chat' && p.voice !== 'oldVoice') out.push(`${who} has the voice ${JSON.stringify(p.voice)}; a voice is "chat" or "oldVoice"`);
    const v = p.strictness?.visitHours;
    if (p.strictness !== undefined && p.strictness !== null && (!v || !isWhole(v.least, 1) || !isWhole(v.most, 1) || v.least > v.most)) out.push(`${who} has visit hours that are not a whole least and most, the least at least 1 and no more than the most`);
  }
  if (roster.length && !rosterKeys.has(sys.firstBoss)) out.push(`firstBoss "${sys.firstBoss}" is not in the roster`);
  if (!Array.isArray(sys.firstStaff) || !sys.firstStaff.length) out.push('firstStaff names no one; at least one roster member is on staff from the start');
  else for (const k of sys.firstStaff) {
    if (!rosterKeys.has(k)) out.push(`firstStaff names "${k}", which is not in the roster`);
    else if (k === sys.firstBoss) out.push(`firstStaff names "${k}", who is firstBoss; the first season's Boss is not also on staff from the start`);
  }
  const duties = sys.duties ?? ({} as SystemContent['duties']);
  for (const d of DUTIES) {
    const who = duties[d];
    if (typeof who !== 'string' || who === '') out.push(`duty "${d}" is assigned to no one`);
    else if (who !== 'boss' && who !== 'beat' && who !== 'filer' && !rosterKeys.has(who)) out.push(`duty "${d}" is assigned to "${who}", who is not "boss", "beat", "filer" or a staff member in the roster`);
  }
  for (const key of Object.keys(duties)) if (!(DUTIES as readonly string[]).includes(key)) out.push(`the duties name "${key}", which is not a duty`);
  for (const key of STOCK_LINE_KEYS) {
    const lines = sys.stockLines?.[key];
    if (!Array.isArray(lines) || !lines.length || lines.some((l) => typeof l !== 'string' || l.trim() === '')) { out.push(`stock line "${key}" is missing; every standing order needs at least one line`); continue; }
    for (const line of lines) {
      for (const [, token] of line.matchAll(/\{([^{}]*)\}/g)) {
        const [name, form, ...extra] = token!.split('.');
        const given = STOCK_LINE_TOKENS[key];
        if (form !== undefined && given.includes(name!) && (STAFF_TOKENS as readonly string[]).includes(name!)) {
          if (extra.length || !(PRONOUN_FORMS as readonly string[]).includes(form)) out.push(`stock line "${key}" uses {${token}}, which is not a pronoun form ({${name}} may take one of: ${PRONOUN_FORMS.join(', ')})`);
        } else if (!given.includes(token!)) {
          const staff = form !== undefined && (STAFF_TOKENS as readonly string[]).includes(name!) ? '' : form !== undefined ? ` ({${name}} is a name only; only ${STAFF_TOKENS.map((t) => `{${t}}`).join(' and ')} take a pronoun form)` : '';
          out.push(`stock line "${key}" uses {${token}}, which that line is never given (it may use ${given.map((t) => `{${t}}`).join(', ')})${staff}`);
        }
      }
    }
  }
  for (const key of Object.keys(sys.stockLines ?? {})) if (!(STOCK_LINE_KEYS as readonly string[]).includes(key)) out.push(`stock line "${key}" is for no standing order`);
  if (typeof sys.nameStyle !== 'function') out.push('system.nameStyle is not a function');
  if (typeof sys.nameStyleBrief !== 'string' || sys.nameStyleBrief.trim() === '') out.push('system.nameStyleBrief is empty; the meeting\'s prompt needs the name style in words');
  if (typeof sys.announcementsTitle !== 'string' || sys.announcementsTitle.trim() === '') out.push('system.announcementsTitle is empty; the seed makes The System\'s announcements thread from it, and with none no move can land');
  for (const key of ['feeds', 'realWorld', 'scrubWords', 'wheelhouse'] as const) if (!Array.isArray(sys[key])) out.push(`the instance has no system.${key} list`);
  if (Array.isArray(sys.scrubWords)) {
    for (const w of sys.scrubWords) {
      if (typeof w !== 'string' || w.trim() === '') out.push('a scrubWords entry is empty; it would hit every text');
      else if (w !== w.toLowerCase()) out.push(`scrubWords entry "${w}" is not lower case; the scrubber folds the text to lower case, so it could never match`);
    }
  }
  // A feed is fetched by the meeting: only over https, so nothing in between reads or rewrites what the Boss is told.
  if (Array.isArray(sys.feeds)) {
    for (const f of sys.feeds) {
      let https = false;
      try { https = new URL(String(f?.url)).protocol === 'https:'; } catch { /* not a URL */ }
      if (!https) out.push(`feed "${String(f?.name)}" is not an https address`);
    }
  }
  // The settings that bound a move: a phase's longest move cannot outrun the longest any move may run.
  const set = instance.settings;
  if (set && settingsProblems(set).length === 0) {
    for (const p of PHASES) if (set.phases[p].moveExpiryMostDays > set.moveExpiryMostDays) out.push(`phase "${p}" lets a move run ${set.phases[p].moveExpiryMostDays} days (moveExpiryMostDays), more than the ${set.moveExpiryMostDays} days any move may run`);
    if (set.moveExpiryLeastHours > set.moveExpiryMostDays * 24) out.push(`moveExpiryLeastHours is ${set.moveExpiryLeastHours}, more than the ${set.moveExpiryMostDays * 24} hours of moveExpiryMostDays`);
  }
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
/**
 * Settings with some replaced; the economy is replaced number by number, so one override keeps
 * the rest. An economy override that is not an object of numbers is kept as given, so the check
 * of the settings (settingsProblems) names it rather than its being dropped in silence.
 */
export function withOverrides(settings: Settings, overrides: Partial<Settings>): Settings {
  const given = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  const e = overrides.economy;
  const economy = e === undefined ? settings.economy : typeof e === 'object' && e !== null && !Array.isArray(e) ? { ...settings.economy, ...e } : e;
  return deepFreeze({ ...settings, ...given, economy });
}
