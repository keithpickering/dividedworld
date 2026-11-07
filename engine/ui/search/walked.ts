/**
 * The pages a player has walked in one search. Paging is by a cursor over the last result shown (keyset), so a page can be reached only
 * from the page before it: the numbered pages are the ones walked, each with the cursor that reaches it. The memory is one search's
 * (a new search forgets the last), kept outside the screen because the page is loaded again on every move and the screen with it.
 */
import type { SearchCursor } from '../data/api.ts';

let held: { sig: string; cursors: Map<number, SearchCursor> } = { sig: '', cursors: new Map() };

/** The cursors of the search `sig` names, by the page each reaches (page 1 has none). */
export function walkOf(sig: string): Map<number, SearchCursor> {
  if (held.sig !== sig) held = { sig, cursors: new Map() };
  return held.cursors;
}

export function forgetWalk(): void {
  held = { sig: '', cursors: new Map() };
}
