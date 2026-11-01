/**
 * What the meeting asks of the model and what it makes of the answer (system design, sections 2, 4 and 6; the system plan,
 * Task 9). The meeting is one structured call: the Boss reads the digest and its memory, and answers with its new memory, its
 * new profile and the moves it makes. This file holds the engine's side of that call, pure, so supabase/functions/meet/core.ts
 * only moves data between the database, the model and here:
 *
 * - the rule and the JSON schema the answer follows, built from the catalogs of moves and demands (one list each, moves.ts and
 *   demands.ts), so a kind added to a catalog is in the schema with no edit here;
 * - the system prompt and the user message, composed from the instance's text (its Boss's persona, its name style in words)
 *   and the engine's own (the phase and its numbers, the bank, the rules of the answer, the catalogs). The engine names no
 *   community;
 * - `repairAnswer`, step 4 of the plan: every bound a model overshoots by a little is trimmed, and every change is
 *   recorded as a Trim.
 *
 * The principle ("A validator tighter than the schema is a place a paid answer goes to die"): the answer is rejected only for
 * what cannot be repaired without inventing content (a missing memory, a wrong type). A move that is not allowed (a kind or a
 * demand outside the catalogs, a name outside the style, a board that is not a board) is dropped and recorded, never rewritten:
 * a model's free text is shown, never acted on, so nothing in it becomes a different move. Moves past the bank are cut from
 * the end. Times are clamped into what the settings allow.
 *
 * `successor` and `inherited` are the handover's (Task 12b) and are repaired here and carried in the result; their effects
 * are the handover's. A successor named before the meltdown's last week is dropped and recorded.
 *
 * Pure: nothing here reads a clock or a database; the caller passes `now`.
 */
import type { BossPersona, Settings, SystemContent } from '../rules/types.ts';
import { DEMAND_KINDS, demandProblems } from './demands.ts';
import { MEMORY_RULE, repairMemory, type Memory } from './memory.ts';
import { MOVE_KINDS, UUID, moveKind, moveParamsProblems } from './moves.ts';
import type { PhaseAt } from './phases.ts';
import { repair, type Rule, type Trim } from './validate.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The most a move may be asked to wait before it lands, after which it is clamped: a day. */
export const GO_LIVE_MOST_MS = DAY;
/** The meltdown's last stretch, in which a Boss may name its successor. */
export const SUCCESSOR_WINDOW_MS = 7 * DAY;

/** What a profile holds, and so the most the answer's lists and strings are cut to. */
export const PROFILE_MOST = { interests: 8, interest: 40, favorites: 6, mood: 80, signature: 500 } as const;
/** The most inheritance answers kept: a season's rename moves are few, and a model naming hundreds is not meaning them. */
export const INHERITED_MOST = 20;
/** Characters of a move's reason kept: queued_moves.why. */
export const WHY_MOST = 200;

/* --------------------------------------------------------------------------------- the rule ---- */

/** The params any move kind or demand kind names, as one object of optional fields; a model fills only the ones its kind needs. */
function looseFields(rules: readonly Rule[], leave: readonly string[] = []): Record<string, Rule> {
  const out: Record<string, Rule> = {};
  for (const rule of rules) {
    if (rule.type !== 'object') continue;
    for (const [name, sub] of Object.entries(rule.fields)) {
      if (leave.includes(name) || out[name]) continue;
      // An enum reaches the model as a string it is told the values of; a value outside is the catalog's to refuse.
      out[name] = sub.type === 'number' ? { type: 'number', optional: true } : { type: 'string', maxLength: 500, optional: true };
    }
  }
  return out;
}

/** The fields a model fills for a move: the kind's params less `description`, which the old voice writes. */
const MODEL_LEAVES = ['description'];

const paramsRule = (): Rule => ({ type: 'object', fields: looseFields(MOVE_KINDS.map((k) => k.params), MODEL_LEAVES) });
const demandRule = (): Rule => ({
  type: 'object',
  fields: { kind: { type: 'string', maxLength: 60 }, params: { type: 'object', fields: looseFields(DEMAND_KINDS.map((d) => d.params)) } },
});

/**
 * The rule the answer is repaired against, by the model adapter and again by the meeting. A list has no `max` here on purpose:
 * a list the model overshoots is cut by the meeting, and recorded, where it knows the bound (the bank, a setting), and a
 * rule's own cap would reject an answer more than two over its bound.
 */
export const MEETING_RULE: Rule = {
  type: 'object',
  fields: {
    memory: MEMORY_RULE,
    profile: {
      type: 'object',
      fields: {
        interests: { type: 'list', of: { type: 'string', maxLength: PROFILE_MOST.interest, minLength: 1 } },
        favorites: { type: 'list', of: { type: 'string', maxLength: 64 } },
        mood: { type: 'string', maxLength: PROFILE_MOST.mood },
        signature: { type: 'string', maxLength: PROFILE_MOST.signature },
      },
    },
    moves: {
      type: 'list',
      of: {
        type: 'object',
        fields: {
          kind: { type: 'string', maxLength: 60 },
          params: paramsRule(),
          demand: demandRule(),
          go_live_at: { type: 'string', maxLength: 64 },
          expires_in_hours: { type: 'number' },
          why: { type: 'string', maxLength: WHY_MOST, minLength: 1 },
        },
      },
    },
    inherited: {
      type: 'list',
      optional: true,
      of: { type: 'object', fields: { move_act: { type: 'string', maxLength: 64 }, decision: { type: 'enum', values: ['keep', 'end'] } } },
    },
    successor: { type: 'object', optional: true, fields: { boss: { type: 'string', maxLength: 80 }, why: { type: 'string', maxLength: WHY_MOST, minLength: 1 } } },
  },
};

/** A rule as the JSON schema a provider's structured output takes: types, properties and requireds, none of the bounds it cannot express. */
export function ruleSchema(rule: Rule): Record<string, unknown> {
  switch (rule.type) {
    case 'string': return { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'enum': return { type: 'string', enum: [...rule.values] };
    case 'list': return { type: 'array', items: ruleSchema(rule.of) };
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(Object.entries(rule.fields).map(([k, v]) => [k, ruleSchema(v)])),
        required: Object.entries(rule.fields).filter(([, v]) => !v.optional).map(([k]) => k),
        additionalProperties: false,
      };
  }
}

/* ------------------------------------------------------------------------------- the prompt ---- */

const fieldsOf = (rule: Rule, leave: readonly string[] = []): string =>
  rule.type === 'object'
    ? Object.entries(rule.fields).filter(([k]) => !leave.includes(k)).map(([k, v]) => `${k} (${v.type === 'enum' ? v.values.join(' | ') : v.type === 'number' ? 'number' : 'text'})`).join(', ')
    : '';

export interface PromptFacts {
  readonly boss: BossPersona;
  readonly system: Pick<SystemContent, 'nameStyleBrief' | 'realWorld'>;
  readonly settings: Pick<Settings, 'structuralHoldHours' | 'boardNameMaxLength' | 'moveExpiryLeastHours' | 'reactionCap' | 'memoryOpinions' | 'memoryGrudges' | 'memoryWheelhouse' | 'memoryRealWorld' | 'moveExpiryMostDays'>;
  readonly phase: PhaseAt;
  readonly bank: number;
  /** Whether this is the meltdown's last week, in which a successor may be named. */
  readonly successorAllowed: boolean;
  readonly roster: readonly { readonly key: string; readonly name: string }[];
}

/**
 * The system prompt: the Boss's persona (which the instance built on its shared premise), then what this meeting allows. The
 * numbers are the engine's, the words about them too; a persona that wants a different voice for them has the persona.
 */
export function meetingSystemPrompt(f: PromptFacts): string {
  const whole = Math.floor(f.bank);
  const { settings: s, phase } = f;
  const kinds = MOVE_KINDS.map(
    (k) => `- ${k.key}: ${k.label.toLowerCase()}. params: ${fieldsOf(k.params, MODEL_LEAVES)}.${k.structural ? ` It waits at least ${s.structuralHoldHours} hours in the admin queue before it lands, and an admin can hold it.` : ''}`,
  );
  const demands = DEMAND_KINDS.map((d) => `- ${d.key}: params: ${fieldsOf(d.params)}.`);
  return [
    f.boss.persona,
    [
      'This meeting.',
      `Phase: ${phase.phase}. You earn ${phase.numbers.weeklyMoves} moves a week and can bank ${phase.numbers.bankCap}; a move of this phase runs at most ${phase.numbers.moveExpiryMostDays} days.`,
      `Your bank is ${f.bank.toFixed(2)}, so you may make ${whole} move${whole === 1 ? '' : 's'} now. Make fewer, or none, if nothing deserves one: unspent moves keep. Order your moves most important first; any past your bank are cut from the end.`,
      ...(phase.clamps.length ? [`Some of your own curve was cut to what every Boss may have: ${phase.clamps.map((c) => `${c.path} ${c.before} became ${c.after}`).join('; ')}.`] : []),
    ].join('\n'),
    [
      'The moves you may make (anything else is dropped):',
      ...kinds,
      `A move's go_live_at is a time (ISO 8601) from now to a day from now; a structural move is held at least ${s.structuralHoldHours} hours whatever you ask. Its expires_in_hours is from ${s.moveExpiryLeastHours} hours to ${Math.min(phase.numbers.moveExpiryMostDays, s.moveExpiryMostDays) * 24} hours. Its why is one line, at most ${WHY_MOST} characters, in your own words; the admins read it.`,
    ].join('\n'),
    [
      'Every move carries a demand the characters can meet, and the move ends when it is met or when it expires. The demands you may set (anything else drops the move):',
      ...demands,
      `Use only the ids you are given below for boards, threads and characters. A count is a whole number of at least 1. A reaction threshold (a quadrant's count, a crossQuote's reactions) is at least ${s.reactionCap + 1}.`,
    ].join('\n'),
    `Board names. ${f.system.nameStyleBrief} A renameBoard name is at most ${s.boardNameMaxLength} characters; its premise is a sentence saying what the board is now for. A name that is not in the style is dropped, not corrected.`,
    [
      'Your memory. Your answer is your whole new memory: what you leave out is forgotten. Order every list most important first.',
      `You keep at most ${s.memoryOpinions} opinions, ${s.memoryGrudges} grudges, ${s.memoryWheelhouse} wheelhouse subjects and ${s.memoryRealWorld} real-world subjects; the rest are cut from the end. Opinions and grudges name characters by the ids you are given, scored -5 to 5. Leave alone these subjects, and add to them: ${f.system.realWorld.join('; ')}.`,
      `Your profile: up to ${PROFILE_MOST.interests} interests, up to ${PROFILE_MOST.favorites} favorite characters (their ids), a mood and a signature. It is public and in your voice.`,
    ].join('\n'),
    ...(f.successorAllowed
      ? [`The season is in its last week. If you want, name your successor: successor {boss, why}, where boss is one of these keys and not your own: ${f.roster.map((r) => `${r.key} (${r.name})`).join('; ')}. An admin can hold or replace it.`]
      : ['Do not answer with a successor.']),
    'Answer only in the structure you are asked for.',
  ].join('\n\n');
}

export interface ReferenceIds {
  readonly boards: readonly { readonly id: string; readonly name: string }[];
  readonly threads: readonly { readonly id: string; readonly title: string }[];
  readonly characters: readonly { readonly id: string; readonly name: string }[];
}

/** How many of each id the meeting hands the model: the lists are bounded here, whatever the instance holds. */
export const REFERENCE_MOST = { boards: 50, threads: 25, characters: 80 } as const;

const oneLine = (s: string, n: number): string => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** The ids the model may name, beside the digest (which shows names only). */
export function referenceText(ids: ReferenceIds): string {
  const part = (title: string, rows: readonly string[], none: string): string[] => ['', `## ${title}`, ...(rows.length ? rows : [none])];
  return [
    '# Ids you may use',
    ...part('Boards', ids.boards.slice(0, REFERENCE_MOST.boards).map((b) => `- ${oneLine(b.name, 80)}: ${b.id}`), 'No board.'),
    ...part('Hot threads', ids.threads.slice(0, REFERENCE_MOST.threads).map((t) => `- ${oneLine(t.title, 80)}: ${t.id}`), 'No thread.'),
    ...part('Characters', ids.characters.slice(0, REFERENCE_MOST.characters).map((c) => `- ${oneLine(c.name, 64)}: ${c.id}`), 'No character.'),
  ].join('\n');
}

/* ------------------------------------------------------------------------------- the repair ---- */

export interface PlannedMove {
  readonly kind: string;
  /** Without `description`: the old voice writes it, and the stock description stands in when it cannot. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: { readonly kind: string; readonly params: Readonly<Record<string, unknown>> };
  /** Epoch milliseconds, clamped (and, for a structural move, raised to the hold). */
  readonly goLiveAt: number;
  readonly expiresInHours: number;
  readonly why: string;
  readonly structural: boolean;
}

export interface Profile {
  readonly interests: readonly string[];
  readonly favorites: readonly string[];
  readonly mood: string;
  readonly signature: string;
}

export interface RepairContext {
  readonly settings: Settings;
  readonly system: Pick<SystemContent, 'nameStyle' | 'bosses'>;
  /** The season's Boss. */
  readonly boss: string;
  readonly phase: PhaseAt;
  /** `bank_now`: the moves the Boss may make are its floor. */
  readonly bank: number;
  /** Epoch milliseconds. */
  readonly now: number;
  /** The ids of the boards that exist and are not The System's own. */
  readonly boards: ReadonlySet<string>;
  /** Whether a character is debuted and public now, from `public_characters`. */
  readonly isPublic: (character: string) => boolean;
  readonly successorAllowed: boolean;
}

export interface RepairedAnswer {
  readonly memory: Memory;
  readonly profile: Profile;
  readonly moves: readonly PlannedMove[];
  readonly inherited: readonly { readonly move_act: string; readonly decision: 'keep' | 'end' }[];
  readonly successor: { readonly boss: string; readonly why: string } | null;
  readonly trims: readonly Trim[];
}

export type RepairResult = ({ readonly ok: true } & RepairedAnswer) | { readonly ok: false; readonly path: string; readonly predicate: string; readonly trims: readonly Trim[] };

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Every character id the answer names, in its memory and its profile: what the meeting asks the database about before it repairs. */
export function namedCharacters(raw: unknown): string[] {
  const a = record(raw);
  const ids = new Set<string>();
  const memory = record(a['memory']);
  for (const list of [memory['opinions'], memory['grudges']]) {
    if (Array.isArray(list)) for (const e of list) if (typeof record(e)['character'] === 'string') ids.add(record(e)['character'] as string);
  }
  const fav = record(a['profile'])['favorites'];
  if (Array.isArray(fav)) for (const f of fav) if (typeof f === 'string') ids.add(f);
  return [...ids].filter((id) => UUID.test(id));
}

export function repairAnswer(raw: unknown, c: RepairContext): RepairResult {
  const shaped = repair(raw, MEETING_RULE);
  if (!shaped.ok) return shaped;
  const trims: Trim[] = [...shaped.trims];
  const a = shaped.value as Record<string, unknown>;
  const drop = (path: string, predicate: string): void => void trims.push({ path, predicate, before: 1, after: 0 });
  const s = c.settings;

  const memory = repairMemory(a['memory'], c.isPublic, s);
  if (!memory.ok) return { ok: false, path: `memory.${memory.path}`, predicate: memory.predicate, trims: [...trims, ...memory.trims] };
  // The memory was shaped (its strings trimmed) above; what repairMemory adds is the characters it dropped, the scores it clamped and the lists it cut.
  trims.push(...memory.trims.map((t) => ({ ...t, path: t.path ? `memory.${t.path}` : 'memory' })));

  const cut = <T,>(path: string, list: readonly T[], most: number): T[] => {
    if (list.length <= most) return [...list];
    trims.push({ path, predicate: `atMost(${most})`, before: list.length, after: most });
    return list.slice(0, most);
  };
  const p = record(a['profile']);
  const favorites: string[] = [];
  (p['favorites'] as string[]).forEach((f, i) => {
    if (!UUID.test(f) || !c.isPublic(f)) drop(`profile.favorites[${i}]`, 'publicCharacter');
    else if (!favorites.includes(f)) favorites.push(f);
  });
  const profile: Profile = {
    interests: cut('profile.interests', p['interests'] as string[], PROFILE_MOST.interests),
    favorites: cut('profile.favorites', favorites, PROFILE_MOST.favorites),
    mood: p['mood'] as string,
    signature: p['signature'] as string,
  };

  // Moves: what is not allowed is dropped first, then the bank cuts from the end, so a dropped move costs the Boss nothing.
  const phaseLeast = s.moveExpiryLeastHours;
  const expiryMost = Math.min(c.phase.numbers.moveExpiryMostDays, s.moveExpiryMostDays) * 24;
  const kept: PlannedMove[] = [];
  (a['moves'] as Record<string, unknown>[]).forEach((m, i) => {
    const path = `moves[${i}]`;
    const kind = moveKind(String(m['kind']));
    if (!kind) return drop(`${path}.kind`, `oneOf(${MOVE_KINDS.map((k) => k.key).join(', ')})`);
    const demand = demandProblems(m['demand'], s.reactionCap);
    if (!demand.ok) return drop(`${path}.${demand.path}`, demand.predicate);
    // The kind's shape, with a stand-in for the description the old voice writes later.
    const params = moveParamsProblems(kind.key, { ...record(m['params']), description: '-' });
    if (!params.ok) return drop(`${path}.params.${params.path}`, params.predicate);
    const given = { ...(params.value as Record<string, unknown>) };
    delete given['description'];
    if (kind.key === 'renameBoard') {
      const name = String(given['name']);
      const style = c.system.nameStyle(name);
      if (style.length) return drop(`${path}.params.name`, 'nameStyle');
      if (name.length > s.boardNameMaxLength) return drop(`${path}.params.name`, `atMost(${s.boardNameMaxLength})`);
      if (!c.boards.has(String(given['board']))) return drop(`${path}.params.board`, 'isBoard');
    }
    // Times. A go-live that is not a time is now; one outside now..a day is moved to the nearer end.
    let goLive = Date.parse(String(m['go_live_at']));
    const asked = Number.isNaN(goLive) ? c.now : goLive;
    goLive = Math.min(Math.max(asked, c.now), c.now + GO_LIVE_MOST_MS);
    if (goLive !== asked || Number.isNaN(Date.parse(String(m['go_live_at'])))) trims.push({ path: `${path}.go_live_at`, predicate: `between(now, now + ${GO_LIVE_MOST_MS / HOUR}h)`, before: asked, after: goLive });
    if (kind.structural) {
      const least = c.now + s.structuralHoldHours * HOUR;
      if (goLive < least) {
        trims.push({ path: `${path}.go_live_at`, predicate: `atLeast(${s.structuralHoldHours}h hold)`, before: goLive, after: least });
        goLive = least;
      }
    }
    const hours = m['expires_in_hours'] as number;
    const expires = Math.min(Math.max(hours, phaseLeast), expiryMost);
    if (expires !== hours) trims.push({ path: `${path}.expires_in_hours`, predicate: `between(${phaseLeast}, ${expiryMost})`, before: hours, after: expires });
    kept.push({
      kind: kind.key,
      params: given,
      demand: demand.value as PlannedMove['demand'],
      goLiveAt: goLive,
      expiresInHours: expires,
      why: m['why'] as string,
      structural: kind.structural,
    });
    trims.push(...params.trims.map((t) => ({ ...t, path: `${path}.params.${t.path}` })), ...demand.trims.map((t) => ({ ...t, path: `${path}.demand.${t.path}` })));
  });
  const affordable = Math.max(0, Math.floor(c.bank));
  const moves = cut('moves', kept, affordable);

  // Inheritance answers (the handover's, Task 12b): a move named by a uuid, a decision of keep or end, each move once.
  const inherited: { move_act: string; decision: 'keep' | 'end' }[] = [];
  ((a['inherited'] ?? []) as Record<string, unknown>[]).forEach((e, i) => {
    const act = String(e['move_act']);
    if (!UUID.test(act)) return drop(`inherited[${i}].move_act`, 'isUuid');
    if (inherited.some((x) => x.move_act === act)) return drop(`inherited[${i}]`, 'uniqueMove');
    inherited.push({ move_act: act, decision: e['decision'] as 'keep' | 'end' });
  });

  // A successor: only in the meltdown's last week, a roster Boss, not the outgoing one.
  let successor: RepairedAnswer['successor'] = null;
  if (a['successor'] !== undefined) {
    const given = a['successor'] as { boss: string; why: string };
    if (!c.successorAllowed) drop('successor', 'inMeltdownLastWeek');
    else if (!c.system.bosses.some((b) => b.key === given.boss)) drop('successor.boss', 'rosterBoss');
    else if (given.boss === c.boss) drop('successor.boss', 'notTheOutgoingBoss');
    else successor = given;
  }

  return { ok: true, memory: memory.memory, profile, moves, inherited: cut('inherited', inherited, INHERITED_MOST), successor, trims };
}
