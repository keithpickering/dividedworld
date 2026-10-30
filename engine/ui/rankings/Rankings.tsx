/**
 * Rankings, as the glass draws it (the web plan's glass amendment to Task 10; the glass plan,
 * section 8): the season's public standings in their order, each with its place, its rank and its
 * standing; the player's own characters marked "Yours" and shown with their classes in their own
 * colors, from the player's own rows; and another character's class only as its player made it
 * public (`class_reveals`), with its date, and "Has Turned since" when an announced Turn came after
 * it. A character with no reveal shows no class. Nothing else about anyone's class is read here.
 *
 * `Rankings` is the view: it is handed what `standingsPage`, `classReveals` and `turnsAnnounced`
 * return and the player's own rows (`myCharacters`), and draws them. Its order is the standings'
 * order, whoever is signed in; the marks and the classes of the player's own rows are drawn on the
 * player's own screen only. No board draws Rankings, so its look is the glass plan's description,
 * drawn first as a story for the owner (Rankings.board.stories.tsx) and approved (issue #50): the
 * heading as the Settings board sets its own, and a table set as the Log board's. The page shell
 * and the menu bar are the route's (web/src/App.tsx puts it in `Page`).
 *
 * `RankingsScreen` reads it at /rankings, fifty to a page as the standings are. Every read but one
 * is public and asked the same for every player: the page of standings, its count, the season, the
 * last settlement, and the reveals and announced Turns of the page's characters, the player's own
 * among them, so the questions sent never say which rows are the player's. The one read that
 * differs is the player's own rows (`myCharacters`), which only say what the player already knows.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { rankIndex } from '../../rules/ranks.ts';
import { dayAndTime, figure } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { ClassReveal, MyCharacter, Season, Standing, TurnAnnounced } from '../data/api.ts';
import { shortDate } from '../postbit/dates.ts';
import { PageLinks, SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { reveals as statements, type Statement } from '../postbit/reveals.ts';
import { Link, useLocation } from '../router.tsx';
import './rankings.css';

export interface RankingsProps {
  readonly season: Season | null;
  /** When the standings were last settled (`lastSettledAt`). */
  readonly settledAt: string | null;
  /** A page of the season's standings, in their order (`standingsPage`). */
  readonly standings: readonly Standing[];
  /** The public statements of class for the characters on the page (`classReveals`). */
  readonly reveals: readonly ClassReveal[];
  /** The announced Turns of the characters on the page (`turnsAnnounced`), which make a reveal out of date. */
  readonly turns: readonly TurnAnnounced[];
  /** The player's own characters (`myCharacters`): the rows marked "Yours", with their classes. */
  readonly mine: readonly MyCharacter[];
  /** How many characters are ranked in all (`standingsCount`); the page's own rows when left out. */
  readonly total?: number;
  /** Which page of the standings this is, from 1, and its address; one page when left out. */
  readonly page?: number;
  readonly href?: (page: number) => string;
}

/** Fifty to a page, as the standings screen reads them (engine/ui/standings/Standings.tsx says why). */
export const PER_PAGE = 50;
const MAX_PAGE = 10_000;
const rankingsPage = (page: number) => (page === 1 ? '/rankings' : `/rankings?page=${page}`);

/** A class's chip, in the class's own fill and ink: filled for the player's own, outlined for a public reveal. */
function ClassChip({ cls, name, kind }: { readonly cls: string; readonly name: string; readonly kind: 'own' | 'revealed' }) {
  const look = { '--kb-rankings-class-fill': `var(--kb-glass-class-${cls}-fill)`, '--kb-rankings-class-ink': `var(--kb-glass-class-${cls}-ink)` } as CSSProperties;
  return <span className="kb-rankings-class kb-glass-skew-tag" data-kb-kind={kind} style={look}><span className="kb-glass-upright">{name}</span></span>;
}

function ClassCell({ own, stated, className }: { readonly own: MyCharacter | undefined; readonly stated: Statement | undefined; readonly className: (key: string) => string }) {
  if (own) return <ClassChip cls={own.class} name={className(own.class)} kind="own" />;
  if (!stated?.revealed) {
    return <><span aria-hidden="true" className="kb-rankings-none">—</span><span className="kb-visually-hidden">Not revealed</span></>;
  }
  return (
    <span className="kb-rankings-stated">
      <ClassChip cls={stated.revealed.class} name={className(stated.revealed.class)} kind="revealed" />
      <span className="kb-rankings-when">Revealed {shortDate(stated.revealed.at)}</span>
      {stated.turnedAt && <span className="kb-rankings-when">Has Turned since {shortDate(stated.turnedAt)}</span>}
    </span>
  );
}

export function Rankings({ season, settledAt, standings, reveals, turns, mine, total = standings.length, page = 1, href = rankingsPage }: RankingsProps) {
  const { instance } = useKayfa();
  const className = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const own = new Map(mine.map((c) => [c.id, c]));
  const stated = statements(reveals, turns);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <div className="kb-rankings">
      <div className="kb-rankings-head">
        <h1 className="kb-rankings-title kb-glass-display">Rankings</h1>
        <p className="kb-rankings-season kb-calm">
          {season ? `Season ${season.number}` : 'This season'}
          {' · '}
          {settledAt ? `Settled ${dayAndTime(settledAt)}` : 'Nothing settled yet'}
        </p>
      </div>
      <p className="kb-rankings-lead kb-calm">
        The season's standings, as the last settlement left them. Your own characters are marked, with their classes, which
        only you see here. Anyone else's class shows only once its player has revealed it.
      </p>
      {standings.length === 0
        ? <p className="kb-rankings-empty kb-calm">{total === 0 ? 'No character has debuted yet. The first settlement puts them here.' : 'Nothing on this page.'}</p>
        : (
          <div className="kb-rankings-board kb-calm">
            <table className="kb-rankings-table" role="table">
              <caption className="kb-visually-hidden">{season ? `Season ${season.number} rankings` : 'Rankings'}, highest standing first</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader" className="kb-rankings-place">Place</th>
                  <th scope="col" role="columnheader">Character</th>
                  <th scope="col" role="columnheader">Rank</th>
                  <th scope="col" role="columnheader" className="kb-rankings-num">Standing</th>
                  <th scope="col" role="columnheader">Class</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {standings.map((s) => {
                  const mineHere = own.get(s.character);
                  const rank = instance.ranks[rankIndex(instance.ranks, s.standing)]?.name ?? '';
                  return (
                    <tr key={s.character} role="row" data-kb-own={mineHere ? '' : undefined}>
                      <td role="cell" className="kb-rankings-place kb-num">{s.place}</td>
                      <th scope="row" role="rowheader" className="kb-rankings-name">
                        <Link to={`/c/${encodeURIComponent(s.character)}`}>{s.name}</Link>
                        {mineHere && <> <span className="kb-rankings-yours kb-glass-skew-tag"><span className="kb-glass-upright">Yours</span></span></>}
                      </th>
                      <td role="cell" className="kb-rankings-rank">{rank}</td>
                      <td role="cell" className="kb-rankings-num kb-rankings-standing kb-num">{figure(s.standing)}</td>
                      <td role="cell" className="kb-rankings-cls"><ClassCell own={mineHere} stated={stated.get(s.character)} className={className} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {(pages > 1 || page > pages) && (
        <div className="kb-rankings-pages kb-calm">
          <PageLinks label="Pages of the rankings" page={page} pages={pages} href={href} />
        </div>
      )}
    </div>
  );
}

/** A read's outcome, with the page and the account it was read for (`key`): one read for another is not shown. */
type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly key: string }
  | { readonly status: 'ready'; readonly key: string; readonly props: Omit<RankingsProps, 'page' | 'href'> };

/** Rankings at /rankings, `?page=` choosing the page. */
export function RankingsScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  /* Whose rows are marked: another account signing in reads the page again, with its own. */
  const { account } = usePlayer().session;
  const { query } = useLocation();
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.get('page') ?? '', 10) || 1));
  const [read, setState] = useState<State>({ status: 'loading' });
  /*
   * A new page, or a new account, starts from nothing: never the last page's rows, the last
   * account's marks or the last read's error. The read's key is checked as the screen renders, so
   * the first commit after a change already draws nothing of the last read; an effect that cleared
   * it would land a commit late.
   */
  const key = `${page}:${account ?? ''}`;
  const state: State = read.status !== 'loading' && read.key === key ? read : { status: 'loading' };
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    (async () => {
      const [standings, total, season, settledAt, mine] = await Promise.all([
        api.standingsPage((page - 1) * PER_PAGE, PER_PAGE), api.standingsCount(), api.season(), api.lastSettledAt(), api.myCharacters(),
      ]);
      /* The page's characters, every one of them: asking about all but the player's own would say which are. */
      const ids = standings.map((s) => s.character);
      const [reveals, turns] = ids.length === 0 ? [[], []] : await Promise.all([api.classReveals(ids), api.turnsAnnounced(ids)]);
      return { standings, total, season, settledAt, mine, reveals, turns };
    })().then(
      (props) => { if (live) setState({ status: 'ready', key, props }); },
      () => { if (live) setState({ status: 'failed', key }); },
    );
    return () => { live = false; };
  }, [api, page, signedIn, key]);
  if (signedIn === false) return <div className="kb-rankings"><div className="kb-rankings-empty kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-rankings" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-rankings"><p className="kb-rankings-empty kb-calm">The rankings could not be loaded. Reload the page to try again.</p></div>;
  return <Rankings {...state.props} page={page} href={rankingsPage} />;
}
