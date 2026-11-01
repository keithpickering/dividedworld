/**
 * The moves The System can make (system design, section 3; the system plan, Task 8): a fixed catalog the code maps to effects
 * with limits. A model proposes a move by key and params; free text it returns is shown, never acted on, so a key outside this
 * list is not a move (the meeting drops it and records it). The catalog is seeded into `move_kinds` by `seed_instance`
 * (supabase/functions/_shared/seed.ts reads it), so SQL and TypeScript read one list ("Two lists that must agree are one list").
 *
 * Part 1 holds one move, `renameBoard`. It is structural (design, section 7): it waits in the admin queue about a day before it
 * lands and lands unless an admin holds it. A move is an Act, and what a board is called now is computed from the Acts
 * (the `boards_now` view, supabase/migrations/0045_moves.sql), so ending a move brings the old name back with nothing
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

export interface MoveKind {
  readonly key: string;
  /** A structural move reshapes a board and waits in the admin queue before it lands. */
  readonly structural: boolean;
  /** The label drawn on the glass for the move's Act, in capitals. */
  readonly label: string;
  /** The params' shape and string bounds. The ceilings here are outer ones; the meeting holds the tighter settings (`boardNameMaxLength`). */
  readonly params: Rule;
  /** The params that must be uuids. */
  readonly uuids: readonly string[];
  /** How the move reads in a player's log, in plain words. */
  readonly template: (params: Readonly<Record<string, unknown>>) => string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export const RENAME_BOARD: MoveKind = {
  key: 'renameBoard',
  structural: true,
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
  template: (p) => `The System renamed a board to "${text(p['name'])}". Its subject is now: ${text(p['premise'])}`,
};

export const MOVE_KINDS: readonly MoveKind[] = [RENAME_BOARD];

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
  }
  return out;
}
