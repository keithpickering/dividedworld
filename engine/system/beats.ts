/**
 * What the meeting does with a persona's arc (fangame split design, sections 1, 2, 3, 5 and 9; the plan, Task 6). Pure, and the engine's: nothing here names a community.
 *
 * **An arc is a secret, even from the Boss.** The database says which beats are unlocked and unplayed (`arc_for_meeting`, 0333); `shownBeats` joins them to the persona's own file by
 * key, so a beat the database does not list never reaches this module with its brief, and `beatsText` is the only place a brief is written into a prompt. A locked beat's brief, key or
 * slot is in no prompt, and a held-back kind is in no list (`meetingSystemPrompt` filters it).
 *
 * **A beat is the Boss's, and the code bounds it.** The Boss answers a beat as `{beat, slots, why}`. A slot is a param the template leaves to the Boss; what the Boss writes there is repaired
 * (a string over its kind's bound is trimmed and recorded, a board's name is held to the instance's name style and `boardNameMaxLength`, a value the template has no slot for is dropped and
 * recorded) and a slot left out, or one that cannot be repaired without inventing content (a name outside the style), is the writer's default, recorded. A beat's bundle is authored: it costs
 * the bank nothing. A due beat the answer leaves out is played with every default, and the record says so.
 *
 * **A beat with no bundle** (a brief that is played with the Boss's ordinary moves) is played by naming it, `{beat, why}`, which costs nothing and carries no parts; until then its brief is shown
 * at every meeting, and it lapses at the season's end if it is never played.
 *
 * Roles in a bundle's parts (`{role}`, or `{role, beat}` for a board an earlier beat's bundle made) name boards that do not exist yet: the engine keeps them as written, and the database
 * resolves them when each part lands. A bundle's parts are queued in dependency order, so a role always names an earlier part.
 */
import type { BundleTemplate, Beat, Persona } from '../rules/types.ts';
import { moveKind, moveParamsProblems, ROLE, UUID, type MachineLimits } from './moves.ts';
import type { PlannedMove } from './meeting.ts';
import { repair, type Rule, type Trim } from './validate.ts';

/** What `meeting_context().arc` says (0334, over arc_for_meeting, 0333): the beats unlocked and not yet played, in the persona's order, and the kinds held back now. */
export interface ArcRead {
  readonly beats: readonly { readonly key: string; readonly mini: boolean; readonly due: boolean }[];
  readonly heldBack: readonly string[];
}

/** A beat the meeting is shown: the persona's own beat, and whether it is past its due point (it "must be played at this meeting"). */
export interface ShownBeat {
  readonly beat: Beat;
  readonly mini: boolean;
  readonly due: boolean;
}

/** A part of a bundle as it is queued: an ordinary move, with its role when another part (or a later beat) names it. */
export interface PlannedPart extends PlannedMove {
  readonly role: string | null;
}

/** A bundle as the meeting queues it. `beat` is the beat it plays (authored: it costs nothing), or null for a bundle the Boss composed (it costs `cost`, one move a part). A beat with no bundle has no parts. */
export interface PlannedBundle {
  readonly name: string;
  readonly beat: string | null;
  readonly parts: readonly PlannedPart[];
  readonly cost: number;
}

/** The owner's words, exactly: nothing else about beats is said in a prompt, and nothing about a beat not yet unlocked. */
export const BEAT_WORDS = 'A beat is yours: an idea you have had. Play it when the board is ready, in your own words.';
export const BUNDLE_WORDS = 'A bundle is for moves that tell one story.';

/** Why a bundle's parts carry when the Boss left a due beat out of its answer. Plain: an admin reads it in the queue. */
export const DUE_WHY = 'This beat was due and the meeting left it out, so it was played with its defaults.';
/** Why a beat's parts carry when the Boss named the beat and gave no reason. */
export const BEAT_WHY = 'The Boss played this beat.';

/** The params of the moves that build the board where a role may stand for a board's uuid, as the guard reads them. */
const BOARD_PARAMS = ['board', 'into', 'fallback'] as const;

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The beats to show: those the database lists (unlocked, unplayed), found by key in the persona's arc and then its mini-arcs, in the database's order. A key the persona does not hold (the
 * instance changed since the seed) is left out. Nothing the database did not list is ever returned: this is where a locked beat stays secret.
 */
export function shownBeats(persona: Pick<Persona, 'arc' | 'miniArcs'>, read: ArcRead | undefined): ShownBeat[] {
  if (!read) return [];
  const out: ShownBeat[] = [];
  for (const r of read.beats) {
    const beat = (persona.arc ?? []).find((b) => b.key === r.key) ?? (persona.miniArcs ?? []).find((b) => b.key === r.key);
    if (beat) out.push({ beat, mini: r.mini, due: r.due });
  }
  return out;
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A slot as the Boss reads it: `role.slot (hint)`. */
const slotsOf = (t: BundleTemplate): string[] =>
  t.parts.flatMap((p) => Object.entries(p.slots ?? {}).map(([name, s]) => `${p.role}.${name} (${oneLine(s.hint)})`));

/**
 * The section of the prompt about beats, or nothing when none is unlocked. The owner's three sentences open it; each beat then follows with its brief, and how to answer it. A due beat
 * says so. Slots are shown with their hints; a part with none shows none.
 */
export function beatsText(beats: readonly ShownBeat[]): string[] {
  if (beats.length === 0) return [];
  const lines = beats.map((b) => {
    const head = `- ${b.beat.key}${b.due ? ' (must be played at this meeting)' : ''}: ${oneLine(b.beat.brief)}`;
    if (!b.beat.bundle) return `${head}\n  Name it in "beats" with {beat: "${b.beat.key}", why} when you have played it.`;
    const slots = slotsOf(b.beat.bundle);
    return `${head}\n  Play it in "beats" with {beat: "${b.beat.key}", slots: [{slot, value}], why}, which plays "${oneLine(b.beat.bundle.name)}". ${slots.length ? `Write each slot you fill as one entry of slots, {slot: "role.slot", value: your words, or a number's digits}, and leave out the ones you do not fill. Its slots: ${slots.join('; ')}.` : 'It has no slots to fill.'}`;
  });
  return [[`${BEAT_WORDS} ${BUNDLE_WORDS}`, ...lines].join('\n')];
}

/* ------------------------------------------------------------------------------------ order ---- */

/** The roles a part's params name from its own bundle (a `{role}` with no beat). */
export function ownRoles(params: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const name of BOARD_PARAMS) {
    const v = record(params[name]);
    if (typeof v['role'] === 'string' && v['beat'] === undefined) out.push(v['role']);
  }
  return out;
}

/**
 * The order to queue parts in: a part after every part whose role it names, the rest as they came. A part that names a role no part makes (or a cycle) is put last, where the repair
 * drops it for the role it lacks. Returns the original indexes; `moved` says whether the order is not the one given.
 */
export function dependencyOrder(parts: readonly { readonly role: string | null; readonly makes: boolean; readonly needs: readonly string[] }[]): { readonly order: number[]; readonly moved: boolean } {
  const order: number[] = [];
  const left = parts.map((_, i) => i);
  const made = new Set<string>();
  while (left.length) {
    const at = left.findIndex((i) => parts[i]!.needs.every((r) => made.has(r)));
    if (at < 0) break;
    const [i] = left.splice(at, 1);
    order.push(i!);
    if (parts[i!]!.makes && parts[i!]!.role !== null) made.add(parts[i!]!.role!);
  }
  order.push(...left);
  return { order, moved: order.some((x, k) => x !== k) };
}

/* ------------------------------------------------------------------------------------- fill ---- */

export interface FillContext {
  /** Epoch milliseconds. */
  readonly now: number;
  readonly structuralHoldHours: number;
  /** `Settings.boardNameMaxLength`, and the instance's name style (problems found in a name; none: it is in the style). */
  readonly nameMax: number;
  readonly nameStyle: (name: string) => readonly string[];
  readonly limits: MachineLimits;
  /** The boards and threads the meeting was given, which a slot that names one is held to. */
  readonly boards: ReadonlySet<string>;
  readonly threads: ReadonlySet<string>;
}

export type Filled =
  | { readonly ok: true; readonly parts: readonly PlannedPart[]; readonly trims: readonly Trim[] }
  | { readonly ok: false; readonly path: string; readonly predicate: string; readonly trims: readonly Trim[] };

const BOARD_NAMED = new Set(['createBoard', 'renameBoard']);
const HOUR = 3_600_000;

/**
 * An authored bundle's parts from its template and the Boss's slots, at `at` (the answer's path for the beat, for the record). The writer's params are the writer's; a slot is the Boss's value
 * where it can be used and the template's default where it cannot. A part is queued at once (a structural one waits the admin hold), lasting, with no expiry and no demand: a part of any other
 * kind cannot be built from a template, and fails the whole bundle, naming it.
 */
export function fillBundle(template: BundleTemplate, slots: unknown, why: string, c: FillContext, at: string): Filled {
  const trims: Trim[] = [];
  const answered = record(slots);
  const roles = new Set(template.parts.map((p) => p.role));
  for (const [role, given] of Object.entries(answered)) {
    if (!roles.has(role) || Object.keys(template.parts.find((p) => p.role === role)?.slots ?? {}).length === 0) {
      trims.push({ path: `${at}.slots.${role}`, predicate: 'isSlot', before: 1, after: 0 });
      continue;
    }
    for (const name of Object.keys(record(given))) {
      if (!(name in (template.parts.find((p) => p.role === role)!.slots ?? {}))) trims.push({ path: `${at}.slots.${role}.${name}`, predicate: 'isSlot', before: 1, after: 0 });
    }
  }
  const parts: PlannedPart[] = [];
  for (const part of template.parts) {
    const kind = moveKind(part.kind);
    if (!kind || !kind.askable || !kind.offices.includes('boss') || !kind.lasting) return { ok: false, path: `${at}.parts.${part.role}.kind`, predicate: 'lastingKind', trims };
    const params: Record<string, unknown> = { ...part.params };
    const given = record(answered[part.role]);
    for (const [name, slot] of Object.entries(part.slots ?? {})) {
      const path = `${at}.slots.${part.role}.${name}`;
      const asked = given[name];
      let value: unknown = slot.default;
      if (asked !== undefined && asked !== null) {
        const usable = slotValue(asked, slot.default, kind.key, name, kind.params, c, path, trims);
        if (usable !== undefined) value = usable;
      }
      params[name] = value;
    }
    const checked = moveParamsProblems(kind.key, params, c.limits, true);
    if (!checked.ok) return { ok: false, path: `${at}.parts.${part.role}.${checked.path}`, predicate: checked.predicate, trims: [...trims, ...checked.trims.map((t) => ({ ...t, path: `${at}.parts.${part.role}.${t.path}` }))] };
    trims.push(...checked.trims.map((t) => ({ ...t, path: `${at}.parts.${part.role}.${t.path}` })));
    parts.push({
      role: part.role,
      kind: kind.key,
      params: checked.value as Record<string, unknown>,
      demand: null,
      goLiveAt: kind.structural ? c.now + c.structuralHoldHours * HOUR : c.now,
      expiresInHours: 0,
      why,
      structural: kind.structural,
    });
  }
  return { ok: true, parts, trims };
}

/**
 * One slot's value from what the Boss wrote, or undefined where it cannot be used and the default stands (recorded). A string over its kind's bound is trimmed and recorded; a board's name is
 * cut to `boardNameMaxLength` (recorded) and then must be in the name style, or the default stands, since a name is never corrected; a board or thread must be one the meeting was given.
 */
function slotValue(asked: unknown, fallback: unknown, kind: string, name: string, rule: Rule, c: FillContext, path: string, trims: Trim[]): unknown {
  const miss = (predicate: string): undefined => {
    trims.push({ path, predicate, before: 1, after: 0 });
    return undefined;
  };
  if (typeof fallback === 'number') {
    // A number is written as its digits where the schema asks for text: read as the number the slot wants, and recorded.
    if (typeof asked === 'string' && /^-?\d+(\.\d+)?$/.test(asked.trim())) {
      trims.push({ path, predicate: 'asNumber', before: asked.length, after: 1 });
      return Number(asked.trim());
    }
    return typeof asked === 'number' && Number.isFinite(asked) ? asked : miss('isNumber');
  }
  if (typeof asked !== 'string') return miss('isString');
  if (asked.trim() === '') return miss('nonEmpty');
  let value = asked;
  const field = rule.type === 'object' ? rule.fields[name] : undefined;
  if (field?.type === 'string') {
    const cut = repair(value, field);
    if (cut.ok) {
      trims.push(...cut.trims.map((t) => ({ ...t, path })));
      value = cut.value as string;
    }
  }
  if (BOARD_NAMED.has(kind) && name === 'name') {
    if (value.length > c.nameMax) {
      trims.push({ path, predicate: `atMost(${c.nameMax})`, before: value.length, after: c.nameMax });
      value = value.slice(0, c.nameMax);
    }
    if (c.nameStyle(value).length) return miss('nameStyle');
  }
  if (name === 'board' || name === 'into' || name === 'fallback') {
    if (!UUID.test(value) || !c.boards.has(value.toLowerCase())) return miss('isBoard');
    return value.toLowerCase();
  }
  if (name === 'thread') {
    if (!UUID.test(value) || !c.threads.has(value.toLowerCase())) return miss('isThread');
    return value.toLowerCase();
  }
  return value;
}

/** A role is a key; the guard holds the same. */
export const isRoleName = (v: unknown): v is string => typeof v === 'string' && ROLE.test(v);
