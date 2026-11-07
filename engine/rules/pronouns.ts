/**
 * A character's pronouns (docs/plans/2026-11-05-pronouns-design.md, as amended by 2026-11-07-pronouns-design.md): the set's
 * shape, the four presets, the check every writer of a set shares, and the words copy and staff stock lines are written
 * with. The default is an instance's (`Settings.pronouns`); the engine's own fallback is it/its.
 */
export interface PronounSet {
  readonly subject: string;     // they
  readonly object: string;      // them
  readonly determiner: string;  // their (card)
  readonly possessive: string;  // theirs
  readonly reflexive: string;   // themself
  readonly plural: boolean;     // verbs agree like "they are"
}

export type PronounPreset = 'it' | 'he' | 'she' | 'they';

export const PRONOUN_PRESETS: Readonly<Record<PronounPreset, PronounSet>> = Object.freeze({
  it: Object.freeze({ subject: 'it', object: 'it', determiner: 'its', possessive: 'its', reflexive: 'itself', plural: false }),
  he: Object.freeze({ subject: 'he', object: 'him', determiner: 'his', possessive: 'his', reflexive: 'himself', plural: false }),
  she: Object.freeze({ subject: 'she', object: 'her', determiner: 'her', possessive: 'hers', reflexive: 'herself', plural: false }),
  they: Object.freeze({ subject: 'they', object: 'them', determiner: 'their', possessive: 'theirs', reflexive: 'themself', plural: true }),
});

/** The engine's fallback for a seed that names no pronouns; it matches every line written before pronouns existed. */
export const ENGINE_DEFAULT_PRONOUNS: PronounSet = PRONOUN_PRESETS.it;

const SET_KEYS = ['subject', 'object', 'determiner', 'possessive', 'reflexive'] as const;
export const PRONOUN_FORM_MAX = 12;

/**
 * Problems with a pronoun set, each a sentence naming the predicate that failed; none when it is a good set. A form is 1 to 12
 * code points: letters and combining marks, with an apostrophe (' or ’) or a hyphen allowed between two letters.
 */
export function pronounProblems(v: unknown): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['the pronouns are not an object of five forms and a plural flag'];
  const o = v as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(o)) if (![...SET_KEYS, 'plural'].includes(k)) out.push(`the pronouns have "${k}", which is not a form`);
  for (const k of SET_KEYS) {
    if (!(k in o) || o[k] === undefined) { out.push(`the pronouns have no ${k}`); continue; }
    const f = o[k];
    if (typeof f !== 'string') { out.push(`the ${k} is not text`); continue; }
    const cps = [...f];
    if (cps.length === 0) { out.push(`the ${k} is empty`); continue; }
    if (cps.length > PRONOUN_FORM_MAX) out.push(`the ${k} has ${cps.length} characters; at most ${PRONOUN_FORM_MAX}`);
    const seen = new Set<string>();
    cps.forEach((c, i) => {
      const letter = (x: string | undefined) => x !== undefined && /^\p{L}$/u.test(x);
      if (/^[\p{L}\p{M}]$/u.test(c)) return;
      if (c === '-' || c === "'" || c === '’') {
        if (!(letter(cps[i + 1]) && (letter(cps[i - 1]) || (cps[i - 1] !== undefined && /^\p{M}$/u.test(cps[i - 1]!))))) {
          const msg = `the ${k} has ${c === '-' ? 'a hyphen' : 'an apostrophe'} that is not between two letters`;
          if (!seen.has(msg)) { seen.add(msg); out.push(msg); }
        }
        return;
      }
      const msg = /^\s$/u.test(c) ? `the ${k} holds a space` : `the ${k} holds a character that is not a letter (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`;
      if (!seen.has(msg)) { seen.add(msg); out.push(msg); }
    });
    if (cps.length && !/^\p{L}$/u.test(cps[0]!) && !out.some((p) => p.startsWith(`the ${k} `))) out.push(`the ${k} starts with a combining mark; it starts with a letter`);
  }
  if (!('plural' in o) || o.plural === undefined) out.push('the pronouns have no plural');
  else if (typeof o.plural !== 'boolean') out.push('the plural is not true or false');
  return out;
}

/** The set trimmed and lowercased, for storing; it does not repair a set `pronounProblems` refuses. */
export function normalizePronouns(set: PronounSet): PronounSet {
  const n = (s: string) => s.trim().toLowerCase();
  return { subject: n(set.subject), object: n(set.object), determiner: n(set.determiner), possessive: n(set.possessive), reflexive: n(set.reflexive), plural: set.plural };
}

/** The label a player reads: `subject/object`, or `subject/determiner` when object equals subject (it/its). */
export function pronounLabel(set: PronounSet): string {
  return set.object === set.subject ? `${set.subject}/${set.determiner}` : `${set.subject}/${set.object}`;
}

/** Which preset a set is, after normalizing; null for a custom set. */
export function presetOf(set: PronounSet): PronounPreset | null {
  const n = normalizePronouns(set);
  for (const [key, p] of Object.entries(PRONOUN_PRESETS) as [PronounPreset, PronounSet][]) {
    if (SET_KEYS.every((k) => p[k] === n[k]) && p.plural === n.plural) return key;
  }
  return null;
}

/** The fifteen keys of the words table (the amendment, section 1): the they-set's words, each capitalized too, and the verbs. */
export const PRONOUN_FORMS = [
  'they', 'They', 'them', 'Them', 'their', 'Their', 'theirs', 'Theirs', 'themself', 'Themself',
  'is', 'was', 'has', 'does', 's',
] as const;
export type PronounForm = (typeof PRONOUN_FORMS)[number];

const cap = (s: string) => { const [first = '', ...rest] = [...s]; return first.toUpperCase() + rest.join(''); };

/**
 * One shape for copy and for stock-line tokens (`{mod.they}`): the keys are the they-set's words, the values the set's own.
 * It does not repeat a/an (`withArticle`) or plurals of nouns.
 */
export function words(set: PronounSet): Readonly<Record<PronounForm, string>> {
  const base = { they: set.subject, them: set.object, their: set.determiner, theirs: set.possessive, themself: set.reflexive };
  const verbs = set.plural
    ? { is: 'are', was: 'were', has: 'have', does: 'do', s: '' }
    : { is: 'is', was: 'was', has: 'has', does: 'does', s: 's' };
  const out: Record<string, string> = { ...verbs };
  for (const [k, v] of Object.entries(base)) { out[k] = v; out[cap(k)] = cap(v); }
  return Object.freeze(out) as Readonly<Record<PronounForm, string>>;
}

/** What a persona is told about itself, after its premise (the amendment, section 2). */
export function selfPronounLine(set: PronounSet): string {
  return `Your pronouns are ${pronounLabel(set)} (${set.subject}, ${set.object}, ${set.determiner}, ${set.possessive}, ${set.reflexive}).`;
}

/** A character as every prompt writes it: `Gloomba (she/her)`. */
export function taggedName(name: string, set: PronounSet): string {
  return `${name} (${pronounLabel(set)})`;
}

/** The set a read gave, else the fallback (a persona's own, else `Settings.pronouns`, else `ENGINE_DEFAULT_PRONOUNS`): a character with no profile row reads null. */
export function pronounsOr(read: PronounSet | null | undefined, fallback: PronounSet): PronounSet {
  return read ?? fallback;
}
