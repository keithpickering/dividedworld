/**
 * What makes an instance whole: the checks the engine runs on what an instance hands it,
 * before it is trusted to settle anything. Each returns problems as sentences; [] is whole.
 */
import { QUADRANTS } from './types.ts';
import { ALERT_KINDS } from './alerts.ts';
import type { DeveloperPersona, EconomyRead, Instance, Settings, QuizQuestion, Span, SystemContent } from './types.ts';
import { DIGEST_MOST } from '../system/digest.ts';
import { DUTIES } from '../system/duties.ts';
import { PHASES, PHASE_CAPS, PHASE_KEYS } from '../system/phases.ts';
import { STOCK_LINE_KEYS, STOCK_LINE_TOKENS } from '../system/stock.ts';
import { BEYOND_POST, INT4_MAX, OUTCOMES, PLAYS, RARITIES, REACHES, TRIGGERS, atOrBelow, spanMs } from './cards.ts';
import type { CardRules } from './cards.ts';

/**
 * What a Mod Bot's bribe may cost, in hundredths of an orb, for every bot in every instance: dear enough to be a
 * choice, cheap enough that a character can pay it from a wallet.
 */
export const BRIBE_BOUNDS = { least: 25, most: 500 } as const;

const SPAN_UNITS: readonly Span['unit'][] = ['day', 'week', 'month'];
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
  meetingCron: (v) => (isCron(v) ? null : 'a five-field cron expression, each field inside its range'),
  phases: phasesRule,
  hints: hintsRule,
  toastDefaults: toastDefaultsRule,
  inheritanceGraceDays: whole(0, 'days'),
  rosterRecentExcluded: whole(0, 'Bosses'),
  structuralHoldHours: whole(1, 'hours'),
  microEventDailyCalls: whole(0, 'calls'),
  digestThreads: whole(1, 'threads', DIGEST_MOST.threads),
  digestExcerpts: whole(1, 'posts', DIGEST_MOST.excerpts),
  digestExcerptChars: whole(1, 'characters', DIGEST_MOST.excerptChars),
  memoryOpinions: whole(1, 'opinions'),
  memoryGrudges: whole(1, 'grudges'),
  memoryWheelhouse: whole(1, 'subjects'),
  memoryRealWorld: whole(1, 'subjects'),
  notesRead: whole(1, 'notes'),
  poolCardRarityMost: (v) => (RARITIES.includes(v as never) ? null : 'a rarity: common, uncommon, rare or legendary'),
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
  if (d.avatar !== undefined && (typeof d.avatar !== 'string' || d.avatar.trim() === '')) out.push('the developer avatar is blank; leave it out for none, or name the instance\'s picture');
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
    out.push(...playProblems(c, instance.cards), ...reachProblems(c, instance.settings));
  }
  if (!instance.boards.length) out.push('the instance has no board');
  for (const s of duplicates(instance.boards, (b) => b.slug)) out.push(`board slug "${s}" is used twice`);
  const systems = instance.boards.filter((b) => b.system === true);
  if (!systems.length) out.push('no board is The System\'s: exactly one board sets system: true, where The System posts');
  if (systems.length > 1) out.push(`${systems.length} boards are The System's (${systems.map((b) => b.slug).join(', ')}); exactly one is`);
  if (instance.boards.length && systems.length === instance.boards.length) out.push('the instance has no board for players: every board is The System\'s');
  out.push(...developerProblems(instance.developer));
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
  for (const key of ['turnsThreadTitle', 'revealTitle', 'revealBody'] as const) {
    const words = instance.copy?.[key];
    if (typeof words !== 'string' || words.trim() === '') out.push(`the instance has no copy for ${key}`);
    else if (key !== 'revealBody' && !words.includes('{season}')) out.push(`the copy for ${key} does not say which season ({season})`);
  }
  const settingsSay = settingsProblems(instance.settings);
  out.push(...settingsSay);
  // Every economy number a class or card reads is one the settings hold.
  const economy = instance.settings?.economy;
  if (economy && typeof economy === 'object' && !Array.isArray(economy)) {
    const check = (who: string, read: EconomyRead) => {
      const { key, whole = false, min = undefined } = typeof read === 'string' ? { key: read } : read;
      const n = economy[key];
      if (typeof n !== 'number' || !Number.isFinite(n)) return `${who} reads economy "${key}", which the settings do not hold`;
      if (whole && !Number.isSafeInteger(n)) return `${who} reads economy "${key}" as ${n}; it must be a whole number`;
      if (min !== undefined && n < min) return `${who} reads economy "${key}" as ${n}; it must be at least ${min}`;
      return null;
    };
    for (const c of instance.classes) for (const r of c.reads ?? []) { const why = check(`class "${c.key}"`, r); if (why) out.push(why); }
    for (const c of instance.cards) {
      const price = economy[c.priceKey];
      if (!Number.isSafeInteger(price) || price! <= 0 || price! > INT4_MAX) out.push(`card "${c.key}" is priced by economy "${c.priceKey}", which the settings do not hold as a whole number above 0`);
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

/**
 * A card's rarity, play, trap and ward, each refused naming the card (the card mechanic's design,
 * sections 1 to 5). seed_instance (supabase/migrations/0054_card_plays.sql) holds the same pairings.
 */
function playProblems(c: CardRules, cards: readonly CardRules[]): string[] {
  const out: string[] = [];
  const who = `card "${c.key}"`;
  if (c.rarity === undefined) out.push(`${who} has no rarity; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
  else if (!RARITIES.includes(c.rarity)) out.push(`${who} has the rarity ${JSON.stringify(c.rarity)}; a rarity is ${RARITIES.slice(0, -1).join(', ')} or ${RARITIES.at(-1)}`);
  const play = c.play ?? 'cast';
  if (!PLAYS.includes(play)) out.push(`${who} is played ${JSON.stringify(play)}; a card is cast, used, set or kept`);
  if (play === 'keep') out.push(`${who} is kept, and Keep is not built until it is designed`);
  if (c.trap !== undefined && play !== 'set') out.push(`${who} has a trap, and only a Set card does`);
  if (c.ward !== undefined && play !== 'use') out.push(`${who} is a ward, and only a Use card is`);
  if (c.ward !== undefined && c.ward !== true) out.push(`${who} is a ward of ${JSON.stringify(c.ward)}; a ward is true or left out`);
  if (c.ward === true && play === 'use' && c.lasts === undefined) out.push(`${who} is a ward with no time up (lasts); a ward ends at its time`);
  const beyond = Array.isArray(c.reaches) && c.reaches.some((r) => r !== 'post');
  if (c.lasts !== undefined && play !== 'use' && !beyond) out.push(`${who} has a time up (lasts), and only a Use card or a card reaching beyond a post does`);
  if (c.lasts !== undefined && !isSpan(c.lasts)) out.push(`${who} lasts ${JSON.stringify(c.lasts)}; it must be a span: a unit of day, week or month and a whole count from 1 to 1000`);
  const trap = c.trap;
  if (trap !== undefined) {
    const on = (trap.trigger as { on?: unknown } | undefined)?.on;
    if (!TRIGGERS.includes(on as never)) out.push(`${who} springs on ${JSON.stringify(on)}; a trap springs on ${TRIGGERS.join(', ')}`);
    else if (on === 'visit') out.push(`${who} springs on a visit, which is not wired until the staff build adds Mod Bot visits`);
    else if (on === 'reaction' && !QUADRANTS.includes((trap.trigger as { quadrant?: never }).quadrant!)) out.push(`${who} springs on a reaction of ${JSON.stringify((trap.trigger as { quadrant?: unknown }).quadrant)}, which is no quadrant; it names one of ${QUADRANTS.join(', ')}`);
    const outcome = trap.outcome as { do?: unknown; card?: unknown } | undefined;
    if (!OUTCOMES.includes(outcome?.do as never)) out.push(`${who} does ${JSON.stringify(outcome?.do)} when it springs; a trap does ${OUTCOMES.join(', ')}`);
    else if (outcome!.do === 'payout' && on !== 'cast' && TRIGGERS.includes(on as never)) out.push(`${who} pays out on a ${String(on)}; it pays out only on a cast, since only a cast is paid for`);
    else if (outcome!.do === 'strike' && (on === 'cast' || on === 'reaction')) out.push(`${who} strikes on a ${on}; a strike lays its card on a reply or a quote, until cards reach characters`);
    else if (outcome!.do === 'strike') {
      const struck = cards.find((k) => k.key === outcome!.card);
      if (!struck) out.push(`${who} strikes with ${JSON.stringify(outcome!.card)}, which the instance does not have`);
      else if (RARITIES.includes(struck.rarity) && RARITIES.includes(c.rarity) && !atOrBelow(struck.rarity, c.rarity)) out.push(`${who} strikes with "${struck.key}", which is ${struck.rarity}, rarer than the trap (${c.rarity})`);
    }
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
  if ((c.play ?? 'cast') === 'set' && beyond.length) out.push(`${who} is set face down, and a Set lands only on a post`);
  if (c.pins !== undefined && (c.pins !== true || !c.reaches.includes('thread'))) out.push(`${who} pins ${JSON.stringify(c.pins)}; only a card that reaches a thread pins, and pins is true or left out`);
  if (beyond.length && c.lasts === undefined) out.push(`${who} reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time`);
  const least = settings?.reachRarity;
  const longest = settings?.reachLasts;
  for (const r of beyond) {
    const floor = least?.[r];
    if (RARITIES.includes(floor) && RARITIES.includes(c.rarity) && !atOrBelow(floor, c.rarity)) out.push(`${who} reaches a ${r}, which takes a card of ${floor} or rarer; it is ${c.rarity}`);
    const bound = longest?.[r];
    if (c.lasts !== undefined && isSpan(c.lasts) && bound !== undefined && isSpan(bound) && spanMs(c.lasts) > spanMs(bound)) {
      out.push(`${who} lasts ${spanWords(c.lasts)}, longer than a ${r} effect may (reachLasts.${r}, ${spanWords(bound)})`);
    }
  }
  return out;
}

/** The longest a persona's title and signature may be: what the seed writes into a profile (0043 cuts them in silence). */
export const STAFF_TITLE_MAX = 40;
export const STAFF_SIGNATURE_MAX = 500;

/** Checks of `instance.system`, the content The System reads, each a sentence naming what is wrong. */
function systemProblems(instance: Instance): string[] {
  const sys: SystemContent | undefined = instance.system;
  if (typeof sys !== 'object' || sys === null) return ['the instance has no system content (system)'];
  const out: string[] = [];
  const roster = Array.isArray(sys.roster) ? sys.roster : [];
  if (!roster.length) out.push('the instance\'s roster is empty (system.roster)');
  const rosterKeys = new Set(roster.map((p) => p.key));
  for (const k of duplicates(roster, (p) => p.key)) out.push(`persona key "${k}" is used twice`);
  /* The developer persona's staff key is the engine's (0062): a roster member under it would be the character the persona is seeded as, or be left unmade. */
  if (rosterKeys.has(DEVELOPER_STAFF_KEY)) out.push(`persona key "${DEVELOPER_STAFF_KEY}" is reserved for the developer persona, which a model never plays`);
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  for (const p of roster) {
    const who = `persona "${p.key}"`;
    for (const part of ['name', 'title', 'signature', 'persona', 'startingHobby', 'temperament', 'persuadedBy'] as const) if (!text(p[part])) out.push(`${who} has no ${part}`);
    if (typeof p.title === 'string' && p.title.length > STAFF_TITLE_MAX) out.push(`${who} has a title of ${p.title.length} characters; the seed keeps at most ${STAFF_TITLE_MAX} and cuts the rest in silence`);
    if (typeof p.signature === 'string' && p.signature.length > STAFF_SIGNATURE_MAX) out.push(`${who} has a signature of ${p.signature.length} characters; the seed keeps at most ${STAFF_SIGNATURE_MAX} and cuts the rest in silence`);
    for (const list of ['beats', 'petRules'] as const) if (!Array.isArray(p[list])) out.push(`${who} has no ${list}`);
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
  const groupName = sys.staffGroup?.name;
  if (typeof groupName !== 'string' || groupName.length < 1 || groupName.length > 40) out.push(`staffGroup.name must be 1 to 40 characters (it is ${typeof groupName === 'string' ? groupName.length : 'missing'})`);
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
        if (!STOCK_LINE_TOKENS[key].includes(token!)) out.push(`stock line "${key}" uses {${token}}, which that line is never given (it may use ${STOCK_LINE_TOKENS[key].map((t) => `{${t}}`).join(', ')})`);
      }
    }
  }
  for (const key of Object.keys(sys.stockLines ?? {})) if (!(STOCK_LINE_KEYS as readonly string[]).includes(key)) out.push(`stock line "${key}" is for no standing order`);
  for (const key of ['nameStyle', 'oldVoice'] as const) if (typeof sys[key] !== 'function') out.push(`system.${key} is not a function`);
  if (typeof sys.nameStyleBrief !== 'string' || sys.nameStyleBrief.trim() === '') out.push('system.nameStyleBrief is empty; the meeting\'s prompt needs the name style in words');
  if (typeof sys.announcementsTitle !== 'string' || sys.announcementsTitle.trim() === '') out.push('system.announcementsTitle is empty; the seed makes The System\'s announcements thread from it, and with none no move can land');
  for (const key of ['feeds', 'realWorld', 'wheelhouse'] as const) if (!Array.isArray(sys[key])) out.push(`the instance has no system.${key} list`);
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
