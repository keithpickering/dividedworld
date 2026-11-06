/**
 * The rule predicates (Mod Bots design, section 4): the engine's one fixed list of what a `setRule` move may demand of a post.
 * Each is checked by plain code when a post is made, reading only the post, its thread and the character's own public posts,
 * never who owns the mask; a rule never refuses a post, it draws a visit. This is the one list: `seed_instance` writes it to
 * `rule_predicates` (supabase/functions/_shared/seed.ts), and `rule_breaks` (supabase/migrations/0100_rules.sql) has a branch for
 * every key, which supabase/tests/0102-rule-predicates.sql proves ("Two lists that must agree are one list").
 *
 * A parameter is bounded here, and a bound overshot is a rule rejected naming the predicate that failed, never a rule changed:
 * a threshold nudged to fit would be a rule nobody set.
 *
 * Pure: nothing here reads a clock or a database.
 */
import { BBCODE_TAGS } from '../bbcode/parse.ts';

export type ParamKind = 'none' | 'count' | 'word' | 'tag';

export interface Predicate {
  readonly key: string;
  /** What the parameter is: nothing, a whole number, one word, or a BBCode tag. */
  readonly param: ParamKind;
  /** A count's range, or a word's length range; null for a predicate with no parameter and for a tag (the parser's list). */
  readonly bounds: { readonly least: number; readonly most: number } | null;
  /** The rule in plain words ("no double posting", "at least 5 characters"). `plain('{param}')` is the template the seed carries. */
  readonly plain: (param: unknown) => string;
}

const WORD = { least: 1, most: 40 } as const;

export const PREDICATES: readonly Predicate[] = [
  { key: 'minLength', param: 'count', bounds: { least: 1, most: 200 }, plain: (n) => `posts of at least ${String(n)} characters` },
  { key: 'maxLength', param: 'count', bounds: { least: 20, most: 20000 }, plain: (n) => `posts of at most ${String(n)} characters` },
  { key: 'noAllCaps', param: 'none', bounds: null, plain: () => 'no all-caps posts' },
  { key: 'noDoublePost', param: 'none', bounds: null, plain: () => 'no double posting' },
  { key: 'noNecropost', param: 'count', bounds: { least: 1, most: 365 }, plain: (n) => `no replies to a thread quiet for more than ${String(n)} days` },
  { key: 'noDuplicateTitle', param: 'none', bounds: null, plain: () => 'no thread titled like a live one on the board' },
  { key: 'bannedWord', param: 'word', bounds: WORD, plain: (w) => `the word "${String(w)}" is banned` },
  { key: 'requiredWord', param: 'word', bounds: WORD, plain: (w) => `every post says "${String(w)}"` },
  { key: 'noTag', param: 'tag', bounds: null, plain: (t) => `no [${String(t)}] tags` },
  { key: 'repliesOnly', param: 'none', bounds: null, plain: () => 'replies only, no new threads' },
];

export function predicate(key: string): Predicate | undefined {
  return PREDICATES.find((p) => p.key === key);
}

export interface PredicateProblem {
  readonly path: 'predicate' | 'param';
  /** The predicate that failed, in `repair`'s words (`atMost(200)`, `oneOf(...)`). */
  readonly predicate: string;
}

/** A rule's key and parameter against the catalog: null when both hold, else the one thing that failed. */
export function predicateProblems(key: string, param: unknown): PredicateProblem | null {
  const p = predicate(key);
  if (!p) return { path: 'predicate', predicate: `oneOf(${PREDICATES.map((x) => x.key).join(', ')})` };
  const no = (predicate: string): PredicateProblem => ({ path: 'param', predicate });
  const absent = param === null || param === undefined;
  switch (p.param) {
    case 'none':
      return absent ? null : no('noParam');
    case 'count': {
      if (absent) return no('required');
      if (typeof param !== 'number' || !Number.isInteger(param)) return no('isInteger');
      const b = p.bounds!;
      return param < b.least ? no(`atLeast(${b.least})`) : param > b.most ? no(`atMost(${b.most})`) : null;
    }
    case 'word': {
      if (absent) return no('required');
      if (typeof param !== 'string') return no('isString');
      const b = p.bounds!;
      if (param.length < b.least) return no(`atLeast(${b.least})`);
      if (param.length > b.most) return no(`atMost(${b.most})`);
      return /\s/.test(param) ? no('noSpaces') : null;
    }
    case 'tag':
      if (absent) return no('required');
      return typeof param === 'string' && BBCODE_TAGS.includes(param) ? null : no(`oneOf(${BBCODE_TAGS.join(', ')})`);
  }
}
