/**
 * A Boss's hidden memory (system design, section 4; the seasonal Boss design, sections 3-4): its
 * current hobby and where it came from, its opinion of each character, its grudges, the wheelhouse
 * it has learned and the real-world subjects it leaves alone. It drives the Boss's moves and never
 * reaches a client; a new version is stored at every meeting (`staff_memory`, append-only).
 *
 * It is written by a model, so it is repaired the way every answer is (validate.ts): a bound
 * overshot by a little is trimmed and recorded. Three things are repaired here that the generic
 * rules cannot say:
 *
 * - An opinion's score is clamped into -5..5.
 * - A character the answer names must satisfy `isPublic`, which the caller builds by looking up
 *   every character id the answer names in `characters_public` (debuted and public now), so it is
 *   not limited to the ones today's digest named: a returning Boss keeps an opinion of a character
 *   it read in an earlier season, because the repair never drops one for being absent from the
 *   digest. A name that is not public (retired, hidden, or never a character) is dropped and
 *   recorded. Nothing private is read to keep or refresh an opinion: the Boss does not know who
 *   owns a mask, and its grudges land on masks.
 * - Memory is read at every meeting, so each list is capped by a setting (`memoryOpinions`,
 *   `memoryGrudges`, `memoryWheelhouse`, `memoryRealWorld`). A list over its cap keeps its first
 *   N entries (the prompt asks the model to order each list most important first) and records one
 *   trim. That is trimming at any overshoot, never rejection: dropping the tail of a memory list
 *   invents nothing.
 *
 * The answer is the whole new memory: the meeting reads the latest memory as input, so nothing
 * omitted is merged back in from an earlier version.
 *
 * Pure: nothing is changed in place.
 */
import { repair, type Repaired, type Rule, type Trim } from './validate.ts';

/**
 * The longest a staff note may be, in characters: the same 280 the database check on `staff_notes.body` holds
 * (supabase/migrations/0085_staff_notes.sql; a test reads the file and compares). A note is a persona's own thought, written with
 * a pool post; the Boss's meeting reads its recent ones as context and never acts on their words.
 */
export const noteMost = 280;

/** The newest `most` of a persona's notes (given oldest first, as `staff_notes_recent` returns them), oldest first, each trimmed to `noteMost`. */
export function recentNotes(notes: readonly string[], most: number): string[] {
  const kept = notes.map((n) => n.trim().slice(0, noteMost)).filter((n) => n !== '');
  return most > 0 ? kept.slice(-most) : [];
}

export const SCORE_MIN = -5;
export const SCORE_MAX = 5;

export interface Opinion {
  readonly character: string;
  /** -5 (loathes) to 5 (adores). */
  readonly score: number;
  readonly note: string;
}

export interface Grudge {
  readonly character: string;
  readonly note: string;
}

export interface Memory {
  /** Where its current hobby came from: a character it thinks is cool, or an outside subject. */
  readonly hobby: { readonly name: string; readonly since: string; readonly from: string };
  readonly opinions: readonly Opinion[];
  readonly grudges: readonly Grudge[];
  /** Subjects in the userbase's wheelhouse it has learned. */
  readonly wheelhouse: readonly string[];
  /** Real-world subjects it leaves alone. */
  readonly realWorld: readonly string[];
  /** Part 4's threads on thin ice; empty in Part 1. */
  readonly marks: readonly string[];
}

const text = (maxLength: number): Rule => ({ type: 'string', maxLength, minLength: 1 });

/** The bounds the meeting's prompt states and `MEMORY_RULE` holds: a hobby's name and a mark, in characters. */
export const MEMORY_MOST = { hobbyName: 80, mark: 120 } as const;

/** The rule `models()` repairs a memory answer with. The score's range is held by `repairMemory`. */
export const MEMORY_RULE: Rule = {
  type: 'object',
  fields: {
    hobby: { type: 'object', fields: { name: text(MEMORY_MOST.hobbyName), since: text(40), from: text(120) } },
    opinions: { type: 'list', of: { type: 'object', fields: { character: text(64), score: { type: 'number' }, note: { type: 'string', maxLength: 300 } } } },
    grudges: { type: 'list', of: { type: 'object', fields: { character: text(64), note: { type: 'string', maxLength: 300 } } } },
    wheelhouse: { type: 'list', of: text(120) },
    realWorld: { type: 'list', of: text(120) },
    marks: { type: 'list', of: text(MEMORY_MOST.mark), optional: true },
  },
};

/** The settings that cap each list. */
export interface MemoryCaps {
  readonly memoryOpinions: number;
  readonly memoryGrudges: number;
  readonly memoryWheelhouse: number;
  readonly memoryRealWorld: number;
}

export type RepairedMemory =
  | { readonly ok: true; readonly memory: Memory; readonly trims: readonly Trim[] }
  | { readonly ok: false; readonly path: string; readonly predicate: string; readonly trims: readonly Trim[] };

/** The Boss's own answer, repaired. */
export function repairMemory(raw: unknown, isPublic: (character: string) => boolean, caps: MemoryCaps): RepairedMemory {
  const made: Repaired = repair(raw, MEMORY_RULE);
  if (!made.ok) return made;
  const trims: Trim[] = [...made.trims];
  const given = made.value as Omit<Memory, 'marks'> & { marks?: string[] };

  // An opinion: its score rounded and clamped, and a character not public dropped. A trim's `before` and
  // `after` are the score for a clamp, and 1 and 0 for a drop.
  // A character named twice keeps its first entry; the later ones are dropped before the cap.
  const opinions: Opinion[] = [];
  const opined = new Set<string>();
  given.opinions.forEach((o, i) => {
    const path = `opinions[${i}]`;
    if (!isPublic(o.character)) {
      trims.push({ path, predicate: 'publicCharacter', before: 1, after: 0 });
      return;
    }
    if (opined.has(o.character)) {
      trims.push({ path, predicate: 'uniqueCharacter', before: 1, after: 0 });
      return;
    }
    opined.add(o.character);
    const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(o.score)));
    if (score !== o.score) trims.push({ path: `${path}.score`, predicate: `between(${SCORE_MIN}, ${SCORE_MAX})`, before: o.score, after: score });
    opinions.push({ character: o.character, score, note: o.note });
  });
  const grudges: Grudge[] = [];
  const grudged = new Set<string>();
  given.grudges.forEach((g, i) => {
    const path = `grudges[${i}]`;
    if (!isPublic(g.character)) trims.push({ path, predicate: 'publicCharacter', before: 1, after: 0 });
    else if (grudged.has(g.character)) trims.push({ path, predicate: 'uniqueCharacter', before: 1, after: 0 });
    else {
      grudged.add(g.character);
      grudges.push(g);
    }
  });

  const cap = <T,>(path: string, list: readonly T[], max: number): readonly T[] => {
    if (list.length <= max) return list;
    trims.push({ path, predicate: `atMost(${max})`, before: list.length, after: max });
    return list.slice(0, max);
  };
  return {
    ok: true,
    memory: {
      ...given,
      opinions: cap('opinions', opinions, caps.memoryOpinions),
      grudges: cap('grudges', grudges, caps.memoryGrudges),
      wheelhouse: cap('wheelhouse', given.wheelhouse, caps.memoryWheelhouse),
      realWorld: cap('realWorld', given.realWorld, caps.memoryRealWorld),
      marks: given.marks ?? [],
    },
    trims,
  };
}
