/**
 * The screens' addresses: a path, a query and a fragment, on the History API. Small on purpose: a
 * screen links with <Link>, reads where it is with useLocation(), and moves with navigate().
 *
 * No address carries the HUD's character or any of the player's characters but the one a page is
 * about (a profile's): an address is shared, bookmarked and sent as a Referer, and a character in
 * it would say which masks one browser plays (the web plan, "What could vary with a private fact").
 *
 * A route may load before it moves (the forum-load design, sections 1, 5, 6): the router starts the route's
 * loader and leaves the page, and the address bar, as they are until the answer lands, then changes them together.
 * It also holds the prefetch answers and the history cache of loaded pages, both in memory only.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

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

type Params = Readonly<Record<string, string>>;

/** What the router needs to know of a route; `Route` in routes.tsx is this and the screen. */
export interface RouteLike {
  readonly path: string;
  readonly load?: (args: { readonly params: Params; readonly query: URLSearchParams; readonly hash: string; readonly signal: AbortSignal }) => Promise<unknown>;
  readonly key?: (params: Params, query: URLSearchParams) => string;
}

/** The params of a path against a pattern, or null when it does not match. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) {
      /* A malformed escape (a hand-typed %E0%A4%A) is an address that matches nothing, never a blank page. */
      try { params[seg.slice(1)] = decodeURIComponent(a[i]!); } catch { return null; }
    } else if (seg !== a[i]) return null;
  }
  return params;
}

/** Why a load shows an error page in place of the screen. */
export type Failure = 'display' | 'find';

/** What the screens draw: the location, the document its route loaded, and whether a load failed. */
export interface Shown {
  readonly location: Location;
  readonly doc: unknown;
  /** False only before the document's first page has landed (a first address whose route loads). */
  readonly ready: boolean;
  readonly failure: Failure | null;
  readonly route: RouteLike | null;
  readonly key: string | null;
}

export interface Navigation {
  /** The load a click is waiting on, for the meter and the cursor; null when none is out. */
  readonly pending: { readonly to: string; readonly startedAt: number } | null;
  /** How many reads a screen has handed to `track` that have not settled. */
  readonly tracking: number;
  /** A screen runs the meter for a read of its own within its key (a thread's next page). */
  readonly track: <T>(promise: Promise<T>) => Promise<T>;
}

interface Router {
  readonly location: Location;
  readonly shown: Shown;
  readonly navigate: (to: string, options?: { readonly replace?: boolean; readonly state?: unknown }) => void;
  readonly retry: () => void;
  readonly prefetch: (to: string) => void;
  readonly navigation: Navigation;
  readonly attach: (routes: readonly RouteLike[]) => void;
  readonly setAccount: (id: string | null) => void;
}

const RouterContext = createContext<Router | null>(null);

/**
 * A query as an address carries it: `?` and its text, or nothing when it is empty. It is read by its
 * text, since URLSearchParams.size is missing before Safari 17, where a test on it drops every query.
 */
export function searchOf(query: URLSearchParams): string {
  const text = String(query);
  return text ? `?${text}` : '';
}

/** A location's path and query, without its fragment: the address a link back to it is given. */
export function addressOf(l: Pick<Location, 'path' | 'query'>): string {
  return l.path + searchOf(l.query);
}

/*
 * A history entry of a route that loads carries { kb: entry key, state: the page's own state }, so the router
 * can find that entry's cached document again on Back. An entry of any other route carries the state as given,
 * and Location.state reads through either.
 */
interface Wrapped { readonly kb: string; readonly state: unknown }
const unwrap = (raw: unknown): { readonly kb: string | null; readonly state: unknown } => {
  if (typeof raw === 'object' && raw !== null && typeof (raw as Wrapped).kb === 'string' && 'state' in raw) return { kb: (raw as Wrapped).kb, state: (raw as Wrapped).state };
  return { kb: null, state: raw };
};
const wrap = (entry: string | null, state: unknown): unknown => (entry ? ({ kb: entry, state: state ?? null } satisfies Wrapped) : state ?? null);

const read = (w: Window, popped = false): Location => ({ path: w.location.pathname, query: new URLSearchParams(w.location.search), hash: w.location.hash.replace(/^#/, ''), popped, state: unwrap(w.history.state).state });

/**
 * Told of every move, from the location shown to the one about to be: `from` is null for the
 * document's first. It is called before the screens change, so the page moved from is still drawn
 * and can be measured (the glass's Back keeps the board's place this way, engine/ui/glass/back.ts).
 * A move that loads is told when its load lands, never at the click. A popstate is told as it arrives,
 * before the browser restores the scroll of the entry it reached.
 */
export type OnMove = (from: Location | null, to: Location) => void;

const LOAD_LIMIT_MS = 20_000;
const PREFETCH_KEPT_MS = 30_000;
const ENTRY_KEPT_MS = 5 * 60_000;
const ENTRIES_MAX = 20;

interface Pending { readonly id: number; readonly to: string; readonly controller: AbortController; readonly startedAt: number; account: string | null | undefined; readonly popped: boolean; readonly initial: boolean }
interface Prefetched { readonly promise: Promise<unknown>; readonly controller: AbortController; readonly timer: ReturnType<typeof setTimeout>; settledAt: number | null }
interface Entry { doc: unknown; scrollY: number; at: number }
type Outcome = { readonly kind: 'doc'; readonly doc: unknown } | { readonly kind: 'failure'; readonly failure: Failure } | { readonly kind: 'aborted' };
interface Request { readonly full: string; readonly replace?: boolean; readonly state?: unknown; readonly popped: boolean; readonly kb: string | null; readonly initial?: boolean }

const keyOf = (route: RouteLike, params: Params, query: URLSearchParams, path: string): string => (route.key ? route.key(params, query) : path + searchOf(query));

/** Starts a route's loader; a loader that throws before it returns a promise is a load that failed. */
function invoke(route: RouteLike, url: URL, params: Params, signal: AbortSignal): Promise<unknown> {
  try {
    return route.load!({ params, query: new URLSearchParams(url.search), hash: url.hash.replace(/^#/, ''), signal });
  } catch (e) {
    return Promise.reject(e);
  }
}

/** The router over the window's own history. */
export function RouterProvider({ children, window: w = globalThis.window, onMove }: { readonly children: ReactNode; readonly window?: Window; readonly onMove?: OnMove }) {
  const [shown, setShown] = useState<Shown>(() => ({ location: read(w), doc: undefined, ready: false, failure: null, route: null, key: null }));
  const [pending, setPending] = useState<Navigation['pending']>(null);
  const [tracking, setTracking] = useState(0);
  /* What is shown, for the next move's `from`, and the latest onMove, so a new one does not re-subscribe. */
  const shownRef = useRef(shown);
  const entryRef = useRef<string | null>(unwrap(w.history.state).kb);
  const pendingRef = useRef<Pending | null>(null);
  const routesRef = useRef<readonly RouteLike[]>([]);
  /* undefined until the first account is heard of: that one is the account the first loads ran under. */
  const accountRef = useRef<string | null | undefined>(undefined);
  const told = useRef(false);
  const prefetched = useRef(new Map<string, Prefetched>());
  const cache = useRef(new Map<string, Entry>());
  const restore = useRef<number | null>(null);
  const sequence = useRef(0);
  const initialStarted = useRef(false);
  const moved = useRef(onMove);
  moved.current = onMove;

  const routeFor = useCallback((path: string): { readonly route: RouteLike; readonly params: Params } | null => {
    for (const route of routesRef.current) {
      const params = match(route.path, path);
      if (params) return { route, params };
    }
    return null;
  }, []);
  const newEntry = () => `${Date.now().toString(36)}-${++sequence.current}`;
  /* The shown entry's scroll and the time it was left, so Back finds where the reader was. */
  const leave = useCallback(() => {
    const e = entryRef.current ? cache.current.get(entryRef.current) : undefined;
    if (e) { e.scrollY = w.scrollY; e.at = Date.now(); }
  }, [w]);
  const remember = useCallback((entry: string, doc: unknown) => {
    cache.current.delete(entry);
    cache.current.set(entry, { doc, scrollY: 0, at: Date.now() });
    while (cache.current.size > ENTRIES_MAX) cache.current.delete(cache.current.keys().next().value as string);
  }, []);
  const commit = useCallback((next: Shown, entry: string | null, tell = true) => {
    if (tell) moved.current?.(shownRef.current.location, next.location);
    shownRef.current = next;
    entryRef.current = entry;
    setShown(next);
  }, []);
  /* A prefetch is kept by its address and the account it was made under. */
  const prefetchKey = (address: string) => `${accountRef.current ?? ''}|${address}`;
  /*
   * Stops the pending load. A Back that was loading has already moved the address bar to its target; stopping
   * it puts the bar back on the page still shown by replacing the target's entry with the shown page's address
   * and state, under the shown page's key. That keeps the stack the length it is, pushes nothing, and leaves bar
   * and page agreeing; history.go(delta) would need each entry's index, which nothing here tracks, and would
   * itself raise a popstate. The target entry is the one given up. A popstate that cancels (`restoreBar` false)
   * has been moved by the browser to a new entry, which must not be written over.
   */
  const cancelPending = useCallback((restoreBar = true) => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    p.controller.abort();
    setPending(null);
    if (p.popped && restoreBar && entryRef.current) {
      const l = shownRef.current.location;
      w.history.replaceState(wrap(entryRef.current, l.state), '', addressOf(l) + (l.hash ? `#${l.hash}` : ''));
    }
  }, [w]);
  const takePrefetch = useCallback((address: string): Promise<unknown> | null => {
    const k = `${accountRef.current ?? ''}|${address}`;
    const e = prefetched.current.get(k);
    if (!e) return null;
    if (e.settledAt === null || Date.now() - e.settledAt < PREFETCH_KEPT_MS) return e.promise;
    prefetched.current.delete(k);
    return null;
  }, []);

  /* A load lands: the history entry first, then the new location and its document in one state update. */
  const land = useCallback((req: Request, found: { readonly route: RouteLike; readonly params: Params }, outcome: Outcome & { readonly kind: 'doc' | 'failure' }) => {
    const entry = req.kb ?? newEntry();
    const url = new URL(req.full, w.location.href);
    const state = req.popped || req.initial ? unwrap(w.history.state).state : req.state;
    if (req.popped || req.initial) w.history.replaceState(wrap(entry, state), '', req.full);
    else if (req.replace || url.pathname + url.search + url.hash === w.location.pathname + w.location.search + w.location.hash) w.history.replaceState(wrap(entry, state), '', req.full);
    else w.history.pushState(wrap(entry, state), '', req.full);
    leave();
    const location = read(w, req.popped);
    const ok = outcome.kind === 'doc';
    /* An older entry that is loaded again still gets the scroll it was left at. */
    const before = req.popped ? cache.current.get(entry)?.scrollY : undefined;
    if (ok) remember(entry, outcome.doc);
    if (before !== undefined) restore.current = before;
    commit({ location, doc: ok ? outcome.doc : undefined, ready: true, failure: ok ? null : outcome.failure, route: found.route, key: ok ? keyOf(found.route, found.params, location.query, location.path) : null }, entry, !req.initial);
  }, [w, leave, remember, commit]);

  const startLoad = useCallback((req: Request, found: { readonly route: RouteLike; readonly params: Params }) => {
    cancelPending();
    const url = new URL(req.full, w.location.href);
    const address = url.pathname + url.search;
    const id = ++sequence.current;
    const controller = new AbortController();
    const startedAt = Date.now();
    pendingRef.current = { id, to: req.full, controller, startedAt, account: accountRef.current, popped: req.popped, initial: !!req.initial };
    setPending({ to: req.full, startedAt });
    const joined = takePrefetch(address);
    const promise = joined ?? invoke(found.route, url, found.params, controller.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = new Promise<Outcome>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve({ kind: 'aborted' }));
      timer = setTimeout(() => { resolve({ kind: 'failure', failure: 'display' }); controller.abort(); }, LOAD_LIMIT_MS);
      promise.then((doc) => resolve(doc === null ? { kind: 'failure', failure: 'find' } : { kind: 'doc', doc }), () => resolve({ kind: 'failure', failure: 'display' }));
    });
    void outcome.then((o) => {
      clearTimeout(timer);
      const p = pendingRef.current;
      if (p?.id !== id || o.kind === 'aborted' || p.account !== accountRef.current) return;
      pendingRef.current = null;
      setPending(null);
      land(req, found, o);
    });
  }, [w, cancelPending, takePrefetch, land]);

  /*
   * The document's first move is told in a layout effect: a parent's passive effect runs after its
   * children's, so a screen that moves as it mounts (sign-in, for a reader already signed in) would
   * otherwise be told before it, and the first move would name the address it moved to. A layout
   * effect runs once the page is in the document and before every passive effect, a child's
   * included; a screen that moved in a layout effect of its own would still come first, and none does.
   */
  useLayoutEffect(() => {
    /* The first entry is keyed too, so its scroll is kept like every other. */
    const entry = entryRef.current ?? newEntry();
    entryRef.current = entry;
    w.history.replaceState(wrap(entry, unwrap(w.history.state).state), '');
    if (!cache.current.has(entry)) remember(entry, undefined);
    if (!told.current) { told.current = true; moved.current?.(null, shownRef.current.location); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* The scroll a Back restored from memory, set once the page it belongs to is drawn. */
  useLayoutEffect(() => {
    if (restore.current === null) return;
    const y = restore.current;
    restore.current = null;
    w.scrollTo(0, y);
  }, [shown, w]);
  /* The browser would restore a scroll before the page it belongs to is drawn, so the router does it. */
  useEffect(() => {
    let before: ScrollRestoration | undefined;
    try { before = w.history.scrollRestoration; w.history.scrollRestoration = 'manual'; } catch { /* a window without it */ }
    return () => { try { if (before) w.history.scrollRestoration = before; } catch { /* as above */ } };
  }, [w]);
  /* Escape stops a pending load, as IE's Stop did. It is not the router's in a text field or over a modal, and it is not consumed. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !pendingRef.current) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (w.document.querySelector('[aria-modal="true"], dialog[open]')) return;
      cancelPending();
    };
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, [w, cancelPending]);

  useEffect(() => {
    const onPop = () => {
      const location = read(w, true);
      const kb = unwrap(w.history.state).kb;
      const found = routeFor(location.path);
      const sh = shownRef.current;
      cancelPending(false);
      const key = found ? keyOf(found.route, found.params, location.query, location.path) : null;
      const same = !!found && sh.ready && !sh.failure && sh.route === found.route && sh.key === key;
      if (!found?.route.load || same) {
        leave();
        restore.current = kb ? cache.current.get(kb)?.scrollY ?? null : null;
        commit({ location, doc: same ? sh.doc : undefined, ready: true, failure: null, route: found?.route ?? null, key }, kb);
        return;
      }
      const cached = kb ? cache.current.get(kb) : undefined;
      if (cached && Date.now() - cached.at < ENTRY_KEPT_MS) {
        leave();
        restore.current = cached.scrollY;
        commit({ location, doc: cached.doc, ready: true, failure: null, route: found.route, key }, kb);
        return;
      }
      startLoad({ full: w.location.pathname + w.location.search + w.location.hash, popped: true, kb }, found);
    };
    w.addEventListener('popstate', onPop);
    return () => w.removeEventListener('popstate', onPop);
  }, [w, routeFor, cancelPending, leave, commit, startLoad]);

  const navigate = useCallback((to: string, options?: { readonly replace?: boolean; readonly state?: unknown }) => {
    // An in-app navigation never leaves the site: an address that resolves elsewhere (a stray `next`,
    // a link built from text) is the index. A <Link> to another site is left to the browser instead.
    let url = new URL(to, w.location.href);
    if (url.origin !== w.location.origin) url = new URL('/', w.location.href);
    const full = url.pathname + url.search + url.hash;
    const found = routeFor(url.pathname);
    const sh = shownRef.current;
    const query = new URLSearchParams(url.search);
    const key = found ? keyOf(found.route, found.params, query, url.pathname) : null;
    const same = !!found && sh.ready && !sh.failure && sh.route === found.route && sh.key === key;
    if (found?.route.load && !same) {
      startLoad({ full, replace: options?.replace, state: options?.state, popped: false, kb: null }, found);
      return;
    }
    /* A route with no loader, or a move within its key, moves at once. */
    cancelPending();
    const entry = newEntry();
    const state = wrap(entry, options?.state);
    if (options?.replace || full === w.location.pathname + w.location.search + w.location.hash) w.history.replaceState(state, '', full);
    else w.history.pushState(state, '', full);
    /* The address has moved and the page has not: pushState scrolls nothing and draws nothing. */
    leave();
    remember(entry, same ? sh.doc : undefined);
    commit({ location: read(w), doc: same ? sh.doc : undefined, ready: true, failure: null, route: found?.route ?? null, key }, entry);
  }, [w, routeFor, startLoad, cancelPending, leave, remember, commit]);

  const retry = useCallback(() => {
    const l = shownRef.current.location;
    navigate(addressOf(l) + (l.hash ? `#${l.hash}` : ''), { replace: true });
  }, [navigate]);

  const prefetch = useCallback((to: string) => {
    const url = new URL(to, w.location.href);
    if (url.origin !== w.location.origin) return;
    const found = routeFor(url.pathname);
    if (!found?.route.load) return;
    const address = url.pathname + url.search;
    if (takePrefetch(address)) return;
    const key = prefetchKey(address);
    const controller = new AbortController();
    const promise = invoke(found.route, url, found.params, controller.signal);
    /* Past the limit it is aborted and, if it never answered (a loader that ignores its signal), forgotten. */
    const timer = setTimeout(() => { controller.abort(); if (prefetched.current.get(key) === entry && entry.settledAt === null) prefetched.current.delete(key); }, LOAD_LIMIT_MS);
    const entry: Prefetched = { promise, controller, timer, settledAt: null };
    prefetched.current.set(key, entry);
    promise.then(() => { clearTimeout(timer); entry.settledAt = Date.now(); }, () => { clearTimeout(timer); if (prefetched.current.get(key) === entry) prefetched.current.delete(key); });
  }, [w, routeFor, takePrefetch]);

  const dropPrefetches = useCallback(() => {
    for (const e of prefetched.current.values()) { clearTimeout(e.timer); e.controller.abort(); }
    prefetched.current.clear();
  }, []);
  const beginInitial = useCallback(() => {
    if (initialStarted.current || shownRef.current.ready || pendingRef.current) return;
    initialStarted.current = true;
    const l = shownRef.current.location;
    const found = routeFor(l.path);
    if (found?.route.load) startLoad({ full: l.path + searchOf(l.query) + (l.hash ? `#${l.hash}` : ''), popped: false, kb: entryRef.current, initial: true }, found);
  }, [routeFor, startLoad]);
  /*
   * A different account empties every cache, stops the load in flight (it was asked for the earlier account and
   * may carry its data) and takes the shown document off the same-key shortcut, so no move reuses or remembers it.
   * The first account the router hears of is only recorded. A first load that is stopped is started again.
   */
  const setAccount = useCallback((id: string | null) => {
    if (accountRef.current === id) return;
    const first = accountRef.current === undefined;
    accountRef.current = id;
    if (first) { if (pendingRef.current) pendingRef.current.account = id; return; }
    const wasInitial = pendingRef.current?.initial;
    cancelPending(false);
    dropPrefetches();
    cache.current.clear();
    shownRef.current = { ...shownRef.current, key: null };
    if (wasInitial) { initialStarted.current = false; beginInitial(); }
  }, [cancelPending, dropPrefetches, beginInitial]);

  /* Leaving the page: nothing stays out, and a second run of the effects (StrictMode) starts the first load again. */
  useEffect(() => () => {
    cancelPending(false);
    dropPrefetches();
    initialStarted.current = false;
  }, [cancelPending, dropPrefetches]);

  const track = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    setTracking((n) => n + 1);
    const done = () => setTracking((n) => n - 1);
    promise.then(done, done);
    return promise;
  }, []);

  /* Routes hands over the route list; a first address whose route loads is loaded here, once. */
  const attach = useCallback((routes: readonly RouteLike[]) => {
    routesRef.current = routes;
    beginInitial();
  }, [beginInitial]);

  const navigation = useMemo(() => ({ pending, tracking, track }), [pending, tracking, track]);
  const value = useMemo(() => ({ location: shown.location, shown, navigate, retry, prefetch, navigation, attach, setAccount }), [shown, navigate, retry, prefetch, navigation, attach, setAccount]);
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


export function useNavigation(): Navigation {
  return useRouter().navigation;
}

/** Starts the load of an address without moving; a click on it soon after finds the answer. */
export function usePrefetch(): (to: string) => void {
  return useRouter().prefetch;
}

/** Tells the router whose session this is: a change empties every prefetch and every cached page. */
export function useRouterAccount(id: string | null): void {
  const { setAccount } = useRouter();
  useLayoutEffect(() => { setAccount(id); }, [id, setAccount]);
}

/** For `Routes`: what to draw, how to try again, and where to hand over the routes. */
export function useRouterInternals(): Pick<Router, 'shown' | 'retry' | 'attach'> {
  return useRouter();
}
