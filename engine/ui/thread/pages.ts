/**
 * A thread's pages. Every Act that is not an edit takes a seq in its thread, posts, cards, spins,
 * unmasks and tallies alike, so a page is a range of seqs: page N holds (N-1)*P+1 to N*P, with P
 * the instance's posts per page. The seq is what a permalink names (`?page=N#post-M`), and no
 * address carries a character.
 */
import type { Id } from '../data/api.ts';

/** The page a seq is on. */
export const pageOf = (seq: number, perPage: number): number => Math.max(1, Math.ceil(seq / perPage));

/** The seqs a page holds, both ends included. */
export const pageRange = (page: number, perPage: number): { readonly start: number; readonly end: number } => ({ start: (page - 1) * perPage + 1, end: page * perPage });

/** The address of a page, or of a post on it. */
export const threadHref = (thread: Id, page: number, seq?: number): string => `/t/${thread}?page=${page}${seq === undefined ? '' : `#post-${seq}`}`;

/** The seq a `#post-M` fragment names, or null. */
export function seqOfHash(hash: string): number | null {
  const m = /^post-(\d{1,9})$/.exec(hash.replace(/^#/, ''));
  return m ? Number(m[1]) : null;
}
