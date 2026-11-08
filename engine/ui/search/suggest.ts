/**
 * What the board's search box suggests and where a choice goes (docs/plans/2026-11-07-search-design.md, section 7), shared by the
 * banner's box and the `/search` page's keyword field, which suggest alike. Up to five threads, three characters and three boards, under
 * their group heads; a thread opens, a board opens, a character opens a search of their posts. The last row is "Search posts for ...".
 * An option's `id` is what its group needs to go there: a thread's id, a character's id, a board's slug.
 */
import type { KayfaApi } from '../data/api.ts';
import type { ComboGroup, ComboOption, ComboSource } from './useSearchCombobox.ts';

export const SUGGEST_THREADS = 5;
export const SUGGEST_OTHERS = 3;

export function suggestSource(api: KayfaApi): ComboSource {
  return async (query, signal): Promise<readonly ComboGroup[]> => {
    const found = await api.suggest(query, { most: SUGGEST_THREADS });
    if (signal.aborted) return [];
    return [
      { key: 'threads', label: 'Threads', options: found.threads.map((t) => ({ id: t.id, label: t.title, detail: t.boardName })) },
      { key: 'characters', label: 'Characters', options: found.characters.slice(0, SUGGEST_OTHERS).map((c) => ({ id: c.id, label: c.name, detail: 'their posts' })) },
      { key: 'boards', label: 'Boards', options: found.boards.slice(0, SUGGEST_OTHERS).map((b) => ({ id: b.slug, label: b.name })), empty: 'No board matches.' },
    ];
  };
}

/** The characters-only source of the Posted by field. */
export function charactersSource(api: KayfaApi): ComboSource {
  return async (query, signal): Promise<readonly ComboGroup[]> => {
    const found = await api.suggest(query, { kinds: ['characters'], most: 8 });
    if (signal.aborted) return [];
    return [{ key: 'characters', label: 'Characters', options: found.characters.map((c) => ({ id: c.id, label: c.name })), empty: 'No character matches.' }];
  };
}

export const searchPostsFor = (query: string): ComboOption => ({ id: 'search-posts', label: `Search posts for “${query}”`, detail: 'Enter' });

/** Where a chosen suggestion goes; null for the trailing row, which the caller sends to the search for the typed words. */
export function suggestionHref(groupKey: string | null, id: string): string | null {
  switch (groupKey) {
    case 'threads': return `/t/${encodeURIComponent(id)}`;
    case 'boards': return `/b/${encodeURIComponent(id)}`;
    case 'characters': return `/search?author=${encodeURIComponent(id)}`;
    default: return null;
  }
}
