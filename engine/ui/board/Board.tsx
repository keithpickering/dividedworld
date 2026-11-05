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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Board, BoardPage, Character, Id, PinnedThread, ThreadSummary } from '../data/api.ts';
import { useUntil } from '../cards/Effects.tsx';
import { LensProvider } from '../cards/Lens.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { useReachShown } from '../cards/PlayActions.tsx';
import { createPlays, effectCards, hydrate, livePlays, playOf, readEffects, type Plays } from '../cards/plays.ts';
import { createMine, type Mine } from '../reactions/mine.ts';
import { OriginLink } from '../spin/OriginLink.tsx';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { createTallies, type Tallies } from '../thread/tallies.ts';
import type { SpinOrigin } from '../thread/Post.tsx';
import { Ago, Mini, pageList } from '../mini.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { Link } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { MoveNotice } from './MoveNotice.tsx';
import { PresenceBox } from '../presence/PresenceBox.tsx';
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
  /** Page 1's pinned threads (Main Event's kind): drawn above its rows, taking none of its slots. Empty on every other page. */
  readonly pins: readonly PinnedThread[];
}

const threadHref = (thread: Id, page: number, seq?: number) => `/t/${thread}?page=${page}${seq === undefined ? '' : `#post-${seq}`}`;
const pageOf = (seq: number, perPage: number) => Math.max(1, Math.ceil(seq / perPage));

/**
 * The board screen draws its document (the forum-load plan, Task 13): the page the router loaded, whole on the first frame. A page turn is a
 * navigation, so the old page stays until the next has landed and this screen is given the next page's document. Signed out, the loader's
 * marker is the front door.
 */
export function BoardScreen({ slug, doc }: { readonly slug: string; readonly doc: ScreenDoc<BoardPage> }) {
  if (isSignedOutDoc(doc)) return <FrontDoor />;
  return <BoardView key={slug} slug={slug} doc={doc} />;
}

function BoardView({ slug, doc }: { readonly slug: string; readonly doc: BoardPage }) {
  const { api, settings, ui } = useKayfa();
  /* The board's own card plays (its banner's) and its pins' plays, with their tallies and the reader's reactions, for their marks and the Lens. */
  const plays = useMemo(() => createPlays(), []);
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  const effects = useMemo(() => effectCards(ui), [ui]);
  /* A play's Spin, from the banner's Lens or a pin's: its form opens under the banner. */
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  const drafts = useSpinDrafts();
  const heading = useRef<HTMLHeadingElement>(null);
  const shownPage = useRef<number | null>(null);

  /*
   * The document into the stores: the banner's and the pins' plays with their states, tallies and the reader's reactions. The first frame is
   * whole, so the first document goes in during the first render, into stores nothing listens to yet. A later document (a page turn) goes in
   * in a layout effect, before paint: a store with listeners notifies as it is written, which a render must not do.
   */
  const hydrated = useRef<BoardPage | null>(null);
  const hydrate1 = (d: BoardPage) => {
    const marked: readonly Act[] = [...d.banner.map((p) => p.act), ...d.pins.map((p) => p.act)];
    hydrate(plays, marked, d.states, d.releases);
    for (const [id, t] of Object.entries(d.tallies)) tallies.merge(id, t);
    for (const a of marked) mine.merge(a.id, d.mine.filter((r) => r.act === a.id));
  };
  if (hydrated.current === null) { hydrated.current = doc; hydrate1(doc); }
  useLayoutEffect(() => {
    if (hydrated.current === doc) return;
    hydrated.current = doc;
    hydrate1(doc);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps -- the stores are this view's own and never change
  const state = useMemo<Loaded>(() => ({
    board: doc.board, threads: doc.threads, total: doc.total, page: doc.page, reading: doc.reading, views: doc.views,
    characters: new Map(doc.characters.map((c) => [c.id, c])), pins: doc.pins,
  }), [doc]);
  /* A page turn is a navigation to the next page's document: what a spin form held open belonged to the page before. */
  useEffect(() => setSpinOrigin(null), [doc]);

  /* Characters named by a live play, beside the document's. */
  const [extra, setExtra] = useState<ReadonlyMap<Id, Character>>(() => new Map());
  const characters = useMemo(() => (extra.size === 0 ? state.characters : new Map([...state.characters, ...extra])), [state.characters, extra]);
  const loaded = useMemo<Loaded>(() => ({ ...state, characters }), [state, characters]);

  /* A board card is announced on `reach`, which every signed-in page hears, and not on this board's own topic: this banner keeps the
     plays on its board and drops the rest. The caster is read first, so the mark names them as the banner reads one on load. */
  const boardId = doc.board.id;
  useEffect(() => api.subscribeReach({
    onPlay(a) {
      if (a.kind !== 'card' || a.payload.reach !== 'board' || a.payload.board !== boardId) return;
      void (async () => {
        const who = a.character === null ? [] : await api.characters([a.character]).catch(() => []);
        if (who.length) setExtra((m) => new Map([...m, ...who.map((c) => [c.id, c] as const)]));
        plays.add([a]);
        await readEffects(api, plays, [a], effects);
      })().catch(() => { /* the next read of the board shows it */ });
    },
  }), [api, boardId, plays, effects]);

  /* After a page turn, focus goes to the board's heading, so a keyboard starts the new page at its top, never on the page's body. */
  useEffect(() => {
    if (shownPage.current !== null && shownPage.current !== doc.page) heading.current?.focus();
    shownPage.current = doc.page;
  }, [doc.page]);

  const { board, threads, total, page } = state;
  const pages = Math.max(1, Math.ceil(total / THREADS_PER_PAGE));
  const pager = (where: 'top' | 'bottom') => pages > 1 && <Pager slug={slug} page={page} pages={pages} where={where} />;

  const nameOf = (id: Id | null) => (id === null ? 'The System' : characters.get(id)?.name ?? 'A character');
  return (
    <div className="kb-board" data-kb-board={board.slug}>
      <LensProvider>
      <p className="kb-crumb"><Link to="/">Index</Link> › {board.name}</p>
      <BoardBanner board={board} plays={plays} tallies={tallies} mine={mine} nameOf={nameOf} heading={heading} onSpin={setSpinOrigin} />
      {spinOrigin && (
        <SpinForm
          key={spinOrigin.id} origin={spinOrigin.id} label={spinOrigin.label}
          draft={drafts.get(spinOrigin.id)} onDraft={(d) => drafts.set(spinOrigin.id, d)}
          onClose={() => { const back = spinOrigin.opener; setSpinOrigin(null); back?.focus(); }}
        />
      )}
      <p className="kb-board-description kb-muted">{board.description}</p>
      {board.moveAct !== null && <MoveNotice key={board.moveAct} act={board.moveAct} />}
      {board.isSystem
        ? <p className="kb-board-readonly kb-small">Only The System posts here. You can react to what it says, and spin a thread from it.</p>
        : <NewThread key={board.slug} board={board.slug} />}
      {threads.length === 0 && state.pins.length === 0 ? (
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
            <Pinned loaded={loaded} plays={plays} tallies={tallies} mine={mine} nameOf={nameOf} perPage={settings.postsPerPage} hot={settings.hotReplies} onSpin={setSpinOrigin} />
            <tbody role="rowgroup">
              {threads.filter((t) => !state.pins.some((p) => p.thread.id === t.id)).map((t) => <ThreadRow key={t.id} t={t} loaded={loaded} perPage={settings.postsPerPage} hot={settings.hotReplies} />)}
            </tbody>
          </table>
          {pager('bottom')}
        </>
      )}
      <PresenceBox place={{ kind: 'board', board: board.id }} heading="Users browsing this board" snapshot={doc.presence} />
      </LensProvider>
    </div>
  );
}

/**
 * The board's banner: its name, and its live board card as a mark beside it, with the armed board card's ghost there (the card
 * mechanic's design, section 7). A board card's Act sits in The System's announcements thread; its Lens offers Spin, whose form opens
 * under the banner.
 */
function BoardBanner({ board, plays, tallies, mine, nameOf, heading, onSpin }: {
  readonly board: Board; readonly plays: Plays; readonly tallies: Tallies; readonly mine: Mine; readonly nameOf: (id: Id | null) => string;
  readonly heading: React.RefObject<HTMLHeadingElement | null>; readonly onSpin: (origin: SpinOrigin) => void;
}) {
  const to = `/b/${board.slug}`;
  const shown = useReachShown(plays, board.id, 'board');
  return (
      <div className="kb-board-banner">
        <h1 ref={heading} tabIndex={-1} className="kb-heading kb-board-title">{board.name}</h1>
        {shown && <span className="kb-board-banner-marks">
          <PostMarks
            post={board.id} plays={plays} compare={false} to={to} nameOf={nameOf} tallies={tallies} mine={mine}
            reachAt={{ reach: 'board', target: board.id, name: board.name, fromPost: null, thread: null, board: null, title: board.name, to, plays, know: async () => {}, focusBack: () => heading.current }}
            onSpin={(play, label, opener) => onSpin({ id: play.id, label, opener })}
          />
        </span>}
      </div>
  );
}

/**
 * Page 1's pinned threads, above its rows, each with its pin's mark: each pin's play is drawn until it ends, by itself, with no reread
 * (its way out). They take none of the page's slots and move none of the pager's numbers: a pinned thread is still in its bump place on
 * the page that holds it, and only moved up here when that is page 1.
 */
function Pinned({ loaded, plays, tallies, mine, nameOf, perPage, hot, onSpin }: {
  readonly loaded: Loaded; readonly plays: Plays; readonly tallies: Tallies; readonly mine: Mine; readonly nameOf: (id: Id | null) => string;
  readonly perPage: number; readonly hot: number; readonly onSpin: (origin: SpinOrigin) => void;
}) {
  const pins = useMemo(() => loaded.pins.map((p) => playOf(p.act)).filter((p) => p !== null), [loaded.pins]);
  const now = useUntil(pins);
  const live = new Set(livePlays(pins, now).map((p) => p.id));
  const shown = loaded.pins.filter((p) => live.has(p.play));
  if (shown.length === 0) return null;
  return (
    <tbody role="rowgroup" className="kb-thread-pinned" data-kb-pinned="">
      {shown.map((p) => (
        <ThreadRow
          key={p.thread.id} t={p.thread} loaded={loaded} perPage={perPage} hot={hot}
          mark={<PostMarks post={p.thread.id} where="thread" plays={plays} compare={false} to={threadHref(p.thread.id, 1)} nameOf={nameOf} tallies={tallies} mine={mine} onSpin={(play, label, opener) => onSpin({ id: play.id, label, opener })} />}
        />
      ))}
    </tbody>
  );
}

function ThreadRow({ t, loaded, perPage, hot, mark = null }: { readonly t: ThreadSummary; readonly loaded: Loaded; readonly perPage: number; readonly hot: number; readonly mark?: React.ReactNode }) {
  const { reading, views, characters } = loaded;
  const read = reading[t.id] ?? 0;
  const isNew = read < t.lastSeq;
  const firstUnread = read + 1;
  const isHot = t.repliesThisWeek >= hot;
  const pagesInThread = pageOf(t.lastSeq, perPage);
  const name = (id: Id | null) => (id === null ? null : characters.get(id)?.name ?? 'A character');
  const starter = name(t.firstCharacter);
  const last = name(t.lastCharacter);
  const shownPages = pageList(1, pagesInThread);

  return (
    <tr role="row" className="kb-thread-row" data-kb-new={isNew ? '' : undefined} data-kb-hot={isHot ? '' : undefined}>
      <td role="cell" className="kb-thread-flags">
        {isNew && <span className="kb-flag kb-flag-new">NEW</span>}
        {isHot && <span className="kb-flag kb-flag-hot">HOT</span>}
      </td>
      <td role="cell" className="kb-thread-main">
        <Link to={threadHref(t.id, 1)} className="kb-thread-title"><b>{t.title}</b></Link>
        {mark && <span className="kb-thread-pin-mark">{mark}</span>}
        {t.originActId !== null && (
          <span className="kb-thread-spun kb-small">
            {' '}↳ spun from <OriginLink place={t.origin} perPage={perPage} />
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
