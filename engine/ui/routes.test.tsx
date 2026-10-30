import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { RouterProvider } from './router.tsx';
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
    expect(screen.getByRole('heading', { name: 'No such page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the index' })).toHaveAttribute('href', '/');
  });
});

describe('from the Task 3 quality review', () => {
  test('a malformed address matches nothing rather than throwing', () => {
    expect(match('/t/:thread', '/t/%E0%A4%A')).toBeNull();
  });
});
