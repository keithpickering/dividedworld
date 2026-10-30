import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
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
  const hud = await screen.findByRole('region', { name: 'Game HUD' });
  await waitFor(() => expect(within(hud).getByRole('combobox', { name: 'Swap mask' })).toBeInTheDocument());
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
  expect(await within(await screen.findByRole('region', { name: 'Game HUD' })).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
});

test('the instance\'s glass is on the page: its standard key on the root, and its fonts in the font set', async () => {
  /* jsdom has no font set and no FontFace; the browser's are stood in for, as far as the app reaches. */
  const fonts = new Set<{ family: string }>();
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
  vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} });
  try {
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    await screen.findByRole('region', { name: 'Game HUD' });
    expect(document.documentElement.getAttribute('data-kb-glass-key')).toBe('standard');
    expect(document.documentElement.style.getPropertyValue('--kb-glass-ground')).toBe('#07050d');
    expect([...fonts].map((f) => f.family)).toContain('Anton');
  } finally {
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  }
});

/* Each glass route and what only its own screen shows, so the wrapped content is that screen's, unchanged. */
const OWN: readonly [string, () => HTMLElement][] = [
  ['/characters', () => screen.getByRole('heading', { level: 1, name: /^Your characters \(/ })],
  ['/characters/new', () => screen.getByRole('button', { name: 'Make the character' })],
  ['/characters/edit', () => screen.getByRole('heading', { level: 1, name: /^Edit / })],
  ['/invites', () => screen.getByRole('heading', { level: 1, name: 'Invites' })],
  ['/settings', () => screen.getByRole('button', { name: 'Sign out' })],
];

for (const [path, own] of OWN) {
  test(`${path} is a glass page: the menu bar and no banner or HUD, its own screen's content inside`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    expect(await screen.findByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
    /* A screen may swap its loading content for its own; what holds is that its own is there, in main. */
    await waitFor(() => expect(within(screen.getByRole('main')).getByText((_, el) => el === own())).toBeInTheDocument());
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Game HUD' })).toBeNull();
  });
}

/* The glass build's Task 2.2 restyles the characters pages: drawn on the glass, with no board panel; the rest keep it until their task. */
for (const [path, restyled] of [['/characters', true], ['/characters/new', true], ['/characters/edit', true], ['/settings', false]] as const) {
  test(`${path} is ${restyled ? 'restyled, with no board panel' : 'not restyled yet, on the board\'s panel'}`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(document.querySelector('main > .kb-glass-content-panel') !== null).toBe(!restyled);
  });
}

for (const path of ['/sign-in', '/register']) {
  test(`${path}, signed out, is a glass page with Back to the board alone`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    render(<App api={fake} />);
    const bar = await screen.findByRole('navigation', { name: 'Menu' });
    await waitFor(() => expect(within(bar).getAllByRole('link').map((a) => a.textContent)).toEqual(['Back to the board']));
    expect(screen.queryByRole('banner')).toBeNull();
  });
}

test('Invites is reached from Settings, standing in until it moves into Settings › Account', async () => {
  window.history.pushState(null, '', '/settings');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  await screen.findByRole('button', { name: 'Sign out' });
  await userEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Invites' }));
  expect(window.location.pathname).toBe('/invites');
  expect(await screen.findByRole('heading', { level: 1, name: 'Invites' })).toBeInTheDocument();
});
