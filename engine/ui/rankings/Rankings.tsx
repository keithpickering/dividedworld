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
 * `RankingsScreen` draws it on the season page (engine/ui/season/Season.tsx; /rankings goes there) from that page's document (`season_page`), fifty
 * to a page as the standings are. Every piece of the document is public and asked the same for every player: the page of standings, its count, the
 * season, and the reveals and announced Turns of the page's characters, the player's own among them, so the questions sent never say which rows are
 * the player's. What differs is the player's own rows (`usePlayer`), which only say what the player already knows; the last settlement is boot's.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { rankIndex } from '../../rules/ranks.ts';
import { dayAndTime, figure } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { ClassReveal, Id, MyCharacter, Season, SeasonFinished, SeasonPage, SeasonResultRow, Standing, TurnAnnounced } from '../data/api.ts';
import { PageHead } from '../glass/PageHead.tsx';
import { shortDate } from '../postbit/dates.ts';
import { useBoot } from '../boot.tsx';
import { PageLinks } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { reveals as statements, type Statement } from '../postbit/reveals.ts';
import { Link, useNavigate } from '../router.tsx';
import { finalClass } from '../reveal/statements.ts';
import { seasonAt } from '../season/address.ts';
import './rankings.css';
import { CalmRegion } from '../glass/Calm.tsx';

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
  /** The seasons whose results have landed (`finishedSeasons`), newest first: with any, the page offers the season choice. */
  readonly seasons?: readonly SeasonFinished[];
  /** A finished season's final table, drawn in place of the standings (`resultsPage`); `highlight` is the character whose row opens marked. */
  readonly final?: { readonly season: SeasonFinished; readonly rows: readonly SeasonResultRow[]; readonly highlight: Id | null; readonly unplaced?: boolean } | null;
  /** Drawn inside the season page, whose heading and tabs are above: the table and the pager are as ever, the heading is left out. */
  readonly embedded?: boolean;
}

/** Fifty to a page: a page of the ranking costs a page, however many characters have debuted (the board's standings page, retired with the season page, read fifty as well). */
export const PER_PAGE = 50;
export const rankingsPage = (page: number) => (page === 1 ? '/rankings' : `/rankings?page=${page}`);

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

/** What a finished season's player made public of a character's class that season, drawn as the live table draws a reveal. */
function FinalClassCell({ shown, className }: { readonly shown: SeasonResultRow['shown']; readonly className: (key: string) => string }) {
  const f = finalClass(shown);
  if (!f) return <><span aria-hidden="true" className="kb-rankings-none">—</span><span className="kb-visually-hidden">Not revealed</span></>;
  return (
    <span className="kb-rankings-stated">
      <ClassChip cls={f.cls} name={className(f.cls)} kind="revealed" />
      <span className="kb-rankings-when">Revealed {shortDate(f.at)}</span>
      {f.turnedAt && <span className="kb-rankings-when">Has Turned since {shortDate(f.turnedAt)}</span>}
    </span>
  );
}

/** The season choice: "Season 4 (now)", then each finished season. It leaves the page by replacing it, as the tabs do. */
function SeasonChoice({ now, seasons, chosen }: { readonly now: Season | null; readonly seasons: readonly SeasonFinished[]; readonly chosen: number | null }) {
  const navigate = useNavigate();
  const past = seasons.filter((f) => f.number !== now?.number);
  return (
    <label className="kb-glass-field kb-rankings-choice">
      <span>Season</span>
      <select
        className="kb-glass-select" value={chosen === null ? '' : String(chosen)}
        onChange={(e) => navigate(seasonAt('rankings', 1, e.target.value === '' ? undefined : Number(e.target.value)), { replace: true })}
      >
        <option value="">{now ? `Season ${now.number} (now)` : 'This season'}</option>
        {past.map((f) => <option key={f.number} value={String(f.number)}>{`Season ${f.number}`}</option>)}
      </select>
    </label>
  );
}

export function Rankings({ season, settledAt, standings, reveals, turns, mine, total = standings.length, page = 1, href = rankingsPage, embedded = false, seasons = [], final = null }: RankingsProps) {
  const { instance } = useKayfa();
  const root = useRef<HTMLDivElement>(null);
  const highlighted = final !== null && 'rows' in final ? final.highlight : null;
  /* The linked row is brought into view when the table first has it. jsdom has no scrollIntoView. */
  useEffect(() => {
    if (highlighted === null) return;
    const row = root.current?.querySelector('tr[data-kb-highlight]');
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
  }, [highlighted, page, final]);
  const className = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const own = new Map(mine.map((c) => [c.id, c]));
  const stated = statements(reveals, turns);
  const done = final !== null && 'rows' in final ? final : null;
  const rows: readonly (Standing | SeasonResultRow)[] = done ? done.rows : standings;
  const count = done ? done.season.characters : total;
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const lead = final === null
    ? <>{season ? `Season ${season.number}` : 'This season'}{' · '}{settledAt ? `Settled ${dayAndTime(settledAt)}` : 'Nothing settled yet'}</>
    : `Season ${final.season.number} · Final standings · Ended ${shortDate(final.season.endsAt)}`;
  const chosen = done ? done.season.number : null;
  const choice = seasons.length > 0 ? <SeasonChoice now={season} seasons={seasons} chosen={chosen} /> : null;
  return (
    <div className="kb-rankings" ref={root}>
      {embedded
        ? (
          <div className="kb-rankings-bar">
            <CalmRegion as="p" className="kb-rankings-season">{lead}</CalmRegion>
            {choice}
          </div>
        )
        : (
          <>
            <PageHead title="Rankings" lead={<>{lead}</>} />
            {choice}
          </>
        )}
      <p role="status" className="kb-visually-hidden">{done ? `Showing Season ${done.season.number}'s final standings.` : final === null && season ? `Showing Season ${season.number}'s standings.` : ''}</p>
      <div className="kb-rankings-area">
      <CalmRegion as="p" className="kb-rankings-lead">
        {done
          ? 'The final standings, as the season ended. Your own characters are marked. A class shows only once its player had revealed it that season.'
          : <>The season's standings, as the last settlement left them. Your own characters are marked, with their classes, which
            only you see here. Anyone else's class shows only once its player has revealed it.</>}
      </CalmRegion>
      {rows.length === 0
        ? <CalmRegion as="p" className="kb-rankings-empty">{count === 0 ? 'No character has debuted yet. The first settlement puts them here.' : 'Nothing on this page.'}</CalmRegion>
        : (
          <>
          {done?.unplaced && <CalmRegion as="p" className="kb-rankings-empty">{`That character has no row in Season ${done.season.number}'s final standings.`}</CalmRegion>}
          <CalmRegion className="kb-rankings-board">
            <table className="kb-rankings-table" role="table">
              <caption className="kb-visually-hidden">{done ? `Season ${done.season.number} final standings` : season ? `Season ${season.number} rankings` : 'Rankings'}, highest standing first</caption>
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
                {rows.map((s) => {
                  const mineHere = own.get(s.character);
                  const rank = instance.ranks[rankIndex(instance.ranks, s.standing)]?.name ?? '';
                  const marked = done !== null && done.highlight === s.character;
                  return (
                    <tr key={s.character} role="row" data-kb-own={mineHere ? '' : undefined} data-kb-highlight={marked ? '' : undefined} aria-current={marked ? 'true' : undefined}>
                      <td role="cell" className="kb-rankings-place kb-num">{s.place}</td>
                      <th scope="row" role="rowheader" className="kb-rankings-name">
                        <Link to={`/c/${encodeURIComponent(s.character)}`}>{s.name}</Link>
                        {marked && <span className="kb-visually-hidden"> (the character you followed)</span>}
                        {mineHere && <> <span className="kb-rankings-yours kb-glass-skew-tag"><span className="kb-glass-upright">Yours</span></span></>}
                      </th>
                      <td role="cell" className="kb-rankings-rank">{rank}</td>
                      <td role="cell" className="kb-rankings-num kb-rankings-standing kb-num">{figure(s.standing)}</td>
                      <td role="cell" className="kb-rankings-cls">
                        {'shown' in s ? <FinalClassCell shown={s.shown} className={className} /> : <ClassCell own={mineHere} stated={stated.get(s.character)} className={className} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CalmRegion>
          </>
        )}
      {(pages > 1 || page > pages) && (
        <CalmRegion className="kb-rankings-pages">
          <PageLinks label="Pages of the rankings" page={page} pages={pages} href={href} />
        </CalmRegion>
      )}
      </div>
    </div>
  );
}

/** The part of the season page's document the Rankings tab draws. */
export type RankingsDoc = Extract<SeasonPage, { readonly tab: 'standings' | 'results' }>;

/**
 * Rankings on the season page (`embedded`), drawn from the season page's document (the glass-load plan, Task 11): whole on the first frame.
 * The pager's links are the season page's (`href`), and so is the season choice: each is a navigation to another address, which is another
 * document. `season` names a finished season whose final table the document holds in place of today's standings, and `character` the row
 * it opened at, highlighted. The player's own rows are the player's (`usePlayer`) and the last settlement is boot's.
 */
export function RankingsScreen({ doc, embedded = false, href = rankingsPage, season, character }: {
  readonly doc: RankingsDoc;
  readonly embedded?: boolean;
  readonly href?: (page: number) => string;
  readonly season?: number;
  readonly character?: Id;
}) {
  const boot = useBoot();
  const { characters: mine } = usePlayer();
  if (doc.tab === 'standings') {
    return <Rankings season={doc.season} settledAt={boot?.lastSettledAt ?? null} standings={doc.standings} total={doc.size} reveals={doc.reveals} turns={doc.turns} mine={mine} seasons={doc.finished} page={doc.page} href={href} embedded={embedded} />;
  }
  const ended = doc.finished.find((f) => f.number === season);
  /* The document is of a finished season, so the season is there: a season that is not is a document the server does not answer (the router's "can't be found"). */
  if (!ended) return null;
  const final = { season: ended, rows: doc.results, highlight: character ?? null, unplaced: character !== undefined && doc.place === null };
  return <Rankings season={doc.season} settledAt={null} standings={[]} reveals={[]} turns={[]} mine={mine} seasons={doc.finished} final={final} page={doc.page} href={href} embedded={embedded} />;
}
