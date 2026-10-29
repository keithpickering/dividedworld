/**
 * The pieces of an Act that the thread and the ORIGIN box both draw: the link a quote carries, the
 * lines for a card, an unmask and The System's posts, "Last edited", and the History of a post.
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
    button: <button type="button" className="kb-link-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>History</button>,
    panel: <div id={id}>{open && <Versions post={post} />}</div>,
  };
}

/** "Last edited", set only by an edit made after the grace period. */
export function LastEdited({ act }: { readonly act: Act }) {
  if (!act.shownEditedAt) return null;
  return <div className="kb-post-edited kb-small kb-muted">Last edited <time dateTime={act.shownEditedAt}>{when(act.shownEditedAt)}</time></div>;
}

export function CardLine({ act, name }: { readonly act: Act; readonly name: string }) {
  const { instance } = useKayfa();
  const { perPage } = useThread();
  const target = useLocated(act.targetActId);
  const card = instance.cards.find((c) => c.key === act.payload.card)?.name ?? (text(act.payload.card) || 'a card');
  const message = text(act.payload.message);
  return (
    <p className="kb-act-line">
      {name} played {card} on {target ? <Link to={threadHref(target.thread, pageOf(target.seq, perPage), target.seq)}>post #{target.seq}</Link> : 'a post'}{message && <>: “{message}”</>}
    </p>
  );
}

export function UnmaskLine({ act, name }: { readonly act: Act; readonly name: string }) {
  const { instance } = useKayfa();
  const cls = instance.classes.find((c) => c.key === act.payload.class)?.name ?? text(act.payload.class);
  const message = text(act.payload.message);
  return <p className="kb-act-line">{name} revealed: {cls}{message && <> — “{message}”</>}</p>;
}

export { Debuts };

/** The words of The System's own post: the tally of a settlement, or the season's reveal (engine/ui/reveal/). */
export function SystemPost({ act }: { readonly act: Act }) {
  return act.kind === 'reveal' ? <RevealPost act={act} /> : <TallyPost act={act} />;
}
