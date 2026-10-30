import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_PREFERENCES, type Answer, type Preferences } from '../data/api.ts';
import { Smoke } from '../glass/Smoke.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { SettingsScreen } from './Settings.tsx';

const MARKS = ['data-kb-mode', 'data-kb-motion', 'data-kb-smoke-level', 'data-kb-contrast', 'data-kb-text-size', 'data-kb-glass-key'];
beforeEach(() => { localStorage.clear(); for (const m of MARKS) document.documentElement.removeAttribute(m); });
afterEach(() => { cleanup(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  fake.signInAs(me);
  return { fake, me };
}
const open = (fake: ReturnType<typeof world>['fake'], path = '/settings') => renderIn(fake, <SettingsScreen />, { path });
const group = (name: string) => screen.getByRole('radiogroup', { name });
const radio = (groupName: string, name: string) => within(group(groupName)).getByRole('radio', { name });

/** Choose `name` in `groupName`, wait for the save, then load the screen afresh and find it still chosen. */
async function persists(w: ReturnType<typeof world>, groupName: string, name: string, saved: Partial<Preferences>, mark?: readonly [string, string]) {
  open(w.fake);
  await screen.findByRole('radiogroup', { name: groupName });
  await userEvent.click(radio(groupName, name));
  /* Applied at once, before the save is answered. */
  if (mark) expect(document.documentElement).toHaveAttribute(mark[0], mark[1]);
  await waitFor(async () => expect(await w.fake.preferences()).toMatchObject(saved));
  cleanup();
  for (const m of MARKS) document.documentElement.removeAttribute(m);
  open(w.fake);
  await screen.findByRole('radiogroup', { name: groupName });
  expect(radio(groupName, name)).toBeChecked();
}

describe('Settings, as board 11 draws it', () => {
  test('its sections are a navigation of Account and Accessibility, and the page opens on Accessibility', async () => {
    open(world().fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Account', 'Accessibility']);
    expect(within(nav).getByRole('link', { name: 'Accessibility' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/settings?section=account');
    expect(await screen.findByRole('heading', { level: 2, name: 'Accessibility' })).toBeInTheDocument();
    expect(screen.getByText('Changes save as you make them.')).toBeInTheDocument();
  });

  test('Accessibility offers each choice in the board\'s words, the account\'s own selected', async () => {
    open(world().fake);
    await screen.findByRole('radiogroup', { name: 'Motion' });
    const offered = (name: string) => within(group(name)).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent);
    expect(offered('Motion')).toEqual(['Follow my device', 'Reduced', 'Full']);
    expect(offered('Smoke')).toEqual(['Full', 'Low', 'Off']);
    expect(offered('Contrast')).toEqual(['Standard', 'High']);
    expect(offered('Text size')).toEqual(['100%', '125%', '150%', '200%']);
    /* The board's colors, then each theme the instance adds (the glass plan, section 9, choice 4). */
    expect(offered('The board')).toEqual(['Follow my device', 'Black on white', 'White on black', 'Sepia']);
    expect(offered('Posts')).toEqual(['Side by side', 'Stacked']);
    for (const [g, n] of [['Motion', 'Follow my device'], ['Smoke', 'Full'], ['Contrast', 'Standard'], ['Text size', '100%'], ['The board', 'Follow my device'], ['Posts', 'Side by side']] as const) {
      expect(radio(g, n)).toBeChecked();
    }
  });

  test('the board\'s colors and motion apply at once and persist across a fresh load', async () => {
    const w = world();
    await persists(w, 'The board', 'White on black', { theme: 'dark' }, ['data-kb-mode', 'dark']);
    cleanup();
    await persists(w, 'Motion', 'Reduced', { motion: 'reduce' }, ['data-kb-motion', 'reduce']);
  });

  test('the post style persists across a fresh load', async () => {
    await persists(world(), 'Posts', 'Stacked', { postbit: 'stacked' });
  });

  test('smoke persists across a fresh load, and off draws no smoke element', async () => {
    const w = world();
    renderIn(w.fake, <><Smoke surface="settings" /><SettingsScreen /></>, { path: '/settings' });
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    expect(document.body.querySelector('[data-kb-smoke]')).not.toBeNull();
    await userEvent.click(radio('Smoke', 'Off'));
    expect(document.documentElement).toHaveAttribute('data-kb-smoke-level', 'off');
    await waitFor(() => expect(document.body.querySelector('[data-kb-smoke]')).toBeNull());
    expect(document.querySelector('[data-kb-ground]')).not.toBeNull();
    cleanup();
    await persists(w, 'Smoke', 'Off', { smoke: 'off' });
  });

  test('high contrast switches the glass to its high key at once and persists across a fresh load', async () => {
    const w = world();
    await persists(w, 'Contrast', 'High', { contrast: 'high' });
    await userEvent.click(radio('Contrast', 'Standard'));
    await userEvent.click(radio('Contrast', 'High'));
    expect(document.documentElement).toHaveAttribute('data-kb-contrast', 'high');
    expect(document.documentElement).toHaveAttribute('data-kb-glass-key', 'high');
  });

  test('a text size applies to the root at once and persists across a fresh load', async () => {
    const w = world();
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Text size' });
    await userEvent.click(radio('Text size', '200%'));
    expect(document.documentElement).toHaveAttribute('data-kb-text-size', '200');
    cleanup();
    await persists(w, 'Text size', '200%', { textSize: 200 });
  });

  test('a refused save says so in the server\'s words and puts the choice back', async () => {
    const w = world();
    w.fake.setPreferences = async () => ({ ok: false, error: 'the postbit is side or stacked' });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Posts' });
    await userEvent.click(radio('Posts', 'Stacked'));
    expect(await screen.findByRole('alert')).toHaveTextContent('the postbit is side or stacked');
    expect(radio('Posts', 'Side by side')).toBeChecked();
  });

  test('a save that gets no answer puts the choice back and says so', async () => {
    const w = world();
    w.fake.setPreferences = () => Promise.reject(new Error('offline'));
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'The board' });
    await userEvent.click(radio('The board', 'White on black'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no answer came back/iu);
    expect(radio('The board', 'Follow my device')).toBeChecked();
    expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false);
  });

  test('saves go one at a time, and a refusal puts back only its own choice', async () => {
    const w = world();
    const calls: { patch: Partial<Preferences>; settle: (a: Answer<Preferences>) => void }[] = [];
    w.fake.setPreferences = (patch) => new Promise((settle) => { calls.push({ patch, settle }); });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'The board' });
    await userEvent.click(radio('The board', 'White on black'));
    await userEvent.click(radio('Motion', 'Reduced'));
    expect(calls).toHaveLength(1);
    calls[0]!.settle({ ok: false, error: 'a theme is named in lowercase words joined by hyphens' });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.patch).toEqual({ motion: 'reduce' });
    calls[1]!.settle({ ok: true, value: { ...DEFAULT_PREFERENCES, motion: 'reduce' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('a theme is named in lowercase words joined by hyphens');
    expect(radio('The board', 'Follow my device')).toBeChecked();
    expect(radio('Motion', 'Reduced')).toBeChecked();
    expect(document.documentElement.getAttribute('data-kb-motion')).toBe('reduce');
    expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false);
  });

  test('"Saved to your account." is said in a region that is on the page before anything is saved', async () => {
    open(world().fake);
    await screen.findByRole('radiogroup', { name: 'Motion' });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  test('signed out, it points to sign-in', async () => {
    open(buildWorld());
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});

describe('Settings › Account', () => {
  test('shows the sign-in address plainly, not as a field, and invites with the cap said before it is hit', async () => {
    const w = world();
    open(w.fake, '/settings?section=account');
    expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
    const address = await screen.findByText(w.fake.emailOf(w.me));
    expect(address.closest('input, textarea, [contenteditable]')).toBeNull();
    expect(await screen.findByText(/You hold 0 of 2 open invites/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make an invite' })).toBeEnabled();
  });

  test('Sign out is at its foot: it ends the session and leaves for the index', async () => {
    const w = world();
    open(w.fake, '/settings?section=account');
    await screen.findByText(/You hold 0 of 2 open invites/u);
    const buttons = screen.getAllByRole('button');
    expect(buttons.at(-1)).toHaveAccessibleName('Sign out');
    await userEvent.click(buttons.at(-1)!);
    await waitFor(async () => expect((await w.fake.session()).signedIn).toBe(false));
    expect(window.location.pathname).toBe('/');
  });
});
