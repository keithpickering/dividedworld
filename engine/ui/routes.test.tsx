import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { RouterProvider } from './router.tsx';
import { buildWorld, renderIn } from './test-world.tsx';
import { match, Routes } from './routes.tsx';

describe('the routes', () => {
  test('a pattern matches its segments and names its params', () => {
    expect(match('/t/:thread', '/t/abc')).toEqual({ thread: 'abc' });
    expect(match('/t/:thread', '/t/abc/more')).toBeNull();
    expect(match('/', '/')).toEqual({});
    expect(match('/b/:slug', '/t/x')).toBeNull();
  });
  test('an address that matches nothing says so and links to the index', () => {
    window.history.pushState(null, '', '/nowhere');
    render(<RouterProvider><Routes routes={[{ path: '/', render: () => <p>index</p> }]} /></RouterProvider>);
    expect(screen.getByRole('heading', { name: 'The page cannot be found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'index' })).toHaveAttribute('href', '/');
  });
});

describe('from the Task 3 quality review', () => {
  test('a malformed address matches nothing rather than throwing', () => {
    expect(match('/t/:thread', '/t/%E0%A4%A')).toBeNull();
  });
});

describe('the failure screens', () => {
  const failing = [{ path: '/t/:thread', load: () => Promise.reject(new Error('down')), render: () => <p>thread</p> }];
  const failures = {
    display: vi.fn(({ address }: { address: string; onRetry: () => void }) => <p>glass display {address}</p>),
    find: vi.fn(({ address }: { address: string }) => <p>glass find {address}</p>),
  };

  test('with failures, a failed load draws the glass screen for it', async () => {
    renderIn(buildWorld(), <Routes routes={failing} failures={failures} />, { path: '/t/3f2a9c1e' });
    expect(await screen.findByText('glass display /t/3f2a9c1e')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The page cannot be displayed' })).toBeNull();
    expect(failures.display).toHaveBeenCalledWith(expect.objectContaining({ address: '/t/3f2a9c1e', onRetry: expect.any(Function) }));
  });

  test('with failures, an address no route matches draws the glass find screen', () => {
    renderIn(buildWorld(), <Routes routes={failing} failures={failures} />, { path: '/nowhere' });
    expect(screen.getByText('glass find /nowhere')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The page cannot be found' })).toBeNull();
  });

  test('without failures, a failed load draws the board screen', async () => {
    renderIn(buildWorld(), <Routes routes={failing} />, { path: '/t/3f2a9c1e' });
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
  });
});
