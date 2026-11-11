import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { resetTilt, tiltState } from '../shine/tilt.ts';
import { DEFAULT_PREFERENCES, type Answer, type Preferences, type PreferencesPatch } from '../data/api.ts';
import { Smoke } from '../glass/Smoke.tsx';
import { Page } from '../glass/Page.tsx';
import { applyAppearance } from '../appearance.ts';
import { buildWorld, holdReads, renderIn, testGlass } from '../test-world.tsx';
import { SIGNED_OUT_DOC } from '../screen-docs.ts';
import { SettingsScreen } from './Settings.tsx';
import { onToastChoice } from '../alerts/toast-choice.ts';
import { LoadedSettings } from '../loaded.tsx';
import { fakeSound } from '../audio/test-sound.ts';
import { resetSound } from '../audio/sound.ts';
import type { SoundsUi } from '../audio/types.ts';

const MARKS = ['data-kb-mode', 'data-kb-motion', 'data-kb-motion-feel', 'data-kb-smoke-level', 'data-kb-contrast', 'data-kb-text-size', 'data-kb-effects', 'data-kb-glass-key'];
beforeEach(() => { localStorage.clear(); for (const m of MARKS) document.documentElement.removeAttribute(m); });
afterEach(() => { cleanup(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  fake.signInAs(me);
  return { fake, me };
}
const open = (fake: ReturnType<typeof world>['fake'], path = '/settings') => renderIn(fake, <LoadedSettings />, { path });
const group = (name: string) => screen.getByRole('radiogroup', { name });
const radio = (groupName: string, name: string) => within(group(groupName)).getByRole('radio', { name });

/** Choose `name` in `groupName`, wait for the save, then load the screen afresh and find it still chosen. */
async function persists(w: ReturnType<typeof world>, groupName: string, name: string, saved: Partial<Preferences>, mark?: readonly [string, string], path = '/settings') {
  open(w.fake, path);
  await screen.findByRole('radiogroup', { name: groupName });
  await userEvent.click(radio(groupName, name));
  /* Applied at once, before the save is answered. */
  if (mark) expect(document.documentElement).toHaveAttribute(mark[0], mark[1]);
  await waitFor(async () => expect(await w.fake.preferences()).toMatchObject(saved));
  cleanup();
  for (const m of MARKS) document.documentElement.removeAttribute(m);
  open(w.fake, path);
  await screen.findByRole('radiogroup', { name: groupName });
  expect(radio(groupName, name)).toBeChecked();
}

/** The save note's live region; the Tilt row has its own status beside it. */
const saveNote = () => document.querySelector('.kb-acct-note[role="status"]');

describe('Settings, as board 11 draws it', () => {
  test('every section of the frame ends with a link to reach a person', async () => {
    const w = world();
    open(w.fake);
    expect(await screen.findByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
    cleanup();
    open(w.fake, '/settings?section=account');
    await screen.findByRole('heading', { name: 'Account' });
    expect(screen.getAllByRole('link', { name: 'Reach a person' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
  });

  test('Reach a person stands right after the section rail, ruled off, a sibling of the navigation, and not stranded at the foot of the page', async () => {
    open(world().fake, '/settings?section=account');
    const rail = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(rail).queryByRole('link', { name: 'Reach a person' })).toBeNull();
    const reach = screen.getByRole('link', { name: 'Reach a person' });
    const last = within(rail).getByRole('link', { name: 'Notifications' });
    expect(rail.nextElementSibling).toContainElement(reach);
    expect(last.compareDocumentPosition(reach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Reach a person' })).toHaveLength(1);
  });

  test('signed out, with no rail, Reach a person is still there', async () => {
    const fake = buildWorld();
    open(fake);
    expect(await screen.findByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
  });

  test('its sections are a navigation of Account, Accessibility, Sound, The board and Notifications, and the page opens on Accessibility', async () => {
    open(world().fake);
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Account', 'Accessibility', 'Sound', 'The board', 'Notifications']);
    expect(within(nav).getByRole('link', { name: 'Accessibility' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/settings?section=account');
    expect(await screen.findByRole('heading', { level: 2, name: 'Accessibility' })).toBeInTheDocument();
    expect(screen.getByText('Changes save as you make them.')).toBeInTheDocument();
  });

  test('Accessibility offers each choice in the board\'s words, the account\'s own selected', async () => {
    open(world().fake);
    await screen.findByRole('radiogroup', { name: 'Motion' });
    const offered = (name: string) => within(group(name)).getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent);
    expect(offered('Motion')).toEqual(['Follow my device', 'Off', 'Smooth', 'Snappy']);
    expect(offered('Smoke')).toEqual(['Full', 'Low', 'Off']);
    expect(offered('Contrast')).toEqual(['Standard', 'High']);
    expect(offered('Text size')).toEqual(['100%', '125%', '150%', '200%']);
    expect(offered('Brighter effects')).toEqual(['Off', 'On']);
    expect(screen.getByText('Let card effects on posts use their full colors, even below the usual contrast standard. Some posts may be harder to read.')).toBeInTheDocument();
    /* The board's look is its own section now (Settings › The board), not a row here. */
    expect(screen.queryByRole('radiogroup', { name: 'The board' })).toBeNull();
    expect(offered('Posts')).toEqual(['Side by side', 'Stacked']);
    for (const [g, n] of [['Motion', 'Follow my device'], ['Smoke', 'Full'], ['Contrast', 'Standard'], ['Text size', '100%'], ['Brighter effects', 'Off'], ['Posts', 'Side by side']] as const) {
      expect(radio(g, n)).toBeChecked();
    }
  });

  test('Motion\'s sentence names the instance\'s own card, in the instance\'s words', async () => {
    open(world().fake);
    await screen.findByRole('radiogroup', { name: 'Motion' });
    expect(screen.getByText('Off stops every animation. A card\'s effect still happens: the test card still moves you, only instantly. Smooth and Snappy are two speeds of the same animations.')).toBeInTheDocument();
  });

  test('the board\'s colors and motion apply at once and persist across a fresh load', async () => {
    const w = world();
    await persists(w, 'Mode', 'Dark', { theme: 'default', mode: 'dark' }, ['data-kb-mode', 'dark'], '/settings?section=board');
    cleanup();
    await persists(w, 'Motion', 'Off', { motion: 'reduce' }, ['data-kb-motion', 'reduce']);
  });

  test('the post style persists across a fresh load', async () => {
    await persists(world(), 'Posts', 'Stacked', { postbit: 'stacked' });
  });

  test('smoke persists across a fresh load, and off draws no smoke element', async () => {
    const w = world();
    renderIn(w.fake, <><Smoke surface="settings" /><LoadedSettings /></>, { path: '/settings' });
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

  test('Brighter effects marks the root at once and persists across a fresh load', async () => {
    const w = world();
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Brighter effects' });
    expect(document.documentElement).not.toHaveAttribute('data-kb-effects');
    await userEvent.click(radio('Brighter effects', 'On'));
    expect(document.documentElement).toHaveAttribute('data-kb-effects', 'bright');
    cleanup();
    await persists(w, 'Brighter effects', 'On', { effects: 'bright' });
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
    open(w.fake, '/settings?section=board');
    await screen.findByRole('radiogroup', { name: 'Mode' });
    await userEvent.click(radio('Mode', 'Dark'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no answer came back/iu);
    expect(radio('Mode', 'Follow my device')).toBeChecked();
    expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false);
  });

  test('saves go one at a time, and a refusal puts back only its own choice', async () => {
    const w = world();
    const calls: { patch: PreferencesPatch; settle: (a: Answer<Preferences>) => void }[] = [];
    w.fake.setPreferences = (patch) => new Promise((settle) => { calls.push({ patch, settle }); });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    await userEvent.click(radio('Smoke', 'Off'));
    await userEvent.click(radio('Motion', 'Off'));
    expect(calls).toHaveLength(1);
    calls[0]!.settle({ ok: false, error: 'the smoke is full, low or off' });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.patch).toEqual({ motion: 'reduce' });
    calls[1]!.settle({ ok: true, value: { ...DEFAULT_PREFERENCES, motion: 'reduce' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('the smoke is full, low or off');
    expect(radio('Smoke', 'Full')).toBeChecked();
    expect(radio('Motion', 'Off')).toBeChecked();
    expect(document.documentElement.getAttribute('data-kb-motion')).toBe('reduce');
    expect(document.documentElement.getAttribute('data-kb-smoke-level')).toBeNull();
  });

  test('the Tips row is a switch and two buttons in plain words, the switch on while tips are on', async () => {
    open(world().fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    expect(screen.getByRole('heading', { level: 3, name: 'Tips' })).toBeInTheDocument();
    expect(tips).toBeChecked();
    expect(screen.getByRole('button', { name: 'Show tips again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay the HUD tour' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show card tips again' })).toBeNull();
    /* Plain and true: it says what each control does, including what turning tips on does not bring back. */
    const says = document.getElementById(tips.getAttribute('aria-describedby')!)!.textContent!;
    expect(says).toMatch(/Off hides every tip and card note\./u);
    expect(says).toMatch(/On shows the ones you have not read yet\./u);
    expect(says).toMatch(/Show tips again also brings back the ones you have read/u);
    expect(says).toMatch(/Replay the HUD tour shows the three steps of the tour again/u);
  });

  test('the switch off skips the tips, on resumes them without forgetting, and the screen says it saved', async () => {
    const w = world();
    await w.fake.seeTip('grid');
    open(w.fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    await userEvent.click(tips);
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'off', tipsSeen: ['grid'] }));
    expect(tips).not.toBeChecked();
    await waitFor(() => expect(saveNote()).toHaveTextContent('Saved to your account.'));
    await userEvent.click(tips);
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on', tipsSeen: ['grid'] }));
    expect(tips).toBeChecked();
  });

  test('"Show tips again" turns tips on and forgets the tips seen and the cards met; "Replay the HUD tour" forgets the tour alone', async () => {
    const w = world();
    for (const k of ['grid', 'tour-plate']) await w.fake.seeTip(k);
    await w.fake.meetCard('whoops');
    await w.fake.skipTips();
    open(w.fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    expect(tips).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Replay the HUD tour' }));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on', tipsSeen: ['grid'], cardsMet: ['whoops'] }));
    expect(tips).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Show tips again' }));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on', tipsSeen: [], cardsMet: [] }));
    await waitFor(() => expect(saveNote()).toHaveTextContent('Saved to your account.'));
    /* A spent button stays where it is: a keyboard player is not dropped to the page. */
    expect(screen.getByRole('button', { name: 'Show tips again' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a refused tips control is said and leaves the switch where the account has it', async () => {
    const w = world();
    w.fake.skipTips = async () => ({ ok: false, error: 'try again later' });
    open(w.fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    await userEvent.click(tips);
    expect(await screen.findByRole('alert')).toHaveTextContent('try again later');
    expect(tips).toBeChecked();
    w.fake.restoreTips = async () => ({ ok: false, error: 'not now' });
    await userEvent.click(screen.getByRole('button', { name: 'Show tips again' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not now'));
  });

  test('the switch clicked off and on again with the first save held: the switch shows each click at once and the account ends on', async () => {
    const w = world();
    const held: { settle: () => void }[] = [];
    const skip = w.fake.skipTips.bind(w.fake);
    w.fake.skipTips = () => new Promise((resolve) => { held.push({ settle: () => resolve(skip()) }); });
    open(w.fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    await userEvent.click(tips);
    expect(tips).not.toBeChecked();
    await userEvent.click(tips);
    expect(tips).toBeChecked();
    held[0]!.settle();
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on' }));
    expect(tips).toBeChecked();
  });

  test('a choice made while Show tips again is out does not leave the switch off once the account answers on', async () => {
    const w = world();
    await w.fake.skipTips();
    const held: { settle: () => void }[] = [];
    const restore = w.fake.restoreTips.bind(w.fake);
    w.fake.restoreTips = () => new Promise((resolve) => { held.push({ settle: () => resolve(restore()) }); });
    open(w.fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    expect(tips).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Show tips again' }));
    await userEvent.click(radio('Smoke', 'Off'));
    held[0]!.settle();
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on' }));
    await waitFor(() => expect(tips).toBeChecked());
  });

  test('from the keyboard: Space flips the switch, Enter presses Show tips again and Replay the HUD tour', async () => {
    const w = world();
    await w.fake.seeTip('grid');
    open(w.fake);
    const tips = await screen.findByRole('switch', { name: 'Tips' });
    tips.focus();
    await userEvent.keyboard(' ');
    await waitFor(async () => expect((await w.fake.preferences()).tips).toBe('off'));
    expect(tips).not.toBeChecked();
    const again = screen.getByRole('button', { name: 'Show tips again' });
    again.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on', tipsSeen: [] }));
    await w.fake.seeTip('tour-plate');
    await w.fake.seeTip('grid');
    const replay = screen.getByRole('button', { name: 'Replay the HUD tour' });
    replay.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ tips: 'on', tipsSeen: ['grid'] }));
  });

  /** Text size changed twice before either save is answered: 100, then 125, then 150. */
  async function twice() {
    const w = world();
    const calls: { patch: PreferencesPatch; settle: (a: Answer<Preferences>) => void }[] = [];
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
    applyAppearance(document, DEFAULT_PREFERENCES, [{ key: 'house', name: 'House', href: '/house.css', modes: 'both', preview: {} }], testGlass);
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
    /* Put back, as a lost answer is. */
    expect(radio('Smoke', 'Full')).toBeChecked();
    await userEvent.click(radio('Contrast', 'High'));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ contrast: 'high' }));
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
    expect(saveNote()).toBeEmptyDOMElement();
  });

  test('signed out, it points to sign-in', async () => {
    open(buildWorld());
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});

describe('Settings › Notifications', () => {
  const WORDS: readonly (readonly [string, string])[] = [
    ['Quotes', 'A post quotes one of your characters.'],
    ['Words put in your mouth', 'A post quotes one of your characters saying something they did not.'],
    ['Cards on yours', 'A card is played on one of your posts.'],
    ['Cards an admin ended', 'An admin ended a card one of your characters played.'],
    ['Traps that hit', 'A face-down card struck one of your posts, or a trap caught a card you cast.'],
    ['Traps you set', 'A card you set face down sprang.'],
    ['Rulings', 'A ruling lands on one of your characters.'],
    ['Settlements', 'A settlement is in and moved your characters.'],
    ['Updates', 'The developer posts an update.'],
    ['Followed threads', 'A thread you follow has new posts.'],
    ['Hints', 'A hint says one of your posts or cards is drawing a pattern of reactions.'],
    ['Season news', 'The season has news: results, debuts and Turns, a new Boss.'],
  ];
  const at = '/settings?section=notifications';
  const kindSwitch = (name: string) => screen.getByRole('switch', { name });
  const reset = () => screen.getByRole('button', { name: 'Reset to defaults' });

  test('it lists a switch for each kind of alert, in plain words, each on or off as the instance\'s defaults say', async () => {
    const { fake } = world();
    renderIn(fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote', 'hint'] } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label') ?? el.closest('.kb-acct-row')?.querySelector('h3')?.textContent)).toEqual(WORDS.map(([n]) => n));
    for (const [name, sentence] of WORDS) {
      expect(kindSwitch(name)).toHaveAccessibleDescription(expect.stringContaining(sentence));
      const on = name === 'Quotes' || name === 'Hints';
      if (on) expect(kindSwitch(name)).toBeChecked(); else expect(kindSwitch(name)).not.toBeChecked();
      expect(kindSwitch(name)).toHaveAccessibleDescription(expect.stringContaining(on ? 'Toasts by default.' : 'Quiet by default.'));
    }
    expect(screen.getByText(/Every alert still counts and waits in Alerts/)).toBeInTheDocument();
    expect(screen.getByText('You have not chosen, so the defaults hold.')).toBeInTheDocument();
  });

  test('a change is saved as it is made, read back from the account, and kept on a fresh load', async () => {
    const w = world();
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Hints' });
    await userEvent.click(kindSwitch('Hints'));
    expect(kindSwitch('Hints')).toBeChecked();
    await waitFor(async () => expect((await w.fake.preferences()).toasts).toEqual(['quote', 'hint']));
    expect(await screen.findByText('Saved to your account.')).toBeInTheDocument();
    await userEvent.click(kindSwitch('Quotes'));
    await waitFor(async () => expect((await w.fake.preferences()).toasts).toEqual(['hint']));
    cleanup();
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Hints' });
    expect(kindSwitch('Hints')).toBeChecked();
    expect(kindSwitch('Quotes')).not.toBeChecked();
    expect(screen.queryByText('You have not chosen, so the defaults hold.')).not.toBeInTheDocument();
  });

  test('turning every kind off is a choice of its own: nothing toasts, and it is not the defaults', async () => {
    const w = world();
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Quotes' });
    await userEvent.click(kindSwitch('Quotes'));
    await waitFor(async () => expect((await w.fake.preferences()).toasts).toEqual([]));
    expect(screen.getAllByRole('switch').every((el) => !(el as HTMLInputElement).checked)).toBe(true);
  });

  test('Reset to defaults puts the choice back to the instance\'s, and says nothing is left to reset', async () => {
    const w = world();
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Hints' });
    expect(reset()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(kindSwitch('Hints'));
    await waitFor(async () => expect((await w.fake.preferences()).toasts).toEqual(['quote', 'hint']));
    expect(reset()).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(reset());
    await waitFor(async () => expect((await w.fake.preferences()).toasts).toBeNull());
    expect(kindSwitch('Hints')).not.toBeChecked();
    expect(kindSwitch('Quotes')).toBeChecked();
    expect(reset()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('You have not chosen, so the defaults hold.')).toBeInTheDocument();
  });

  test('a refused save says so in the server\'s words and puts the switch back', async () => {
    const w = world();
    const real = w.fake.setPreferences;
    w.fake.setPreferences = async (p: PreferencesPatch): Promise<Answer<Preferences>> => (p.toasts !== undefined ? { ok: false, error: 'not a kind of alert: hint' } : real(p));
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Hints' });
    await userEvent.click(kindSwitch('Hints'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a kind of alert: hint');
    expect(kindSwitch('Hints')).not.toBeChecked();
  });

  test('the switches are real switches: named, described, reached by Tab and toggled by Space, in a group named for the section', async () => {
    const w = world();
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Quotes' });
    for (const el of screen.getAllByRole('switch')) {
      expect(el).toHaveAttribute('role', 'switch');
      expect(el).toHaveAccessibleName();
      expect(el).toHaveAccessibleDescription();
    }
    expect(screen.getByRole('group', { name: 'Which alerts toast' })).toBeInTheDocument();
    kindSwitch('Quotes').focus();
    expect(kindSwitch('Quotes')).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(kindSwitch('Quotes')).not.toBeChecked();
    await waitFor(async () => expect((await w.fake.preferences()).toasts).toEqual([]));
    await userEvent.tab();
    expect(kindSwitch('Words put in your mouth')).toHaveFocus();
  });

  test('the kinds that toast reach the HUD at once, with no reload', async () => {
    const heard: unknown[] = [];
    const off = onToastChoice((k) => heard.push(k));
    const w = world();
    renderIn(w.fake, <LoadedSettings />, { path: at, settings: { toastDefaults: ['quote'] } });
    await screen.findByRole('switch', { name: 'Hints' });
    await userEvent.click(kindSwitch('Hints'));
    await waitFor(() => expect(heard).toEqual([['quote', 'hint']]));
    await userEvent.click(reset());
    await waitFor(() => expect(heard).toEqual([['quote', 'hint'], null]));
    off();
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

describe('Settings › Accessibility › Tilt', () => {
  const NAME = 'Tilt shiny cards with your phone';
  const root = document.documentElement;
  const device = (requestPermission?: () => Promise<string>) => {
    const E = function DeviceOrientationEvent() {} as unknown as { requestPermission?: () => Promise<string> };
    if (requestPermission) E.requestPermission = requestPermission;
    vi.stubGlobal('DeviceOrientationEvent', E);
  };
  const says = (sw: HTMLElement) => document.getElementById(sw.getAttribute('aria-describedby')!)!.textContent!;
  beforeEach(() => { resetTilt(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetTilt(); root.removeAttribute('data-kb-motion'); });

  async function opened(tilt: 'off' | 'on') {
    const w = world();
    if (tilt === 'on') await w.fake.setPreferences({ tilt: 'on' });
    open(w.fake);
    return { w, sw: await screen.findByRole('switch', { name: NAME }) };
  }

  test('is a switch under a heading in the glass\'s words, off until chosen, and off says so plainly', async () => {
    device();
    const { sw } = await opened('off');
    expect(screen.getByRole('heading', { level: 3, name: NAME })).toBeInTheDocument();
    expect(sw).not.toBeChecked();
    expect(says(sw)).toMatch(/^Off\./u);
  });

  test('on, on a device that needs no grant', async () => {
    device();
    const { sw } = await opened('on');
    expect(sw).toBeChecked();
    expect(says(sw)).toBe('On. Tilting your phone moves the light across shiny cards.');
  });

  test('needs-allow: a button, and nothing asks the browser until it is pressed', async () => {
    const ask = vi.fn(async () => 'granted');
    device(ask);
    const { sw } = await opened('on');
    const button = screen.getByRole('button', { name: 'Allow on this phone' });
    expect(ask).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(ask).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(says(sw)).toMatch(/^On\./u));
    expect(screen.queryByRole('button', { name: 'Allow on this phone' })).toBeNull();
  });

  test('after a granted allow, the state sentence is a polite status that updates, and focus moves to the switch when the button goes', async () => {
    device(async () => 'granted');
    const { sw } = await opened('on');
    const status = document.getElementById(sw.getAttribute('aria-describedby')!)!;
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent(/not allowed it yet/u);
    await userEvent.click(screen.getByRole('button', { name: 'Allow on this phone' }));
    await waitFor(() => expect(status).toHaveTextContent(/^On\./u));
    expect(screen.queryByRole('button', { name: 'Allow on this phone' })).toBeNull();
    expect(document.activeElement).toBe(sw);
  });

  test('the browser is asked synchronously inside the tap on the switch', async () => {
    const ask = vi.fn(async () => 'granted');
    device(ask);
    const { sw } = await opened('off');
    fireEvent.click(sw);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test('the browser is asked synchronously inside the tap on the Allow button', async () => {
    const ask = vi.fn(async () => 'granted');
    device(ask);
    await opened('on');
    expect(ask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow on this phone' }));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test('needs-allow after a request that threw: the row says the browser did not answer, and the next tap asks again', async () => {
    const ask = vi.fn(async () => { throw new Error('needs a gesture'); });
    device(ask);
    const { sw } = await opened('on');
    expect(says(sw)).not.toMatch(/didn't answer/u);
    await userEvent.click(screen.getByRole('button', { name: 'Allow on this phone' }));
    await waitFor(() => expect(says(sw)).toMatch(/Your browser didn't answer\. Tap Allow on this phone to ask again\./u));
    expect(screen.getByRole('button', { name: 'Allow on this phone' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allow on this phone' }));
    expect(ask).toHaveBeenCalledTimes(2);
  });

  test('denied: the browser\'s refusal, where to change it, and no second ask without a tap', async () => {
    const ask = vi.fn(async () => 'denied');
    device(ask);
    localStorage.setItem('kb-tilt-device', 'denied');
    const { sw } = await opened('on');
    expect(says(sw)).toBe('Your browser said no, so shiny cards follow your scrolling instead. To change that, allow motion and orientation access for this site in your browser\'s settings, then turn this on again.');
    expect(ask).not.toHaveBeenCalled();
    /* Turning it off and on again is two taps, and the second asks. */
    await userEvent.click(sw);
    await userEvent.click(sw);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test('unsupported: a device that sends no tilt for a second', async () => {
    device();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { sw } = await opened('on');
      await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
      expect(says(sw)).toBe('This device doesn\'t report tilt, so shiny cards follow your scrolling and your pointer instead.');
    } finally { vi.useRealTimers(); }
  });

  test('held while motion is reduced', async () => {
    device();
    root.setAttribute('data-kb-motion', 'reduce');
    const { sw } = await opened('on');
    expect(says(sw)).toBe('Off while motion is reduced. Shiny cards hold their light still.');
    expect(tiltState('on')).toBe('held');
  });

  test('the row is not drawn on a device with no coarse pointer and no orientation API, but the choice still saves from any device', async () => {
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    const w = world();
    await w.fake.setPreferences({ tilt: 'on' });
    open(w.fake);
    await screen.findByRole('switch', { name: 'Tips' });
    expect(screen.queryByRole('switch', { name: NAME })).toBeNull();
    cleanup();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('pointer: coarse'), media: q, addEventListener() {}, removeEventListener() {} }));
    open(w.fake);
    expect(await screen.findByRole('switch', { name: NAME })).toBeChecked();
  });

  test('a choice is saved through the account and kept on a fresh load', async () => {
    device();
    const { w, sw } = await opened('off');
    await userEvent.click(sw);
    await waitFor(async () => expect((await w.fake.preferences()).tilt).toBe('on'));
    expect(sw).toBeChecked();
    cleanup();
    open(w.fake);
    expect(await screen.findByRole('switch', { name: NAME })).toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: NAME }));
    await waitFor(async () => expect((await w.fake.preferences()).tilt).toBe('off'));
  });

  test.each(['light', 'dark'])('passes the accessibility check in the %s glass', async (mode) => {
    device(async () => 'granted');
    root.setAttribute('data-kb-mode', mode);
    await opened('on');
    const row = screen.getByRole('switch', { name: NAME }).closest('.kb-acct-row')!;
    expect(screen.getByRole('button', { name: 'Allow on this phone' })).toBeInTheDocument();
    const found = await axeViolations(row);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('Settings is drawn from its route\'s document', () => {
  test('Account is whole in the first render, from the invites, the sign-in address, boot and the player\'s session; nothing is read for it', async () => {
    const w = world();
    await w.fake.createInvite();
    const boot = await w.fake.boot();
    const doc = { invites: await w.fake.invites(), address: await w.fake.signInAddress() };
    const read = holdReads(w.fake, ['session']);
    renderIn(w.fake, <SettingsScreen doc={doc} />, { path: '/settings?section=account', boot });
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Your invites' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('me@example.test')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(read).toEqual([]);
  });

  test('the other sections are whole in the first render with no document and no read at all', async () => {
    const w = world();
    const boot = await w.fake.boot();
    const read = holdReads(w.fake, ['session']);
    renderIn(w.fake, <SettingsScreen />, { path: '/settings', boot });
    expect(screen.getByRole('radiogroup', { name: 'Smoke' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(read).toEqual([]);
  });

  test('signed out, the marker is the sign-in line', async () => {
    renderIn(buildWorld(), <SettingsScreen doc={SIGNED_OUT_DOC} />, { path: '/settings?section=account' });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  test('a move between sections is a load of the section, and Account reads the invites once', async () => {
    const w = world();
    const invites = vi.spyOn(w.fake, 'invites');
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    expect(invites).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
    expect(invites).toHaveBeenCalledTimes(1);
  });
});

/* A change of section is the body's (docs/plans/2026-11-08-glass-in-page-swap-design.md): drawn through the page, as the app draws it. */
describe('a change of section swaps the body only', () => {
  const inPage = (fake: ReturnType<typeof world>['fake'], path: string) => renderIn(fake, <Page surface="settings"><LoadedSettings /></Page>, { path });
  afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); });

  test('the heading and the rail stay the same nodes, the pressed control keeps focus, and the section sits in a screen body', async () => {
    const w = world();
    inPage(w.fake, '/settings');
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Settings' });
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(screen.getByRole('radiogroup', { name: 'Smoke' }).closest('.kb-screen-body')).not.toBeNull();
    const board = screen.getByRole('link', { name: 'The board' });
    await userEvent.click(board);
    await screen.findByRole('heading', { level: 2, name: 'The board' });
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBe(h1);
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBe(nav);
    expect(screen.getByRole('link', { name: 'The board' })).toBe(board);
    expect(board).toHaveAttribute('aria-current', 'page');
    expect(board).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2, name: 'The board' }).closest('.kb-screen-body')).not.toBeNull();
  });

  test('while the Account body leaves, it still shows the Account section\'s own invites and address, not the new section\'s', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const w = world();
    await w.fake.createInvite();
    inPage(w.fake, '/settings?section=account');
    await screen.findByRole('list', { name: 'Your invites' });
    await userEvent.click(screen.getByRole('link', { name: 'Accessibility' }));
    await screen.findByRole('radiogroup', { name: 'Smoke' });
    const leaving = document.querySelector<HTMLElement>('.kb-screen-body > [data-kb-exiting]');
    expect(leaving).not.toBeNull();
    expect(leaving).toHaveAttribute('inert');
    expect(within(leaving!).getByRole('heading', { level: 2, name: 'Account', hidden: true })).toBeInTheDocument();
    expect(within(leaving!).getByRole('list', { name: 'Your invites', hidden: true })).toBeInTheDocument();
    expect(within(leaving!).getByText('me@example.test')).toBeInTheDocument();
    expect(within(leaving!).queryByRole('radiogroup', { name: 'Smoke', hidden: true })).toBeNull();
    const entering = document.querySelector<HTMLElement>('.kb-screen-body > :not([data-kb-exiting])');
    expect(within(entering!).getByRole('radiogroup', { name: 'Smoke' })).toBeInTheDocument();
    expect(within(entering!).queryByRole('list', { name: 'Your invites' })).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-kb-exiting]')).toBeNull(), { timeout: 3000 });
  });
});

describe('Settings › Sound', () => {
  const BOTH: SoundsUi = {
    slots: [{ key: 'boo', src: '/boo.mp3', bus: 'game', caption: 'The audience boos' }, { key: 'click', src: '/click.mp3', bus: 'interface', caption: 'A click' }],
    preview: { game: 'boo', interface: 'click' },
  };
  const GAME_ONLY: SoundsUi = { slots: [BOTH.slots[0]!], preview: { game: 'boo' } };
  const NO_PREVIEW: SoundsUi = { slots: BOTH.slots };
  const sound = (sounds?: SoundsUi) => {
    const w = world();
    renderIn(w.fake, <LoadedSettings />, { path: '/settings?section=sound', ...(sounds ? { sounds } : {}) });
    return w;
  };
  afterEach(() => { resetSound(); });

  test('is a section after Accessibility, headed Sound, with a row for game sounds and one for interface sounds, each Off and On and off to start', async () => {
    fakeSound();
    sound(BOTH);
    expect(await screen.findByRole('heading', { level: 2, name: 'Sound' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('link', { name: 'Sound' })).toHaveAttribute('aria-current', 'page');
    for (const g of ['Game sounds', 'Interface sounds']) {
      expect(within(group(g)).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Off', 'On']);
      expect(radio(g, 'Off')).toBeChecked();
    }
    expect(screen.getByText('Sounds that cards and other game effects make on the board. Every one is also shown as a caption at the bottom of the screen.')).toBeInTheDocument();
    expect(screen.getByText('Sounds the board itself makes, apart from the game.')).toBeInTheDocument();
    expect(screen.queryByText(/This forum has none yet/u)).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  test('while the instance holds no interface sound, the interface row says so; with one it does not', async () => {
    fakeSound();
    sound(GAME_ONLY);
    await screen.findByRole('radiogroup', { name: 'Interface sounds' });
    expect(screen.getByText('Sounds the board itself makes, apart from the game. This forum has none yet.')).toBeInTheDocument();
    expect(screen.getAllByText(/This forum has none yet/u)).toHaveLength(1);
  });

  test('an instance with no sounds at all says it of the interface row too', async () => {
    fakeSound();
    sound();
    await screen.findByRole('radiogroup', { name: 'Interface sounds' });
    expect(screen.getByText(/This forum has none yet\./u)).toBeInTheDocument();
  });

  test.each([['Game sounds', { gameSound: 'on' }], ['Interface sounds', { interfaceSound: 'on' }]] as const)('choosing On for %s saves it, and it is still on after a fresh load', async (name, saved) => {
    fakeSound();
    const w = world();
    const render = () => renderIn(w.fake, <LoadedSettings />, { path: '/settings?section=sound', sounds: BOTH });
    render();
    await screen.findByRole('radiogroup', { name });
    await userEvent.click(radio(name, 'On'));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject(saved));
    cleanup();
    render();
    await screen.findByRole('radiogroup', { name });
    expect(radio(name, 'On')).toBeChecked();
    await userEvent.click(radio(name, 'Off'));
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ gameSound: 'off', interfaceSound: 'off' }));
  });

  test('a volume shows only while its sound is on, labeled, 0 to 100 in steps of 5, with its value said beside it', async () => {
    fakeSound();
    sound(BOTH);
    await screen.findByRole('radiogroup', { name: 'Game sounds' });
    expect(screen.queryByRole('slider', { name: 'Game volume' })).toBeNull();
    await userEvent.click(radio('Game sounds', 'On'));
    const slider = await screen.findByRole('slider', { name: 'Game volume' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveAttribute('step', '5');
    expect(slider).toHaveValue('80');
    expect(within(group('Game sounds')).getByText('80%')).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Interface volume' })).toBeNull();
    await userEvent.click(radio('Interface sounds', 'On'));
    expect(await screen.findByRole('slider', { name: 'Interface volume' })).toBeInTheDocument();
    await userEvent.click(radio('Game sounds', 'Off'));
    await waitFor(() => expect(screen.queryByRole('slider', { name: 'Game volume' })).toBeNull());
    expect(screen.getByRole('slider', { name: 'Interface volume' })).toBeInTheDocument();
  });

  test('dragging a volume (input) moves the number and saves nothing; releasing it (change) saves it', async () => {
    fakeSound();
    const w = sound(BOTH);
    await screen.findByRole('radiogroup', { name: 'Game sounds' });
    await userEvent.click(radio('Game sounds', 'On'));
    const slider = await screen.findByRole('slider', { name: 'Game volume' });
    const save = vi.spyOn(w.fake, 'setPreferences');
    fireEvent.input(slider, { target: { value: '55' } });
    expect(within(group('Game sounds')).getByText('55%')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect((await w.fake.preferences()).gameVolume).toBe(80);
    fireEvent.change(slider, { target: { value: '55' } });
    await waitFor(async () => expect((await w.fake.preferences()).gameVolume).toBe(55));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ gameVolume: 55 }));
  });

  test('the interface volume saves on release too', async () => {
    fakeSound();
    const w = sound(BOTH);
    await screen.findByRole('radiogroup', { name: 'Interface sounds' });
    await userEvent.click(radio('Interface sounds', 'On'));
    fireEvent.change(await screen.findByRole('slider', { name: 'Interface volume' }), { target: { value: '35' } });
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ interfaceVolume: 35, gameVolume: 80 }));
  });

  test('releasing a volume plays the bus\'s preview where the instance names one', async () => {
    const { fetched } = fakeSound();
    sound(BOTH);
    await screen.findByRole('radiogroup', { name: 'Game sounds' });
    await userEvent.click(radio('Game sounds', 'On'));
    const slider = await screen.findByRole('slider', { name: 'Game volume' });
    fireEvent.input(slider, { target: { value: '30' } });
    await act(async () => { await Promise.resolve(); });
    expect(fetched).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '30' } });
    await waitFor(() => expect(fetched).toHaveBeenCalledWith('/boo.mp3'));
    await userEvent.click(radio('Interface sounds', 'On'));
    fireEvent.change(await screen.findByRole('slider', { name: 'Interface volume' }), { target: { value: '60' } });
    await waitFor(() => expect(fetched).toHaveBeenCalledWith('/click.mp3'));
  });

  test('where no preview is named, releasing a volume plays nothing', async () => {
    const { fetched } = fakeSound();
    const w = sound(NO_PREVIEW);
    await screen.findByRole('radiogroup', { name: 'Game sounds' });
    await userEvent.click(radio('Game sounds', 'On'));
    fireEvent.change(await screen.findByRole('slider', { name: 'Game volume' }), { target: { value: '30' } });
    await waitFor(async () => expect((await w.fake.preferences()).gameVolume).toBe(30));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(fetched).not.toHaveBeenCalled();
  });

  describe('a volume that steps, drifts or is refused', () => {
    const stepped = async (sounds: SoundsUi = BOTH) => {
      const sources = fakeSound().sources;
      const w = sound(sounds);
      await screen.findByRole('radiogroup', { name: 'Game sounds' });
      await userEvent.click(radio('Game sounds', 'On'));
      const slider = await screen.findByRole('slider', { name: 'Game volume' });
      await waitFor(async () => expect((await w.fake.preferences()).gameSound).toBe('on'));
      return { w, slider, sources };
    };

    test('three quick releases are one save of the last value, and their previews replace one another', async () => {
      const { w, slider, sources } = await stepped();
      const save = vi.spyOn(w.fake, 'setPreferences');
      vi.useFakeTimers();
      try {
        for (const v of ['85', '90', '95']) { fireEvent.change(slider, { target: { value: v } }); await act(async () => { await vi.advanceTimersByTimeAsync(50); }); }
        expect(save).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      } finally { vi.useRealTimers(); }
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ gameVolume: 95 }));
      expect(sources).toHaveLength(3);
      expect(sources[0]!.stop).toHaveBeenCalledWith(0.08);
      expect(sources[1]!.stop).toHaveBeenCalledWith(0.08);
      expect(sources[2]!.stop).not.toHaveBeenCalled();
    });

    test('leaving the slider saves what is waiting at once, and so does turning the sound Off', async () => {
      const { w, slider } = await stepped();
      fireEvent.change(slider, { target: { value: '40' } });
      fireEvent.blur(slider);
      await waitFor(async () => expect((await w.fake.preferences()).gameVolume).toBe(40));
      fireEvent.change(slider, { target: { value: '25' } });
      await userEvent.click(radio('Game sounds', 'Off'));
      await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ gameVolume: 25, gameSound: 'off' }));
    });

    test('a drag that ends without a release puts the number back to the saved volume on blur', async () => {
      const { slider } = await stepped();
      fireEvent.input(slider, { target: { value: '15' } });
      expect(within(group('Game sounds')).getByText('15%')).toBeInTheDocument();
      fireEvent.blur(slider);
      await waitFor(() => expect(within(group('Game sounds')).getByText('80%')).toBeInTheDocument());
      expect(slider).toHaveValue('80');
    });

    test('a refused save puts the slider back to the saved volume', async () => {
      const { w, slider } = await stepped();
      w.fake.setPreferences = async () => ({ ok: false, error: 'the volume is 0 to 100' });
      fireEvent.change(slider, { target: { value: '10' } });
      fireEvent.blur(slider);
      await waitFor(() => expect(slider).toHaveValue('80'));
      expect(within(group('Game sounds')).getByText('80%')).toBeInTheDocument();
    });

    test('turning Off removes the range, and a change on it afterward saves nothing', async () => {
      const { w, slider } = await stepped();
      await userEvent.click(radio('Game sounds', 'Off'));
      await waitFor(() => expect(screen.queryByRole('slider', { name: 'Game volume' })).toBeNull());
      const save = vi.spyOn(w.fake, 'setPreferences');
      fireEvent.change(slider, { target: { value: '5' } });
      await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
      expect(save).not.toHaveBeenCalled();
      expect((await w.fake.preferences()).gameVolume).toBe(80);
    });
  });
});
