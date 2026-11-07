/**
 * The index: the boards, each with its thread count and its latest post. The ordinary board and
 * The System's, whose note says plainly that only The System posts there. A visitor who is not
 * signed in is asked to sign in (the API answers reads only for a session).
 *
 * There is no NEW here: a board's count of unread threads would need a read of every thread on it
 * (the thread list shows NEW per thread, from the player's own reading rows).
 */
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import type { Character, Id, IndexPage } from '../data/api.ts';
import { Ago, Byline } from '../mini.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { spanWords } from '../characters/format.ts';
import { PresenceBox } from '../presence/PresenceBox.tsx';
import { Link } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import './index.css';

/** The index draws its document (the forum-load plan, Task 13): the router loaded it, so the first frame is whole. Signed out, the loader's marker is the front door. */
export function IndexScreen({ doc }: { readonly doc: ScreenDoc<IndexPage> }) {
  const { settings } = useKayfa();
  const page = isSignedOutDoc(doc) ? null : doc;
  const characters = useMemo<ReadonlyMap<Id, Character>>(() => new Map((page?.characters ?? []).map((c) => [c.id, c])), [page]);

  if (page === null) return <FrontDoor />;
  const state = { boards: page.boards, characters };

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
                  {b.isSystem && <> <span className="kb-readonly-tag">The System posts; you react and spin</span></>}
                  <br />
                  <span className="kb-small kb-muted">{b.description}</span>
                </td>
                <td role="cell" className="kb-board-threads kb-num"><span className="kb-num">{b.threadCount}</span><span className="kb-board-unit"> threads</span></td>
                <td role="cell" className="kb-board-last kb-small">
                  {b.lastAt === null ? <span className="kb-muted">None yet</span> : (
                    <>
                      <span className="kb-board-last-label">last: </span>
                      <Byline character={who} id={b.lastCharacter} name={who?.name} link />
                      <br />
                      {b.lastThread
                        ? <Link to={`/t/${b.lastThread}`} className="kb-muted"><Ago at={b.lastAt} /><span className="kb-visually-hidden"> — latest post in {b.name}</span></Link>
                        : <span className="kb-muted"><Ago at={b.lastAt} /></span>}
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
