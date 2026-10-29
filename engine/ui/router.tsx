/**
 * The screens' addresses: a path, a query and a fragment, on the History API. Small on purpose: a
 * screen links with <Link>, reads where it is with useLocation(), and moves with navigate().
 *
 * No address carries the HUD's character or any of the player's characters but the one a page is
 * about (a profile's): an address is shared, bookmarked and sent as a Referer, and a character in
 * it would say which masks one browser plays (the web plan, "What could vary with a private fact").
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

export interface Location {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly hash: string;
}

interface Router {
  readonly location: Location;
  readonly navigate: (to: string, options?: { readonly replace?: boolean }) => void;
}

const RouterContext = createContext<Router | null>(null);

const read = (w: Window): Location => ({ path: w.location.pathname, query: new URLSearchParams(w.location.search), hash: w.location.hash.replace(/^#/, '') });

/** The router over the window's own history. */
export function RouterProvider({ children, window: w = globalThis.window }: { readonly children: ReactNode; readonly window?: Window }) {
  const [location, setLocation] = useState(() => read(w));
  useEffect(() => {
    const onPop = () => setLocation(read(w));
    w.addEventListener('popstate', onPop);
    return () => w.removeEventListener('popstate', onPop);
  }, [w]);
  const navigate = useCallback((to: string, options?: { readonly replace?: boolean }) => {
    const url = new URL(to, w.location.href);
    if (url.origin !== w.location.origin) { w.location.assign(url.href); return; }
    if (options?.replace) w.history.replaceState(null, '', url.pathname + url.search + url.hash);
    else w.history.pushState(null, '', url.pathname + url.search + url.hash);
    setLocation(read(w));
  }, [w]);
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
export function Link({ to, replace, onClick, ...rest }: { readonly to: string; readonly replace?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useNavigate();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={to} onClick={click} {...rest} />;
}
