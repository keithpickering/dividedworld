/**
 * The screens' addresses: a path, a query and a fragment, on the History API. Small on purpose: a
 * screen links with <Link>, reads where it is with useLocation(), and moves with navigate().
 *
 * No address carries the HUD's character or any of the player's characters but the one a page is
 * about (a profile's): an address is shared, bookmarked and sent as a Referer, and a character in
 * it would say which masks one browser plays (the web plan, "What could vary with a private fact").
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export interface Location {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly hash: string;
  /** Reached by the browser's back or forward, whose own scroll restoration is left to it. */
  readonly popped: boolean;
  /**
   * What the navigation carried in history.state: a choice a page should open with that no address may
   * hold (a character of the player's own). It stays in this browser's history; no server log or Referer sees it.
   */
  readonly state: unknown;
}

interface Router {
  readonly location: Location;
  readonly navigate: (to: string, options?: { readonly replace?: boolean; readonly state?: unknown }) => void;
}

const RouterContext = createContext<Router | null>(null);

const read = (w: Window, popped = false): Location => ({ path: w.location.pathname, query: new URLSearchParams(w.location.search), hash: w.location.hash.replace(/^#/, ''), popped, state: w.history.state });

/**
 * Told of every move, from the location shown to the one about to be: `from` is null for the
 * document's first. It is called before the screens change, so the page moved from is still drawn
 * and can be measured (the glass's Back keeps the board's place this way, engine/ui/glass/back.ts).
 * A popstate is told as it arrives, before the browser restores the scroll of the entry it reached.
 */
export type OnMove = (from: Location | null, to: Location) => void;

/** The router over the window's own history. */
export function RouterProvider({ children, window: w = globalThis.window, onMove }: { readonly children: ReactNode; readonly window?: Window; readonly onMove?: OnMove }) {
  const [location, setLocation] = useState(() => read(w));
  /* What is shown, for the next move's `from`, and the latest onMove, so a new one does not re-subscribe. */
  const shown = useRef(location);
  const moved = useRef(onMove);
  moved.current = onMove;
  const show = useCallback((to: Location) => {
    moved.current?.(shown.current, to);
    shown.current = to;
    setLocation(to);
  }, []);
  useEffect(() => { moved.current?.(null, shown.current); }, []);
  useEffect(() => {
    const onPop = () => show(read(w, true));
    w.addEventListener('popstate', onPop);
    return () => w.removeEventListener('popstate', onPop);
  }, [w, show]);
  const navigate = useCallback((to: string, options?: { readonly replace?: boolean; readonly state?: unknown }) => {
    // An in-app navigation never leaves the site: an address that resolves elsewhere (a stray `next`,
    // a link built from text) is the index. A <Link> to another site is left to the browser instead.
    let url = new URL(to, w.location.href);
    if (url.origin !== w.location.origin) url = new URL('/', w.location.href);
    const same = url.pathname + url.search + url.hash === w.location.pathname + w.location.search + w.location.hash;
    if (options?.replace || same) w.history.replaceState(options?.state ?? null, '', url.pathname + url.search + url.hash);
    else w.history.pushState(options?.state ?? null, '', url.pathname + url.search + url.hash);
    /* The address has moved and the page has not: pushState scrolls nothing and draws nothing. */
    show(read(w));
  }, [w, show]);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter(): Router {
  const r = useContext(RouterContext);
  if (!r) throw new Error('a screen is rendered inside a RouterProvider');
  return r;
}

export function useLocation(): Location {
  return useRouter().location;
}

export function useNavigate(): Router['navigate'] {
  return useRouter().navigate;
}

/** A link that moves within the app without a reload; a modified click opens as the browser would. */
export function Link({ to, replace, state, onClick, ...rest }: { readonly to: string; readonly replace?: boolean; readonly state?: unknown } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useNavigate();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target || rest.download !== undefined) return;
    if (new URL(to, window.location.href).origin !== window.location.origin) return;
    e.preventDefault();
    navigate(to, { replace, state });
  };
  return <a href={to} onClick={click} {...rest} />;
}
