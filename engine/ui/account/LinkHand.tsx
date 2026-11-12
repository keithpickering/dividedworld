/**
 * The emailed link in hand, kept in memory above the routed screen. A press that signs an account in changes the session's account, and the
 * app then starts the routed screen afresh for it (web/src/App.tsx, Shell): the screen that comes back reads an address that has already lost
 * its fragment, so what the old one held (the token, and whether this page's press signed in) lives here, in this provider's own React
 * state: no history entry, no storage, no address, and nothing outside the provider, so it dies with it and is never shared between worlds,
 * tests or stories. A screen with no provider above it keeps its link in its own state and holds nothing across a fresh start.
 *
 * The hand is kept only for the page it was held for: the provider sees every move of the address and drops it on a move to any other.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation } from '../router.tsx';
import { tokenHashOf } from './link.ts';

interface Hand { tokenHash: string | null; pressed: boolean; path: string | null }

export interface LinkHandApi {
  /** What a screen starts with. Pure: the address's token if it carries one (a new visit, which replaces what was held), else the one held for this page. */
  readonly read: (hash: string, path: string) => { readonly tokenHash: string | null; readonly pressed: boolean };
  /** The screen holds its link for this page (a token other than the held one is a new link, not yet pressed), or sets it aside (null). */
  readonly hold: (tokenHash: string | null, path: string) => void;
  /** Whether a press of the held link has signed in (or is signing in). */
  readonly setPressed: (pressed: boolean) => void;
}

const LinkHandContext = createContext<LinkHandApi | null>(null);

/** The hand a screen may use, or null where no provider is above it. */
export function useLinkHand(): LinkHandApi | null {
  return useContext(LinkHandContext);
}

export function LinkHandProvider({ children }: { readonly children: ReactNode }) {
  const { path } = useLocation();
  const hand = useRef<Hand>({ tokenHash: null, pressed: false, path: null });
  const read = useCallback<LinkHandApi['read']>((hash, at) => {
    const fresh = tokenHashOf(hash);
    if (fresh !== null) return { tokenHash: fresh, pressed: false };
    const h = hand.current;
    return h.path === at && h.tokenHash !== null ? { tokenHash: h.tokenHash, pressed: h.pressed } : { tokenHash: null, pressed: false };
  }, []);
  const hold = useCallback<LinkHandApi['hold']>((tokenHash, at) => {
    const h = hand.current;
    if (tokenHash === null) { hand.current = { tokenHash: null, pressed: false, path: null }; return; }
    hand.current = { tokenHash, pressed: h.tokenHash === tokenHash && h.path === at ? h.pressed : false, path: at };
  }, []);
  const setPressed = useCallback<LinkHandApi['setPressed']>((pressed) => {
    if (hand.current.tokenHash !== null) hand.current.pressed = pressed;
  }, []);
  /* Any move of the address to another page drops the link. */
  useEffect(() => { if (hand.current.path !== path) hand.current = { tokenHash: null, pressed: false, path: null }; }, [path]);
  const api = useMemo<LinkHandApi>(() => ({ read, hold, setPressed }), [read, hold, setPressed]);
  return <LinkHandContext.Provider value={api}>{children}</LinkHandContext.Provider>;
}
