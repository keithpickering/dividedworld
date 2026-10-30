/**
 * The page shell every glass page sits in: the menu bar, the smoke of its surface, and the content
 * column, which is the page's `main`. A move between glass pages reads as one, as the frame's does.
 */
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { renderInWorld } from '../test-world.tsx';
import { Page } from './Page.tsx';

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

/* jsdom has no scrolling: the page's move to its top is watched instead. */
const scrolled = vi.fn();
beforeEach(() => { scrolled.mockReset(); vi.stubGlobal('scrollTo', scrolled); });
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('the glass page', () => {
  test('holds the menu bar, the smoke of its surface behind, and the content in main', async () => {
    const { container } = renderInWorld(<Page surface="settings"><h1>Settings</h1></Page>, { path: '/settings', seed: signedIn });
    expect(await screen.findByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    const smoke = container.querySelector('.kb-smoke');
    expect(smoke).toHaveAttribute('data-kb-surface', 'settings');
    expect(smoke).toHaveAttribute('aria-hidden', 'true');
    /* The board's banner and HUD are not on a glass page. */
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Game HUD' })).toBeNull();
  });
  test('moving to another glass page puts focus at the top of the new page', async () => {
    renderInWorld(<Page surface="characters"><p>page</p></Page>, { path: '/characters', seed: signedIn });
    await userEvent.click(await screen.findByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(scrolled).toHaveBeenCalledWith(0, 0);
  });
});

describe('from the Task 1.4 reviews', () => {
  test('as the frame does, an address with a fragment, or the browser\'s back and forward, keeps its own scroll', async () => {
    renderInWorld(<Page surface="characters"><p>page</p></Page>, { path: '/characters', seed: signedIn });
    await screen.findByRole('link', { name: 'Settings' });
    act(() => { window.history.pushState(null, '', '/settings#invites'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(scrolled).not.toHaveBeenCalled();
    act(() => { window.history.pushState(null, '', '/characters/new'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(scrolled).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
