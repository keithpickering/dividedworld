/**
 * The index: the boards, each with its thread count and its latest post. The ordinary board and
 * The System's, whose note says plainly that only The System posts there. A visitor who is not
 * signed in is asked to sign in (the API answers reads only for a session).
 *
 * There is no NEW here: a board's count of unread threads would need a read of every thread on it
 * (the thread list shows NEW per thread, from the player's own reading rows).
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { BoardSummary, Character, Id } from '../data/api.ts';
import { Ago, Mini, SignInPrompt, useSignedIn } from '../mini.tsx';
import { Link } from '../router.tsx';
import './index.css';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly boards: readonly BoardSummary[]; readonly characters: ReadonlyMap<Id, Character> };

export function IndexScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void (async () => {
      const boards = await api.boards();
      const ids = [...new Set(boards.map((b) => b.lastCharacter).filter((c): c is Id => c !== null))];
      const characters = ids.length ? await api.characters(ids) : [];
      if (live) setState({ status: 'ready', boards, characters: new Map(characters.map((c) => [c.id, c])) });
    })().catch(() => { if (live) setState({ status: 'failed' }); });
    return () => { live = false; };
  }, [api, signedIn]);

  if (signedIn === null) return <div className="kb-index" aria-busy="true" />;
  if (!signedIn) return <div className="kb-index"><h1 className="kb-heading">Index</h1><SignInPrompt /></div>;
  if (state.status === 'loading') return <div className="kb-index" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-index"><p className="kb-notice" data-kb-tone="refusal">The boards could not be loaded. Reload the page to try again.</p></div>;

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
                      {b.lastCharacter
                        ? <><Mini character={who} name={who?.name ?? 'A'} /><Link to={`/c/${encodeURIComponent(b.lastCharacter)}`}>{who?.name ?? 'A character'}</Link></>
                        : <span className="kb-system-name">The System</span>}
                      <br />
                      {b.lastThread
                        ? <Link to={`/t/${b.lastThread}`} className="kb-muted" aria-label={`Latest post in ${b.name}`}><Ago at={b.lastAt} /></Link>
                        : <span className="kb-muted"><Ago at={b.lastAt} /></span>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
