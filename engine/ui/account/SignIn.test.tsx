import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

  test('says honestly how a new player gets in: register, or give an invite after the code', async () => {
    open(world(), 'sign-in');
    const intro = await screen.findByText(/There is no password/u);
    expect(intro).not.toHaveTextContent(/first sign-in with an invite/u);
    expect(intro).toHaveTextContent(/new player registers first/u);
    expect(intro).toHaveTextContent(/invite after the code/u);
  });

  test('a code signs a known address in, by keyboard alone', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(async () => expect((await w.fake.session()).account).toBe(w.known));
  });

  test('a wrong code says so in the server\'s words, and the field is focused and selected for the next try', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    const field = (await screen.findByLabelText('Code from the email')) as HTMLInputElement;
    await userEvent.type(field, '000000{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('that code does not match, or it has expired: ask for a new one');
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
  });

  test('asking again calls requestCode again and says so in its own line, in a region that is always there', async () => {
    const w = world();
    const spy = vi.spyOn(w.fake, 'requestCode');
    open(w, 'sign-in');
    await ask('known@example.test');
    const status = await screen.findByRole('status');
    expect(status).not.toHaveTextContent('Another code was asked for.');
    await userEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenLastCalledWith('known@example.test', null);
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Another code was asked for.');
  });

  test('the code field is a numeric one-time code, and a pasted code with a space signs in', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    const field = await screen.findByLabelText('Code from the email');
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    await userEvent.click(field);
    await userEvent.paste('123 456');
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => expect((await w.fake.session()).account).toBe(w.known));
  });

  test('a code of seven to ten digits is sent as typed, never refused by the screen', async () => {
    const w = world();
    const spy = vi.spyOn(w.fake, 'verifyCode');
    open(w, 'sign-in');
    await ask('known@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), '12345678{Enter}');
    await waitFor(() => expect(spy).toHaveBeenCalledWith('known@example.test', '12345678'));
    expect(await screen.findByRole('alert')).toHaveTextContent('that code does not match, or it has expired: ask for a new one');
  });

  test('says it is sending while the server answers, and the form is busy', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.requestCode.bind(w.fake);
    w.fake.requestCode = (email, invite) => new Promise((resolve) => { release = () => resolve(real(email, invite)); });
    open(w, 'sign-in');
    await ask('known@example.test');
    expect(await screen.findByRole('status')).toHaveTextContent('Sending…');
    expect(screen.getByRole('form', { name: 'Sign in' })).toHaveAttribute('aria-busy', 'true');
    release();
    await screen.findByLabelText('Code from the email');
  });

  test('a request that gets no answer ends the wait and says so', async () => {
    const w = world();
    w.fake.requestCode = () => Promise.reject(new Error('offline'));
    open(w, 'sign-in');
    await ask('known@example.test');
    expect(await screen.findByRole('alert')).toHaveTextContent(/No answer came back/u);
    expect(screen.getByRole('button', { name: 'Send a code' })).toBeEnabled();
  });

  test('a verify that gets no answer ends the wait and says so', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    w.fake.verifyCode = () => Promise.reject(new Error('offline'));
    await userEvent.type(await screen.findByLabelText('Code from the email'), '123456{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/No answer came back/u);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('a refusal is tied to the field it names', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('nonsense');
    const alert = await screen.findByRole('alert');
    const email = screen.getByLabelText('Email address');
    expect(alert.id).not.toBe('');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toBe(alert.id);
  });

  test('a code refusal is tied to the code field', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    const field = await screen.findByLabelText('Code from the email');
    await userEvent.type(field, '000000{Enter}');
    const alert = await screen.findByRole('alert');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toBe(alert.id);
  });

  test('a refusal of the invite is tied to the invite field beside its help line, both ids', async () => {
    const w = world();
    w.fake.requestCode = async () => ({ ok: false, error: 'is too long', field: 'invite' });
    open(w, 'register', '/register?invite=x');
    await userEvent.click(await screen.findByRole('checkbox', { name: /18 or older/u }));
    await ask('new@example.test');
    const alert = await screen.findByRole('alert');
    const invite = screen.getByLabelText('Invite');
    expect(invite).toHaveAttribute('aria-invalid', 'true');
    const ids = (invite.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain(alert.id);
    expect(ids).toContain('kb-invite-help');
  });

  test('the missing acknowledgement is tied to its checkbox', async () => {
    open(world(), 'register');
    await ask('new@example.test');
    const alert = await screen.findByRole('alert');
    const box = screen.getByRole('checkbox', { name: /18 or older/u });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toBe(alert.id);
  });

  test('after the code it returns to the page the player came from, and only to a path on this site', async () => {
    const w = world();
    open(w, 'sign-in', '/sign-in?next=%2Fstandings');
    await ask('known@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(() => expect(window.location.pathname).toBe('/standings'));
    cleanup();
    const v = world();
    open(v, 'sign-in', '/sign-in?next=%2F%2Fevil.example%2Fx');
    await ask('known@example.test');
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(window.location.hostname).not.toBe('evil.example');
  });

  test('asking for a code with a malformed address shows the server\'s refusal', async () => {
    open(world(), 'sign-in');
    await ask('nonsense');
    expect(await screen.findByRole('alert')).toHaveTextContent('is not an email address');
  });
});

describe('Register, the same for every address', () => {
  test('says exactly the same words for an address with an account and one without, through the code step', async () => {
    const run = async (email: string) => {
      const w = world();
      const r = open(w, 'register', '/register?invite=wrong');
      await userEvent.click(await screen.findByRole('checkbox', { name: /18 or older/u }));
      await ask(email);
      await userEvent.type(await screen.findByLabelText('Code from the email'), '000000{Enter}');
      await screen.findByRole('alert');
      const html = r.container.innerHTML;
      cleanup();
      return html;
    };
    expect(await run('stranger@example.test')).toBe(await run('known@example.test'));
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
    expect(await screen.findByText("that invite opens nothing, so no new login is made with it")).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    expect(await screen.findByText(/that invite opens nothing; open the account with another invite/u)).toBeInTheDocument();
    expect(screen.getByLabelText('Invite')).toBeInTheDocument();
  });

  test('registration closed is said plainly, with the way on: when an admin opens it, the next sign-in opens the account', async () => {
    const w = world('closed');
    open(w, 'register', '/register', 'closed');
    expect(await screen.findByText(/Registration is closed/u)).toBeInTheDocument();
    expect(screen.getByText(/when an admin opens it/iu)).toBeInTheDocument();
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
