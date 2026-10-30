import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_PREFERENCES, type Answer, type Preferences } from '../data/api.ts';
import { Smoke } from '../glass/Smoke.tsx';
import { applyAppearance } from '../appearance.ts';
import { buildWorld, renderIn, testGlass } from '../test-world.tsx';
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

  test('Motion\'s sentence names the instance\'s own card, in the instance\'s words', async () => {
    open(world().fake);
    await screen.findByRole('radiogroup', { name: 'Motion' });
    expect(screen.getByText('Reduced stops the drifting smoke, the pulses and the orb shine. A card\'s effect stays: the test card still moves you, only instantly.')).toBeInTheDocument();
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

  /** Text size changed twice before either save is answered: 100, then 125, then 150. */
  async function twice() {
    const w = world();
    const calls: { patch: Partial<Preferences>; settle: (a: Answer<Preferences>) => void }[] = [];
    w.fake.setPreferences = (patch) => new Promise((settle) => { calls.push({ patch, settle }); });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Text size' });
    await userEvent.click(radio('Text size', '125%'));
    await userEvent.click(radio('Text size', '150%'));
    return calls;
  }

  test('the same choice made twice, the first save refused and the second kept: the screen keeps the second', async () => {
    const calls = await twice();
    calls[0]!.settle({ ok: false, error: 'text size is 100, 125, 150 or 200 percent' });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(radio('Text size', '150%')).toBeChecked();
    calls[1]!.settle({ ok: true, value: { ...DEFAULT_PREFERENCES, textSize: 150 } });
    await screen.findByRole('alert');
    expect(radio('Text size', '150%')).toBeChecked();
    expect(document.documentElement).toHaveAttribute('data-kb-text-size', '150');
  });

  test('the same choice made twice and both saves refused: the screen goes back to what the account last held', async () => {
    const calls = await twice();
    calls[0]!.settle({ ok: false, error: 'text size is 100, 125, 150 or 200 percent' });
    await waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.settle({ ok: false, error: 'text size is 100, 125, 150 or 200 percent' });
    await waitFor(() => expect(radio('Text size', '100%')).toBeChecked());
    expect(document.documentElement).not.toHaveAttribute('data-kb-text-size');
  });

  /*
   * A save still out when the account changes: the app's Appearance has already put the next
   * account's look on the root (the defaults signed out), and the old account's answer must not put
   * its own back. The account here had smoke off and asks for 200% text before it leaves.
   */
  async function leaving(next: 'signed out' | 'another account') {
    const w = world();
    await w.fake.setPreferences({ smoke: 'off' });
    const calls: { settle: (a: Answer<Preferences>) => void }[] = [];
    w.fake.setPreferences = () => new Promise((settle) => { calls.push({ settle }); });
    const view = open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Text size' });
    await userEvent.click(radio('Text size', '200%'));
    expect(document.documentElement).toHaveAttribute('data-kb-text-size', '200');
    const other = w.fake.seed.account('other');
    /* The next account's own preferences are still on their way when the old account's answer comes. */
    w.fake.preferences = () => new Promise(() => {});
    w.fake.signInAs(next === 'signed out' ? null : other);
    /* The change reaches the screen, as it reaches the app's Appearance in the same render. */
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    /* What Appearance does on the account's change: the defaults, signed out or before the next account's own arrive. */
    applyAppearance(document, DEFAULT_PREFERENCES, [{ key: 'house', name: 'House', href: '/house.css', modes: 'both' }], testGlass);
    await waitFor(() => expect(calls).toHaveLength(1));
    return { calls, view };
  }
  const isDefault = () => {
    for (const m of ['data-kb-smoke-level', 'data-kb-contrast', 'data-kb-text-size']) expect(document.documentElement).not.toHaveAttribute(m);
  };

  for (const next of ['signed out', 'another account'] as const) {
    test(`a refused save that answers after the account changed (${next}) puts nothing of the old account back`, async () => {
      const { calls } = await leaving(next);
      await act(async () => { calls[0]!.settle({ ok: false, error: 'text size is 100, 125, 150 or 200 percent' }); await Promise.resolve(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      isDefault();
    });
    test(`a kept save that answers after the account changed (${next}) puts nothing of the old account back`, async () => {
      const { calls } = await leaving(next);
      await act(async () => { calls[0]!.settle({ ok: true, value: { ...DEFAULT_PREFERENCES, smoke: 'off', textSize: 200 } }); await Promise.resolve(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      isDefault();
    });
  }

  /*
   * Settings left open while the session changes in another tab: the next account's own address and
   * preferences are on their way (here, never answering), and the screen must show neither the last
   * account's address nor its choices meanwhile, nor say the address could not be read.
   */
  for (const via of ['another account', 'signed out, then another account'] as const) {
    /** Open Settings at `path` as an account whose smoke is off, then change accounts while the next one's reads are still out. */
    async function switched(path: string, ready: () => Promise<unknown>) {
      const w = world();
      await w.fake.setPreferences({ smoke: 'off' });
      const mine = (await w.fake.signInAddress())!;
      open(w.fake, path);
      await ready();
      w.fake.preferences = () => new Promise(() => {});
      w.fake.signInAddress = () => new Promise(() => {});
      const other = w.fake.seed.account('other');
      if (via !== 'another account') {
        w.fake.signInAs(null);
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      w.fake.signInAs(other);
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      return mine;
    }
    test(`with Settings › Account open, ${via} signing in never shows the last account's address`, async () => {
      const mine = await switched('/settings?section=account', () => screen.findByText(/@/u));
      expect(screen.queryByText(mine)).toBeNull();
      expect(screen.queryByText(/could not be read/u)).toBeNull();
    });
    test(`with Settings › Accessibility open, ${via} signing in never shows the last account's choices`, async () => {
      await switched('/settings', () => screen.findByRole('radiogroup', { name: 'Smoke' }));
      expect(screen.queryByRole('radiogroup', { name: 'Smoke' })).toBeNull();
    });
  }

  test('the same account signing out and back in, a choice made before its read answers keeps every other choice and is sent', async () => {
    const w = world();
    await w.fake.setPreferences({ smoke: 'off', textSize: 150 });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    const reads: (() => void)[] = [];
    const real = w.fake.preferences.bind(w.fake);
    w.fake.preferences = () => new Promise((done) => { reads.push(() => done(real())); });
    w.fake.signInAs(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    w.fake.signInAs(w.me);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    /* The account's own choices, read before it signed out, stand while its read is out again. */
    await userEvent.click(radio('Contrast', 'High'));
    expect(radio('Text size', '150%')).toBeChecked();
    expect(radio('Smoke', 'Off')).toBeChecked();
    await act(async () => { for (const r of reads) r(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(async () => expect(await real()).toMatchObject({ contrast: 'high', textSize: 150, smoke: 'off' }));
  });

  test('a save whose answer cannot be read ends nothing: it is said, and the next choice is still sent', async () => {
    const w = world();
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    const real = w.fake.setPreferences.bind(w.fake);
    let first = true;
    w.fake.setPreferences = (patch) => {
      if (first) { first = false; return Promise.resolve(undefined as unknown as Answer<Preferences>); }
      return real(patch);
    };
    await userEvent.click(radio('Smoke', 'Off'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(radio('Contrast', 'High'));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ contrast: 'high' }));
  });

  test('the next account\'s choices answered but its address still out, Settings › Account shows no address of the last account', async () => {
    const w = world();
    const mine = (await w.fake.signInAddress())!;
    open(w.fake, '/settings?section=account');
    expect(await screen.findByText(mine)).toBeInTheDocument();
    w.fake.signInAddress = () => new Promise(() => {});
    w.fake.signInAs(w.fake.seed.account('other'));
    await screen.findByRole('heading', { name: 'Account' });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText(mine)).toBeNull();
    expect(screen.queryByText(/could not be read/u)).toBeNull();
  });

  test('a refused save that answers after the screen is gone puts nothing back', async () => {
    const { calls, view } = await leaving('signed out');
    view.unmount();
    calls[0]!.settle({ ok: false, error: 'text size is 100, 125, 150 or 200 percent' });
    await new Promise((r) => setTimeout(r, 0));
    isDefault();
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
