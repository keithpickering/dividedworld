/**
 * Updates, as the glass draws it (the alerts plan, Task 7; the alerts design, sections 3 and 6; board docs/research/2026-11-02-alerts/03-updates.html):
 * the instance's developer persona's posts, each a dev-blog post: the persona's avatar, name and tagline, a dated headline, prose in its voice,
 * and a plain "What changed" list, with an archive of the earlier ones beside it. This is the one place the glass has an in-character voice, and
 * what keeps it true is that an update is written only by an admin (the Write an update form, engine/ui/admin/WriteUpdate.tsx, which posts
 * through `post_update`): nothing a model returns reaches this page, and it reads nothing but `api.updates()`. Everything else on the page is the
 * glass's plain words, and the one claim it makes about the voice ("every fact in it is true") is the rule that makes it a rule.
 *
 * An update is an Act, so it can be reacted to and spun from. React is the board's Reactions drawn on the glass (glass chips and the kit's
 * tile), reacting as the HUD's character: reactions are player-level, so the button is plain "React". They pay no one (the developer is
 * staff, `is_staff_side`), which the page says. Spin a thread opens the existing spin form with the update as its origin, and the new thread is
 * on the board with the update in its ORIGIN box (engine/ui/spin/Origin.tsx).
 *
 * `Updates` is the view, handed the page's updates; `UpdatesScreen` reads them at /updates, a page of 20 at a time, `?update=` naming the open
 * one (the newest by default, and the newest too where the named one is not in what was read). Every read is the same for every player but the
 * player's own reactions to the open update, which only say what they already know.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import { UPDATES_PAGE, type Id, type Update, type UpdatesPage } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { ENTERING, useEnterAdded } from '../glass/enter.ts';
import { PageHead } from '../glass/PageHead.tsx';
import { UpdateArticle } from './UpdateArticle.tsx';
import { utcDay } from './time.ts';
import { SignInPrompt, useIsAdmin } from '../mini.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { updatesAsked } from '../glass-docs.ts';
import { Reactions } from '../reactions/Reactions.tsx';
import { createMine } from '../reactions/mine.ts';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { createTallies } from '../thread/tallies.ts';
import { useLocation, useNavigate, useNavigation } from '../router.tsx';
import { GlassLink } from '../glass/Link.tsx';
import { ScreenBody } from '../glass/ScreenBody.tsx';
import { todoDraft } from '../admin/handover-words.ts';
import { WriteUpdate } from '../admin/WriteUpdate.tsx';
import '../cards/kit.css';
import './updates.css';
import { CalmRegion } from '../glass/Calm.tsx';

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
const updatesAt = (act: Id) => `/updates?update=${encodeURIComponent(act)}`;

export interface UpdatesProps {
  /** The updates read so far, newest first. */
  readonly updates: readonly Update[];
  /** The one open; the newest where it is not among `updates`. */
  readonly open: Id | null;
  /** Whether an earlier page may be read. */
  readonly more: boolean;
  readonly onMore: () => void;
  /** True while the earlier page is out: the button is busy. */
  readonly paging?: boolean;
  /** The element the archive's rows are found in for their entrance, and which are the ones a press added (`useEnterAdded`). */
  readonly scope?: RefObject<HTMLElement | null>;
  readonly entering?: (key: string) => true | undefined;
  /** Whether the player may write one. */
  readonly admin: boolean;
  readonly onWritten: (update: Update) => void;
  /** A handover's facts to open the writer with (`?write=handover&season=N`), and the writer open on them. */
  readonly initial?: { readonly title: string; readonly words: string };
  /** The address asked for a handover's writer, and that to-do is not there (cleared by an update or dismissed). */
  readonly handoverGone?: number;
  /** The address asked for a handover's writer, and what it asked cannot be shown: said plainly (the to-do list could not be read, or no season was named). */
  readonly handoverProblem?: string;
  /** The document's reactions on the update it opened (the open one, when it is the one the document read them for). */
  readonly seed?: (Seed & { readonly act: Id }) | null;
}

/** What the document read of the open update's reactions: its tallies and the player's own. */
interface Seed {
  readonly tallies: UpdatesPage['tallies'];
  readonly mine: UpdatesPage['mine'];
}

function Post({ update, seed }: { readonly update: Update; readonly seed: Seed | null }) {
  const { api } = useKayfa();
  /* The open update's reactions are the page's document, held before the first frame; one the document did not read for (an older one, after
     "Show earlier updates") is read here, as before. */
  const tallies = useMemo(() => {
    const t = createTallies();
    if (seed) for (const [act, tally] of Object.entries(seed.tallies)) t.merge(act, tally);
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once, as the Post is keyed by its update
  }, []);
  const mine = useMemo(() => {
    const m = createMine();
    if (seed) m.merge(update.act, seed.mine.filter((r) => r.act === update.act));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  }, []);
  const drafts = useSpinDrafts();
  const [spinning, setSpinning] = useState(false);

  /* The counts as they change; the first counts and the player's own are the document's (or, for an update it did not read for, read here). */
  useEffect(() => {
    let live = true;
    const off = api.subscribeThread(update.thread, { onTally(act, t) { if (act === update.act) tallies.merge(act, t); } });
    if (seed === null) {
      void api.tallies([update.act]).then((t) => { if (live) for (const [act, tally] of Object.entries(t)) tallies.merge(act, tally); }, () => { /* the chips stay as they were */ });
      void api.myReactions([update.act]).then((r) => { if (live) mine.merge(update.act, r); }, () => { /* the player's own marks stay as they were */ });
    }
    return () => { live = false; off(); };
  }, [api, update.act, update.thread, tallies, mine, seed]);

  return (
    <UpdateArticle update={update}>
      <div className="kb-updates-acts">
        <Reactions act={update.act} author={update.character} authorName={update.name} tallies={tallies} mine={mine} subject={`the update “${update.title}”`} />
        <GlassButton aria-expanded={spinning} onClick={() => setSpinning(!spinning)}>Spin a thread on the board</GlassButton>
      </div>
      {spinning && (
        <div className="kb-updates-spinning">
          <SpinForm origin={update.act} label={`the update “${update.title}”`} draft={drafts.get(update.act)} onDraft={(d) => drafts.set(update.act, d)} onClose={() => setSpinning(false)} />
        </div>
      )}
      <p className="kb-updates-note">Reactions here pay no one. A spun thread opens on the board with this update in its origin box.</p>
    </UpdateArticle>
  );
}

export function Updates({ updates, open, more, onMore, paging = false, scope, entering, admin, onWritten, initial, handoverGone, handoverProblem, seed = null }: UpdatesProps) {
  const current = updates.find((u) => u.act === open) ?? updates[0];
  const [writing, setWriting] = useState(initial !== undefined || handoverGone !== undefined || handoverProblem !== undefined);
  useEffect(() => { if (initial !== undefined || handoverGone !== undefined || handoverProblem !== undefined) setWriting(true); }, [initial, handoverGone, handoverProblem]);
  const voice = updates[0]?.name;
  return (
    <div className="kb-updates">
      <PageHead title="Updates" />
      <div className="kb-updates-cols">
        <aside className="kb-updates-side">
          <CalmRegion as="p" className="kb-updates-lede">
            What changed in the game, from the people who make it.
            {voice !== undefined && <> The voice is {possessive(voice)}; every fact in it is true.</>}
          </CalmRegion>
          {updates.length > 0 && (
            <CalmRegion as="nav" aria-label="All updates" className="kb-updates-archive" ref={scope as RefObject<HTMLElement>}>
              <ul>
                {updates.map((u) => (
                  <li key={u.act} {...(entering?.(u.act) ? { [ENTERING]: '' } : {})}>
                    <GlassLink to={updatesAt(u.act)} aria-current={u.act === current?.act ? 'page' : undefined}>
                      <b>{u.title}</b>
                      <span>{utcDay(u.at)}</span>
                    </GlassLink>
                  </li>
                ))}
              </ul>
              {more && <ButtonRow><GlassButton className="kb-updates-more" busy={paging} onClick={onMore}>Show earlier updates</GlassButton></ButtonRow>}
            </CalmRegion>
          )}
        </aside>
        <div className="kb-updates-main">
          {admin && (
            <CalmRegion as="div" className="kb-updates-write">
              <ButtonRow><GlassButton aria-expanded={writing} onClick={() => setWriting(!writing)}>Write an update</GlassButton></ButtonRow>
              {writing && handoverGone !== undefined && <p className="kb-updates-note" role="status">There is no to-do for season {handoverGone}: an update was posted after its handover, or it was dismissed.</p>}
              {writing && handoverProblem !== undefined && <p className="kb-updates-note" role="status">{handoverProblem}</p>}
              {writing && <WriteUpdate key={initial?.title ?? ''} onWritten={onWritten} initial={initial} />}
            </CalmRegion>
          )}
          {/* Newer updates are above older ones, as in the archive: the index in `updates` is the place. */}
          <ScreenBody at={current ? updates.indexOf(current) : -1} axis="y">
            {current ? <Post key={current.act} update={current} seed={seed !== null && seed.act === current.act ? seed : null} /> : <CalmRegion as="p" className="kb-updates-empty">Nothing here yet. When the developers post an update, it is here, and in everyone&apos;s alerts.</CalmRegion>}
          </ScreenBody>
        </div>
      </div>
    </div>
  );
}

/** Updates at /updates, drawn from the route's document: the newest page, the open update's reactions and, for an admin who followed a handover link, the queue's to-do. */
export function UpdatesScreen({ doc }: { readonly doc: ScreenDoc<UpdatesPage> }) {
  if (isSignedOutDoc(doc)) return <div className="kb-updates"><CalmRegion className="kb-updates-empty"><SignInPrompt /></CalmRegion></div>;
  return <UpdatesView page={doc} />;
}

function UpdatesView({ page }: { readonly page: UpdatesPage }) {
  const { api, ui } = useKayfa();
  const roleWord = ui.copy.roleWord;
  const { query } = useLocation();
  const navigate = useNavigate();
  const admin = useIsAdmin(api, true);
  /* The newest page is the document's. What the player added to it (an earlier page, an update just written) is held beside it. */
  const [added, setAdded] = useState<{ readonly older: readonly Update[]; readonly written: readonly Update[]; readonly more: boolean | null }>({ older: [], written: [], more: null });
  const [paging, setPaging] = useState(false);
  const scope = useRef<HTMLElement>(null);
  const enter = useEnterAdded(scope, paging);
  const { track } = useNavigation();
  const updates = useMemo(() => {
    const seen = new Set<Id>();
    return [...added.written, ...page.updates, ...added.older].filter((u) => !seen.has(u.act) && seen.add(u.act));
  }, [page.updates, added]);
  const more = added.more ?? page.updates.length >= UPDATES_PAGE;
  /* `?write=handover&season=N` (from the admin queue's to-do): the writer opens on that handover's facts, read with the document. */
  const asked = updatesAsked(query);
  const todo = asked.season === null ? undefined : page.queue?.todos.find((t) => t.season === asked.season);
  const asksHandover = asked.write === 'handover';
  const problem = asksHandover && asked.season === null ? 'The address names no season, so there is no handover to write about. Open the to-do from the admin queue.' : undefined;
  /* The reactions the document read are of the update it opened: the one asked for when it is among its updates, else the newest. */
  const opened = page.updates.find((u) => u.act === asked.update) ?? page.updates[0];
  /* One object for a document, so the open Post's subscription is made once, not at each render. */
  const openedAct = opened?.act;
  const seed = useMemo(() => (openedAct === undefined ? null : { act: openedAct, tallies: page.tallies, mine: page.mine }), [openedAct, page.tallies, page.mine]);

  const onMore = () => {
    const last = updates.at(-1);
    if (!last || paging) return;
    setPaging(true);
    enter.arm(updates.map((u) => u.act));
    track(api.updates(last.at)).then(
      (older) => setAdded((was) => ({ ...was, older: [...was.older, ...older], more: older.length >= UPDATES_PAGE })),
      () => { /* the button stays, to try again */ },
    ).finally(() => setPaging(false));
  };
  const written = (update: Update) => {
    setAdded((was) => ({ ...was, written: [update, ...was.written.filter((u) => u.act !== update.act)] }));
    navigate(updatesAt(update.act));
  };
  return (
    <Updates
      updates={updates} open={asked.update} more={more} onMore={onMore} paging={paging} scope={scope} entering={enter.entering} admin={admin} onWritten={written} initial={admin && todo !== undefined ? todoDraft(todo, roleWord) : undefined}
      handoverGone={admin && asked.season !== null && todo === undefined ? asked.season : undefined} handoverProblem={admin ? problem : undefined} seed={seed}
    />
  );
}
