/**
 * The ORIGIN box at the top of a spun thread: a live view of the Act it was spun from, as that Act
 * stands now (its current words, "Last edited" and History, the card plays on it), not a copy, with
 * a link back to where it is. An edit made after the spin arrives on the origin thread's channel
 * and shows here; the subscription is dropped when the thread is left.
 */
import { useEffect, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id, ThreadSummary } from '../data/api.ts';
import { newer } from '../thread/feed.ts';
import { CardLine, LastEdited, SystemPost, UnmaskLine, quoteLink, text, useHistory, when } from '../thread/lines.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { Link } from '../router.tsx';
import './spin.css';

/** The origin Act and the card plays on it, kept current. */
function useOrigin(origin: Id, thread: Id): { readonly act: Act | null; readonly cards: readonly Act[] } {
  const { api } = useKayfa();
  const [act, setAct] = useState<Act | null>(null);
  const [cards, setCards] = useState<readonly Act[]>([]);
  useEffect(() => {
    let live = true;
    const addCard = (c: Act) => setCards((all) => (all.some((x) => x.id === c.id) ? all : [...all, c].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))));
    const off = api.subscribeThread(thread, {
      onAct(a) {
        if (a.id === origin) setAct((was) => (was ? newer(was, a) : a));
        else if (a.kind === 'card' && a.targetActId === origin) addCard(a);
      },
    });
    void api.act(origin).then((a) => { if (live && a) setAct((was) => (was ? newer(was, a) : a)); }, () => { /* the link back is still there */ });
    void api.cardsOn(origin).then((all) => { if (live) for (const c of all) addCard(c); }, () => { /* the card lines are left out */ });
    return () => { live = false; off(); };
  }, [api, origin, thread]);
  return { act, cards };
}

function useNames(ids: readonly (Id | null)[]): (id: Id | null) => string {
  const { api } = useKayfa();
  const [known, setKnown] = useState<ReadonlyMap<Id, Character>>(new Map());
  const wanted = [...new Set(ids.filter((i): i is Id => i !== null))].sort().join(',');
  useEffect(() => {
    if (wanted === '') return;
    let live = true;
    api.characters(wanted.split(',')).then((cs) => { if (live) setKnown(new Map(cs.map((c) => [c.id, c]))); }, () => { /* shown as "A character" */ });
    return () => { live = false; };
  }, [api, wanted]);
  return (id) => (id === null ? 'The System' : known.get(id)?.name ?? 'A character');
}

export function Origin({ summary }: { readonly summary: ThreadSummary }) {
  const { perPage } = useThread();
  const originId = summary.originActId!;
  const { act, cards } = useOrigin(originId, summary.originThread!);
  const nameOf = useNames([act?.character ?? null, ...cards.map((c) => c.character)]);
  const history = useHistory(originId);
  const back = summary.originSeq !== null && summary.originTitle !== null
    ? <Link to={threadHref(summary.originThread!, pageOf(summary.originSeq, perPage), summary.originSeq)}>#{summary.originSeq} in {summary.originTitle}</Link>
    : null;

  const body = () => {
    if (!act) return <p className="kb-muted kb-small" aria-busy="true">Loading the origin…</p>;
    const name = nameOf(act.character);
    switch (act.kind) {
      case 'card': return <CardLine act={act} name={name} />;
      case 'unmask': return <UnmaskLine act={act} name={name} />;
      case 'tally':
      case 'reveal': return <SystemPost act={act} />;
      default:
        return (
          <>
            <p className="kb-small kb-muted"><b>{name}</b> · <time dateTime={act.createdAt}>{when(act.createdAt)}</time></p>
            <BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} />
            <LastEdited act={act} />
            {act.kind === 'post' && <p className="kb-small">{history.button}</p>}
            {history.panel}
          </>
        );
    }
  };

  return (
    <div className="kb-origin" role="group" aria-label="Origin">
      <p className="kb-origin-head"><b>ORIGIN</b> · Spun from {back ?? 'an Act'}</p>
      {body()}
      {act && act.kind !== 'card' && cards.map((c) => <CardLine key={c.id} act={c} name={nameOf(c.character)} />)}
    </div>
  );
}
