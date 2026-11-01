/**
 * A Boss's hidden memory (system design, section 4; the seasonal Boss design, sections 3-4): its
 * current hobby and where it came from, its opinion of each character, its grudges, the wheelhouse
 * it has learned and the real-world subjects it leaves alone. It drives the Boss's moves and never
 * reaches a client; a new version is stored at every meeting (`staff_memory`, append-only).
 *
 * It is written by a model, so it is repaired the way every answer is (validate.ts): a bound
 * overshot by a little is trimmed and recorded. Two things are repaired here that the generic rules
 * cannot say: an opinion's score is clamped into -5..5, and a character the Boss names must be one
 * of `publicCharacters`, the debuted public characters the digest showed (never anything read from
 * a private fact: the Boss does not know who owns a mask, and its grudges land on masks). A name
 * that is not one is dropped and recorded.
 *
 * A Boss that returns seasons later brings its earlier memory (`previous`). Its opinions and
 * grudges were read from public play, so they are kept, but only while the character is still
 * public; one that has since retired is dropped and recorded, and nothing is ever refreshed from
 * anything private. An earlier opinion the new answer restates is the new one.
 *
 * Pure: nothing is changed in place.
 */
import { repair, type Repaired, type Rule, type Trim } from './validate.ts';

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

/** The rule `models()` repairs a memory answer with. The score's range is held by `repairMemory`. */
export const MEMORY_RULE: Rule = {
  type: 'object',
  fields: {
    hobby: { type: 'object', fields: { name: text(80), since: text(40), from: text(120) } },
    opinions: { type: 'list', of: { type: 'object', fields: { character: text(64), score: { type: 'number' }, note: { type: 'string', maxLength: 300 } } } },
    grudges: { type: 'list', of: { type: 'object', fields: { character: text(64), note: { type: 'string', maxLength: 300 } } } },
    wheelhouse: { type: 'list', of: text(120) },
    realWorld: { type: 'list', of: text(120) },
    marks: { type: 'list', of: text(120), optional: true },
  },
};

export type RepairedMemory =
  | { readonly ok: true; readonly memory: Memory; readonly trims: readonly Trim[] }
  | { readonly ok: false; readonly path: string; readonly predicate: string; readonly trims: readonly Trim[] };

/** The Boss's own answer, repaired; `previous` is its memory from an earlier season or meeting, if any. */
export function repairMemory(raw: unknown, publicCharacters: ReadonlySet<string>, previous?: Memory): RepairedMemory {
  const made: Repaired = repair(raw, MEMORY_RULE);
  if (!made.ok) return made;
  const trims: Trim[] = [...made.trims];
  const given = made.value as Omit<Memory, 'marks'> & { marks?: string[] };

  // An opinion: its score rounded and clamped, and a character not public dropped. A trim's `before` and
  // `after` are the score for a clamp, and 1 and 0 for a drop.
  const opinions: Opinion[] = [];
  given.opinions.forEach((o, i) => {
    const path = `opinions[${i}]`;
    if (!publicCharacters.has(o.character)) {
      trims.push({ path, predicate: 'publicCharacter', before: 1, after: 0 });
      return;
    }
    const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(o.score)));
    if (score !== o.score) trims.push({ path: `${path}.score`, predicate: `between(${SCORE_MIN}, ${SCORE_MAX})`, before: o.score, after: score });
    opinions.push({ character: o.character, score, note: o.note });
  });
  const grudges: Grudge[] = [];
  given.grudges.forEach((g, i) => {
    if (publicCharacters.has(g.character)) grudges.push(g);
    else trims.push({ path: `grudges[${i}]`, predicate: 'publicCharacter', before: 1, after: 0 });
  });

  // A returning Boss's earlier opinions and grudges, kept while the character is public and the new answer
  // does not restate them.
  if (previous) {
    const said = new Set(opinions.map((o) => o.character));
    previous.opinions.forEach((o, i) => {
      if (said.has(o.character) || given.opinions.some((n) => n.character === o.character)) return;
      if (publicCharacters.has(o.character)) opinions.push(o);
      else trims.push({ path: `previous.opinions[${i}]`, predicate: 'publicCharacter', before: 1, after: 0 });
    });
    const grudged = new Set(given.grudges.map((g) => g.character));
    previous.grudges.forEach((g, i) => {
      if (grudged.has(g.character)) return;
      if (publicCharacters.has(g.character)) grudges.push(g);
      else trims.push({ path: `previous.grudges[${i}]`, predicate: 'publicCharacter', before: 1, after: 0 });
    });
  }

  return { ok: true, memory: { ...given, opinions, grudges, marks: given.marks ?? [] }, trims };
}
