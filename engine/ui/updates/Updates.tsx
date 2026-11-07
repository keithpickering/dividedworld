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
import { useEffect, useMemo, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { UPDATES_PAGE, type Id, type Update } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { UpdateArticle } from './UpdateArticle.tsx';
import { utcDay } from './time.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import { createMine } from '../reactions/mine.ts';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { createTallies } from '../thread/tallies.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
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
  /** Whether the player may write one. */
  readonly admin: boolean;
  readonly onWritten: (update: Update) => void;
  /** A handover's facts to open the writer with (`?write=handover&season=N`), and the writer open on them. */
  readonly initial?: { readonly title: string; readonly words: string };
  /** The address asked for a handover's writer, and that to-do is not there (cleared by an update or dismissed). */
  readonly handoverGone?: number;
  /** The address asked for a handover's writer, and what it asked cannot be shown: said plainly (the to-do list could not be read, or no season was named). */
  readonly handoverProblem?: string;
}

function Post({ update }: { readonly update: Update }) {
  const { api } = useKayfa();
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  const drafts = useSpinDrafts();
  const [spinning, setSpinning] = useState(false);

  /* This update's reactions: the counts everyone sees, the player's own, and the counts as they change. */
  useEffect(() => {
    let live = true;
    const off = api.subscribeThread(update.thread, { onTally(act, t) { if (act === update.act) tallies.merge(act, t); } });
    void api.tallies([update.act]).then((t) => { if (live) for (const [act, tally] of Object.entries(t)) tallies.merge(act, tally); }, () => { /* the chips stay as they were */ });
    void api.myReactions([update.act]).then((r) => { if (live) mine.merge(update.act, r); }, () => { /* the player's own marks stay as they were */ });
    return () => { live = false; off(); };
  }, [api, update.act, update.thread, tallies, mine]);

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

export function Updates({ updates, open, more, onMore, admin, onWritten, initial, handoverGone, handoverProblem }: UpdatesProps) {
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
            <CalmRegion as="nav" aria-label="All updates" className="kb-updates-archive">
              <ul>
                {updates.map((u) => (
                  <li key={u.act}>
                    <Link to={updatesAt(u.act)} aria-current={u.act === current?.act ? 'page' : undefined}>
                      <b>{u.title}</b>
                      <span>{utcDay(u.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {more && <ButtonRow><GlassButton className="kb-updates-more" onClick={onMore}>Show earlier updates</GlassButton></ButtonRow>}
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
          {current ? <Post key={current.act} update={current} /> : <CalmRegion as="p" className="kb-updates-empty">Nothing here yet. When the developers post an update, it is here, and in everyone&apos;s alerts.</CalmRegion>}
        </div>
      </div>
    </div>
  );
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly updates: readonly Update[]; readonly more: boolean };

/** Updates at /updates. */
export function UpdatesScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { query } = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [admin, setAdmin] = useState(false);
  const [paging, setPaging] = useState(false);
  /* `?write=handover&season=N` (from the admin queue's to-do): the writer opens on that handover's facts. Read once the page knows the reader is an admin. */
  const asked = Number(query.get('season'));
  const season = query.get('write') === 'handover' && Number.isInteger(asked) && asked > 0 ? asked : null;
  const [handover, setHandover] = useState<{ readonly season: number; readonly draft: { readonly title: string; readonly words: string } | null; readonly failed?: true } | null>(null);
  useEffect(() => {
    if (!admin || season === null) { setHandover(null); return undefined; }
    let live = true;
    api.adminQueue().then(
      (q) => { const todo = q.todos.find((t) => t.season === season); if (live) setHandover({ season, draft: todo === undefined ? null : todoDraft(todo) }); },
      () => { if (live) setHandover({ season, draft: null, failed: true }); },
    );
    return () => { live = false; };
  }, [api, admin, season]);

  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    api.updates().then(
      (updates) => { if (live) setState({ status: 'ready', updates, more: updates.length >= UPDATES_PAGE }); },
      () => { if (live) setState({ status: 'failed' }); },
    );
    api.isAdmin().then((a) => { if (live) setAdmin(a); }, () => { /* no form offered */ });
    return () => { live = false; };
  }, [api, signedIn]);

  if (signedIn === false) return <div className="kb-updates"><CalmRegion className="kb-updates-empty"><SignInPrompt /></CalmRegion></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-updates" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-updates"><CalmRegion as="p" className="kb-updates-empty">The updates could not be loaded. Reload the page to try again.</CalmRegion></div>;

  const asksHandover = query.get('write') === 'handover';
  const problem = asksHandover && season === null ? 'The address names no season, so there is no handover to write about. Open the to-do from the admin queue.'
    : handover?.failed === true ? 'The to-do list could not be loaded, so the handover\'s facts are not here. Reload the page to try again.' : undefined;

  const more = () => {
    const last = state.updates.at(-1);
    if (!last || paging) return;
    setPaging(true);
    api.updates(last.at).then(
      (older) => setState((was) => (was.status !== 'ready' ? was : { status: 'ready', updates: [...was.updates, ...older.filter((u) => !was.updates.some((x) => x.act === u.act))], more: older.length >= UPDATES_PAGE })),
      () => { /* the button stays, to try again */ },
    ).finally(() => setPaging(false));
  };
  const written = (update: Update) => {
    setState((was) => (was.status !== 'ready' ? was : { ...was, updates: [update, ...was.updates.filter((u) => u.act !== update.act)] }));
    navigate(updatesAt(update.act));
  };
  return <Updates updates={state.updates} open={query.get('update')} more={state.more} onMore={more} admin={admin} onWritten={written} initial={handover?.draft ?? undefined} handoverGone={handover !== null && handover.draft === null && handover.failed !== true ? handover.season : undefined} handoverProblem={problem} />;
}
