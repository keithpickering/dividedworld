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
import { Ago, SignInPrompt, useSignedIn } from '../mini.tsx';
import { Link } from '../router.tsx';
import './standings.css';

type State = { readonly status: 'loading' } | { readonly status: 'failed' } | { readonly status: 'ready'; readonly rows: readonly Standing[]; readonly settledAt: string | null; readonly season: Season | null };

export function StandingsScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    Promise.all([api.standings(), api.lastSettledAt(), api.season()]).then(
      ([rows, settledAt, season]) => { if (live) setState({ status: 'ready', rows, settledAt, season }); },
      () => { if (live) setState({ status: 'failed' }); },
    );
    return () => { live = false; };
  }, [api]);
  if (signedIn === null || state.status === 'loading') return <div className="kb-standings" aria-busy="true" />;
  if (!signedIn) return <div className="kb-standings"><SignInPrompt /></div>;
  if (state.status === 'failed') return <div className="kb-standings"><p className="kb-notice" data-kb-tone="refusal">The standings could not be loaded. Reload the page to try again.</p></div>;
  const { rows, settledAt, season } = state;
  return (
    <div className="kb-standings">
      <p className="kb-crumb"><Link to="/">Index</Link> › Standings</p>
      <h1 className="kb-heading">{season ? `Season ${season.number} standings` : 'Season standings'}</h1>
      <p className="kb-small kb-muted">{settledAt ? <>Settled {dayAndTime(settledAt)}. Standings change only at a settlement.</> : 'Nothing has settled yet. Standings change only at a settlement.'}</p>
      {rows.length === 0
        ? <p>No character has debuted yet.</p>
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
    </div>
  );
}
