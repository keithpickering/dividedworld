/**
 * The season's standings at /standings: every debuted character ranked by its settled standing
 * (season_standings), ties sharing a place, each linked to its public profile. Standings move
 * only at a settlement, so the page does too. A character waiting to debut is in no row. Names
 * and numbers only: nothing here is computed from who plays what or from any class.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Season, Standing } from '../data/api.ts';
import { dayAndTime, figure } from '../characters/format.ts';
import { PageLinks, SignInPrompt, useSignedIn } from '../mini.tsx';
import { Link, useLocation } from '../router.tsx';
import './standings.css';

/**
 * Fifty to a page: the season is never read whole. This is the one screen whose job is the whole ranking:
 * a page of season_standings is cut from a window over every debuted character, so its cost grows with the
 * characters and not with the page (a profile and a postbit read standing_place and the standings' own rows
 * instead). Its total is the counter of debuted characters (standingsCount), never a count of the rows.
 */
const PER_PAGE = 50;
const MAX_PAGE = 10_000;

type State = { readonly status: 'loading' } | { readonly status: 'failed' } | { readonly status: 'ready'; readonly rows: readonly Standing[]; readonly total: number; readonly settledAt: string | null; readonly season: Season | null };

export function StandingsScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { query } = useLocation();
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.get('page') ?? '', 10) || 1));
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    Promise.all([api.standingsPage((page - 1) * PER_PAGE, PER_PAGE), api.standingsCount(), api.lastSettledAt(), api.season()]).then(
      ([rows, total, settledAt, season]) => { if (live) setState({ status: 'ready', rows, total, settledAt, season }); },
      () => { if (live) setState({ status: 'failed' }); },
    );
    return () => { live = false; };
  }, [api, page]);
  if (signedIn === null || state.status === 'loading') return <div className="kb-standings" aria-busy="true" />;
  if (!signedIn) return <div className="kb-standings"><SignInPrompt /></div>;
  if (state.status === 'failed') return <div className="kb-standings"><p className="kb-notice" data-kb-tone="refusal">The standings could not be loaded. Reload the page to try again.</p></div>;
  const { rows, total, settledAt, season } = state;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <div className="kb-standings">
      <p className="kb-crumb"><Link to="/">Index</Link> › Standings</p>
      <h1 className="kb-heading">{season ? `Season ${season.number} standings` : 'Season standings'}</h1>
      <p className="kb-small kb-muted">{settledAt ? <>Settled {dayAndTime(settledAt)}. Standings change only at a settlement.</> : 'Nothing has settled yet. Standings change only at a settlement.'}</p>
      {rows.length === 0
        ? <p>{total === 0 ? 'No character has debuted yet.' : 'Nothing on this page.'}</p>
        : (
          <table className="kb-table kb-standings-table">
            <caption className="kb-visually-hidden">Characters by settled standing, highest first</caption>
            <thead><tr><th scope="col">Place</th><th scope="col">Character</th><th scope="col">Aura</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.character}>
                  <td className="kb-num">{r.place}</td>
                  <td><Link to={`/c/${encodeURIComponent(r.character)}`}>{r.name}</Link></td>
                  <td className="kb-num">{figure(r.standing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {total > 0 && <PageLinks label="Pages of the standings" page={page} pages={pages} href={(p) => (p === 1 ? '/standings' : `/standings?page=${p}`)} />}
    </div>
  );
}
