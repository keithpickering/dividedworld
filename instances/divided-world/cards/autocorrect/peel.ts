/**
 * What the author's save holds once a strip is peeled whole (docs/plans/2026-11-11-autocorrect-tape-design.md, section 9): a strip
 * is kept by its place, one occurrence of one play's phrase in the post's order (match.ts), so "the second Mario" stays peeled across
 * edits that keep the order. The strips themselves, and a half peel's stretches, are tape.ts's.
 */

/** The author's save once they peel a place: every place peeled, in order, and clean once none is left in this version. */
export function savedAfterPeel(peeled: readonly number[], index: number, total: number): { peeled: number[]; clean?: true } {
  const kept = [...new Set([...peeled, index])].sort((a, b) => a - b);
  const clean = total > 0 && Array.from({ length: total }, (_, i) => i).every((i) => kept.includes(i));
  return clean ? { peeled: kept, clean: true } : { peeled: kept };
}
