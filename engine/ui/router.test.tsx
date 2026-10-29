import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { Link, RouterProvider, useLocation, useNavigate } from './router.tsx';

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
});
