import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Frame } from '../frame/Frame.tsx';
import { TEST_CODE } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { AccountGate } from './OpenAccount.tsx';
import { safeNext, signInHref } from './next.ts';
import { clearWhy } from './session.ts';
import { LoadedSettings } from '../loaded.tsx';
import { SignInScreen } from './SignIn.tsx';

beforeEach(() => { localStorage.clear(); clearWhy(); });
afterEach(() => { cleanup(); });

/** Signed in through Auth with no account yet: the state the emailed link leaves. */
async function linked() {
  const fake = buildWorld({ registrationMode: 'invite' });
  fake.seed.account('known', { email: 'known@example.test' });
  await fake.requestCode('linked@example.test', null);
  await fake.verifyCode('linked@example.test', TEST_CODE);
  return fake;
}

describe('A player signed in with no account', () => {
  test('is never stuck: the gate offers Sign out and Use another address, and lets the sign-in and register pages through', async () => {
    const fake = await linked();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/settings' });
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use another address' })).toBeInTheDocument();
    expect(screen.queryByText('The page')).toBeNull();
    cleanup();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/sign-in' });
    expect(await screen.findByText('The page')).toBeInTheDocument();
    cleanup();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/register' });
    expect(await screen.findByText('The page')).toBeInTheDocument();
  });

  test('can still reach a person: Reach a person (/contact) is let through the gate too', async () => {
    const fake = await linked();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/contact' });
    expect(await screen.findByText('The page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  test('Sign out ends the session', async () => {
    const fake = await linked();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(async () => expect((await fake.session()).signedIn).toBe(false));
    expect(await screen.findByText('The page')).toBeInTheDocument();
  });

  test('Open the account is a busy button while the server answers: aria-busy, its name kept, a second press opens once', async () => {
    const fake = await linked();
    let release!: () => void;
    const real = fake.openAccount.bind(fake);
    const spy = vi.spyOn(fake, 'openAccount').mockImplementation((invite) => new Promise((resolve) => { release = () => resolve(real(invite)); }));
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/' });
    const open = await screen.findByRole('button', { name: 'Open the account' });
    await userEvent.click(open);
    expect(open).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Open the account' })).toBe(open);
    await userEvent.click(open);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(open).not.toHaveAttribute('aria-busy'));
  });

  test('Sign out is a busy button while the sign-out is out: aria-busy, its name kept, and a second press signs out once', async () => {
    const fake = await linked();
    let release!: () => void;
    const real = fake.signOut.bind(fake);
    const spy = vi.spyOn(fake, 'signOut').mockImplementation(() => new Promise<void>((resolve) => { release = () => { real(); resolve(); }; }));
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/' });
    const out = await screen.findByRole('button', { name: 'Sign out' });
    await userEvent.click(out);
    expect(out).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(out);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    await waitFor(async () => expect((await fake.session()).signedIn).toBe(false));
  });

  test('Use another address signs out and opens the sign-in page', async () => {
    const fake = await linked();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Use another address' }));
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    expect((await fake.session()).signedIn).toBe(false);
  });

  test('the reason the server gave outlives the sign-in screen that was replaced by the gate', async () => {
    const fake = buildWorld({ registrationMode: 'invite' });
    renderIn(fake, <AccountGate><SignInScreen mode="register" /></AccountGate>, { path: '/?invite=wrong' });
    await userEvent.click(await screen.findByRole('checkbox', { name: /18 or older/u }));
    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send a code' }));
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    expect(await screen.findByText(/that invite opens nothing; open the account with another invite/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});

describe('Signing out', () => {
  test('takes the drafts off the device and puts the HUD back to Sign in', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    fake.seed.character(me, 'Pipewrench', 'face');
    fake.signInAs(me);
    renderIn(fake, <Frame><LoadedSettings /></Frame>, { path: '/settings?section=account' });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Game HUD' })).getByRole('combobox', { name: 'Swap mask' })).toBeInTheDocument());
    localStorage.setItem(`kb-draft:${me}:thread-1`, JSON.stringify({ text: 'half a thought', as: null }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Game HUD' })).getByRole('link', { name: 'Sign in' })).toBeInTheDocument());
    expect(localStorage.getItem(`kb-draft:${me}:thread-1`)).toBeNull();
  });
});

describe('Where sign-in returns to', () => {
  test('a path on this site is kept; anything else is the index', () => {
    expect(safeNext('/t/abc?page=2')).toBe('/t/abc?page=2');
    for (const bad of [null, '', '//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', 'standings']) expect(safeNext(bad)).toBe('/');
  });

  test('nothing that resolves off this site is followed, however the address is dressed', () => {
    const origin = window.location.origin;
    // The URL parser drops tab, newline and carriage return, so "/\t/evil.example" is "//evil.example".
    const raw = ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\t\\evil.example', '/\t/\tevil.example', '/\\x', '//x', 'https://x', 'javascript:x', ' /x', '\t/x', '\n//x', '/\\\\x'];
    for (const bad of raw) expect(safeNext(bad), JSON.stringify(bad)).toBe('/');
    // Percent-encoded they are ordinary path characters: still this site, never another.
    for (const ok of ['/%09/evil.example', '/%0A/evil.example', '/%0D/evil.example']) {
      const got = safeNext(ok);
      expect(new URL(got, origin).origin).toBe(origin);
      expect(got).toBe(ok);
    }
  });

  test('a good path keeps its query and fragment', () => {
    expect(safeNext('/t/abc?page=2&x=%2F#post-9')).toBe('/t/abc?page=2&x=%2F#post-9');
    expect(safeNext('/standings#top')).toBe('/standings#top');
  });

  test('the link to sign in carries the page the visitor is on, but not the sign-in pages themselves', () => {
    expect(signInHref('/standings', '')).toBe('/sign-in?next=%2Fstandings');
    expect(signInHref('/t/1', '?page=2')).toBe('/sign-in?next=%2Ft%2F1%3Fpage%3D2');
    expect(signInHref('/sign-in', '')).toBe('/sign-in');
    expect(signInHref('/register', '?invite=x')).toBe('/sign-in');
  });

  test('the HUD\'s Sign in link carries it', async () => {
    renderIn(buildWorld(), <Frame><p>x</p></Frame>, { path: '/standings' });
    const hud = await screen.findByRole('region', { name: 'Game HUD' });
    expect(within(hud).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?next=%2Fstandings');
  });
});
