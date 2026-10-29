import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { TEST_CODE } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { SignInScreen } from './SignIn.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

function world(mode: 'open' | 'invite' | 'closed' = 'invite') {
  const fake = buildWorld({ registrationMode: mode });
  const known = fake.seed.account('known', { email: 'known@example.test' });
  return { fake, known };
}
const open = (w: ReturnType<typeof world>, mode: 'sign-in' | 'register', path = mode === 'register' ? '/register' : '/sign-in', registrationMode?: 'open' | 'invite' | 'closed') =>
  renderIn(w.fake, <SignInScreen mode={mode} />, { path, settings: registrationMode ? { registrationMode } : undefined });

const ask = async (email: string) => {
  await userEvent.type(await screen.findByLabelText('Email address'), email);
  await userEvent.click(screen.getByRole('button', { name: 'Send a code' }));
};

describe('Sign in', () => {
  test('says exactly the same words, and shows the same screen, for an address with an account and one without', async () => {
    const a = world();
    const first = open(a, 'sign-in');
    await ask('known@example.test');
    await screen.findByLabelText('Code from the email');
    const known = first.container.innerHTML;
    cleanup();
    const b = world();
    const second = open(b, 'sign-in');
    await ask('stranger@example.test');
    await screen.findByLabelText('Code from the email');
    expect(second.container.innerHTML.replace('stranger@example.test', 'known@example.test')).toBe(known);
    expect(known).not.toMatch(/no such account|not registered|does not exist/iu);
  });

  test('a code signs a known address in, by keyboard alone', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(async () => expect((await w.fake.session()).account).toBe(w.known));
  });

  test('a wrong code says so in the server\'s words and offers a new one', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), '000000{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('that code does not match, or it has expired: ask for a new one');
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/a code and a link to sign in are on their way/u);
  });

  test('asking for a code with a malformed address shows the server\'s refusal', async () => {
    open(world(), 'sign-in');
    await ask('nonsense');
    expect(await screen.findByRole('alert')).toHaveTextContent('is not an email address');
  });
});

describe('Register', () => {
  test('asks for an invite while the instance is invite-only, prefilled from the link, and for the 18+ acknowledgement', async () => {
    const w = world();
    open(w, 'register', '/register?invite=abc123');
    expect(await screen.findByLabelText('Invite')).toHaveValue('abc123');
    const box = screen.getByRole('checkbox', { name: /18 or older/u });
    expect(box).not.toBeChecked();
    await userEvent.type(screen.getByLabelText('Email address'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/18 or older/u);
    expect(screen.queryByLabelText('Code from the email')).toBeNull();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Send a code' }));
    expect(await screen.findByLabelText('Code from the email')).toBeInTheDocument();
  });

  test('has no invite field while registration is open', async () => {
    open(world('open'), 'register', '/register', 'open');
    await screen.findByLabelText('Email address');
    expect(screen.queryByLabelText('Invite')).toBeNull();
  });

  test('a valid invite opens an account on the first code; the screen then leaves for the index', async () => {
    const w = world();
    const code = (await (async () => { w.fake.signInAs(w.known); const r = await w.fake.createInvite(); w.fake.signInAs(null); return r; })());
    if (!code.ok) throw new Error('seed');
    open(w, 'register', `/register?invite=${code.value.code}`);
    await userEvent.click(await screen.findByRole('checkbox', { name: /18 or older/u }));
    await ask('new@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(async () => expect((await w.fake.session()).account).not.toBeNull());
    expect(window.location.pathname).toBe('/');
  });

  test('an invite that opens nothing is said plainly, and the way on is another invite after the code', async () => {
    const w = world();
    open(w, 'register', '/register?invite=wrong');
    await userEvent.click(await screen.findByRole('checkbox', { name: /18 or older/u }));
    await ask('new@example.test');
    expect(await screen.findByRole('status')).toHaveTextContent('that invite opens nothing, so no new login is made with it');
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    expect(await screen.findByText(/that invite opens nothing; open the account with another invite/u)).toBeInTheDocument();
    expect(screen.getByLabelText('Invite')).toBeInTheDocument();
  });

  test('registration closed is said plainly, with the way on: when an admin opens it, the next sign-in opens the account', async () => {
    const w = world('closed');
    open(w, 'register', '/register', 'closed');
    expect(await screen.findByText(/Registration is closed/u)).toBeInTheDocument();
    expect(screen.getByText(/when an admin opens it/u)).toBeInTheDocument();
  });

  test('a session with no account (the emailed link landed) is offered an invite to open it', async () => {
    const w = world();
    const made = await (async () => { w.fake.signInAs(w.known); const r = await w.fake.createInvite(); w.fake.signInAs(null); return r; })();
    if (!made.ok) throw new Error('seed');
    await w.fake.requestCode('linked@example.test', null);
    await w.fake.verifyCode('linked@example.test', TEST_CODE);
    expect((await w.fake.session()).account).toBeNull();
    open(w, 'sign-in');
    await userEvent.type(await screen.findByLabelText('Invite'), `${made.value.code}{Enter}`);
    await waitFor(async () => expect((await w.fake.session()).account).not.toBeNull());
  });
});
