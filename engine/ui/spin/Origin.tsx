/**
 * The ORIGIN box at the top of a spun thread: a live view of the Act it was spun from, as that Act
 * stands now (its current words, "Last edited" and History, the card plays on it), not a copy, with
 * a link back to where it is. An edit made after the spin arrives on the origin thread's channel
 * and shows here; the subscription is dropped when the thread is left. It is "loading" until the
 * Act is read, and says so plainly when the Act is not there or could not be read (with a Try again
 * for the second): it never stays on "Loading" for good. A thread spun from a card play on a post shows that play's moment instead (the
 * post as it read when the play landed), which never changes, under the play's mark. When the player has just spun the thread,
 * focus is on this box.
 *
 * A thread spun from a card on a character (docs/plans/2026-11-12-spin-at-post-design.md) shows a post of that character, as it was,
 * never live. Where the spin was pressed from the card's mark on a postbit (the place has `at`), that is the pressed post as it was
 * when the spin was written (the spin's own moment, "As it was spun"), and the head says "as it was spun" and, on a second line, links
 * "Cast from" the post the card was cast from. Where the spin names no post (every spin made before this, and any made another way),
 * it is the cast-from post as the play landed (the play's moment, "As it landed"; a play from before the snapshot reads the version
 * current then, and says what else was on the post was not recorded), and the head says "as it landed" on one line: never an error
 * or an empty box. In both the character's name and avatar are one link to its profile, the box has a byline (that link and the
 * version's date) above the words, the card's effect is drawn still on the words, and the mark's Go to post leads to the pressed
 * post where there is one, else the cast-from post. A thread's play and a board's play draw no mark of their own in the box today (the mark is keyed by a post they have not): the box is the head and nothing under it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { billPost, drawnOf } from '../cards/billing.ts';
import { PostEffects } from '../cards/Effects.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { MomentView, useMomentRead } from '../cards/Moment.tsx';
import { createPlays, effectCards, holdsEffects, homeOf, playOf, readEffects, usePlays, type Plays } from '../cards/plays.ts';
import type { CardPlay } from '../cards/types.ts';
import { useKayfa } from '../context.tsx';
import { PLAY_FROM, type Act, type Character, type Id, type OriginPlace, type ThreadSummary } from '../data/api.ts';
import { CharacterLink } from '../mini.tsx';
import { Link } from '../router.tsx';
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
import { placeHref, placeParts } from './place.ts';
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
function useCast(ids: readonly (Id | null)[]): { readonly nameOf: (id: Id | null) => string; readonly faceOf: (id: Id | null) => string | null; readonly characterOf: (id: Id) => Character | undefined } {
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
    characterOf: (id) => known.get(id),
  };
}

/**
 * The box of a thread spun from a card on a character: a byline (the character's avatar and name, one link to its profile, and the
 * version's date), then the post as a moment, drawn still with the card's effect on it. `spin` is the spin's own Act where the spin was
 * pressed on a post (its moment, "As it was spun"); without it the play's own moment is the cast-from post as it landed. The moment is
 * read through the same store the frame reads it by, so it is read once.
 */
function CharacterMoment({ play, spin, nameOf, characterOf }: {
  readonly play: CardPlay; readonly spin: Id | null;
  readonly nameOf: (id: Id | null) => string; readonly characterOf: (id: Id) => Character | undefined;
}) {
  const { api } = useKayfa();
  const read = useMomentRead(spin ?? play.id, () => (spin ? api.spinMoment(spin) : api.playMoment(play.id)));
  const version = read.status === 'read' ? read.moment?.version ?? null : null;
  const who = play.on!;
  return (
    <>
      <p className="kb-small kb-muted">
        <CharacterLink id={who} character={characterOf(who)} name={nameOf(who)} />
        {version && <> · <time dateTime={version.editedAt ?? version.createdAt}>{when(version.editedAt ?? version.createdAt)}</time></>}
      </p>
      <MomentView play={play} place="origin" nameOf={nameOf} now={null} {...(spin ? { source: { spin } } : {})}
        bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} />} />
    </>
  );
}

/** The post a part of a play's place names, as its words and its address: `at` (the pressed post) or, with `at` left out, `from` (the cast-from post). */
function postOf(place: Extract<OriginPlace, { kind: 'play' }>, which: 'at' | typeof PLAY_FROM, cardName: (key: string) => string | undefined, perPage: number): { readonly words: string; readonly href: string } | null {
  if (place[which] === null) return null;
  const part = placeParts(which === 'at' ? place : { ...place, at: null }, cardName, perPage).at(-1);
  return part && part.href !== null ? { words: part.words, href: part.href } : null;
}

export function Origin({ summary }: { readonly summary: ThreadSummary }) {
  const { perPage, tallies, mine } = useThread();
  const { instance } = useKayfa();
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
  const { nameOf, faceOf, characterOf } = useCast([act?.character ?? null, ...played.map((p) => p.caster), ...(cardPlay ? [cardPlay.caster, ...(cardPlay.reach === 'character' && cardPlay.on ? [cardPlay.on] : [])] : [])]);
  const history = useHistory(originId);
  /* A play in the box is spun from in a form of the box's own, under it: the box's post is in another thread. */
  const [spinOrigin, setSpinOrigin] = useState<SpinOrigin | null>(null);
  const drafts = useSpinDrafts();
  /* The mark's Go to post for a post origin: the place's own link, where the place is a post. */
  const backHref = summary.origin?.kind === 'post' ? placeHref(summary.origin, perPage) : null;
  /* A card on a character: its box shows a post of that character, and the head names the post it was pressed on and the post it was cast from. */
  const onCharacter = cardPlay?.reach === 'character' && cardPlay.on !== undefined;
  const play = summary.origin?.kind === 'play' ? summary.origin : null;
  const cardName = (key: string) => instance.cards.find((c) => c.key === key)?.name;
  const pressed = play && onCharacter ? postOf(play, 'at', cardName, perPage) : null;
  const castFrom = play && onCharacter ? postOf(play, PLAY_FROM, cardName, perPage) : null;
  const from = <OriginLink place={summary.origin} perPage={perPage} {...(onCharacter ? { faces: characterOf } : {})} />;

  /* The same node is the box's head's strip and, for a card that lifts the post (Stick Around), the strip it draws on the lifted post. */
  const marks = act && (act.kind === 'card' ? cardPlay !== null : holdsEffects(act.kind)) ? (
    <PostMarks
      post={cardPlay ? (onCharacter ? homeOf(cardPlay) : cardPlay.post) : originId} {...(onCharacter ? { where: 'character' } : {})} compare={cardPlay === null} moments={cardPlay === null} plays={plays}
      to={cardPlay ? (pressed?.href ?? castFrom?.href ?? (target ? threadHref(target.thread, pageOf(target.seq, perPage), target.seq) : null)) : backHref}
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
        if (cardPlay.reach === 'character' && cardPlay.on !== undefined) {
          /* A card on a character: a post of that character, as it was spun where the spin names one, else as the play landed on the cast-from post. */
          return <CharacterMoment play={cardPlay} spin={pressed && summary.firstAct ? summary.firstAct : null} nameOf={nameOf} characterOf={characterOf} />;
        }
        return cardPlay.reach ? null : (
          <MomentView play={cardPlay} place="origin" nameOf={nameOf} now={null}
            bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} />} />
        );
      case 'draw':
      case 'wash': return null;
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
          <span className="kb-origin-head-text">
            <b>ORIGIN</b> · Spun from {from}{cardPlay && !cardPlay.reach && <> · as it landed</>}{onCharacter && <> · {pressed ? 'as it was spun' : 'as it landed'}</>}
            {pressed && castFrom && <span className="kb-origin-head-line">Cast from <Link to={castFrom.href}>{castFrom.words}</Link></span>}
          </span>
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
