/**
 * The index: the boards, each with its thread count and its latest post. The ordinary board and
 * the staff's, whose tag (`UiCopy.staffBoardTag`) says plainly that only the staff post there. A visitor who is not
 * signed in is asked to sign in (the API answers reads only for a session).
 *
 * It is live: `api.subscribeIndex` sends a board's summary as its threads are posted to. A board on the page takes the summary's count and Last post
 * in place (boards keep their order); a board not on the page means the list changed, so the index is read again (the router's silent re-read of the shown page, in place). A Last-post
 * character the page does not know is read once by id.
 *
 * There is no NEW here: a board's count of unread threads would need a read of every thread on it
 * (the thread list shows NEW per thread, from the player's own reading rows).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { BoardSummary, Character, Id, IndexPage } from '../data/api.ts';
import { Ago, Byline } from '../mini.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { spanWords } from '../characters/format.ts';
import { PresenceBox } from '../presence/PresenceBox.tsx';
import { Link, useRouterInternals } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import './index.css';

/** How long the first summary of a board not on the page waits for the rest of its burst before the index is read again. */
const REREAD_AFTER = 50;

/** The index draws its document (the forum-load plan, Task 13): the router loaded it, so the first frame is whole. Signed out, the loader's marker is the front door. */
export function IndexScreen({ doc }: { readonly doc: ScreenDoc<IndexPage> }) {
  const { api, settings, ui } = useKayfa();
  const { retry } = useRouterInternals();
  const page = isSignedOutDoc(doc) ? null : doc;
  const docCharacters = useMemo<ReadonlyMap<Id, Character>>(() => new Map((page?.characters ?? []).map((c) => [c.id, c])), [page]);

  /* What the document shows, and what live summaries changed or named since, kept with the document they were made over: a new document is read as itself on its first render. */
  const [mine, setMine] = useState<{ readonly doc: ScreenDoc<IndexPage>; readonly live: ReadonlyMap<Id, BoardSummary>; readonly extra: ReadonlyMap<Id, Character> }>(() => ({ doc, live: new Map(), extra: new Map() }));
  const cur = mine.doc === doc ? mine : { doc, live: new Map<Id, BoardSummary>(), extra: new Map<Id, Character>() };
  const live = cur.live;
  const extra = cur.extra;
  const asked = useRef<Set<Id>>(new Set());
  const known = useRef<ReadonlySet<Id>>(new Set());
  const listed = useRef<ReadonlyMap<Id, BoardSummary>>(new Map());
  const docRef = useRef(doc);
  const retryRef = useRef(retry);
  const rereading = useRef<ReturnType<typeof setTimeout> | null>(null);
  docRef.current = doc;
  retryRef.current = retry;
  /* A new document answers any re-read asked for, and starts the character reads again. */
  useEffect(() => {
    asked.current = new Set();
    if (rereading.current !== null) { clearTimeout(rereading.current); rereading.current = null; }
  }, [doc]);
  useEffect(() => () => { if (rereading.current !== null) clearTimeout(rereading.current); }, []);
  known.current = new Set([...docCharacters.keys(), ...extra.keys()]);
  listed.current = new Map((page?.boards ?? []).map((b) => [b.id, b]));

  const signedIn = page !== null;
  useEffect(() => {
    if (!signedIn) return undefined;
    /* The state is taken as of the document the summary was heard over. */
    const over = (cur: typeof mine): typeof mine => (cur.doc === docRef.current ? cur : { doc: docRef.current, live: new Map(), extra: new Map() });
    return api.subscribeIndex({
      onBoard(b) {
        const shown = listed.current.get(b.id);
        if (!shown) {
          /* A burst of them (one per post) is one re-read, a moment after the first. */
          if (rereading.current === null) rereading.current = setTimeout(() => { rereading.current = null; retryRef.current(); }, REREAD_AFTER);
          return;
        }
        setMine((s) => {
          const base = over(s);
          const held = base.live.get(b.id) ?? shown;
          /* A summary may come twice or out of order: the one with the later Last post is kept. */
          if (held.lastAt !== null && (b.lastAt === null || Date.parse(held.lastAt) > Date.parse(b.lastAt))) return base;
          return { ...base, live: new Map([...base.live, [b.id, b]]) };
        });
        const c = b.lastCharacter;
        if (c === null || known.current.has(c) || asked.current.has(c)) return;
        asked.current.add(c);
        const heard = docRef.current;
        void api.characters([c]).then((who) => {
          if (!who.length || docRef.current !== heard) return;
          setMine((s) => { const base = over(s); return { ...base, extra: new Map([...base.extra, ...who.map((w) => [w.id, w] as const)]) }; });
        }).catch(() => { asked.current.delete(c); /* the next summary or read of the index shows it */ });
      },
    });
  }, [api, signedIn]);

  const characters = useMemo(() => (extra.size === 0 ? docCharacters : new Map([...docCharacters, ...extra])), [docCharacters, extra]);

  if (page === null) return <FrontDoor />;
  const state = { boards: page.boards.map((b) => live.get(b.id) ?? b), characters };

  return (
    <div className="kb-index">
      <h1 className="kb-heading">Index</h1>
      <table className="kb-table kb-board-list" role="table">
        <caption className="kb-visually-hidden">Boards</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Board</th>
            <th role="columnheader" scope="col">Threads</th>
            <th role="columnheader" scope="col">Last post</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {state.boards.map((b) => {
            const who = b.lastCharacter ? state.characters.get(b.lastCharacter) : undefined;
            return (
              <tr key={b.id} role="row" className="kb-board-row" data-kb-system={b.isSystem ? '' : undefined}>
                <td role="cell" className="kb-board-main">
                  <Link to={`/b/${b.slug}`} className="kb-board-link"><b>{b.name}</b></Link>
                  {b.isSystem && <> <span className="kb-readonly-tag">{ui.copy.staffBoardTag}</span></>}
                  <br />
                  <span className="kb-small kb-muted">{b.description}</span>
                </td>
                <td role="cell" className="kb-board-threads kb-num"><span className="kb-num">{b.threadCount}</span><span className="kb-board-unit">{b.threadCount === 1 ? ' thread' : ' threads'}</span></td>
                <td role="cell" className="kb-board-last">
                  <span className="kb-board-last-label">last: </span>
                  {b.lastAt === null ? <span>None yet</span> : (
                    <>
                      {b.lastThread && b.lastTitle && (
                        <>
                          <Link to={`/t/${b.lastThread}`} className="kb-board-last-title">{b.lastTitle}</Link>
                          {' '}
                          <br />
                        </>
                      )}
                      {/* The "·" and the name are one item, the comma and the date the other (index.css): the fold keeps the "·" at the head of the name's first line and hangs the comma where the date takes a line of its own. */}
                      <span className="kb-board-last-by">
                        <span className="kb-board-last-who">
                          {b.lastThread && b.lastTitle && <span className="kb-board-sep" aria-hidden="true">· </span>}
                          <Byline character={who} id={b.lastCharacter} name={who?.name} link avatar={false} />
                        </span>
                        <span className="kb-board-last-when">
                          <span className="kb-board-sep" aria-hidden="true">, </span>
                          <br />
                          {b.lastThread
                            ? <Link to={`/t/${b.lastThread}`} className="kb-muted"><Ago at={b.lastAt} /><span className="kb-visually-hidden"> — latest post in {b.name}</span></Link>
                            : <span className="kb-muted"><Ago at={b.lastAt} /></span>}
                        </span>
                      </span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PresenceBox place={{ kind: 'index' }} heading="Who is online" note={`Characters active in the past ${spanWords(settings.presenceWindow)}`} snapshot={page.presence} />
    </div>
  );
}
