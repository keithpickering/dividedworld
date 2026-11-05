/**
 * What a card play shows on its post: the card's effect around the post's words, and the hooks a card's effect speaks
 * to the marks through.
 *
 * A play's presence in a thread is its card's mark (Marks.tsx, in the post's date row): a card play takes no number and
 * is never a line of its own, and the post it lands on keeps its number and everyone's reactions. A card the instance
 * gives no `CardUi` is shown as its mark alone. An effect says what its card's state is on this post with `show`
 * (`CardView`), and the mark and the Lens draw from it; the post's own body holds the effect and nothing a player
 * presses.
 *
 * An effect (`CardUi.Effect`) wraps the post's words wherever they are drawn (the thread, and the ORIGIN box of a
 * thread spun from the post). Each played card's wraps the cards played before it, in play order, so the latest is
 * outermost, except a card with `CardUi.takeover` (Stick Around, which lifts the post out of its thread): those wrap last, so
 * every other card's effect is inside a takeover's `children`, and several takeovers wrap in their own play order. Only a
 * takeover is given the post's `marks` (the strip the post's date row draws, handed in by the post) and draws them on the post
 * it lifts. A post with no plays, or whose plays' cards draw no effect, is drawn untouched.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, EffectState, Id, PlayAbove, PlayMoment } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useMeet } from './Callout.tsx';
import { useHoldScreen } from '../tips/Tips.tsx';
import { useLensStore } from './Lens.tsx';
import { MomentView, useShownMoment } from './Moment.tsx';
import { createPlays, inPlayOrder, livePlays, nextEnd, playOf, shownPlays, usePlays, type Plays } from './plays.ts';
import { drawnInMoment, type CardRules, type Reach } from '../../rules/cards.ts';
import type { Span } from '../../rules/types.ts';
import type { CardPlay, CardUi, CardView, EffectPlace, EffectProps } from './types.ts';

const NOT_AUTHOR = 'only the post\'s author saves what is on it';

/**
 * Wraps a post's words in the effect of each card played on it, in play order, and in the effects of the live plays above it (the
 * card mechanic's design, section 7): the board's innermost, then the thread's, then its author's, then the post's own, as a card's
 * rules see them (effectsOnTarget), with every takeover outermost. A play beyond a post stops wrapping at its end, by itself.
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
  const { api, ui } = useKayfa();
  const { actingCharacters, writingCharacters } = usePlayer();
  const here = usePlays(plays, post.id);
  const lens = useLensStore();
  const moment = useShownMoment(lens);
  const onBoard = usePlays(plays, board ?? '');
  const onThread = usePlays(plays, post.thread);
  const onAuthor = usePlays(plays, post.character ?? '');
  /*
   * The character of the reader's that wrote the post, if any: the only one a state is saved as. Retired or not, since the
   * post's player answers for what is on it (#85); casting and releasing stay with the masks that can act.
   */
  const author = writingCharacters.find((c) => c.id === post.character) ?? null;
  const save = useCallback<EffectProps['save']>(async (play, state) => {
    if (!author) return { ok: false, error: NOT_AUTHOR };
    const saved = await api.saveEffect(play, author.id, state);
    if (saved.ok) plays.setStates({ [play]: { state, savedAt: saved.value.savedAt } });
    return saved;
  }, [api, author, plays]);
  const release = useCallback<EffectProps['release']>(async (play) => {
    const released = await api.releaseEffect(play);
    if (released.ok) plays.setReleased([play]);
    return released;
  }, [api, plays]);
  /* The layers above the post, each its own reach's plays still live, redrawn at the soonest end (useUntil). */
  const above = [
    { reach: 'board' as const, drawn: board === null ? [] : onBoard.plays, of: onBoard },
    { reach: 'thread' as const, drawn: onThread.plays, of: onThread },
    { reach: 'character' as const, drawn: post.character === null ? [] : onAuthor.plays, of: onAuthor },
  ].map((l) => ({ ...l, drawn: l.drawn.filter((p) => p.reach === l.reach) }));
  const now = useUntil(above.flatMap((l) => l.drawn));

  /* A play a trap caught does nothing, and a card back draws no effect: neither wraps the post (the card mechanic's design, section 4). */
  const layers = [
    ...above.map((l) => ({ reach: l.reach as Reach, acting: livePlays(l.drawn, now), of: l.of })),
    { reach: 'post' as Reach, acting: here.plays.filter((p) => !p.caught && !p.reversed && !p.faceDown && !p.reach), of: here },
  ];
  /*
   * A play's moment shown here (As it landed): it replaces the post's words and every effect inside the takeovers, which keep wrapping
   * it, so a held post stays held. Nothing the reader does reaches the live effects while it shows: they are not drawn.
   */
  const momentAct = moment !== null && bodyOf ? here.plays.find((p) => p.id === moment) : undefined;
  if (layers.every((l) => l.acting.length === 0) && !momentAct) return <>{children}</>;
  const takes = (key: string) => ui.cards.find((c) => c.key === key)?.takeover === true;
  /* Each layer's cards in the order each was first played there, the first innermost; every takeover after all of them. */
  const wraps = layers.flatMap((l) => [...new Set(l.acting.map((p) => p.card))].map((key) => ({ ...l, key })));
  const ordered = [...wraps.filter((w) => !takes(w.key)), ...wraps.filter((w) => takes(w.key))];
  let wrapped = children;
  if (momentAct && bodyOf) {
    wrapped = (
      <MomentView
        play={momentAct} place={place} nameOf={nameOf} bodyOf={bodyOf} now={children}
        back={() => lens.showMoment(null)}
      />
    );
  }
  for (const { key, reach, acting, of } of momentAct ? ordered.filter((w) => takes(w.key)) : ordered) {
    const card = ui.cards.find((c) => c.key === key);
    if (!card?.Effect) continue;
    const mine = acting.filter((p) => p.card === key);
    const Effect = card.Effect;
    wrapped = (
      <BoundEffect
        key={`${reach}:${key}`} Effect={Effect} store={plays} reach={reach}
        post={post} plays={mine} states={of.states} released={of.released} place={place} marks={card.takeover ? marks : null}
        save={reach === 'post' ? save : beyondSave} release={release} nameOf={nameOf}
        reader={{ author: author !== null, caster: mine.some((p) => actingCharacters.some((c) => c.id === p.caster)) }}
      >
        {wrapped}
      </BoundEffect>
    );
  }
  return <>{wrapped}</>;
}

/** A play beyond a post has no post author to save its state (save_effect_state, 0055): refused without asking. */
const beyondSave: EffectProps['save'] = async () => ({ ok: false, error: 'a card beyond a post keeps no state on the post' });

/**
 * The time, redrawn when the soonest of these plays' ends passes, so a play beyond a post stops drawing at its end without a reread
 * (its way out). Nothing is scheduled while none ends ahead.
 */
const TIMER_MOST = 2 ** 31 - 1;
export function useUntil(plays: readonly CardPlay[]): number {
  const [now, setNow] = useState(() => Date.now());
  const next = nextEnd(plays, now);
  useEffect(() => {
    if (next === null) return;
    /* A timer's delay is held under 2^31 ms; a later end is waited for in steps, each re-arming at the time it wakes to. */
    const timer = setTimeout(() => setNow(Date.now()), Math.min(TIMER_MOST, Math.max(0, next - Date.now()) + 1));
    return () => clearTimeout(timer);
  }, [next, now]);
  return now;
}

/**
 * One card's effect on one post, given a `show` bound to that post and card, and clearing the card's view when the effect
 * is gone (unmounted: the plays that drew it left, or the post did), so a mark never keeps saying what a dead effect last
 * said. `show` is stable for the pair, so an effect may list it in its dependencies. A view is keyed by post and card,
 * not by where the post is drawn: a post is drawn once on a page, in its thread or in the ORIGIN box of a thread spun
 * from it, never both, so the two places never share a key at once.
 */
function BoundEffect({ Effect, store, marks, ...props }: Omit<EffectProps, 'show' | 'met' | 'holdScreen' | 'still'> & { readonly Effect: ComponentType<EffectProps>; readonly store: Plays }) {
  const post = props.post.id;
  const card = props.plays[0]!.card;
  /* A view is a post's: an effect above the post, drawn on many posts at once, says none (its mark is its target's). */
  const own = props.reach === 'post';
  const show = useCallback((view: CardView | null) => { if (own) store.setView(post, card, view); }, [store, post, card, own]);
  useEffect(() => () => { if (own) store.setView(post, card, null); }, [store, post, card, own]);
  const met = useMeet(card);
  const holdScreen = useHoldScreen();
  return <Effect {...props} still={false} show={show} met={met} holdScreen={holdScreen} marks={marks} />;
}

/* ------------------------------------------------------------------------------ a play's moment ---- */

/** What a moment draws and what it names (docs/plans/2026-11-03-effect-history-design.md, section 3). */
export interface MomentParts {
  /** The plays on the post then whose cards are drawn in a moment (`drawnInMoment`) and have an effect, in play order. */
  readonly drawn: readonly CardPlay[];
  /** What each drawn play had saved then, by play; a play that had saved none is absent and is drawn as it landed. */
  readonly states: Readonly<Record<Id, EffectState>>;
  /** Everything else on the post then, and every play above it, in words: "Holdy", "a card set face down", "Smear, caught by Trappy", "Sparkly on Spritey". */
  readonly named: readonly string[];
}

/**
 * Splits a moment into what is drawn and what is named. Liveness is judged at the play's own time, never now: a Use that had ended
 * by then is left out, a play an admin had ended by then is named "ended by an admin" (its card_end is among the layers, before the moment), a caught play is named "caught by" its trap's card (the spring that caught it made that card public), and a
 * card back is named as a back, always, even once it sprang: which card it is is never read. A play above the post is named with
 * what it was on, and never drawn, since its moment isn't one post's. A card that cannot change after it lands, or that draws no
 * effect, is named.
 */
export function momentParts(moment: PlayMoment, rules: readonly CardRules[], ui: readonly CardUi[], nameOf: (character: Id | null) => string, setLasts?: Span): MomentParts {
  const at = Date.parse(moment.layers[0]!.act.createdAt);
  const cardName = (key: string) => rules.find((c) => c.key === key)?.name ?? key;
  const springs = moment.layers.map((l) => l.act).filter((a) => a.kind === 'spring');
  /* A play an admin had ended by then: its card_end rides among the layers, and counts only when it came before the moment. */
  const endedBy = new Map(moment.layers.map((l) => l.act).filter((a) => a.kind === 'card_end' && a.targetActId !== null && Date.parse(a.createdAt) <= at).map((a) => [a.targetActId!, a.id] as const));
  const drawn: CardPlay[] = [];
  const states: Record<Id, EffectState> = {};
  const named: { readonly words: string; readonly play: CardPlay }[] = [];
  for (const { act, state } of moment.layers) {
    if (act.kind === 'spring' || act.kind === 'card_end') continue;
    const play = playOf(act);
    if (!play || play.reach) continue;
    if (play.faceDown) {
      /* A back whose time had passed by then, with nothing springing it, was gone from the post then (card_target), as now. */
      if (setLasts && shownPlays([play], setLasts, at).length === 0 && !springs.some((x) => x.payload.set === play.id)) continue;
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
    } else {
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
  };
}

const NOTHING_SAVED = 'a moment is drawn as it was, and nothing in it is saved';
const stillSave: EffectProps['save'] = async () => ({ ok: false, error: NOTHING_SAVED });
const stillRelease: EffectProps['release'] = async () => ({ ok: false, error: NOTHING_SAVED });
const nothing = () => {};
const NONE_RELEASED: ReadonlySet<Id> = new Set();

/**
 * A play's moment, drawn: `children` (the moment's version of the post, as the caller draws a post's words) wrapped in the effects of
 * the moment's drawn layers (`momentParts`), each given `still`, the state it had saved then, no marks, a `save` and a `release` that
 * refuse without asking, and a `met` that does nothing; its `show` hands the view's words to `onWords`, by card. The layers wrap in
 * the order PostEffects wraps a post's own (the cards as each was first played, the first innermost, every takeover outermost), from a
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
  const parts = useMemo(() => momentParts(moment, instance.cards, ui.cards, () => '', instance.settings.setLasts), [moment, instance.cards, ui.cards, instance.settings.setLasts]);
  const store = useMemo(() => {
    const own = createPlays();
    own.add(moment.layers.map((l) => l.act).filter((a) => parts.drawn.some((p) => p.id === a.id)));
    own.setStates(parts.states);
    return own;
  }, [moment, parts]);
  const here = store.get(moment.version.id);
  const takes = (key: string) => ui.cards.find((c) => c.key === key)?.takeover === true;
  const keys = [...new Set(here.plays.map((p) => p.card))];
  let wrapped = children;
  for (const key of [...keys.filter((k) => !takes(k)), ...keys.filter(takes)]) {
    const Effect = ui.cards.find((c) => c.key === key)!.Effect!;
    wrapped = (
      <StillEffect key={key} Effect={Effect} card={key} onWords={onWords}
        post={moment.version} plays={here.plays.filter((p) => p.card === key)} states={here.states} released={NONE_RELEASED}
        reader={{ author: false, caster: false }} place={place} reach="post" nameOf={nameOf}>
        {wrapped}
      </StillEffect>
    );
  }
  return <>{wrapped}</>;
}

/** One card's still effect in a moment, its `show` bound to its card, and its words cleared when it is gone. */
function StillEffect({ Effect, card, onWords, ...props }: Omit<EffectProps, 'show' | 'met' | 'holdScreen' | 'still' | 'save' | 'release' | 'marks'> & {
  readonly Effect: ComponentType<EffectProps>; readonly card: string; readonly onWords: (card: string, words: string | null) => void;
}) {
  const show = useCallback((view: CardView | null) => onWords(card, view?.state ?? null), [onWords, card]);
  useEffect(() => () => onWords(card, null), [onWords, card]);
  return <Effect {...props} still show={show} met={nothing} holdScreen={nothing} marks={null} save={stillSave} release={stillRelease} />;
}

/** The thread's narrow width (thread.css's 40em, where a post is stacked): the Lens is a sheet there and a post's marks are fewer. */
const NARROW = '(max-width: 40em)';
/* One query for the page, however many posts ask it, with one listener behind every post's subscription; asked again only if the window's `matchMedia` is another. */
let narrowQuery: { readonly source: typeof globalThis.matchMedia; readonly list: MediaQueryList } | null = null;
const narrowWatchers = new Set<() => void>();
const queryOf = (): MediaQueryList | null => {
  const source = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia : null;
  if (!source) return null;
  if (narrowQuery?.source !== source) {
    const list = source(NARROW);
    list.addEventListener?.('change', () => { for (const w of [...narrowWatchers]) w(); });
    narrowQuery = { source, list };
  }
  return narrowQuery.list;
};
const watchNarrow = (changed: () => void) => {
  narrowWatchers.add(changed);
  return () => { narrowWatchers.delete(changed); };
};
/** Whether the window is at the thread's narrow width; a screen with no `matchMedia` is wide. */
export const useNarrow = (): boolean => useSyncExternalStore(watchNarrow, () => queryOf()?.matches ?? false, () => false);

/** A play's ink, where its card chooses one (`CardUi.tag`), given all of this card's plays on the post in play order. */
export const inkOf = (ui: { readonly cards: readonly CardUi[] }, play: CardPlay, plays: readonly CardPlay[]): string | undefined =>
  ui.cards.find((c) => c.key === play.card)?.tag?.(play, plays.filter((o) => o.card === play.card));
