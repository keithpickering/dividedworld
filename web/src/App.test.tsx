import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { createFake } from '../../engine/ui/data/fake.ts';
import { instance } from '../../instances/divided-world/index.ts';
import { App } from './App.tsx';
import { seedDemo } from './demo.ts';
import { fallbackSettings } from './data/settings.ts';

beforeEach(() => { localStorage.clear(); window.history.pushState(null, '', '/'); });

test('the app runs on the demo world: the frame, the HUD with its character and orbs', async () => {
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const hud = await screen.findByRole('region', { name: 'HUD' });
  await waitFor(() => expect(within(hud).getByRole('combobox', { name: 'Posting as' })).toBeInTheDocument());
  await waitFor(() => expect(within(hud).getByRole('img', { name: /^Wallet 2\.40 of 6 orbs, 0\.85 pending/ })).toBeInTheDocument());
  expect(screen.getByRole('banner')).toHaveTextContent('Divided World');
});

test('signing out puts the page back to the device\'s look', async () => {
  document.documentElement.removeAttribute('data-kb-mode');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  await fake.setPreferences({ theme: 'dark' });
  render(<App api={fake} />);
  await waitFor(() => expect(document.documentElement.getAttribute('data-kb-mode')).toBe('dark'));
  await fake.signOut();
  await waitFor(() => expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false));
  expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
});
