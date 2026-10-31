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
 * alone, as a boolean, so a reaction wakes the marks of the kind it lands on and never the strip's others; the strip
 * itself reads the post's plays and the post's tally.
 *
 * `PostMarks` is the strip with what a mark opens until the Lens is built (Task 4 of the plan replaces it): the play
 * panel (Panel.tsx) of the kind's first billed play.
 */
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import type { Mine } from '../reactions/mine.ts';
import { useTally, type Tallies } from '../thread/tallies.ts';
import { inkOf, useNarrow } from './Effects.tsx';
import { withCardEconomy } from './faces.ts';
import { PlayPanel } from './Panel.tsx';
import { GhostMark } from './PlayActions.tsx';
import { MARKS_NARROW, MARKS_WIDE, kindsOf, markName, moreName, sumOf } from './marks.ts';
import { defaultView, inPlayOrder, useCardView, usePlays, type Plays } from './plays.ts';
import type { CardPlay } from './types.ts';
import './marks.css';

export { MARKS_NARROW, MARKS_WIDE, kindsOf };

type Open = (kind: string, opener: HTMLElement) => void;

/** Whether any of these plays has more public reactions than the post: a boolean, so only a change in the answer draws the mark again. */
function useOutdrawing(tallies: Tallies, plays: readonly CardPlay[], postTotal: number): boolean {
  const subscribe = useCallback((changed: () => void) => {
    const off = plays.map((p) => tallies.subscribe(p.id, changed));
    return () => { for (const o of off) o(); };
  }, [tallies, plays]);
  return useSyncExternalStore(subscribe, () => plays.some((p) => sumOf(tallies.get(p.id)) > postTotal));
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
  readonly onOpen: Open;
}

const Mark = memo(function Mark({ post, kind, plays, store, tallies, postTotal, compare, expanded, onOpen }: MarkProps) {
  const { instance, settings, ui } = useKayfa();
  const rules = instance.cards.find((c) => c.key === kind);
  const cardUi = ui.cards.find((c) => c.key === kind);
  const given = useCardView(store, post, kind);
  const economy = useMemo(() => withCardEconomy(instance.settings, settings.cardEconomy), [instance.settings, settings.cardEconomy]);
  const view = given ?? defaultView({ name: rules?.name ?? kind }, cardUi, economy);
  const outdrawing = useOutdrawing(tallies, plays, postTotal);
  const more = compare && outdrawing;
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
  return (
    <button
      type="button" className="kb-mark" data-kb-card={kind} data-kb-plays={plays.length} data-kb-alignment={rules?.alignment} data-kb-edge={progress === null ? undefined : 'true'}
      aria-label={markName({ card: name, plays: plays.length, state: view.state, more, yours: view.yours })} aria-haspopup="dialog" aria-expanded={expanded}
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
  const postTotal = sumOf(useTally(tallies, post));
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
    <span className="kb-marks">
      {shown.map((kind) => (
        <Mark key={kind} post={post} kind={kind} plays={byKind.get(kind)!} store={plays} tallies={tallies} postTotal={postTotal} compare={compare} expanded={open === kind} onOpen={press} />
      ))}
      {hidden.length > 0 && <More hidden={hidden.length} first={hidden[0]!} expanded={open !== null && hidden.includes(open)} onOpen={press} />}
      {ghost && <GhostMark act={ghost} />}
    </span>
  );
}

/**
 * The strip, where a post's date row holds it, and what its marks open until the Lens exists: the panel of the kind's
 * first billed play (cards/Panel.tsx), over which React and Spin thread are reached. Going in Task 4 of the marks-and-the-lens
 * plan, which opens the Lens on the kind. A read of the page closes what was opened, since its billing may have moved.
 */
export function PostMarks({ post, plays, to, nameOf, tallies, mine, ghost, compare, onSpin }: {
  readonly post: Id; readonly ghost?: Act; readonly compare?: boolean; readonly plays: Plays; readonly to: string | null; readonly nameOf: (character: Id | null) => string;
  readonly tallies: Tallies; readonly mine: Mine;
  /** Spin a thread from a play: the panel has closed, and the post opens its spin form for it, giving focus back to `opener` when the form closes. */
  readonly onSpin: (play: CardPlay, name: string, opener: HTMLElement) => void;
}) {
  const { ui } = useKayfa();
  const narrow = useNarrow();
  const here = usePlays(plays, post);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<{ readonly kind: string; readonly opener: HTMLElement } | null>(null);
  const [seen, setSeen] = useState(here.read);
  if (seen !== here.read) { setSeen(here.read); setOpen(null); }
  const opened = open ? here.billed.find((p) => p.card === open.kind) ?? null : null;
  return (
    <span className="kb-marks-anchor" ref={anchor}>
      <MarkStrip post={post} plays={plays} tallies={tallies} ghost={ghost} compare={compare} open={open?.kind ?? null} onOpen={(kind, opener) => setOpen((was) => (was?.kind === kind ? null : { kind, opener }))} />
      {open && opened && (
        <PlayPanel
          play={opened} caster={nameOf(opened.caster)} tint={inkOf(ui, opened, here.plays)} plays={plays} tallies={tallies} mine={mine} to={to}
          sheet={narrow} opener={open.opener} fallback={() => anchor.current?.querySelector<HTMLElement>('button') ?? null} onClose={() => setOpen(null)}
          onSpin={(play, name) => { const from = open.opener; setOpen(null); onSpin(play, name, from); }}
        />
      )}
    </span>
  );
}
