import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from './context.tsx';
import { addressOf, Link, RouterProvider, searchOf, useLocation, useNavigate, useNavigation, usePrefetch, useRouterAccount, type Location } from './router.tsx';
import { Routes, type Route } from './routes.tsx';

function Where() {
  const l = useLocation();
  const navigate = useNavigate();
  return <><span data-testid="path">{l.path}{l.query.toString() ? `?${l.query}` : ''}{l.hash ? `#${l.hash}` : ''}</span><button onClick={() => navigate('/b/general?page=2')}>go</button></>;
}

beforeEach(() => window.history.replaceState(null, '', '/'));

describe('the router', () => {
  test('a link moves without a reload and the location follows', async () => {
    render(<RouterProvider><Link to="/t/abc?page=8#post-142">thread</Link><Where /></RouterProvider>);
    await userEvent.click(screen.getByRole('link', { name: 'thread' }));
    expect(screen.getByTestId('path').textContent).toBe('/t/abc?page=8#post-142');
    expect(window.location.pathname).toBe('/t/abc');
  });
  test('a modified click is left to the browser', async () => {
    render(<RouterProvider><Link to="/elsewhere">x</Link><Where /></RouterProvider>);
    const before = window.history.length;
    fireEvent.click(screen.getByRole('link', { name: 'x' }), { ctrlKey: true });
    expect(screen.getByTestId('path').textContent).toBe('/');
    expect(window.history.length).toBe(before);
  });
  test('navigate() never leaves this site: an off-site address is the index, and an off-site link is left to the browser', () => {
    const origin = window.location.origin;
    window.history.replaceState(null, '', '/somewhere');
    render(<RouterProvider><Link to="https://evil.example/x">out</Link><Where /></RouterProvider>);
    for (const bad of ['https://evil.example/x', '//evil.example', '/\t/evil.example']) {
      act(() => { window.history.replaceState(null, '', '/somewhere'); });
      function Go() { const n = useNavigate(); return <button onClick={() => n(bad)}>bad</button>; }
      const { unmount } = render(<RouterProvider><Go /></RouterProvider>);
      act(() => screen.getByText('bad').click());
      expect(window.location.pathname, bad).toBe('/');
      expect(window.location.origin).toBe(origin);
      unmount();
    }
    expect(fireEvent.click(screen.getByRole('link', { name: 'out' }))).toBe(true);
  });
  test('navigating to where it already is adds no history entry', () => {
    render(<RouterProvider><Where /></RouterProvider>);
    act(() => screen.getByText('go').click());
    const after = window.history.length;
    act(() => screen.getByText('go').click());
    expect(window.history.length).toBe(after);
  });
  test('the back button is followed', () => {
    render(<RouterProvider><Where /></RouterProvider>);
    act(() => screen.getByText('go').click());
    act(() => {
      window.history.replaceState(null, '', '/somewhere');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('path').textContent).toBe('/somewhere');
  });
  test('a location reached by back or forward says so, and one reached by a link does not', () => {
    function Popped() { return <span data-testid="popped">{String(useLocation().popped)}</span>; }
    render(<RouterProvider><Where /><Popped /></RouterProvider>);
    act(() => screen.getByText('go').click());
    expect(screen.getByTestId('popped').textContent).toBe('false');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(screen.getByTestId('popped').textContent).toBe('true');
  });

  test('every move is told to onMove, from what was shown to what will be, while the page moved from is still drawn', () => {
    const seen: string[] = [];
    const where = (l: Location | null) => (l ? `${addressOf(l)}${l.popped ? ' (popped)' : ''}` : 'nothing');
    const onMove = (from: Location | null, to: Location) => seen.push(`${where(from)} -> ${where(to)} [drawn ${screen.queryByTestId('path')?.textContent ?? 'nothing'}]`);
    window.history.replaceState(null, '', '/t/abc');
    render(<RouterProvider onMove={onMove}><Where /></RouterProvider>);
    act(() => screen.getByText('go').click());
    act(() => {
      window.history.replaceState(null, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(seen).toEqual([
      'nothing -> /t/abc [drawn /t/abc]',
      '/t/abc -> /b/general?page=2 [drawn /t/abc]',
      '/b/general?page=2 -> /settings (popped) [drawn /b/general?page=2]',
    ]);
  });
  test('the document\'s first move is told first, before a screen that moves as it mounts moves it', () => {
    /* As the sign-in screen does for a reader already signed in: it replaces the address in its mount effect. */
    function Away() { const navigate = useNavigate(); useEffect(() => { navigate('/b/general', { replace: true }); }, [navigate]); return null; }
    const seen: [string | null, string][] = [];
    window.history.replaceState(null, '', '/sign-in');
    render(<RouterProvider onMove={(from, to) => seen.push([from?.path ?? null, to.path])}><Away /></RouterProvider>);
    expect(seen).toEqual([[null, '/sign-in'], ['/sign-in', '/b/general']]);
  });
});

describe('from the Task 10 review', () => {
  beforeEach(() => { log.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  test('a pending load never lands under another account, and a same-key move after the change loads again', async () => {
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => nav('/t/a'));
    view.setAccount('p2');
    expect(calls[0]!.signal.aborted).toBe(true);
    await answer(calls[0], 'A-p1');
    expect(screen.queryByText(/thread a/)).toBeNull();
    expect(navigation.pending).toBeNull();
    act(() => nav('/t/a'));
    await answer(calls[1], 'A-p2');
    view.setAccount('p3');
    act(() => nav('/t/a#post-1'));
    expect(load).toHaveBeenCalledTimes(3);
  });
  test('a click that joined a prefetch in flight is dropped by an account change, and the next click loads again', async () => {
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => prefetch('/t/a'));
    act(() => nav('/t/a'));
    view.setAccount('p2');
    expect(calls[0]!.signal.aborted).toBe(true);
    await answer(calls[0], 'A-p1');
    expect(screen.queryByText(/thread a/)).toBeNull();
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(2);
  });
  test('the first account the router hears of does not cancel the first load', async () => {
    const { load, calls } = manualLoader();
    window.history.replaceState(null, '', '/t/a');
    const routes: Route[] = [{ path: '/t/:id', load, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> }];
    function Account() { useRouterAccount('p1'); return null; }
    render(<KayfaProvider value={kayfa}><RouterProvider><Routes routes={routes} /><Account /></RouterProvider></KayfaProvider>);
    await answer(calls[0], 'first');
    expect(screen.getByText('thread a: first')).toBeInTheDocument();
  });
  test('unmounting aborts the pending load', () => {
    const { load, calls } = manualLoader();
    const view = mount(load);
    act(() => nav('/t/a'));
    view.unmount();
    expect(calls[0]!.signal.aborted).toBe(true);
  });
  test('unmounting aborts a prefetch in flight', () => {
    const { load, calls } = manualLoader();
    const view = mount(load);
    act(() => prefetch('/t/a'));
    view.unmount();
    expect(calls[0]!.signal.aborted).toBe(true);
  });
  test('a first load survives StrictMode\'s second run of the effects, and is told once', async () => {
    const { load, calls } = manualLoader();
    window.history.replaceState(null, '', '/t/a');
    const routes: Route[] = [{ path: '/t/:id', load, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> }];
    const told: string[] = [];
    render(<StrictMode><KayfaProvider value={kayfa}><RouterProvider onMove={(f, t) => told.push(`${f?.path ?? 'nothing'}>${t.path}`)}><Routes routes={routes} /></RouterProvider></KayfaProvider></StrictMode>);
    await act(async () => { for (const c of calls) c.resolve('S1'); });
    expect(screen.getByText('thread a: S1')).toBeInTheDocument();
    expect(told).toEqual(['nothing>/t/a']);
  });
  test('Escape on a Back that was loading returns the address bar to the page still shown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => nav('/t/b'));
    await answer(calls[1], 'B1');
    vi.setSystemTime(new Date('2026-11-05T12:20:00Z'));
    act(() => window.history.back());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(window.location.pathname).toBe('/t/a');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(window.location.pathname).toBe('/t/b');
    expect(screen.getByText('thread b: B1')).toBeInTheDocument();
  });
  test('a prefetch that never settles is dropped at twenty seconds, so a click then loads again', async () => {
    vi.useFakeTimers();
    const { load } = manualLoader();
    mount(load);
    act(() => prefetch('/t/a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(2);
  });
  test('a prefetch answer is kept thirty seconds and no longer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const { load, calls } = manualLoader();
    mount(load);
    act(() => prefetch('/t/a'));
    await answer(calls[0], 'P1');
    vi.setSystemTime(new Date('2026-11-05T12:00:29Z'));
    act(() => prefetch('/t/a'));
    expect(load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-05T12:00:31Z'));
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(2);
  });
  test('onMove is told when a load lands, not at the click', async () => {
    const { load, calls } = manualLoader();
    const told: string[] = [];
    window.history.replaceState(null, '', '/');
    const routes: Route[] = [{ path: '/', render: () => <p>home</p> }, { path: '/t/:id', load, render: (p) => <p>thread {p.id}</p> }];
    render(<KayfaProvider value={kayfa}><RouterProvider onMove={(f, t) => told.push(`${f?.path ?? 'nothing'}>${t.path}`)}><Probe /><Routes routes={routes} /></RouterProvider></KayfaProvider>);
    act(() => nav('/t/a'));
    expect(told).toEqual(['nothing>/']);
    await answer(calls[0], 'A1');
    expect(told).toEqual(['nothing>/', '/>/t/a']);
  });
  test('the history cache holds twenty entries: a Back inside them shows at once, one beyond them loads', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    for (let i = 0; i < 24; i++) {
      act(() => nav(`/t/${i}`));
      await answer(calls[i], `D${i}`);
    }
    act(() => window.history.go(-3));
    await waitFor(() => expect(screen.getByText('thread 20: D20')).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(24);
    act(() => window.history.go(-19));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(25));
  });
  test('the router keeps scroll restoration manual while mounted and gives it back on unmount', () => {
    const { load } = manualLoader();
    window.history.scrollRestoration = 'auto';
    const view = mount(load);
    expect(window.history.scrollRestoration).toBe('manual');
    view.unmount();
    expect(window.history.scrollRestoration).toBe('auto');
  });
  test('a popstate while a load is pending stops the load and moves to where the browser went', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    act(() => { window.history.replaceState(null, '', '/plain/x'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(screen.getByText('plain x')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/plain/x');
    await answer(calls[0], 'late');
    expect(screen.queryByText(/thread a/)).toBeNull();
  });
});

/*
 * URLSearchParams.size is missing before Safari 17, where a test on it reads undefined and drops
 * every query. jsdom has it, so no test here can see that browser fail; what is held is that the
 * helpers read the query by its text, which every browser has.
 */
describe('an address read from a location', () => {
  const at = (path: string, search: string) => ({ path, query: new URLSearchParams(search) });
  test('is the path alone when there is no query', () => {
    expect(addressOf(at('/b/general', ''))).toBe('/b/general');
    expect(searchOf(new URLSearchParams())).toBe('');
  });
  test('carries the query when there is one', () => {
    expect(addressOf(at('/t/abc', '?page=3'))).toBe('/t/abc?page=3');
    expect(searchOf(new URLSearchParams('page=3&x=a b'))).toBe('?page=3&x=a+b');
  });
  test('reads the query by its text, not by its size', () => {
    const query = new URLSearchParams('page=2');
    Object.defineProperty(query, 'size', { value: undefined });
    expect(addressOf({ path: '/t/abc', query })).toBe('/t/abc?page=2');
  });
});

/* A loader the test answers by hand: each call waits until the test resolves or rejects it. */
interface Call { readonly params: Readonly<Record<string, string>>; readonly signal: AbortSignal; readonly resolve: (doc: unknown) => void; readonly reject: (e: unknown) => void }
function manualLoader() {
  const calls: Call[] = [];
  const load = vi.fn((a: { params: Readonly<Record<string, string>>; signal: AbortSignal }) => new Promise<unknown>((resolve, reject) => { calls.push({ params: a.params, signal: a.signal, resolve, reject }); }));
  return { load, calls };
}

const kayfa = { ui: { copy: { siteName: 'Test Board' } } } as unknown as Kayfa;
let nav: ReturnType<typeof useNavigate>;
let prefetch: ReturnType<typeof usePrefetch>;
let navigation: ReturnType<typeof useNavigation>;
const log: string[] = [];
let seenState: unknown;

function Probe() {
  nav = useNavigate();
  prefetch = usePrefetch();
  navigation = useNavigation();
  seenState = useLocation().state;
  return null;
}
function Index() { log.push(`index@${useLocation().path}`); return <p>index screen</p>; }

function mount(load: Route['load'], { account = null as string | null, path = '/' } = {}) {
  const routes: Route[] = [
    { path: '/', render: () => <Index /> },
    { path: '/t/:id', load, key: (p) => p.id!, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> },
    { path: '/plain/:id', render: (p) => <p>plain {p.id}</p> },
  ];
  window.history.replaceState(null, '', path);
  function Account({ id }: { id: string | null }) { useRouterAccount(id); return null; }
  let setAccount: (id: string | null) => void = () => undefined;
  function Shell() {
    const [id, set] = useState(account);
    setAccount = set;
    return <><Account id={id} /><Probe /><Link to="/t/a">to a</Link><Routes routes={routes} /></>;
  }
  const view = render(<KayfaProvider value={kayfa}><RouterProvider><Shell /></RouterProvider></KayfaProvider>);
  return { ...view, setAccount: (id: string | null) => act(() => setAccount(id)) };
}
const answer = (c: Call | undefined, doc: unknown) => act(async () => { c!.resolve(doc); });

describe('the router loads before it moves', () => {
  beforeEach(() => { log.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  test('a click on a link to a loading route leaves the old screen drawn and the address as it was until the load lands, then both change together', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    await userEvent.click(screen.getByRole('link', { name: 'to a' }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByText('index screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(navigation.pending?.to).toBe('/t/a');
    await answer(calls[0], 'A1');
    expect(screen.getByText('thread a: A1')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/a');
    expect(navigation.pending).toBeNull();
    expect(log).not.toContain('index@/t/a');
  });
  test('a second click aborts the first, and the first one\'s late answer is never shown', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    act(() => nav('/t/b'));
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    await answer(calls[0], 'late');
    expect(screen.queryByText(/thread a/)).toBeNull();
    expect(screen.getByText('index screen')).toBeInTheDocument();
    await answer(calls[1], 'B1');
    expect(screen.getByText('thread b: B1')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/b');
  });
  test('Escape aborts a pending load and the old screen stays', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(false);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(navigation.pending).toBeNull();
    await answer(calls[0], 'late');
    expect(screen.getByText('index screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
  test('Escape typed in a text field, or with a modal open, is not the router\'s', () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    const field = document.createElement('textarea');
    document.body.append(field);
    act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(calls[0]!.signal.aborted).toBe(false);
    field.remove();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(calls[0]!.signal.aborted).toBe(false);
    dialog.remove();
  });
  test('a load that throws shows the page cannot be displayed, and Try again loads again', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await act(async () => { calls[0]!.reject(new Error('down')); });
    expect(screen.getByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/a');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(load).toHaveBeenCalledTimes(2);
    await answer(calls[1], 'A2');
    expect(screen.getByText('thread a: A2')).toBeInTheDocument();
  });
  test('a load that answers null shows the page cannot be found, and so does an address no route matches', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/gone'));
    await answer(calls[0], null);
    expect(screen.getByRole('heading', { name: 'The page cannot be found' })).toBeInTheDocument();
    act(() => nav('/nowhere/at/all'));
    expect(screen.getByRole('heading', { name: 'The page cannot be found' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/nowhere/at/all');
  });
  test('a move that keeps the route\'s key draws at once with no load', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => nav('/t/a#post-142'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(navigation.pending).toBeNull();
    expect(window.location.hash).toBe('#post-142');
    expect(screen.getByText('thread a: A1')).toBeInTheDocument();
  });
  test('a route with no loader moves at once', () => {
    const { load } = manualLoader();
    mount(load);
    act(() => nav('/plain/x'));
    expect(screen.getByText('plain x')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
  test('a prefetch answered before the click makes the click show the page with no second load', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => prefetch('/t/a'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    await answer(calls[0], 'P1');
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('thread a: P1')).toBeInTheDocument();
  });
  test('a click while a prefetch is still out joins it', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => prefetch('/t/a'));
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(1);
    await answer(calls[0], 'P1');
    expect(screen.getByText('thread a: P1')).toBeInTheDocument();
  });
  test('Back to an entry left less than five minutes ago shows its document with no load and restores its scroll; an older one loads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    let y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    y = 300;
    act(() => nav('/t/b'));
    await answer(calls[1], 'B1');
    expect(window.history.state).toEqual(expect.objectContaining({ kb: expect.any(String) }));
    vi.setSystemTime(new Date('2026-11-05T12:04:00Z'));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText('thread a: A1')).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledWith(0, 300);
    act(() => window.history.forward());
    await waitFor(() => expect(screen.getByText('thread b: B1')).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-11-05T12:20:00Z'));
    act(() => window.history.back());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(screen.getByText('thread b: B1')).toBeInTheDocument();
    await answer(calls[2], 'A-again');
    expect(screen.getByText('thread a: A-again')).toBeInTheDocument();
  });
  test('Back to a route with no loader restores its scroll', async () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    let y = 0;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    const { load } = manualLoader();
    mount(load);
    act(() => nav('/plain/x'));
    y = 420;
    act(() => nav('/plain/y'));
    y = 0;
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText('plain x')).toBeInTheDocument());
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
  });
  test('a change of account empties the caches: a prefetch is dropped, and Back loads again', async () => {
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => prefetch('/t/a'));
    await answer(calls[0], 'P1');
    view.setAccount('p2');
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(2);
    await answer(calls[1], 'A1');
    act(() => nav('/t/b'));
    await answer(calls[2], 'B1');
    view.setAccount('p3');
    act(() => window.history.back());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(4));
  });
  test('at twenty seconds a pending load aborts and shows the page cannot be displayed', async () => {
    vi.useFakeTimers();
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
    expect(screen.getByText('index screen')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(screen.getByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
  });
  test('a page\'s own state still reads through Location.state when the entry carries the router\'s key', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a', { state: { character: 'c1' } }));
    await answer(calls[0], 'A1');
    expect(window.history.state).toEqual({ kb: expect.any(String), state: { character: 'c1' } });
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(seenState).toEqual({ character: 'c1' });
  });
  test('track counts a screen\'s own read while it is in flight', async () => {
    const { load } = manualLoader();
    mount(load);
    let done!: () => void;
    act(() => { void navigation.track(new Promise<void>((r) => { done = r; })); });
    expect(navigation.tracking).toBe(1);
    await act(async () => { done(); });
    expect(navigation.tracking).toBe(0);
  });
});
