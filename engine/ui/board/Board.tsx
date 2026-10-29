/**
 * A board's thread list: the threads in bump order, twenty to a page, with NEW from the player's
 * own reading rows, HOT from the instance's setting, replies, hourly views, the characters who
 * started and last posted, pages, "first unread" and "spun from". On a phone each row is a card.
 *
 * Everything a row shows is public or the player's own reading row: NEW says only that this player
 * has posts to read, and no row marks a thread as the player's own ("A response never proves a
 * private fact"). Views are the hourly character views, the same number for every signed-in player.
 *
 * The page is `?page=N`; a page past the end shows the last. Twenty threads to a page is this
 * screen's own constant: `postsPerPage` counts posts inside a thread, and a list of threads is paged
 * for a different reason (the list's weight on a phone), so the two do not share a setting.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Board, Character, Id, ThreadSummary } from '../data/api.ts';
import { Ago, Mini, SignInPrompt, pageList, useSignedIn } from '../mini.tsx';
import { Link, useLocation } from '../router.tsx';
import { NewThread } from './NewThread.tsx';
import './board.css';

/** Threads to a page of a board's list. */
export const THREADS_PER_PAGE = 20;

interface Loaded {
  readonly board: Board;
  readonly threads: readonly ThreadSummary[];
  readonly total: number;
  readonly page: number;
  readonly reading: Readonly<Record<Id, number>>;
  readonly views: Readonly<Record<Id, number>>;
  readonly characters: ReadonlyMap<Id, Character>;
}

type State = { readonly status: 'loading' } | { readonly status: 'missing' } | { readonly status: 'failed' } | ({ readonly status: 'ready' } & Loaded);

const threadHref = (thread: Id, page: number, seq?: number) => `/t/${thread}?page=${page}${seq === undefined ? '' : `#post-${seq}`}`;
const pageOf = (seq: number, perPage: number) => Math.max(1, Math.ceil(seq / perPage));

export function BoardScreen({ slug }: { readonly slug: string }) {
  const { api, settings } = useKayfa();
  const { query } = useLocation();
  const signedIn = useSignedIn(api);
  const asked = Number.parseInt(query.get('page') ?? '1', 10);
  const [state, setState] = useState<State>({ status: 'loading' });
  /* A page turn keeps the list on screen, marked busy, until the next page lands; a new board starts empty. */
  const [turning, setTurning] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const shownPage = useRef<number | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setState((s) => (s.status === 'ready' && s.board.slug === slug ? s : { status: 'loading' }));
    setTurning(true);
    void (async () => {
      const board = (await api.boards()).find((b) => b.slug === slug);
      if (!board) { if (live) setState({ status: 'missing' }); return; }
      const want = Number.isFinite(asked) && asked > 0 ? asked : 1;
      let listed = await api.threads(board.id, { offset: (want - 1) * THREADS_PER_PAGE, limit: THREADS_PER_PAGE });
      const last = Math.max(1, Math.ceil(listed.total / THREADS_PER_PAGE));
      const page = Math.min(want, last);
      if (page !== want) listed = await api.threads(board.id, { offset: (page - 1) * THREADS_PER_PAGE, limit: THREADS_PER_PAGE });
      const ids = listed.threads.map((t) => t.id);
      const people = [...new Set(listed.threads.flatMap((t) => [t.firstCharacter, t.lastCharacter]).filter((c): c is Id => c !== null))];
      const [reading, views, characters] = await Promise.all([
        ids.length ? api.reading(ids) : {},
        ids.length ? api.viewCounts(ids) : {},
        people.length ? api.characters(people) : [],
      ]);
      if (!live) return;
      setState({
        status: 'ready', board, threads: listed.threads, total: listed.total, page, reading, views,
        characters: new Map(characters.map((c) => [c.id, c])),
      });
    })().catch(() => { if (live) setState({ status: 'failed' }); }).finally(() => { if (live) setTurning(false); });
    return () => { live = false; };
  }, [api, slug, asked, signedIn]);

  /* After a page turn, focus goes to the board's heading, so a keyboard starts the new page at its top, never on the page's body. */
  const readyPage = state.status === 'ready' ? `${state.board.slug}:${state.page}` : null;
  useEffect(() => {
    if (readyPage === null) return;
    const page = Number(readyPage.split(':')[1]);
    if (shownPage.current !== null && shownPage.current !== page) heading.current?.focus();
    shownPage.current = page;
  }, [readyPage]);

  if (signedIn === null) return <div className="kb-board" aria-busy="true" />;
  if (!signedIn) return <div className="kb-board"><SignInPrompt /></div>;
  if (state.status === 'loading') return <div className="kb-board" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-board"><p className="kb-notice" data-kb-tone="refusal">The board could not be loaded. Reload the page to try again.</p></div>;
  if (state.status === 'missing') {
    return (
      <div className="kb-board">
        <h1 className="kb-heading">No such board</h1>
        <p>There is no such board. <Link to="/">Back to the index</Link>.</p>
      </div>
    );
  }

  const { board, threads, total, page } = state;
  const pages = Math.max(1, Math.ceil(total / THREADS_PER_PAGE));
  const pager = (where: 'top' | 'bottom') => pages > 1 && <Pager slug={slug} page={page} pages={pages} where={where} />;

  return (
    <div className="kb-board" data-kb-board={board.slug} aria-busy={turning || undefined}>
      <p className="kb-crumb"><Link to="/">Index</Link> › {board.name}</p>
      <h1 ref={heading} tabIndex={-1} className="kb-heading kb-board-title">{board.name}</h1>
      <p className="kb-board-description kb-muted">{board.description}</p>
      {board.isSystem
        ? <p className="kb-board-readonly kb-small">Only The System posts here. You can react to what it says, and spin a thread from it.</p>
        : <NewThread key={board.slug} board={board.slug} />}
      {threads.length === 0 ? (
        <p className="kb-board-empty">No threads here yet.</p>
      ) : (
        <>
          {pager('top')}
          <table className="kb-table kb-thread-list" role="table">
            <caption className="kb-visually-hidden">Threads on {board.name}, most recently posted first</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col" className="kb-thread-flags-head"><span className="kb-visually-hidden">Status</span></th>
                <th role="columnheader" scope="col">Thread</th>
                <th role="columnheader" scope="col">Replies</th>
                <th role="columnheader" scope="col">Views<span className="kb-visually-hidden">. Characters that have read it, counted hourly</span></th>
                <th role="columnheader" scope="col">Last post</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {threads.map((t) => <ThreadRow key={t.id} t={t} loaded={state} perPage={settings.postsPerPage} hot={settings.hotReplies} />)}
            </tbody>
          </table>
          {pager('bottom')}
        </>
      )}
    </div>
  );
}

function ThreadRow({ t, loaded, perPage, hot }: { readonly t: ThreadSummary; readonly loaded: Loaded; readonly perPage: number; readonly hot: number }) {
  const { reading, views, characters } = loaded;
  const read = reading[t.id] ?? 0;
  const isNew = read < t.lastSeq;
  const firstUnread = read + 1;
  const isHot = t.repliesThisWeek >= hot;
  const pagesInThread = pageOf(t.lastSeq, perPage);
  const name = (id: Id | null) => (id === null ? null : characters.get(id)?.name ?? 'A character');
  const starter = name(t.firstCharacter);
  const last = name(t.lastCharacter);
  /* A spun thread's origin comes with its row: the thread it came out of, that thread's title and the Act's seq. */
  const spun = t.originThread !== null && t.originTitle !== null && t.originSeq !== null ? { thread: t.originThread, title: t.originTitle, seq: t.originSeq } : null;
  const shownPages = pageList(1, pagesInThread);

  return (
    <tr role="row" className="kb-thread-row" data-kb-new={isNew ? '' : undefined} data-kb-hot={isHot ? '' : undefined}>
      <td role="cell" className="kb-thread-flags">
        {isNew && <span className="kb-flag kb-flag-new">NEW</span>}
        {isHot && <span className="kb-flag kb-flag-hot">HOT</span>}
      </td>
      <td role="cell" className="kb-thread-main">
        <Link to={threadHref(t.id, 1)} className="kb-thread-title"><b>{t.title}</b></Link>
        {spun && (
          <span className="kb-thread-spun kb-small">
            {' '}↳ spun from <Link to={threadHref(spun.thread, pageOf(spun.seq, perPage), spun.seq)}>#{spun.seq} in {spun.title}</Link>
          </span>
        )}
        <div className="kb-thread-meta kb-small">
          <span className="kb-thread-started">
            <Mini character={t.firstCharacter ? characters.get(t.firstCharacter) : undefined} name={starter ?? 'S'} />
            {t.firstCharacter ? <Link to={`/c/${encodeURIComponent(t.firstCharacter)}`}>{starter ?? 'A character'}</Link> : <span className="kb-system-name">The System</span>}
          </span>
          {isNew && (
            <> · <Link to={threadHref(t.id, pageOf(firstUnread, perPage), firstUnread)} aria-label={`First unread post in ${t.title}`}>first unread</Link></>
          )}
          {pagesInThread > 1 && (
            <span className="kb-thread-pages">
              {' '}· pages:{' '}
              {shownPages.map((p, i) => p === null
                ? <span key={`gap${i}`} aria-hidden="true">… </span>
                : <span key={p}><Link to={threadHref(t.id, p)} aria-label={`Page ${p} of ${t.title}`}>{p}</Link>{' '}</span>)}
            </span>
          )}
        </div>
      </td>
      <td role="cell" className="kb-thread-replies kb-num"><span className="kb-num">{t.replies}</span><span className="kb-thread-unit"> replies</span></td>
      <td role="cell" className="kb-thread-views kb-num"><span className="kb-num">{views[t.id] ?? 0}</span><span className="kb-thread-unit"> views</span></td>
      <td role="cell" className="kb-thread-last kb-small">
        <span className="kb-thread-last-label">last: </span>
        <Mini character={t.lastCharacter ? characters.get(t.lastCharacter) : undefined} name={last ?? 'S'} />
        {t.lastCharacter ? <Link to={`/c/${encodeURIComponent(t.lastCharacter)}`}>{last ?? 'A character'}</Link> : <span className="kb-system-name">The System</span>}
        <br />
        <Link to={threadHref(t.id, pagesInThread, t.lastSeq)} className="kb-thread-last-link kb-muted"><Ago at={t.lastAt} /><span className="kb-visually-hidden"> — latest post in {t.title}</span></Link>
      </td>
    </tr>
  );
}

function Pager({ slug, page, pages, where }: { readonly slug: string; readonly page: number; readonly pages: number; readonly where: 'top' | 'bottom' }) {
  const href = (p: number) => `/b/${slug}?page=${p}`;
  return (
    <nav className="kb-pager kb-small" aria-label={`Pages, ${where}`}>
      <span className="kb-pager-where">Page {page} of {pages}</span>
      {page > 1 && <Link to={href(page - 1)} rel="prev">Previous</Link>}
      {pageList(page, pages).map((p, i) => p === null
        ? <span key={`gap${i}`} aria-hidden="true">…</span>
        : p === page
          ? <span key={p} className="kb-pager-here" aria-current="page">{p}</span>
          : <Link key={p} to={href(p)} aria-label={`Page ${p}`}>{p}</Link>)}
      {page < pages && <Link to={href(page + 1)} rel="next">Next</Link>}
    </nav>
  );
}
