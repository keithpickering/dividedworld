import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { SettingsScreen } from './Settings.tsx';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-kb-mode'); document.documentElement.removeAttribute('data-kb-motion'); });
afterEach(() => { cleanup(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  fake.signInAs(me);
  return { fake, me };
}
const open = (fake: ReturnType<typeof world>['fake']) => renderIn(fake, <SettingsScreen />, { path: '/settings' });

describe('Settings', () => {
  test('offers the device, light, dark and the instance\'s other themes, with the account\'s choice selected', async () => {
    open(world().fake);
    const theme = await screen.findByRole('group', { name: 'Theme' });
    for (const name of ['Device', 'Light', 'Dark', 'Sepia']) expect(await screen.findByRole('radio', { name: new RegExp(`^${name}`, 'u') })).toBeInTheDocument();
    expect(theme).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Device/u, checked: true })).toBeInTheDocument();
  });

  test('a theme applies at once and persists across a fresh load', async () => {
    const w = world();
    open(w.fake);
    await userEvent.click(await screen.findByRole('radio', { name: /^Dark/u }));
    expect(document.documentElement.getAttribute('data-kb-mode')).toBe('dark');
    await waitFor(async () => expect((await w.fake.preferences()).theme).toBe('dark'));
    cleanup();
    document.documentElement.removeAttribute('data-kb-mode');
    open(w.fake);
    expect(await screen.findByRole('radio', { name: /^Dark/u, checked: true })).toBeInTheDocument();
  });

  test('the post style persists across a fresh load', async () => {
    const w = world();
    open(w.fake);
    await userEvent.click(await screen.findByRole('radio', { name: /^Stacked/u }));
    await waitFor(async () => expect((await w.fake.preferences()).postbit).toBe('stacked'));
    cleanup();
    open(w.fake);
    expect(await screen.findByRole('radio', { name: /^Stacked/u, checked: true })).toBeInTheDocument();
  });

  test('motion applies at once and persists across a fresh load', async () => {
    const w = world();
    open(w.fake);
    await userEvent.click(await screen.findByRole('radio', { name: /^Reduce/u }));
    expect(document.documentElement.getAttribute('data-kb-motion')).toBe('reduce');
    await waitFor(async () => expect((await w.fake.preferences()).motion).toBe('reduce'));
    cleanup();
    open(w.fake);
    expect(await screen.findByRole('radio', { name: /^Reduce/u, checked: true })).toBeInTheDocument();
  });

  test('a refused save says so in the server\'s words and puts the choice back', async () => {
    const w = world();
    w.fake.setPreferences = async () => ({ ok: false, error: 'the postbit is side or stacked' });
    open(w.fake);
    await userEvent.click(await screen.findByRole('radio', { name: /^Stacked/u }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the postbit is side or stacked');
    expect(screen.getByRole('radio', { name: /^Side/u, checked: true })).toBeInTheDocument();
  });

  test('signing out ends the session and leaves for the index', async () => {
    const w = world();
    open(w.fake);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(async () => expect((await w.fake.session()).signedIn).toBe(false));
    expect(window.location.pathname).toBe('/');
  });

  test('signed out, it points to sign-in', async () => {
    const fake = buildWorld();
    open(fake);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});
