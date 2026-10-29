import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Frame } from '../frame/Frame.tsx';
import { TEST_CODE } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { AccountGate } from './OpenAccount.tsx';
import { safeNext, signInHref } from './next.ts';
import { clearWhy } from './session.ts';
import { SettingsScreen } from './Settings.tsx';
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

  test('Sign out ends the session', async () => {
    const fake = await linked();
    renderIn(fake, <AccountGate><p>The page</p></AccountGate>, { path: '/' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(async () => expect((await fake.session()).signedIn).toBe(false));
    expect(await screen.findByText('The page')).toBeInTheDocument();
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
    renderIn(fake, <Frame links={[]}><SettingsScreen /></Frame>, { path: '/settings' });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'HUD' })).getByRole('combobox', { name: 'Posting as' })).toBeInTheDocument());
    localStorage.setItem(`kb-draft:${me}:thread-1`, JSON.stringify({ text: 'half a thought', as: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'HUD' })).getByRole('link', { name: 'Sign in' })).toBeInTheDocument());
    expect(localStorage.getItem(`kb-draft:${me}:thread-1`)).toBeNull();
  });
});

describe('Where sign-in returns to', () => {
  test('a path on this site is kept; anything else is the index', () => {
    expect(safeNext('/t/abc?page=2')).toBe('/t/abc?page=2');
    for (const bad of [null, '', '//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', 'standings']) expect(safeNext(bad)).toBe('/');
  });

  test('the link to sign in carries the page the visitor is on, but not the sign-in pages themselves', () => {
    expect(signInHref('/standings', '')).toBe('/sign-in?next=%2Fstandings');
    expect(signInHref('/t/1', '?page=2')).toBe('/sign-in?next=%2Ft%2F1%3Fpage%3D2');
    expect(signInHref('/sign-in', '')).toBe('/sign-in');
    expect(signInHref('/register', '?invite=x')).toBe('/sign-in');
  });

  test('the HUD\'s Sign in link carries it', async () => {
    renderIn(buildWorld(), <Frame links={[]}><p>x</p></Frame>, { path: '/standings' });
    const hud = await screen.findByRole('region', { name: 'HUD' });
    expect(within(hud).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in?next=%2Fstandings');
  });
});
