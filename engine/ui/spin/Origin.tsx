/**
 * The ORIGIN box at the top of a spun thread: a live view of the Act it was spun from, as that Act stands now (its current words, "Last edited" and
 * History, the card plays on it), not a copy, with a link back to where it is. It arrives with the page (docs/plans/2026-11-14-origin-in-page-design.md):
 * the page that holds the thread's first Act carries the origin (`ThreadPage.origin`: the Act, its plays and their ends, the moment, the post it is on
 * and the characters), the thread screen keeps the newest one (`ThreadContext.origin`), and the box draws from it on its first frame, so it reads nothing
 * of its own and has no state of loading or of a failed read; a page that fails has the thread screen's own failure and retry. An edit made after the spin
 * arrives on the origin thread's channel and shows here, as does a play, a saved state and a tally; the subscription is dropped when the thread is left. A page
 * read again (a rejoined channel, a catch-up) brings the origin again and the box takes it in: the newer of the Act held and the Act read, the plays added, the
 * billing set once. It says plainly when the Act is not there (the origin's `act` is null). A play on the live post offers As it landed in its Lens row, as it does in the post's own thread: the play's moment is drawn in the box's content area in place of the live post (its ink filling the area as the live effect's does), with its tag at the moment's top, since the area is no post's body and has no date bar to hang it on, until Back to now. A thread spun from a card play on a post shows that play's moment
 * instead (the post as it read when the play landed), under the play's mark. The moment is read once and never changes, but it is playable (docs/plans/2026-11-16-playable-moments-design.md): each effect in
 * it runs live from the state it had then, saves and sends nothing, and is as it landed again on Reset, which the head carries ("… · as it landed · Reset"). The box has a mark for every card drawn in
 * it (the spun play's row keeps React and Spin; the other plays' rows say their state then, hold their controls and link Go to post), so an older card's obstacle has its Lens and its keyboard path. When the player has just spun the thread, focus is on this box.
 *
 * A thread spun from a card on a character (docs/plans/2026-11-12-spin-at-post-design.md) shows a post of that character, as it was, never live. Where the
 * spin was pressed from the card's mark on a postbit (the place has `at`), that is the pressed post as it was when the spin was written (the spin's own
 * moment, "As it was spun"), and the head says "as it was spun" and, on a second line, links "Cast from" the post the card was cast from. Where the spin names
 * no post (every spin made before this, and any made another way), it is the cast-from post as the play landed (the play's moment, "As it landed"; a play from
 * before the snapshot reads the version current then, and says what else was on the post was not recorded), and the head says "as it landed" on one line:
 * never an error or an empty box. In both the character's name and avatar are one link to its profile, the box has a byline (that link and the version's date)
 * in a band of its own between the head and the words, the card's effect is drawn on the words as a live one (a moment is playable), and the mark's Go to post leads to the pressed post where there is one, else the cast-from
 * post. A thread's play and a board's play draw no mark of their own in the box today (the mark is keyed by a post they have not): the box is the head and
 * nothing under it. Everything under the band and the byline (`Byline`, a band of the box's own) stands in one content area (`div.kb-origin-area`, marked `data-kb-content-area`, drawn only where something stands there), which is what an
 * effect on the box fills and finds as its body; the History button, its panel and the "More than" note are lifted over it, and the box itself over the opening post's effect (spin.css). What a moment says under its post stands in the box's foot (`div.kb-origin-foot`), under the content area and outside it, so no effect that fills the area passes under it and nothing arrives late inside the area an effect has measured. The moment the page carried is kept in the Lens's store under the key the frame reads it by (`seedMoment`), so the frame reads nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { billPost, drawnOf, type BillOver } from '../cards/billing.ts';
import { PostEffects, WriteLateNote, momentParts } from '../cards/Effects.tsx';
import { ReactionRowScope } from '../reactions/Reactions.tsx';
import { useLooseReactions } from '../thread/loose.ts';
import { useLensStore } from '../cards/Lens.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { MomentView } from '../cards/Moment.tsx';
import { createPlays, effectCards, holdsEffects, homeOf, keepingKeys, markedPlays, playOf, readEffects, readRewinds, rewindCards, shownPlays, usePlays, useRewound, type Plays } from '../cards/plays.ts';
import type { CardPlay, CardView } from '../cards/types.ts';
import { useKayfa } from '../context.tsx';
import { PLAY_FROM, type Act, type Character, type Id, type OriginPlace, type PageOrigin, type ThreadSummary } from '../data/api.ts';
import { CharacterLink } from '../mini.tsx';
import { Poll } from '../polls/Poll.tsx';
import { createPolls, usePoll, type Polls } from '../polls/store.ts';
import { ballotLine } from '../polls/words.ts';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { newer } from '../thread/feed.ts';
import { AnnounceLine, LastEdited, SystemPost, UnmaskLine, quoteHead, text, useHistory, when } from '../thread/lines.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { ChangedList, Prose, updateOf } from '../updates/UpdateWords.tsx';
import type { Tallies } from '../thread/tallies.ts';
import { spunCount, takeOrigin, type Spun } from './spun.ts';
import type { SpinOrigin } from '../thread/Post.tsx';
import { Exchange } from './Exchange.tsx';
import { OriginLink } from './OriginLink.tsx';
import { placeHref, placeParts } from './place.ts';
import { SpinForm, useSpinDrafts } from './SpinForm.tsx';
import { forgedList } from '../../bbcode/quoted.ts';
import './spin.css';

/** What the box draws where the thread screen holds no origin for it (no page read has carried one): the Act is not there. */
const NOT_THERE: PageOrigin = { act: null, plays: [], counts: [], moment: null, at: null, cast: [], polls: [], voters: [], votersMore: [], myBallots: [] };

/**
 * Take a page's origin into the box's store of plays: the shown plays and their ends (and the Act, when it is a card play: the box's one mark; the store ignores any other Act), then the billing,
 * once for this page read, from the tallies and the spins of the plays that the page put in the thread's stores (`spun` holds those it counted). The plays join the store only here, so their tags are first drawn
 * in billing order and never move. Called by the thread screen's `absorb`, outside any render.
 */
export function takeInOrigin(origin: PageOrigin, id: Id, plays: Plays, tallies: Tallies, spun: ReadonlyMap<Id, Spun>, over?: BillOver, polls?: Polls, ticket = 0): void {
  /* A thread spun from a poll or a ballot: the poll, its voters and the caller's ballots go to the box's store of polls (where the box is drawn without one, `useOrigin` takes them in). */
  if (polls !== undefined) takeInPolls(origin, polls, ticket);
  plays.add([...origin.plays, ...(origin.act ? [origin.act] : [])]);
  plays.setCounts(origin.counts);
  billPost(plays, id, spun, (play) => drawnOf(tallies.get(play), spunCount(spun.get(play)!)), over);
}

/** The origin's poll parts into a store of polls: the poll of the origin's post (a removed poll leaves none), with the voters' heads in `cast` as the page's voters are named. */
function takeInPolls(origin: PageOrigin, polls: Polls, ticket: number): void {
  /* The poll's post, so a poll taken away is dropped on a read again: a poll origin names it; a ballot origin names the poll, whose post the store knows. */
  const target = origin.act?.kind === 'poll' || origin.act?.kind === 'ballot' ? origin.act.targetActId : null;
  const spun = target === null ? null : origin.act!.kind === 'poll' ? target : polls.postOf(target) ?? null;
  polls.take({ polls: origin.polls, voters: origin.voters, votersMore: origin.votersMore, myBallots: origin.myBallots, voterCast: origin.cast }, ticket, [...origin.polls.map((p) => p.post), ...(spun === null ? [] : [spun])]);
}

/**
 * The origin Act and the card plays on it, kept current: the plays are in a store of the box's own (the thread screen's `originPlays`, engine/ui/cards/plays.ts), the one the thread keeps for its posts
 * in kind, so the post's effects draw here as they do there. The page's origin is taken in as it arrives (`takeIn`, before the box's first frame and again for each page read); a play, an edit, a saved
 * state and a tally are heard on the origin thread's channel.
 */
function useOrigin(from: PageOrigin, origin: Id, thread: Id, plays: Plays, tallies: Tallies, shared: boolean, polls: Polls, catchUp?: () => void): { readonly act: Act | null } {
  const { api, ui, instance } = useKayfa();
  /* The player's own characters: a ballot of theirs heard here is their own ballot on the poll. */
  const { characters } = usePlayer();
  const own = useRef<ReadonlySet<Id>>(new Set());
  own.current = new Set(characters.map((c) => c.id));
  const [act, setAct] = useState<Act | null>(from.act);
  /* A page read again brings the origin again: the newer of the Act held and the Act read (an edit heard since is never undone), and what the page says of the rest. */
  const [seen, setSeen] = useState(from);
  if (seen !== from) {
    setSeen(from);
    setAct((was) => (was && from.act ? newer(was, from.act) : from.act ?? was));
  }
  /* The thread screen takes the page's origin into its store of the box's plays as it takes a page in (`takeInOrigin`,
     called by `absorb`), so the box's first frame has its tags. A box drawn without that store (a story) takes its own
     in here, and a story box is not billed for spent: it bills by draws alone. */
  useEffect(() => { if (!shared) takeInOrigin(from, origin, plays, tallies, new Map(), undefined, polls); }, [shared, from, origin, plays, tallies, polls]);
  useEffect(() => {
    const cards = effectCards(ui);
    const rewinding = rewindCards(instance.cards);
    return api.subscribeThread(thread, {
      onAct(a) {
        if (a.kind === 'poll') { polls.pollAct(a); if (a.id === origin) setAct((was) => (was ? newer(was, a) : a)); return; }
        if (a.kind === 'poll_close') { polls.closeAct(a); return; }
        if (a.kind === 'ballot') {
          const stranger = polls.ballotAct(a, own.current);
          if (stranger !== null) void api.characters([stranger]).then((found) => polls.named(found), () => { /* named on the next ballot */ });
          return;
        }
        if (a.id === origin) setAct((was) => (was ? newer(was, a) : a));
        else if (a.kind === 'card' && a.targetActId === origin) { plays.add([a]); void readEffects(api, plays, [a], cards); void readRewinds(api, plays, [a], rewinding, catchUp); }
      },
      onEffect(play) { void api.effectStates([play]).then((saved) => plays.setStates(saved), () => { /* the next save is heard again */ }); },
      /* A reaction to the origin, or to a play on it, counts on its tag here as it does in its thread. */
      onTally(act, t) { if (act === origin || plays.get(origin).plays.some((p) => p.id === act)) tallies.merge(act, t); },
      /* The origin post's poll: its counts, a replacement, a close and a ballot, as the origin's thread hears them (the same events the thread screen applies to its own polls). */
      onPoll(e) { polls.counts(e); },
    });
  }, [api, ui, instance.cards, origin, thread, plays, tallies, polls, catchUp]);
  return { act };
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
 * The box of a thread spun from a card on a character: the post as a moment (its byline is the box's, `Byline`), drawn with the card's effect on it, playable. `spin` is the spin's own Act where the spin was
 * pressed on a post (its moment, "As it was spun"); without it the play's own moment is the cast-from post as it landed. The moment is
 * read through the same store the frame reads it by, so it is read once.
 */
function CharacterMoment({ play, spin, nameOf, onView, listInto }: {
  readonly play: CardPlay; readonly spin: Id | null; readonly onView: (card: string, view: CardView | null) => void;
  /** The box's foot, where the moment's list stands. */
  readonly listInto: HTMLElement | null;
  readonly nameOf: (id: Id | null) => string;
}) {
  return (
    <>
      <MomentView play={play} place="origin" nameOf={nameOf} now={null} onView={onView} listInto={listInto} {...(spin ? { source: { spin } } : {})}
        bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} forged={forgedList(version.currentPayload)} />} />
    </>
  );
}

/**
 * Who wrote what the box shows, and when: a band of the box's own between its head and its content area, as a post's date bar stands above its body, so the byline is
 * the box's and never part of the post an effect fills (the owner, 2026-11-21: "an impromptu postbit which is not part of the post itself").
 */
function Byline({ who, at }: { readonly who: ReactNode; readonly at: string | null }) {
  return (
    <p className="kb-origin-byline">
      {who}
      {at !== null && <> · <time dateTime={at}>{when(at)}</time></>}
    </p>
  );
}

/** Whether the box draws an Act of this kind as a post, its words under a byline: every kind the box's switch leaves to its default. */
function isPostLike(kind: Act['kind']): boolean {
  return !['update', 'card', 'draw', 'wash', 'unmask', 'announce', 'tally', 'reveal', 'report', 'report_verdict', 'appeal', 'appeal_ruling'].includes(kind);
}

/** The post a part of a play's place names, as its words and its address: `at` (the pressed post) or, with `at` left out, `from` (the cast-from post). */
function postOf(place: Extract<OriginPlace, { kind: 'play' }>, which: 'at' | typeof PLAY_FROM, cardName: (key: string) => string | undefined, perPage: number): { readonly words: string; readonly href: string } | null {
  if (place[which] === null) return null;
  const part = placeParts(which === 'at' ? place : { ...place, at: null }, cardName, () => undefined, perPage).at(-1);
  return part && part.href !== null ? { words: part.words, href: part.href } : null;
}

/**
 * The origin when it is a poll or a public ballot: the poll's author and date (or, for a ballot, its line, "Wario picked Badwagon, Nov 20, 3:12 PM", above the table), then the poll as it stands now in the box's store.
 * It can be voted in while open and is final once closed (the `Poll` is the one the board draws). A bar is checked by the server alone: the box does not know the poll's board.
 */
function PollOrigin({ act, post, polls, name }: { readonly act: Act; readonly post: Id | null; readonly polls: Polls; readonly name: string }) {
  const view = usePoll(polls, post ?? '');
  /* The poll this origin is: the Act itself, or the poll a ballot is on. A replacement heard or read on the post is another poll, and is never drawn under this one's head. */
  const origin = act.kind === 'poll' ? act.id : act.targetActId;
  if (post === null || view === undefined) return <p className="kb-notice kb-small">That poll is no longer on its post.</p>;
  if (view.poll.act.id !== origin) return <p className="kb-notice kb-small">That poll was replaced on its post.</p>;
  const options = Array.isArray(view.poll.act.payload.options) ? (view.poll.act.payload.options as readonly unknown[]).map(String) : [];
  const picks = Array.isArray(act.payload.picks) ? (act.payload.picks as readonly number[]) : [];
  return (
    <>
      {act.kind === 'poll'
        ? <p className="kb-small kb-muted"><b>{name}</b> · <time dateTime={act.createdAt}>{when(act.createdAt)}</time></p>
        : <p className="kb-small kb-origin-ballot" data-kb-over-ink>{ballotLine(name, picks.map((p) => options[p] ?? ''), null, act.createdAt)}</p>}
      <Poll post={post} polls={polls} board={null} />
    </>
  );
}

export function Origin({ summary }: { readonly summary: ThreadSummary }) {
  const { perPage, tallies, mine, origin: held, originPlays, originPolls, catchUp } = useThread();
  const { api, instance, ui } = useKayfa();
  const originId = summary.originActId!;
  const from = held ?? NOT_THERE;
  /* The box's store is the thread screen's, which gives it the saved states and releases the page carried; a box drawn without one keeps a store of its own. */
  const own = useMemo(() => createPlays(), []);
  const plays = originPlays ?? own;
  const ownPolls = useMemo(() => createPolls(), []);
  const polls = originPolls ?? ownPolls;
  const { act } = useOrigin(from, originId, summary.originThread!, plays, tallies, originPlays !== undefined && originPolls !== undefined, polls, catchUp);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (takeOrigin(summary.id)) box.current?.focus(); }, [summary.id]);
  const played = usePlays(plays, originId).plays;
  /* The live ORIGIN box rewinds as the post does in its thread (its words and plays are chosen in `PostEffects`); a moment box (a card play's, a spin's) is read once and never does. */
  const rewound = useRewound(plays, originId);
  const looseReactions = useLooseReactions({ plays, actId: originId, eligible: act !== null && (act.kind === 'post' || act.kind === 'spin'), cards: ui.cards });
  /*
   * A spin from a card play itself shows the play as the box's one mark, kept under the post it landed on (the Act is not a
   * post of this thread, and its post is in another).
   */
  const cardPlay = useMemo(() => (act?.kind === 'card' ? playOf(act) : null), [act]);
  const target = from.at;
  const { nameOf, faceOf, characterOf } = useCast(from.cast, [act?.character ?? null, ...played.map((p) => p.caster), ...(cardPlay ? [cardPlay.caster, ...(cardPlay.reach === 'character' && cardPlay.on ? [cardPlay.on] : [])] : [])]);
  const history = useHistory(originId);
  /* A thread spun from a poll or a public ballot draws the poll of the post it is on, as it stands now: the page carried it (`from.polls`), and the box's store keeps it current. */
  const pollPost = from.polls[0]?.post ?? (act?.kind === 'poll' ? act.targetActId : null);
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
  /* The moment the page carried is kept under the key the frame reads it by, before the frame is drawn: a spin's own where the box shows the pressed post, else the play's. A spin pressed on a post whose row names no first Act is read by the frame under the play's key, so the moment the page carried is kept there. */
  const lens = useLensStore();
  useMemo(() => {
    if (cardPlay && (onCharacter || !cardPlay.reach)) lens.seedMoment(onCharacter ? spinAt ?? cardPlay.id : cardPlay.id, from.moment);
  }, [lens, cardPlay, onCharacter, spinAt, from.moment]);
  /* The key the box's moment is kept and run under, and whether the box draws one now (read, and not null): Reset is drawn only then. */
  const momentKey = cardPlay && (onCharacter || !cardPlay.reach) ? (onCharacter ? spinAt ?? cardPlay.id : cardPlay.id) : null;
  /* The box's foot, where what the moment says under its post stands (outside the content area, so no effect that fills the area passes under it); drawn only where the box shows a moment. */
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const kept = useSyncExternalStore(lens.subscribe, () => (momentKey === null ? undefined : lens.kept(momentKey)), () => undefined);
  const reset = momentKey !== null && kept !== undefined && kept !== null ? (
    <button type="button" className="kb-origin-reset" onClick={(e) => { e.currentTarget.focus(); lens.reset(momentKey); }}>Reset</button>
  ) : null;
  /*
   * What the moment's effects say reaches the strip of the post they are drawn on, under the moment's post: a mark's Lens reads the moment's views as a post's reads its live effects'. Only
   * an effect on the post's own reach says a view (`MomentEffect`), so a card played on a character, drawn around the post as the spun play, says none to the character's strip or to any other.
   */
  const postKey = kept === undefined || kept === null ? null : kept.version.id;
  const onView = useCallback((card: string, view: CardView | null) => { if (postKey !== null) plays.setView(postKey, card, view); }, [plays, postKey]);
  /*
   * A mark for each card the moment draws on the post (the Acts of its drawn plays join the box's store, kept by id so a box drawn again adds none twice): the Lens lists each of those plays as it
   * stood then (`then`). A moment not read, or null, adds nothing. The spun play's own row is the box's one strip's (keyed by its post); a card on a character is drawn around the post of another thread,
   * so its strip is the character's, and the post's drawn plays are a second strip of their own beside it, keyed by the moment's post, every row of it a `then` row.
   */
  const shown = useMemo(() => {
    if (cardPlay === null || kept === undefined || kept === null) return null;
    const parts = momentParts(kept, instance.cards, ui.cards, () => '').drawn;
    const drawn = new Set(parts.map((p) => p.id));
    const acts = kept.layers.map((l) => l.act).filter((a) => drawn.has(a.id));
    /* How many of them the strip will mark (the strip's own filter), so no empty strip is drawn. */
    const marked = markedPlays(shownPlays(parts, api.now()), api.now(), keepingKeys(instance.cards)).length;
    return { acts, marked, post: kept.version.id, then: new Set(acts.map((a) => a.id).filter((id) => id !== cardPlay.id)) as ReadonlySet<Id> };
  }, [api, cardPlay, kept, instance.cards, ui.cards]);
  useEffect(() => { if (shown) plays.add(shown.acts); }, [plays, shown]);
  const link = <OriginLink place={summary.origin} here={summary.board} perPage={perPage} {...(onCharacter ? { faces: characterOf } : {})} />;

  /* A card on a character: the post's own drawn cards have a strip beside the character's, every row of it a `then` row (state, controls, Go to post). */
  const to = cardPlay ? (pressed?.href ?? castFrom?.href ?? (target ? threadHref(target.thread, pageOf(target.seq, perPage), target.seq) : null)) : backHref;
  const postMarks = onCharacter && shown && shown.marked > 0 ? (
    <PostMarks
      post={shown.post} compare={false} moments={false} then={shown.then} plays={plays} to={to} nameOf={nameOf} faceOf={faceOf} tallies={tallies} mine={mine}
      onSpin={(play, name, opener) => setSpinOrigin({ id: play.id, label: name, opener })}
    />
  ) : null;

  /* The same node is the box's head's strip and, for a card that lifts the post (Stick Around), the strip it draws on the lifted post. */
  const marks = act && (act.kind === 'card' ? cardPlay !== null : holdsEffects(act.kind)) ? (
    <PostMarks
      post={cardPlay ? (onCharacter ? homeOf(cardPlay) : cardPlay.post) : originId} {...(onCharacter ? { where: 'character' } : {})} compare={cardPlay === null} moments={cardPlay === null} {...(shown && !onCharacter ? { then: shown.then } : {})} plays={plays}
      to={to}
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
          return <CharacterMoment play={cardPlay} spin={spinAt} nameOf={nameOf} onView={onView} listInto={foot} />;
        }
        return cardPlay.reach ? null : (
          <MomentView play={cardPlay} place="origin" nameOf={nameOf} now={null} onView={onView} listInto={foot}
            bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} forged={forgedList(version.currentPayload)} />} />
        );
      case 'poll':
      case 'ballot': return <PollOrigin act={act} post={pollPost} polls={polls} name={name} />;
      case 'draw':
      case 'wash': return null;
      case 'unmask': return <UnmaskLine act={act} name={name} />;
      case 'announce': return <AnnounceLine act={act} name={name} />;
      case 'tally':
      case 'reveal': return <SystemPost act={act} />;
      /* A report, a verdict, an appeal or a ruling: the exchange, with its own two bylines (the box draws none over the area). */
      case 'report':
      case 'report_verdict':
      case 'appeal':
      case 'appeal_ruling': return <Exchange origin={act} place={summary.origin?.kind === 'answer' ? summary.origin : null} perPage={perPage} nameOf={nameOf} />;
      default:
        return (
          <>
            {/* A card that draws the reactions is given the origin post's row logic here too; the box has no row of its own to draw tiles in, so the scope draws nothing but the card's picker. */}
            <ReactionRowScope on={act.kind === 'post' || act.kind === 'spin'} loose={looseReactions} act={act.id} author={act.character} authorName={name} tallies={tallies} mine={mine} plays={plays}>
              <PostEffects plays={plays} post={act} place="origin" marks={marks} nameOf={nameOf} bodyOf={(version) => <BbCode text={text(version.currentPayload.body)} quoteHead={quoteHead} forged={forgedList(version.currentPayload)} />}><BbCode text={text(act.currentPayload.body)} quoteHead={quoteHead} forged={forgedList(act.currentPayload)} /></PostEffects>
            </ReactionRowScope>
            <LastEdited act={rewound?.rewind.version ?? act} />
            {act.kind === 'post' && <p className="kb-small" data-kb-over-ink>{history.button}</p>}
            {/* Lifted always and empty until History opens: a wrapper with nothing in it draws and covers nothing, and its ground (spin.css) is on what it holds. */}
            <div className="kb-origin-lift" data-kb-over-ink>{history.panel}</div>
          </>
        );
    }
  };

  /* What stands under the band: the area is drawn only where there is something to put in it (a draw, a wash and a play on a thread or a board leave the box the head alone). */
  const content = body();
  /*
   * The byline over the area, where the box shows a post: an update's and a post's author and date, and for a card on a character the character (one link to its profile) and the date of the
   * version the moment shows, once read. A card play on a post draws none: its moment is the post as the play found it, and the head already names the play.
   */
  const byline = (() => {
    if (!act || content === null) return null;
    if (act.kind === 'card') {
      if (!onCharacter || !cardPlay?.on) return null;
      const version = kept ? kept.version : null;
      return <Byline who={<CharacterLink id={cardPlay.on} character={characterOf(cardPlay.on)} name={nameOf(cardPlay.on)} />} at={version ? version.editedAt ?? version.createdAt : null} />;
    }
    if (act.kind === 'update' || isPostLike(act.kind)) return <Byline who={<b>{nameOf(act.character)}</b>} at={act.createdAt} />;
    return null;
  })();
  /* The area keeps a post's room where it shows a post's words, live or as a moment, so an effect on a short post has room to play (spin.css). */
  const roomy = act !== null && content !== null && (act.kind === 'card' || isPostLike(act.kind));
  return (
    <>
      <div ref={box} className="kb-origin" role="group" aria-label="Origin" tabIndex={-1} data-kb-over-ink>
        <p className="kb-origin-head">
          {/* A play's moment is the box's content, framed by the box: the head says it is the post as the play found it, where a ring and a tag would say it again. */}
          <span className="kb-origin-head-text">
            <b>ORIGIN</b> · Spun from {link}{cardPlay && !cardPlay.reach && <> · as it landed{reset && <> · </>}{reset}</>}{onCharacter && <> · {spinAt !== null ? 'as it was spun' : 'as it landed'}{reset && <> · </>}{reset}</>}
            {spinAt !== null && castFrom && <span className="kb-origin-head-line">Cast from <Link to={castFrom.href}>{castFrom.words}</Link></span>}
          </span>
          {/* The strip hangs on the box's head, as it does on a post's date row. A card play's is compared with nothing: the post it landed on is in another thread. */}
          {marks}{postMarks}
        </p>
        {byline}
        {content !== null && (
          <div className="kb-origin-area" data-kb-content-area data-kb-room={roomy ? '' : undefined}>
            {content}
          </div>
        )}
        {/* The write job's late note, under the area and not in it: only where the box shows the post live (a moment is a past version). */}
        {content !== null && act !== null && momentKey === null && isPostLike(act.kind) && <WriteLateNote plays={plays} post={act} />}
        {momentKey !== null && <div ref={setFoot} className="kb-origin-foot" data-kb-over-ink />}
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
