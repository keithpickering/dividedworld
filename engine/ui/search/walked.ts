/**
 * The pages a player has walked in one search. Paging is by a cursor over the last result shown (keyset), so a page can be reached only
 * from the page before it: the numbered pages are the ones walked, each with the cursor that reaches it. The memory is one search's
 * (a new search forgets the last), kept outside the screen because the page is loaded again on every move and the screen with it.
 * Only a page's own `next` is recorded, so a cursor typed into the address is never taken for a page walked. Reading never changes it.
 */
import type { SearchCursor } from '../data/api.ts';

let held: { sig: string; cursors: Map<number, SearchCursor> } = { sig: '', cursors: new Map() };
const none: ReadonlyMap<number, SearchCursor> = new Map();

/** The cursors of the search `sig` names, by the page each reaches (page 1 has none); none if the memory is another search's. */
export function walkOf(sig: string): Map<number, SearchCursor> {
  return held.sig === sig ? held.cursors : (none as Map<number, SearchCursor>);
}

/** Record that `cursor` reaches `page` in the search `sig`, as the page before it showed; a different search than the last forgets the last. */
export function recordWalk(sig: string, page: number, cursor: SearchCursor): void {
  if (held.sig !== sig) held = { sig, cursors: new Map() };
  held.cursors.set(page, cursor);
}

export function forgetWalk(): void {
  held = { sig: '', cursors: new Map() };
}
