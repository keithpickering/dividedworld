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
import { billing, drawnOf } from '../cards/billing.ts';
import { PlayTag, PlayTags, PostEffects } from '../cards/Effects.tsx';
import { createPlays, effectCards, holdsEffects, playOf, readEffects, usePlays, type Plays } from '../cards/plays.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id, ThreadSummary } from '../data/api.ts';
import { newer } from '../thread/feed.ts';
import { LastEdited, SystemPost, UnmaskLine, quoteLink, text, useHistory, when } from '../thread/lines.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { useLocated } from '../thread/locate.tsx';
import { Link } from '../router.tsx';
import type { Mine } from '../reactions/mine.ts';
import type { Tallies } from '../thread/tallies.ts';
import { primeSpun, spunCount, takeOrigin } from './spun.ts';
import './spin.css';

/** Card plays listed under the origin; a read of one more says there are more on the Act itself. */
const CARDS_SHOWN = 20;

type Reading = 'loading' | 'ready' | 'gone' | 'failed';

/**
 * The origin Act and the card plays on it, kept current: the plays are in a store of the box's own
 * (engine/ui/cards/plays.ts), the one the thread keeps for its posts, so the post's effects draw here as they
 * do there. `more` says there were more plays than the box lists.
 */
function useOrigin(origin: Id, thread: Id, plays: Plays, tallies: Tallies, mine: Mine): { readonly act: Act | null; readonly more: boolean; readonly reading: Reading; readonly retry: () => void } {
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
    void api.cardsOn(origin, CARDS_SHOWN + 1).then(async (all) => {
      if (!live) return;
      setMore(all.length > CARDS_SHOWN);
      const shown = all.slice(0, CARDS_SHOWN);
      plays.add(shown);
      /*
       * The plays are Acts like the post: their tallies and the player's own reactions to them are read in one read
       * each, with the origin's (its tally is a card play's own when it was spun from one), and their spins through
       * the line's batching; then they are billed as the thread bills a post's plays, once for this read.
       */
      const ids = [origin, ...shown.map((a) => a.id)];
      const [counted, own, spun] = await Promise.all([
        api.tallies(ids).catch(() => ({})),
        api.myReactions(ids).catch(() => []),
        primeSpun(api, ids),
        readEffects(api, plays, shown, cards),
      ]);
      if (!live) return;
      for (const [id, t] of Object.entries(counted)) tallies.merge(id, t);
      for (const id of ids) mine.merge(id, own.filter((r) => r.act === id));
      const here = plays.get(origin).plays;
      plays.setBilling(origin, billing(here, (play) => drawnOf(tallies.get(play), spunCount(spun.get(play)!))).map((p) => p.id));
    }, () => { /* the tags are left out */ });
    return () => { live = false; off(); };
  }, [api, ui, origin, thread, attempt, plays, tallies, mine]);
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
  const { perPage, tallies, mine } = useThread();
  const originId = summary.originActId!;
  const plays = useMemo(() => createPlays(), []);
  const { act, more, reading, retry } = useOrigin(originId, summary.originThread!, plays, tallies, mine);
  const box = useRef<HTMLDivElement>(null);
  /* The effect's plate is drawn here, after the box and attached to it, and not in it: the 2003 chrome holds the post's words, never the game's. */
  const slot = useRef<HTMLDivElement>(null);
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
            <PostEffects plays={plays} post={act} place="origin" slot={slot}><BbCode text={text(act.currentPayload.body)} quoteLink={quoteLink} /></PostEffects>
            <LastEdited act={act} />
            {act.kind === 'post' && <p className="kb-small">{history.button}</p>}
            {history.panel}
          </>
        );
    }
  };

  /* The kinds `body` draws with the post's effects (its default case) are the ones that hold a plate: the thread's post asks the same helper. */
  const effects = act !== null && holdsEffects(act.kind);
  return (
    <>
      <div ref={box} className="kb-origin" role="group" aria-label="Origin" tabIndex={-1}>
        <p className="kb-origin-head"><b>ORIGIN</b> · Spun from {back ?? 'an Act'}</p>
        {body()}
        {act && act.kind !== 'card' && more && (
          <p className="kb-small kb-muted">More than {CARDS_SHOWN} cards were played on this Act; the rest are in {back ?? 'the thread it was spun from'}.</p>
        )}
      </div>
      {effects && <div className="kb-act-slot" ref={slot} />}
    </>
  );
}
