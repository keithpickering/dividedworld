/**
 * What a card play shows on its post: the card's effect around the post's words, and the hooks a card's effect speaks to the
 * marks through.
 *
 * A play's presence in a thread is its card's mark (Marks.tsx, in the post's date row): a card play takes no number and is never
 * a line of its own, and the post it lands on keeps its number and everyone's reactions. A card the instance gives no `CardUi` is
 * shown as its mark alone. An effect says what its card's state is on this post with `show` (`CardView`), and the mark and the
 * Lens draw from it; the post's own body holds the effect and nothing a player presses.
 *
 * An effect (`CardUi.Effect`) wraps the post's words wherever they are drawn (the thread, and the ORIGIN box of a thread spun
 * from the post). The order they nest in is `nestOrder`'s, the one place it is stated, from the innermost out: the cards that
 * write (`CardRules.writes`, on the post's own reach) wrap the words first, so a tail they draw is the words' next sibling under
 * every other card, whatever the play order; then the cards with `CardUi.beneath` (the layer other cards' ink lies on); then
 * every other card, so the latest played is outermost; then the takeovers (Stick Around, which lifts the post out of its thread),
 * so every other card's effect is inside a takeover's `children`. Each group keeps play order, and a card that writes and takes
 * over is a takeover. The thread's and the board's plays wrap as their own layers do. The moment (`MomentEffects`) and a History
 * version (`VersionEffects`) nest by the same function. Only a takeover is given the post's `marks` (the strip the post's date
 * row draws, handed in by the post) and draws them on the post it lifts. A post with no plays, or whose plays' cards draw no
 * effect, is drawn untouched.
 */
import { createPortal } from 'react-dom';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, EffectState, Id, KayfaApi, PlayAbove, PlayMoment, SurfaceAct } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { usePlay, type Composing, type PlayControls } from './play.tsx';
import { useMeet } from './Callout.tsx';
import { useHoldScreen } from '../tips/Tips.tsx';
import { useLensStore } from './Lens.tsx';
import { useStaged } from '../staged.ts';
import { MomentView, useShownMoment } from './Moment.tsx';
import { backoff, REPEAT_TRIES, useTails } from './tails.ts';
import { driveStore, drivesOfPlays, giftOf, useDriveGifts, type Gifts, type PlayedDrive } from './drives.ts';
import { currentVersion, resolveWritten, versionAt, versionsOf } from './written.ts';
import { createPlays, inPlayOrder, keepingKeys, livePlays, nextEnd, PLAYS_PER_POST, playOf, playsFallingOn, readSurface, shownPlays, TIMER_MOST, useAt, usePlays, type Plays } from './plays.ts';
import { createClaims, NO_INK } from './claims.ts';
import { drawnInMoment, surfaceMost, type CardRules, type Reach } from '../../rules/cards.ts';
import type { Span } from '../../rules/types.ts';
import type { PostPlays } from './plays.ts';
import type { CardPlay, CardUi, CardView, Drive, EffectPlace, EffectProps, Written } from './types.ts';
import { glassInk } from './ink.ts';
import { useOwnerOf } from '../thread/context.ts';

const NOT_AUTHOR = 'only the post\'s author saves what is on it';
/** What a staged page's effect is answered with: it saves nothing and releases nothing, without asking anyone (staged.ts). */
export const SAMPLE = 'this is a sample post';

/**
 * Wraps a post's words in the effect of each card played on it, and in the effects of the live plays above it (the card mechanic's
 * design, section 7): the layers in the order the board's, the thread's, the author's, then the post's own, as a card's rules see them
 * (effectsOnTarget), nested as `nestOrder` says (a card that writes innermost, every takeover outermost). A play beyond a post stops
 * wrapping at its end, by itself.
 */
export function PostEffects({ plays, post, board = null, place, marks = null, nameOf, bodyOf, children }: {
  readonly plays: Plays; readonly post: Act; readonly place: EffectPlace;
  /**
   * How the screen draws a version of the post's words (as it draws `children` from the post now): a play's moment (As it landed,
   * Moment.tsx) draws the version it names with it, in place of `children` and every effect but a takeover. None draws no moment.
   */
  readonly bodyOf?: (version: Act) => ReactNode;
  /** The board the post's thread is on, whose live board card wraps it; none where the screen does not know it. */
  readonly board?: Id | null;
  /** The post's marks, as the post's date row draws them: given to a takeover's effect alone. */
  readonly marks?: ReactNode;
  /** A character's name as the screen knows it, for an effect that names a caster. */
  readonly nameOf: (character: Id | null) => string; readonly children: ReactNode;
}) {
  const { api, ui, instance } = useKayfa();
  const { actingCharacters, writingCharacters, hudCharacter, wallet, refresh } = usePlayer();
  const play = usePlay();
  const here = usePlays(plays, post.id);
  /*
   * The tails of the plays here that write, read for the page together (tails.ts): a post with none of them is never read. The version drawn
   * is the post's current one, the newest any play has a row for, and a failed regeneration keeps the tail the play had (`resolveWritten`).
   */
  const writing = useMemo(() => writingKeys(instance.cards), [instance.cards]);
  const tailRows = useTails(post, here.plays.filter((p) => writes(p, writing) && !p.caught && !p.reversed && !p.untaken).map((p) => p.id));
  /*
   * A play whose first generation failed for good is over, which the page holds only from the plays' read (`untaken`). A page showing it learns
   * it from its tails: every row of a play the page counts failed, none waiting, none a text (a failure a newer job waits behind shows that job
   * waiting, and a failed regeneration after a text has the text). Then that one post's plays are read again (`cardsOnMany` for the one post, once
   * for each play), so the mark's count, the Lens and the effect catch up without a reload. A read that fails is tried again after the wait the
   * tails' own timer keeps (`backoff`), at most `REPEAT_TRIES` times, and then waits for the next change of the post's tails, so a server that
   * keeps failing is asked a handful of times and never in a loop.
   */
  const reread = useRef<Set<Id>>(new Set());
  const tries = useRef(0);
  const [again, setAgain] = useState(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (retry.current !== null) clearTimeout(retry.current); }, []);
  useEffect(() => {
    const over = here.plays.filter((p) => writes(p, writing) && !p.caught && !p.reversed && !p.untaken && !reread.current.has(p.id)
      && (() => { const own = tailRows.filter((r) => r.play === p.id); return own.length > 0 && own.every((r) => r.failed && r.text === null && !r.waiting); })());
    if (over.length === 0) return;
    for (const p of over) reread.current.add(p.id);
    void api.cardsOnMany([post.id], PLAYS_PER_POST).then((acts) => { tries.current = 0; plays.add(acts); }, () => {
      for (const p of over) reread.current.delete(p.id);
      const attempt = tries.current++;
      if (attempt + 1 >= REPEAT_TRIES) { tries.current = 0; return; }
      if (retry.current !== null) clearTimeout(retry.current);
      retry.current = setTimeout(() => { retry.current = null; setAgain((n) => n + 1); }, backoff(attempt));
    });
  }, [api, plays, post.id, here.plays, tailRows, writing, again]);
  /*
   * The drives of the cards here that have one, read for the page together (drives.ts): a post with none is never read. A drive is the plays of
   * one card that name it (their payload's `drive`), and it closes `lasts` after its latest play.
   */
  const driving = useMemo(() => new Map(instance.cards.flatMap((c): [string, NonNullable<CardRules['drive']>][] => (c.drive ? [[c.key, c.drive]] : []))), [instance.cards]);
  /* The page's own clock is the drives' own closes (useAt), so a play's end is judged first at the time of this render, then at the redrawn time. */
  const soon = drivesOfPlays(here.plays, driving, api.now());
  const gifts = useDriveGifts(post.thread, soon.map((d) => d.id));
  const at = useAt(soon.map((d) => d.closes));
  const played = drivesOfPlays(here.plays, driving, at);
  const drawn = currentVersion(tailRows);
  const written = useMemo(() => resolveWritten(tailRows, versionsOf(tailRows), drawn, 'current'), [tailRows, drawn]);
  const lens = useLensStore();
  const moment = useShownMoment(lens);
  const onBoard = usePlays(plays, board ?? '');
  const onThread = usePlays(plays, post.thread);
  const onAuthor = usePlays(plays, post.character ?? '');
  /*
   * The character of the reader's that wrote the post, if any: the only one a state is saved as. Retired or not, since the
   * post's player answers for what is on it (#85); casting and releasing stay with the masks that can act. A post under an author veil is drawn
   * under the stand-in, and its author's player alone is told it is theirs (`ownerOf`).
   */
  const owner = useOwnerOf();
  const author = writingCharacters.find((c) => c.id === owner(post)) ?? null;
  const staged = useStaged();
  /* The post's ink registry, one for all its effects (claims.ts). */
  const claims = useMemo(createClaims, []);
  /*
   * A surface play's face for its effect (`EffectProps.surface`): its cells and live Acts as the store holds them, and the three things an effect
   * does with it. Each play's `near`, and the object handed to its effect, are the same until what they say changes, so an effect may list them in its dependencies.
   */
  const nears = useRef(new Map<Id, () => void>());
  const faces = useRef(new Map<Id, { readonly key: string; readonly face: NonNullable<EffectProps['surface']> }>());
  const nearOf = (play: Id): (() => void) => {
    let near = nears.current.get(play);
    if (!near) { near = () => { if (plays.wantSurface(play)) void readSurface(api, plays, play); }; nears.current.set(play, near); }
    return near;
  };
  const draw = useCallback<NonNullable<EffectProps['surface']>['draw']>(async (play, as, input) => {
    if (staged) return { ok: false, error: SAMPLE };
    const drawn = await api.draw(play, as, input);
    if (drawn.ok) afterSurface(plays, api, play, drawn.value.covered, drawn.value.live);
    return drawn;
  }, [api, plays, staged]);
  const wash = useCallback<NonNullable<EffectProps['surface']>['wash']>(async (play, input) => {
    if (staged) return { ok: false, error: SAMPLE };
    if (!author) return { ok: false, error: NOT_AUTHOR };
    const washed = await api.wash(play, author.id, input);
    if (washed.ok) afterSurface(plays, api, play, washed.value.covered, washed.value.live);
    return washed;
  }, [api, author, plays, staged]);
  const surfaceOf = (key: string, mine: readonly CardPlay[], of: PostPlays): EffectProps['surface'] => {
    const rules = instance.cards.find((c) => c.key === key);
    /* A surface card has a stack of 1 (engine/rules/instance.ts refuses otherwise), so one play per post: the first is the only. */
    const play = mine[0];
    if (!rules?.surface || !play) return undefined;
    const held = of.surfaces[play.id];
    const acts: readonly SurfaceAct[] | null = held?.acts ?? null;
    const covered = held?.covered ?? 0;
    const most = surfaceMost(key, rules.surface.limitKey, instance.settings);
    const stamp = `${covered}|${most}|${acts === null ? 'unread' : `read:${acts.map((a) => `${a.id}:${a.share ?? ''}`).join(',')}`}`;
    const was = faces.current.get(play.id);
    if (was && was.key === stamp && was.face.draw === draw && was.face.wash === wash) return was.face;
    const face = { covered, most, acts, near: nearOf(play.id), draw, wash };
    faces.current.set(play.id, { key: stamp, face });
    return face;
  };
  const save = useCallback<EffectProps['save']>(async (play, state) => {
    if (staged) return { ok: false, error: SAMPLE };
    if (!author) return { ok: false, error: NOT_AUTHOR };
    const saved = await api.saveEffect(play, author.id, state);
    if (saved.ok) plays.setStates({ [play]: { state, savedAt: saved.value.savedAt } });
    return saved;
  }, [api, author, plays, staged]);
  const release = useCallback<EffectProps['release']>(async (play) => {
    if (staged) return { ok: false, error: SAMPLE };
    const released = await api.releaseEffect(play);
    if (released.ok) plays.setReleased([play]);
    return released;
  }, [api, plays, staged]);
  const give = useCallback<EffectProps['give']>(async (drive, amount) => {
    if (staged) return { ok: false, error: SAMPLE };
    if (!hudCharacter) return { ok: false, error: 'choose a character to give as' };
    const given = await api.donate(hudCharacter.id, drive, amount);
    if (given.ok) {
      /* The answer shows the gift at once; the same gift heard on the channel is the same gift (drives.ts keeps each by its id). */
      const gift = giftOf(given.value.act);
      if (gift) driveStore(api).add(gift.drive, gift.gift);
      void refresh();
    }
    return given;
  }, [api, hudCharacter, refresh, staged]);
  const moreGifts = useCallback<EffectProps['moreGifts']>((drive) => driveStore(api).more(drive), [api]);
  /* The layers above the post, each its own reach's plays still live, redrawn at the soonest end (useUntil). */
  const above = [
    { reach: 'board' as const, drawn: board === null ? [] : onBoard.plays, of: onBoard },
    { reach: 'thread' as const, drawn: onThread.plays, of: onThread },
    { reach: 'character' as const, drawn: post.character === null ? [] : onAuthor.plays, of: onAuthor },
  ].map((l) => ({ ...l, drawn: l.drawn.filter((p) => p.reach === l.reach) }));
  const now = useUntil(above.flatMap((l) => l.drawn));

  /*
   * A play a trap caught does nothing, and a card back draws no effect: neither wraps the post (the card mechanic's design, section 4). The thread's plays are
   * those that fall on this post (`playsFallingOn`): up now, or of a card that keeps and written while the post was up, so a week-long play still lights a post written inside it.
   */
  const keeping = useMemo(() => keepingKeys(instance.cards), [instance.cards]);
  const layers = [
    ...above.map((l) => ({ reach: l.reach as Reach, acting: l.reach === 'thread' ? playsFallingOn(l.drawn, post, keeping, now) : livePlays(l.drawn, now), of: l.of })),
    { reach: 'post' as Reach, acting: here.plays.filter((p) => !p.caught && !p.reversed && !p.untaken && !p.faceDown && !p.reach), of: here },
  ];
  /*
   * A play's moment shown here (As it landed): it replaces the post's words and every effect inside the takeovers, which keep wrapping
   * it, so a held post stays held. Nothing the reader does reaches the live effects while it shows: they are not drawn.
   */
  const momentAct = moment !== null && bodyOf ? here.plays.find((p) => p.id === moment) : undefined;
  /* A play being made on this post itself (`CardUi.Compose`) is the innermost thing here: the post's words are its children. */
  const composing = play?.compose && play.compose.target.post?.id === post.id ? play.compose : null;
  const Compose = composing ? ui.cards.find((c) => c.key === composing.card)?.Compose : undefined;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  if (composing && Compose && bodyRef.current === null && typeof document !== 'undefined') bodyRef.current = document.createElement('div');
  if (!composing) bodyRef.current = null;
  const bodyEl = bodyRef.current;
  /* The slot is the outermost thing here, so a play landing on the post mid-compose (a layer wrapping the words) never moves it in the tree: it would remount, and the card's drawing with it. */
  const slot = (inner: ReactNode) => (composing && play && Compose && bodyEl ? <ComposeSlot composing={composing} Compose={Compose} post={post} play={play} body={bodyEl}>{inner}</ComposeSlot> : inner);
  /* The post's words sit in `bodyEl`, a div the slot owns (so it is one element however the layers wrap it), innermost inside every layer but a card that writes's. */
  const plain = (inner: ReactNode) => (composing && Compose && bodyEl ? <WordsIn el={bodyEl}>{inner}</WordsIn> : inner);
  if (layers.every((l) => l.acting.length === 0) && !momentAct) return <>{slot(plain(children))}</>;
  /* Each layer's cards in the order each was first played there; `nestOrder` says the order they nest in. */
  const firsts = layers.flatMap((l) => [...new Set(l.acting.map((p) => p.card))].map((key): Wrap => ({ reach: l.reach, key, mine: l.acting.filter((p) => p.card === key), of: l.of })));
  /* A card drawn by another gives its plays to that card's wrap before the wraps are ordered, so the post draws one effect of the named card (`handedOn`). */
  const wraps = handedOn(firsts, here, ui.cards);
  const { writing: within, rest, takeovers } = nestOrder(wraps, ui.cards, writing);
  const wrapIn = (node: ReactNode, list: readonly Wrap[], from: number): ReactNode => {
    let wrapped = node;
    for (const [i, { key, reach, mine, of }] of list.entries()) {
      const card = ui.cards.find((c) => c.key === key);
      if (!card?.Effect) continue;
      const Effect = card.Effect;
      wrapped = (
        <BoundEffect
          key={`${reach}:${key}`} Effect={Effect} store={plays} reach={reach} cardKey={key}
          post={post} plays={mine} states={of.states} released={of.released} place={place} marks={card.takeover ? marks : null}
          written={writtenOf(written, mine, writing)} {...(drawn !== null && reach === 'post' ? { version: drawn } : {})}
          save={reach === 'post' ? save : beyondSave} release={release} nameOf={nameOf}
          give={give} moreGifts={moreGifts} wallet={wallet}
          {...(reach === 'post' && driving.has(key) ? { drives: drivesOf(played, key, gifts, at) } : {})}
          reader={{ author: author !== null, caster: mine.some((p) => actingCharacters.some((c) => c.id === p.caster)) }}
          ink={claims.at(`${reach}:${key}`, from + i)} {...(reach === 'post' ? { surface: surfaceOf(key, mine, of) } : {})}
        >
          {wrapped}
        </BoundEffect>
      );
    }
    return wrapped;
  };
  /* A shown moment replaces the words and every effect inside the takeovers (`MomentView` is given the words as they are drawn without it). */
  if (momentAct && bodyOf) {
    const shown = (
      <MomentView
        play={momentAct} place={place} nameOf={nameOf} bodyOf={bodyOf} now={plain(children)}
        back={() => lens.showMoment(null)}
      />
    );
    return <>{slot(wrapIn(shown, takeovers, 0))}</>;
  }
  /* The effects of the cards that write wrap the words first, so a tail is their next sibling under every other card; a compose's body holds both. */
  const wrapped = wrapIn(wrapIn(plain(wrapIn(children, within, 0)), rest, within.length), takeovers, within.length + rest.length);
  return <>{slot(wrapped)}</>;
}

/** One card's effect on a post, as `PostEffects` draws it: the layer it is drawn for, the card, and the plays it is given (its own, then any another card lends it). */
interface Wrap { readonly reach: Reach; readonly key: string; readonly mine: readonly CardPlay[]; readonly of: PostPlays }

/** A store entry with the saved states and releases of the lent plays added to it: the stores are keyed by play, so what each lender holds for its own plays is a union, never a clash. */
function joined(own: PostPlays, lender: PostPlays, lent: readonly CardPlay[]): PostPlays {
  const ids = new Set(lent.map((p) => p.id));
  const states = Object.entries(lender.states).filter(([id]) => ids.has(id));
  const released = [...lender.released].filter((id) => ids.has(id));
  if (states.length === 0 && released.length === 0) return own;
  return { ...own, states: { ...own.states, ...Object.fromEntries(states) }, released: new Set([...own.released, ...released]) };
}

/**
 * Takes each wrap of a card drawn by another (`CardUi.drawnBy`) out and appends its plays to the post layer's wrap of the card it names, after that card's own plays, each
 * play still carrying its own `reach`. Where the post has no wrap of the named card, one is made with no plays of its own in the post layer's first place (where the first
 * post-layer wrap stands, else last), so the post draws one effect of the card whatever lends it. The merged wrap is a post-layer wrap: `of` is the post's own store entry.
 */
export function handedOn(wraps: readonly Wrap[], post: PostPlays, cards: readonly CardUi[]): readonly Wrap[] {
  const lender = (key: string) => cards.find((c) => c.key === key)?.drawnBy;
  if (!wraps.some((w) => lender(w.key) !== undefined)) return wraps;
  const out = wraps.filter((w) => lender(w.key) === undefined);
  for (const w of wraps) {
    const named = lender(w.key);
    if (named === undefined) continue;
    const at = out.findIndex((o) => o.reach === 'post' && o.key === named);
    if (at >= 0) out[at] = { ...out[at]!, mine: [...out[at]!.mine, ...w.mine], of: joined(out[at]!.of, w.of, w.mine) };
    else {
      const first = out.findIndex((o) => o.reach === 'post');
      out.splice(first < 0 ? out.length : first, 0, { reach: 'post', key: named, mine: w.mine, of: joined(post, w.of, w.mine) });
    }
  }
  return out;
}

/**
 * Where a card's `Compose` is mounted: the post's words inside it, in a box this measures (client px) and tells it. When the slot goes (the post
 * leaves the screen) the compose ends with it. It is the card's to draw; this keeps only the box, the way out and the answer.
 */
function ComposeSlot({ composing, Compose, post, play, body, children }: {
  readonly composing: Composing; readonly Compose: NonNullable<CardUi['Compose']>; readonly post: Act; readonly play: PlayControls; readonly body: HTMLDivElement; readonly children: ReactNode;
}) {
  const [box, setBox] = useState<{ readonly w: number; readonly h: number } | null>(null);
  useLayoutEffect(() => {
    const el = body;
    const measure = () => { const r = el.getBoundingClientRect(); setBox((was) => (was && was.w === r.width && was.h === r.height ? was : { w: r.width, h: r.height })); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [body]);
  /* Gone with its post, but not on a development remount that puts it straight back. */
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; setTimeout(() => { if (!alive.current) play.dropCompose(composing); }, 0); };
  }, [play, composing]);
  return (
    <div className="kb-compose-slot">
      <Compose post={post} box={box} under={body} submit={play.submitCompose} cancel={play.cancelCompose} hold={play.holdCompose} ready={play.composeReady}>{children}</Compose>
      {/* Esc and Cancel do nothing while the play is out; this is where a sighted player sees why (the status says it aloud). */}
      {play.sending && <p className="kb-notice">Your play is on its way.</p>}
    </div>
  );
}

/** The post's words inside the compose's own body element, wherever in the tree the layers put it: the element is the slot's, so it never changes. */
function WordsIn({ el, children }: { readonly el: HTMLDivElement; readonly children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const h = host.current; if (h && el.parentNode !== h) h.appendChild(el); });
  return <><div ref={host} className="kb-compose-body" />{createPortal(children, el)}</>;
}

/** What the store takes from a draw or a wash that landed: the cells now covered and the live ids, and the live Acts read again where they are wanted. */
function afterSurface(plays: Plays, api: KayfaApi, play: Id, covered: number, live: readonly Id[]): void {
  plays.setSurfaces({ [play]: { covered, live } });
  if (plays.wantsSurface(play)) void readSurface(api, plays, play);
}

/**
 * The order cards nest around a post's words, the one place it is stated (PostEffects, MomentEffects and VersionEffects all take it). Given the
 * cards to wrap in play order (one entry for each card of a layer, `reach` naming the layer where it is not the post's own), it returns the
 * cards that write on the post's own reach as `writing`, which wrap the words first so their tail is the words' next sibling under every other
 * card, then `rest` outward from them (the `beneath` cards, then the others), then `takeovers` outermost, each group in the order given. A
 * takeover is a takeover whatever else it is, so `rest` never holds one. It reads the cards' rules and UI alone, never who played a card or
 * who owns a character.
 */
export function nestOrder<T extends { readonly key: string; readonly reach?: Reach }>(
  cards: readonly T[], ui: readonly CardUi[], writing: ReadonlySet<string>,
): { readonly writing: readonly T[]; readonly rest: readonly T[]; readonly takeovers: readonly T[] } {
  const take = (key: string) => ui.find((c) => c.key === key)?.takeover === true;
  const under = (key: string) => ui.find((c) => c.key === key)?.beneath === true;
  const inside = (c: T) => !take(c.key) && writing.has(c.key) && (c.reach === undefined || c.reach === 'post');
  const others = cards.filter((c) => !inside(c));
  return {
    writing: cards.filter(inside),
    rest: [...others.filter((c) => !take(c.key) && under(c.key)), ...others.filter((c) => !take(c.key) && !under(c.key))],
    takeovers: others.filter((c) => take(c.key)),
  };
}

/** The keys of the cards that write (`CardRules.writes`): only their plays have tails to read. */
const writingKeys = (cards: readonly CardRules[]): ReadonlySet<string> => new Set(cards.filter((c) => c.writes !== undefined).map((c) => c.key));
/** Whether a play is of a card that writes, on its post's own reach (a card that writes reaches a post alone). */
const writes = (play: CardPlay, keys: ReadonlySet<string>): boolean => keys.has(play.card) && !play.reach && !play.faceDown;
/** Each drive of a card (drivesOfPlays says which plays make one), in the order each was first played, with what the page knows of its gifts. */
function drivesOf(played: readonly PlayedDrive[], card: string, gifts: ReadonlyMap<Id, Gifts>, now: number): readonly Drive[] {
  return played.filter((d) => d.card === card).map((d): Drive => {
    const g = gifts.get(d.id);
    return { id: d.id, plays: d.plays, closes: new Date(d.closes).toISOString(), open: d.closes > now, total: g?.total ?? 0, count: g?.count ?? 0, gifts: g?.gifts ?? [], more: (g?.gifts.length ?? 0) < (g?.count ?? 0) };
  });
}

const NOTHING_WRITTEN: ReadonlyMap<Id, Written> = new Map();
/** What an effect is given of the tails: those of its own plays that write, and none for a card that does not. */
function writtenOf(all: ReadonlyMap<Id, Written>, mine: readonly CardPlay[], keys: ReadonlySet<string>): ReadonlyMap<Id, Written> {
  if (all.size === 0 || !mine.some((p) => writes(p, keys))) return NOTHING_WRITTEN;
  return new Map(mine.flatMap((p): [Id, Written][] => { const w = all.get(p.id); return w ? [[p.id, w]] : []; }));
}

/** A play beyond a post has no post author to save its state (save_effect_state, 0055): refused without asking. */
const beyondSave: EffectProps['save'] = async () => ({ ok: false, error: 'a card beyond a post keeps no state on the post' });

/**
 * The time, redrawn when the soonest of these plays' ends passes, so a play beyond a post stops drawing at its end without a reread
 * (its way out). Nothing is scheduled while none ends ahead.
 */
export function useUntil(plays: readonly CardPlay[]): number {
  const { api } = useKayfa();
  const [now, setNow] = useState(() => api.now());
  const next = nextEnd(plays, now);
  useEffect(() => {
    if (next === null) return;
    /* A timer's delay is held under 2^31 ms; a later end is waited for in steps, each re-arming at the time it wakes to. */
    const timer = setTimeout(() => setNow(api.now()), Math.min(TIMER_MOST, Math.max(0, next - api.now()) + 1));
    return () => clearTimeout(timer);
  }, [api, next, now]);
  return now;
}

/**
 * One card's effect on one post, given a `show` bound to that post and card, and clearing the card's view when the effect
 * is gone (unmounted: the plays that drew it left, or the post did), so a mark never keeps saying what a dead effect last
 * said. `show` is stable for the pair, so an effect may list it in its dependencies. A view is keyed by post and card,
 * not by where the post is drawn: a post is drawn once on a page, in its thread or in the ORIGIN box of a thread spun
 * from it, never both, so the two places never share a key at once.
 */
function BoundEffect({ Effect, store, marks, cardKey: card, ...props }: Omit<EffectProps, 'show' | 'met' | 'holdScreen' | 'still'> & { readonly Effect: ComponentType<EffectProps>; readonly store: Plays; /** The card whose effect this is: not always its first play's card, where plays are lent to it (`handedOn`). */ readonly cardKey: string }) {
  const post = props.post.id;
  /* A view is a post's: an effect above the post, drawn on many posts at once, says none (its mark is its target's). */
  const own = props.reach === 'post';
  const show = useCallback((view: CardView | null) => { if (own) store.setView(post, card, view); }, [store, post, card, own]);
  useEffect(() => () => { if (own) store.setView(post, card, null); }, [store, post, card, own]);
  const met = useMeet(card);
  const holdScreen = useHoldScreen();
  /* An effect may load on first use: until it lands the post shows its words (`children`), so a post never pops in without them. */
  return <Suspense fallback={props.children}><Effect {...props} still={false} show={show} met={met} holdScreen={holdScreen} marks={marks} /></Suspense>;
}

/* ------------------------------------------------------------------------------ a play's moment ---- */

/** What a moment draws and what it names (docs/plans/2026-11-03-effect-history-design.md, section 3). */
export interface MomentParts {
  /** The plays on the post then whose cards are drawn in a moment (`drawnInMoment`) and have an effect, in play order. */
  readonly drawn: readonly CardPlay[];
  /** What each drawn play had saved then, by play; a play that had saved none is absent and is drawn as it landed. */
  readonly states: Readonly<Record<Id, EffectState>>;
  /**
   * Everything else on the post then, and every play above it, in words: "Holdy", "a card set face down", "Smear, caught by Trappy",
   * "Sparkly on Spritey". Never the play whose moment it is: its mark, its Lens row and an ORIGIN box's head already name it (the owner,
   * 2026-11-07: "Also on the post then" naming the spun play itself was redundant).
   */
  readonly named: readonly string[];
  /** What became of the play itself as it landed, where it was not simply played: "Caught by Trappy". Null for a play that landed. */
  readonly own: string | null;
  /**
   * The moment's own play where its reach is a character (a spin's moment: the play the spin was made from, which is no layer on the post): its
   * card's effect is drawn around the post, still, and it is named nowhere. Null for a play on a post.
   */
  readonly above: CardPlay | null;
}

/**
 * Splits a moment into what is drawn and what is named. Liveness is judged at the play's own time, never now: a Use that had ended
 * by then is left out, a play an admin had ended by then is named "ended by an admin" (its card_end is among the layers, before the moment), a caught play is named "caught by" its trap's card (the spring that caught it made that card public), and a
 * card back is named as a back, always, even once it sprang: which card it is is never read. A play above the post is named with
 * what it was on, and never drawn, since its moment isn't one post's; the moment's own play, where it is on a character, is the one
 * exception (`above`), judged at the moment's time as every other is: live then, and its card's effect drawn. A card that cannot change after it lands, or that draws no
 * effect, is named.
 */
export function momentParts(moment: PlayMoment, rules: readonly CardRules[], ui: readonly CardUi[], nameOf: (character: Id | null) => string): MomentParts {
  /* The moment's own time: a play's is its own date, a spin's is the spin's, and every play is judged live or over at it. */
  const stated = Date.parse(moment.at);
  const at = Number.isNaN(stated) ? Date.parse(moment.layers[0]!.act.createdAt) : stated;
  const cardName = (key: string) => rules.find((c) => c.key === key)?.name ?? key;
  const springs = moment.layers.map((l) => l.act).filter((a) => a.kind === 'spring');
  /* A play an admin had ended by then: its card_end rides among the layers, and counts only when it came before the moment. */
  const endedBy = new Map(moment.layers.map((l) => l.act).filter((a) => a.kind === 'card_end' && a.targetActId !== null && Date.parse(a.createdAt) <= at).map((a) => [a.targetActId!, a.id] as const));
  const drawn: CardPlay[] = [];
  const states: Record<Id, EffectState> = {};
  const named: { readonly words: string; readonly play: CardPlay }[] = [];
  /* The first layer is the play whose moment it is (play_moment, 0072): drawn where its card is, and never named beside itself. */
  const self = moment.layers[0]!.act.id;
  let own: string | null = null;
  let above: CardPlay | null = null;
  for (const { act, state } of moment.layers) {
    if (act.kind === 'spring' || act.kind === 'card_end') continue;
    const play = playOf(act);
    if (!play) continue;
    if (play.reach) {
      /* The moment's own play on a character: not a layer on the post, drawn around it where it was live and its card has an effect. */
      if (act.id === self && play.reach === 'character' && !play.caught && !endedBy.has(play.id) && (play.ends === undefined || Date.parse(play.ends) > at) && ui.find((c) => c.key === play.card)?.Effect) above = play;
      continue;
    }
    if (act.id === self && (play.faceDown || play.caught !== undefined)) {
      /* A back says nothing of itself; a caught play says what caught it, as its own fate rather than as something else on the post. */
      if (play.caught !== undefined) {
        const trap = springs.find((s) => s.payload.set === play.caught)?.payload.card;
        own = `Caught by ${typeof trap === 'string' ? cardName(trap) : 'a trap'}`;
      }
      continue;
    }
    if (play.faceDown) {
      /* A back whose time had passed by then, with nothing springing it, was gone from the post then (card_target), as now. */
      if (shownPlays([play], at).length === 0 && !springs.some((x) => x.payload.set === play.id)) continue;
      named.push({ words: 'a card set face down', play });
      continue;
    }
    if (play.caught !== undefined) {
      const trap = springs.find((s) => s.payload.set === play.caught)?.payload.card;
      named.push({ words: `${cardName(play.card)}, caught by ${typeof trap === 'string' ? cardName(trap) : 'a trap'}`, play });
      continue;
    }
    if (endedBy.has(play.id)) {
      named.push({ words: `${cardName(play.card)}, ended by an admin`, play });
      continue;
    }
    if (play.ends !== undefined && Date.parse(play.ends) <= at) continue;
    const card = rules.find((c) => c.key === play.card);
    if (card && drawnInMoment(card) && ui.find((c) => c.key === play.card)?.Effect) {
      drawn.push(play);
      if (state) states[play.id] = state;
    } else if (act.id !== self) {
      named.push({ words: cardName(play.card), play });
    }
  }
  const where = (a: PlayAbove) => (a.reach === 'character' ? nameOf(a.target) : `the ${a.reach}`);
  return {
    drawn: drawn.sort(inPlayOrder),
    states,
    named: [
      ...named.sort((a, b) => inPlayOrder(a.play, b.play)).map((n) => n.words),
      ...moment.above.map((a) => `${cardName(typeof a.act.payload.card === 'string' ? a.act.payload.card : '')} on ${where(a)}`),
    ],
    own,
    above,
  };
}

const NOTHING_SAVED = 'a moment is drawn as it was, and nothing in it is saved';
const stillSave: EffectProps['save'] = async () => ({ ok: false, error: NOTHING_SAVED });
const stillRelease: EffectProps['release'] = async () => ({ ok: false, error: NOTHING_SAVED });
const stillGive: EffectProps['give'] = async () => ({ ok: false, error: NOTHING_SAVED });
const stillMore: EffectProps['moreGifts'] = async () => {};
/**
 * A surface in a moment: nothing is drawn or washed, and the moment holds no read of the layer (it is not in the play's moment), so it has
 * no cells and no acts (null, never read), and `near` does nothing.
 */
const stillSurface = (most: number): NonNullable<EffectProps['surface']> => ({
  covered: 0, most, acts: null, near: nothing,
  draw: async () => ({ ok: false, error: NOTHING_SAVED }), wash: async () => ({ ok: false, error: NOTHING_SAVED }),
});
const nothing = () => {};
const NONE_RELEASED: ReadonlySet<Id> = new Set();

/**
 * A play's moment, drawn: `children` (the moment's version of the post, as the caller draws a post's words) wrapped in the effects of
 * the moment's drawn layers (`momentParts`), each given `still`, the state it had saved then, no marks, a `save` and a `release` that
 * refuse without asking, and a `met` that does nothing; its `show` hands the view's words to `onWords`, by card. The layers wrap in
 * the order PostEffects wraps a post's own (`nestOrder`), from a
 * Plays store of its own, so nothing here reads or changes the live post's. The reader is nobody in particular: a moment is the same
 * for every reader.
 */
export function MomentEffects({ moment, place, nameOf, onWords, children }: {
  readonly moment: PlayMoment; readonly place: EffectPlace;
  readonly nameOf: (character: Id | null) => string;
  /** The frame's words for each drawn card, by card key, or null when its effect is gone. */
  readonly onWords: (card: string, words: string | null) => void;
  readonly children: ReactNode;
}) {
  const { instance, ui } = useKayfa();
  /* What is drawn does not depend on names, so a caller's new `nameOf` never builds the store again. */
  const parts = useMemo(() => momentParts(moment, instance.cards, ui.cards, () => ''), [moment, instance.cards, ui.cards]);
  const store = useMemo(() => {
    const own = createPlays();
    own.add(moment.layers.map((l) => l.act).filter((a) => parts.drawn.some((p) => p.id === a.id)));
    own.setStates(parts.states);
    return own;
  }, [moment, parts]);
  const here = store.get(moment.version.id);
  /*
   * The tails of the plays then that write, at the version the play landed on (the post's own rows for it alone, so a tail that was made
   * later, for an edit after it, is not here). The moment names its version by the Act, whose `editedAt` is the edit's time, so the version
   * is found in the post's History, read once when a writing play is drawn here.
   */
  const writing = useMemo(() => writingKeys(instance.cards), [instance.cards]);
  const writingPlays = here.plays.filter((p) => writes(p, writing));
  const tailRows = useTails(moment.version, writingPlays.map((p) => p.id));
  const at = useMomentVersion(moment.version, writingPlays.length > 0);
  const written = useMemo(() => resolveWritten(tailRows, [], at, 'version'), [tailRows, at]);
  /* The moment's own play on a character is ordered as PostEffects orders a post's author's (`nestOrder`): given before the post's own cards, so inside them, and inside every takeover. */
  const wraps = [
    ...(parts.above ? [{ key: parts.above.card, reach: 'character' as const, mine: [parts.above] }] : []),
    ...[...new Set(here.plays.map((p) => p.card))].map((key) => ({ key, reach: 'post' as const, mine: here.plays.filter((p) => p.card === key) })),
  ];
  const order = nestOrder(wraps, ui.cards, writing);
  let wrapped = children;
  for (const { key, reach, mine } of [...order.writing, ...order.rest, ...order.takeovers]) {
    const Effect = ui.cards.find((c) => c.key === key)!.Effect!;
    wrapped = (
      <StillEffect key={`${reach}:${key}`} Effect={Effect} card={key} onWords={onWords}
        post={moment.version} plays={mine} states={reach === 'post' ? here.states : NO_STATES} released={NONE_RELEASED}
        written={reach === 'post' ? writtenOf(written, mine, writing) : NOTHING_WRITTEN} {...(at !== null && reach === 'post' ? { version: at } : {})}
        reader={{ author: false, caster: false }} place={place} reach={reach} nameOf={nameOf}>
        {wrapped}
      </StillEffect>
    );
  }
  return <>{wrapped}</>;
}

/** The id of the version a moment's post is drawn at, read from the post's History once it is wanted; null until then and where it is not found. */
function useMomentVersion(version: Act, wanted: boolean): Id | null {
  const { api } = useKayfa();
  const [found, setFound] = useState<Id | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    api.history(version.id).then((history) => { if (live) setFound(versionAt(history, version.editedAt)); }, () => { /* the moment is drawn without its tails */ });
    return () => { live = false; };
  }, [api, version.id, version.editedAt, wanted]);
  return found;
}

/**
 * A version of a post drawn with the tails its writing plays made for it, still (History, design section 7): each play's effect in still mode,
 * given `written` for this version's own rows and no saved state, so a tail shows in full whatever was cleared. A play with nothing for this
 * version draws none, and a post whose plays have nothing draws its words alone. Nothing here saves, releases or takes input.
 */
export function VersionEffects({ post, version, plays, written, nameOf = () => '', children }: {
  /** The post (its words are `children`, the version's own). */
  readonly post: Act; readonly version: Id;
  /** The live writing plays on the post, in play order; those with nothing in `written` are left out. */
  readonly plays: readonly CardPlay[];
  readonly written: ReadonlyMap<Id, Written>;
  readonly nameOf?: (character: Id | null) => string; readonly children: ReactNode;
}) {
  const { ui, instance } = useKayfa();
  const writing = useMemo(() => writingKeys(instance.cards), [instance.cards]);
  const has = plays.filter((p) => written.has(p.id));
  const order = nestOrder([...new Set(has.map((p) => p.card))].filter((k) => ui.cards.find((c) => c.key === k)?.Effect).map((key) => ({ key })), ui.cards, writing);
  let wrapped = children;
  for (const { key } of [...order.writing, ...order.rest, ...order.takeovers]) {
    const Effect = ui.cards.find((c) => c.key === key)!.Effect!;
    wrapped = (
      <StillEffect key={key} Effect={Effect} card={key} onWords={nothing}
        post={post} plays={has.filter((p) => p.card === key)} states={NO_STATES} released={NONE_RELEASED} written={written} version={version}
        reader={{ author: false, caster: false }} place="thread" reach="post" nameOf={nameOf}>
        {wrapped}
      </StillEffect>
    );
  }
  return <>{wrapped}</>;
}
const NO_STATES: Readonly<Record<Id, EffectState>> = Object.freeze({});

/**
 * One card's still effect in a moment, its `show` bound to its card, and its words cleared when it is gone. Its words are its view's
 * notes, a play's each, top first (the last played first), where it gives any: a still view's heading is "as it landed", which the
 * frame says already (the owner, 2026-11-07), and the notes say how each layer stood. A view with no notes gives its heading.
 */
function StillEffect({ Effect, card, onWords, ...props }: Omit<EffectProps, 'show' | 'met' | 'holdScreen' | 'still' | 'save' | 'release' | 'marks' | 'drives' | 'give' | 'moreGifts' | 'wallet' | 'surface' | 'ink'> & {
  readonly Effect: ComponentType<EffectProps>; readonly card: string; readonly onWords: (card: string, words: string | null) => void;
}) {
  const plays = props.plays;
  const { instance } = useKayfa();
  const rules = instance.cards.find((c) => c.key === card);
  const surface = useMemo(() => (rules?.surface ? stillSurface(surfaceMost(card, rules.surface.limitKey, instance.settings)) : undefined), [rules, card, instance.settings]);
  const show = useCallback((view: CardView | null) => {
    const notes = view ? [...plays].reverse().map((p) => view.notes[p.id]).filter((n): n is string => n !== undefined && n !== '') : [];
    onWords(card, view === null ? null : notes.length > 0 ? notes.join('; ') : view.state);
  }, [onWords, card, plays]);
  useEffect(() => () => onWords(card, null), [onWords, card]);
  return <Suspense fallback={props.children}><Effect {...props} still show={show} met={nothing} holdScreen={nothing} marks={null} save={stillSave} release={stillRelease} give={stillGive} moreGifts={stillMore} wallet={null} ink={NO_INK} {...(surface ? { surface } : {})} /></Suspense>;
}

export { useNarrow, useSheet } from '../media.ts';

/**
 * The words on a filled tab, `--kb-glass-ink-neon`, as the glass root resolves it now: the instance's key sets it there
 * (engine/ui/glass/apply.ts, on the document's root), and a change of key (high contrast) re-reads it. Empty where nothing
 * resolves it, and then no ink can be measured.
 */
const ON_INK = '--kb-glass-ink-neon';
const readOnInk = (): string => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(ON_INK).trim());
/* One observer of the root for the page, however many marks ask, started with the first and stopped with the last. */
const onInkWatchers = new Set<() => void>();
let onInkObserver: MutationObserver | null = null;
const watchOnInk = (changed: () => void) => {
  onInkWatchers.add(changed);
  if (!onInkObserver && typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    onInkObserver = new MutationObserver(() => { for (const w of [...onInkWatchers]) w(); });
    onInkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-kb-glass-key', 'data-kb-contrast', 'data-kb-mode'] });
  }
  return () => {
    onInkWatchers.delete(changed);
    if (onInkWatchers.size === 0) { onInkObserver?.disconnect(); onInkObserver = null; }
  };
};
export const useOnInk = (): string => useSyncExternalStore(watchOnInk, readOnInk, () => '');

/**
 * A play's ink, where its card chooses one (`CardUi.tag`), given all of this card's plays on the post in play order: lifted
 * to read on the glass where it is too dark to (`glassInk`, against `onInk` from `useOnInk`), and none where it cannot be read.
 */
export const inkOf = (ui: { readonly cards: readonly CardUi[] }, play: CardPlay, plays: readonly CardPlay[], onInk: string): string | undefined => {
  const chosen = ui.cards.find((c) => c.key === play.card)?.tag?.(play, plays.filter((o) => o.card === play.card));
  return chosen === undefined ? undefined : glassInk(chosen, onInk);
};
