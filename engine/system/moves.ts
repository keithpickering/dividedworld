/**
 * The moves The System can make (system design, section 3; the system plan, Task 8): a fixed catalog the code maps to effects
 * with limits. A model proposes a move by key and params; free text it returns is shown, never acted on, so a key outside this
 * list is not a move (the meeting drops it and records it). The catalog is seeded into `move_kinds` by `seed_instance`
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

/** A uuid as Postgres writes it; the params that name a board, a character or a thread are held to it. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A board named inside a move's words: the screen makes it a link to the board, whatever the board is called. */
export interface BoardRef {
  readonly board: string;
  readonly name: string;
}

/** The move as one short plain sentence, in pieces: words, and the boards it names. */
export type MoveParts = readonly (string | BoardRef)[];

export interface MoveKind {
  readonly key: string;
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
  /** The params that must be uuids. */
  readonly uuids: readonly string[];
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

export const RENAME_BOARD: MoveKind = {
  key: 'renameBoard',
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
  plain: 'the renaming of a board to "{name}"',
  template: (p) => `The System renamed a board to "${text(p['name'])}". Its subject is now: ${text(p['premise'])}`,
  parts: (p, was, tense) => [tense === 'plan' ? 'Rename ' : 'Renamed ', { board: text(p['board']), name: was ?? 'a board' }, ' to ', { board: text(p['board']), name: text(p['name']) }],
};

/** The Boss names the one who will follow it. `boss` is a key of the instance's roster; the meeting checks it, the database checks it again. */
export const NAME_SUCCESSOR: MoveKind = {
  key: 'nameSuccessor',
  structural: true,
  shapesBoard: false,
  askable: false,
  label: 'THE SYSTEM NAMED ITS SUCCESSOR',
  params: { type: 'object', fields: { boss: { type: 'string', minLength: 1, maxLength: 80 } } },
  uuids: [],
  plain: 'the naming of a successor',
  template: () => 'The System named the Boss who will follow this one.',
  parts: (p, was, tense) => [tense === 'plan' ? 'Name ' : 'Named ', was ?? text(p['boss']), ' as the next Boss'],
};

export const MOVE_KINDS: readonly MoveKind[] = [RENAME_BOARD, NAME_SUCCESSOR];

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
    if (!UUID.test(text(given[name]))) return { ok: false, path: name, predicate: 'isUuid', trims: out.trims };
    // Postgres writes uuids in lowercase and SQL compares them as text, so they are normalized here (not a bound, so no trim).
    given[name] = text(given[name]).toLowerCase();
  }
  return out;
}
