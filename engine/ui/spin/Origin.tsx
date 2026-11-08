/**
 * The ORIGIN box at the top of a spun thread: a live view of the Act it was spun from, as that Act
 * stands now (its current words, "Last edited" and History, the card plays on it), not a copy, with
 * a link back to where it is. An edit made after the spin arrives on the origin thread's channel
 * and shows here; the subscription is dropped when the thread is left. It is "loading" until the
 * Act is read, and says so plainly when the Act is not there or could not be read (with a Try again
 * for the second): it never stays on "Loading" for good. A thread spun from a card play on a post shows that play's moment instead (the
 * post as it read when the play landed), which never changes, under the play's mark. When the player has just spun the thread,
 * focus is on this box.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { billPost, drawnOf } from '../cards/billing.ts';
import { PostEffects } from '../cards/Effects.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { MomentView } from '../cards/Moment.tsx';
import { createPlays, effectCards, holdsEffects, playOf, readEffects, usePlays, type Plays } from '../cards/plays.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id, ThreadSummary } from '../data/api.ts';
import { newer } from '../thread/feed.ts';
import { AnnounceLine, LastEdited, SystemPost, UnmaskLine, quoteHead, text, useHistory, when } from '../thread/lines.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { useLocated } from '../thread/locate.tsx';
import { ChangedList, Prose, updateOf } from '../updates/UpdateWords.tsx';
import type { Mine } from '../reactions/mine.ts';
import type { Tallies } from '../thread/tallies.ts';
import { primeSpun, spunCount, takeOrigin } from './spun.ts';
import type { SpinOrigin } from '../thread/Post.tsx';
import { OriginLink } from './OriginLink.tsx';
import { placeHref } from './place.ts';
import { SpinForm, useSpinDrafts } from './SpinForm.tsx';
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
      /* A reaction to the origin, or to a play on it, counts on its tag here as it does in its thread. */
      onTally(act, t) { if (act === origin || plays.get(origin).plays.some((p) => p.id === act)) tallies.merge(act, t); },
    });
    api.act(origin).then(
      (a) => { if (live) { if (a) setAct((was) => (was ? newer(was, a) : a)); else setRead('gone'); } },
      () => { if (live) setRead('failed'); },
    );
    void api.cardsOn(origin, CARDS_SHOWN + 1).then(async (read) => {
      if (!live) return;
      /* The read carries the plays' ends (an admin's reversal) after the plays: they are no plays, so neither the count of "more" nor a
         tally or a reaction is read for them. They join the store beside the plays, which marks a reversed one. */
      const all = read.filter((a) => a.kind !== 'card_end');
      const ends = read.filter((a) => a.kind === 'card_end');
      const shown = all.slice(0, CARDS_SHOWN);
      /*
       * The plays are Acts like the post: their tallies and the player's own reactions to them are read in one read
       * each, with the origin's (its tally is a card play's own when it was spun from one), and their spins through
       * the line's batching; then they are billed as the thread bills a post's plays, once for this read. They join
       * the store only then, so their tags are first drawn in billing order and never move. A count that cannot be
       * read leaves the tags in the order they came, since the box is a view of another thread and not this page.
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
      setMore(all.length > CARDS_SHOWN);
      plays.add([...shown, ...ends.filter((e) => shown.some((p) => p.id === e.targetActId))]);
      billPost(plays, origin, spun, (play) => drawnOf(tallies.get(play), spunCount(spun.get(play)!)));
    }, () => { /* the tags are left out */ });
    return () => { live = false; off(); };
  }, [api, ui, origin, thread, attempt, plays, tallies, mine]);
  return { act, more, reading: act ? 'ready' : read, retry: () => setAttempt((n) => n + 1) };
}

/** The names and pictures of the characters in play on a spin's origin, both read from the one map. */
function useCast(ids: readonly (Id | null)[]): { readonly nameOf: (id: Id | null) => string; readonly faceOf: (id: Id | null) => string | null } {
  const { api, ui } = useKayfa();
  const [known, setKnown] = useState<ReadonlyMap<Id, Character>>(new Map());
  const wanted = [...new Set(ids.filter((i): i is Id => i !== null))].sort().join(',');
  useEffect(() => {
    if (wanted === '') return;
    let live = true;
    api.characters(wanted.split(',')).then((cs) => { if (live) setKnown(new Map(cs.map((c) => [c.id, c]))); }, () => { /* shown as "A character" */ });
    return () => { live = false; };
  }, [api, wanted]);
  return {
    nameOf: (id) => (id === null ? ui.copy.staffWord : known.get(id)?.name ?? 'A character'),
    faceOf: (id) => (id === null ? null : known.get(id)?.avatarSquare ?? null),
  };
}

export function Origin({ summary }: { readonly summary: ThreadSummary }) {
  const { perPage, tallies, mine } = useThread();
  const originId = summary.originActId!;
  const plays = useMemo(() => createPlays(), []);
  const { act, more, reading, retry } = useOrigin(originId, summary.originThread!, plays, tallies, mine);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (takeOrigin(summary.id)) box.current?.focus(); }, [summary.id]);
  const played = usePlays(plays, originId).plays;
  /*
   * A spin from a card play itself shows the play as the box's one mark, kept under the post it landed on (the Act is not a
   * post of this thread, and its post is in another).
   */
  const cardPlay = useMemo(() => (act?.kind === 'card' ? playOf(act) : null), [act]);
  const target = useLocated(cardPlay?.post ?? null);
  useEffect(() => { if (act && cardPlay) plays.add([act]); }, [act, cardPlay, plays]);
  const { nameOf, faceOf } = useCast([act?.character ?? null, ...played.map((p) => p.caster), ...(cardPlay ? [cardPlay.caster] : [])]);
  const history = useHistory(originId);
  /* A play in the box is spun from in a form of the box's own, under it: the box's post is in another thread. */
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  const drafts = useSpinDrafts();
  /* The mark's Go to post for a post origin: the place's own link, where the place is a post. */
  const backHref = summary.origin?.kind === 'post' ? placeHref(summary.origin, perPage) : null;
  const from = <OriginLink place={summary.origin} perPage={perPage} />;

  /* The same node is the box's head's strip and, for a card that lifts the post (Stick Around), the strip it draws on the lifted post. */
  const marks = act && (act.kind === 'card' ? cardPlay !== null : holdsEffects(act.kind)) ? (
    <PostMarks
      post={cardPlay ? cardPlay.post : originId} compare={cardPlay === null} moments={cardPlay === null} plays={plays}
      to={cardPlay ? (target ? threadHref(target.thread, pageOf(target.seq, perPage), target.seq) : null) : backHref}
      nameOf={nameOf} faceOf={faceOf} tallies={tallies} mine={mine}
      onSpin={(play, name, opener) => setSpinOrigin({ id: play.id, label: name, opener })}
    />
  ) : null;

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
      case 'update': {
        /* The developer persona's update: its headline, words and What changed list as the Updates page shows them, under a link back to that page (the thread it was posted in is one the board never lists). */
        const u = updateOf(act);
        return (
          <>
            <p className="kb-small kb-muted"><b>{name}</b> · <time dateTime={act.createdAt}>{when(act.createdAt)}</time></p>
            <p className="kb-origin-update-title"><b>{u.title}</b></p>
            <Prose body={u.body} />
            {u.changes.length > 0 && <ChangedList changes={u.changes} label="What changed" />}
          </>
        );
      }
      case 'card':
        if (!cardPlay) return <p className="kb-small kb-muted">A card was played here.</p>;
        /*
         * A play on a post: its moment, under the mark, read once (docs/plans/2026-11-03-effect-history-design.md, section 4). It never
         * changes, so this case of the box is not live; the mark's Go to post leads to the post as it is now. A play beyond a post
         * shows its mark alone, as before.
         */
        return cardPlay.reach ? null : (
          <MomentView play={cardPlay} place="origin" nameOf={nameOf} now={null}
            bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} />} />
        );
      case 'unmask': return <UnmaskLine act={act} name={name} />;
      case 'announce': return <AnnounceLine act={act} name={name} />;
      case 'tally':
      case 'reveal': return <SystemPost act={act} />;
      default:
        return (
          <>
            <p className="kb-small kb-muted"><b>{name}</b> · <time dateTime={act.createdAt}>{when(act.createdAt)}</time></p>
            <PostEffects plays={plays} post={act} place="origin" marks={marks} nameOf={nameOf}><BbCode text={text(act.currentPayload.body)} quoteHead={quoteHead} /></PostEffects>
            <LastEdited act={act} />
            {act.kind === 'post' && <p className="kb-small">{history.button}</p>}
            {history.panel}
          </>
        );
    }
  };

  return (
    <>
      <div ref={box} className="kb-origin" role="group" aria-label="Origin" tabIndex={-1}>
        <p className="kb-origin-head">
          {/* A play's moment is the box's content, framed by the box: the head says it is the post as the play found it, where a ring and a tag would say it again. */}
          <span className="kb-origin-head-text"><b>ORIGIN</b> · Spun from {from}{cardPlay && !cardPlay.reach && <> · as it landed</>}</span>
          {/* The strip hangs on the box's head, as it does on a post's date row. A card play's is compared with nothing: the post it landed on is in another thread. */}
          {marks}
        </p>
        {body()}
        {act && act.kind !== 'card' && more && (
          <p className="kb-small kb-muted">More than {CARDS_SHOWN} cards were played on this Act; the rest are in {from}.</p>
        )}
      </div>
      {spinOrigin && (
        <SpinForm
          key={spinOrigin.id} origin={spinOrigin.id} label={spinOrigin.label}
          draft={drafts.get(spinOrigin.id)} onDraft={(d) => drafts.set(spinOrigin.id, d)}
          onClose={() => { const back = spinOrigin.opener; setSpinOrigin(null); if (back?.isConnected) back.focus(); }}
        />
      )}
    </>
  );
}
