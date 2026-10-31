/**
 * A thread's pages. Every Act that is not an edit or a card takes a seq in its thread, posts, spins,
 * unmasks and tallies alike (a card play is a tag on its post, supabase/migrations/0035_card_takes_no_seq.sql),
 * so a page is a range of seqs: page N holds (N-1)*P+1 to N*P, with P
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

/**
 * Whether a read of a page reached the end of the thread: it came back short, and the range it was
 * asked for takes in the thread's last number. A short page that stops before the last number is a
 * gap in the numbering (a card numbered before cards took none), not the end.
 */
export const pageEndsThread = (count: number, range: { readonly start: number; readonly end: number }, lastSeq: number): boolean =>
  count < range.end - range.start + 1 && range.end >= lastSeq;
