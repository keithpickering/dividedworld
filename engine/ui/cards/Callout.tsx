/**
 * The first-time callout (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 5): a small glass bubble off the
 * page's first mark of a card kind the reader has not met, saying the card's name in the display face, its one-line
 * `CardUi.hint` and "Got it". It replaces the hint Whoops! used to show on every plate forever.
 *
 * Met is the account's own (`Preferences.cardsMet`, read with the page's preferences and handed to `CalloutProvider`),
 * so a visitor, who has no account to remember it on, sees none. A callout goes away on "Got it", or when the card's
 * effect reports its first use (`EffectProps.met`); both call `meetCard` once and hide it at once, and a write that fails
 * leaves it hidden for the page and unmet on the account, so the next read shows it again.
 *
 * "At a busy instance's scale": one page shows one callout at most, for the kind whose first mark comes first in the
 * page's reading order. Marks do not subscribe to a shared value that wakes every post: each eligible mark (a hint, an
 * unmet kind) registers with the page's store, which keeps the one that is first in document order and tells only the
 * mark that stops being it and the mark that becomes it. Registering a mark compares it with the chosen one alone.
 * Nothing in the bubble is in the page's flow (marks.css), and it is no live region and holds no focus: "Got it" is the
 * next control after the mark in tab order, and Escape and every other key are left to the page.
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import { useLensHost } from './Lens.tsx';

interface Entry { readonly kind: string; readonly el: HTMLElement; readonly held: boolean }

export interface CalloutStore {
  /** Whether this registered mark is the page's one callout now. */
  chosen(id: string): boolean;
  /** Listen for a change in whether `id` is the chosen mark. */
  subscribe(id: string, listener: () => void): () => void;
  /** Offer a mark; the returned function withdraws it. */
  register(id: string, kind: string, el: HTMLElement, held?: boolean): () => void;
  /** The kind was met (Got it, or the card's first use): hide it now and tell the account once. */
  meet(kind: string): void;
  /** What the page read: the kinds met, or null where nothing is remembered (a visitor, or before the read). */
  setMet(met: readonly string[] | null): void;
  /** The page is going (or back): marks withdrawing while it goes need no rescan. */
  closing(closing: boolean): void;
}

type Meet = (card: string) => Promise<unknown>;

export function createCalloutStore(meetCard: Meet): CalloutStore {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  let met: ReadonlySet<string> | null = null;
  /* Kinds hidden on this page, whether or not the account took the write: a failed write is tried again on the next read. */
  const hidden = new Set<string>();
  let current: string | null = null;
  const shows = (kind: string) => met !== null && !met.has(kind) && !hidden.has(kind);
  let closing = false;
  /*
   * Which of two marks holds the callout: a mark in a takeover's view (`held`, Stick Around's hold) over the page's, which
   * is inert under it; a mark not inert over one that is; then the earlier in document order.
   */
  const first = (a: Entry | undefined, b: Entry) => {
    if (!a) return b;
    if (a.held !== b.held) return a.held ? a : b;
    const ia = a.el.closest('[inert]') !== null;
    const ib = b.el.closest('[inert]') !== null;
    if (ia !== ib) return ia ? b : a;
    return (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ? b : a;
  };
  const wake = (id: string | null) => { if (id) for (const l of [...(listeners.get(id) ?? [])]) l(); };
  const choose = (next: string | null) => { if (next === current) return; const was = current; current = next; wake(was); wake(next); };
  const scan = () => {
    let best: [string, Entry] | undefined;
    for (const [id, e] of entries) if (shows(e.kind) && (!best || first(best[1], e) === e)) best = [id, e];
    choose(best?.[0] ?? null);
  };
  return {
    chosen: (id) => current === id,
    subscribe(id, listener) {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => { set.delete(listener); if (set.size === 0) listeners.delete(id); };
    },
    register(id, kind, el, held = false) {
      entries.set(id, { kind, el, held });
      /* Compared with the chosen mark alone; the page's other marks are not looked at. */
      if (shows(kind)) {
        const cur = current ? entries.get(current) : undefined;
        if (!cur || first(cur, entries.get(id)!) !== cur) choose(id);
      }
      return () => { entries.delete(id); if (current === id) { current = null; if (!closing) scan(); } };
    },
    meet(kind) {
      if (!shows(kind)) return;
      hidden.add(kind);
      scan();
      void Promise.resolve(meetCard(kind)).catch(() => {});
    },
    closing(next) { closing = next; },
    setMet(next) {
      const was = met;
      met = next === null ? null : new Set(next);
      if (was === null && met === null) return;
      scan();
    },
  };
}

const inert: CalloutStore = createCalloutStore(async () => {});
const CalloutCtx = createContext<CalloutStore>(inert);

/** One callout for the page below. `met` is the kinds the signed-in account has met; null for a visitor, or while it is not read. */
export function CalloutProvider({ met, children }: { readonly met: readonly string[] | null; readonly children: ReactNode }) {
  const { api } = useKayfa();
  const apiRef = useRef(api);
  apiRef.current = api;
  const store = useMemo(() => createCalloutStore((card) => apiRef.current.meetCard(card)), []);
  /* A layout effect runs before any mark's passive one, so a mark registering finds the answer. */
  useLayoutEffect(() => { store.setMet(met); }, [store, met]);
  /* Parents' cleanups run before their children's: the marks leaving with the page do not each rescan it. */
  useLayoutEffect(() => { store.closing(false); return () => store.closing(true); }, [store]);
  return <CalloutCtx.Provider value={store}>{children}</CalloutCtx.Provider>;
}

export const useCalloutStore = (): CalloutStore => useContext(CalloutCtx);

/** The effect's `met()`, for one card on this page: stable, and a no-op once the kind is met. */
export function useMeet(card: string): () => void {
  const store = useCalloutStore();
  const { ui } = useKayfa();
  /* A card with no hint has no callout to hide, and its key is not spent on the account's 64. */
  const hinted = ui.cards.find((c) => c.key === card)?.hint !== undefined;
  return useCallback(() => { if (hinted) store.meet(card); }, [store, card, hinted]);
}

/**
 * A mark offers itself for the callout when its card gives a hint. Answers the id of the bubble's hint (what the mark is described by) while this mark is the page's
 * one, else null; the mark names it as its description.
 */
export function useCallout(kind: string, hint: string | undefined, el: RefObject<HTMLElement | null>): string | null {
  const store = useCalloutStore();
  const id = useId();
  const held = useLensHost() !== document.body;
  useEffect(() => {
    if (!hint || !el.current) return;
    return store.register(id, kind, el.current, held);
  }, [store, id, kind, hint, el, held]);
  const subscribe = useCallback((l: () => void) => store.subscribe(id, l), [store, id]);
  const mine = useSyncExternalStore(subscribe, () => store.chosen(id), () => false);
  return mine ? `${id}-hint` : null;
}

/**
 * The bubble: out of the page's flow, a sibling of the mark and never inside its button. `id` is the hint's, which the mark
 * is described by. Its outer box carries the glow, since a clip-path would cut it off the chamfered panel inside.
 */
export function Callout({ id, kind, name, hint }: { readonly id: string; readonly kind: string; readonly name: string; readonly hint: string }) {
  const store = useCalloutStore();
  const box = useRef<HTMLDivElement>(null);
  const got = () => {
    /* The bubble goes with the press, so focus goes back to the mark it hung from (the sibling before it). */
    const mark = box.current?.previousElementSibling;
    if (mark instanceof HTMLElement) mark.focus();
    store.meet(kind);
  };
  return (
    <div className="kb-callout" ref={box} role="note" data-kb-callout={kind}>
      <div className="kb-callout-panel kb-glass kb-glass-cut-panel">
        <p className="kb-callout-name kb-glass-display">{name}</p>
        <p className="kb-callout-hint" id={id}>{hint}</p>
        <button type="button" className="kb-callout-got kb-glass-skew" onClick={got}><b className="kb-glass-upright">Got it</b></button>
      </div>
    </div>
  );
}
