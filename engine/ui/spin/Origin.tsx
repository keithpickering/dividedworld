/**
 * The ORIGIN box at the top of a spun thread: a live view of the Act it was spun from, as that Act
 * stands now (its current words, "Last edited" and History, the card plays on it), not a copy, with
 * a link back to where it is. An edit made after the spin arrives on the origin thread's channel
 * and shows here; the subscription is dropped when the thread is left. It is "loading" until the
 * Act is read, and says so plainly when the Act is not there or could not be read (with a Try again
 * for the second): it never stays on "Loading" for good. When the player has just spun the thread,
 * focus is on this box.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { PlayTag, PlayTags, PostEffects } from '../cards/Effects.tsx';
import { createPlays, effectCards, playOf, readEffects, usePlays, type Plays } from '../cards/plays.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id, ThreadSummary } from '../data/api.ts';
import { newer } from '../thread/feed.ts';
import { LastEdited, SystemPost, UnmaskLine, quoteLink, text, useHistory, when } from '../thread/lines.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { useLocated } from '../thread/locate.tsx';
import { Link } from '../router.tsx';
import { takeOrigin } from './spun.ts';
import './spin.css';

/** Card plays listed under the origin; a read of one more says there are more on the Act itself. */
const CARDS_SHOWN = 20;

type Reading = 'loading' | 'ready' | 'gone' | 'failed';

/**
 * The origin Act and the card plays on it, kept current: the plays are in a store of the box's own
 * (engine/ui/cards/plays.ts), the one the thread keeps for its posts, so the post's effects draw here as they
 * do there. `more` says there were more plays than the box lists.
 */
function useOrigin(origin: Id, thread: Id, plays: Plays): { readonly act: Act | null; readonly more: boolean; readonly reading: Reading; readonly retry: () => void } {
  const { api, ui } = useKayfa();
  const [act, setAct] = useState<Act | null>(null);
  const [more, setMore] = useState(false);
  const [read, setRead] = useState<'loading' | 'gone' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRead('loading');
    const cards = effectCards(ui);
    const off = api.subscribeThread(thread, {
      onAct(a) {
        if (a.id === origin) setAct((was) => (was ? newer(was, a) : a));
        else if (a.kind === 'card' && a.targetActId === origin) { plays.add([a]); void readEffects(api, plays, [a], cards); }
      },
      onEffect(play) { void api.effectStates([play]).then((saved) => plays.setStates(saved), () => { /* the next save is heard again */ }); },
    });
    api.act(origin).then(
      (a) => { if (live) { if (a) setAct((was) => (was ? newer(was, a) : a)); else setRead('gone'); } },
      () => { if (live) setRead('failed'); },
    );
    void api.cardsOn(origin, CARDS_SHOWN + 1).then((all) => {
      if (!live) return;
      setMore(all.length > CARDS_SHOWN);
      const shown = all.slice(0, CARDS_SHOWN);
      plays.add(shown);
      return readEffects(api, plays, shown, cards);
    }, () => { /* the tags are left out */ });
    return () => { live = false; off(); };
  }, [api, ui, origin, thread, attempt, plays]);
  return { act, more, reading: act ? 'ready' : read, retry: () => setAttempt((n) => n + 1) };
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

/** A spin from a card play itself: the play as its tag, linking to the post it landed on. */
function CardOrigin({ act, nameOf }: { readonly act: Act; readonly nameOf: (id: Id | null) => string }) {
  const { perPage } = useThread();
  const play = playOf(act);
  const target = useLocated(act.targetActId);
  if (!play) return <p className="kb-small kb-muted">A card was played here.</p>;
  return (
    <ul className="kb-play-tags">
      <PlayTag play={play} caster={nameOf(play.caster)} to={target ? threadHref(target.thread, pageOf(target.seq, perPage), target.seq) : null} />
    </ul>
  );
}

export function Origin({ summary }: { readonly summary: ThreadSummary }) {
  const { perPage } = useThread();
  const originId = summary.originActId!;
  const plays = useMemo(() => createPlays(), []);
  const { act, more, reading, retry } = useOrigin(originId, summary.originThread!, plays);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (takeOrigin(summary.id)) box.current?.focus(); }, [summary.id]);
  const played = usePlays(plays, originId).plays;
  const nameOf = useNames([act?.character ?? null, ...played.map((p) => p.caster)]);
  const history = useHistory(originId);
  const backHref = summary.originSeq !== null && summary.originTitle !== null ? threadHref(summary.originThread!, pageOf(summary.originSeq, perPage), summary.originSeq) : null;
  const back = backHref !== null ? <Link to={backHref}>#{summary.originSeq} in {summary.originTitle}</Link> : null;

  const body = () => {
    if (!act) {
      if (reading === 'gone') return <p className="kb-notice kb-small">The Act this thread was spun from is not there.</p>;
      if (reading === 'failed') {
        return (
          <p className="kb-notice kb-small" data-kb-tone="refusal">
            The Act this thread was spun from could not be read. <button type="button" className="kb-link-button" onClick={retry}>Try again</button>
          </p>
        );
      }
      return <p className="kb-muted kb-small" aria-busy="true">Loading the origin…</p>;
    }
    const name = nameOf(act.character);
    switch (act.kind) {
      case 'card': return <CardOrigin act={act} nameOf={nameOf} />;
      case 'unmask': return <UnmaskLine act={act} name={name} />;
      case 'tally':
      case 'reveal': return <SystemPost act={act} />;
      default:
        return (
          <>
            <p className="kb-small kb-muted"><b>{name}</b> · <time dateTime={act.createdAt}>{when(act.createdAt)}</time></p>
            <PlayTags plays={plays} post={originId} to={backHref} nameOf={nameOf} />
            <PostEffects plays={plays} post={act} place="origin"><BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} /></PostEffects>
            <LastEdited act={act} />
            {act.kind === 'post' && <p className="kb-small">{history.button}</p>}
            {history.panel}
          </>
        );
    }
  };

  return (
    <div ref={box} className="kb-origin" role="group" aria-label="Origin" tabIndex={-1}>
      <p className="kb-origin-head"><b>ORIGIN</b> · Spun from {back ?? 'an Act'}</p>
      {body()}
      {act && act.kind !== 'card' && more && (
        <p className="kb-small kb-muted">More than {CARDS_SHOWN} cards were played on this Act; the rest are in {back ?? 'the thread it was spun from'}.</p>
      )}
    </div>
  );
}
