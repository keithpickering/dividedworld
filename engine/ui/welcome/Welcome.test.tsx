/**
 * The welcome page at /welcome (the onboarding design, sections 2, 10 and 11; the plan's Task 7; boards
 * docs/research/2026-11-02-onboarding/01-welcome.html and 04-phone.html): Gabe's letter, Before you start (the Settings rows' own
 * controls, saved as they change), Make your first character and Read the Strategy Guide first. It marks the welcome seen when it opens, so
 * it shows once whatever the player does next. The redirect that sends a new account here is held in web/src/App.test.tsx.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, renderInWorld, testInstance } from '../test-world.tsx';
import { Welcome, WelcomeScreen } from './Welcome.tsx';
import { fakeSound } from '../audio/test-sound.ts';
import { resetSound } from '../audio/sound.ts';
import type { SoundsUi } from '../audio/types.ts';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { resetSound(); });

const instance: Instance = { ...testInstance, developer: { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' } };
const signedIn = (fake: ReturnType<typeof import('../test-world.tsx').buildWorld>) => { fake.signInAs(fake.seed.account('me')); };
const page = (o: { readonly signed?: boolean } = {}) =>
  renderInWorld(<WelcomeScreen />, { path: '/welcome', instance, avatars: { gabe: 'gabe.png' }, ...(o.signed === false ? {} : { seed: signedIn }) });

describe('the welcome page', () => {
  test('its rows are drawn from boot\'s preferences: the account\'s preferences are not read, and the welcome is marked seen once it is drawn', async () => {
    const fake = buildWorld(undefined, instance);
    signedIn(fake);
    const boot = await fake.boot();
    const prefs = vi.spyOn(fake, 'preferences');
    const seen = vi.spyOn(fake, 'seeWelcome');
    renderIn(fake, <WelcomeScreen />, { path: '/welcome', boot });
    const before = await screen.findByRole('region', { name: 'Before you start' });
    expect(await within(before).findAllByRole('radiogroup')).toHaveLength(6);
    expect(prefs).not.toHaveBeenCalled();
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  });

  test('is headed Welcome, with the letter in Gabe\'s name, his tagline and his picture drawn from the instance\'s avatars', async () => {
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
    const letter = screen.getByRole('article');
    expect(within(letter).getByText('Gabe')).toBeInTheDocument();
    expect(within(letter).getByText('Made this. Sorry.')).toBeInTheDocument();
    expect(letter.querySelector('img')).toHaveAttribute('src', 'gabe.png');
    expect(within(letter).getByText('A letter.')).toBeInTheDocument();
  });

  test('a letter without a heading has no headline and the post carries no name from one', async () => {
    page();
    const letter = await screen.findByRole('article');
    expect(within(letter).queryByRole('heading', { level: 2 })).toBeNull();
    expect(letter).not.toHaveAttribute('aria-labelledby');
  });

  test('an instance with no developer persona gets the plain default: its name, no tagline, and its first letter for a picture', async () => {
    renderInWorld(<WelcomeScreen />, { path: '/welcome', seed: signedIn });
    const letter = await screen.findByRole('article');
    expect(within(letter).getByText('The developers')).toBeInTheDocument();
    expect(letter.querySelector('.kb-updates-tagline')).toBeNull();
    expect(letter.querySelector('img')).toBeNull();
    expect(letter.querySelector('.kb-updates-ava-none')).toHaveTextContent('T');
  });

  test('a persona whose picture the instance does not hold gets its first letter too', async () => {
    renderInWorld(<WelcomeScreen />, { path: '/welcome', instance, avatars: {}, seed: signedIn });
    const letter = await screen.findByRole('article');
    expect(letter.querySelector('img')).toBeNull();
    expect(letter.querySelector('.kb-updates-ava-none')).toHaveTextContent('G');
  });

  test('the row labels sit one level under Before you start', async () => {
    page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await within(before).findAllByRole('radiogroup');
    expect(within(before).getByRole('heading', { level: 3, name: 'Before you start' })).toBeInTheDocument();
    expect(within(before).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Theme', 'Motion', 'Text size', 'Brighter effects', 'Game sounds', 'Interface sounds']);
  });

  test('Before you start holds theme, motion, text size, Brighter effects and the two sound rows, as Settings draws them, and no other row', async () => {
    page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await within(before).findAllByRole('radiogroup');
    expect(within(before).getAllByRole('radiogroup').map((g) => within(g).getByRole('heading').textContent)).toEqual(['Theme', 'Motion', 'Text size', 'Brighter effects', 'Game sounds', 'Interface sounds']);
    expect(within(before).getByRole('radiogroup', { name: 'Motion' })).toBeInTheDocument();
    expect(within(before).getByText(/Off stops every animation/u)).toBeInTheDocument();
  });

  test('choosing a motion changes the account\'s preferences, and says it is saved', async () => {
    const { fake } = page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await userEvent.click(await within(await within(before).findByRole('radiogroup', { name: 'Motion' })).findByRole('radio', { name: 'Off' }));
    await waitFor(async () => expect((await fake.preferences()).motion).toBe('reduce'));
    expect(within(within(before).getByRole('radiogroup', { name: 'Motion' })).getByRole('radio', { name: 'Off' })).toBeChecked();
    expect(await screen.findByText('Saved to your account.')).toBeInTheDocument();
  });

  test('choosing Brighter effects On changes the account\'s preferences, with its sentence', async () => {
    const { fake } = page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    const group = await within(before).findByRole('radiogroup', { name: 'Brighter effects' });
    expect(within(before).getByText(/Let card effects on posts use their full colors, even below the usual contrast standard\. Some posts may be harder to read\./u)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('radio', { name: 'On' }));
    await waitFor(async () => expect((await fake.preferences()).effects).toBe('bright'));
  });

  test('the sound rows say what they are, offer Off and On, and a volume shows only while on', async () => {
    fakeSound();
    page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    const game = await within(before).findByRole('radiogroup', { name: 'Game sounds' });
    expect(within(game).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Off', 'On']);
    expect(within(before).getByText('Sounds that cards and other game effects make on the board. Every one is also shown as a caption at the bottom of the screen.')).toBeInTheDocument();
    expect(within(before).getByText('Sounds the board itself makes, apart from the game. This forum has none yet.')).toBeInTheDocument();
    expect(within(before).queryByRole('slider')).toBeNull();
    await userEvent.click(within(game).getByRole('radio', { name: 'On' }));
    expect(await within(before).findByRole('slider', { name: 'Game volume' })).toHaveValue('80');
    expect(within(before).queryByRole('slider', { name: 'Interface volume' })).toBeNull();
  });

  test('choosing a sound On saves it; a volume saves on release and not on input, then plays the preview where one is named', async () => {
    const { fetched } = fakeSound();
    const sounds: SoundsUi = { slots: [{ key: 'boo', src: '/boo.mp3', bus: 'game', caption: 'The audience boos' }, { key: 'click', src: '/click.mp3', bus: 'interface', caption: 'A click' }], preview: { game: 'boo' } };
    const fake = buildWorld(undefined, instance);
    signedIn(fake);
    renderIn(fake, <WelcomeScreen />, { path: '/welcome', instance, avatars: { gabe: 'gabe.png' }, sounds });
    const before = await screen.findByRole('region', { name: 'Before you start' });
    expect(within(before).queryByText(/This forum has none yet/u)).toBeNull();
    await userEvent.click(within(await within(before).findByRole('radiogroup', { name: 'Game sounds' })).getByRole('radio', { name: 'On' }));
    await waitFor(async () => expect((await fake.preferences()).gameSound).toBe('on'));
    const slider = await within(before).findByRole('slider', { name: 'Game volume' });
    fireEvent.input(slider, { target: { value: '45' } });
    expect(within(before).getByText('45%')).toBeInTheDocument();
    expect((await fake.preferences()).gameVolume).toBe(80);
    expect(fetched).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '45' } });
    await waitFor(async () => expect((await fake.preferences()).gameVolume).toBe(45));
    await waitFor(() => expect(fetched).toHaveBeenCalledWith('/boo.mp3'));
    /* The interface bus names no preview here: releasing its volume plays nothing more. */
    await userEvent.click(within(within(before).getByRole('radiogroup', { name: 'Interface sounds' })).getByRole('radio', { name: 'On' }));
    await waitFor(async () => expect((await fake.preferences()).interfaceSound).toBe('on'));
    fetched.mockClear();
    fireEvent.change(await within(before).findByRole('slider', { name: 'Interface volume' }), { target: { value: '20' } });
    await waitFor(async () => expect((await fake.preferences()).interfaceVolume).toBe(20));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(fetched).not.toHaveBeenCalled();
  });

  test('choosing a text size and a theme changes the account\'s preferences too', async () => {
    const { fake } = page();
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await userEvent.click(await within(before).findByRole('radio', { name: '150%' }));
    await userEvent.click(within(before).getByRole('radio', { name: /^Sepia/u }));
    await waitFor(async () => expect(await fake.preferences()).toMatchObject({ textSize: 150, theme: 'sepia' }));
    /* The tiles alone: no preview, and the Mode row stays in Settings. */
    expect(before.querySelector('.kb-tp-big')).toBeNull();
    expect(within(before).queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
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

  /** A signed-in world whose backend the test tampers with before the page renders. */
  function tamper(setup: (fake: ReturnType<typeof buildWorld>) => void) {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('me'));
    setup(fake);
    renderIn(fake, <WelcomeScreen />, { path: '/welcome', instance, avatars: { gabe: 'gabe.png' } });
    return fake;
  }

  test('a save the account refuses says so in an alert, and puts the choice back', async () => {
    const fake = tamper((f) => { vi.spyOn(f, 'setPreferences').mockResolvedValue({ ok: false, error: 'The account would not take that.' }); });
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await userEvent.click(await within(await within(before).findByRole('radiogroup', { name: 'Motion' })).findByRole('radio', { name: 'Off' }));
    expect(await within(before).findByRole('alert')).toHaveTextContent('The account would not take that.');
    await waitFor(() => expect(within(within(before).getByRole('radiogroup', { name: 'Motion' })).getByRole('radio', { name: 'Follow my device' })).toBeChecked());
    expect(within(within(before).getByRole('radiogroup', { name: 'Motion' })).getByRole('radio', { name: 'Off' })).not.toBeChecked();
    expect(screen.queryByText('Saved to your account.')).toBeNull();
    expect((await fake.preferences()).motion).toBe('system');
  });

  test('while the preferences are being read the section is busy and holds no control; a read that fails says so and stops being busy', async () => {
    let release: (v: Awaited<ReturnType<ReturnType<typeof buildWorld>['preferences']>>) => void = () => undefined;
    const fake = tamper((f) => {
      const real = f.preferences.bind(f);
      vi.spyOn(f, 'preferences').mockImplementationOnce(() => new Promise((r) => { release = r as typeof release; })).mockImplementation(real);
    });
    const before = await screen.findByRole('region', { name: 'Before you start' });
    expect(before.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(within(before).queryAllByRole('radio')).toHaveLength(0);
    release(await fake.preferences());
    await within(await within(before).findByRole('radiogroup', { name: 'Motion' })).findByRole('radio', { name: 'Off' });
    expect(before.querySelector('[aria-busy="true"]')).toBeNull();
  });

  test('a read of the preferences that fails is said in an alert, and the section is no longer busy', async () => {
    tamper((f) => { vi.spyOn(f, 'preferences').mockRejectedValue(new Error('down')); });
    const before = await screen.findByRole('region', { name: 'Before you start' });
    expect(await within(before).findByRole('alert')).toHaveTextContent(/could not be read/u);
    expect(before.querySelector('[aria-busy="true"]')).toBeNull();
  });

  test('Saved to your account waits for the last save in line, not the first', async () => {
    let releaseFirst: () => void = () => undefined;
    let releaseSecond: () => void = () => undefined;
    let firstAnswered = false;
    let secondStarted = false;
    tamper((f) => {
      const real = f.setPreferences.bind(f);
      vi.spyOn(f, 'setPreferences')
        .mockImplementationOnce(async (patch) => { await new Promise<void>((r) => { releaseFirst = r; }); const r = await real(patch); firstAnswered = true; return r; })
        .mockImplementationOnce(async (patch) => { secondStarted = true; await new Promise<void>((r) => { releaseSecond = r; }); return real(patch); });
    });
    const before = await screen.findByRole('region', { name: 'Before you start' });
    /* Two choices made while the first save is still out. */
    await userEvent.click(await within(await within(before).findByRole('radiogroup', { name: 'Motion' })).findByRole('radio', { name: 'Off' }));
    await userEvent.click(within(before).getByRole('radio', { name: 'Smooth' }));
    releaseFirst();
    await waitFor(() => { expect(firstAnswered).toBe(true); expect(secondStarted).toBe(true); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Saved to your account.')).toBeNull();
    releaseSecond();
    expect(await screen.findByText('Saved to your account.')).toBeInTheDocument();
  });
});
