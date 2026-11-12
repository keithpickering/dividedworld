import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from './context.tsx';
import { addressOf, Link, RouterProvider, searchOf, useLocation, useNavigate, useNavigation, usePendingFrom, usePrefetch, useNavigationGuard, useRouterAccount, useRouterInternals, type Location, type NavigationGuard } from './router.tsx';
import { Routes, type Route } from './routes.tsx';
import { ReadFailure } from './data/api.ts';

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
    expect(load).toHaveBeenCalledTimes(3);
    act(() => nav('/t/a#post-1'));
    expect(load).toHaveBeenCalledTimes(4);
  });
  test('a move made by the act that ends the account is asked again under the new account, where a click is dropped', async () => {
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => nav('/t/a', { afterAccountChange: true }));
    view.setAccount(null);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(navigation.pending?.to).toBe('/t/a');
    await answer(calls[1], 'A-out');
    expect(screen.getByText('thread a: A-out')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/a');
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
  test('a prefetch answered before a move is gone after it: the same address moved to later loads again, within the thirty seconds', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => prefetch('/t/a'));
    await answer(calls[0], 'P1');
    act(() => nav('/t/b'));
    await answer(calls[1], 'B1');
    expect(load).toHaveBeenCalledTimes(2);
    act(() => nav('/t/a'));
    expect(load).toHaveBeenCalledTimes(3);
    await answer(calls[2], 'A2');
    expect(screen.getByText('thread a: A2')).toBeInTheDocument();
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
let retry: ReturnType<typeof useRouterInternals>['retry'];
const log: string[] = [];
let seenState: unknown;

function Probe() {
  nav = useNavigate();
  prefetch = usePrefetch();
  navigation = useNavigation();
  retry = useRouterInternals().retry;
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
  test('an Escape keydown that starts a load does not cancel it; a later Escape does', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    /* A page-level handler (the menu bar's Back) starts the load from the same keydown the router also hears at the window. */
    const start = () => nav('/t/a', { source: 'back' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') start(); };
    document.addEventListener('keydown', onKey);
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    document.removeEventListener('keydown', onKey);
    expect(navigation.pending?.source).toBe('back');
    expect(calls[0]!.signal.aborted).toBe(false);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(navigation.pending).toBeNull();
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
  test.each([
    ['offline', true, 'You are not connected'],
    ['silent', true, 'did not answer in time'],
    ['server', false, 'answered, but with an error'],
  ] as const)('a load that rejects with a ReadFailure of kind %s lands that failure', async (kind, checksConnection, sentence) => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await act(async () => { calls[0]!.reject(new ReadFailure(kind)); });
    expect(screen.getByText(new RegExp(sentence, 'u'))).toBeInTheDocument();
    expect(screen.queryByText('Check that your connection is working.') !== null).toBe(checksConnection);
  });
  test('a load that throws a plain Error lands broken', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await act(async () => { calls[0]!.reject(new Error('down')); });
    expect(screen.getByText(/Something went wrong while loading it\./u)).toBeInTheDocument();
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
  test('two routes that share one loader and one key are one document: a move between them reads nothing', async () => {
    const load = vi.fn(() => Promise.resolve('doc'));
    const key = () => 'one';
    const routes: Route[] = [
      { path: '/a', load, key, render: (_, doc) => <p>a {String(doc)}</p> },
      { path: '/b', load, key, render: (_, doc) => <p>b {String(doc)}</p> },
    ];
    window.history.replaceState(null, '', '/a');
    render(<KayfaProvider value={kayfa}><RouterProvider><Probe /><Routes routes={routes} /></RouterProvider></KayfaProvider>);
    await screen.findByText('a doc');
    expect(load).toHaveBeenCalledTimes(1);
    act(() => nav('/b'));
    expect(screen.getByText('b doc')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/b');
  });
  test('an address that is the document already shown is not read ahead', async () => {
    const load = vi.fn(() => Promise.resolve('doc'));
    const key = () => 'one';
    const routes: Route[] = [
      { path: '/a', load, key, render: (_, doc) => <p>a {String(doc)}</p> },
      { path: '/b', load, key, render: (_, doc) => <p>b {String(doc)}</p> },
    ];
    window.history.replaceState(null, '', '/a');
    render(<KayfaProvider value={kayfa}><RouterProvider><Probe /><Routes routes={routes} /></RouterProvider></KayfaProvider>);
    await screen.findByText('a doc');
    act(() => prefetch('/b'));
    expect(load).toHaveBeenCalledTimes(1);
  });
  test('a move to the sibling that shares the key while a re-read is out does not lose it: the new document is drawn', async () => {
    const calls: Array<(d: string) => void> = [];
    const load = vi.fn(() => new Promise<string>((resolve) => { calls.push(resolve); }));
    const key = () => 'one';
    const routes: Route[] = [
      { path: '/a', load, key, render: (_, doc) => <p>a {String(doc)}</p> },
      { path: '/b', load, key, render: (_, doc) => <p>b {String(doc)}</p> },
    ];
    window.history.replaceState(null, '', '/a');
    render(<KayfaProvider value={kayfa}><RouterProvider><Probe /><Routes routes={routes} /></RouterProvider></KayfaProvider>);
    await act(async () => { calls[0]!('old'); });
    expect(screen.getByText('a old')).toBeInTheDocument();
    act(() => retry());
    act(() => nav('/b'));
    expect(screen.getByText('b old')).toBeInTheDocument();
    await act(async () => { for (const c of calls.slice(1)) c('new'); });
    expect(screen.getByText('b new')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/b');
  });
  test('a re-read that fails is the page cannot be displayed, and Try again reads it', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => retry());
    await act(async () => { calls[1]!.reject(new Error('down')); });
    expect(screen.getByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await answer(calls[2], 'A3');
    expect(screen.getByText('thread a: A3')).toBeInTheDocument();
  });
  test('retry of a shown page reads its document again in place: the old page stays until it lands, no move is told, and Escape does not stop it', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    expect(screen.getByText('thread a: A1')).toBeInTheDocument();
    const entries = window.history.length;
    act(() => retry());
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText('thread a: A1')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(calls[1]!.signal.aborted).toBe(false);
    await answer(calls[1], 'A2');
    expect(screen.getByText('thread a: A2')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/a');
    expect(window.history.length).toBe(entries);
  });
  test('a load that answers null shows the page cannot be found, and so does an address no route matches', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/gone'));
    await answer(calls[0], null);
    expect(screen.getByRole('heading', { name: 'The thread you requested does not exist.' })).toBeInTheDocument();
    act(() => nav('/nowhere/at/all'));
    expect(screen.getByRole('heading', { name: 'There is no page at this address.' })).toBeInTheDocument();
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
    expect(screen.getByText(/did not answer in time/u)).toBeInTheDocument();
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
  test('the outcome says how the last load ended: landed, cancelled by Escape, failed', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    expect(navigation.outcome).toBeNull();
    act(() => nav('/t/a'));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(navigation.outcome?.kind).toBe('cancelled');
    const seq = navigation.outcome!.seq;
    act(() => nav('/t/b'));
    await answer(calls[1], 'B');
    expect(navigation.outcome).toEqual({ seq: expect.any(Number), kind: 'landed' });
    expect(navigation.outcome!.seq).toBeGreaterThan(seq);
    act(() => nav('/t/c'));
    await act(async () => { calls[2]!.reject(new Error('down')); });
    expect(navigation.outcome?.kind).toBe('failed');
  });
  test('a tracked read reports landed when it resolves and failed when it rejects', async () => {
    const { load } = manualLoader();
    mount(load);
    let ok!: () => void;
    let bad!: (e: unknown) => void;
    act(() => { void navigation.track(new Promise<void>((r) => { ok = r; })); });
    await act(async () => { ok(); });
    expect(navigation.outcome?.kind).toBe('landed');
    act(() => { navigation.track(new Promise<void>((_, r) => { bad = r; })).catch(() => {}); });
    await act(async () => { bad(new Error('x')); });
    expect(navigation.outcome?.kind).toBe('failed');
  });
});

describe('an account change while a page is shown or opening', () => {
  beforeEach(() => { log.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  test('a Back that was loading is started again under the new account, not dropped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => nav('/t/b'));
    await answer(calls[1], 'B1');
    vi.setSystemTime(new Date('2026-11-05T12:20:00Z'));
    act(() => window.history.back());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    view.setAccount('p2');
    expect(calls[2]!.signal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(4);
    expect(navigation.pending?.to).toBe('/t/a');
    await answer(calls[3], 'A-p2');
    expect(screen.getByText('thread a: A-p2')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/t/a');
    expect(navigation.pending).toBeNull();
  });
  test('the first account the router hears of drops the prefetches made before it was known', () => {
    const { load, calls } = manualLoader();
    const routes: Route[] = [{ path: '/', render: () => <Index /> }, { path: '/t/:id', load, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> }];
    function Account() { useRouterAccount('p1'); return null; }
    function Shell() { const [on, set] = useState(false); return <><Probe /><button onClick={() => set(true)}>know</button>{on && <Account />}<Routes routes={routes} /></>; }
    window.history.replaceState(null, '', '/');
    render(<KayfaProvider value={kayfa}><RouterProvider><Shell /></RouterProvider></KayfaProvider>);
    act(() => prefetch('/t/a'));
    expect(calls).toHaveLength(1);
    act(() => screen.getByText('know').click());
    expect(calls[0]!.signal.aborted).toBe(true);
  });
  test('the shown document of the earlier account is loaded again for the new one, replacing the entry', async () => {
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => nav('/t/a'));
    await answer(calls[0], 'A-p1');
    const length = window.history.length;
    view.setAccount('p2');
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/A-p1/)).toBeNull();
    await answer(calls[1], 'A-p2');
    expect(screen.getByText('thread a: A-p2')).toBeInTheDocument();
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/t/a');
  });
  test('a shown page with no loader is not loaded again', async () => {
    const { load } = manualLoader();
    const view = mount(load, { account: 'p1' });
    view.setAccount('p2');
    expect(load).not.toHaveBeenCalled();
  });
});

describe('a link starts its load early', () => {
  afterEach(() => { vi.useRealTimers(); });
  function setupLinks() {
    const { load, calls } = manualLoader();
    const routes: Route[] = [
      { path: '/', render: () => <p>home</p> },
      { path: '/t/:id', load, render: (p) => <p>thread {p.id}</p> },
      { path: '/plain/:id', render: () => <p>plain</p> },
    ];
    window.history.replaceState(null, '', '/');
    render(<KayfaProvider value={kayfa}><RouterProvider>
      <Link to="/t/a">thread</Link><Link to="/plain/x">plain</Link><Link to="https://evil.example/t/a">out</Link>
      <Link to="/t/b" target="_blank">blank</Link><Link to="/t/c" download>get</Link><Link to="/t/d" early={false}>again</Link><Routes routes={routes} />
    </RouterProvider></KayfaProvider>);
    return { load, calls, link: (name: string) => screen.getByRole('link', { name }) };
  }

  test('resting on a link for 100 ms starts one load', () => {
    vi.useFakeTimers();
    const { load, link } = setupLinks();
    fireEvent.pointerEnter(link('thread'));
    act(() => { vi.advanceTimersByTime(99); });
    expect(load).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(link('thread'));
    expect(load).toHaveBeenCalledTimes(1);
  });
  test('leaving at 60 ms starts none', () => {
    vi.useFakeTimers();
    const { load, link } = setupLinks();
    fireEvent.pointerEnter(link('thread'));
    act(() => { vi.advanceTimersByTime(60); });
    fireEvent.pointerLeave(link('thread'));
    act(() => { vi.advanceTimersByTime(200); });
    expect(load).not.toHaveBeenCalled();
  });
  test('focus rests 100 ms like the pointer, and pointerdown starts one at once', () => {
    vi.useFakeTimers();
    const { load, link } = setupLinks();
    fireEvent.focus(link('thread'));
    expect(load).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(load).toHaveBeenCalledTimes(1);
    cleanup();
    const again = setupLinks();
    fireEvent.pointerDown(again.link('thread'));
    expect(again.load).toHaveBeenCalledTimes(1);
  });
  test('a link that says early={false} starts none, by rest, focus or pointerdown: Back to the board must read the page as it is when it is followed', () => {
    vi.useFakeTimers();
    const { load, link } = setupLinks();
    fireEvent.focus(link('again'));
    fireEvent.pointerEnter(link('again'));
    fireEvent.pointerDown(link('again'));
    act(() => { vi.advanceTimersByTime(300); });
    expect(load).not.toHaveBeenCalled();
  });
  test('a link to a route with no loader, an off-site link, a target and a download start none, nor does a modified pointerdown', () => {
    vi.useFakeTimers();
    const { load, link } = setupLinks();
    for (const name of ['plain', 'out', 'blank', 'get']) {
      fireEvent.focus(link(name));
      fireEvent.pointerDown(link(name));
      fireEvent.pointerEnter(link(name));
    }
    fireEvent.pointerDown(link('thread'), { ctrlKey: true });
    act(() => { vi.advanceTimersByTime(300); });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('from the Task 11 review', () => {
  beforeEach(() => { log.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  test('an account change blanks the earlier account\'s document at once, and the re-read is not a move', async () => {
    const { load, calls } = manualLoader();
    const told: string[] = [];
    const routes: Route[] = [{ path: '/', render: () => <Index /> }, { path: '/t/:id', load, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> }];
    let setId: (id: string | null) => void = () => undefined;
    function Shell() { const [id, set] = useState<string | null>('p1'); setId = set; useRouterAccount(id); return <><Probe /><Routes routes={routes} /></>; }
    window.history.replaceState(null, '', '/');
    render(<KayfaProvider value={kayfa}><RouterProvider onMove={(f, t) => told.push(`${f?.path ?? '-'}>${t.path}`)}><Shell /></RouterProvider></KayfaProvider>);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A-p1');
    expect(told).toEqual(['->/', '/>/t/a']);
    act(() => setId('p2'));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/A-p1/)).toBeNull();
    expect(navigation.pending).not.toBeNull();
    await answer(calls[1], 'A-p2');
    expect(screen.getByText('thread a: A-p2')).toBeInTheDocument();
    expect(told).toHaveLength(2);
  });
  test('Escape does not stop the re-read of a blanked page', async () => {
    const { load, calls } = manualLoader();
    const view = mount(load, { account: 'p1' });
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    view.setAccount('p2');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(calls[1]!.signal.aborted).toBe(false);
    expect(navigation.pending).not.toBeNull();
  });
  test('after a failure, a cached Back and a move to a page with no loader report landed', async () => {
    const { load, calls } = manualLoader();
    mount(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => nav('/t/b'));
    await act(async () => { calls[1]!.reject(new Error('down')); });
    expect(navigation.outcome?.kind).toBe('failed');
    const seq = navigation.outcome!.seq;
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText('thread a: A1')).toBeInTheDocument());
    expect(navigation.outcome?.kind).toBe('landed');
    expect(navigation.outcome!.seq).toBeGreaterThan(seq);
    act(() => nav('/plain/x'));
    expect(navigation.outcome!.seq).toBeGreaterThan(seq + 1);
  });
  test('the first account drops every prefetch made before it was known, but not the load that is pending', () => {
    const { load, calls } = manualLoader();
    window.history.replaceState(null, '', '/t/a');
    const routes: Route[] = [{ path: '/t/:id', load, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> }];
    function Account() { useRouterAccount('p1'); return null; }
    function Shell() { const [on, set] = useState(false); return <><Probe /><button onClick={() => set(true)}>know</button>{on && <Account />}<Routes routes={routes} /></>; }
    render(<KayfaProvider value={kayfa}><RouterProvider><Shell /></RouterProvider></KayfaProvider>);
    act(() => prefetch('/t/b'));
    expect(calls).toHaveLength(2);
    act(() => screen.getByText('know').click());
    expect(calls[1]!.signal.aborted).toBe(true);
    expect(calls[0]!.signal.aborted).toBe(false);
  });
  test('prefetches are capped at twenty, the oldest dropped, and one older than thirty seconds is swept', async () => {
    vi.useFakeTimers();
    const { load, calls } = manualLoader();
    mount(load);
    for (let i = 0; i < 21; i++) act(() => prefetch(`/t/p${i}`));
    expect(calls).toHaveLength(21);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    await act(async () => { calls[20]!.resolve('x'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    act(() => prefetch('/t/p20'));
    expect(calls).toHaveLength(22);
  });
  test('a link\'s focus rests before it reads, and blur clears it; only the primary button\'s pointerdown reads', () => {
    vi.useFakeTimers();
    const { load, calls } = manualLoader();
    window.history.replaceState(null, '', '/');
    const routes: Route[] = [{ path: '/', render: () => <p>home</p> }, { path: '/t/:id', load, render: () => <p>t</p> }];
    render(<KayfaProvider value={kayfa}><RouterProvider><Link to="/t/a">one</Link><Link to="/t/b">two</Link><Routes routes={routes} /></RouterProvider></KayfaProvider>);
    fireEvent.focus(screen.getByRole('link', { name: 'one' }));
    act(() => { vi.advanceTimersByTime(60); });
    fireEvent.blur(screen.getByRole('link', { name: 'one' }));
    fireEvent.focus(screen.getByRole('link', { name: 'two' }));
    act(() => { vi.advanceTimersByTime(60); });
    fireEvent.blur(screen.getByRole('link', { name: 'two' }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(calls).toHaveLength(0);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'one' }), { button: 2 });
    expect(calls).toHaveLength(0);
    fireEvent.pointerDown(screen.getByRole('link', { name: 'one' }), { button: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe('a navigation names its source', () => {
  beforeEach(() => { log.length = 0; });
  function Pendings({ names }: { readonly names: readonly string[] }) {
    return <>{names.map((n) => <Pend key={n} name={n} />)}</>;
  }
  function Pend({ name }: { readonly name: string }) { return <span data-testid={`pending-${name}`}>{String(usePendingFrom(name))}</span>; }
  const flag = (name: string) => screen.getByTestId(`pending-${name}`).textContent;
  function Undef() { return <span data-testid="undef">{String(usePendingFrom(undefined))}</span>; }
  function mountLinks(load: Route['load']) {
    const routes: Route[] = [
      { path: '/', render: () => <Index /> },
      { path: '/t/:id', load, key: (p) => p.id!, render: (p, doc) => <p>thread {p.id}: {String(doc)}</p> },
    ];
    window.history.replaceState(null, '', '/');
    function Shell() {
      return <><Probe /><Link to="/t/a" source="first">first link</Link><Link to="/t/a" source="second">second link</Link><Link to="/t/b" source="third">third link</Link><Pendings names={['first', 'second', 'third', 'x', 'y']} /><Undef /><Routes routes={routes} /></>;
    }
    return render(<KayfaProvider value={kayfa}><RouterProvider><Shell /></RouterProvider></KayfaProvider>);
  }

  test('pressing the second of two links to one route is pending for the second\'s source only, and landing ends it', async () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    expect(flag('first')).toBe('false');
    await userEvent.click(screen.getByRole('link', { name: 'second link' }));
    expect(flag('second')).toBe('true');
    expect(flag('first')).toBe('false');
    expect(navigation.pending?.source).toBe('second');
    await answer(calls[0], 'A1');
    expect(flag('second')).toBe('false');
    expect(flag('first')).toBe('false');
  });
  test('Escape ends the pending of the source that started the load', async () => {
    const { load } = manualLoader();
    mountLinks(load);
    await userEvent.click(screen.getByRole('link', { name: 'second link' }));
    expect(flag('second')).toBe('true');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(flag('second')).toBe('false');
    expect(flag('first')).toBe('false');
  });
  test('a failed load ends the pending too', async () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    await userEvent.click(screen.getByRole('link', { name: 'first link' }));
    expect(flag('first')).toBe('true');
    await act(async () => { calls[0]!.reject(new Error('down')); });
    expect(flag('first')).toBe('false');
  });
  test('navigate(to, { source }) is pending for that source, and usePendingFrom(undefined) is never true', async () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    act(() => nav('/t/a', { source: 'x' }));
    expect(flag('x')).toBe('true');
    expect(flag('first')).toBe('false');
    await answer(calls[0], 'A1');
    expect(flag('x')).toBe('false');
  });
  test('usePendingFrom(undefined) is false while a load with no source is out', () => {
    const { load } = manualLoader();
    mountLinks(load);
    act(() => {
      window.history.pushState(null, '', '/t/z');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(navigation.pending?.source).toBeNull();
    expect(screen.getByTestId('undef').textContent).toBe('false');
  });
  test('a load that replaces another moves the pending to the newer source', async () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    await userEvent.click(screen.getByRole('link', { name: 'first link' }));
    expect(flag('first')).toBe('true');
    await userEvent.click(screen.getByRole('link', { name: 'third link' }));
    expect(flag('first')).toBe('false');
    expect(flag('third')).toBe('true');
    await answer(calls[1], 'B1');
    expect(flag('first')).toBe('false');
    expect(flag('third')).toBe('false');
  });
  test('a cached Back that takes the place of a sourced load ends its pending', async () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => nav('/t/b'));
    await answer(calls[1], 'B1');
    act(() => nav('/t/c', { source: 'x' }));
    expect(flag('x')).toBe('true');
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByText('thread a: A1')).toBeInTheDocument());
    expect(flag('x')).toBe('false');
    expect(navigation.pending).toBeNull();
  });
  test('a same-key move, or a move to a route with no loader, ends a sourced load', async () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    act(() => nav('/t/a'));
    await answer(calls[0], 'A1');
    act(() => nav('/t/b', { source: 'x' }));
    expect(flag('x')).toBe('true');
    act(() => nav('/t/a?again', { source: 'y' }));
    expect(flag('x')).toBe('false');
    expect(flag('y')).toBe('false');
    expect(navigation.pending).toBeNull();
    act(() => nav('/t/b', { source: 'x' }));
    expect(flag('x')).toBe('true');
    act(() => nav('/', { source: 'y' }));
    expect(flag('x')).toBe('false');
    expect(flag('y')).toBe('false');
    expect(navigation.pending).toBeNull();
  });
  test('a navigate with no source has source null, and is pending for no source', () => {
    const { load } = manualLoader();
    mountLinks(load);
    act(() => nav('/t/a'));
    expect(navigation.pending?.source).toBeNull();
    expect(flag('x')).toBe('false');
    expect(flag('first')).toBe('false');
  });
  test('a link given no source names its own, and two links name different ones', async () => {
    const { load } = manualLoader();
    const routes: Route[] = [{ path: '/', render: () => <Index /> }, { path: '/t/:id', load, key: (p) => p.id!, render: () => <p>t</p> }];
    function Own() { const src = useNavigation().pending?.source; return <span data-testid="own">{String(usePendingFrom(src ?? undefined))}</span>; }
    window.history.replaceState(null, '', '/');
    render(<KayfaProvider value={kayfa}><RouterProvider><Probe /><Own /><Link to="/t/a">one</Link><Link to="/t/a">two</Link><Routes routes={routes} /></RouterProvider></KayfaProvider>);
    await userEvent.click(screen.getByRole('link', { name: 'one' }));
    const one = navigation.pending?.source;
    expect(typeof one).toBe('string');
    expect(screen.getByTestId('own').textContent).toBe('true');
    await userEvent.click(screen.getByRole('link', { name: 'two' }));
    const two = navigation.pending?.source;
    expect(typeof two).toBe('string');
    expect(two).not.toBe(one);
  });
  test('a popstate\'s load has source null', () => {
    const { load, calls } = manualLoader();
    mountLinks(load);
    act(() => {
      window.history.pushState(null, '', '/t/z');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(calls).toHaveLength(1);
    expect(navigation.pending).not.toBeNull();
    expect(navigation.pending?.source).toBeNull();
  });
});

describe('the navigation guard', () => {
  function Guarded({ guard }: { readonly guard: NavigationGuard }) { useNavigationGuard(guard); return null; }
  function Moves() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate('/signed-out', { afterAccountChange: true })}>account</button><button onClick={() => navigate('/')}>here</button></>;
  }
  const mountGuarded = (guard: NavigationGuard) => render(<RouterProvider><Guarded guard={guard} /><Link to="/a">a</Link><Moves /><Where /></RouterProvider>);
  const path = () => window.location.pathname;

  test('a guard that takes a link over stops it until it proceeds; Stay is never calling proceed', async () => {
    let proceed: () => void = () => undefined;
    const guard = vi.fn((p: () => void) => { proceed = p; return true; });
    mountGuarded(guard);
    await userEvent.click(screen.getByRole('link', { name: 'a' }));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(path()).toBe('/');
    expect(screen.getByTestId('path').textContent).toBe('/');
    act(() => proceed());
    expect(path()).toBe('/a');
    expect(screen.getByTestId('path').textContent).toBe('/a');
  });
  test('a guard that lets it go (false) does not stop it, and the same address is not asked', async () => {
    const guard = vi.fn(() => false);
    mountGuarded(guard);
    act(() => screen.getByText('here').click());
    expect(guard).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: 'a' }));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(path()).toBe('/a');
  });
  test('a move the account change makes is never asked', () => {
    const guard = vi.fn(() => true);
    mountGuarded(guard);
    act(() => screen.getByText('account').click());
    expect(guard).not.toHaveBeenCalled();
    expect(path()).toBe('/signed-out');
  });
  test('Back that the guard takes over is undone by the way it came: Stay changes no history, Leave goes to the entry Back named', async () => {
    let proceed: () => void = () => undefined;
    const guard = vi.fn((p: () => void) => { proceed = p; return true; });
    const open = { current: false };
    const wrapped: NavigationGuard = (p) => (open.current ? guard(p) : false);
    mountGuarded(wrapped);
    await userEvent.click(screen.getByRole('link', { name: 'a' }));
    expect(path()).toBe('/a');
    const length = window.history.length;
    open.current = true;
    act(() => window.history.back());
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(path()).toBe('/a'));
    expect(window.history.length).toBe(length);
    expect(screen.getByTestId('path').textContent).toBe('/a');
    /* Leave: the browser goes to the entry Back named, by history, and is not asked again. */
    open.current = false;
    act(() => proceed());
    await waitFor(() => expect(path()).toBe('/'));
    expect(screen.getByTestId('path').textContent).toBe('/');
    expect(window.history.length).toBe(length);
    expect(guard).toHaveBeenCalledTimes(1);
  });
  test('Forward is asked the same way, and Leave goes forward', async () => {
    let proceed: () => void = () => undefined;
    const open = { current: false };
    const guard = vi.fn((p: () => void) => { proceed = p; return open.current; });
    mountGuarded(guard);
    await userEvent.click(screen.getByRole('link', { name: 'a' }));
    act(() => window.history.back());
    await waitFor(() => expect(path()).toBe('/'));
    open.current = true;
    act(() => window.history.forward());
    await waitFor(() => expect(guard).toHaveBeenCalled());
    await waitFor(() => expect(path()).toBe('/'));
    expect(screen.getByTestId('path').textContent).toBe('/');
    open.current = false;
    act(() => proceed());
    await waitFor(() => expect(path()).toBe('/a'));
    expect(screen.getByTestId('path').textContent).toBe('/a');
  });
});
