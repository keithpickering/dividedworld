/**
 * The season page, at /season (the alerts plan, Task 8; the alerts design, sections 1, 4 and 7; board
 * docs/research/2026-11-02-alerts/04-season-news.html): Rankings grown into the season's page, with two tabs. Rankings is today's
 * `RankingsScreen`, drawn as it was (its heading and season line aside, which this page's heading and tabs replace). News is the season's
 * public record, newest first: the results (the top three with their final standings and what their players made public of their
 * classes, and a link to all of them), debuts, Turns, and the Boss arriving and leaving.
 *
 * Everything on the News tab is read from Acts already written (`api.seasonNews()`, supabase/migrations/0063_season_news.sql) and is the
 * same for every reader: no item says whose a character is. The player's own characters are marked "yours" here, by this screen, from
 * the player's own characters (`usePlayer`), as Rankings marks them. The page is drawn from `season_page`'s document: a tab, a season, a
 * page of the rankings or the season choice is another address and so another load, with the tab pressed spinning (web/src/App.tsx). The glass describes the game; it never speaks as
 * The System or a Boss: the Boss's arrival quotes its first words, as words that are its, and links its post on the staff's board.
 *
 * The tabs are a tablist of links, `?tab=rankings|news` naming the open one (Rankings by default): Left and Right (and Home and End)
 * move between them as a tablist does, the open tab alone is in the tab order, and the open panel is labelled by its tab.
 * `/rankings` and `/standings` open this page (web/src/App.tsx).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { dayAndTime, figure } from '../characters/format.ts';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import { SEASON_NEWS_PAGE, type Id, type MyCharacter, type Season, type SeasonNewsItem, type SeasonPage, type SeasonResult, type TallyName } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { ENTERING, useEnterAdded } from '../glass/enter.ts';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { RankingsScreen } from '../rankings/Rankings.tsx';
import { useLocation, useNavigate, useNavigation } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { GlassLink } from '../glass/Link.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import { finalClass } from '../reveal/statements.ts';
import { seasonAt, type SeasonTab } from './address.ts';
import './season.css';
import { CalmRegion } from '../glass/Calm.tsx';

export { seasonAt, type SeasonTab };
const TABS: readonly { readonly key: SeasonTab; readonly label: string }[] = [{ key: 'rankings', label: 'Rankings' }, { key: 'news', label: 'News' }];


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
  /** True while the earlier page is out: the button is busy. */
  readonly busy?: boolean;
  /** The element the rows are found in, for their entrance, and which rows are the ones a press added (`useEnterAdded`). */
  readonly scope?: RefObject<HTMLDivElement | null>;
  readonly entering?: (key: string) => true | undefined;
}

const Yours = () => <span className="kb-rankings-yours kb-glass-skew-tag"><span className="kb-glass-upright">Yours</span></span>;

function ClassChip({ cls, name }: { readonly cls: string; readonly name: string }) {
  const look = { '--kb-rankings-class-fill': `var(--kb-glass-class-${cls}-fill)`, '--kb-rankings-class-ink': `var(--kb-glass-class-${cls}-ink)` } as React.CSSProperties;
  return <span className="kb-rankings-class kb-glass-skew-tag" data-kb-kind="revealed" style={look}><span className="kb-glass-upright">{name}</span></span>;
}

/** What a result's player made public of its class that season: the last class it revealed, and whether a Turn was announced after. */
function stated(r: SeasonResult): { readonly cls: string; readonly turned: boolean } | null {
  const f = finalClass(r.shown);
  return f === null ? null : { cls: f.cls, turned: f.turnedAt !== null };
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
              <li key={r.character} className="kb-glass-cut-dialog kb-season-podium">
                <span className="kb-season-place">{PLACES[i] ?? `Place ${r.place}`}</span>
                <b className="kb-season-name"><GlassLink to={`/c/${encodeURIComponent(r.character)}`}>{r.name}</GlassLink></b>
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
      <p><GlassLink className="kb-season-link" to={seasonAt('rankings', 1, item.season)}>{item.count !== null ? `All ${item.count} characters and their standings` : 'All the standings'}</GlassLink></p>
    </>
  );
}

function Names({ names, own, verb, className }: { readonly names: readonly TallyName[]; readonly own: ReadonlySet<Id>; readonly verb: 'debuted' | 'turned'; readonly className: (key: string) => string }) {
  const one = names.length === 1 ? names[0]! : null;
  const profile = (n: TallyName) => <GlassLink className="kb-season-link" to={`/c/${encodeURIComponent(n.character)}`}>{n.name}</GlassLink>;
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
          ? <p>A new character joins the board. {one.class !== null ? <>Announced with the class: <ClassChip cls={one.class} name={className(one.class)} />. </> : 'The class stays a secret until the player says otherwise. '}{profile(one)}{own.has(one.character) && <> <Yours /></>}</p>
          : <p>
            {one.was !== null ? <>Announced with the old class: {one.name} was a <ClassChip cls={one.was} name={className(one.was)} />. </> : 'Announced. '}
            {one.class !== null ? <>{one.name} is now a <ClassChip cls={one.class} name={className(one.class)} />. </> : <>What {one.name} is now isn’t being said. </>}
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

/** The name of the board only the staff post on, as the board has it now (a move may have renamed it): boot's boards, so the first render has it; only where boot is not there (a story, a screen before boot) is it read, and null until then. */
function useStaffBoardName(): string | null {
  const { api } = useKayfa();
  const boot = useBoot();
  const [read, setRead] = useState<string | null>(null);
  useEffect(() => {
    if (boot) return undefined;
    let live = true;
    void api.boards().then((bs) => { if (live) setRead(bs.find((b) => b.isSystem)?.name ?? null); }, () => { /* the words say "the board" */ });
    return () => { live = false; };
  }, [api, boot]);
  return (boot ? boot.boards.find((b) => b.isSystem)?.name : read) ?? null;
}

function Boss({ item, perPage }: { readonly item: SeasonNewsItem; readonly perPage: number }) {
  const { ui } = useKayfa();
  const board = useStaffBoardName() ?? 'the board';
  const arrived = item.kind === 'bossArrived';
  const name = item.name ?? ui.copy.roleWord;
  const post = item.act !== null && item.thread !== null && item.seq !== null ? threadHref(item.thread, pageOf(item.seq, perPage), item.seq) : null;
  const words = item.quote === null ? '' : firstWords(item.quote);
  return (
    <>
      <h3>{name} has {arrived ? 'arrived' : 'left'}</h3>
      {arrived
        ? <p>{name} runs the board for Season {item.season}.{words !== '' && ` ${name}’s first words, on ${board}:`}</p>
        : <p>Season {item.season}&apos;s Boss has left.{words !== '' && ` ${name}’s last words are still on ${board}.`}</p>}
      {words !== '' && <blockquote className="kb-season-quote">{'“'}{words}{'”'}</blockquote>}
      {post !== null && <p><GlassLink className="kb-season-link" to={post}>{arrived ? 'Read the post on the board' : 'Read the last post on the board'}</GlassLink></p>}
    </>
  );
}

/** One feed row: its time, and its words. A tally with debuts and Turns is two rows at one instant. */
function Row({ at, children, entering }: { readonly at: string; readonly children: React.ReactNode; readonly entering?: true }) {
  return <li className="kb-season-item" {...(entering ? { [ENTERING]: '' } : {})}><time dateTime={at}>{dayAndTime(at)}</time><div>{children}</div></li>;
}

/** The keys of the rows an item draws: a settlement or a Boss is one, a tally is a row for its debuts and a row for its Turns. */
export function newsKeys(item: SeasonNewsItem): string[] {
  const key = item.act ?? `${item.kind}:${item.at}:${item.name ?? ''}`;
  if (item.kind === 'tally') return [...(item.debuts.length > 0 ? [`${key}:d`] : []), ...(item.turns.length > 0 ? [`${key}:t`] : [])];
  return [key];
}

export function News({ items, mine, season, perPage, more, onMore, busy = false, scope, entering }: NewsProps) {
  const { instance } = useKayfa();
  const className = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const own = new Set(mine.map((c) => c.id));
  const boss = season ? items.find((i) => i.kind === 'bossArrived' && i.season === season.number)?.name ?? null : null;
  return (
    <div ref={scope} className="kb-season-news">
      <CalmRegion as="p" className="kb-season-lede">
        {season ? `Season ${season.number} began ${dayAndTime(season.startsAt)}.` : ''}
        {boss !== null && ` The Boss this season is ${boss}.`}
        {' '}Everything here is public: results, debuts, Turns, and the Boss coming and going.
      </CalmRegion>
      {items.length === 0
        ? <CalmRegion as="p" className="kb-season-empty">Nothing yet. The first settlement, a debut, a Turn or a new Boss puts the news here, and in everyone&apos;s alerts.</CalmRegion>
        : (
          <CalmRegion as="ul" className="kb-season-feed">
            {items.flatMap((item) => {
              const keys = newsKeys(item);
              const row = (key: string, body: React.ReactNode) => <Row key={key} at={item.at} entering={entering?.(key)}>{body}</Row>;
              if (item.kind === 'results') return [row(keys[0]!, <Results item={item} own={own} className={className} />)];
              if (item.kind === 'tally') {
                /* newsKeys lists the debuts' row, where there are debuts, then the Turns' row, where there are Turns. */
                const [debuts, turns] = item.debuts.length > 0 ? [keys[0]!, keys[1]] : [undefined, keys[0]];
                return [
                  ...(debuts !== undefined ? [row(debuts, <Names names={item.debuts} own={own} verb="debuted" className={className} />)] : []),
                  ...(turns !== undefined ? [row(turns, <Names names={item.turns} own={own} verb="turned" className={className} />)] : []),
                ];
              }
              return [row(keys[0]!, <Boss item={item} perPage={perPage} />)];
            })}
          </CalmRegion>
        )}
      {more && <ButtonRow><GlassButton className="kb-season-more" busy={busy} onClick={onMore}>Show earlier news</GlassButton></ButtonRow>}
    </div>
  );
}

/** The News tab: the first page of the news is the document's, and the older pages a press brings are added to it. */
function NewsPanel({ doc }: { readonly doc: Extract<SeasonPage, { readonly tab: 'news' }> }) {
  const { api, settings } = useKayfa();
  const { characters: mine } = usePlayer();
  const [older, setOlder] = useState<{ readonly doc: typeof doc; readonly items: readonly SeasonNewsItem[]; readonly more: boolean | null } | null>(null);
  const [paging, setPaging] = useState(false);
  const scope = useRef<HTMLDivElement>(null);
  const added = useEnterAdded(scope, paging);
  const { track } = useNavigation();
  /* Older rows belong to the document they were read after: a new document starts from its own first page. */
  const held = older?.doc === doc ? older : null;
  const items = held ? [...doc.news, ...held.items] : doc.news;
  const more = held?.more ?? doc.news.length >= SEASON_NEWS_PAGE;
  const onMore = () => {
    const last = items.at(-1);
    if (!last || paging) return;
    setPaging(true);
    added.arm(items.flatMap(newsKeys));
    track(api.seasonNews(last.at)).then(
      (page) => setOlder((was) => {
        const kept = was?.doc === doc ? was.items : [];
        const fresh = page.filter((o) => ![...doc.news, ...kept].some((x) => x.kind === o.kind && x.act === o.act && x.at === o.at && x.name === o.name));
        return { doc, items: [...kept, ...fresh], more: page.length >= SEASON_NEWS_PAGE };
      }),
      () => { /* the button stays, to try again */ },
    ).finally(() => setPaging(false));
  };
  return <News items={items} mine={mine} season={doc.season} perPage={settings.postsPerPage} more={more} onMore={onMore} busy={paging} scope={scope} entering={added.entering} />;
}

/** The season page at /season, drawn from its document: whole on the first frame. Signed out, the marker is the sign-in line. */
export function SeasonScreen({ doc }: { readonly doc: ScreenDoc<SeasonPage> }) {
  const { query } = useLocation();
  const navigate = useNavigate();
  const ids = useId();
  const signedOut = isSignedOutDoc(doc);
  const tab: SeasonTab = query.get('tab') === 'news' ? 'news' : 'rankings';
  /* A finished season's final table, and the character whose row opens highlighted: from the address, as the Record's Seasons rows and News link them. */
  const asked = Number.parseInt(query.get('season') ?? '', 10);
  const shownSeason = Number.isInteger(asked) && asked >= 1 ? asked : undefined;
  const shownCharacter = shownSeason === undefined ? undefined : query.get('character') ?? undefined;
  const rankingsAt = (page: number) => seasonAt('rankings', page, shownSeason);

  const onKey = (e: KeyboardEvent<HTMLElement>, at: number) => {
    const next = e.key === 'ArrowRight' ? (at + 1) % TABS.length : e.key === 'ArrowLeft' ? (at + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    navigate(seasonAt(TABS[next]!.key), { replace: true });
    document.getElementById(`${ids}-tab-${TABS[next]!.key}`)?.focus();
  };

  if (signedOut) return <div className="kb-season"><CalmRegion className="kb-season-empty"><SignInPrompt /></CalmRegion></div>;
  const season = doc.season;
  return (
    <div className="kb-season">
      <PageHead
        title={season ? `Season ${season.number}` : 'Season'}
        tabs={(
          <CalmRegion role="tablist" aria-label="Season">
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
          </CalmRegion>
        )}
      />
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`} className="kb-season-panel">
        {doc.tab === 'news' ? <NewsPanel doc={doc} /> : <RankingsScreen doc={doc} embedded season={shownSeason} character={shownCharacter} href={rankingsAt} />}
      </div>
    </div>
  );
}
