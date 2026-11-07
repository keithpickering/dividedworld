/**
 * The results page, `/search` (docs/plans/2026-11-07-search-design.md, section 5; the board docs/research/2026-11-07-search/01-search.html):
 * a 2003 panel, "Search the boards", and under it the results as posts or as threads, twenty to a page.
 *
 * Every field of the form is in the address (query.ts), so a search is a link anyone can share and Back returns to it. The page is the
 * document the router loaded (screen-docs.ts, `loadSearch`): the form posts nothing, it moves to a new address. A page past the first is
 * reached by the cursor of the one before it, so the numbered pages are the ones this player has walked (walked.ts).
 *
 * Out of character throughout: the count line says what the search did (an exact count, "More than 1,000", or that a relevance search
 * ranked only the newest of the instance's pool), and a refusal says plainly that it was one.
 *
 * The matched words in a snippet are `mark` elements, drawn bold in a dashed outline (search.css); color is never what says it. A card
 * live on a post is drawn as its mark is on the post (cards/marks.css), a still tile with its card's name for a screen reader.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import { SEARCH_COUNT_CAP, SEARCH_PER_PAGE, type BoardSummary, type PostHit, type SearchCursor, type SearchSort, type ThreadHit } from '../data/api.ts';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { Mini } from '../mini.tsx';
import { Link, useNavigate } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc, type SearchDoc } from '../screen-docs.ts';
import { BoardCombobox } from './BoardCombobox.tsx';
import { snippetParts } from './highlight.ts';
import { dayOf, isSearching, parseSearch, searchHref, searchParams, type SearchAsk } from './query.ts';
import { charactersSource, searchPostsFor, suggestionHref, suggestSource } from './suggest.ts';
import { recordWalk, walkOf } from './walked.ts';
import '../glass/meta-tile.css';
import '../cards/marks.css';
import '../board/board.css';
import './search.css';

const count = (n: number) => n.toLocaleString('en-US');
const ORDER: Readonly<Record<SearchSort, string>> = { relevance: 'best first', newest: 'newest first', oldest: 'oldest first' };
const dateOf = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
const postHref = (h: { readonly thread: string; readonly page: number; readonly seq: number }) => `/t/${encodeURIComponent(h.thread)}?page=${h.page}#post-${h.seq}`;

/** The sort a search uses when none is chosen: relevance with keywords, newest without. */
const effectiveSort = (ask: SearchAsk): SearchSort => ask.query.sort ?? (ask.query.q === '' ? 'newest' : 'relevance');

export function SearchScreen({ doc }: { readonly doc: ScreenDoc<SearchDoc> }) {
  if (isSignedOutDoc(doc)) return <FrontDoor />;
  return <SearchView doc={doc} />;
}

function SearchView({ doc }: { readonly doc: SearchDoc }) {
  const { settings } = useKayfa();
  const { ask } = doc;
  const heading = useRef<HTMLHeadingElement>(null);
  /*
   * The page is loaded again, and the screen mounted again, on every search and page turn, so the old form (and the focus in it) is gone. Frame
   * moves focus only on a change of path, not of query; where focus was lost with the form, it goes to the heading, so a keyboard starts the new
   * page at its top. Focus anywhere inside the page (a move from another page, which the frame has focused) is left alone.
   */
  useEffect(() => {
    const there = document.activeElement;
    if (!there || there === document.body) heading.current?.focus({ preventScroll: true });
  }, []);

  const found = ask.view === 'threads' ? doc.threads : doc.posts;
  const sig = String(searchParams({ ...ask, page: 1, after: null }));
  const held = walkOf(sig);
  const walked = ask.page === 1 || sameCursor(held.get(ask.page), ask.after);
  /* The cursors the pager may link: the ones walked, and the next page's, which this page holds. */
  const cursors = new Map(held);
  if (found?.next) cursors.set(ask.page + 1, found.next);
  const next = found?.next ?? null;
  useEffect(() => { if (next) recordWalk(sig, ask.page + 1, next); }, [sig, ask.page, next]);
  const noun = ask.view === 'threads' ? 'thread' : 'post';

  return (
    <div className="kb-search-page">
      <p className="kb-crumb"><Link to="/">Index</Link> › Search</p>
      <h1 ref={heading} tabIndex={-1} className="kb-heading">Search</h1>
      <SearchForm key={sig} doc={doc} />
      {doc.refused && <p className="kb-notice" data-kb-tone="refusal">That search could not be run. Check the dates and the words, then try again.</p>}
      {doc.unreached && <p className="kb-notice" data-kb-tone="refusal">The search could not reach the server. Check your connection and try again.</p>}
      {found && found.count === 0 && <p className="kb-search-none">No {noun}s match. Try fewer words, or another board.</p>}
      {found && found.count > 0 && (
        <>
          <p className="kb-search-count" data-testid="search-count">{countLine(ask, found, settings.searchRankPool)}</p>
          <Pager ask={ask} found={found} cursors={cursors} walked={walked} where="top" />
          {ask.view === 'threads'
            ? <Results kind="threads" rows={doc.threads!.results} />
            : <Results kind="posts" rows={doc.posts!.results} />}
          <Pager ask={ask} found={found} cursors={cursors} walked={walked} where="bottom" />
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- the count line */

const sameCursor = (a: SearchCursor | undefined, b: SearchCursor | null): boolean => a !== undefined && b !== null && a.rank === b.rank && a.at === b.at && a.act === b.act;

function countLine(ask: SearchAsk, found: { readonly count: number; readonly more: boolean; readonly pooled: boolean }, pool: number) {
  const noun = ask.view === 'threads' ? 'thread' : 'post';
  if (found.pooled) {
    return ask.view === 'threads'
      ? `More than ${count(pool)} posts match; threads are found among the newest ${count(pool)}.`
      : `More than ${count(pool)} posts match; ranked among the newest ${count(pool)}. Sort by newest to see them all.`;
  }
  const order = ORDER[effectiveSort(ask)];
  if (found.more) return <><b>More than {count(SEARCH_COUNT_CAP)} {noun}s</b> match, {order}.</>;
  return found.count === 1 ? <><b>1 {noun}</b> matches, {order}.</> : <><b>{count(found.count)} {noun}s</b> match, {order}.</>;
}

/* --------------------------------------------------------------------------------------------------- the pager */

function Pager({ ask, found, cursors, walked, where }: { readonly walked: boolean; readonly ask: SearchAsk; readonly found: { readonly count: number; readonly more: boolean; readonly next: SearchCursor | null }; readonly cursors: ReadonlyMap<number, SearchCursor>; readonly where: 'top' | 'bottom' }) {
  const per = ask.query.perPage ?? SEARCH_PER_PAGE;
  const pages = found.more ? null : Math.max(1, Math.ceil(found.count / per));
  if (ask.page === 1 && found.next === null) return null;
  const to = (p: number): string | null => {
    if (p === 1) return searchHref({ ...ask, page: 1, after: null });
    const at = cursors.get(p);
    return at ? searchHref({ ...ask, page: p, after: at }) : null;
  };
  /* A page number is shown for a page walked here; a page reached by an address typed or shared has none, since the search has not counted its way there. */
  const numbers = [...new Set([1, ...(walked ? [ask.page] : []), ...cursors.keys()])].sort((a, b) => a - b);
  const before = ask.page > 1 ? to(ask.page - 1) : null;
  const after = found.next ? to(ask.page + 1) : null;
  return (
    <nav className="kb-pager kb-small" aria-label={where === 'top' ? 'Pages of results' : 'More pages of results'}>
      {walked && <span className="kb-pager-where">Page {ask.page}{pages !== null ? ` of ${pages}` : ''}</span>}
      {ask.page > 1 && (before ? <Link to={before}><span aria-hidden="true">‹</span> Previous</Link> : <Link to={to(1)!}>First page</Link>)}
      {numbers.map((p) => (p === ask.page
        ? <span key={p} className="kb-pager-here" aria-current="page">{p}</span>
        : <Link key={p} to={to(p)!} aria-label={`Page ${p}`}>{p}</Link>))}
      {after && <Link to={after}>Next <span aria-hidden="true">›</span></Link>}
    </nav>
  );
}

/* ------------------------------------------------------------------------------------------------- the results */

function Snippet({ text }: { readonly text: string }) {
  return (
    <div className="kb-search-snippet">
      {snippetParts(text).map((p, i) => (p.hit ? <mark key={i} className="kb-search-hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </div>
  );
}

/** A card live on the post, drawn as its mark is on the post (cards/marks.css) but still: this page's marks open nothing. */
function CardMark({ card }: { readonly card: string }) {
  const { instance, ui } = useKayfa();
  const rules = instance.cards.find((c) => c.key === card);
  const art = ui.cards.find((c) => c.key === card)?.art;
  const style = art ? ({ '--kb-mark-color': art.color, ...(art.ink ? { '--kb-mark-ink': art.ink } : {}) } as CSSProperties) : undefined;
  return (
    <span role="img" aria-label={`${rules?.name ?? card} card on this post`} className="kb-mark kb-meta-tile kb-search-mark" data-kb-card={card} data-kb-alignment={rules?.alignment} style={style}>
      <span className="kb-meta-tile-in" aria-hidden="true">
        {art?.mark ? <img className="kb-mark-icon" src={art.mark} alt="" draggable={false} /> : <span className="kb-mark-swatch" />}
      </span>
    </span>
  );
}

function Author({ hit }: { readonly hit: PostHit | ThreadHit }) {
  if (hit.character === null) return <span className="kb-system-name">The System</span>;
  const name = hit.name ?? 'A character';
  return (
    <span className="kb-search-who">
      <Mini character={undefined} name={name} />
      <Link to={`/c/${encodeURIComponent(hit.character)}`}>{name}</Link>
    </span>
  );
}

type Rows = { readonly kind: 'posts'; readonly rows: readonly PostHit[] } | { readonly kind: 'threads'; readonly rows: readonly ThreadHit[] };

function Results(props: Rows) {
  const posts = props.kind === 'posts';
  return (
    <table className="kb-table kb-search-results" >
      <caption className="kb-visually-hidden">{posts ? 'Posts' : 'Threads'} matching the search, best first</caption>
      <thead>
        <tr>
          <th scope="col">{posts ? 'Post' : 'Thread'}</th>
          <th scope="col">Posted by</th>
          <th scope="col">When</th>
        </tr>
      </thead>
      <tbody>
        {(props.rows as readonly (PostHit | ThreadHit)[]).map((h) => (
          <tr key={h.act} className="kb-search-row-result">
            <td>
              <Link to={postHref(h)} className="kb-search-title"><b>{h.title}</b></Link>{' '}
              <span className="kb-small kb-muted">in <Link to={`/b/${encodeURIComponent(h.boardSlug)}`}>{h.boardName}</Link> · page {h.page}</span>
              {'matches' in h && <span className="kb-small kb-muted"> · <span>{h.matchesMore ? `${h.matches}+` : h.matches} matching {h.matches === 1 && !h.matchesMore ? 'post' : 'posts'}</span></span>}
              {h.cards.length > 0 && <span className="kb-search-marks">{h.cards.map((c) => <CardMark key={c} card={c} />)}</span>}
              <Snippet text={h.snippet} />
            </td>
            <td><Author hit={h} /></td>
            <td className="kb-small kb-muted"><time dateTime={h.createdAt}>{dateOf(h.createdAt)}</time></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------------------------------------------ the form */

function useBoards(): readonly BoardSummary[] {
  const { api } = useKayfa();
  const boot = useBoot();
  const [read, setRead] = useState<readonly BoardSummary[]>([]);
  useEffect(() => {
    if (boot) return;
    let live = true;
    void api.boards().then((b) => { if (live) setRead(b); }, () => {});
    return () => { live = false; };
  }, [api, boot]);
  return boot ? boot.boards : read;
}

const dayIn = (iso: string | null): string => (iso === null ? '' : dayOf(iso));

function SearchForm({ doc }: { readonly doc: SearchDoc }) {
  const { api } = useKayfa();
  const navigate = useNavigate();
  const boards = useBoards();
  const { ask } = doc;
  const [q, setQ] = useState(ask.query.q);
  const [author, setAuthor] = useState<{ readonly id: string; readonly name: string } | null>(ask.query.author === null ? null : { id: ask.query.author, name: doc.authorName ?? 'A character' });
  const [board, setBoard] = useState(ask.query.board ?? '');
  const [from, setFrom] = useState(dayIn(ask.query.fromAt));
  const [to, setTo] = useState(dayIn(ask.query.toAt));
  const [titlesOnly, setTitlesOnly] = useState(ask.query.titlesOnly);
  const [view, setView] = useState(ask.view);
  const [sort, setSort] = useState<SearchSort | null>(ask.query.sort);
  const [needed, setNeeded] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const keywords = useRef(suggestSource(api));
  const people = useRef(charactersSource(api));

  const latest = useRef({ q, author, board, from, to, titlesOnly, view, sort });
  latest.current = { q, author, board, from, to, titlesOnly, view, sort };
  const go = () => {
    const v = latest.current;
    const params = new URLSearchParams();
    if (v.q.trim() !== '') params.set('q', v.q);
    if (v.author) params.set('author', v.author.id);
    if (v.board) params.set('board', v.board);
    if (v.from) params.set('from', v.from);
    if (v.to) params.set('to', v.to);
    if (v.titlesOnly) params.set('in', 'titles');
    if (v.view === 'threads') params.set('as', 'threads');
    if (v.sort) params.set('sort', v.sort);
    if (ask.query.perPage !== null) params.set('per', String(ask.query.perPage));
    const next = parseSearch(params);
    /* Nothing to look for: the form stays, and says what is needed rather than going to a blank page. */
    if (!isSearching(next.query)) { setNeeded(true); form.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus(); return; }
    setNeeded(false);
    navigate(searchHref(next));
  };
  const submit = (e: FormEvent) => { e.preventDefault(); go(); };

  return (
    <form ref={form} role="search" aria-label="Search the boards" className="kb-box kb-search-form" onSubmit={submit} onChange={() => setNeeded(false)}>
      <h2 className="kb-box-head">Search the boards</h2>
      <div className="kb-search-fields">
        <div className="kb-search-field kb-search-field-wide">
          <BoardCombobox
            label="Keywords" showLabel source={keywords.current} trailing={searchPostsFor} initialQuery={ask.query.q} onQueryChange={setQ}
            onChoose={(option, group) => {
              const target = suggestionHref(group, option.id);
              if (target !== null) navigate(target); else go();
            }}
          />
        </div>
        <div className="kb-search-field">
          <BoardCombobox
            label="Posted by" showLabel source={people.current} initialQuery={author?.name ?? ''}
            onQueryChange={(text) => setAuthor((a) => (a && text !== a.name ? null : a))}
            onChoose={(option) => setAuthor({ id: option.id, name: option.label })}
          />
        </div>
        <div className="kb-search-field">
          <label htmlFor="kb-search-board" className="kb-search-label">Board</label>
          <select id="kb-search-board" className="kb-select" value={board} onChange={(e) => setBoard(e.target.value)}>
            <option value="">All boards</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="kb-search-field">
          <label htmlFor="kb-search-from" className="kb-search-label">From</label>
          <input id="kb-search-from" type="date" className="kb-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="kb-search-field">
          <label htmlFor="kb-search-to" className="kb-search-label">To</label>
          <input id="kb-search-to" type="date" className="kb-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="kb-search-fields">
        <fieldset className="kb-search-choice">
          <legend>Search in</legend>
          <label><input type="radio" name="kb-search-in" checked={!titlesOnly} onChange={() => setTitlesOnly(false)} /> titles and posts</label>
          <label><input type="radio" name="kb-search-in" checked={titlesOnly} onChange={() => setTitlesOnly(true)} /> titles only</label>
        </fieldset>
        <fieldset className="kb-search-choice">
          <legend>Show results as</legend>
          <label><input type="radio" name="kb-search-as" checked={view === 'posts'} onChange={() => setView('posts')} /> posts</label>
          <label><input type="radio" name="kb-search-as" checked={view === 'threads'} onChange={() => setView('threads')} /> threads</label>
        </fieldset>
        <div className="kb-search-field">
          <label htmlFor="kb-search-sort" className="kb-search-label">Sort</label>
          <select id="kb-search-sort" className="kb-select" value={sort ?? (q.trim() === '' ? 'newest' : 'relevance')} onChange={(e) => setSort(e.target.value as SearchSort)}>
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
        <button type="submit" className="kb-button" data-kb-primary="">Search</button>
      </div>
      {needed && <p role="alert" className="kb-notice" data-kb-tone="refusal">Type a word to search for, or choose a board or a character.</p>}
      <p className="kb-small kb-muted kb-search-help">Quote a phrase, put - before a word to leave it out, and use or between words to match either.</p>
    </form>
  );
}
