/**
 * When two characters' names are the same name (the owner's answer 12, on #4): the same once
 * case is folded and every letter that looks like another across scripts is folded to the one
 * prototype both look like (UTS #39's confusable skeleton). A Cyrillic а in "Pipewrench" is the
 * same name; "Pipewrench II" is another. A perfect lookalike would let one player put words in
 * another character's mouth with no card and no cost.
 *
 * A name has two keys, and two names are the same name where either key is: folded, with case
 * ignored and then every lookalike folded; and as written, every lookalike folded with case as
 * it is. Both are needed because whether a letter looks like another depends on its case: as
 * written, a capital I is the l it looks like, and so is a 1, but folding case first makes the I
 * an i, which looks like neither.
 *
 * The database decides (supabase/migrations/0011_names.sql holds both keys unique, as
 * name_skeleton and name_look); these are the same keys for the client's preview, from the
 * same data (name-folds.data.ts, which tools/check-name-folds.mjs holds the database's copy
 * to), in the database's steps, so a name the client says is free is one the database takes.
 * Decomposing is the data's too, never String.prototype.normalize, whose Unicode is the
 * browser's and not the database's.
 */
import { NAME_FOLDS } from './name-folds.data.ts';

const mapped = (s: string, table: Readonly<Record<string, string>>) => [...s].map((c) => table[c] ?? c).join('');

/* Hangul syllables decompose by Unicode's algorithm (chapter 3.12), not by a table. */
const S_BASE = 0xac00, L_BASE = 0x1100, V_BASE = 0x1161, T_BASE = 0x11a7, T_COUNT = 28, N_COUNT = 21 * T_COUNT, S_COUNT = 19 * N_COUNT;
const hangul = (c: string): string | undefined => {
  const s = c.codePointAt(0)! - S_BASE;
  if (s < 0 || s >= S_COUNT) return undefined;
  const t = s % T_COUNT;
  return String.fromCodePoint(L_BASE + Math.floor(s / N_COUNT), V_BASE + Math.floor((s % N_COUNT) / T_COUNT)) + (t ? String.fromCodePoint(T_BASE + t) : '');
};

/**
 * Canonical decomposition: each code point to its full decomposition, then each run of marks
 * after a starter (combining class 0) put in order of class, keeping the order of marks of one
 * class. 0011_names.sql's name_nfd does the same, by the same ordering key.
 */
export function nfd(s: string): string {
  const chars = [...s].flatMap((c) => [...(NAME_FOLDS.decompose[c] ?? hangul(c) ?? c)]);
  let run = 0;
  return chars
    .map((c, i) => { const ccc = NAME_FOLDS.ccc[c] ?? 0; if (ccc === 0) run++; return { c, ccc, run, i }; })
    .sort((a, b) => a.run - b.run || a.ccc - b.ccc || a.i - b.i)
    .map((x) => x.c)
    .join('');
}

/**
 * A name's two keys. Folded: decompose, fold case, decompose, fold lookalikes, decompose, fold
 * case again (a prototype may be a capital), decompose. As written: decompose, fold lookalikes,
 * decompose.
 */
export function nameKeys(name: string): { readonly folded: string; readonly look: string } {
  return {
    folded: nfd(mapped(nfd(mapped(nfd(mapped(nfd(name), NAME_FOLDS.fold)), NAME_FOLDS.confusable)), NAME_FOLDS.fold)),
    look: nfd(mapped(nfd(name), NAME_FOLDS.confusable)),
  };
}

/** Whether two names are the same name: where either key is. */
export function sameName(a: string, b: string): boolean {
  const x = nameKeys(a);
  const y = nameKeys(b);
  return x.folded === y.folded || x.look === y.look;
}
