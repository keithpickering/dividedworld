/**
 * The season page, at /season (the alerts plan, Task 8; the alerts design, sections 1, 4 and 7; board
 * docs/research/2026-11-02-alerts/04-season-news.html): Rankings grown into the season's page, with two tabs. Rankings is today's
 * `RankingsScreen`, drawn as it was (its heading and season line aside, which this page's heading and tabs replace). News is the season's
 * public record, newest first: the results (the top three with their final standings and what their players made public of their
 * classes, and a link to all of them), debuts, Turns, and the Boss arriving and leaving.
 *
 * Everything on the News tab is read from Acts already written (`api.seasonNews()`, supabase/migrations/0063_season_news.sql) and is the
 * same for every reader: no item says whose a character is. The player's own characters are marked "yours" here, by this screen, from
 * `myCharacters`, which is asked for whatever the page holds, as Rankings marks them. The glass describes the game; it never speaks as
 * The System or a Boss: the Boss's arrival quotes its first words, as words that are its, and links its post on The System's board.
 *
 * The tabs are a tablist of links, `?tab=rankings|news` naming the open one (Rankings by default): Left and Right (and Home and End)
 * move between them as a tablist does, the open tab alone is in the tab order, and the open panel is labelled by its tab.
 * `/rankings` and `/standings` open this page (web/src/App.tsx).
 */
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { dayAndTime, figure } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import { SEASON_NEWS_PAGE, type Id, type MyCharacter, type Season, type SeasonNewsItem, type SeasonResult, type TallyName } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { RankingsScreen } from '../rankings/Rankings.tsx';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import './season.css';

export type SeasonTab = 'rankings' | 'news';
const TABS: readonly { readonly key: SeasonTab; readonly label: string }[] = [{ key: 'rankings', label: 'Rankings' }, { key: 'news', label: 'News' }];

/** The address of the season page's tab (and of a page of the rankings, which is its own query on the Rankings tab). */
export const seasonAt = (tab: SeasonTab, page?: number): string => `/season?tab=${tab}${page !== undefined && page > 1 ? `&page=${page}` : ''}`;
const rankingsAt = (page: number) => seasonAt('rankings', page);

const PLACES = ['First', 'Second', 'Third'];
const BBCODE = /\[\/?[a-z*]+(?:=[^\]]*)?\]/giu;
/** A post's first words for a quotation: its markup left out, cut where a long one runs on. */
export function firstWords(body: string, most = 280): string {
  const plain = body.replace(BBCODE, '').replace(/\s+/gu, ' ').trim();
  const chars = [...plain];
  return chars.length > most ? `${chars.slice(0, most).join('').trimEnd()}…` : plain;
}

export interface NewsProps {
  readonly items: readonly SeasonNewsItem[];
  /** The player's own characters (`myCharacters`): the ones marked "yours". */
  readonly mine: readonly MyCharacter[];
  readonly season: Season | null;
  /** Posts to a page, for the link to a Boss's post. */
  readonly perPage: number;
  readonly more: boolean;
  readonly onMore: () => void;
}

const Yours = () => <span className="kb-rankings-yours kb-glass-skew-tag"><span className="kb-glass-upright">Yours</span></span>;

function ClassChip({ cls, name }: { readonly cls: string; readonly name: string }) {
  const look = { '--kb-rankings-class-fill': `var(--kb-glass-class-${cls}-fill)`, '--kb-rankings-class-ink': `var(--kb-glass-class-${cls}-ink)` } as React.CSSProperties;
  return <span className="kb-rankings-class kb-glass-skew-tag" data-kb-kind="revealed" style={look}><span className="kb-glass-upright">{name}</span></span>;
}

/** What a result's player made public of its class that season: the last class it revealed, and whether a Turn was announced after. */
function stated(r: SeasonResult): { readonly cls: string; readonly turned: boolean } | null {
  let at = -1;
  r.shown.forEach((x, i) => { if (x.kind === 'reveal' && x.class !== null) at = i; });
  return at < 0 ? null : { cls: r.shown[at]!.class!, turned: r.shown.slice(at + 1).some((x) => x.kind === 'turn') };
}

function Results({ item, own, className }: { readonly item: SeasonNewsItem; readonly own: ReadonlySet<Id>; readonly className: (key: string) => string }) {
  return (
    <>
      <h3>Season {item.season} results</h3>
      <p>The final standings, and the class each player made public that season. Never who played them.</p>
      {item.top.length > 0 && (
        <ol className="kb-season-podium-list">
          {item.top.map((r, i) => {
            const s = stated(r);
            return (
              <li key={r.character} className="kb-season-podium">
                <span className="kb-season-place">{PLACES[i] ?? `Place ${r.place}`}</span>
                <b className="kb-season-name"><Link to={`/c/${encodeURIComponent(r.character)}`}>{r.name}</Link></b>
                <span className="kb-season-standing">
                  {figure(r.standing)}
                  {' · '}
                  {s ? <>was a <ClassChip cls={s.cls} name={className(s.cls)} />{s.turned && <> and has Turned since</>}</> : 'class not revealed'}
                </span>
                {own.has(r.character) && <Yours />}
              </li>
            );
          })}
        </ol>
      )}
      {item.thread !== null && (
        <p><Link className="kb-season-link" to={`/t/${encodeURIComponent(item.thread)}`}>{item.count !== null ? `All ${item.count} characters and their standings` : 'All the standings'}</Link></p>
      )}
    </>
  );
}

function Names({ names, own, verb, className }: { readonly names: readonly TallyName[]; readonly own: ReadonlySet<Id>; readonly verb: 'debuted' | 'turned'; readonly className: (key: string) => string }) {
  const one = names.length === 1 ? names[0]! : null;
  const profile = (n: TallyName) => <Link className="kb-season-link" to={`/c/${encodeURIComponent(n.character)}`}>{n.name}</Link>;
  const turn = (n: TallyName) => (
    <>
      {n.was !== null && <> was a <ClassChip cls={n.was} name={className(n.was)} /></>}
      {n.class !== null && <>{n.was !== null ? ', now a ' : ' is now a '}<ClassChip cls={n.class} name={className(n.class)} /></>}
    </>
  );
  if (one) {
    return (
      <>
        <h3>{one.name} {verb}</h3>
        {verb === 'debuted'
          ? <p>A new character joins the board. {one.class !== null ? <>Announced with its class: <ClassChip cls={one.class} name={className(one.class)} />. </> : 'Its class is its own secret until it says otherwise. '}{profile(one)}{own.has(one.character) && <> <Yours /></>}</p>
          : <p>
            {one.was !== null ? <>Announced with its old class: {one.name} was a <ClassChip cls={one.was} name={className(one.was)} />. </> : 'Announced. '}
            {one.class !== null ? <>It is now a <ClassChip cls={one.class} name={className(one.class)} />. </> : 'What it is now, it isn\u2019t saying. '}
            {profile(one)}{own.has(one.character) && <> <Yours /></>}
          </p>}
      </>
    );
  }
  return (
    <>
      <h3>{names.length} characters {verb}</h3>
      <ul className="kb-season-names">
        {names.map((n) => (
          <li key={n.character}>{profile(n)}{verb === 'turned' && turn(n)}{own.has(n.character) && <> <Yours /></>}</li>
        ))}
      </ul>
    </>
  );
}

function Boss({ item, perPage }: { readonly item: SeasonNewsItem; readonly perPage: number }) {
  const arrived = item.kind === 'bossArrived';
  const name = item.name ?? 'The Boss';
  const post = item.act !== null && item.thread !== null && item.seq !== null ? threadHref(item.thread, pageOf(item.seq, perPage), item.seq) : null;
  const words = item.quote === null ? '' : firstWords(item.quote);
  return (
    <>
      <h3>{name} has {arrived ? 'arrived' : 'left'}</h3>
      {arrived
        ? <p>{name} runs the board for Season {item.season}.{words !== '' && ' Its first words, on The System’s board:'}</p>
        : <p>Season {item.season}&apos;s Boss has left.{words !== '' && ' Its last words are still on The System’s board.'}</p>}
      {words !== '' && <blockquote className="kb-season-quote">{'“'}{words}{'”'}</blockquote>}
      {post !== null && <p><Link className="kb-season-link" to={post}>{arrived ? 'Read its post on the board' : 'Read its last post on the board'}</Link></p>}
    </>
  );
}

/** One feed row: its time, and its words. A tally with debuts and Turns is two rows at one instant. */
function Row({ at, children }: { readonly at: string; readonly children: React.ReactNode }) {
  return <li className="kb-season-item"><time dateTime={at}>{dayAndTime(at)}</time><div>{children}</div></li>;
}

export function News({ items, mine, season, perPage, more, onMore }: NewsProps) {
  const { instance } = useKayfa();
  const className = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const own = new Set(mine.map((c) => c.id));
  const boss = season ? items.find((i) => i.kind === 'bossArrived' && i.season === season.number)?.name ?? null : null;
  return (
    <div className="kb-season-news">
      <p className="kb-season-lede kb-calm">
        {season ? `Season ${season.number} began ${dayAndTime(season.startsAt)}.` : ''}
        {boss !== null && ` The Boss this season is ${boss}.`}
        {' '}Everything here is public: results, debuts, Turns, and the Boss coming and going.
      </p>
      {items.length === 0
        ? <p className="kb-season-empty kb-calm">Nothing yet. The first settlement, a debut, a Turn or a new Boss puts the news here, and in everyone&apos;s alerts.</p>
        : (
          <ul className="kb-season-feed kb-calm">
            {items.flatMap((item) => {
              const key = item.act ?? `${item.kind}:${item.at}:${item.name ?? ''}`;
              if (item.kind === 'results') return [<Row key={key} at={item.at}><Results item={item} own={own} className={className} /></Row>];
              if (item.kind === 'tally') {
                return [
                  ...(item.debuts.length > 0 ? [<Row key={`${key}:d`} at={item.at}><Names names={item.debuts} own={own} verb="debuted" className={className} /></Row>] : []),
                  ...(item.turns.length > 0 ? [<Row key={`${key}:t`} at={item.at}><Names names={item.turns} own={own} verb="turned" className={className} /></Row>] : []),
                ];
              }
              return [<Row key={key} at={item.at}><Boss item={item} perPage={perPage} /></Row>];
            })}
          </ul>
        )}
      {more && <ButtonRow><GlassButton className="kb-season-more" onClick={onMore}>Show earlier news</GlassButton></ButtonRow>}
    </div>
  );
}

type NewsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly key: string; readonly items: readonly SeasonNewsItem[]; readonly mine: readonly MyCharacter[]; readonly more: boolean };

/** The News tab's read: the first page of the news, the player's own characters and the season. */
function NewsPanel({ season }: { readonly season: Season | null }) {
  const { api, settings } = useKayfa();
  const { account } = usePlayer().session;
  const [read, setRead] = useState<NewsState>({ status: 'loading' });
  const [paging, setPaging] = useState(false);
  const key = account ?? '';
  /* Another account signing in reads again, with its own marks: the last account's are never drawn for the next. */
  const state: NewsState = read.status === 'ready' && read.key !== key ? { status: 'loading' } : read;
  useEffect(() => {
    let live = true;
    Promise.all([api.seasonNews(), api.myCharacters()]).then(
      ([items, mine]) => { if (live) setRead({ status: 'ready', key, items, mine, more: items.length >= SEASON_NEWS_PAGE }); },
      () => { if (live) setRead({ status: 'failed' }); },
    );
    return () => { live = false; };
  }, [api, key]);
  if (state.status === 'loading') return <div aria-busy="true" />;
  if (state.status === 'failed') return <p className="kb-season-empty kb-calm">The news could not be loaded. Reload the page to try again.</p>;
  const more = () => {
    const last = state.items.at(-1);
    if (!last || paging) return;
    setPaging(true);
    api.seasonNews(last.at).then(
      (older) => setRead((was) => (was.status !== 'ready' ? was : { ...was, items: [...was.items, ...older.filter((o) => !was.items.some((x) => x.kind === o.kind && x.act === o.act && x.at === o.at && x.name === o.name))], more: older.length >= SEASON_NEWS_PAGE })),
      () => { /* the button stays, to try again */ },
    ).finally(() => setPaging(false));
  };
  return <News items={state.items} mine={state.mine} season={season} perPage={settings.postsPerPage} more={state.more} onMore={more} />;
}

/** The season page at /season. */
export function SeasonScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { query } = useLocation();
  const navigate = useNavigate();
  const ids = useId();
  const [season, setSeason] = useState<Season | null>(null);
  const tab: SeasonTab = query.get('tab') === 'news' ? 'news' : 'rankings';

  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    void api.season().then((s) => { if (live) setSeason(s); }, () => { /* the heading stays plain */ });
    return () => { live = false; };
  }, [api, signedIn]);

  const onKey = (e: KeyboardEvent<HTMLElement>, at: number) => {
    const next = e.key === 'ArrowRight' ? (at + 1) % TABS.length : e.key === 'ArrowLeft' ? (at + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    navigate(seasonAt(TABS[next]!.key), { replace: true });
    document.getElementById(`${ids}-tab-${TABS[next]!.key}`)?.focus();
  };

  if (signedIn === false) return <div className="kb-season"><div className="kb-season-empty kb-calm"><SignInPrompt /></div></div>;
  return (
    <div className="kb-season">
      <PageHead
        title={season ? `Season ${season.number}` : 'Season'}
        tabs={(
          <div role="tablist" aria-label="Season" className="kb-calm">
            <ButtonRow>
              {TABS.map((t, i) => (
                <GlassButton
                  key={t.key}
                  to={seasonAt(t.key)}
                  replace
                  role="tab"
                  id={`${ids}-tab-${t.key}`}
                  kind={t.key === tab ? 'primary' : 'secondary'}
                  aria-selected={t.key === tab}
                  aria-controls={`${ids}-panel`}
                  tabIndex={t.key === tab ? 0 : -1}
                  onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => onKey(e, i)}
                >
                  {t.label}
                </GlassButton>
              ))}
            </ButtonRow>
          </div>
        )}
      />
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`} className="kb-season-panel">
        {tab === 'rankings' ? <RankingsScreen embedded href={rankingsAt} /> : signedIn === null ? <div aria-busy="true" /> : <NewsPanel season={season} />}
      </div>
    </div>
  );
}
