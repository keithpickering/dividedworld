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
import { useEffect, useId, useMemo, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { UPDATES_PAGE, type Id, type Update } from '../data/api.ts';
import { PersonaMark } from './Persona.tsx';
import { ChangedList, Prose } from './UpdateWords.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import { createMine } from '../reactions/mine.ts';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { createTallies } from '../thread/tallies.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { WriteUpdate } from '../admin/WriteUpdate.tsx';
import '../cards/kit.css';
import './updates.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** "Nov 2": a day in UTC, as the update's own time is told, so every player reads the same date. Nothing when it cannot be read. */
export function utcDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** "Nov 2 · 08:00 UTC". */
export function utcStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${utcDay(iso)} · ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}
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
}

function Post({ update }: { readonly update: Update }) {
  const { api, ui } = useKayfa();
  const headline = useId();
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  const drafts = useSpinDrafts();
  const [spinning, setSpinning] = useState(false);
  const picture = update.avatar === null ? undefined : ui.avatars?.[update.avatar];

  /* This update's reactions: the counts everyone sees, the player's own, and the counts as they change. */
  useEffect(() => {
    let live = true;
    const off = api.subscribeThread(update.thread, { onTally(act, t) { if (act === update.act) tallies.merge(act, t); } });
    void api.tallies([update.act]).then((t) => { if (live) for (const [act, tally] of Object.entries(t)) tallies.merge(act, tally); }, () => { /* the chips stay as they were */ });
    void api.myReactions([update.act]).then((r) => { if (live) mine.merge(update.act, r); }, () => { /* the player's own marks stay as they were */ });
    return () => { live = false; off(); };
  }, [api, update.act, update.thread, tallies, mine]);

  return (
    <article className="kb-updates-post" aria-labelledby={headline}>
      <div className="kb-updates-by">
        <PersonaMark name={update.name} picture={picture} />
        <div>
          <b className="kb-updates-name">{update.name}</b>
          {update.tagline !== '' && <span className="kb-updates-tagline">{update.tagline}</span>}
        </div>
      </div>
      <h2 id={headline} className="kb-updates-headline kb-glass-display">{update.title}</h2>
      <time className="kb-updates-time" dateTime={update.at}>{utcStamp(update.at)}</time>
      <Prose body={update.body} />
      {update.changes.length > 0 && (
        <>
          <h3 className="kb-updates-changed">What changed</h3>
          <ChangedList changes={update.changes} />
        </>
      )}
      <div className="kb-updates-acts">
        <Reactions act={update.act} author={update.character} authorName={update.name} tallies={tallies} mine={mine} subject={`the update “${update.title}”`} look="glass" />
        <button type="button" className="kb-kit-tile kb-updates-spin" aria-expanded={spinning} onClick={() => setSpinning(!spinning)}>
          <span className="kb-kit-tile-label">Spin a thread on the board</span>
        </button>
      </div>
      {spinning && (
        <div className="kb-updates-spinning">
          <SpinForm origin={update.act} label={`the update “${update.title}”`} draft={drafts.get(update.act)} onDraft={(d) => drafts.set(update.act, d)} onClose={() => setSpinning(false)} />
        </div>
      )}
      <p className="kb-updates-note">Reactions here pay no one. A spun thread opens on the board with this update in its origin box.</p>
    </article>
  );
}

export function Updates({ updates, open, more, onMore, admin, onWritten }: UpdatesProps) {
  const current = updates.find((u) => u.act === open) ?? updates[0];
  const [writing, setWriting] = useState(false);
  const voice = updates[0]?.name;
  return (
    <div className="kb-updates">
      <div className="kb-updates-head">
        <h1 className="kb-updates-title kb-glass-display">Updates</h1>
      </div>
      <div className="kb-updates-cols">
        <aside className="kb-updates-side">
          <p className="kb-updates-lede kb-calm">
            What changed in the game, from the people who make it.
            {voice !== undefined && <> The voice is {possessive(voice)}; every fact in it is true.</>}
          </p>
          {updates.length > 0 && (
            <nav aria-label="All updates" className="kb-updates-archive kb-calm">
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
              {more && <button type="button" className="kb-kit-tile kb-updates-more" onClick={onMore}><span className="kb-kit-tile-label">Show earlier updates</span></button>}
            </nav>
          )}
        </aside>
        <div className="kb-updates-main">
          {admin && (
            <div className="kb-updates-write">
              <button type="button" className="kb-kit-tile" aria-expanded={writing} onClick={() => setWriting(!writing)}>
                <span className="kb-kit-tile-label">Write an update</span>
              </button>
              {writing && <WriteUpdate onWritten={onWritten} />}
            </div>
          )}
          {current ? <Post key={current.act} update={current} /> : <p className="kb-updates-empty kb-calm">Nothing here yet. When the developers post an update, it is here, and in everyone&apos;s alerts.</p>}
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

  if (signedIn === false) return <div className="kb-updates"><div className="kb-updates-empty kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-updates" aria-busy="true" />;
  if (state.status === 'failed') return <div className="kb-updates"><p className="kb-updates-empty kb-calm">The updates could not be loaded. Reload the page to try again.</p></div>;

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
  return <Updates updates={state.updates} open={query.get('update')} more={state.more} onMore={more} admin={admin} onWritten={written} />;
}
