/**
 * One Act in a thread, as an `<article id="post-<seq>">` with a permalink. A post has its
 * character's postbit; a card, an unmask, a tally and a reveal are plainer, until the screens that
 * draw them are built (the cards plan draws a card's effect, the profile and reveal tasks the
 * rest). The words of an Act are shown as text or as BBCode, never as markup.
 *
 * A post is memoized on its Act, its person and its layout, and reads its own tally from the
 * tallies store, so a reaction re-renders the post it is on and nothing else.
 */
import { createContext, memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Act, Id, ThreadSummary } from '../data/api.ts';
import { Postbit, Signature, type PostbitLayout, type PostbitPerson } from '../postbit/Postbit.tsx';
import { Link } from '../router.tsx';
import { useLocated } from './locate.tsx';
import { pageOf, threadHref } from './pages.ts';
import { useTally, type Tallies } from './tallies.ts';

export interface ThreadContext {
  readonly thread: Id;
  readonly perPage: number;
  readonly summary: ThreadSummary;
  readonly tallies: Tallies;
  /** Reports which posts are in view, for mark_read. */
  readonly observer: IntersectionObserver | null;
}

export const ThreadCtx = createContext<ThreadContext | null>(null);
function useThread(): ThreadContext {
  const c = useContext(ThreadCtx);
  if (!c) throw new Error('a post is rendered inside a thread');
  return c;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The link a quote carries: the quoted Act's post, wherever it is. */
export function QuoteLink({ act }: { readonly act: Id }) {
  const { perPage } = useThread();
  const found = useLocated(act);
  if (!found) return <>Quoted post</>;
  return <Link to={threadHref(found.thread, pageOf(found.seq, perPage), found.seq)}>Post #{found.seq}</Link>;
}
const quoteLink = (act: Id): ReactNode => <QuoteLink act={act} />;

/** Reactions as the chips a reader sees, read-only until the reactions task draws the picker. */
function Tallies({ act }: { readonly act: Id }) {
  const { tallies } = useThread();
  const { instance } = useKayfa();
  const tally = useTally(tallies, act);
  const shown = instance.reactions.filter((r) => (tally[r.key] ?? 0) > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="kb-tallies" aria-label="Reactions">
      {shown.map((r) => (
        <li key={r.key} className="kb-tally" data-kb-reaction={r.key} aria-label={`${tally[r.key]} ${r.key}`}>
          <span aria-hidden="true">{r.emoji} {tally[r.key]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Every version of a post, the original first, for anyone who asks. */
function History({ post }: { readonly post: Id }) {
  const { api } = useKayfa();
  const [versions, setVersions] = useState<readonly Act[] | null | 'failed'>(null);
  useEffect(() => {
    let live = true;
    api.history(post).then((v) => { if (live) setVersions(v); }, () => { if (live) setVersions('failed'); });
    return () => { live = false; };
  }, [api, post]);
  if (versions === 'failed') return <p className="kb-notice" data-kb-tone="refusal">The history could not be loaded. Close it and try again.</p>;
  if (versions === null) return <p className="kb-muted kb-small" aria-busy="true">Loading the history…</p>;
  return (
    <ol className="kb-post-history" aria-label="Versions of this post">
      {versions.map((v, i) => (
        <li key={v.id}>
          <span className="kb-small kb-muted">{i === 0 ? 'Original, ' : 'Edited, '}{when(v.createdAt)}</span>
          <BbCode text={text(v.payload.body)} quoteLink={quoteLink} />
        </li>
      ))}
    </ol>
  );
}

function Edited({ act }: { readonly act: Act }) {
  const [open, setOpen] = useState(false);
  if (!act.shownEditedAt) return null;
  return (
    <div className="kb-post-edited kb-small kb-muted">
      Last edited <time dateTime={act.shownEditedAt}>{when(act.shownEditedAt)}</time>
      {' · '}
      <button type="button" className="kb-link-button" aria-expanded={open} onClick={() => setOpen(!open)}>History</button>
      {open && <History post={act.id} />}
    </div>
  );
}

const SYSTEM = 'The System';

interface Props {
  readonly act: Act;
  readonly person: PostbitPerson | undefined;
  readonly layout: PostbitLayout;
  readonly slid: boolean;
}

/** A post's name for a reader and a screen reader: the character's, The System's, or "A character" where it cannot be shown. */
const nameOf = (act: Act, person: PostbitPerson | undefined) => (act.character === null ? SYSTEM : person?.character.name ?? 'A character');

function Debuts({ payload }: { readonly payload: Act['payload'] }) {
  const { instance } = useKayfa();
  const cls = (k: unknown) => (typeof k === 'string' ? instance.classes.find((c) => c.key === k)?.name ?? k : null);
  const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);
  const debuts = rows(payload.debuts);
  const turns = rows(payload.turns);
  if (debuts.length === 0 && turns.length === 0) return null;
  return (
    <ul className="kb-system-list">
      {debuts.map((d, i) => <li key={`d${i}`}>{text(d.name) || 'A character'} debuts{cls(d.class) ? ` as ${cls(d.class)}` : ''}</li>)}
      {turns.map((t, i) => (
        <li key={`t${i}`}>
          {text(t.name) || 'A character'} has Turned{cls(t.was) ? ` from ${cls(t.was)}` : ''}{cls(t.class) ? ` to ${cls(t.class)}` : ''}
        </li>
      ))}
    </ul>
  );
}

function CardLine({ act, name }: { readonly act: Act; readonly name: string }) {
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

function Body({ act, name, person }: { readonly act: Act; readonly name: string; readonly person: PostbitPerson | undefined }) {
  const { instance } = useKayfa();
  const { summary, perPage } = useThread();
  const payload = act.currentPayload;
  switch (act.kind) {
    case 'card': return <CardLine act={act} name={name} />;
    case 'unmask': {
      const cls = instance.classes.find((c) => c.key === act.payload.class)?.name ?? text(act.payload.class);
      const message = text(act.payload.message);
      return <p className="kb-act-line">{name} revealed: {cls}{message && <> — “{message}”</>}</p>;
    }
    case 'tally':
    case 'reveal': {
      const body = text(payload.body);
      return (
        <div className="kb-system-post">
          {body && <BbCode text={body} quoteLink={quoteLink} />}
          {act.kind === 'reveal' && !body && <p>The season’s reveal.</p>}
          <Debuts payload={payload} />
        </div>
      );
    }
    default: {
      /* A post, and a spin's first Act, which is a post that opens on its origin. */
      const origin = act.kind === 'spin' && summary.originThread !== null && summary.originSeq !== null && summary.originTitle !== null ? summary : null;
      return (
        <>
          {origin && (
            <div className="kb-origin" role="group" aria-label="Origin">
              <b>ORIGIN</b> Spun from{' '}
              <Link to={threadHref(origin.originThread!, pageOf(origin.originSeq!, perPage), origin.originSeq!)}>#{origin.originSeq} in {origin.originTitle}</Link>
            </div>
          )}
          <BbCode text={text(payload.body)} quoteLink={quoteLink} />
          <Edited act={act} />
          <Tallies act={act.id} />
          {person && <Signature text={person.character.signature} />}
        </>
      );
    }
  }
}

export const ActArticle = memo(function ActArticle({ act, person, layout, slid }: Props) {
  const { thread, perPage, observer } = useThread();
  const ref = useRef<HTMLElement>(null);
  const seq = act.seq!;
  useEffect(() => {
    const el = ref.current;
    if (!observer || !el) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer]);
  const name = nameOf(act, person);
  const plain = act.kind === 'card' || act.kind === 'unmask';
  return (
    <article
      ref={ref}
      id={`post-${seq}`}
      tabIndex={-1}
      className="kb-act"
      aria-label={`Post ${seq} by ${name}`}
      data-kb-seq={seq}
      data-kb-kind={act.kind}
      data-kb-postbit={layout}
      data-kb-arrived={slid ? 'slide' : undefined}
    >
      <header className="kb-act-meta kb-small">
        <time dateTime={act.createdAt}>{when(act.createdAt)}</time>
        <Link className="kb-act-number" to={threadHref(thread, pageOf(seq, perPage), seq)} aria-label={`Permalink to post #${seq}`}>#{seq}</Link>
      </header>
      {!plain && (person
        ? <Postbit person={person} layout={layout} />
        : <div className="kb-postbit-system"><span className="kb-postbit-name">{name}</span></div>)}
      <div className="kb-act-main">
        <Body act={act} name={name} person={person} />
      </div>
    </article>
  );
});
