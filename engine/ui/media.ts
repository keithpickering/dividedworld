/**
 * The window's width, as the stylesheets' breakpoints read it, for the few places that draw different words by it (a date on a phone drops
 * its year; a post's marks are fewer in the narrow thread). A screen with no `matchMedia` is wide.
 */
import { useSyncExternalStore } from 'react';

/** The thread's narrow width (thread.css's 40em, where a post is stacked): a post's marks are fewer there. */
const NARROW = '(max-width: 40em)';
/** The Lens is a sheet up to a tablet's width (64em, 1024px) and a dock at the right above it: below that the thread's column, narrowed by the dock, would be too narrow to read. */
const SHEET = '(max-width: 64em)';
/* One query each for the page, however many posts ask it, with one listener behind every post's subscription; asked again only if the window's `matchMedia` is another. */
const queries = new Map<string, { readonly source: typeof globalThis.matchMedia; readonly list: MediaQueryList }>();
const watchers = new Map<string, Set<() => void>>();
const queryOf = (query: string): MediaQueryList | null => {
  const source = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia : null;
  if (!source) return null;
  const known = queries.get(query);
  if (known?.source === source) return known.list;
  const list = source(query);
  list.addEventListener?.('change', () => { for (const w of [...(watchers.get(query) ?? [])]) w(); });
  queries.set(query, { source, list });
  return list;
};
const watching = (query: string) => (changed: () => void) => {
  const set = watchers.get(query) ?? new Set<() => void>();
  watchers.set(query, set);
  set.add(changed);
  return () => { set.delete(changed); };
};
const watchNarrow = watching(NARROW);
const watchSheet = watching(SHEET);
/** Whether the window is at the thread's narrow width; a screen with no `matchMedia` is wide. */
export const useNarrow = (): boolean => useSyncExternalStore(watchNarrow, () => queryOf(NARROW)?.matches ?? false, () => false);
/** Whether the Lens is a sheet in this window (a tablet's width or less); a screen with no `matchMedia` is wide. */
export const useSheet = (): boolean => useSyncExternalStore(watchSheet, () => queryOf(SHEET)?.matches ?? false, () => false);
