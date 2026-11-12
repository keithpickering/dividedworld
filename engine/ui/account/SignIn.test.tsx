import { useState } from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOST_ANSWER } from '../data/api.ts';
import { TEST_CODE, TEST_LINK } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { LinkHandProvider } from './LinkHand.tsx';
import { useLocation, useNavigate } from '../router.tsx';
import { SignInScreen } from './SignIn.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
  test('reads the session from the player\'s provider, and asks the backend for it once', async () => {
    const w = world();
    const session = vi.spyOn(w.fake, 'session');
    open(w, 'sign-in');
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(session).toHaveBeenCalledTimes(1);
  });


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

  test('offers a way to reach a person, to a player who cannot sign in', async () => {
    open(world(), 'sign-in');
    expect(await screen.findByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
    cleanup();
    open(world(), 'register');
    expect(await screen.findByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
    cleanup();
    open(world('closed'), 'register');
    expect(await screen.findByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
  });

  test('says honestly how a new player gets in: one plain lead, and the aside says Register takes an invite', async () => {
    open(world(), 'sign-in');
    expect(await screen.findByText('No password. We email you a code and a link; either one signs you in.')).toBeInTheDocument();
    const aside = screen.getByRole('complementary', { name: 'Other ways in' });
    expect(within(aside).getByText('Registering takes an invite from someone who plays. The same email code signs you in after.')).toBeInTheDocument();
  });

  test('the other ways in are an aside with its headings: New here? and Stuck? on Sign in, Already playing? and Stuck? on Register', async () => {
    open(world(), 'sign-in');
    const aside = await screen.findByRole('complementary', { name: 'Other ways in' });
    expect(within(aside).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['New here?', 'Stuck?']);
    expect(within(aside).getByText('No code arrived, or the link has expired. The admins can help.')).toBeInTheDocument();
    expect(within(aside).getByRole('link', { name: 'Reach a person' })).toHaveAttribute('href', '/contact');
    cleanup();
    open(world(), 'register');
    const other = await screen.findByRole('complementary', { name: 'Other ways in' });
    expect(within(other).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Already playing?', 'Stuck?']);
    expect(within(other).getByText('Sign in with the email you registered.')).toBeInTheDocument();
  });

  test('Sign in has one link to Register, a secondary button in the aside; Register has one to Sign in', async () => {
    open(world(), 'sign-in');
    const register = await screen.findAllByRole('link', { name: 'Register' });
    expect(register).toHaveLength(1);
    expect(register[0]).toHaveAttribute('data-kb-kind', 'secondary');
    expect(register[0]!.closest('aside')).not.toBeNull();
    cleanup();
    open(world(), 'register');
    const signIn = await screen.findAllByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveLength(1);
    expect(signIn[0]).toHaveAttribute('data-kb-kind', 'secondary');
    expect(signIn[0]!.closest('aside')).not.toBeNull();
  });

  test('Register says its lead, the invite note under the filled invite, and the 18+ line as a regular check with its acknowledgement under it', async () => {
    open(world(), 'register', '/register?invite=ab12cd34');
    expect(await screen.findByText('No password. We email you a code and a link; either one makes your account.')).toBeInTheDocument();
    expect(screen.getByText('Registration is by invite for now. Your invite link filled this in.')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'I am 18 or older.' });
    expect(box.closest('label')).toHaveTextContent(/^I am 18 or older\.$/u);
    expect(screen.getByText('An acknowledgement, nothing legally binding.')).toBeInTheDocument();
  });

  test('the invite note says the link filled it in only when one did; open and closed Register have none', async () => {
    open(world(), 'register', '/register');
    expect(await screen.findByText('Registration is by invite for now. A player gives you a link; its code is filled in for you.')).toBeInTheDocument();
    expect(screen.queryByText(/Your invite link filled this in/u)).toBeNull();
    cleanup();
    open(world('open'), 'register', '/register', 'open');
    await screen.findByLabelText('Email address');
    expect(screen.queryByText(/Registration is by invite/u)).toBeNull();
    cleanup();
    open(world('closed'), 'register', '/register', 'closed');
    await screen.findByLabelText('Email address');
    expect(screen.queryByText(/Registration is by invite/u)).toBeNull();
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
    expect(spy).toHaveBeenLastCalledWith('known@example.test', null, null);
    await waitFor(() => expect(status).toHaveTextContent('Another code was asked for.'));
    expect(screen.getByRole('status')).toBe(status);
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

  test('the send is a busy button while the server answers: aria-busy, its name kept, a second press asks once, and no Sending… line', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.requestCode.bind(w.fake);
    const spy = vi.spyOn(w.fake, 'requestCode').mockImplementation((email, invite, next) => new Promise((resolve) => { release = () => resolve(real(email, invite, next)); }));
    open(w, 'sign-in');
    await ask('known@example.test');
    const send = screen.getByRole('button', { name: 'Send a code' });
    expect(send).toHaveAttribute('aria-busy', 'true');
    expect(send).toBeEnabled();
    expect(screen.getByRole('form', { name: 'Sign in' })).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(send);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sending…')).toBeNull();
    release();
    await screen.findByLabelText('Code from the email');
  });

  test('the sign-in button is busy while the code is checked, keeps its name, and no Checking the code… line shows', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    const field = await screen.findByLabelText('Code from the email');
    let release!: () => void;
    const real = w.fake.verifyCode.bind(w.fake);
    const spy = vi.spyOn(w.fake, 'verifyCode').mockImplementation((email, code) => new Promise((resolve) => { release = () => resolve(real(email, code)); }));
    await userEvent.type(field, TEST_CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(signIn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Checking the code…')).toBeNull();
    release();
    await waitFor(async () => expect((await w.fake.session()).account).toBe(w.known));
  });

  test('a request that gets no answer ends the wait and says so', async () => {
    const w = world();
    w.fake.requestCode = () => Promise.reject(new Error('offline'));
    open(w, 'sign-in');
    await ask('known@example.test');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no answer came back/iu);
    expect(screen.getByRole('button', { name: 'Send a code' })).toBeEnabled();
  });

  test('a verify that gets no answer ends the wait and says so', async () => {
    const w = world();
    open(w, 'sign-in');
    await ask('known@example.test');
    w.fake.verifyCode = () => Promise.reject(new Error('offline'));
    await userEvent.type(await screen.findByLabelText('Code from the email'), '123456{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no answer came back/iu);
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
    /* The alert and the acknowledgement's note both describe it. */
    expect((box.getAttribute('aria-describedby') ?? '').split(' ').sort()).toEqual([alert.id, 'kb-ack-note'].sort());
  });

  /* Every address the screen goes to is recorded. The test renders the screen at any path, so once it reaches the page it
     goes on to the index; that page is only a moment's address, and only the first step shows where the screen went. */
  const record = () => {
    const went: string[] = [];
    for (const how of ['pushState', 'replaceState'] as const) {
      const real = window.history[how].bind(window.history);
      vi.spyOn(window.history, how).mockImplementation((data, unused, url) => { went.push(String(url)); real(data, unused, url); });
    }
    return went;
  };

  test('after the code it returns to the page the player came from', async () => {
    const w = world();
    open(w, 'sign-in', '/sign-in?next=%2Fstandings');
    await ask('known@example.test');
    const went = record();
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(() => expect(went.length).toBeGreaterThan(0));
    expect(went[0]).toBe('/standings');
  });

  test('asking for a code passes the page the player came from, and nothing where there is none or it is not this site\'s', async () => {
    for (const [search, sent] of [['?next=%2Fboard%2Fgeneral%3Fpage%3D2', '/board/general?page=2'], ['', null], ['?next=%2F', null], ['?next=%2F%2Fevil.example', null]] as const) {
      const w = world();
      open(w, 'sign-in', `/sign-in${search}`);
      await ask('known@example.test');
      await screen.findByLabelText('Code from the email');
      expect(w.fake.lastNext(), search).toBe(sent);
      cleanup();
    }
  });

  test('after the code it returns only to a path on this site', async () => {
    const w = world();
    open(w, 'sign-in', '/sign-in?next=%2F%2Fevil.example%2Fx');
    await ask('known@example.test');
    /* It ends on the index either way, so only every step can show that it never went to the other site's path. */
    const went = record();
    await userEvent.type(await screen.findByLabelText('Code from the email'), `${TEST_CODE}{Enter}`);
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(went.length).toBeGreaterThan(0);
    expect(went.filter((u) => u !== '/')).toEqual([]);
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

  test('registration closed is said plainly and once, with the way on: the account opens once an admin opens registration', async () => {
    const w = world('closed');
    open(w, 'register', '/register', 'closed');
    expect(await screen.findByText('No password. We email you a code and a link. Registration is closed, so your account opens once an admin opens it.')).toBeInTheDocument();
    expect(screen.getAllByText(/Registration is closed/u)).toHaveLength(1);
  });

  test('New here? says how registration works in each mode: invite, open and closed', async () => {
    open(world('invite'), 'sign-in', '/sign-in', 'invite');
    expect(await within(await screen.findByRole('complementary', { name: 'Other ways in' })).findByText('Registering takes an invite from someone who plays. The same email code signs you in after.')).toBeInTheDocument();
    cleanup();
    open(world('open'), 'sign-in', '/sign-in', 'open');
    expect(await within(await screen.findByRole('complementary', { name: 'Other ways in' })).findByText('Anyone can register. The same email code signs you in after.')).toBeInTheDocument();
    cleanup();
    open(world('closed'), 'sign-in', '/sign-in', 'closed');
    expect(await within(await screen.findByRole('complementary', { name: 'Other ways in' })).findByText('Registration is closed right now. You can still leave your email; when an admin opens registration, your next sign-in opens your account.')).toBeInTheDocument();
  });

  test('the register lead says the closed words only while registration is closed', async () => {
    open(world('closed'), 'register', '/register', 'closed');
    expect(await screen.findByText('No password. We email you a code and a link. Registration is closed, so your account opens once an admin opens it.')).toBeInTheDocument();
    cleanup();
    open(world('open'), 'register', '/register', 'open');
    expect(await screen.findByText('No password. We email you a code and a link; either one makes your account.')).toBeInTheDocument();
  });

  test('a session with no account (the emailed link landed) is offered an invite to open it', async () => {
    const w = world();
    const made = await (async () => { w.fake.signInAs(w.known); const r = await w.fake.createInvite(); w.fake.signInAs(null); return r; })();
    if (!made.ok) throw new Error('seed');
    await w.fake.requestCode('linked@example.test', null, null);
    await w.fake.verifyCode('linked@example.test', TEST_CODE);
    expect((await w.fake.session()).account).toBeNull();
    open(w, 'sign-in');
    await userEvent.type(await screen.findByLabelText('Invite'), `${made.value.code}{Enter}`);
    await waitFor(async () => expect((await w.fake.session()).account).not.toBeNull());
  });
});

describe('The emailed link', () => {
  const FRAGMENT = `#token_hash=${TEST_LINK}`;
  /* The address the last code was asked for is the one the fake's link signs in, as the email's would. */
  const linked = async (address = 'known@example.test') => {
    const w = world();
    await w.fake.requestCode(address, null, null);
    return w;
  };
  const went = () => {
    const urls: string[] = [];
    for (const how of ['pushState', 'replaceState'] as const) {
      const real = window.history[how].bind(window.history);
      vi.spyOn(window.history, how).mockImplementation((data, unused, url) => { urls.push(String(url)); real(data, unused, url); });
    }
    return urls;
  };

  test('shows the panel and no email field, has asked nothing yet, and leaves no fragment in the address', async () => {
    const w = await linked();
    const verify = vi.spyOn(w.fake, 'verifyLink');
    open(w, 'sign-in', `/sign-in?next=%2Fstandings${FRAGMENT}`);
    expect(await screen.findByText('This link signs you in. It works once.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a code instead' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Other ways in' })).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/sign-in');
    expect(window.location.search).toBe('?next=%2Fstandings');
    expect(window.location.href).not.toContain(TEST_LINK);
  });

  test('the fragment is stripped by replacing the entry, and no pushed address ever held the token', async () => {
    const w = await linked();
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    open(w, 'sign-in', `/sign-in?next=%2Fstandings${FRAGMENT}`);
    await screen.findByText('This link signs you in. It works once.');
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls.some(([, , url]) => !String(url).includes(TEST_LINK))).toBe(true);
    expect(push.mock.calls.filter(([, , url]) => String(url).includes(TEST_LINK))).toEqual([]);
  });

  test('when the address cannot be read, the signed-in states still say a sentence and take focus', async () => {
    const w = await linked();
    vi.spyOn(w.fake, 'signInAddress').mockRejectedValue(new Error('offline'));
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    const done = await screen.findByText('You are signed in.');
    await waitFor(() => expect(document.activeElement).toBe(done));
  });

  test('moves focus to the panel\'s first sentence when it stands, and again when the state changes', async () => {
    open(await linked(), 'sign-in', `/sign-in${FRAGMENT}`);
    const lead = await screen.findByText('This link signs you in. It works once.');
    await waitFor(() => expect(document.activeElement).toBe(lead));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const done = await screen.findByText('You are signed in as known@example.test.');
    await waitFor(() => expect(document.activeElement).toBe(done));
  });

  test('the press signs in, names the address, and Continue goes on to the page the player came from', async () => {
    const w = await linked();
    open(w, 'sign-in', `/sign-in?next=%2Fstandings${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('You are signed in as known@example.test.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('You are signed in as known@example.test.');
    expect((await w.fake.session()).account).not.toBeNull();
    const urls = went();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[0]).toBe('/standings');
  });

  test('Continue goes to the index where the link\'s next is another site\'s', async () => {
    const w = await linked();
    open(w, 'sign-in', `/sign-in?next=%2F%2Fevil.example%2Fx${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await screen.findByText('You are signed in as known@example.test.');
    const urls = went();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls).toEqual(['/']);
  });

  test('Not you? Sign out signs out and shows the form', async () => {
    const w = await linked();
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Not you? Sign out' }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect((await w.fake.session()).signedIn).toBe(false);
    expect(screen.queryByText(/You are signed in as/u)).toBeNull();
  });

  test('a sign-out that fails says so, keeps the panel and moves nobody on; a second press signs out', async () => {
    const w = await linked();
    open(w, 'sign-in', `/sign-in?next=%2Fstandings${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await screen.findByText('You are signed in as known@example.test.');
    const urls = went();
    const failing = vi.spyOn(w.fake, 'signOut').mockRejectedValueOnce(new Error('no answer'));
    await userEvent.click(screen.getByRole('button', { name: 'Not you? Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Signing out did not work. You are still signed in as known@example.test.');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(urls).toEqual([]);
    expect((await w.fake.session()).signedIn).toBe(true);
    failing.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Not you? Sign out' }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect((await w.fake.session()).signedIn).toBe(false);
  });

  test('a link the server refuses shows the form with its sentence in the alert', async () => {
    const w = await linked();
    open(w, 'sign-in', '/sign-in#token_hash=aaaaaaaaaaaaaaaaaaaa');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('that link does not work, or it has expired: ask for a new code');
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).not.toHaveAttribute('aria-invalid');
  });

  test('a lost answer says so, and the button reads Try again', async () => {
    const w = await linked();
    vi.spyOn(w.fake, 'verifyLink').mockRejectedValueOnce(new Error('network'));
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LOST_ANSWER);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You are signed in as known@example.test.')).toBeInTheDocument();
  });

  test('Use a code instead sets the link aside and shows the form', async () => {
    const w = await linked();
    const verify = vi.spyOn(w.fake, 'verifyLink');
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Use a code instead' }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();
  });

  describe('opened while signed in as another address', () => {
    const other = async () => {
      const w = await linked('other@example.test');
      w.fake.seed.account('other', { email: 'other@example.test' });
      w.fake.signInAs(w.known);
      return w;
    };

    test('names that address, and Stay signed in goes on as that account without asking the link', async () => {
      const w = await other();
      const verify = vi.spyOn(w.fake, 'verifyLink');
      open(w, 'sign-in', `/sign-in?next=%2Fstandings${FRAGMENT}`);
      expect(await screen.findByText('This browser is signed in as known@example.test. Using the link signs that account out.')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('This browser is signed in as known@example.test.');
      expect(window.location.pathname).toBe('/sign-in');
      const urls = went();
      await userEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
      await waitFor(() => expect(urls.length).toBeGreaterThan(0));
      expect(urls[0]).toBe('/standings');
      expect(verify).not.toHaveBeenCalled();
    });

    test('a hash the server refuses is seen: the sentence shows in the alert, nothing navigates, and Stay signed in then goes on', async () => {
      const w = await other();
      open(w, 'sign-in', '/sign-in?next=%2Fstandings#token_hash=aaaaaaaaaaaaaaaaaaaa');
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in with the link' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('that link does not work, or it has expired: ask for a new code');
      expect(screen.getByLabelText('Email address')).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 50));
      expect(window.location.pathname).toBe('/sign-in');
      expect(screen.getByRole('alert')).toBeInTheDocument();
      const urls = went();
      await userEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
      await waitFor(() => expect(urls.length).toBeGreaterThan(0));
      expect(urls[0]).toBe('/standings');
    });

    test('a signed-out refusal offers no Stay signed in', async () => {
      const w = await linked();
      open(w, 'sign-in', '/sign-in#token_hash=aaaaaaaaaaaaaaaaaaaa');
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: 'Stay signed in' })).toBeNull();
    });

    test('Sign in with the link replaces the session and names the new address', async () => {
      const w = await other();
      open(w, 'sign-in', `/sign-in${FRAGMENT}`);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in with the link' }));
      expect(await screen.findByText('You are signed in as other@example.test.')).toBeInTheDocument();
      expect(w.fake.emailOf((await w.fake.session()).account!)).toBe('other@example.test');
    });
  });

  test('a login with no open account shows the way on with its reason', async () => {
    const w = await linked('new@example.test');
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/that invite opens nothing; open the account with another invite/u)).toBeInTheDocument();
    expect(screen.getByLabelText('Invite')).toBeInTheDocument();
    expect(screen.queryByText(/You are signed in as/u)).toBeNull();
  });

  test('on Register it finishes signing up', async () => {
    const w = await linked();
    open(w, 'register', `/register${FRAGMENT}`);
    expect(await screen.findByText('This link finishes signing you up. It works once.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Finish signing up' }));
    expect(await screen.findByText('You are signed in as known@example.test.')).toBeInTheDocument();
  });

  test.each(['#top', '#token_hash=', '#token_hash=short'])('a fragment of %s shows the ordinary form', async (fragment) => {
    open(await linked(), 'sign-in', `/sign-in${fragment}`);
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByText('This link signs you in. It works once.')).toBeNull();
  });

  /* No provider is rendered here: the link lives in the screen's own state, so a screen that is gone holds nothing for the next. */
  test('a screen with no provider holds nothing: a later visit with no fragment shows the ordinary form', async () => {
    const w = await linked();
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    expect(await screen.findByText('This link signs you in. It works once.')).toBeInTheDocument();
    cleanup();
    open(w, 'sign-in', '/sign-in');
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByText('This link signs you in. It works once.')).toBeNull();
  });

  test('the same after a press that signed in: the next visit is the ordinary form', async () => {
    const w = await linked();
    open(w, 'sign-in', `/sign-in${FRAGMENT}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('You are signed in as known@example.test.')).toBeInTheDocument();
    cleanup();
    open(w, 'sign-in', '/sign-in');
    expect(screen.queryByText(/You are signed in as/u)).toBeNull();
    expect(screen.queryByText('This link signs you in. It works once.')).toBeNull();
  });

  /* A provider above the screen (the app's) keeps the link and the press across the screen starting afresh, which a key change stands in for. */
  describe('under a link hand provider', () => {
    function Remountable({ mode = 'sign-in' }: { readonly mode?: 'sign-in' | 'register' }) {
      const [n, setN] = useState(0);
      return <><button type="button" onClick={() => setN((v) => v + 1)}>Start afresh</button><SignInScreen key={n} mode={mode} /></>;
    }
    /* The routes render the same screen at the same position for both paths, so a move between them does not remount it. */
    function Moves() {
      const navigate = useNavigate();
      const { path } = useLocation();
      return <><button type="button" onClick={() => navigate('/register')}>Go to register</button><SignInScreen mode={path === '/register' ? 'register' : 'sign-in'} /></>;
    }
    const openHeld = (w: ReturnType<typeof world>, path: string) => renderIn(w.fake, <LinkHandProvider><Remountable /></LinkHandProvider>, { path });

    test('a screen started afresh after the press still says the press signed in', async () => {
      const w = await linked();
      openHeld(w, `/sign-in${FRAGMENT}`);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
      expect(await screen.findByText('You are signed in as known@example.test.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Start afresh' }));
      expect(await screen.findByText('You are signed in as known@example.test.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    test('after Continue, a screen started afresh shows no panel', async () => {
      const w = await linked();
      openHeld(w, `/sign-in${FRAGMENT}`);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      await userEvent.click(screen.getByRole('button', { name: 'Start afresh' }));
      await waitFor(() => expect(screen.queryByText(/You are signed in as/u)).toBeNull());
      expect(screen.queryByText('This link signs you in. It works once.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    });

    test('a move of the address to the other screen sets the link aside, under the provider too', async () => {
      const w = await linked();
      const verify = vi.spyOn(w.fake, 'verifyLink');
      renderIn(w.fake, <LinkHandProvider><Moves /></LinkHandProvider>, { path: `/sign-in${FRAGMENT}` });
      await screen.findByText('This link signs you in. It works once.');
      await userEvent.click(screen.getByRole('button', { name: 'Go to register' }));
      expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
      expect(screen.queryByText(/This link/u)).toBeNull();
      expect(verify).not.toHaveBeenCalled();
    });

    test('a refused link leaves the form, and a screen started afresh shows no panel', async () => {
      const w = await linked();
      openHeld(w, '/sign-in#token_hash=aaaaaaaaaaaaaaaaaaaa');
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('that link does not work');
      await userEvent.click(screen.getByRole('button', { name: 'Start afresh' }));
      expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
      expect(screen.queryByText('This link signs you in. It works once.')).toBeNull();
    });

    test('a link that opens no account shows the way on, and a screen started afresh brings no panel back', async () => {
      const w = world('closed');
      await w.fake.requestCode('new@example.test', null, null);
      renderIn(w.fake, <LinkHandProvider><Remountable mode="register" /></LinkHandProvider>, { path: `/register${FRAGMENT}`, settings: { registrationMode: 'closed' } });
      await userEvent.click(await screen.findByRole('button', { name: 'Finish signing up' }));
      await waitFor(() => expect(screen.queryByText('This link finishes signing you up. It works once.')).toBeNull());
      await userEvent.click(screen.getByRole('button', { name: 'Start afresh' }));
      await waitFor(() => expect(screen.queryByText('This link finishes signing you up. It works once.')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Finish signing up' })).toBeNull();
      expect(screen.queryByLabelText('Email address')).toBeNull();
    });

    test('a link not yet pressed is still in hand after starting afresh', async () => {
      const w = await linked();
      openHeld(w, `/sign-in${FRAGMENT}`);
      await screen.findByText('This link signs you in. It works once.');
      await userEvent.click(screen.getByRole('button', { name: 'Start afresh' }));
      expect(await screen.findByText('This link signs you in. It works once.')).toBeInTheDocument();
    });
  });
});
