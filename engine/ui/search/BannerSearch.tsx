/**
 * The banner's search box (docs/plans/2026-11-07-search-design.md, section 7): suggest as you type, and Enter searches posts. It stands
 * on a row of its own under the host line (the owner's amendment), on every page but `/search`, whose form has the same box in its Keywords field. Signed in only: the frame
 * does not draw it for a visitor, who reads no thread.
 */
import { useKayfa } from '../context.tsx';
import { useNavigate } from '../router.tsx';
import { BoardCombobox } from './BoardCombobox.tsx';
import { searchPostsFor, suggestionHref, suggestSource } from './suggest.ts';
import { searchHref, parseSearch } from './query.ts';
import { useMemo, useState } from 'react';

export function BannerSearch() {
  const { api } = useKayfa();
  const navigate = useNavigate();
  const source = useMemo(() => suggestSource(api), [api]);
  const [typed, setTyped] = useState('');
  /* Words typed, as typed, to the results page; nothing typed is the page's plain form. */
  const searchFor = (q: string) => {
    const blank = parseSearch(new URLSearchParams());
    navigate(searchHref({ ...blank, query: { ...blank.query, q: q.trim() } }));
  };
  return (
    <form className="kb-banner-search" role="search" onSubmit={(e) => { e.preventDefault(); searchFor(typed); }}>
      <BoardCombobox
        label="Search the boards" placeholder="Search" source={source} trailing={searchPostsFor} onQueryChange={setTyped}
        onChoose={(option, group, typed) => {
          const to = suggestionHref(group, option.id);
          if (to !== null) { navigate(to); return; }
          // The trailing row stands for the typed words, which the box hands over.
          searchFor(typed);
        }}
      />
      <button type="submit" className="kb-button" data-kb-size="small">Search</button>
    </form>
  );
}
