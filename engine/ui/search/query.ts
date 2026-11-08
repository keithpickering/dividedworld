/**
 * The address of a search (docs/plans/2026-11-07-search-design.md, section 5): every field of the form is in the URL, so a search is a
 * link anyone can share. This reads an address into a `SearchQuery` (and the view, the page and the cursor that reaches it) and writes
 * one back; a value it does not know drops to the field's default, so a mangled link opens the form, never an error.
 *
 *   q, author, board, from, to (a day, the reader's own: from is its first moment, to its last), in=titles, as=threads,
 *   sort=newest|oldest|relevance, per (1 to SEARCH_PER_PAGE_MAX), page, after (rank|time|act, the last result of the page before).
 *
 * A page past the first is reached by its cursor alone (keyset paging), so a `page` without a readable `after` is the first page.
 * Defaults are left out of the address, so the blank search is `/search`.
 */
import { SEARCH_PER_PAGE_MAX, type SearchCursor, type SearchQuery, type SearchSort } from '../data/api.ts';

export type SearchView = 'posts' | 'threads';
export interface SearchAsk { readonly query: SearchQuery; readonly view: SearchView; readonly page: number; readonly after: SearchCursor | null }

const MAX_PAGE = 10_000;
const SORTS: readonly SearchSort[] = ['relevance', 'newest', 'oldest'];
const ID = /^[\w-]{1,64}$/u;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

const idOf = (v: string | null): string | null => (v !== null && ID.test(v) ? v : null);

/** A day as `YYYY-MM-DD` to the first or the last moment of it in the reader's zone; null for anything that is not a real day. */
function dayAt(v: string | null, end: boolean): string | null {
  const m = v === null ? null : DAY.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = end ? new Date(y, mo - 1, d, 23, 59, 59, 999) : new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) return null;
  return at.toISOString();
}

/** The reader's day an instant falls on, as `YYYY-MM-DD`. */
export function dayOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getFullYear()).padStart(4, '0')}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

function cursorOf(v: string | null): SearchCursor | null {
  const parts = v === null ? [] : v.split('|');
  if (parts.length !== 3) return null;
  const [rank, at, act] = parts as [string, string, string];
  const n = rank === '' ? null : Number(rank);
  if (n !== null && !Number.isFinite(n)) return null;
  if (!Number.isFinite(Date.parse(at)) || !ID.test(act)) return null;
  return { rank: n, at, act };
}

export function parseSearch(params: URLSearchParams): SearchAsk {
  const sort = params.get('sort');
  const per = Number(params.get('per'));
  const after = cursorOf(params.get('after'));
  const asked = Number(params.get('page'));
  return {
    query: {
      q: (params.get('q') ?? '').trim(),
      author: idOf(params.get('author')),
      board: idOf(params.get('board')),
      fromAt: dayAt(params.get('from'), false),
      toAt: dayAt(params.get('to'), true),
      titlesOnly: params.get('in') === 'titles',
      sort: SORTS.find((s) => s === sort) ?? null,
      perPage: Number.isInteger(per) && per >= 1 && per <= SEARCH_PER_PAGE_MAX ? per : null,
    },
    view: params.get('as') === 'threads' ? 'threads' : 'posts',
    page: after !== null && Number.isInteger(asked) && asked > 1 ? Math.min(asked, MAX_PAGE) : 1,
    after: after !== null && Number.isInteger(asked) && asked > 1 ? after : null,
  };
}

export function searchParams(ask: SearchAsk): URLSearchParams {
  const out = new URLSearchParams();
  const { query: q } = ask;
  if (q.q !== '') out.set('q', q.q);
  if (q.author !== null) out.set('author', q.author);
  if (q.board !== null) out.set('board', q.board);
  if (q.fromAt !== null) out.set('from', dayOf(q.fromAt));
  if (q.toAt !== null) out.set('to', dayOf(q.toAt));
  if (q.titlesOnly) out.set('in', 'titles');
  if (ask.view === 'threads') out.set('as', 'threads');
  if (q.sort !== null) out.set('sort', q.sort);
  if (q.perPage !== null) out.set('per', String(q.perPage));
  if (ask.page > 1 && ask.after !== null) {
    out.set('page', String(ask.page));
    out.set('after', `${ask.after.rank ?? ''}|${ask.after.at}|${ask.after.act}`);
  }
  return out;
}

export function searchHref(ask: SearchAsk): string {
  const text = String(searchParams(ask));
  return text ? `/search?${text}` : '/search';
}

/** Whether there is anything to ask: a keyword or a filter. The form alone (or only "titles only") is the page before a search. */
export function isSearching(q: SearchQuery): boolean {
  return q.q.trim() !== '' || q.author !== null || q.board !== null || q.fromAt !== null || q.toAt !== null;
}
