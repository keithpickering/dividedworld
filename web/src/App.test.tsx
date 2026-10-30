import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createFake } from '../../engine/ui/data/fake.ts';
import { instance } from '../../instances/divided-world/index.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';
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

/*
 * A device shared by two players: the session changes under an open screen (another tab signed the
 * other in), and nothing the last account typed or was told stays on the screen for the next one.
 * Each signed-in screen starts afresh for the account signed in now.
 */
test('another account signing in starts the open screen afresh: the last account\'s draft is not left for the next', async () => {
  window.history.pushState(null, '', '/characters/new');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const field = await screen.findByRole('textbox', { name: /name/iu });
  await userEvent.click(field);
  await userEvent.paste('Zzyzx the Draft');
  expect(field).toHaveValue('Zzyzx the Draft');
  fake.signInAs(fake.seed.account('next'));
  await waitFor(() => expect(screen.getByRole('textbox', { name: /name/iu })).not.toHaveValue('Zzyzx the Draft'));
  expect(screen.queryByDisplayValue('Zzyzx the Draft')).toBeNull();
}, 15_000);

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
  ['/settings', () => screen.getByRole('radiogroup', { name: 'Smoke' })],
  ['/rankings', () => screen.getByRole('heading', { level: 1, name: 'Rankings' })],
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

/* The glass build's Tasks 2.2 and 2.4 restyle the characters pages and Settings: drawn on the glass, with no board panel. */
for (const path of ['/characters', '/characters/new', '/characters/edit', '/settings'] as const) {
  test(`${path} is drawn on the glass, with no board panel`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(document.querySelector('.kb-glass-content-panel')).toBeNull();
  });
}

test('/rankings is drawn on the glass with no board panel, and its menu bar tab is the current page', async () => {
  window.history.pushState(null, '', '/rankings');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const bar = await screen.findByRole('navigation', { name: 'Menu' });
  await screen.findByRole('heading', { level: 1, name: 'Rankings' });
  expect(screen.getByRole('main').querySelector('.kb-glass-content-panel')).toBeNull();
  expect(screen.getByRole('main').closest('[data-kb-surface]')).toHaveAttribute('data-kb-surface', 'rankings');
  expect(within(bar).getByRole('link', { name: 'Rankings' })).toHaveAttribute('aria-current', 'page');
});

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

test('/invites opens Settings › Account, where invites now live, and keeps the address working', async () => {
  window.history.pushState(null, '', '/invites');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
  expect(window.location.pathname + window.location.search).toBe('/settings?section=account');
  expect(await screen.findByRole('button', { name: 'Make an invite' })).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
});

test('the restyled account screens draw on the glass itself, with no board panel', async () => {
  for (const path of ['/settings', '/sign-in', '/register']) {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    if (path === '/settings') seedDemo(fake);
    const view = render(<App api={fake} />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(document.querySelector('.kb-glass-content-panel'), path).toBeNull();
    view.unmount();
  }
});

test('the account\'s glass preferences are applied as the app loads them: smoke, the high key and the text size', async () => {
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  await fake.setPreferences({ smoke: 'off', contrast: 'high', textSize: 200 });
  render(<App api={fake} />);
  const root = document.documentElement;
  await waitFor(() => expect(root).toHaveAttribute('data-kb-glass-key', 'high'));
  expect(root).toHaveAttribute('data-kb-smoke-level', 'off');
  expect(root).toHaveAttribute('data-kb-contrast', 'high');
  expect(root).toHaveAttribute('data-kb-text-size', '200');
  expect(root.style.getPropertyValue('--kb-glass-text')).toBe(instanceUi.glass.keys.high['--kb-glass-text']!.value);
  /* The Game HUD's own smoke follows the preference: none drawn. */
  const hud = await screen.findByRole('region', { name: 'Game HUD' });
  await waitFor(() => expect(hud.querySelector('[data-kb-smoke]')).toBeNull());
  await fake.signOut();
  await waitFor(() => expect(root).toHaveAttribute('data-kb-glass-key', 'standard'));
  expect(root).not.toHaveAttribute('data-kb-text-size');
});
