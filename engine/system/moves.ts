/**
 * The moves The System can make (system design, section 3; the system plan, Task 8): a fixed catalog the code maps to effects
 * with limits. A model proposes a move by key and params; a key outside this list is not a move (the meeting
 * drops it and records it), and a model's free text is never read as a choice. The catalog is seeded into `move_kinds` by `seed_instance`
 * (supabase/functions/_shared/seed.ts reads it), so SQL and TypeScript read one list ("Two lists that must agree are one list").
 *
 * Part 1 holds two moves. `renameBoard` is structural (design, section 7): it waits in the admin queue about a day before it
 * lands and lands unless an admin holds it. `nameSuccessor` (the handover, Task 12b) is the Boss's pick of the next Boss: structural
 * too, so it waits the same way, with no demand and no expiry; the meeting queues it from the answer's `successor`, never from
 * `moves`, and it is spent at the handover. A move is an Act, and what a board is called now is computed from the Acts
 * (the `boards_now` view, supabase/migrations/0046_moves.sql), so ending a move brings the old name back with nothing
 * rewritten.
 *
 * A move reads to a player in plain words (the label on the glass, the line in the log), never in the Director's: the fiction
 * may lie, the log never does ("The fiction may lie; the log never does"). The words here are the engine's; the Director's in-
 * character line for a landing is the instance's stock line.
 *
 * Pure: nothing here reads a clock or a database.
 */
import { repair, type Repaired, type Rule } from './validate.ts';
import { predicate, predicateProblems } from '../rules/predicates.ts';

/** A uuid as Postgres writes it; the params that name a board, a character or a thread are held to it. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A board named inside a move's words: the screen makes it a link to the board, whatever the board is called. */
export interface BoardRef {
  readonly board: string;
  readonly name: string;
}

/** The move as one short plain sentence, in pieces: words, and the boards it names. */
export type MoveParts = readonly (string | BoardRef)[];

/** The two offices that make moves: the Boss, and a Mod the Boss hands an allowance to (Mod Bots design, section 2). */
export type Office = 'boss' | 'mod';

export interface MoveKind {
  readonly key: string;
  /** The offices that may make it. The catalog names them and seeds them to `move_kinds.offices`; the queue's guard enforces them from the Mod Bots plan's Task 4. */
  readonly offices: readonly Office[];
  /** A structural move reshapes a board, or names a successor, and waits in the admin queue before it lands. */
  readonly structural: boolean;
  /** Whether the move shapes a board, so a new Boss reviews it when it inherits it (the inheritance review). */
  readonly shapesBoard: boolean;
  /** Whether the Boss may propose it among its `moves`. A move that is not is queued by the meeting from another answer. */
  readonly askable: boolean;
  /**
   * The label drawn on the glass for the move's Act, a template on the actor's role: `{role}` is the instance's word for who made the
   * move (`UiCopy.roleWord`, "The Boss"; a Mod Bot's move, when Mod Bots move, takes its own role word). The glass draws it in capitals.
   */
  readonly label: string;
  /** The params' shape and string bounds. The ceilings here are outer ones; the meeting holds the tighter settings (`boardNameMaxLength`). */
  readonly params: Rule;
  /** The params that must be uuids. An optional one may be absent or null, and is null in the repaired params. */
  readonly uuids: readonly string[];
  /** What the shape cannot say (a rule's parameter against its predicate): the first problem found in the repaired params, or null. */
  readonly check?: (given: Readonly<Record<string, unknown>>) => { readonly path: string; readonly predicate: string } | null;
  /**
   * The move in plain words for a stock line's `{move}`, with `{param}` filled from the move's string params (a phrase that
   * follows "the": it is said in the world's voice by the line and plainly by this). Travels in the seed as `systemMoveWords`.
   */
  readonly plain: string;
  /** How the move reads in a player's log, in plain words, with the actor's role (as `label` has it). */
  readonly template: (params: Readonly<Record<string, unknown>>, role: string, names?: MoveNames) => string;
  /**
   * The move as one short plain sentence for a staff member's moderation log and for the admin queue: "Renamed General to Pointless
   * Toast Palace" once it has landed, "Rename General to Pointless Toast Palace" while it waits (`plan`). `was` is the name the board
   * had before the move, when the screen knows it; for a move that names a Boss, it is that Boss's name, when the screen knows it.
   */
  readonly parts: (params: Readonly<Record<string, unknown>>, was: string | null, tense: 'done' | 'plan', names?: MoveNames) => MoveParts;
}

/**
 * The names a move's words cannot read from its params: a character, a group (params hold only its key) and a board are named by
 * the instance's rows, which the caller passes in. The engine names no group; a name left out falls to a plain stand-in.
 */
export interface MoveNames {
  readonly character?: string;
  readonly group?: string;
  readonly board?: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export const RENAME_BOARD: MoveKind = {
  key: 'renameBoard',
  offices: ['boss'],
  structural: true,
  shapesBoard: true,
  askable: true,
  label: '{role} renamed this board',
  params: {
    type: 'object',
    fields: {
      board: { type: 'string', minLength: 36, maxLength: 36 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      premise: { type: 'string', minLength: 1, maxLength: 500 },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
  uuids: ['board'],
  plain: 'the renaming of a board to "{name}"',
  template: (p, role) => `${role} renamed a board to "${text(p['name'])}". Its subject is now: ${text(p['premise'])}`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Rename ' : 'Renamed ', { board: text(p['board']), name: was ?? 'a board' }, ' to ', { board: text(p['board']), name: text(p['name']) }],
};

/** The Boss names the one who will follow it. `boss` is a key of the instance's roster; the meeting checks it, the database checks it again. */
export const NAME_SUCCESSOR: MoveKind = {
  key: 'nameSuccessor',
  offices: ['boss'],
  structural: true,
  shapesBoard: false,
  askable: false,
  label: '{role} named its successor',
  params: { type: 'object', fields: { boss: { type: 'string', minLength: 1, maxLength: 80 } } },
  uuids: [],
  plain: 'the naming of a successor',
  template: (_p, role) => `${role} named who will follow this one.`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Name ' : 'Named ', was ?? text(p['boss']), ' as the next Boss'],
};

export const BANDS = ['minor', 'moderate', 'severe'] as const;

/** A rule on one board, or on every board (the Boss's alone). Its number is given when it lands (`rules_now`), so the words here carry none. */
export const SET_RULE: MoveKind = {
  key: 'setRule',
  offices: ['boss', 'mod'],
  structural: false,
  shapesBoard: false,
  askable: true,
  label: 'Set a rule',
  params: {
    type: 'object',
    fields: {
      board: { type: 'string', minLength: 36, maxLength: 36, optional: true },
      predicate: { type: 'string', minLength: 1, maxLength: 40 },
      param: { type: 'any', optional: true },
      band: { type: 'enum', values: BANDS },
    },
  },
  uuids: ['board'],
  check: (g) => predicateProblems(text(g['predicate']), g['param']),
  plain: 'a rule',
  template: (p) => {
    const words = predicate(text(p['predicate']))?.plain(p['param']) ?? 'a rule';
    return `A rule was set on ${p['board'] ? 'a board' : 'every board'}: ${words}. Breaking it is a ${text(p['band'])} offense.`;
  },
  parts: (p, was) => {
    const words = predicate(text(p['predicate']))?.plain(p['param']) ?? 'a rule';
    return p['board']
      ? ['Set a rule on ', { board: text(p['board']), name: was ?? 'a board' }, `: ${words}`]
      : [`Set a house rule for every board: ${words}`];
  },
};

/** The longest a group's key may be: the instance's rows hold the key, and the move names it. */
export const GROUP_KEY_MOST = 40;

/**
 * A member put in a group (member groups design): a punishment bars the character from a board (the group's `through` in the instance's
 * rows), a favor lifts it. The group is named by its key; the instance's rows say what it is and what it does. A punishment that
 * names a board carries the demand `apologyAccepted`; a favor carries `checkAt`, when the tick looks to see the demand was met.
 */
export const CONFER_GROUP: MoveKind = {
  key: 'conferGroup',
  offices: ['boss', 'mod'],
  structural: false,
  shapesBoard: false,
  askable: true,
  label: '{role} moved a member',
  params: {
    type: 'object',
    fields: {
      character: { type: 'string', minLength: 36, maxLength: 36 },
      group: { type: 'string', minLength: 1, maxLength: GROUP_KEY_MOST },
      board: { type: 'string', minLength: 36, maxLength: 36, optional: true },
      checkAt: { type: 'string', minLength: 1, maxLength: 40, optional: true },
    },
  },
  uuids: ['character', 'board'],
  plain: 'moving a member into "{group}"',
  template: (p, role, names) => {
    const who = names?.character ?? 'a member';
    const group = names?.group ?? text(p['group']);
    return `${role} put ${who} in ${group}${p['board'] ? `, barred from posting on ${names?.board ?? 'a board'}` : ''}.`;
  },
  parts: (p, _was, tense, names) => {
    const head = `Put ${names?.character ?? 'a member'} in ${names?.group ?? text(p['group'])}`;
    const tail = tense === 'plan' ? ' (planned)' : '';
    return p['board'] ? [`${head}, barred from `, { board: text(p['board']), name: names?.board ?? 'a board' }, ...(tail ? [tail] : [])] : [`${head}${tail}`];
  },
};

export const MOVE_KINDS: readonly MoveKind[] = [RENAME_BOARD, NAME_SUCCESSOR, SET_RULE, CONFER_GROUP];

/** The moves the Boss may propose among its `moves`: the catalog less the ones another answer queues. */
export const ASKABLE_MOVE_KINDS: readonly MoveKind[] = MOVE_KINDS.filter((k) => k.askable);

export function moveKind(key: string): MoveKind | undefined {
  return MOVE_KINDS.find((k) => k.key === key);
}

/**
 * A move's params against its kind: the shape and string bounds through `repair` (a string over its bound is trimmed and
 * recorded; a missing or mistyped field is rejected), then each uuid param. A key outside the catalog is rejected, naming it.
 */
export function moveParamsProblems(key: string, params: unknown): Repaired {
  const kind = moveKind(key);
  if (!kind) return { ok: false, path: 'kind', predicate: `oneOf(${MOVE_KINDS.map((k) => k.key).join(', ')})`, trims: [] };
  const out = repair(params, kind.params);
  if (!out.ok) return out;
  const given = out.value as Record<string, unknown>;
  for (const name of kind.uuids) {
    // An optional uuid that was left out (or null) is null: a rule's board, null for every board.
    if (given[name] === undefined && (kind.params as { fields: Record<string, Rule> }).fields[name]?.optional) { given[name] = null; continue; }
    if (!UUID.test(text(given[name]))) return { ok: false, path: name, predicate: 'isUuid', trims: out.trims };
    // Postgres writes uuids in lowercase and SQL compares them as text, so they are normalized here (not a bound, so no trim).
    given[name] = text(given[name]).toLowerCase();
  }
  if (kind.check) {
    // A param left out is null, so the check and the queue see one shape.
    for (const [name, rule] of Object.entries((kind.params as { fields: Record<string, Rule> }).fields)) if (rule.optional && given[name] === undefined) given[name] = null;
    const bad = kind.check(given);
    if (bad) return { ok: false, path: bad.path, predicate: bad.predicate, trims: out.trims };
  }
  return out;
}
