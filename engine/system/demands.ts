/**
 * The demands a move can carry (system design, section 3; the system plan, Task 8): a whitelist of conditions code can check
 * against public Acts. The Director parameterizes one from this list; a key outside it is not a demand. The list is seeded into
 * `demand_kinds` by `seed_instance`, and `demand_progress` (supabase/migrations/0046_moves.sql) holds a case for each key and
 * raises for one it does not know, so a key added here without its case is red in supabase/tests/0051-moves.sql and in
 * `engine/system/demands.test.ts` ("Two lists that must agree are one list").
 *
 * Every demand counts characters, posts and public tallies, never players, and counts only Acts after the move landed.
 *
 * **The crowd judges, not the parties.** A reaction threshold is read from a public tally, and a player's own masks cannot
 * react to each other, so a threshold the reaction cap could reach would fail for a reason that proves a private fact: two
 * named characters may be one player's masks. Every reaction threshold is therefore at least the reaction cap plus one, so
 * meeting it always takes a player outside the pair ("A response never proves a private fact"; design, section 3).
 * `demandProblems` refuses a lower one, naming the predicate.
 *
 * The templates are plain words for the glass, never in the Director's voice. The numbers are the progress SQL returned.
 *
 * Pure: nothing here reads a clock or a database.
 */
import { QUADRANTS } from '../rules/types.ts';
import { repair, type Repaired, type Rule } from './validate.ts';
import { UUID } from './moves.ts';

export interface Progress {
  readonly done: number;
  readonly of: number;
}

export interface DemandKind {
  readonly key: string;
  readonly params: Rule;
  /** The params that must be uuids. */
  readonly uuids: readonly string[];
  /** The whole-number params: `count` is at least 1; `reactions` is a reaction threshold, at least the reaction cap plus one. */
  readonly numbers: Readonly<Record<string, 'count' | 'reactions'>>;
  /** The thing it counts, in capitals, for the glass's short "WAY OUT: 7 OF 12 POSTERS": the singular for a count of one. */
  readonly unit: { readonly one: string; readonly many: string };
  /** What was done when it was met, in a few words after "undone:" in a moderation log: "12 posted". */
  readonly met: (params: Readonly<Record<string, unknown>>) => string;
  /** What the demand asks, as the end of "Needs ...": "12 different characters to post on this board". */
  readonly needs: (params: Readonly<Record<string, unknown>>) => string;
  readonly template: (params: Readonly<Record<string, unknown>>, progress: Progress) => string;
}

/** The most a count may ask for: past it a demand is not one a board can meet. */
export const COUNT_MOST = 100_000;

const uuid: Rule = { type: 'string', minLength: 36, maxLength: 36 };
const number: Rule = { type: 'number' };
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const QUADRANT_WORDS: Readonly<Record<string, string>> = {
  excitedPositive: 'excited and positive',
  excitedNegative: 'excited and negative',
  calmPositive: 'calm and positive',
  boredNegative: 'bored and negative',
};

const so = (p: Progress): string => `${p.done} of ${p.of} so far`;

export const DEMAND_KINDS: readonly DemandKind[] = [
  {
    key: 'postsOnBoard',
    unit: { one: 'POST', many: 'POSTS' },
    params: { type: 'object', fields: { board: uuid, count: number } },
    uuids: ['board'],
    numbers: { count: 'count' },
    met: (p) => `${num(p['count'])} posts made`,
    needs: (p) => `${num(p['count'])} new posts on this board`,
    template: (p, g) => `Needs ${num(p['count'])} new posts on this board: ${so(g)}.`,
  },
  {
    key: 'distinctCharactersOnBoard',
    unit: { one: 'POSTER', many: 'POSTERS' },
    params: { type: 'object', fields: { board: uuid, count: number } },
    uuids: ['board'],
    numbers: { count: 'count' },
    met: (p) => `${num(p['count'])} posted`,
    needs: (p) => `${num(p['count'])} different characters to post on this board`,
    template: (p, g) => `Needs ${num(p['count'])} different characters to post on this board: ${so(g)}.`,
  },
  {
    key: 'quadrantOnBoard',
    unit: { one: 'REACTION', many: 'REACTIONS' },
    params: { type: 'object', fields: { board: uuid, quadrant: { type: 'enum', values: QUADRANTS }, count: number } },
    uuids: ['board'],
    numbers: { count: 'reactions' },
    met: (p) => `${num(p['count'])} reactions`,
    needs: (p) => `${num(p['count'])} ${QUADRANT_WORDS[String(p['quadrant'])] ?? 'matching'} reactions on new posts on this board`,
    template: (p, g) =>
      `Needs ${num(p['count'])} ${QUADRANT_WORDS[String(p['quadrant'])] ?? 'matching'} reactions on new posts on this board: ${so(g)}.`,
  },
  {
    key: 'characterPostsInThread',
    unit: { one: 'POST', many: 'POSTS' },
    params: { type: 'object', fields: { character: uuid, thread: uuid } },
    uuids: ['character', 'thread'],
    numbers: {},
    met: () => 'the named character posted',
    needs: () => 'one named character to post in one named thread',
    template: (_p, g) => `Needs one named character to post in one named thread: ${so(g)}.`,
  },
  {
    key: 'crossQuote',
    unit: { one: 'QUOTE', many: 'QUOTES' },
    params: { type: 'object', fields: { a: uuid, b: uuid, reactions: number } },
    uuids: ['a', 'b'],
    numbers: { reactions: 'reactions' },
    met: () => 'they quoted each other',
    needs: (p) => `two named characters to quote each other, each reply drawing ${num(p['reactions'])} reactions`,
    template: (p, g) =>
      `Needs two named characters to quote each other, each reply drawing ${num(p['reactions'])} reactions: ${so(g)}.`,
  },
];

/**
 * A demand in plain words with no count of progress, for a move that has not landed (the admin queue): "Needs 8 different characters
 * to post on this board." A key outside the whitelist is said so, plainly, and never guessed at.
 */
export function demandAsk(demand: { readonly kind: string; readonly params: Readonly<Record<string, unknown>> }): string {
  const kind = demandKind(demand.kind);
  return kind ? `Needs ${kind.needs(demand.params)}.` : 'Needs something The System does not have a plain word for.';
}

/** A demand in plain words with the progress made, for a move in force: "Needs 12 different characters to post on this board: 7 of 12 so far." */
export function demandWords(demand: { readonly kind: string; readonly params: Readonly<Record<string, unknown>> }, progress: Progress): string {
  const kind = demandKind(demand.kind);
  return kind ? kind.template(demand.params, progress) : demandAsk(demand);
}

export function demandKind(key: string): DemandKind | undefined {
  return DEMAND_KINDS.find((k) => k.key === key);
}

/**
 * A demand, `{kind, params}`, against the whitelist: the kind is in it, the params have its shape, every uuid is one, every
 * count is a whole number from 1 and every reaction threshold a whole number from `reactionCap + 1`. Rejects only what cannot be
 * repaired without inventing content, naming the path and the predicate (`atLeast(4)` for a threshold the cap reaches). The
 * repaired demand is returned on success.
 */
export function demandProblems(demand: unknown, reactionCap: number): Repaired {
  const no = (path: string, predicate: string): Repaired => ({ ok: false, path, predicate, trims: [] });
  if (typeof demand !== 'object' || demand === null || Array.isArray(demand)) return no('demand', 'isObject');
  const given = demand as Record<string, unknown>;
  const kind = typeof given['kind'] === 'string' ? demandKind(given['kind']) : undefined;
  if (!kind) return no('demand.kind', `oneOf(${DEMAND_KINDS.map((k) => k.key).join(', ')})`);
  const out = repair(given['params'], kind.params);
  if (!out.ok) return { ...out, path: out.path ? `demand.params.${out.path}` : 'demand.params' };
  const params = out.value as Record<string, unknown>;
  for (const name of kind.uuids) {
    if (!UUID.test(String(params[name]))) return no(`demand.params.${name}`, 'isUuid');
    // Postgres writes uuids in lowercase and SQL compares them as text, so they are normalized here (not a bound, so no trim).
    params[name] = String(params[name]).toLowerCase();
  }
  // Two named characters are two: a crossQuote of one with itself could never be quoted "each other".
  if (kind.key === 'crossQuote' && params['a'] === params['b']) return no('demand.params.b', 'distinctCharacters');
  for (const [name, how] of Object.entries(kind.numbers)) {
    const v = params[name] as number;
    const least = how === 'reactions' ? reactionCap + 1 : 1;
    if (!Number.isInteger(v)) return no(`demand.params.${name}`, 'isWhole');
    if (v < least) return no(`demand.params.${name}`, `atLeast(${least})`);
    if (v > COUNT_MOST) return no(`demand.params.${name}`, `atMost(${COUNT_MOST})`);
  }
  return { ok: true, value: { kind: kind.key, params }, trims: out.trims };
}
