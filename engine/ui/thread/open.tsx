/**
 * The thread the player has open, for the HUD (the HUD reveal design, section 1). The HUD sits in the
 * Frame, outside every page, and must not know which route is a thread: the thread's own screen says
 * so here, and the HUD reads it from the hook, never from the route's path or document. It is the
 * thread's summary in three fields, which is what the Reveal overlay starts on and what a move to My
 * characters carries in the navigation's state. A thread of The System's board is never published
 * (a meta act is not made there), and a screen clears its thread when it goes; a newer thread
 * replaces an older one, so the last screen to publish is the one the HUD names.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Id } from '../data/api.ts';

export interface OpenThread { readonly id: Id; readonly title: string; readonly board: Id }

type Show = (owner: symbol, t: OpenThread | null) => void;

/* Two contexts: the setter is stable for the Frame's life, so a thread's screen (which only sets) never re-renders when the open thread changes; the value changes with it, and the HUD alone reads it. */
const OpenThreadValue = createContext<OpenThread | null>(null);
const OpenThreadSetter = createContext<Show | null>(null);

export function OpenThreadProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<{ readonly owner: symbol | null; readonly open: OpenThread | null }>({ owner: null, open: null });
  /* A screen clears only what it published: the one arriving has published already when the one leaving clears. */
  const show = useCallback<Show>((owner, t) => setState((s) => (t ? { owner, open: t } : s.owner === owner ? { owner: null, open: null } : s)), []);
  return (
    <OpenThreadSetter.Provider value={show}>
      <OpenThreadValue.Provider value={state.open}>{children}</OpenThreadValue.Provider>
    </OpenThreadSetter.Provider>
  );
}

/** The thread the player has open, or null: off a thread, on The System's board, or outside a Frame. */
export function useOpenThread(): OpenThread | null {
  return useContext(OpenThreadValue);
}

/** A thread's screen says which thread it shows (null where none is offered); it is cleared when the screen goes. */
export function useShowOpenThread(t: OpenThread | null): void {
  const show = useContext(OpenThreadSetter);
  const owner = useRef<symbol>(Symbol('open-thread'));
  const id = t?.id ?? null;
  const title = t?.title ?? null;
  const board = t?.board ?? null;
  useEffect(() => {
    if (!show) return undefined;
    const me = owner.current;
    show(me, id !== null && title !== null && board !== null ? { id, title, board } : null);
    return () => show(me, null);
  }, [show, id, title, board]);
}
