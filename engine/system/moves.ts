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
 * `createBoard`, `moveThread` and `mergeBoard` are lasting (below, `CREATE_BOARD`): they build the board and stay until reversed or superseded.
 *
 * The machine's three moves (booster packs design, section 6) are small moves over the Vending Machine's slots: `pullSlot` sells a card's slot out, `repriceSlot` sets a
 * price to a percent of the admin's, `flashSale` opens a hidden slot for a window. Their numbers are the economy's `machine.*` (`machineLimits`), checked here
 * for the params, in the meeting for what the machine holds (the slot, the pulls in force, one move per slot) and again in SQL at the queue and at landing
 * (supabase/migrations/0140_machine_moves.sql). A pull and a markup punish and carry a demand; a markdown and a flash sale are favors and carry none
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

/**
 * A part of a bundle names the board another part of the same bundle makes by that part's role (`{role: 'minus'}`), where a board's uuid would go. The database resolves it to the board
 * when the part lands (supabase/migrations/0161_bundles.sql, `role_board`); the engine only holds the shape. A role is lowercase letters, digits, hyphens and underscores, from a letter.
 */
export interface RoleRef {
  readonly role: string;
}

/** What a role may be called; SQL holds the same. */
export const ROLE = /^[a-z][a-z0-9_-]{0,39}$/;

/** Whether a value is a role and nothing more. */
export function isRoleRef(v: unknown): v is RoleRef {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0] === 'role' && typeof (v as { role: unknown }).role === 'string' && ROLE.test((v as { role: string }).role);
}

/** The params of the moves that build the board where a role may stand for a board's uuid. A thread is never a role: nothing makes one. */
const ROLE_PARAMS = ['board', 'into', 'fallback'] as const;

/** A board in a move's words: a link to the board, or, where the board is a part's role not yet made, plain words, since there is no board to link to. */
const boardPart = (v: unknown, name: string): string | BoardRef =>
  isRoleRef(v) ? `the board the part "${v.role}" makes` : { board: text(v), name };

/** The move as one short plain sentence, in pieces: words, and the boards it names. */
export type MoveParts = readonly (string | BoardRef)[];

/** The two offices that make moves: the Boss, and a Mod the Boss hands an allowance to (Mod Bots design, section 2). */
export type Office = 'boss' | 'mod';

/**
 * The numbers the Boss's three moves on the machine are held to, from the instance's economy (`machine.*`, engine/rules/packs.ts holds the
 * starting values). A key the economy lacks is the engine's default, so a database that predates a key still has a bound. SQL holds the same
 * bounds (`machine_move_problem`, supabase/migrations/0140_machine_moves.sql) and reads them from the same row.
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
  /**
   * Whether the move builds something that stays: it has no expiry and carries no demand, and ends only when it is reversed or superseded. A lasting move changes where
   * threads are (`threads.board`, derived from the Acts by `thread_place`), and the inheritance review does not hand it on (a new Boss inherits moves that expire).
   */
  readonly lasting: boolean;
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
  /** Fill-only tokens `plain` may name besides the params, which SQL's `system_line` derives from the instance's rows (a group's name from its key). */
  readonly derived?: readonly string[];
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
  /** The board a move names: a rename's, a thread's new board, the board a merge goes into. */
  readonly board?: string;
  /** The title of the thread a `moveThread` moves, as it is called now. */
  readonly thread?: string;
  /** The board a `moveThread` took the thread from, or the board a `mergeBoard` closes (and its id, so the sentence can link it), as it is called now. */
  readonly source?: string;
  readonly sourceId?: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const RENAME_BOARD: MoveKind = {
  key: 'renameBoard',
  offices: ['boss'],
  structural: true,
  shapesBoard: true,
  lasting: false,
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
  demand: () => 'required',
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
  lasting: false,
  askable: false,
  label: '{role} named its successor',
  params: { type: 'object', fields: { boss: { type: 'string', minLength: 1, maxLength: 80 } } },
  uuids: [],
  demand: () => 'none',
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
  lasting: false,
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
  lasting: false,
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
  // A punishment's demand is the apology the code sets; a favor's is the one the character should meet by its check. Either way it carries one.
  demand: () => 'required',
  plain: 'moving a member into "{groupName}"',
  derived: ['groupName'],
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
  lasting: false,
  askable: true,
  label: '{role} pulled a card from the machine',
  params: { type: 'object', fields: { slot: slotField } },
  uuids: ['slot'],
  demand: () => 'required',
  plain: 'the pulling of a card from the machine',
  template: (_p, role) => `${role} pulled a card from the machine. It cannot be bought there until this ends; it can still come out of a pack.`,
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
  lasting: false,
  askable: true,
  label: '{role} repriced a slot at the machine',
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
  template: (p, role) => `${role} marked a price at the machine ${num(p['percent']) > 100 ? 'up' : 'down'} to ${num(p['percent'])}% of what it was.`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Reprice ' : 'Repriced ', was ?? 'a slot', ` to ${num(p['percent'])}% of its price`],
};

/** The Boss opens a hidden slot for a window of hours, then it is hidden again. A favor: it carries no demand, and its expiry is its window. */
export const FLASH_SALE: MoveKind = {
  key: 'flashSale',
  offices: ['boss'],
  structural: false,
  shapesBoard: false,
  lasting: false,
  askable: true,
  label: '{role} opened a flash sale at the machine',
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
  template: (p, role) => `${role} opened a flash sale at the machine on a slot that was hidden. It is on sale for ${num(p['hours'])} hours, then hidden again.`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Open a flash sale on ' : 'Opened a flash sale on ', was ?? 'a slot', ` for ${num(p['hours'])} hours`],
};

/**
 * The three moves that build the board and stay (the fangame split, section 4): each is lasting, with no expiry and no demand, and ends only when a later move
 * supersedes it or an admin reverses it. A board made, a thread moved and a board merged away are Acts; where a thread is now, and whether a board is open, are
 * computed from them (`thread_place`, `boards_now`), so a reversal brings the old place back with nothing rewritten.
 * `createBoard` and `mergeBoard` reshape a board, so each waits in the admin queue about a day; `moveThread` is small. The name a `createBoard` gives is held to
 * the instance's name style and `boardNameMaxLength` by the meeting, as `renameBoard`'s is; its `fallback` is where threads started in the board go if the move is
 * reversed (null: the instance's first open board).
 */
export const CREATE_BOARD: MoveKind = {
  key: 'createBoard',
  offices: ['boss'],
  structural: true,
  shapesBoard: true,
  lasting: true,
  askable: true,
  label: 'Created a board',
  params: {
    type: 'object',
    fields: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      premise: { type: 'string', minLength: 1, maxLength: 500 },
      description: { type: 'string', minLength: 1, maxLength: 2000 },
      fallback: { type: 'string', minLength: 36, maxLength: 36, optional: true },
    },
  },
  uuids: ['fallback'],
  demand: () => 'none',
  plain: 'the making of a board named "{name}"',
  template: (p, role) => `${role} made a board named "${text(p['name'])}". Its subject is: ${text(p['premise'])}`,
  parts: (p, _was, tense) => [`${tense === 'plan' ? 'Create' : 'Created'} a board named "${text(p['name'])}"`],
};

/** The Boss moves one thread to another board. A second move of the same thread supersedes the first; reversing one returns the thread to where the one before it put it. */
export const MOVE_THREAD: MoveKind = {
  key: 'moveThread',
  offices: ['boss'],
  structural: false,
  shapesBoard: false,
  lasting: true,
  askable: true,
  label: 'Moved a thread',
  params: { type: 'object', fields: { thread: { type: 'string', minLength: 36, maxLength: 36 }, board: { type: 'string', minLength: 36, maxLength: 36 } } },
  uuids: ['thread', 'board'],
  demand: () => 'none',
  plain: 'the moving of a thread to another board',
  template: (p, role, names) => `${role} moved ${names?.thread ?? 'a thread'}${names?.source ? ` from ${names.source}` : ''} to ${names?.board ?? 'another board'}. Nothing in the thread was changed; the board it left lists where it went for a few days.`,
  parts: (p, _was, tense, names) => {
    const head = `${tense === 'plan' ? 'Move' : 'Moved'} ${names?.thread ?? 'a thread'}`;
    const to = boardPart(p['board'], names?.board ?? 'a board');
    return names?.source ? [`${head} from `, { board: names.sourceId ?? '', name: names.source }, ' to ', to] : [`${head} to `, to];
  },
};

/** The Boss merges one board into another: its threads join the other and it closes, kept as a record. `board` and `into` differ; the database also refuses a cycle. */
export const MERGE_BOARD: MoveKind = {
  key: 'mergeBoard',
  offices: ['boss'],
  structural: true,
  shapesBoard: true,
  lasting: true,
  askable: true,
  label: 'Merged a board',
  params: { type: 'object', fields: { board: { type: 'string', minLength: 36, maxLength: 36 }, into: { type: 'string', minLength: 36, maxLength: 36 } } },
  uuids: ['board', 'into'],
  check: (g) => (text(g['board']) === text(g['into']) ? { path: 'into', predicate: 'differsFromBoard' } : null),
  demand: () => 'none',
  plain: 'the merging of a board into another',
  template: (_p, role, names) => `${role} merged ${names?.source ?? 'a board'} into ${names?.board ?? 'another'}. Its threads moved with it, and the board is closed.`,
  parts: (p, was, tense, names) => [tense === 'plan' ? 'Merge ' : 'Merged ', boardPart(p['board'], was ?? 'a board'), ' into ', boardPart(p['into'], names?.board ?? 'a board')],
};

export const MOVE_KINDS: readonly MoveKind[] = [RENAME_BOARD, NAME_SUCCESSOR, SET_RULE, CONFER_GROUP, PULL_SLOT, REPRICE_SLOT, FLASH_SALE, CREATE_BOARD, MOVE_THREAD, MERGE_BOARD];

/** The moves the Boss may propose among its `moves`: the catalog less the ones another answer queues. */
export const ASKABLE_MOVE_KINDS: readonly MoveKind[] = MOVE_KINDS.filter((k) => k.askable);

export function moveKind(key: string): MoveKind | undefined {
  return MOVE_KINDS.find((k) => k.key === key);
}

/**
 * A move's params against its kind: the shape and string bounds through `repair` (a string over its bound is trimmed and
 * recorded; a missing or mistyped field is rejected), then each uuid param, then the kind's own check. A key outside the catalog is rejected, naming it.
 * A machine move's numbers are held to `limits` (the economy's `machine.*`; the engine's defaults where none is given).
 * Inside a bundle (`inBundle`), a lasting move's `board`, `into` or `fallback` may be a `{role}` where a board's uuid goes: it is kept as it is, for the database to resolve when the part lands,
 * and is refused outside a bundle (`roleInsideBundle`). Each role stands for a board of its own while the kind's own check reads the params, so a merge of one role into another is no merge into itself.
 */
export function moveParamsProblems(key: string, params: unknown, limits: MachineLimits = machineLimits(), inBundle = false): Repaired {
  const kind = moveKind(key);
  if (!kind) return { ok: false, path: 'kind', predicate: `oneOf(${MOVE_KINDS.map((k) => k.key).join(', ')})`, trims: [] };
  const roles = new Map<string, RoleRef>();
  let offered = params;
  if (kind.lasting && params !== null && typeof params === 'object' && !Array.isArray(params)) {
    const copy: Record<string, unknown> = { ...(params as Record<string, unknown>) };
    const standIns: string[] = [];
    for (const name of ROLE_PARAMS) {
      const v = copy[name];
      if (!kind.uuids.includes(name) || v === null || typeof v !== 'object' || Array.isArray(v)) continue;
      if (!inBundle) return { ok: false, path: name, predicate: 'roleInsideBundle', trims: [] };
      if (!isRoleRef(v)) return { ok: false, path: name, predicate: 'isRole', trims: [] };
      let at = standIns.indexOf(v.role);
      if (at < 0) at = standIns.push(v.role) - 1;
      roles.set(name, { role: v.role });
      copy[name] = `00000000-0000-4000-8000-${String(at + 1).padStart(12, '0')}`;
    }
    offered = copy;
  }
  const out = repair(offered, kind.params);
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
  // The roles go back where the stand-ins were.
  for (const [name, ref] of roles) given[name] = ref;
  return out;
}
