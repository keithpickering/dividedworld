/**
 * The Lens (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 2): the one floating glass panel a post's marks
 * open, where the cards played on it say what they are doing and who played them. It replaces #97's play panel (a modal
 * overlay over one play) and every card's plate under the post.
 *
 * Its tabs are the post's card kinds in the marks' order (a `tablist`; the arrow keys move between them and only the open
 * tab is a Tab stop). For the open tab it draws three rows, the same for every card:
 *  - State: the card's view of itself (`CardView`): a short status of what it is doing to this reader now, the line under it
 *    for how it ends and, where a save did not get through, why; a card with no effect says its `status` (`defaultView`).
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
import type { Act, Id, PlayMoment, Visit, VisitEnd } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Float, type FloatPlace } from '../glass/Float.tsx';
import { CloseCross, DialogBar } from '../glass/Frame.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { tabbables } from '../modal.tsx';
import { usePlayer } from '../player.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import type { Mine } from '../reactions/mine.ts';
import { Link } from '../router.tsx';
import { spunCount, useSpunInto } from '../spin/spun.ts';
import { when } from '../thread/lines.tsx';
import type { Tallies } from '../thread/tallies.ts';
import { inkOf, useSheet, useUntil } from './Effects.tsx';
import { withCardEconomy } from './faces.ts';
import { Kit } from './Kit.tsx';
import { backWords, CAUGHT_STATE, caughtWords, endedWords, kindsOf, playsPhrase, sumOf, wardWords } from './marks.ts';
import { defaultView, inPlayOrder, isBack, markedPlays, shownPlays, useCardView, usePlays, type Plays } from './plays.ts';
import type { CardPlay, CardView } from './types.ts';
import { VisitPanel } from './Visit.tsx';
import { APPEAL_KIND, AppealForm, REPORT_KIND, ReportForm, formTabName, type LensForm } from './Forms.tsx';
import { VISIT_KIND, tabName, visitState } from './visit.ts';
import './lens.css';
import './visit.css';
import { Layers } from '../glass/layer.tsx';

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
  /**
   * The play whose moment the page shows (As it landed), or null. One shows on a page at a time, and it goes with its Lens: every
   * change of the open Lens (another strip's, or closed) clears it.
   */
  moment(): Id | null;
  /** Show this play's moment in its post's body, in place of another's; null shows the post as it is now (Back to now). */
  showMoment(play: Id | null): void;
  /** A moment read for the page, by play (undefined while it is not read): read once, since a moment never changes. */
  kept(play: Id): PlayMoment | null | undefined;
  /**
   * Read a play's moment for the page with `load`, once: a read already on its way is not sent again, and its answer is kept even if
   * the moment was hidden meanwhile. A failed read keeps nothing, and the promise rejects, so it can be asked again.
   */
  readMoment(play: Id, load: () => Promise<PlayMoment | null>): Promise<void>;
}

function createLensStore(): LensStore {
  let open: LensOpen | null = null;
  let shown: Id | null = null;
  const moments = new Map<Id, PlayMoment | null>();
  const reading = new Map<Id, Promise<void>>();
  const listeners = new Set<() => void>();
  const wake = () => { for (const l of [...listeners]) l(); };
  const set = (next: LensOpen | null) => {
    if (next === open) return;
    /* Another strip's Lens, or none: the moment goes with the Lens it was shown from. A tab of the same Lens keeps it. */
    if (next === null || next.owner !== open?.owner) shown = null;
    open = next;
    wake();
  };
  return {
    get: () => open,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggle(next) { set(open?.owner === next.owner && open.card === next.card ? null : next); },
    select(card) { if (open && open.card !== card) set({ ...open, card }); },
    close() { set(null); },
    moment: () => shown,
    showMoment(play) { if (play !== shown) { shown = play; wake(); } },
    kept: (play) => moments.get(play),
    readMoment(play, load) {
      if (moments.has(play)) return Promise.resolve();
      const was = reading.get(play);
      if (was) return was;
      const read = load().then((m) => { moments.set(play, m); wake(); }).finally(() => reading.delete(play));
      reading.set(play, read);
      return read;
    },
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

/** Whether the reader is an admin, as the page knows it (`api.isAdmin`): only an admin's Lens offers "End this card". */
const LensAdminCtx = createContext(false);
export const useLensAdmin = (): boolean => useContext(LensAdminCtx);

/** One Lens for the page below: the thread, or a thread's ORIGIN box inside it. Leaving the page closes it. `admin` is what the page knows of the reader. */
export function LensProvider({ children, admin = false }: { readonly children: ReactNode; readonly admin?: boolean }) {
  const store = useMemo(createLensStore, []);
  useEffect(() => () => store.close(), [store]);
  return <LensCtx.Provider value={store}><LensAdminCtx.Provider value={admin}>{children}</LensAdminCtx.Provider></LensCtx.Provider>;
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

/**
 * A card's view on a post: the one its effect gave, else the engine's default for the card (its `summary`, no edge, no controls).
 * The card mechanic's kinds are the engine's to say (docs/plans/2026-11-01-card-plays-plan.md, Task 7): a card back says who set it
 * and when it ends, the same for every card face down, and on the setter's own screen which card it is; a ward says what it turns
 * away and until when; a caught play's note says what caught it.
 */
export function useResolvedView(store: Plays, post: Id, kind: string, nameOf?: (character: Id | null) => string): CardView {
  const { instance, settings, ui } = useKayfa();
  const given = useCardView(store, post, kind);
  /*
   * What this kind's words read of the post, as one string: its plays (who, when, caught by what, ending when, revealed as what) and
   * the setter's own faces among them. A change elsewhere on the post leaves it equal, so a mark of another kind is not drawn again.
   */
  const subscribe = useCallback((l: () => void) => store.subscribe(post, l), [store, post]);
  const signature = useSyncExternalStore(subscribe, () => {
    const h = store.get(post);
    return JSON.stringify(h.plays.filter((p) => p.card === kind).map((p) => [p.id, p.caster, p.playedAt, p.caught ?? null, p.ends ?? null, p.revealed ?? null, h.faces[p.id] ?? null,
      p.caught ? h.plays.find((b) => b.id === p.caught)?.revealed?.card ?? null : null, p.reversed ?? null]));
  });
  const here = useMemo(() => {
    const rows = JSON.parse(signature) as [Id, Id | null, string, Id | null, string | null, CardPlay['revealed'] | null, string | null, string | null, true | null][];
    return {
      plays: rows.map(([id, caster, playedAt, caught, ends, revealed, , , reversed]): CardPlay => ({ id, card: kind, layer: 1, caster, message: '', config: {}, playedAt, post, ...(isBack(kind) ? { faceDown: true as const } : {}), ...(caught ? { caught } : {}), ...(ends ? { ends } : {}), ...(revealed ? { revealed } : {}), ...(reversed ? { reversed: true as const } : {}) })),
      faces: Object.fromEntries(rows.filter((r) => r[6] !== null).map((r) => [r[0], r[6]!])) as Record<Id, string>,
      traps: Object.fromEntries(rows.filter((r) => r[7] !== null).map((r) => [r[0], r[7]!])) as Record<Id, string>,
    };
  }, [signature, kind, post]);
  const economy = useMemo(() => withCardEconomy(instance.settings, settings.cardEconomy), [instance.settings, settings.cardEconomy]);
  const fallback = useMemo(() => {
    const cardName = (key: string) => instance.cards.find((c) => c.key === key)?.name ?? key;
    const ofKind = here.plays.filter((p) => p.card === kind);
    if (isBack(kind) && ofKind.length > 0) {
      const say = (p: CardPlay) => backWords(p, nameOf?.(p.caster) ?? 'someone', instance.settings.setLasts, cardName);
      const yours = (p: CardPlay) => (here.faces[p.id] ? `Yours: ${cardName(here.faces[p.id]!)}, which nobody else can see.` : '');
      const first = say(ofKind[0]!);
      return { progress: null, state: first.state, ends: first.ends, yours: false, controls: [], notes: Object.fromEntries(ofKind.map((p) => [p.id, [say(p).note, yours(p)].filter((w) => w !== '').join(' ')])) };
    }
    const rules = instance.cards.find((c) => c.key === kind);
    /* A play beyond a post ends on its timer: the view's way out says when, the latest of the kind's (each is drawn until its own). */
    const latestEnd = ofKind.filter((p) => !p.caught && !p.reversed && p.ends !== undefined).map((p) => p.ends!).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    const base = defaultView({ name: rules?.name ?? kind }, ui.cards.find((c) => c.key === kind), economy, latestEnd, ofKind.filter((p) => !p.caught && !p.reversed));
    const caught = Object.fromEntries(ofKind.filter((p) => p.caught).map((p) => {
      const trap = here.traps[p.id];
      return [p.id, caughtWords(trap ? cardName(trap) : null)];
    }));
    /* A play an admin ended says so, in plain words; its layer is off for everyone. */
    for (const p of ofKind) if (p.reversed) caught[p.id] = endedWords();
    const live = ofKind.filter((p) => !p.caught && !p.reversed);
    if (live.length === 0 && ofKind.length > 0 && ofKind.every((p) => p.reversed)) return { ...base, progress: null, controls: [], state: endedWords(), notes: caught };
    if (live.length === 0 && ofKind.length > 0) {
      return { ...base, state: CAUGHT_STATE, notes: caught };
    }
    if (rules?.ward && live.length > 0) {
      const latest = [...live].sort((a, b) => Date.parse(b.ends ?? '') - Date.parse(a.ends ?? ''))[0]!;
      const ward = wardWords(rules.rarity, latest.ends);
      return { ...base, state: ward.state, ...(ward.ends ? { ends: ward.ends } : {}), notes: caught };
    }
    return Object.keys(caught).length > 0 ? { ...base, notes: caught } : base;
  }, [instance.cards, instance.settings.setLasts, ui.cards, kind, economy, here, nameOf]);
  /* Every play of the kind ended by an admin: its effect draws nothing, so whatever view it last gave is stale. */
  const allEnded = here.plays.length > 0 && here.plays.every((p) => p.reversed);
  if (!given || allEnded) return fallback;
  /* An effect's own view, with the catches the engine knows of beside its notes. */
  return Object.keys(fallback.notes).length > 0 && !isBack(kind) ? { ...given, notes: { ...fallback.notes, ...given.notes } } : given;
}

/** Where the strip of tabs has more past its edges: `start` (scrolled off at the left), `end`, both, or none (all of it in view). */
export type TabFade = 'none' | 'start' | 'end' | 'both';
export function fadeOf(el: { readonly scrollLeft: number; readonly clientWidth: number; readonly scrollWidth: number }): TabFade {
  const start = el.scrollLeft > 1;
  const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

/** Whether a scrolling part has more below what it shows: the fade at the Lens's foot is there only while it has. A scroll position can be fractional (zoom), so it is rounded up: at the end it never reads as one px short. */
export const moreBelow = (el: { readonly scrollTop: number; readonly clientHeight: number; readonly scrollHeight: number }): boolean => Math.ceil(el.scrollTop) + el.clientHeight < el.scrollHeight;

/** A tab's name: the card's, or for the card backs, "Card back", and the card it was once one has sprung. */
export function kindName(instance: { readonly cards: readonly { readonly key: string; readonly name: string }[] }, kind: string, plays: readonly CardPlay[]): string {
  if (!isBack(kind)) return instance.cards.find((c) => c.key === kind)?.name ?? kind;
  /* A sprung back is a kind of its own, one back; a live kind's backs name no card. */
  const sprung = plays.find((p) => p.card === kind && p.revealed);
  return sprung ? instance.cards.find((c) => c.key === sprung.revealed!.card)?.name ?? 'Card back' : 'Card back';
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
  /** The play's ink (`CardUi.tag`), drawn as the bar at the row's left edge where the card chooses one. */
  readonly ink?: string | undefined;
  readonly card: string;
  readonly view: CardView;
  readonly tallies: Tallies;
  readonly mine: Mine;
  readonly compare: boolean;
  /** The post the play landed on, where Go to post leads; none where it cannot be found. */
  readonly to: string | null;
  readonly onSpin: (play: CardPlay, name: string) => void;
  /** The store the play is kept in: an admin's end is added to it at once, so the layer comes off without waiting for the broadcast. */
  readonly store: Plays;
  /** The reader is an admin (what the page knows): a face-up play still in force offers "End this card". */
  readonly admin: boolean;
  /** Now, as the Lens counts it (it moves when a play's end passes). */
  readonly now: number;
  /** Whether each play on a post offers As it landed: not where the moment is already the content (a play-spun ORIGIN box). */
  readonly moments: boolean;
}

/**
 * One play, in the Who row: #97's panel content (who played it and when, the caster's words, the play's reactions with
 * React, Spin thread with the threads spun from it, Go to post) with the card's note for the play, and "More reactions than the post"
 * where the play has drawn more public reactions than the post it landed on. It is a sign and not the settlement's word:
 * nothing here says a play "outdraws" anything, or that anyone won. The reader's own play says "Your play" in place of React
 * (decided on the reader's screen from their own characters, as the post's reactions decide it).
 */
/**
 * As it landed: shows the play's moment in its post's body, in place of the live body, and pressed again shows the post as it is now
 * (docs/plans/2026-11-03-effect-history-design.md, section 4). One moment shows on the page, and it goes with this Lens.
 */
function AsItLanded({ play }: { readonly play: Id }) {
  const store = useLensStore();
  const pressed = useSyncExternalStore(store.subscribe, () => store.moment() === play, () => false);
  return (
    <button type="button" className="kb-kit-tile kb-lens-action" aria-pressed={pressed} onClick={() => store.showMoment(pressed ? null : play)}>
      <span className="kb-kit-tile-label">As it landed</span>
    </button>
  );
}

/**
 * The confirm of an admin's "End this card" (api.reverseCard), shared by the Lens and the admin queue: it says what it does in plain
 * words, then makes the call. A refusal's words are shown in the dialog, which stays open. The card's own name and its caster's public
 * name come from the caller, so the engine names no instance's card. `onEnded` gets the card_end's id once the play is ended.
 */
export function EndCardDialog({ play, card, caster, onClose, onEnded, returnFocusTo }: {
  readonly play: Id; readonly card: string; readonly caster: string;
  readonly onClose: () => void; readonly onEnded: (end: Id) => void | Promise<void>; readonly returnFocusTo: () => HTMLElement | null;
}) {
  const { api } = useKayfa();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const once = useRef(false);
  const submit = async () => {
    if (once.current) return;
    once.current = true;
    setBusy(true);
    setRefusal(null);
    let ended: Id | null = null;
    try {
      const answer = await api.reverseCard(play);
      if (!answer.ok) { setRefusal(answer.error); return; }
      ended = answer.value.act;
    } catch {
      setRefusal('That could not be sent. Check your connection and look at the card before you try again.');
    } finally {
      once.current = false;
      setBusy(false);
    }
    /* Outside the try: the card has ended, so what the screen does next (a reload) never reads as a failed send. */
    if (ended !== null) await Promise.resolve(onEnded(ended)).catch(() => undefined);
  };
  return (
    <Overlay title="End this card?" surface="settings" className="kb-lens-end" onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="kb-lens-end-body">
        <p>End this {card} by {caster}? Its layer comes off for everyone, and nothing is refunded.</p>
        {refusal && <p role="alert" className="kb-lens-end-refusal">{refusal}</p>}
        <ButtonRow align="end">
          <GlassButton onClick={onClose}>Cancel</GlassButton>
          <GlassButton kind="primary" disabled={busy} onClick={() => void submit()}>End it</GlassButton>
        </ButtonRow>
      </div>
    </Overlay>
  );
}

/** An admin's "End this card" in the Lens: the button, and the shared confirm. */
function EndCard({ play, card, caster, store }: { readonly play: Id; readonly card: string; readonly caster: string; readonly store: Plays }) {
  const opener = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const close = () => setAsking(false);
  return (
    <>
      <button ref={opener} type="button" className="kb-kit-tile kb-lens-action" aria-haspopup="dialog" onClick={() => setAsking(true)}><span className="kb-kit-tile-label">End this card</span></button>
      <Layers>
      {asking && (
        <EndCardDialog
          play={play} card={card} caster={caster} onClose={close}
          onEnded={(endId) => {
            const end: Act = { id: endId, character: null, kind: 'card_end', thread: '', targetActId: play, seq: null, createdAt: new Date().toISOString(), payload: { why: 'reversed', by: 'admin' }, currentPayload: {}, editedAt: null, shownEditedAt: null };
            store.add([end]);
            setAsking(false);
          }}
          returnFocusTo={() => (opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('.kb-lens [role="tab"][aria-selected="true"]'))}
        />
      )}
      </Layers>
    </>
  );
}

/** Whether a play is face up and still in force, so an admin can end it: not a back (`faceDown` is set for exactly the card backs, sprung or not), not caught, not ended by an admin, not worn off. */
const endable = (play: CardPlay, now: number): boolean =>
  !play.faceDown && play.caught === undefined && !play.reversed && !(play.ends !== undefined && Date.parse(play.ends) <= now);

function PlayRow({ play, caster, ink, card, view, tallies, mine, compare, to, moments, onSpin, store, admin, now }: RowProps) {
  const { characters } = usePlayer();
  const name = playName(caster, card);
  const note = view.notes[play.id];
  const more = useMoreThanPost(tallies, play.id, play.post, compare);
  const yours = play.caster !== null && characters.some((c) => c.id === play.caster);
  /* In a Lens a takeover hosts, the page is inert behind it: the spin form opens there, where it cannot be used. */
  const hosted = useLensHost() !== document.body;
  /* The foot is a grid of two columns whose wrappers take no box (lens.css), so how many tiles it holds (the React meta tile among the kit tiles) is read from the page: an odd last one spans both. */
  const foot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = foot.current;
    if (!el) return undefined;
    const count = () => {
      const tiles = [...el.querySelectorAll<HTMLElement>('.kb-react-button, .kb-kit-tile')];
      tiles.forEach((t, i) => {
        const span = tiles.length % 2 === 1 && i === tiles.length - 1;
        if (span !== t.hasAttribute('data-kb-span')) { if (span) t.setAttribute('data-kb-span', ''); else t.removeAttribute('data-kb-span'); }
      });
    };
    count();
    if (typeof MutationObserver !== 'function') return undefined;
    const changed = new MutationObserver(count);
    changed.observe(el, { childList: true, subtree: true });
    return () => changed.disconnect();
  }, []);
  return (
    <li className="kb-lens-row" data-kb-play={play.id} style={ink ? ({ '--kb-play-ink': ink } as CSSProperties) : undefined}>
      {note && <p className="kb-lens-note">{note}</p>}
      <p className="kb-lens-by"><span className="kb-lens-who kb-glass-display">{caster}</span> · {play.faceDown ? 'set face down' : 'played'} <time dateTime={play.playedAt}>{when(play.playedAt)}</time></p>
      {play.message && <blockquote className="kb-lens-message">“{play.message}”</blockquote>}
      {more && <p className="kb-lens-more">More reactions than the post</p>}
      {yours && <p className="kb-lens-yours">Your play</p>}
      <div ref={foot} className="kb-lens-row-foot">
        <Reactions act={play.id} author={play.caster} authorName={caster} subject={name} tallies={tallies} mine={mine} pickerAt="button" />
        <div className="kb-lens-actions">
          {hosted
            ? <p className="kb-lens-note">Spin a thread from this play once you are free of the hold.</p>
            : <button type="button" className="kb-kit-tile kb-lens-action" onClick={() => onSpin(play, name)}><span className="kb-kit-tile-label">Spin thread</span></button>}
          {moments && !play.reach && <AsItLanded play={play.id} />}
          {admin && endable(play, now) && <EndCard play={play.id} card={card} caster={caster} store={store} />}
          {to && <Link className="kb-kit-tile kb-lens-action" to={to}><span className="kb-kit-tile-label">Go to post</span></Link>}
        </div>
      </div>
      <Spun play={play.id} />
    </li>
  );
}

const NAMES_SHOWN = 3;

/** Whether Who is unfolded is the Lens's, so it stays as it is when the tab changes and starts folded with the next Lens. */
function Who({ plays, nameOf, inkOfPlay, card, unfolded, onToggle, ...row }: Omit<RowProps, 'play' | 'caster' | 'ink'> & {
  /** The ink of each play, as the marks draw it. */
  readonly inkOfPlay: (play: CardPlay) => string | undefined;
  readonly plays: readonly CardPlay[]; readonly nameOf: (character: Id | null) => string; readonly unfolded: boolean; readonly onToggle: () => void;
}) {
  const id = useId();
  const casters = [...new Set(plays.map((p) => nameOf(p.caster)))];
  const shown = casters.slice(0, NAMES_SHOWN).join(', ');
  const rest = casters.length - NAMES_SHOWN;
  return (
    <div className="kb-lens-section kb-lens-who-section">
      <button type="button" className="kb-lens-fold" aria-expanded={unfolded} aria-controls={id} onClick={onToggle}>
        <span className="kb-lens-fold-sign" aria-hidden="true" />
        {playsPhrase(plays.length)} · {shown}{rest > 0 ? ` and ${rest} more` : ''}
      </button>
      <ul id={id} className="kb-lens-rows" hidden={!unfolded}>
        {unfolded && plays.map((p) => <PlayRow key={p.id} {...row} card={card} play={p} ink={inkOfPlay(p)} caster={nameOf(p.caster)} />)}
      </ul>
    </div>
  );
}

export interface LensProps {
  readonly open: LensOpen;
  /** What the marks are on, as the Lens is named for it: a post, or a character, a thread or a board. */
  readonly where?: string;
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
  /** Whether a play's row offers As it landed (true but where the moment is already shown: a play-spun ORIGIN box). */
  readonly moments?: boolean;
  /** The post's visit: a tab ahead of the card kinds (Visit.tsx), "On a visit" or how it ended. */
  readonly visit?: {
    readonly visit: Visit; readonly thread: Id; readonly author: Id | null;
    readonly onSpinAct: ((act: Id, name: string, opener: HTMLElement) => void) | undefined; readonly onEnded: (end: VisitEnd) => void;
  } | undefined;
  /** A form the panel is open on (Forms.tsx): a post's report or an appeal. It is the panel's one tab while it is open, and the cards' and the visit's are not offered with it. */
  readonly form?: LensForm | undefined;
}

export function Lens({ open, store, post, plays, tallies, mine, compare, to, nameOf, strip, onSpin, where = 'post', moments = true, visit, form }: LensProps) {
  const { instance, ui } = useKayfa();
  const here = usePlays(plays, post);
  const narrow = useSheet();
  const host = useLensHost();
  const now = useUntil(here.billed);
  const billed = markedPlays(shownPlays(here.billed, instance.settings.setLasts), now);
  const admin = useLensAdmin();
  const cardKinds = kindsOf(billed);
  /* A form is the panel's one tab while it is open; a visit's tab is ahead of the cards'. */
  const onForm = form !== undefined && open.card === form.kind;
  const kinds = useMemo(() => (onForm ? [form.kind] : visit ? [VISIT_KIND, ...cardKinds] : cardKinds), [onForm, form?.kind, visit, cardKinds.join('\u0000')]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = kinds.includes(open.card) ? open.card : null;
  const onVisit = !onForm && card === VISIT_KIND && visit !== undefined;
  /* The kind's plays are gone (a read of the page moved them): there is nothing to show. */
  useEffect(() => { if (card === null) store.close(); }, [card, store]);
  const view = useResolvedView(plays, post, open.card, nameOf);
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
  const [unfolded, setUnfolded] = useState(false);
  /* Esc and × are a deliberate close: focus goes back to the mark whatever held it (a press on the post moves it to the post). */
  const dismiss = () => {
    store.close();
    queueMicrotask(() => { anchor.current?.focus(); });
  };
  const [placed, setPlaced] = useState<FloatPlace>(narrow ? 'sheet' : 'dock');
  /* On open, focus moves to the open tab. */
  useLayoutEffect(() => { tabs.current.get(open.card)?.focus({ preventScroll: true }); }, []);
  /* A form opened over the tab that was open (Appeal, from the visit's tab) takes the control that was pressed with it: focus goes to the form's tab. */
  useLayoutEffect(() => { if (onForm) tabs.current.get(open.card)?.focus({ preventScroll: true }); }, [onForm, open.card]);
  /* The strip of tabs is one row that scrolls, with the current tab kept in view, and a fade at the edge where more wait. */
  const tabRow = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<TabFade>('none');
  useLayoutEffect(() => { tabs.current.get(card ?? '')?.scrollIntoView?.({ block: 'nearest', inline: 'center' }); }, [card]);
  useEffect(() => {
    const el = tabRow.current;
    if (!el) return undefined;
    const read = () => setFade(fadeOf(el));
    read();
    el.addEventListener('scroll', read, { passive: true });
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    resized?.observe(el);
    return () => { el.removeEventListener('scroll', read); resized?.disconnect(); };
  }, [card, kinds.length]);
  /* The body scrolls inside the panel; its foot fades while more lies below it (the box's `data-kb-more`). */
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = body.current;
    if (!el) return undefined;
    const read = () => setMore(moreBelow(el));
    read();
    el.addEventListener('scroll', read, { passive: true });
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    resized?.observe(el);
    /* What the body holds changes while it is open (a live play adds a row, a section unfolds): each child is watched as it comes, and the fade is read again. */
    const watched = new Set<Element>();
    const watch = () => { for (const child of el.children) if (!watched.has(child)) { watched.add(child); resized?.observe(child); } };
    watch();
    const changed = typeof MutationObserver === 'function' ? new MutationObserver(() => { watch(); read(); }) : null;
    changed?.observe(el, { childList: true, subtree: true });
    return () => { el.removeEventListener('scroll', read); resized?.disconnect(); changed?.disconnect(); };
  }, [card, unfolded, narrow]);
  if (card === null) return null;

  const rules = instance.cards.find((c) => c.key === card);
  const cardUi = ui.cards.find((c) => c.key === card);
  const name = onForm ? formTabName(form) : onVisit ? tabName(visitState(visit.visit)) : kindName(instance, card, here.plays);
  const ofKind = billed.filter((p) => p.card === card);
  const ink = onVisit || onForm ? 'var(--kb-visit-ink)' : inkOf(ui, ofKind[0]!, [...ofKind].sort(inPlayOrder)) ?? cardUi?.art.color;
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
      label={onForm ? (form.kind === REPORT_KIND ? `Report this ${where}` : `Appeal on this ${where}`) : visit ? (cardKinds.length === 0 ? `Visit to this ${where}` : `Visit and cards on this ${where}`) : `Cards on this ${where}`} surface="effect" anchor={anchor} keep={() => anchor.current?.closest<HTMLElement>('article, .kb-origin') ?? null} sheet={narrow} host={host}
      returnFocusTo={() => anchor.current} onClose={dismiss} onPlace={setPlaced} onKeyDown={leave} className="kb-lens"
      style={ink ? ({ '--kb-lens-ink': ink } as CSSProperties) : undefined}
      wrapStyle={{ '--kb-float-glow': 'var(--kb-lens-ink)' } as CSSProperties}
      data={{ 'kb-lens': placed, 'kb-card': card, 'kb-alignment': rules?.alignment, 'kb-tinted': ink ? 'true' : undefined, 'kb-more': more ? 'true' : 'false' }}
    >
      <DialogBar close={<CloseCross onClick={dismiss} />}>
        <div className="kb-lens-tabstrip" data-kb-fade={fade}>
        <div ref={tabRow} className="kb-lens-tabs" role="tablist" aria-label={onForm ? 'Form' : visit ? 'Visit and card kinds' : 'Card kinds'} onKeyDown={move}>
          {kinds.map((kind) => {
            const label = onForm ? formTabName(form) : kind === VISIT_KIND && visit ? tabName(visitState(visit.visit)) : kindName(instance, kind, here.plays);
            const selected = kind === card;
            return (
              <button
                key={kind} ref={(el) => { if (el) tabs.current.set(kind, el); else tabs.current.delete(kind); }}
                type="button" role="tab" id={tabId(kind)} className="kb-lens-tab kb-glass-skew" aria-selected={selected} aria-controls={selected ? panelId : undefined}
                tabIndex={selected ? 0 : -1} data-kb-card={kind} onClick={() => store.select(kind)}
              ><span className="kb-glass-upright">{label}</span></button>
            );
          })}
        </div>
        </div>
      </DialogBar>
      {/* Before the body: the body is the dialog's last child, which the frame's own checks lay their probes in. */}
      <div className="kb-lens-fade" aria-hidden="true" />
      <div ref={body} className="kb-lens-body" role="tabpanel" id={panelId} aria-labelledby={tabId(card)}>
        {onForm && form.kind === REPORT_KIND && <ReportForm post={form.post} seq={form.seq} />}
        {onForm && form.kind === APPEAL_KIND && <AppealForm infraction={form.infraction} visit={form.visit} nameOf={nameOf} />}
        {onVisit && (
          <VisitPanel
            visit={visit.visit} thread={visit.thread} author={visit.author} nameOf={nameOf} tallies={tallies} mine={mine} onEnded={visit.onEnded}
            onSpin={(act, label) => { store.close(); visit.onSpinAct?.(act, label, open.opener); }}
          />
        )}
        {!onVisit && !onForm && <div className="kb-lens-section kb-lens-state">
          <p className="kb-lens-line">{view.state}</p>
          {view.ends && <p className="kb-lens-ends">{view.ends}</p>}
          {view.report && <p className="kb-lens-report">{view.report}</p>}
        </div>}
        {!onVisit && !onForm && view.controls.length > 0 && (
          <div className="kb-lens-section kb-lens-act"><Kit card={name} controls={view.controls} ink={ink} /></div>
        )}
        {!onVisit && !onForm && <Who
          plays={rowPlays} inkOfPlay={(p) => inkOf(ui, p, [...ofKind].sort(inPlayOrder))} unfolded={unfolded} onToggle={() => setUnfolded((u) => !u)} nameOf={nameOf} card={name} view={view} tallies={tallies} mine={mine} compare={compare} to={to} moments={moments} store={plays} admin={admin} now={now}
          onSpin={(play, spinName) => { store.close(); onSpin(play, spinName, open.opener); }}
        />}
      </div>
    </Float>
  );
}
