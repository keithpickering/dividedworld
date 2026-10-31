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

interface Entry { readonly kind: string; readonly el: HTMLElement }

export interface CalloutStore {
  /** Whether this registered mark is the page's one callout now. */
  chosen(id: string): boolean;
  /** Listen for a change in whether `id` is the chosen mark. */
  subscribe(id: string, listener: () => void): () => void;
  /** Offer a mark; the returned function withdraws it. */
  register(id: string, kind: string, el: HTMLElement): () => void;
  /** The kind was met (Got it, or the card's first use): hide it now and tell the account once. */
  meet(kind: string): void;
  /** What the page read: the kinds met, or null where nothing is remembered (a visitor, or before the read). */
  setMet(met: readonly string[] | null): void;
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
  const first = (a: Entry | undefined, b: Entry) => (!a || (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ? b : a);
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
    register(id, kind, el) {
      entries.set(id, { kind, el });
      /* Compared with the chosen mark alone; the page's other marks are not looked at. */
      if (shows(kind)) {
        const cur = current ? entries.get(current) : undefined;
        if (!cur || first(cur, entries.get(id)!) !== cur) choose(id);
      }
      return () => { entries.delete(id); if (current === id) { current = null; scan(); } };
    },
    meet(kind) {
      if (!shows(kind)) return;
      hidden.add(kind);
      scan();
      void Promise.resolve(meetCard(kind)).catch(() => {});
    },
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
  return <CalloutCtx.Provider value={store}>{children}</CalloutCtx.Provider>;
}

export const useCalloutStore = (): CalloutStore => useContext(CalloutCtx);

/** The effect's `met()`, for one card on this page: stable, and a no-op once the kind is met. */
export function useMeet(card: string): () => void {
  const store = useCalloutStore();
  return useCallback(() => store.meet(card), [store, card]);
}

/**
 * A mark offers itself for the callout when its card gives a hint. Answers the bubble's id while this mark is the page's
 * one, else null; the mark names it as its description.
 */
export function useCallout(kind: string, hint: string | undefined, el: RefObject<HTMLElement | null>): string | null {
  const store = useCalloutStore();
  const id = useId();
  useEffect(() => {
    if (!hint || !el.current) return;
    return store.register(id, kind, el.current);
  }, [store, id, kind, hint, el]);
  const subscribe = useCallback((l: () => void) => store.subscribe(id, l), [store, id]);
  const mine = useSyncExternalStore(subscribe, () => store.chosen(id), () => false);
  return mine ? `${id}-callout` : null;
}

/** The bubble: out of the page's flow, a sibling of the mark and never inside its button. */
export function Callout({ id, kind, name, hint }: { readonly id: string; readonly kind: string; readonly name: string; readonly hint: string }) {
  const store = useCalloutStore();
  return (
    <div className="kb-glass kb-callout kb-glass-cut-panel" role="note" id={id} data-kb-callout={kind}>
      <p className="kb-callout-name kb-glass-display">{name}</p>
      <p className="kb-callout-hint">{hint}</p>
      <button type="button" className="kb-callout-got kb-glass-skew" onClick={() => store.meet(kind)}><b className="kb-glass-upright">Got it</b></button>
    </div>
  );
}
