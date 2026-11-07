import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { SettingsScreen } from './Settings.tsx';

/* The test world offers House (light and dark) and Sepia (light only), each with a preview whose banner token differs by mode. */
const MARKS = ['data-kb-mode', 'data-kb-motion', 'data-kb-smoke-level', 'data-kb-contrast', 'data-kb-text-size', 'data-kb-glass-key'];
beforeEach(() => { localStorage.clear(); for (const m of MARKS) document.documentElement.removeAttribute(m); });
afterEach(() => { cleanup(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  fake.signInAs(me);
  return { fake, me };
}
const open = (fake: ReturnType<typeof world>['fake']) => renderIn(fake, <SettingsScreen />, { path: '/settings?section=board' });
const tiles = () => screen.getByRole('radiogroup', { name: 'Theme' });
const tile = (name: RegExp) => within(tiles()).getByRole('radio', { name });
const mode = (name: string) => within(screen.getByRole('radiogroup', { name: 'Mode' })).getByRole('radio', { name });
const banner = () => document.querySelector<HTMLElement>('.kb-tp-banner')!;

describe('Settings › The board', () => {
  test('is a section of its own between Accessibility and Notifications, and holds Theme then Mode', async () => {
    open(world().fake);
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: 'The board' })).toHaveAttribute('href', '/settings?section=board');
    expect(within(nav).getByRole('link', { name: 'The board' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { level: 2, name: 'The board' })).toBeInTheDocument();
    expect(screen.getAllByRole('radiogroup').map((g) => within(g).getByRole('heading').textContent)).toEqual(['Theme', 'Mode']);
    expect(screen.getByText('Applies to the board at once, on every device you sign in on.')).toBeInTheDocument();
  });

  test('one tile per theme, each with its modes in words, as one radio group', async () => {
    open(world().fake);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(within(tiles()).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['HouseLight and dark', 'SepiaLight only']);
    expect(tile(/^House/u)).toBeChecked();
  });

  test('arrows move between the tiles, and the choice saves as a theme alone', async () => {
    const w = world();
    await w.fake.setPreferences({ mode: 'dark' });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    tile(/^House/u).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tile(/^Sepia/u)).toBeChecked();
    expect(tile(/^Sepia/u)).toHaveFocus();
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ theme: 'sepia', mode: 'dark' }));
    await userEvent.keyboard('{ArrowLeft}');
    expect(tile(/^House/u)).toBeChecked();
    /* Choosing House again saves the theme alone, so the player's own mode (dark) is what they return to. */
    await waitFor(async () => expect(await w.fake.preferences()).toMatchObject({ theme: 'default', mode: 'dark' }));
  });

  test('a theme that holds one mode holds the Mode row to it, disables the others and says why', async () => {
    const w = world();
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Mode' });
    expect(mode('Follow my device')).toBeEnabled();
    expect(screen.getByText(/^The 2003 board stays 2003 whichever you choose\./u)).toBeInTheDocument();
    await userEvent.click(tile(/^Sepia/u));
    expect(mode('Light')).toBeChecked();
    /* The held mode stays reachable, checked; only the others are greyed. */
    expect(mode('Light')).toBeEnabled();
    expect(mode('Dark')).toBeDisabled();
    expect(mode('Follow my device')).toBeDisabled();
    expect(screen.getByText('Sepia comes in light only, so the board stays light whatever your device says. Choose House for light and dark.')).toBeInTheDocument();
    /* The mode the player chose is kept: House again returns them to it. */
    await userEvent.click(tile(/^House/u));
    expect(mode('Follow my device')).toBeChecked();
    expect(mode('Dark')).toBeEnabled();
  });

  test('the preview draws the chosen theme\'s own tokens in the resolved mode, and is decoration', async () => {
    const w = world();
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    const preview = banner().closest<HTMLElement>('.kb-tp-big')!;
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview.style.getPropertyValue('--tp-banner')).toBe('banner-light');
    await userEvent.click(mode('Dark'));
    expect(preview.style.getPropertyValue('--tp-banner')).toBe('banner-dark');
    await userEvent.click(tile(/^Sepia/u));
    expect(preview.style.getPropertyValue('--tp-banner')).toBe('banner-sepia');
    expect(within(preview).getByText('Start a thread')).toBeInTheDocument();
  });

  test('a refused theme is put back', async () => {
    const w = world();
    w.fake.setPreferences = async () => ({ ok: false, error: 'the theme could not be saved' });
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    await userEvent.click(tile(/^Sepia/u));
    expect(await screen.findByRole('alert')).toHaveTextContent('the theme could not be saved');
    expect(tile(/^House/u)).toBeChecked();
  });

  test('has no accessibility violations, with a one-mode theme chosen too', async () => {
    const w = world();
    open(w.fake);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(describeViolations(await axeViolations(document.body))).toBe('');
    await userEvent.click(tile(/^Sepia/u));
    expect(describeViolations(await axeViolations(document.body))).toBe('');
  });
});
