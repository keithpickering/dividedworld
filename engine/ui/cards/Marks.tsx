/**
 * The marks over a post (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 1): what the thread shows of the
 * cards played on a post. One mark per card kind, never one per play, in the post's date row beside its number: the
 * card's mark icon, a count when the kind has more than one play, an edge in the card's ink that fills as the card's
 * view says its effect has gone (`CardView.progress`), a gold notch when the card says the reader has something to do
 * (`CardView.yours`), and a small still sign in the corner while any play of the kind has drawn more public reactions
 * than the post it landed on. A mark has no words on it, so no caster's or card's name can break its box; its name for
 * a screen reader carries them. Every mark is a button, and every play is reachable from the mark of its kind (the
 * owner on #84).
 *
 * Marks are positioned over the post and never in the page's flow (marks.css), so a post is as tall with no marks as
 * with nine. Order is billing's, set when the page was read: a kind's place is the place of its first play there, and
 * a play that arrives live puts a new kind at the end, so no live reaction moves a mark under a reader's pointer.
 * Past four marks on a desktop, or three under the thread's 40em, the rest are one "+N" mark that opens the first kind
 * it hides. While a card is armed and can land on the post, the strip ends in the ghost mark (PlayActions.tsx).
 *
 * "At a busy instance's scale": a mark is memoized per kind and subscribes to the tallies of its own kind's plays
 * alone, as a boolean, so a reaction to a play wakes the mark of its kind and never the strip's others. A reaction to
 * the post itself redraws that post's marks (each compares with the post's sum), and no other post's. A strip that
 * compares nothing (a card play's ORIGIN box) listens to no tally.
 *
 * `PostMarks` is the strip with what a mark opens: the Lens (Lens.tsx), on the mark's tab; "+N" opens the first kind it hides.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import type { Mine } from '../reactions/mine.ts';
import type { Tallies } from '../thread/tallies.ts';
import { inkOf, useNarrow } from './Effects.tsx';
import { Callout, useCallout } from './Callout.tsx';
import { Lens, useLensFor, useLensHost, useLensStore, useResolvedView } from './Lens.tsx';
import { GhostMark } from './PlayActions.tsx';
import { MARKS_NARROW, MARKS_WIDE, kindsOf, markName, moreName, sumOf } from './marks.ts';
import { inPlayOrder, usePlays, type Plays } from './plays.ts';
import type { CardPlay } from './types.ts';
import './marks.css';

export { MARKS_NARROW, MARKS_WIDE, kindsOf };

type Open = (kind: string, opener: HTMLElement) => void;

/**
 * Whether any of these plays has more public reactions than the post: a boolean, so only a change in the answer draws the
 * mark again. Where `compare` is off (the post's tally is not read here) it listens to nothing and says no.
 */
function useOutdrawing(tallies: Tallies, plays: readonly CardPlay[], postTotal: number, compare: boolean): boolean {
  const subscribe = useCallback((changed: () => void) => {
    if (!compare) return () => {};
    const off = plays.map((p) => tallies.subscribe(p.id, changed));
    return () => { for (const o of off) o(); };
  }, [tallies, plays, compare]);
  return useSyncExternalStore(subscribe, () => compare && plays.some((p) => sumOf(tallies.get(p.id)) > postTotal));
}

/** The sum of the post's own tally; 0, listening to nothing, where the strip compares nothing. */
function usePostTotal(tallies: Tallies, post: Id, compare: boolean): number {
  const subscribe = useCallback((changed: () => void) => (compare ? tallies.subscribe(post, changed) : () => {}), [tallies, post, compare]);
  return useSyncExternalStore(subscribe, () => (compare ? sumOf(tallies.get(post)) : 0));
}

interface MarkProps {
  readonly post: Id;
  readonly kind: string;
  /** This kind's plays on the post, in billing order. */
  readonly plays: readonly CardPlay[];
  readonly store: Plays;
  readonly tallies: Tallies;
  readonly postTotal: number;
  /** Whether to compare the plays' reactions with the post's: not where the post's tally is not read (the ORIGIN box of a card play). */
  readonly compare: boolean;
  readonly expanded: boolean;
  /** A Lens is open on this post (on any of its kinds): the callout stands aside while it is, and returns when it closes, unless met. */
  readonly lensOpen: boolean;
  readonly onOpen: Open;
}

const Mark = memo(function Mark({ post, kind, plays, store, tallies, postTotal, compare, expanded, lensOpen, onOpen }: MarkProps) {
  const { instance, ui } = useKayfa();
  const rules = instance.cards.find((c) => c.key === kind);
  const cardUi = ui.cards.find((c) => c.key === kind);
  const view = useResolvedView(store, post, kind);
  const more = useOutdrawing(tallies, plays, postTotal, compare);
  const name = rules?.name ?? kind;
  const art = cardUi?.art;
  const icon = art?.mark ?? art?.image;
  /* The ink is the top-billed play's, where the card chooses one for it (`CardUi.tag` is given the kind's plays in play order). */
  const ordered = useMemo(() => [...plays].sort(inPlayOrder), [plays]);
  const ink = inkOf(ui, plays[0]!, ordered) ?? art?.color;
  const progress = view.progress === null ? null : Math.min(1, Math.max(0, view.progress));
  const style = {
    ...(art ? { '--kb-mark-color': art.color } : {}),
    ...(ink ? { '--kb-mark-ink': ink } : {}),
    ...(progress === null ? {} : { '--kb-mark-progress': progress }),
  } as CSSProperties;
  const button = useRef<HTMLButtonElement>(null);
  const chosen = useCallout(kind, cardUi?.hint, button);
  const callout = lensOpen ? null : chosen;
  return (
    <>
    <button
      ref={button} type="button" className="kb-mark" data-kb-card={kind} data-kb-plays={plays.length} data-kb-alignment={rules?.alignment} data-kb-edge={progress === null ? undefined : 'true'}
      aria-label={markName({ card: name, plays: plays.length, state: view.state, more, yours: view.yours })} aria-haspopup="dialog" aria-expanded={expanded} aria-describedby={callout ?? undefined}
      style={style} onClick={(e) => onOpen(kind, e.currentTarget)}
    >
      <span className="kb-mark-in" aria-hidden="true">
        {icon ? <img className="kb-mark-icon" src={icon} alt="" draggable={false} /> : <span className="kb-mark-swatch" />}
        {plays.length > 1 && <span className="kb-mark-count">×{plays.length}</span>}
      </span>
      {progress !== null && <span className="kb-mark-edge" aria-hidden="true" />}
      {view.yours && <span className="kb-mark-notch" data-kb-notch="" aria-hidden="true" />}
      {more && <span className="kb-mark-sign" data-kb-more="" aria-hidden="true" />}
    </button>
    {callout && cardUi?.hint && <Callout id={callout} kind={kind} name={name} hint={cardUi.hint} />}
    </>
  );
});

/** The "+N" mark: the kinds the strip has no room for, opening the first of them. */
function More({ hidden, first, expanded, onOpen }: { readonly hidden: number; readonly first: string; readonly expanded: boolean; readonly onOpen: Open }) {
  return (
    <button
      type="button" className="kb-mark kb-mark-more" aria-label={moreName(hidden)} aria-haspopup="dialog" aria-expanded={expanded}
      onClick={(e) => onOpen(first, e.currentTarget)}
    >
      <span className="kb-mark-in" aria-hidden="true"><span className="kb-mark-count">+{hidden}</span></span>
    </button>
  );
}

/** Each kind's plays in billing order, the same array as before while the kind's plays are the same, so a memoized mark is drawn again only for a change in its own kind. */
function useKindPlays(billed: readonly CardPlay[]): ReadonlyMap<string, readonly CardPlay[]> {
  const kept = useRef<ReadonlyMap<string, readonly CardPlay[]>>(new Map());
  return useMemo(() => {
    const next = new Map<string, CardPlay[]>();
    for (const p of billed) {
      const list = next.get(p.card);
      if (list) list.push(p); else next.set(p.card, [p]);
    }
    const out = new Map<string, readonly CardPlay[]>();
    for (const [kind, list] of next) {
      const was = kept.current.get(kind);
      out.set(kind, was && was.length === list.length && was.every((p, i) => p === list[i]) ? was : list);
    }
    kept.current = out;
    return out;
  }, [billed]);
}

export interface MarkStripProps {
  /** The post the marks are on (the id its plays are kept under). */
  readonly post: Id;
  readonly plays: Plays;
  readonly tallies: Tallies;
  /** A mark was pressed: the kind it stands for (the first it hides, for "+N"), and the button, which the Lens gives focus back to. */
  readonly onOpen: Open;
  /** The kind whose cards are open now, if any: the mark of it, or the "+N" that hides it, says so. */
  readonly open?: string | null;
  /** Offer the armed card on this post with a ghost mark at the strip's end: the thread's posts do, and the ORIGIN box (a view of another thread's Act) does not. */
  readonly ghost?: Act;
  /** Compare the plays' reactions with the post's for the corner sign; false where the post's tally is not read here (a card play's ORIGIN box, whose post is in another thread). */
  readonly compare?: boolean;
}

/** One mark per kind of card played on the post, "+N" for the kinds past the strip's room, and the ghost mark while an armed card can land here. */
export function MarkStrip({ post, plays, tallies, onOpen, open = null, ghost, compare = true }: MarkStripProps) {
  const here = usePlays(plays, post);
  const narrow = useNarrow();
  /* A strip a takeover hosts (Stick Around's view) offers no ghost mark: its play form would open under the view. */
  const hosted = useLensHost() !== document.body;
  const postTotal = usePostTotal(tallies, post, compare);
  /*
   * The strip is out of the page's flow, so the row it hangs on cannot know its width: it measures itself and tells its
   * parent cell (`--kb-marks-width`, marks.css), which takes that room in the row's width. The row's words give way to it
   * and the row's height is the same.
   */
  const strip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    const cell = el?.parentElement;
    if (!el || !cell) return;
    const tell = () => cell.style.setProperty('--kb-marks-width', `${Math.ceil(el.getBoundingClientRect().width)}px`);
    tell();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(tell);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const byKind = useKindPlays(here.billed);
  /* `onOpen` may be a new function every render of the post; the marks are given one that is not. */
  const latest = useRef(onOpen);
  latest.current = onOpen;
  const press = useCallback<Open>((kind, opener) => latest.current(kind, opener), []);
  const kinds = kindsOf(here.billed);
  const room = narrow ? MARKS_NARROW : MARKS_WIDE;
  const shown = kinds.length > room ? kinds.slice(0, room) : kinds;
  const hidden = kinds.slice(shown.length);
  return (
    <span className="kb-marks" ref={strip}>
      {shown.map((kind) => (
        <Mark key={kind} post={post} kind={kind} plays={byKind.get(kind)!} store={plays} tallies={tallies} postTotal={postTotal} compare={compare} expanded={open === kind} lensOpen={open !== null} onOpen={press} />
      ))}
      {hidden.length > 0 && <More hidden={hidden.length} first={hidden[0]!} expanded={open !== null && hidden.includes(open)} onOpen={press} />}
      {ghost && !hosted && <GhostMark act={ghost} />}
    </span>
  );
}

/**
 * The strip, where a post's date row holds it, and the Lens its marks open (Lens.tsx): a mark opens it on its tab, "+N" on the
 * first kind it hides, and the same mark again closes it. One Lens is open on a page, so a strip subscribes to whether it is
 * the one and is redrawn for its own opening and closing alone.
 */
export function PostMarks({ post, plays, to, nameOf, tallies, mine, ghost, compare = true, onSpin }: {
  readonly post: Id; readonly ghost?: Act; readonly compare?: boolean; readonly plays: Plays; readonly to: string | null; readonly nameOf: (character: Id | null) => string;
  readonly tallies: Tallies; readonly mine: Mine;
  /** Spin a thread from a play: the Lens has closed, and the post opens its spin form for it, giving focus back to `opener` when the form closes. */
  readonly onSpin: (play: CardPlay, name: string, opener: HTMLElement) => void;
}) {
  const owner = useId();
  const store = useLensStore();
  const open = useLensFor(store, owner);
  const anchor = useRef<HTMLSpanElement>(null);
  /* Gone with its Lens open (the post left the page): the page's Lens is closed with it. */
  useEffect(() => () => { if (store.get()?.owner === owner) store.close(); }, [store, owner]);
  const onOpen = useCallback<Open>((kind, opener) => store.toggle({ owner, card: kind, opener }), [store, owner]);
  const strip = useCallback(() => anchor.current, []);
  return (
    <span className="kb-marks-anchor" ref={anchor}>
      <MarkStrip post={post} plays={plays} tallies={tallies} ghost={ghost} compare={compare} open={open?.card ?? null} onOpen={onOpen} />
      {open && <Lens open={open} store={store} post={post} plays={plays} tallies={tallies} mine={mine} compare={compare} to={to} nameOf={nameOf} strip={strip} onSpin={onSpin} />}
    </span>
  );
}
