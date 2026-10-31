/**
 * What a card play shows on its post: the tag that says it happened, and the card's effect around
 * the post's words.
 *
 * The tag is the whole of a play's own presence in a thread ("Mrs. Hooligan played Whoops! on this
 * post: “you dropped your ink”", and when): a card play takes no number and is never a line of its
 * own, and the post it lands on keeps its number and everyone's reactions. It is the glass reaching
 * into the board, drawn on the `effect` smoke in the card's alignment's tokens, and it links to the
 * post: a play is a layer on a post and is found there, which is the link every other place that
 * names a play (the ORIGIN box, later the log) gives it too. A card the instance gives no `CardUi`
 * is shown as its tag alone.
 *
 * An effect's words and controls are not the post's (the owner's notes on #80: "game state data should not be in
 * the 2003 chrome"). An effect is given a `slot`, a place under the post's chrome, and fills it with an
 * `EffectStrip`, one chamfered glass plate attached to the post; the post's own body holds the effect and nothing a
 * player presses. The thread's post draws the slot itself (thread/Post.tsx), under its words; where a post is
 * drawn without one `PostEffects` draws its own right after the effect. The ORIGIN box draws its slot after the box (spin/Origin.tsx), outside the 2003 chrome.
 *
 * An effect (`CardUi.Effect`) wraps the post's words wherever they are drawn (the thread, and the
 * ORIGIN box of a thread spun from the post). Each played card's wraps the cards played before it,
 * in play order, so the latest is outermost. A post with no plays, or whose plays' cards draw no
 * effect, is drawn untouched.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Smoke, useSurfaceStyle } from '../glass/Smoke.tsx';
import type { Mine } from '../reactions/mine.ts';
import { useTally, type Tallies } from '../thread/tallies.ts';
import { PlayPanel } from './Panel.tsx';
import { usePlays, type Plays } from './plays.ts';
import type { CardPlay, CardUi, EffectPlace, EffectProps } from './types.ts';
import './cards.css';

const NOT_AUTHOR = 'only the post\'s author saves what is on it';

/** Wraps a post's words in the effect of each card played on it, in play order. */
export function PostEffects({ plays, post, place, slot, children }: { readonly plays: Plays; readonly post: Act; readonly place: EffectPlace; readonly slot?: RefObject<HTMLElement | null>; readonly children: ReactNode }) {
  const [own, setOwn] = useState<HTMLElement | null>(null);
  const hosted = slot !== undefined;
  /* The slot the thread's post draws is read once it is mounted, here, so only the effect is drawn again and not the post's words. */
  const [placed, setPlaced] = useState<HTMLElement | null>(null);
  useEffect(() => { if (slot) setPlaced(slot.current); }, [slot]);
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
  const note = useCallback<EffectProps['note']>((play, line) => plays.setNote(play, line), [plays]);

  if (here.plays.length === 0) return <>{children}</>;
  /* The cards in the order each was first played: the first is innermost. */
  const keys = [...new Set(here.plays.map((p) => p.card))];
  let wrapped = children;
  for (const key of keys) {
    const card = ui.cards.find((c) => c.key === key);
    if (!card?.Effect) continue;
    const mine = here.plays.filter((p) => p.card === key);
    const Effect = card.Effect;
    wrapped = (
      <Effect
        key={key} post={post} plays={mine} states={here.states} released={here.released} place={place} slot={hosted ? placed : own} save={save} release={release} note={note}
        reader={{ author: author !== null, caster: mine.some((p) => actingCharacters.some((c) => c.id === p.caster)) }}
      >
        {wrapped}
      </Effect>
    );
  }
  return <>{wrapped}{!hosted && <div className="kb-act-slot" ref={setOwn} />}</>;
}

/**
 * Where a post's armed card is played from, when its effect has drawn a plate: the plate's own place for it. The post
 * (thread/Post.tsx) wraps itself in a `PlateProvider`; a plate puts its host in here, and the post's play control
 * (PlayActions.tsx `PlayHere`) stands in the plate when there is one, and as a tile of its own under the post when
 * there is not. It is state in a provider of its own so that a plate appearing draws the control again and not the
 * post's words.
 */
interface PlateHost { readonly here: HTMLElement | null; readonly add: (el: HTMLElement) => void; readonly remove: (el: HTMLElement) => void }
const PlateContext = createContext<PlateHost | null>(null);

export function PlateProvider({ children }: { readonly children: ReactNode }) {
  /* Every plate on the post, in the order each was drawn: two effects can each draw one, and the tile stands in the first that remains. */
  const [plates, setPlates] = useState<readonly HTMLElement[]>([]);
  const add = useCallback((el: HTMLElement) => setPlates((all) => (all.includes(el) ? all : [...all, el])), []);
  const remove = useCallback((el: HTMLElement) => setPlates((all) => (all.includes(el) ? all.filter((o) => o !== el) : all)), []);
  const here = plates[0] ?? null;
  const host = useMemo(() => ({ here, add, remove }), [here, add, remove]);
  return <PlateContext.Provider value={host}>{children}</PlateContext.Provider>;
}

/** The plate's place for the play control, if the post has drawn a plate. */
export const usePlateHere = (): HTMLElement | null => useContext(PlateContext)?.here ?? null;

/**
 * One deliberate piece of glass an effect draws into its `slot`: a chamfered plate attached to the post, outside its
 * 2003 chrome, on the `effect` smoke in the card's alignment's border and glow (the owner on #80's shots: "less
 * focused and intentional than it could be"; board 06's How loud row is the idiom, and section 5's chamfer is the
 * shape). Its head is a readout, the card's name and `readout`, the state the card has to say; the rest is the
 * card's words and its controls, which it draws as `kb-plate-tile`s (cards.css), and the post's play control stands
 * among them while a card is armed. Nothing is drawn until the slot is there. What it holds is the card's: the
 * engine fixes only where it stands and the shape it is.
 */
export function EffectStrip({ slot, card, readout, children }: { readonly slot: HTMLElement | null; readonly card: string; readonly readout?: ReactNode; readonly children: ReactNode }) {
  const { instance } = useKayfa();
  const calm = useSurfaceStyle('effect');
  const host = useContext(PlateContext);
  const add = host?.add;
  const remove = host?.remove;
  /* The plate's place for the play control is the post's while the plate is drawn, and no longer. A ref's null does not say which element left, so each plate remembers its own. */
  const mine = useRef<HTMLElement | null>(null);
  const place = useCallback((el: HTMLElement | null) => {
    if (el) { mine.current = el; add?.(el); } else if (mine.current) { remove?.(mine.current); mine.current = null; }
  }, [add, remove]);
  if (!slot) return null;
  const rules = instance.cards.find((c) => c.key === card);
  return createPortal(
    <div className="kb-glass kb-effect-strip" data-kb-card={card} data-kb-alignment={rules?.alignment} style={calm}>
      <div className="kb-effect-plate kb-glass-cut-dialog">
        <Smoke surface="effect" />
        <div className="kb-effect-plate-in kb-calm">
          <p className="kb-plate-head">
            <span className="kb-plate-name kb-glass-display">{rules?.name ?? card}</span>
            {readout}
          </p>
          {children}
          <div className="kb-plate-here" ref={place} />
        </div>
      </div>
    </div>,
    slot,
  );
}

/** The thread's narrow width (thread.css's 40em, where a post is stacked): the tags fold their chips into "+N more" there, and a play's panel is a sheet. */
const NARROW = '(max-width: 40em)';
/* One query for the page, however many posts ask it, with one listener behind every post's subscription; asked again only if the window's `matchMedia` is another. */
let narrowQuery: { readonly from: typeof globalThis.matchMedia; readonly list: MediaQueryList } | null = null;
const narrowWatchers = new Set<() => void>();
const queryOf = (): MediaQueryList | null => {
  const from = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia : null;
  if (!from) return null;
  if (narrowQuery?.from !== from) {
    const list = from(NARROW);
    list.addEventListener?.('change', () => { for (const w of [...narrowWatchers]) w(); });
    narrowQuery = { from, list };
  }
  return narrowQuery.list;
};
const watchNarrow = (changed: () => void) => {
  narrowWatchers.add(changed);
  return () => { narrowWatchers.delete(changed); };
};
/** Whether the window is at the thread's narrow width; a screen with no `matchMedia` is wide. */
export const useNarrow = (): boolean => useSyncExternalStore(watchNarrow, () => queryOf()?.matches ?? false, () => false);

/** Chips a desktop shows after the tag before "+N more". */
export const CHIPS_SHOWN = 3;
/** Reactions a tag shows, small. */
export const TAG_REACTIONS = 3;

/** How many reactions a play has drawn, in one phrase ("no reactions", "1 reaction", "8 reactions"). */
export const reactionCount = (n: number): string => (n === 0 ? 'no reactions' : n === 1 ? '1 reaction' : `${n} reactions`);

/** A play as a screen reader hears its tag or chip: one sentence. */
export const playSentence = (card: string, caster: string, reactions: number): string => `${card} by ${caster}, ${reactionCount(reactions)}. Opens the play.`;

/** A play's ink, where its card chooses one (`CardUi.tag`), given all of this card's plays on the post in play order. */
export const inkOf = (ui: { readonly cards: readonly CardUi[] }, play: CardPlay, plays: readonly CardPlay[]): string | undefined =>
  ui.cards.find((c) => c.key === play.card)?.tag?.(play, plays.filter((o) => o.card === play.card));

/** The glass's style for a play: the `effect` smoke's, and the card's ink for its border and glow where it chose one. */
const tinted = (calm: CSSProperties | undefined, ink: string | undefined): CSSProperties | undefined => (ink ? { ...calm, '--kb-tag': ink } as CSSProperties : calm);

/**
 * One play as the quiet tag the top-billed play gets (design, section 3): the card's name, its caster, and at most its
 * three top reactions, small, from the public tally, or none (#79). It is a button that opens the play's panel; the
 * message, when, React and Spin are the panel's. A card that chooses its tag's ink (`CardUi.tag`) gives the glass that
 * ink for its border and glow, as the Main board draws the tag over #41; the smoke and the glass's own text stay.
 */
export function PlayTag({ play, caster, tint, tallies, onOpen, expanded }: {
  readonly play: CardPlay; readonly caster: string; readonly tint?: string; readonly tallies: Tallies;
  readonly onOpen: (opener: HTMLButtonElement) => void; readonly expanded?: boolean;
}) {
  const { instance } = useKayfa();
  const rules = instance.cards.find((c) => c.key === play.card);
  const card = rules?.name ?? play.card;
  const calm = useSurfaceStyle('effect');
  const tally = useTally(tallies, play.id);
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  /* The largest first, a tie going to the instance's own order of its reactions. */
  const top = instance.reactions
    .map((r, i) => ({ r, i, n: tally[r.key] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, TAG_REACTIONS);
  return (
    <button
      type="button" className="kb-glass kb-play-tag" data-kb-card={play.card} data-kb-alignment={rules?.alignment} data-kb-tinted={tint ? 'true' : undefined}
      data-kb-play={play.id} style={tinted(calm, tint)} aria-haspopup="dialog" aria-expanded={expanded ?? false} onClick={(e) => onOpen(e.currentTarget)}
    >
      <Smoke surface="effect" />
      {/* One sentence to hear; the drawn pieces are for the eye. */}
      <span className="kb-visually-hidden">{playSentence(card, caster, total)}</span>
      <span className="kb-play-tag-in kb-calm" aria-hidden="true">
        <span className="kb-play-tag-card">{card}</span>
        <span className="kb-play-tag-who">{caster}</span>
        {top.length > 0 && (
          <span className="kb-play-tag-reactions">
            {top.map(({ r, n }) => <span key={r.key} data-kb-reaction={r.key}>{r.emoji} {n}</span>)}
          </span>
        )}
      </span>
    </button>
  );
}

/** One play after the first, as a chip in its card's color (its alignment's, or the ink its card chose): a mark, its caster and the card's name. */
function PlayChip({ play, caster, tint, tallies, onOpen, expanded }: {
  readonly play: CardPlay; readonly caster: string; readonly tint?: string; readonly tallies: Tallies;
  readonly onOpen: (opener: HTMLButtonElement) => void; readonly expanded: boolean;
}) {
  const { instance } = useKayfa();
  const rules = instance.cards.find((c) => c.key === play.card);
  const card = rules?.name ?? play.card;
  const tally = useTally(tallies, play.id);
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  return (
    <button
      type="button" className="kb-play-chip" data-kb-card={play.card} data-kb-alignment={rules?.alignment} data-kb-tinted={tint ? 'true' : undefined}
      data-kb-play={play.id} style={tint ? { '--kb-tag': tint } as CSSProperties : undefined} aria-haspopup="dialog" aria-expanded={expanded} onClick={(e) => onOpen(e.currentTarget)}
    >
      <span className="kb-visually-hidden">{playSentence(card, caster, total)}</span>
      <span className="kb-play-chip-in" aria-hidden="true"><i className="kb-play-chip-mark" />{caster} · {card}</span>
    </button>
  );
}

/**
 * The plays on a post, quiet (design, section 3): the top-billed play as its tag, then the rest as chips in billing
 * order, up to `CHIPS_SHOWN` on a desktop and none at the thread's narrow width, then "+N more", a disclosure that shows
 * the rest in place until the page is read again. Billing is the store's, set when the page was read, so nothing here
 * moves while it is read. Each tag and chip opens its play; nothing at all is drawn where there are no plays. `to` is
 * the post's own address, which the play's panel leads back to as "Go to post"; `nameOf` says the caster's name.
 */
export function PlayTags({ plays, post, to, nameOf, tallies, mine, onSpin }: {
  readonly plays: Plays; readonly post: Id; readonly to: string | null; readonly nameOf: (character: Id | null) => string;
  readonly tallies: Tallies; readonly mine: Mine;
  /** Spin a thread from a play: the panel has closed, and the post opens its spin form for it, giving focus back to `opener` when the form closes. */
  readonly onSpin: (play: CardPlay, name: string, opener: HTMLElement) => void;
}) {
  const { ui } = useKayfa();
  const here = usePlays(plays, post);
  const narrow = useNarrow();
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<{ readonly play: Id; readonly opener: HTMLButtonElement } | null>(null);
  /* A read of the page closes what was opened on it, before it is drawn again. */
  const [seen, setSeen] = useState(here.read);
  if (seen !== here.read) { setSeen(here.read); setMore(false); setOpen(null); }
  if (here.billed.length === 0) return null;
  const [lead, ...rest] = here.billed;
  const shown = more ? rest : rest.slice(0, narrow ? 0 : CHIPS_SHOWN);
  const hidden = rest.length - (narrow ? 0 : Math.min(rest.length, CHIPS_SHOWN));
  const opener = (play: Id) => (el: HTMLButtonElement) => setOpen((was) => (was?.play === play ? null : { play, opener: el }));
  const opened = open ? here.plays.find((p) => p.id === open.play) ?? null : null;
  return (
    <ul className="kb-play-tags" aria-label="Cards played on this post">
      <li className="kb-play-tags-lead">
        <PlayTag play={lead!} caster={nameOf(lead!.caster)} tint={inkOf(ui, lead!, here.plays)} tallies={tallies} onOpen={opener(lead!.id)} expanded={open?.play === lead!.id} />
      </li>
      {shown.map((p) => (
        <li key={p.id}>
          <PlayChip play={p} caster={nameOf(p.caster)} tint={inkOf(ui, p, here.plays)} tallies={tallies} onOpen={opener(p.id)} expanded={open?.play === p.id} />
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <button
            type="button" className="kb-play-more" aria-expanded={more} onClick={() => setMore(!more)}
            aria-label={more ? 'Show fewer cards played on this post' : `Show ${hidden} more ${hidden === 1 ? 'card' : 'cards'} played on this post`}
          ><span className="kb-play-chip-in">{more ? 'Fewer' : `+${hidden} more`}</span></button>
        </li>
      )}
      {open && opened && (
        <PlayPanel
          play={opened} caster={nameOf(opened.caster)} tint={inkOf(ui, opened, here.plays)} plays={plays} tallies={tallies} mine={mine} to={to}
          sheet={narrow} opener={open.opener} onClose={() => setOpen(null)}
          onSpin={(play, name) => { const from = open.opener; setOpen(null); onSpin(play, name, from); }}
        />
      )}
    </ul>
  );
}
