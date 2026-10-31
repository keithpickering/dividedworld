/**
 * The Lens (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 2): the one floating glass panel a post's marks
 * open, where the cards played on it say what they are doing and who played them. It replaces #97's play panel (a modal
 * overlay over one play) and every card's plate under the post.
 *
 * Its tabs are the post's card kinds in the marks' order (a `tablist`; the arrow keys move between them and only the open
 * tab is a Tab stop). For the open tab it draws three rows, the same for every card:
 *  - State: the card's view of itself (`CardView`): what it is doing, how it ends and, where a save did not get through, why;
 *    a card with no effect says its `summary` (`defaultView`).
 *  - Act: the view's controls, drawn by the kit (Kit.tsx), so every card's Lens looks, sizes and reads alike.
 *  - Who: folded until opened ("3 plays · Gloomba, Pipewrench, Mrs. Hooligan"), then one row per play (`PlayRow`): #97's
 *    panel content for a play, an Act like a post, reacted to and spun from on its own. A card whose rules stack lists its
 *    rows by layer, top first, since which layer a stroke washes is what the rows explain; every other card in billing order.
 *    Every play of the kind has its row, so each can be reacted to, spun from and gone to.
 *
 * It is not modal (glass/Float.tsx): it dims and blocks nothing and makes nothing inert, so the ink can be scrubbed with it
 * open; a press on the post leaves it open. It closes by Esc, its ×, its mark again, another post's Lens, or leaving the
 * page, and focus goes back to the mark. One is open on a page (`LensProvider`); a post subscribes to whether it is the
 * one, so opening a Lens redraws two posts and not the page. It reads nothing when it opens: the reactions and the spins
 * were read with the page (thread/Thread.tsx `prepare`).
 *
 * Where it renders is `useLensHost()`: the page's body, or the host a takeover gives (a card that carries the post's marks
 * lifts the post out of the thread and hosts the Lens beside it, Task 5 of the plan). The glow is the wrapper's drop
 * shadow (Float.tsx), in the open tab's ink.
 */
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { Float, type FloatPlace } from '../glass/Float.tsx';
import { tabbables } from '../modal.tsx';
import { usePlayer } from '../player.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import type { Mine } from '../reactions/mine.ts';
import { Link } from '../router.tsx';
import { spunCount, useSpunInto } from '../spin/spun.ts';
import { when } from '../thread/lines.tsx';
import type { Tallies } from '../thread/tallies.ts';
import { inkOf, useNarrow } from './Effects.tsx';
import { withCardEconomy } from './faces.ts';
import { Kit } from './Kit.tsx';
import { kindsOf, playsPhrase, sumOf } from './marks.ts';
import { defaultView, inPlayOrder, useCardView, usePlays, type Plays } from './plays.ts';
import type { CardPlay, CardView } from './types.ts';
import './lens.css';

/** A play's name, as its row is named and the spin form says it: "Mrs. Hooligan's Whoops!". */
export const playName = (caster: string, card: string): string => `${caster}'s ${card}`;

/** The Lens open on the page: whose strip opened it (`owner`), which tab, and the mark it gives focus back to. */
export interface LensOpen {
  readonly owner: string;
  readonly card: string;
  readonly opener: HTMLElement;
}

export interface LensStore {
  get(): LensOpen | null;
  subscribe(listener: () => void): () => void;
  /** Open this tab for this strip; its own open tab again closes it, and another strip's Lens is closed by it. */
  toggle(next: LensOpen): void;
  /** Move the open Lens to another tab. */
  select(card: string): void;
  close(): void;
}

function createLensStore(): LensStore {
  let open: LensOpen | null = null;
  const listeners = new Set<() => void>();
  const set = (next: LensOpen | null) => {
    if (next === open) return;
    open = next;
    for (const l of [...listeners]) l();
  };
  return {
    get: () => open,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggle(next) { set(open?.owner === next.owner && open.card === next.card ? null : next); },
    select(card) { if (open && open.card !== card) set({ ...open, card }); },
    close() { set(null); },
  };
}

const LensCtx = createContext<LensStore | null>(null);
/** Where the Lens renders when no takeover gives a host: the page's body. A takeover wraps what it hosts in this provider with its own element. */
export const LensHostCtx = createContext<HTMLElement | null>(null);

/** Where the Lens renders now: the nearest takeover's host, else the page's body. */
export const useLensHost = (): HTMLElement => useContext(LensHostCtx) ?? document.body;

/**
 * A takeover's view puts this around its content, naming an element inside its dialog (null while the element is not there yet):
 * the Lens a mark inside it opens renders there, so it stands inside the view's focus scope and is not made inert with the page.
 */
export function LensHost({ host, children }: { readonly host: HTMLElement | null; readonly children: ReactNode }) {
  return <LensHostCtx.Provider value={host}>{children}</LensHostCtx.Provider>;
}

/** One Lens for the page below: the thread, or a thread's ORIGIN box inside it. Leaving the page closes it. */
export function LensProvider({ children }: { readonly children: ReactNode }) {
  const store = useMemo(createLensStore, []);
  useEffect(() => () => store.close(), [store]);
  return <LensCtx.Provider value={store}>{children}</LensCtx.Provider>;
}

/* Marks drawn where no page gave a provider (a story that draws a post alone) share one store: a document has one Lens in any case. */
let loose: LensStore | null = null;

export function useLensStore(): LensStore {
  return useContext(LensCtx) ?? (loose ??= createLensStore());
}

/** Whether a control can be seen, and so focused: not `display: none`, `visibility: hidden` or inert, itself or in an ancestor. */
function shown(el: HTMLElement): boolean {
  if (el.closest('[inert]')) return false;
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  for (let n: HTMLElement | null = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

/** The Lens as this strip has it open, or null: a strip is redrawn when its own Lens opens or closes, and by no other post's. */
export function useLensFor(store: LensStore, owner: string): LensOpen | null {
  const snapshot = useCallback(() => { const o = store.get(); return o?.owner === owner ? o : null; }, [store, owner]);
  return useSyncExternalStore(store.subscribe, snapshot, () => null);
}

/** A card's view on a post: the one its effect gave, else the engine's default for the card (its `summary`, no edge, no controls). */
export function useResolvedView(store: Plays, post: Id, kind: string): CardView {
  const { instance, settings, ui } = useKayfa();
  const given = useCardView(store, post, kind);
  const economy = useMemo(() => withCardEconomy(instance.settings, settings.cardEconomy), [instance.settings, settings.cardEconomy]);
  const fallback = useMemo(
    () => defaultView({ name: instance.cards.find((c) => c.key === kind)?.name ?? kind }, ui.cards.find((c) => c.key === kind), economy),
    [instance.cards, ui.cards, kind, economy],
  );
  return given ?? fallback;
}

/** Whether this play has more public reactions than the post: a boolean, so only a change in the answer draws the row again. */
function useMoreThanPost(tallies: Tallies, play: Id, post: Id, compare: boolean): boolean {
  const subscribe = useCallback((changed: () => void) => {
    if (!compare) return () => {};
    const off = [tallies.subscribe(play, changed), tallies.subscribe(post, changed)];
    return () => { for (const o of off) o(); };
  }, [tallies, play, post, compare]);
  return useSyncExternalStore(subscribe, () => compare && sumOf(tallies.get(play)) > sumOf(tallies.get(post)));
}

function Spun({ play }: { readonly play: Id }) {
  const spun = useSpunInto(play);
  const n = spunCount(spun);
  if (n === 0) return null;
  return (
    <div className="kb-lens-spun">
      <p>{n === 1 ? '1 thread' : `${n}${spun.atLeast ? ' or more' : ''} threads`} spun from this play</p>
      <ul>
        {spun.threads.map((t) => <li key={t.id}><Link to={`/t/${t.id}`}>{t.title}</Link></li>)}
      </ul>
      {spun.more > 0 && <p>and {spun.more}{spun.atLeast ? ' or more' : ''} more</p>}
    </div>
  );
}

interface RowProps {
  readonly play: CardPlay;
  readonly caster: string;
  readonly card: string;
  readonly view: CardView;
  readonly tallies: Tallies;
  readonly mine: Mine;
  readonly compare: boolean;
  /** The post the play landed on, where Go to post leads; none where it cannot be found. */
  readonly to: string | null;
  readonly onSpin: (play: CardPlay, name: string) => void;
}

/**
 * One play, in the Who row: #97's panel content (who played it and when, the caster's words, the play's reactions with
 * React, Spin thread with the threads spun from it, Go to post) with the card's note for the play, and "More reactions than the post"
 * where the play has drawn more public reactions than the post it landed on. It is a sign and not the settlement's word:
 * nothing here says a play "outdraws" anything, or that anyone won. The reader's own play says "Your play" in place of React
 * (decided on the reader's screen from their own characters, as the post's reactions decide it).
 */
function PlayRow({ play, caster, card, view, tallies, mine, compare, to, onSpin }: RowProps) {
  const { characters } = usePlayer();
  const name = playName(caster, card);
  const note = view.notes[play.id];
  const more = useMoreThanPost(tallies, play.id, play.post, compare);
  const yours = play.caster !== null && characters.some((c) => c.id === play.caster);
  /* In a Lens a takeover hosts, the page is inert behind it: the spin form opens there, where it cannot be used. */
  const hosted = useLensHost() !== document.body;
  return (
    <li className="kb-lens-row" data-kb-play={play.id}>
      <p className="kb-lens-by kb-calm"><span className="kb-lens-who kb-glass-display">{caster}</span> · played <time dateTime={play.playedAt}>{when(play.playedAt)}</time></p>
      {play.message && <blockquote className="kb-lens-message">“{play.message}”</blockquote>}
      {note && <p className="kb-lens-note kb-calm">{note}</p>}
      {more && <p className="kb-lens-more">More reactions than the post</p>}
      {yours && <p className="kb-lens-yours">Your play</p>}
      <Reactions act={play.id} author={play.caster} authorName={caster} subject={name} tallies={tallies} mine={mine} look="glass" />
      <div className="kb-lens-actions">
        {hosted
          ? <p className="kb-lens-note">Spin a thread from this play once you are free of the hold.</p>
          : <button type="button" className="kb-glass-cut-button kb-lens-action" onClick={() => onSpin(play, name)}>Spin thread</button>}
        {to && <Link className="kb-glass-cut-button kb-lens-action" to={to}>Go to post</Link>}
      </div>
      <Spun play={play.id} />
    </li>
  );
}

const NAMES_SHOWN = 3;

/** Whether Who is unfolded is the Lens's, so it stays as it is when the tab changes and starts folded with the next Lens. */
function Who({ plays, nameOf, card, unfolded, onToggle, ...row }: Omit<RowProps, 'play' | 'caster'> & {
  readonly plays: readonly CardPlay[]; readonly nameOf: (character: Id | null) => string; readonly unfolded: boolean; readonly onToggle: () => void;
}) {
  const id = useId();
  const casters = [...new Set(plays.map((p) => nameOf(p.caster)))];
  const shown = casters.slice(0, NAMES_SHOWN).join(', ');
  const rest = casters.length - NAMES_SHOWN;
  return (
    <div className="kb-lens-section kb-lens-who-section">
      <button type="button" className="kb-lens-fold" aria-expanded={unfolded} aria-controls={id} onClick={onToggle}>
        <span className="kb-lens-fold-sign" aria-hidden="true">{unfolded ? '▾' : '▸'}</span>
        {playsPhrase(plays.length)} · {shown}{rest > 0 ? ` and ${rest} more` : ''}
      </button>
      <ul id={id} className="kb-lens-rows" hidden={!unfolded}>
        {unfolded && plays.map((p) => <PlayRow key={p.id} {...row} card={card} play={p} caster={nameOf(p.caster)} />)}
      </ul>
    </div>
  );
}

export interface LensProps {
  readonly open: LensOpen;
  readonly store: LensStore;
  /** The post the marks are on (the id its plays are kept under). */
  readonly post: Id;
  readonly plays: Plays;
  readonly tallies: Tallies;
  readonly mine: Mine;
  readonly compare: boolean;
  readonly to: string | null;
  readonly nameOf: (character: Id | null) => string;
  /** The strip of marks the Lens opened from: where the mark of its kind (or the "+N" that hides it) is found again if the mark that opened it has left the page. */
  readonly strip?: () => HTMLElement | null;
  /** Spin a thread from a play: the Lens has closed. */
  readonly onSpin: (play: CardPlay, name: string, opener: HTMLElement) => void;
}

export function Lens({ open, store, post, plays, tallies, mine, compare, to, nameOf, strip, onSpin }: LensProps) {
  const { instance, ui } = useKayfa();
  const here = usePlays(plays, post);
  const narrow = useNarrow();
  const host = useLensHost();
  const kinds = kindsOf(here.billed);
  const card = kinds.includes(open.card) ? open.card : null;
  /* The kind's plays are gone (a read of the page moved them): there is nothing to show. */
  useEffect(() => { if (card === null) store.close(); }, [card, store]);
  const view = useResolvedView(plays, post, open.card);
  const ids = useId();
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  /*
   * The anchor is live: the mark that opened the Lens can leave the page (a strip that narrows folds it into "+N", one that widens
   * unfolds "+N" into it), so it is the opener while that is on the page, else the strip's mark for this kind, else its "+N".
   */
  const live = useRef({ open, strip });
  live.current = { open, strip };
  const anchor = useMemo(() => ({
    get current(): HTMLElement | null {
      const { open: o, strip: s } = live.current;
      if (o.opener.isConnected) return o.opener;
      const root = s?.() ?? null;
      const marks = [...(root?.querySelectorAll<HTMLElement>('.kb-mark') ?? [])];
      return marks.find((m) => m.getAttribute('data-kb-card') === o.card) ?? marks.find((m) => m.classList.contains('kb-mark-more')) ?? marks[0] ?? null;
    },
  }), []);
  const beside = useMemo(() => ({ get current(): HTMLElement | null { return anchor.current?.closest<HTMLElement>('article, .kb-origin') ?? null; } }), [anchor]);
  const [unfolded, setUnfolded] = useState(false);
  /* Esc and × are a deliberate close: focus goes back to the mark whatever held it (a press on the post moves it to the post). */
  const dismiss = () => {
    store.close();
    queueMicrotask(() => { anchor.current?.focus(); });
  };
  const [placed, setPlaced] = useState<FloatPlace>(narrow ? 'sheet' : 'side');
  /* On open, focus moves to the open tab. */
  useLayoutEffect(() => { tabs.current.get(open.card)?.focus({ preventScroll: true }); }, []);
  if (card === null) return null;

  const rules = instance.cards.find((c) => c.key === card);
  const cardUi = ui.cards.find((c) => c.key === card);
  const name = rules?.name ?? card;
  const ofKind = here.billed.filter((p) => p.card === card);
  const ink = inkOf(ui, ofKind[0]!, [...ofKind].sort(inPlayOrder)) ?? cardUi?.art.color;
  /* A card whose rules stack lists its rows by layer, top first; any other in billing order. */
  const rowPlays = (rules?.stack ?? 1) > 1 ? [...ofKind].sort(inPlayOrder).reverse() : ofKind;
  const tabId = (kind: string) => `${ids}-tab-${kind}`;
  const panelId = `${ids}-panel`;

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = kinds.indexOf(card);
    const to_ = e.key === 'ArrowRight' ? (at + 1) % kinds.length : e.key === 'ArrowLeft' ? (at - 1 + kinds.length) % kinds.length : e.key === 'Home' ? 0 : e.key === 'End' ? kinds.length - 1 : -1;
    if (to_ < 0) return;
    e.preventDefault();
    const next = kinds[to_]!;
    store.select(next);
    tabs.current.get(next)?.focus();
  };

  /*
   * The Lens is drawn at the end of the body, so Tab would carry a reader out of the page from its last control, and Shift+Tab into
   * the page's last element from its first. Past its last control Tab goes to the element after the mark that opened it; before
   * its first, Shift+Tab goes back to the mark. The Lens stays open either way. (Keys typed in a picker opened from a row arrive
   * here too, through React's tree, and are the picker's.)
   */
  const leave = (e: KeyboardEvent<HTMLDivElement>) => {
    const box = e.currentTarget;
    if (e.key !== 'Tab' || e.defaultPrevented || !(e.target instanceof Node) || !box.contains(e.target)) return;
    const stops = tabbables(box);
    const mark = anchor.current;
    if (stops.length === 0 || !mark) return;
    const at = document.activeElement;
    if (e.shiftKey && at === stops[0]) {
      e.preventDefault();
      mark.focus();
    } else if (!e.shiftKey && at === stops[stops.length - 1]) {
      /* A control the page hides (a collapsed section) cannot take focus, so the first one after the mark that can be seen is the one. */
      const next = tabbables(document.body).find((el) => !box.contains(el) && !mark.contains(el) && (mark.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && shown(el));
      if (next) {
        next.focus();
        if (document.activeElement === next) e.preventDefault();
      }
    }
  };

  return (
    <Float
      label="Cards on this post" surface="effect" anchor={anchor} beside={beside} sheet={narrow} host={host}
      returnFocusTo={() => anchor.current} onClose={dismiss} onPlace={setPlaced} onKeyDown={leave} className="kb-lens"
      style={ink ? ({ '--kb-lens-ink': ink } as CSSProperties) : undefined}
      wrapStyle={{ '--kb-float-glow': 'var(--kb-lens-ink)' } as CSSProperties}
      data={{ 'kb-lens': placed, 'kb-card': card, 'kb-alignment': rules?.alignment, 'kb-tinted': ink ? 'true' : undefined }}
    >
      <div className="kb-lens-bar">
        <div className="kb-lens-tabs" role="tablist" aria-label="Card kinds" onKeyDown={move}>
          {kinds.map((kind) => {
            const label = instance.cards.find((c) => c.key === kind)?.name ?? kind;
            const selected = kind === card;
            return (
              <button
                key={kind} ref={(el) => { if (el) tabs.current.set(kind, el); else tabs.current.delete(kind); }}
                type="button" role="tab" id={tabId(kind)} className="kb-lens-tab kb-glass-display kb-calm" aria-selected={selected} aria-controls={selected ? panelId : undefined}
                tabIndex={selected ? 0 : -1} data-kb-card={kind} onClick={() => store.select(kind)}
              >{label}</button>
            );
          })}
        </div>
        <button type="button" className="kb-glass-cut-button kb-lens-close" aria-label="Close" onClick={dismiss}><span aria-hidden="true">×</span></button>
      </div>
      <div className="kb-lens-body" role="tabpanel" id={panelId} aria-labelledby={tabId(card)}>
        <div className="kb-lens-section kb-lens-state">
          <p className="kb-lens-line">{view.state}</p>
          {view.ends && <p className="kb-lens-ends">{view.ends}</p>}
          {view.report && <p className="kb-lens-report">{view.report}</p>}
        </div>
        {view.controls.length > 0 && (
          <div className="kb-lens-section kb-lens-act"><Kit card={name} controls={view.controls} ink={ink} /></div>
        )}
        <Who
          plays={rowPlays} unfolded={unfolded} onToggle={() => setUnfolded((u) => !u)} nameOf={nameOf} card={name} view={view} tallies={tallies} mine={mine} compare={compare} to={to}
          onSpin={(play, spinName) => { store.close(); onSpin(play, spinName, open.opener); }}
        />
      </div>
    </Float>
  );
}
