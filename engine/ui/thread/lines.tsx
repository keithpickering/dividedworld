/**
 * The pieces of an Act that the thread and the ORIGIN box both draw: the link a quote carries, the
 * lines for an unmask and The System's posts, "Last edited", and the History of a post.
 */
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BbCode, type QuoteOf } from '../bbcode/render.tsx';
import { words, type PronounSet } from '../../rules/pronouns.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id, Tail } from '../data/api.ts';
import { VersionEffects } from '../cards/Effects.tsx';
import { PLAYS_PER_POST, createPlays, livePlays, type Plays } from '../cards/plays.ts';
import type { CardPlay } from '../cards/types.ts';
import { resolveWritten } from '../cards/written.ts';
import { Debuts, RevealPost, TallyPost } from '../reveal/Reveal.tsx';
import { ConcealingNote, HiddenNote } from '../conduct/Hidden.tsx';
import { ReportLink } from '../conduct/Report.tsx';

import { sameYear } from '../postbit/dates.ts';
import { Link } from '../router.tsx';
import { ThreadCtx, useThread } from './context.ts';
import { useCharacter, useKnownAct, useLocated } from './locate.tsx';
import { Byline, Mini } from '../mini.tsx';
import { pageOf, threadHref } from './pages.ts';

/** "Oct 29, 2026, 9:14 PM"; on a phone (`dropYear`) a date in the current year, by `nowMs`, is "Oct 29, 9:14 PM". */
export const when = (iso: string, dropYear = false, nowMs = Date.now()) => {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { ...(dropYear && sameYear(d, nowMs) ? {} : { year: 'numeric' as const }), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A typed name's face: its letter and the name as plain text. The same look as a character's unlinked byline, with no id behind it. */
function TypedName({ name }: { readonly name: string }) {
  return <><Mini character={undefined} name={name} /><span className="kb-byline-name">{name}</span></>;
}

/** The head of a real quote: the Act's author, then its post. Whatever is not found yet is left out, and a quote of an Act that is not there says so. */
function RealHead({ act }: { readonly act: Id }) {
  const { perPage } = useThread();
  const found = useLocated(act);
  const read = useKnownAct(act);
  const author = useCharacter(read?.character ?? null);
  const post = found ? <Link to={threadHref(found.thread, pageOf(found.seq, perPage), found.seq)}>Post #{found.seq}</Link> : <>Quoted post</>;
  if (!read) return post;
  return <><Byline character={author ?? undefined} link id={read.character} />{' '}{post}</>;
}

/** The head of a counterfeit: the `user`'s character when it can be found, else the typed name; never a link. */
function CounterfeitHead({ user, name }: { readonly user: Id | null; readonly name: string | null }) {
  const character = useCharacter(user);
  if (character) return <Byline character={character} link={false} id={character.id} />;
  if (name !== null) return <TypedName name={name} />;
  return <>{user === null ? 'Quote' : 'Someone'}</>;
}

/** The head a quote carries, by the quote's kind. */
export function QuoteHead({ of }: { readonly of: QuoteOf }) {
  return of.kind === 'real' ? <RealHead act={of.act} /> : <CounterfeitHead user={of.user} name={of.name} />;
}
export const quoteHead = (q: QuoteOf): ReactNode => <QuoteHead of={q} />;

/** What names a post to a reader who reports one of its versions: its number and its author's name, as the post's own head says them. */
export interface PostAbout { readonly seq: number | null; readonly name: string }

/**
 * Whether a History row is a hidden version. A hidden version's words are null (`public_payload`, 0340); an edit's own `hidden` says so too. The original's own row cannot say it by
 * `hidden`, which for a post is whether its *current* version is hidden, so it is read from its words.
 */
const versionHidden = (v: Act): boolean => typeof v.payload.body !== 'string' || (v.kind === 'edit' && v.hidden === true);
/** Whether a History row's words are withheld for a moment, not hidden: an edit that quotes a post an admin hid, before the conceal job has written its layer (`concealing`, which for an edit is its own). */
const versionConcealing = (v: Act): boolean => v.kind === 'edit' && v.concealing === true && v.hidden !== true;

/**
 * What History needs of a post's writing plays: the live plays of cards that write on it and every row of their tails, read once when History
 * is open. In a thread the plays are the ones the page already holds (`known`), so a post with no writing play costs no request at all; where
 * the page is not known the plays are read, and the tails only if one of them writes. Null while they load, where there is none and where they
 * could not be read, and then the versions show their words alone.
 */
function useTailsOf(post: Id, wanted: boolean, known: Plays | null): { readonly plays: readonly CardPlay[]; readonly rows: readonly Tail[] } | null {
  const { api, instance } = useKayfa();
  const [read, setRead] = useState<{ readonly plays: readonly CardPlay[]; readonly rows: readonly Tail[] } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const writing = new Set(instance.cards.filter((c) => c.writes !== undefined).map((c) => c.key));
    const writers = (all: readonly CardPlay[]) => livePlays(all).filter((p) => writing.has(p.card) && !p.caught && !p.reach && !p.faceDown);
    const fail = () => { /* the versions are shown without their tails */ };
    const tailed = (plays: readonly CardPlay[]) => {
      if (plays.length === 0) return;
      api.tails([post]).then((rows) => { if (live) setRead({ plays, rows }); }, fail);
    };
    if (known) { tailed(writers(known.get(post).plays)); return () => { live = false; }; }
    api.cardsOn(post, PLAYS_PER_POST).then((acts) => {
      if (!live) return;
      const store = createPlays();
      store.add(acts);
      tailed(writers(store.get(post).plays));
    }, fail);
    return () => { live = false; };
  }, [api, instance.cards, post, wanted, known]);
  return read;
}

/** Every version of a post, the original first, for anyone who asks. A hidden version is the one-line note and offers no report; any other offers Report to admins. Each shows with the tails its writing plays made for it, drawn still (design section 7: a tail shows in full, whatever was cleared). */
function Versions({ post, about }: { readonly post: Id; readonly about: PostAbout | undefined }) {
  const { api, instance, ui } = useKayfa();
  const nameOf = useContext(ThreadCtx)?.nameOf;
  const [versions, setVersions] = useState<readonly Act[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    api.history(post).then((v) => { if (live) setVersions(v); }, () => { if (live) setVersions('failed'); });
    return () => { live = false; };
  }, [api, post]);
  const draws = useMemo(() => instance.cards.some((c) => c.writes !== undefined && ui.cards.some((u) => u.key === c.key && u.Effect)), [instance.cards, ui.cards]);
  const tails = useTailsOf(post, draws, useContext(ThreadCtx)?.plays ?? null);
  const ids = useMemo(() => (Array.isArray(versions) ? versions.map((v) => v.id) : []), [versions]);
  if (versions === 'failed') return <p className="kb-notice" data-kb-tone="refusal">The history could not be loaded. Close it and try again.</p>;
  if (versions === null) return <p className="kb-muted kb-small" aria-busy="true">Loading the history…</p>;
  if (versions.length < 2) return <p className="kb-muted kb-small">This post has not been edited.</p>;
  const named = about === undefined ? 'This post' : `Post${about.seq === null ? '' : ` #${about.seq}`} by ${about.name}`;
  return (
    <ol className="kb-post-history" data-kb-quotable="hidden" aria-label="Versions of this post, oldest first">
      {versions.map((v, i) => {
        const last = i === versions.length - 1;
        const which = i === 0 ? 'Original' : `Edit ${i}`;
        const hidden = versionHidden(v);
        const words = <BbCode text={text(v.payload.body)} quoteHead={quoteHead} />;
        /* Only the version's own rows are drawn: a version with none for a play draws none for it. */
        const written = tails ? resolveWritten(tails.rows, ids, v.id, 'version') : null;
        return (
          <li key={v.id}>
            <span className="kb-small kb-muted">{which}, {when(v.createdAt)}{last ? ' · Current' : ''}</span>
            {versionConcealing(v)
              ? <ConcealingNote />
              : hidden
              ? <HiddenNote />
              : (
                <>
                  <ReportLink post={post} version={v.id} kicker={`${named}, ${last ? 'current version' : which.toLowerCase()}`} className="kb-report-row-link kb-small" ariaLabel={`Report to admins: ${about?.seq == null ? '' : `post #${about.seq}, `}${which.toLowerCase()}`} />
                  {tails && written && written.size > 0
                    ? <VersionEffects post={versions[0]!} version={v.id} plays={tails.plays} written={written} {...(nameOf ? { nameOf } : {})}>{words}</VersionEffects>
                    : words}
                </>
              )}
          </li>
        );
      })}
    </ol>
  );
}

/** The History button of a post and the panel it opens; the panel goes where `panel` puts it. `about` names the post for a report made from one of its versions. */
export function useHistory(post: Id, about?: PostAbout): { readonly button: ReactNode; readonly panel: ReactNode } {
  const [open, setOpen] = useState(false);
  const id = `history-${post}`;
  return {
    button: <button type="button" className="kb-button" data-kb-size="small" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>History</button>,
    panel: <div id={id}>{open && <Versions post={post} about={about} />}</div>,
  };
}

/** "Last edited", set only by an edit made after the grace period. */
export function LastEdited({ act }: { readonly act: Act }) {
  if (!act.shownEditedAt) return null;
  return <div className="kb-post-edited kb-small kb-muted">Last edited <time dateTime={act.shownEditedAt}>{when(act.shownEditedAt)}</time></div>;
}

export function UnmaskLine({ act, name }: { readonly act: Act; readonly name: string }) {
  const { instance } = useKayfa();
  const cls = instance.classes.find((c) => c.key === act.payload.class)?.name ?? text(act.payload.class);
  const message = text(act.payload.message);
  return <p className="kb-act-line">{name} revealed: {cls}{message && <> — “{message}”</>}</p>;
}

/**
 * An announcement (the season-end design, section 4): the character's own Act, saying what its player chose to make public of a debut or a Turn
 * and nothing more. The class names are the instance's own. A class the Act does not name stays unnamed here, as it is everywhere.
 */
export function announceWords(what: string, was: string, to: string, className: (key: string) => string): string {
  if (what === 'debut') {
    const named = to === '' ? '' : className(to);
    return named === '' ? 'debuts.' : `debuts as ${/^[aeiou]/iu.test(named) ? 'an' : 'a'} ${named}.`;
  }
  if (was !== '' && to !== '') return `has Turned from ${className(was)} to ${className(to)}.`;
  if (was !== '') return `has Turned, leaving ${className(was)}.`;
  if (to !== '') return `has Turned to ${className(to)}.`;
  return 'has Turned.';
}

export function AnnounceLine({ act, name }: { readonly act: Act; readonly name: string }) {
  const { instance } = useKayfa();
  const className = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  return <p className="kb-act-line">{name} {announceWords(text(act.payload.what), text(act.payload.was), text(act.payload.class), className)}</p>;
}

/** The plain record that a move is over, in the engine's words and never the Boss's (the log never lies): how it ended, by whom. */
export function MoveEndLine({ act }: { readonly act: Act }) {
  const why = text(act.payload.why);
  const how = why === 'met' ? 'its demand was met'
    : why === 'expired' ? 'it ran out'
    : why === 'superseded' ? 'it ended at the handover'
    : why === 'spent' ? 'it was used up at the handover'
    : text(act.payload.by) === 'admin' ? 'an admin reversed it' : 'it was reversed';
  return <p className="kb-act-line">A move has ended: {how}.</p>;
}

/** A Boss keeping a move of an earlier Boss after a handover: the plain record, in the engine's words. */
export function MoveKeepLine({ name, pronouns }: { readonly name: string; readonly pronouns: PronounSet }) {
  return <p className="kb-act-line">{name} kept a move of an earlier Boss. The move is now {words(pronouns).theirs}.</p>;
}

export { Debuts };

/** The words of The System's own post: the tally of a settlement, or the season's reveal (engine/ui/reveal/). */
export function SystemPost({ act }: { readonly act: Act }) {
  return act.kind === 'reveal' ? <RevealPost act={act} quoteHead={quoteHead} /> : <TallyPost act={act} quoteHead={quoteHead} />;
}
