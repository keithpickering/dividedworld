/**
 * GlassLink: the router's Link, with the glass's spinner after its text while its own load is out.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { RouterProvider } from '../router.tsx';
import { Routes, type Route } from '../routes.tsx';
import { GlassLink } from './Link.tsx';

const kayfa = { ui: { copy: { siteName: 'Test Board' } } } as unknown as Kayfa;

function mount() {
  let resolve: (d: unknown) => void = () => undefined;
  const load = vi.fn(() => new Promise<unknown>((r) => { resolve = r; }));
  const routes: Route[] = [
    { path: '/', render: () => <p>here</p> },
    { path: '/t/:id', load, key: (p) => p.id!, render: () => <p>there</p> },
  ];
  window.history.replaceState(null, '', '/');
  render(<KayfaProvider value={kayfa}><RouterProvider><GlassLink to="/t/a">First</GlassLink><GlassLink to="/t/a">Second</GlassLink><Routes routes={routes} /></RouterProvider></KayfaProvider>);
  return { land: async () => { await act(async () => { resolve('doc'); }); } };
}

describe('GlassLink', () => {
  test('is a link with its text and no spinner at rest', () => {
    mount();
    const link = screen.getByRole('link', { name: 'First' });
    expect(link).toHaveAttribute('href', '/t/a');
    expect(link.querySelector('.kb-spinner')).toBeNull();
    expect(link).not.toHaveAttribute('aria-busy');
  });

  test('shows the spinner after its text while its own load is out, not the other link\'s, and not after it lands', async () => {
    const { land } = mount();
    await userEvent.click(screen.getByRole('link', { name: 'Second' }));
    const second = screen.getByRole('link', { name: 'Second' });
    expect(second.querySelector('.kb-spinner')).not.toBeNull();
    expect(second).toHaveAttribute('data-kb-pending');
    expect(second.lastElementChild).toHaveClass('kb-spinner');
    expect(screen.getByRole('link', { name: 'First' }).querySelector('.kb-spinner')).toBeNull();
    await land();
    expect(screen.getByRole('link', { name: 'Second' }).querySelector('.kb-spinner')).toBeNull();
  });

  test('keeps its accessible name while spinning', async () => {
    mount();
    await userEvent.click(screen.getByRole('link', { name: 'First' }));
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
  });
});
