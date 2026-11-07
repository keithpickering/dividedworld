/**
 * The pieces of an Act that the thread and the ORIGIN box both draw: the link a quote carries, the
 * lines for an unmask and The System's posts, "Last edited", and the History of a post.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { Debuts, RevealPost, TallyPost } from '../reveal/Reveal.tsx';

import { Link } from '../router.tsx';
import { useThread } from './context.ts';
import { useLocated } from './locate.tsx';
import { pageOf, threadHref } from './pages.ts';

export const when = (iso: string) => new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The link a quote carries: the quoted Act's post, wherever it is. */
export function QuoteLink({ act }: { readonly act: Id }) {
  const { perPage } = useThread();
  const found = useLocated(act);
  if (!found) return <>Quoted post</>;
  return <Link to={threadHref(found.thread, pageOf(found.seq, perPage), found.seq)}>Post #{found.seq}</Link>;
}
export const quoteLink = (act: Id): ReactNode => <QuoteLink act={act} />;

/** Every version of a post, the original first, for anyone who asks. */
function Versions({ post }: { readonly post: Id }) {
  const { api } = useKayfa();
  const [versions, setVersions] = useState<readonly Act[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    api.history(post).then((v) => { if (live) setVersions(v); }, () => { if (live) setVersions('failed'); });
    return () => { live = false; };
  }, [api, post]);
  if (versions === 'failed') return <p className="kb-notice" data-kb-tone="refusal">The history could not be loaded. Close it and try again.</p>;
  if (versions === null) return <p className="kb-muted kb-small" aria-busy="true">Loading the history…</p>;
  if (versions.length < 2) return <p className="kb-muted kb-small">This post has not been edited.</p>;
  return (
    <ol className="kb-post-history" aria-label="Versions of this post, oldest first">
      {versions.map((v, i) => (
        <li key={v.id}>
          <span className="kb-small kb-muted">{i === 0 ? 'Original' : `Edit ${i}`}, {when(v.createdAt)}{i === versions.length - 1 ? ' · Current' : ''}</span>
          <BbCode text={text(v.payload.body)} quoteLink={quoteLink} />
        </li>
      ))}
    </ol>
  );
}

/** The History button of a post and the panel it opens; the panel goes where `panel` puts it. */
export function useHistory(post: Id): { readonly button: ReactNode; readonly panel: ReactNode } {
  const [open, setOpen] = useState(false);
  const id = `history-${post}`;
  return {
    button: <button type="button" className="kb-button" data-kb-size="small" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>History</button>,
    panel: <div id={id}>{open && <Versions post={post} />}</div>,
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
export function MoveKeepLine({ name }: { readonly name: string }) {
  return <p className="kb-act-line">{name} kept a move of an earlier Boss. It is now its own.</p>;
}

export { Debuts };

/** The words of The System's own post: the tally of a settlement, or the season's reveal (engine/ui/reveal/). */
export function SystemPost({ act }: { readonly act: Act }) {
  return act.kind === 'reveal' ? <RevealPost act={act} quoteLink={quoteLink} /> : <TallyPost act={act} quoteLink={quoteLink} />;
}
