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
import { useCallback, useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useMeet } from './Callout.tsx';
import { usePlays, type Plays } from './plays.ts';
import type { CardPlay, CardUi, CardView, EffectPlace, EffectProps } from './types.ts';

const NOT_AUTHOR = 'only the post\'s author saves what is on it';

/** Wraps a post's words in the effect of each card played on it, in play order. */
export function PostEffects({ plays, post, place, marks = null, nameOf, children }: {
  readonly plays: Plays; readonly post: Act; readonly place: EffectPlace;
  /** The post's marks, as the post's date row draws them: given to a takeover's effect alone. */
  readonly marks?: ReactNode;
  /** A character's name as the screen knows it, for an effect that names a caster. */
  readonly nameOf: (character: Id | null) => string; readonly children: ReactNode;
}) {
  const { api, ui } = useKayfa();
  const { actingCharacters, writingCharacters } = usePlayer();
  const here = usePlays(plays, post.id);
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

  if (here.plays.length === 0) return <>{children}</>;
  /* The cards in the order each was first played: the first is innermost. */
  const played = [...new Set(here.plays.map((p) => p.card))];
  const takes = (key: string) => ui.cards.find((c) => c.key === key)?.takeover === true;
  const keys = [...played.filter((k) => !takes(k)), ...played.filter(takes)];
  let wrapped = children;
  for (const key of keys) {
    const card = ui.cards.find((c) => c.key === key);
    if (!card?.Effect) continue;
    const mine = here.plays.filter((p) => p.card === key);
    const Effect = card.Effect;
    wrapped = (
      <BoundEffect
        key={key} Effect={Effect} store={plays}
        post={post} plays={mine} states={here.states} released={here.released} place={place} marks={card.takeover ? marks : null} save={save} release={release} nameOf={nameOf}
        reader={{ author: author !== null, caster: mine.some((p) => actingCharacters.some((c) => c.id === p.caster)) }}
      >
        {wrapped}
      </BoundEffect>
    );
  }
  return <>{wrapped}</>;
}

/**
 * One card's effect on one post, given a `show` bound to that post and card, and clearing the card's view when the effect
 * is gone (unmounted: the plays that drew it left, or the post did), so a mark never keeps saying what a dead effect last
 * said. `show` is stable for the pair, so an effect may list it in its dependencies. A view is keyed by post and card,
 * not by where the post is drawn: a post is drawn once on a page, in its thread or in the ORIGIN box of a thread spun
 * from it, never both, so the two places never share a key at once.
 */
function BoundEffect({ Effect, store, marks, ...props }: Omit<EffectProps, 'show' | 'met'> & { readonly Effect: ComponentType<EffectProps>; readonly store: Plays }) {
  const post = props.post.id;
  const card = props.plays[0]!.card;
  const show = useCallback((view: CardView | null) => store.setView(post, card, view), [store, post, card]);
  useEffect(() => () => store.setView(post, card, null), [store, post, card]);
  const met = useMeet(card);
  return <Effect {...props} show={show} met={met} marks={marks} />;
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
