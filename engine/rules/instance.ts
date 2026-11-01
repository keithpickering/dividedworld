/**
 * What makes an instance whole: the checks the engine runs on what an instance hands it,
 * before it is trusted to settle anything. Each returns problems as sentences; [] is whole.
 */
import { QUADRANTS } from './types.ts';
import type { EconomyRead, Instance, Settings, QuizQuestion, Span, StaffSeed, SystemContent } from './types.ts';
import { DUTIES } from '../system/duties.ts';
import { PHASES, PHASE_CAPS, PHASE_KEYS } from '../system/phases.ts';
import { STOCK_LINE_KEYS, STOCK_LINE_TOKENS } from '../system/stock.ts';
import { INT4_MAX } from './cards.ts';

/**
 * What a Mod Bot's bribe may cost, in hundredths of an orb, for every bot in every instance: dear enough to be a
 * choice, cheap enough that a character can pay it from a wallet.
 */
export const BRIBE_BOUNDS = { least: 25, most: 500 } as const;

const SPAN_UNITS: readonly Span['unit'][] = ['day', 'week', 'month'];
/** A grace may be minutes long (editGrace); nothing else is. */
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
const whole = (min: number, what: string) => (v: unknown): string | null => (isWhole(v, min) ? null : `a whole number of ${what}, at least ${min}`);

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
  economy: namedNumbers,
  cardSettings: namedNumbers,
  systemEnabled: (v) => (typeof v === 'boolean' ? null : 'true or false'),
  meetingCron: (v) => (isCron(v) ? null : 'a five-field cron expression, each field inside its range'),
  phases: phasesRule,
  inheritanceGraceDays: whole(0, 'days'),
  rosterRecentExcluded: whole(0, 'Bosses'),
  structuralHoldHours: whole(1, 'hours'),
  microEventDailyCalls: whole(0, 'calls'),
  digestThreads: whole(1, 'threads'),
  digestExcerpts: whole(1, 'posts'),
  digestExcerptChars: whole(1, 'characters'),
  memoryOpinions: whole(1, 'opinions'),
  memoryGrudges: whole(1, 'grudges'),
  memoryWheelhouse: whole(1, 'subjects'),
  memoryRealWorld: whole(1, 'subjects'),
  boardNameMaxLength: whole(1, 'characters'),
  moveExpiryMostDays: whole(1, 'days'),
  moveExpiryLeastHours: whole(1, 'hours'),
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
  }
  if (!instance.boards.length) out.push('the instance has no board');
  for (const s of duplicates(instance.boards, (b) => b.slug)) out.push(`board slug "${s}" is used twice`);
  const systems = instance.boards.filter((b) => b.system === true);
  if (!systems.length) out.push('no board is The System\'s: exactly one board sets system: true, where The System posts');
  if (systems.length > 1) out.push(`${systems.length} boards are The System's (${systems.map((b) => b.slug).join(', ')}); exactly one is`);
  if (instance.boards.length && systems.length === instance.boards.length) out.push('the instance has no board for players: every board is The System\'s');
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

/** The longest a Boss's or bot's title and signature may be: what the seed writes into a profile (0042 cuts them in silence). */
export const STAFF_TITLE_MAX = 40;
export const STAFF_SIGNATURE_MAX = 500;

/** Checks of `instance.system`, the content The System reads, each a sentence naming what is wrong. */
function systemProblems(instance: Instance): string[] {
  const sys: SystemContent | undefined = instance.system;
  if (typeof sys !== 'object' || sys === null) return ['the instance has no system content (system)'];
  const out: string[] = [];
  const bosses = Array.isArray(sys.bosses) ? sys.bosses : [];
  const bots = Array.isArray(sys.modBots) ? sys.modBots : [];
  if (!Array.isArray(sys.bosses) || !bosses.length) out.push('the instance has no Boss in its roster (system.bosses)');
  if (!Array.isArray(sys.modBots) || !bots.length) out.push('the instance has no Mod Bot in its roster (system.modBots)');
  const staff = (who: string, s: StaffSeed, persona: unknown) => {
    for (const part of ['name', 'title', 'signature'] as const) if (typeof s[part] !== 'string' || s[part].trim() === '') out.push(`${who} "${s.key}" has no ${part}`);
    if (typeof persona !== 'string' || persona.trim() === '') out.push(`${who} "${s.key}" has no persona`);
    if (typeof s.title === 'string' && s.title.length > STAFF_TITLE_MAX) out.push(`${who} "${s.key}" has a title of ${s.title.length} characters; the seed keeps at most ${STAFF_TITLE_MAX} and cuts the rest in silence`);
    if (typeof s.signature === 'string' && s.signature.length > STAFF_SIGNATURE_MAX) out.push(`${who} "${s.key}" has a signature of ${s.signature.length} characters; the seed keeps at most ${STAFF_SIGNATURE_MAX} and cuts the rest in silence`);
  };
  for (const k of duplicates(bosses, (b) => b.key)) out.push(`Boss key "${k}" is used twice`);
  for (const k of duplicates(bots, (b) => b.key)) out.push(`Mod Bot key "${k}" is used twice`);
  const bossKeys = new Set(bosses.map((b) => b.key));
  const botKeys = new Set(bots.map((b) => b.key));
  for (const k of bossKeys) if (botKeys.has(k)) out.push(`"${k}" is both a Boss and a Mod Bot; a staff key is one or the other`);
  for (const b of bosses) {
    staff('Boss', b, b.persona);
    if (typeof b.startingHobby !== 'string' || b.startingHobby.trim() === '') out.push(`Boss "${b.key}" has no startingHobby`);
    if (typeof b.temperament !== 'string' || b.temperament.trim() === '') out.push(`Boss "${b.key}" has no temperament`);
    if (b.inheritsMemoryOf !== undefined && (b.inheritsMemoryOf === b.key || !bossKeys.has(b.inheritsMemoryOf))) out.push(`Boss "${b.key}" inherits the memory of "${b.inheritsMemoryOf}", who is not another Boss in the roster`);
    for (const p of PHASES) {
      const given = b.phases?.[p] as Record<string, unknown> | undefined;
      for (const key of Object.keys(given ?? {})) {
        const n = given![key];
        const cap = (PHASE_CAPS[p] as unknown as Record<string, number>)[key];
        if (cap === undefined) out.push(`Boss "${b.key}" overrides ${p} ${key}, which is not a number that phase holds`);
        else if (!isWhole(n, 1) || n > cap) out.push(`Boss "${b.key}" overrides ${p} ${key} as ${JSON.stringify(n)}; it must be a whole number from 1 to ${cap} (the engine's cap)`);
      }
    }
  }
  for (const b of bots) {
    staff('Mod Bot', b, b.persona);
    const w = b.weakness;
    const who = `Mod Bot "${b.key}"`;
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
    if (b.voice !== 'chat' && b.voice !== 'oldVoice') out.push(`${who} has the voice ${JSON.stringify(b.voice)}; a voice is "chat" or "oldVoice"`);
    const v = b.strictness?.visitHours;
    if (!v || !isWhole(v.least, 1) || !isWhole(v.most, 1) || v.least > v.most) out.push(`${who} has visit hours that are not a whole least and most, the least at least 1 and no more than the most`);
  }
  if (bosses.length && !bossKeys.has(sys.firstBoss)) out.push(`firstBoss "${sys.firstBoss}" is not a Boss in the roster`);
  if (!Array.isArray(sys.firstStaff) || !sys.firstStaff.length) out.push('firstStaff names no Mod Bot; at least one bot is on staff from the start');
  else for (const k of sys.firstStaff) if (!botKeys.has(k)) out.push(`firstStaff names "${k}", which is not a Mod Bot in the roster`);
  const duties = sys.duties ?? ({} as SystemContent['duties']);
  for (const d of DUTIES) {
    const who = duties[d];
    if (typeof who !== 'string' || who === '') out.push(`duty "${d}" is assigned to no one`);
    else if (who !== 'boss' && who !== 'beat' && who !== 'filer' && !bossKeys.has(who) && !botKeys.has(who)) out.push(`duty "${d}" is assigned to "${who}", who is not "boss", "beat", "filer" or a staff member in the roster`);
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
  for (const key of ['feeds', 'realWorld', 'wheelhouse'] as const) if (!Array.isArray(sys[key])) out.push(`the instance has no system.${key} list`);
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
