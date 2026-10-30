import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { addressOf, Link, RouterProvider, searchOf, useLocation, useNavigate, type Location } from './router.tsx';

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
