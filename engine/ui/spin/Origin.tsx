/**
 * The ORIGIN box at the top of a spun thread: a live view of the Act it was spun from, as that Act stands now (its current words, "Last edited" and
 * History, the card plays on it), not a copy, with a link back to where it is. It arrives with the page (docs/plans/2026-11-14-origin-in-page-design.md):
 * the page that holds the thread's first Act carries the origin (`ThreadPage.origin`: the Act, its plays and their ends, the moment, the post it is on
 * and the characters), the thread screen keeps the newest one (`ThreadContext.origin`), and the box draws from it on its first frame, so it reads nothing
 * of its own and has no state of loading or of a failed read; a page that fails has the thread screen's own failure and retry. An edit made after the spin
 * arrives on the origin thread's channel and shows here, as does a play, a saved state and a tally; the subscription is dropped when the thread is left. A page
 * read again (a rejoined channel, a catch-up) brings the origin again and the box takes it in: the newer of the Act held and the Act read, the plays added, the
 * billing set once. It says plainly when the Act is not there (the origin's `act` is null). A thread spun from a card play on a post shows that play's moment
 * instead (the post as it read when the play landed), which never changes, under the play's mark. When the player has just spun the thread, focus is on this box.
 *
 * A thread spun from a card on a character (docs/plans/2026-11-12-spin-at-post-design.md) shows a post of that character, as it was, never live. Where the
 * spin was pressed from the card's mark on a postbit (the place has `at`), that is the pressed post as it was when the spin was written (the spin's own
 * moment, "As it was spun"), and the head says "as it was spun" and, on a second line, links "Cast from" the post the card was cast from. Where the spin names
 * no post (every spin made before this, and any made another way), it is the cast-from post as the play landed (the play's moment, "As it landed"; a play from
 * before the snapshot reads the version current then, and says what else was on the post was not recorded), and the head says "as it landed" on one line:
 * never an error or an empty box. In both the character's name and avatar are one link to its profile, the box has a byline (that link and the version's date)
 * above the words, the card's effect is drawn still on the words, and the mark's Go to post leads to the pressed post where there is one, else the cast-from
 * post. A thread's play and a board's play draw no mark of their own in the box today (the mark is keyed by a post they have not): the box is the head and
 * nothing under it. The moment the page carried is kept in the Lens's store under the key the frame reads it by (`seedMoment`), so the frame reads nothing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { billPost, drawnOf } from '../cards/billing.ts';
import { PostEffects } from '../cards/Effects.tsx';
import { useLensStore } from '../cards/Lens.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { MomentView, useMomentRead } from '../cards/Moment.tsx';
import { createPlays, effectCards, holdsEffects, homeOf, playOf, readEffects, usePlays, type Plays } from '../cards/plays.ts';
import type { CardPlay } from '../cards/types.ts';
import { useKayfa } from '../context.tsx';
import { PLAY_FROM, type Act, type Character, type Id, type OriginPlace, type PageOrigin, type ThreadSummary } from '../data/api.ts';
import { CharacterLink } from '../mini.tsx';
import { Link } from '../router.tsx';
import { newer } from '../thread/feed.ts';
import { AnnounceLine, LastEdited, SystemPost, UnmaskLine, quoteHead, text, useHistory, when } from '../thread/lines.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { ChangedList, Prose, updateOf } from '../updates/UpdateWords.tsx';
import type { Tallies } from '../thread/tallies.ts';
import { spunCount, spunLoader, takeOrigin, type Spun } from './spun.ts';
import type { SpinOrigin } from '../thread/Post.tsx';
import { OriginLink } from './OriginLink.tsx';
import { placeHref, placeParts } from './place.ts';
import { SpinForm, useSpinDrafts } from './SpinForm.tsx';
import './spin.css';

/** Card plays listed under the origin; the page carries at most this many, and says there are more. */
const CARDS_SHOWN = 20;

/** What the box draws where the thread screen holds no origin for it (no page read has carried one): the Act is not there. */
const NOT_THERE: PageOrigin = { act: null, plays: [], more: false, moment: null, at: null, cast: [] };

/**
 * The origin Act and the card plays on it, kept current: the plays are in a store of the box's own (the thread screen's `originPlays`, engine/ui/cards/plays.ts), the one the thread keeps for its posts
 * in kind, so the post's effects draw here as they do there. The page's origin is taken in as it arrives (`takeIn`, before the box's first frame and again for each page read); a play, an edit, a saved
 * state and a tally are heard on the origin thread's channel. `more` says there were more plays than the box lists.
 */
function useOrigin(from: PageOrigin, origin: Id, thread: Id, plays: Plays, tallies: Tallies): { readonly act: Act | null; readonly more: boolean } {
  const { api, ui } = useKayfa();
  const [act, setAct] = useState<Act | null>(from.act);
  const [more, setMore] = useState(from.more);
  /* A page read again brings the origin again: the newer of the Act held and the Act read (an edit heard since is never undone), and what the page says of the rest. */
  const [seen, setSeen] = useState(from);
  if (seen !== from) {
    setSeen(from);
    setAct((was) => (was && from.act ? newer(was, from.act) : from.act ?? was));
    setMore(from.more);
  }
  /* The plays join the store before the box's first frame, so its tags are drawn with it; once per page read, since a new read is a new object. Idempotent, as the thread screen's own take-in of a page is. */
  useMemo(() => {
    const shown = from.plays.filter((a) => a.kind !== 'card_end').slice(0, CARDS_SHOWN);
    const ends = from.plays.filter((a) => a.kind === 'card_end' && shown.some((p) => p.id === a.targetActId));
    /* The Act joins too, when it is a card play (a spin of a play): the box's one mark. Any other Act is ignored by the store. */
    plays.add([...shown, ...ends, ...(from.act ? [from.act] : [])]);
    /* Their tallies and spins came with the page into the thread's stores; they are billed as the thread bills a post's plays, once for this read, from the spun loader's `peek`. A count that is not held leaves the tag in the order it came. */
    const loader = spunLoader(api);
    const spun = new Map<Id, Spun>();
    for (const a of shown) { const s = loader.peek(a.id); if (s) spun.set(a.id, s); }
    billPost(plays, origin, spun, (play) => drawnOf(tallies.get(play), spunCount(spun.get(play)!)));
  }, [api, from, origin, plays, tallies]);
  useEffect(() => {
    const cards = effectCards(ui);
    return api.subscribeThread(thread, {
      onAct(a) {
        if (a.id === origin) setAct((was) => (was ? newer(was, a) : a));
        else if (a.kind === 'card' && a.targetActId === origin) { plays.add([a]); void readEffects(api, plays, [a], cards); }
      },
      onEffect(play) { void api.effectStates([play]).then((saved) => plays.setStates(saved), () => { /* the next save is heard again */ }); },
      /* A reaction to the origin, or to a play on it, counts on its tag here as it does in its thread. */
      onTally(act, t) { if (act === origin || plays.get(origin).plays.some((p) => p.id === act)) tallies.merge(act, t); },
    });
  }, [api, ui, origin, thread, plays, tallies]);
  return { act, more };
}

/**
 * The names and pictures of the characters in play on a spin's origin, both read from the one map: the page's `cast` first, and one read for the characters it did not name (a caster heard live),
 * never a chain: a read that finds none leaves them as "A character".
 */
function useCast(cast: readonly Character[], ids: readonly (Id | null)[]): { readonly nameOf: (id: Id | null) => string; readonly faceOf: (id: Id | null) => string | null; readonly characterOf: (id: Id) => Character | undefined } {
  const { api, ui } = useKayfa();
  const [read, setRead] = useState<ReadonlyMap<Id, Character>>(new Map());
  const held = useMemo(() => new Map(cast.map((c) => [c.id, c])), [cast]);
  const characterOf = (id: Id) => held.get(id) ?? read.get(id);
  const missing = [...new Set(ids.filter((i): i is Id => i !== null && characterOf(i) === undefined))].sort().join(',');
  useEffect(() => {
    if (missing === '') return;
    let live = true;
    api.characters(missing.split(',')).then((cs) => { if (live) setRead((was) => new Map([...was, ...cs.map((c): [Id, Character] => [c.id, c])])); }, () => { /* shown as "A character" */ });
    return () => { live = false; };
  }, [api, missing]);
  return {
    nameOf: (id) => (id === null ? ui.copy.staffWord : characterOf(id)?.name ?? 'A character'),
    faceOf: (id) => (id === null ? null : characterOf(id)?.avatarSquare ?? null),
    characterOf,
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
  const { perPage, tallies, mine, origin: held, originPlays } = useThread();
  const { instance } = useKayfa();
  const originId = summary.originActId!;
  const from = held ?? NOT_THERE;
  /* The box's store is the thread screen's, which gives it the saved states and releases the page carried; a box drawn without one keeps a store of its own. */
  const own = useMemo(() => createPlays(), []);
  const plays = originPlays ?? own;
  const { act, more } = useOrigin(from, originId, summary.originThread!, plays, tallies);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (takeOrigin(summary.id)) box.current?.focus(); }, [summary.id]);
  const played = usePlays(plays, originId).plays;
  /*
   * A spin from a card play itself shows the play as the box's one mark, kept under the post it landed on (the Act is not a
   * post of this thread, and its post is in another).
   */
  const cardPlay = useMemo(() => (act?.kind === 'card' ? playOf(act) : null), [act]);
  const target = from.at;
  const { nameOf, faceOf, characterOf } = useCast(from.cast, [act?.character ?? null, ...played.map((p) => p.caster), ...(cardPlay ? [cardPlay.caster, ...(cardPlay.reach === 'character' && cardPlay.on ? [cardPlay.on] : [])] : [])]);
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
  /* The spin whose moment the box shows, or null: one value, so the head and the frame cannot disagree about "as it was spun". */
  const spinAt = pressed && summary.firstAct ? summary.firstAct : null;
  /* The moment the page carried is kept under the key the frame reads it by, before the frame is drawn: a spin's own where the box shows the pressed post, else the play's. A spin pressed on a post whose row names no first Act is the frame's to read. */
  const lens = useLensStore();
  useMemo(() => {
    if (cardPlay && (onCharacter || !cardPlay.reach) && !(pressed && spinAt === null)) lens.seedMoment(onCharacter ? spinAt ?? cardPlay.id : cardPlay.id, from.moment);
  }, [lens, cardPlay, onCharacter, pressed, spinAt, from.moment]);
  const link = <OriginLink place={summary.origin} perPage={perPage} {...(onCharacter ? { faces: characterOf } : {})} />;

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
    if (!act) return <p className="kb-notice kb-small">The Act this thread was spun from is not there.</p>;
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
          return <CharacterMoment play={cardPlay} spin={spinAt} nameOf={nameOf} characterOf={characterOf} />;
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
            <b>ORIGIN</b> · Spun from {link}{cardPlay && !cardPlay.reach && <> · as it landed</>}{onCharacter && <> · {spinAt !== null ? 'as it was spun' : 'as it landed'}</>}
            {spinAt !== null && castFrom && <span className="kb-origin-head-line">Cast from <Link to={castFrom.href}>{castFrom.words}</Link></span>}
          </span>
          {/* The strip hangs on the box's head, as it does on a post's date row. A card play's is compared with nothing: the post it landed on is in another thread. */}
          {marks}
        </p>
        {body()}
        {act && act.kind !== 'card' && more && (
          <p className="kb-small kb-muted">More than {CARDS_SHOWN} cards were played on this Act; the rest are in {link}.</p>
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
