/**
 * The welcome page at /welcome (the onboarding design, sections 2, 10 and 11; the plan's Task 7; boards
 * docs/research/2026-11-02-onboarding/01-welcome.html and 04-phone.html): Gabe's letter, Before you start (the Settings rows' own
 * controls, saved as they change), Make your first character and Read the Strategy Guide first. It marks the welcome seen when it opens, so
 * it shows once whatever the player does next. The redirect that sends a new account here is held in web/src/App.test.tsx.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { renderInWorld, testInstance } from '../test-world.tsx';
import { Welcome, WelcomeScreen } from './Welcome.tsx';

beforeEach(() => { localStorage.clear(); });

const instance: Instance = { ...testInstance, developer: { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' } };
const signedIn = (fake: ReturnType<typeof import('../test-world.tsx').buildWorld>) => { fake.signInAs(fake.seed.account('me')); };
const page = (o: { readonly signed?: boolean } = {}) =>
  renderInWorld(<WelcomeScreen />, { path: '/welcome', instance, avatars: { gabe: 'gabe.png' }, ...(o.signed === false ? {} : { seed: signedIn }) });

describe('the welcome page', () => {
  test('is headed Welcome, with the letter in Gabe\'s name, his tagline and his picture drawn from the instance\'s avatars', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
    const letter = screen.getByRole('article');
    expect(within(letter).getByText('Gabe')).toBeInTheDocument();
    expect(within(letter).getByText('Made this. Sorry.')).toBeInTheDocument();
    expect(letter.querySelector('img')).toHaveAttribute('src', 'gabe.png');
    expect(within(letter).getByText('A letter.')).toBeInTheDocument();
  });

  test('Before you start holds theme, motion and text size, as Settings draws them, and no other row', async () => {
    page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await within(before).findAllByRole('radiogroup');
    expect(within(before).getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label'))).toEqual(['Theme', 'Motion', 'Text size']);
    expect(within(before).getByText(/Reduced stops the drifting smoke/u)).toBeInTheDocument();
  });

  test('choosing a motion changes the account\'s preferences, and says it is saved', async () => {
    const { fake } = page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await userEvent.click(await within(before).findByRole('radio', { name: 'Reduced' }));
    await waitFor(async () => expect((await fake.preferences()).motion).toBe('reduce'));
    expect(within(before).getByRole('radio', { name: 'Reduced' })).toBeChecked();
    expect(await screen.findByText('Saved to your account.')).toBeInTheDocument();
  });

  test('choosing a text size and a theme changes the account\'s preferences too', async () => {
    const { fake } = page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await userEvent.click(await within(before).findByRole('radio', { name: '150%' }));
    await userEvent.click(within(before).getByRole('radio', { name: 'White on black' }));
    await waitFor(async () => expect(await fake.preferences()).toMatchObject({ textSize: 150, theme: 'dark' }));
  });

  test('marks the welcome seen when it opens, once, so it shows once whatever comes next', async () => {
    const { fake } = page();
    await screen.findByRole('heading', { level: 1, name: 'Welcome' });
    await waitFor(async () => expect((await fake.preferences()).welcomedAt).not.toBeNull());
    const first = (await fake.preferences()).welcomedAt;
    await fake.seeWelcome();
    expect((await fake.preferences()).welcomedAt).toBe(first);
  });

  test('Make your first character is a link to New character, and Read the Strategy Guide first to the guide', async () => {
    page();
    expect(await screen.findByRole('link', { name: 'Make your first character' })).toHaveAttribute('href', '/characters/new');
    expect(screen.getByRole('link', { name: 'Read the Strategy Guide first' })).toHaveAttribute('href', '/guide');
  });

  test('pressing the button opens New character', async () => {
    page();
    await userEvent.click(await screen.findByRole('link', { name: 'Make your first character' }));
    expect(window.location.pathname).toBe('/characters/new');
  });

  test('the side column says what happens next, plainly, and promises no gift the game has not built', async () => {
    page();
    const next = await screen.findByRole('complementary');
    expect(within(next).getByText(/Your first character/u)).toBeInTheDocument();
    expect(within(next).getByText(/Change anything later/u)).toBeInTheDocument();
    expect(next.textContent ?? '').not.toMatch(/gift/iu);
  });

  test('signed out, it is hidden and asks for a sign-in, and marks nothing', async () => {
    page({ signed: false });
    expect(await screen.findByRole('link', { name: /sign in/iu })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Welcome' })).toBeNull();
  });

  test('Welcome without a screen around it draws the same page', async () => {
    renderInWorld(<Welcome />, { path: '/welcome', instance, seed: signedIn });
    expect(await screen.findByRole('link', { name: 'Make your first character' })).toBeInTheDocument();
  });
});
