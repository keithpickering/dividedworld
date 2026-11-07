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
 * The machine's three moves (booster packs design, section 6) are small moves over the Vending Machine's slots: `pullSlot` sells a card's slot out, `repriceSlot` sets a
 * price to a percent of the admin's, `flashSale` opens a hidden slot for a window. Their numbers are the economy's `machine.*` (`machineLimits`), checked here
 * for the params, in the meeting for what the machine holds (the slot, the pulls in force, one move per slot) and again in SQL at the queue and at landing
 * (supabase/migrations/0117_machine_moves.sql). A pull and a markup punish and carry a demand; a markdown and a flash sale are favors and carry none
 * (`MoveKind.demand`). What the machine shows is computed from the move Acts (`machine_now`), so ending a move brings the slot back with nothing rewritten.
 *
 * A move reads to a player in plain words (the label on the glass, the line in the log), never in the Director's: the fiction
 * may lie, the log never does ("The fiction may lie; the log never does"). The words here are the engine's; the Director's in-
 * character line for a landing is the instance's stock line.
 *
 * Pure: nothing here reads a clock or a database.
 */
import { repair, type Repaired, type Rule } from './validate.ts';
import { predicate, predicateProblems } from '../rules/predicates.ts';
import { MACHINE_DEFAULTS } from '../rules/packs.ts';

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

/**
 * The numbers the Boss's three moves on the machine are held to, from the instance's economy (`machine.*`, engine/rules/packs.ts holds the
 * starting values). A key the economy lacks is the engine's default, so a database that predates a key still has a bound. SQL holds the same
 * bounds (`machine_move_problem`, supabase/migrations/0117_machine_moves.sql) and reads them from the same row.
 */
export interface MachineLimits {
  /** The most slots pulled at once. */
  readonly pullMost: number;
  /** The longest a machine move runs, in days. */
  readonly moveDaysMost: number;
  /** A reprice's percent of the admin's price, from and to. */
  readonly repriceLeast: number;
  readonly repriceMost: number;
  /** A flash sale's window in hours, from and to. */
  readonly flashHoursLeast: number;
  readonly flashHoursMost: number;
}

export function machineLimits(economy: Readonly<Record<string, number>> = {}): MachineLimits {
  const n = (key: string): number => economy[`machine.${key}`] ?? MACHINE_DEFAULTS[`machine.${key}`]!;
  return { pullMost: n('pullMost'), moveDaysMost: n('moveDaysMost'), repriceLeast: n('repriceLeast'), repriceMost: n('repriceMost'), flashHoursLeast: n('flashHoursLeast'), flashHoursMost: n('flashHoursMost') };
}

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
  /** The label drawn on the glass for the move's Act, in capitals. */
  readonly label: string;
  /** The params' shape and string bounds. The ceilings here are outer ones; the meeting holds the tighter settings (`boardNameMaxLength`). */
  readonly params: Rule;
  /** The params that must be uuids. An optional one may be absent or null, and is null in the repaired params. */
  readonly uuids: readonly string[];
  /** What the shape cannot say (a rule's parameter against its predicate): the first problem found in the repaired params, or null. */
  readonly check?: (given: Readonly<Record<string, unknown>>, limits: MachineLimits) => { readonly path: string; readonly predicate: string } | null;
  /**
   * Whether the move carries a demand the characters can meet, from its params: `required` (the meeting drops it without one) or `none` (a favor: a
   * demand would be the crowd ending its own deal, so one the Boss gives is dropped and recorded). A move that punishes carries one.
   */
  readonly demand: (params: Readonly<Record<string, unknown>>) => 'required' | 'none';
  /**
   * The move in plain words for a stock line's `{move}`, with `{param}` filled from the move's string params (a phrase that
   * follows "the": it is said in the world's voice by the line and plainly by this). Travels in the seed as `systemMoveWords`.
   */
  readonly plain: string;
  /** How the move reads in a player's log, in plain words. */
  readonly template: (params: Readonly<Record<string, unknown>>) => string;
  /**
   * The move as one short plain sentence for a staff member's moderation log and for the admin queue: "Renamed General to Pointless
   * Toast Palace" once it has landed, "Rename General to Pointless Toast Palace" while it waits (`plan`). `was` is the name the board
   * had before the move, when the screen knows it; for a move that names a Boss, it is that Boss's name, when the screen knows it.
   */
  readonly parts: (params: Readonly<Record<string, unknown>>, was: string | null, tense: 'done' | 'plan') => MoveParts;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const RENAME_BOARD: MoveKind = {
  key: 'renameBoard',
  offices: ['boss'],
  structural: true,
  shapesBoard: true,
  askable: true,
  label: 'THE SYSTEM RENAMED THIS BOARD',
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
  demand: () => 'required',
  plain: 'the renaming of a board to "{name}"',
  template: (p) => `The System renamed a board to "${text(p['name'])}". Its subject is now: ${text(p['premise'])}`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Rename ' : 'Renamed ', { board: text(p['board']), name: was ?? 'a board' }, ' to ', { board: text(p['board']), name: text(p['name']) }],
};

/** The Boss names the one who will follow it. `boss` is a key of the instance's roster; the meeting checks it, the database checks it again. */
export const NAME_SUCCESSOR: MoveKind = {
  key: 'nameSuccessor',
  offices: ['boss'],
  structural: true,
  shapesBoard: false,
  askable: false,
  label: 'THE SYSTEM NAMED ITS SUCCESSOR',
  params: { type: 'object', fields: { boss: { type: 'string', minLength: 1, maxLength: 80 } } },
  uuids: [],
  demand: () => 'none',
  plain: 'the naming of a successor',
  template: () => 'The System named the Boss who will follow this one.',
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
  label: 'SET A RULE',
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
  demand: () => 'required',
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

const slotField: Rule = { type: 'string', minLength: 36, maxLength: 36 };
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The Boss pulls a card's slot: it is sold out at the machine until the move ends, and the card still comes out of a pack. The slot is an on-sale single
 * whose card an on-sale pack can still give (packs are the floor); that, how many pulls are in force and one move per slot are the meeting's and the
 * database's to check, since they read the machine. A pull punishes, so it carries a demand.
 */
export const PULL_SLOT: MoveKind = {
  key: 'pullSlot',
  offices: ['boss'],
  structural: false,
  shapesBoard: false,
  askable: true,
  label: 'THE SYSTEM PULLED A CARD FROM THE MACHINE',
  params: { type: 'object', fields: { slot: slotField } },
  uuids: ['slot'],
  demand: () => 'required',
  plain: 'the pulling of a card from the machine',
  template: () => 'The System pulled a card from the machine. It cannot be bought there until this ends; it can still come out of a pack.',
  parts: (p, was, tense) => [tense === 'plan' ? 'Pull ' : 'Pulled ', was ?? 'a slot', ' from the machine'],
};

/**
 * The Boss reprices a slot to a percent of the admin's price, packs included. A markup (over 100) punishes and carries a demand; a markdown is a favor
 * and carries none. 100 is no change, so it is refused. The bounds are the economy's.
 */
export const REPRICE_SLOT: MoveKind = {
  key: 'repriceSlot',
  offices: ['boss'],
  structural: false,
  shapesBoard: false,
  askable: true,
  label: 'THE SYSTEM REPRICED A SLOT AT THE MACHINE',
  params: { type: 'object', fields: { slot: slotField, percent: { type: 'number' } } },
  uuids: ['slot'],
  check: (g, limits) => {
    const percent = g['percent'];
    if (!isNumber(percent) || !Number.isInteger(percent)) return { path: 'percent', predicate: 'isWhole' };
    if (percent < limits.repriceLeast) return { path: 'percent', predicate: `atLeast(${limits.repriceLeast})` };
    if (percent > limits.repriceMost) return { path: 'percent', predicate: `atMost(${limits.repriceMost})` };
    if (percent === 100) return { path: 'percent', predicate: 'notOneHundred' };
    return null;
  },
  demand: (p) => (isNumber(p['percent']) && p['percent'] > 100 ? 'required' : 'none'),
  plain: 'the repricing of a slot at the machine',
  template: (p) => `The System marked a price at the machine ${num(p['percent']) > 100 ? 'up' : 'down'} to ${num(p['percent'])}% of what it was.`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Reprice ' : 'Repriced ', was ?? 'a slot', ` to ${num(p['percent'])}% of its price`],
};

/** The Boss opens a hidden slot for a window of hours, then it is hidden again. A favor: it carries no demand, and its expiry is its window. */
export const FLASH_SALE: MoveKind = {
  key: 'flashSale',
  offices: ['boss'],
  structural: false,
  shapesBoard: false,
  askable: true,
  label: 'THE SYSTEM OPENED A FLASH SALE AT THE MACHINE',
  params: { type: 'object', fields: { slot: slotField, hours: { type: 'number' } } },
  uuids: ['slot'],
  check: (g, limits) => {
    const hours = g['hours'];
    if (!isNumber(hours) || !Number.isInteger(hours)) return { path: 'hours', predicate: 'isWhole' };
    if (hours < limits.flashHoursLeast) return { path: 'hours', predicate: `atLeast(${limits.flashHoursLeast})` };
    if (hours > limits.flashHoursMost) return { path: 'hours', predicate: `atMost(${limits.flashHoursMost})` };
    return null;
  },
  demand: () => 'none',
  plain: 'a flash sale at the machine',
  template: (p) => `The System opened a flash sale at the machine on a slot that was hidden. It is on sale for ${num(p['hours'])} hours, then hidden again.`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Open a flash sale on ' : 'Opened a flash sale on ', was ?? 'a slot', ` for ${num(p['hours'])} hours`],
};

export const MOVE_KINDS: readonly MoveKind[] = [RENAME_BOARD, NAME_SUCCESSOR, SET_RULE, PULL_SLOT, REPRICE_SLOT, FLASH_SALE];

/** The moves the Boss may propose among its `moves`: the catalog less the ones another answer queues. */
export const ASKABLE_MOVE_KINDS: readonly MoveKind[] = MOVE_KINDS.filter((k) => k.askable);

export function moveKind(key: string): MoveKind | undefined {
  return MOVE_KINDS.find((k) => k.key === key);
}

/**
 * A move's params against its kind: the shape and string bounds through `repair` (a string over its bound is trimmed and
 * recorded; a missing or mistyped field is rejected), then each uuid param, then the kind's own check. A key outside the catalog is rejected, naming it.
 * A machine move's numbers are held to `limits` (the economy's `machine.*`; the engine's defaults where none is given).
 */
export function moveParamsProblems(key: string, params: unknown, limits: MachineLimits = machineLimits()): Repaired {
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
    const bad = kind.check(given, limits);
    if (bad) return { ok: false, path: bad.path, predicate: bad.predicate, trims: out.trims };
  }
  return out;
}
