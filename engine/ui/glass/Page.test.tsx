/**
 * The page shell every glass page sits in: the menu bar, the smoke of its surface, and the content
 * column, which is the page's `main`. A move between glass pages reads as one, as the frame's does.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { renderInWorld } from '../test-world.tsx';
import { Page } from './Page.tsx';

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

afterEach(() => { document.body.innerHTML = ''; });

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
  });
});
