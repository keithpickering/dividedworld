import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Link } from '../router.tsx';
import { ProfileEdit } from './ProfileEdit.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'face');
  const waiting = fake.seed.character(me, 'Spritey', 'heel', { debuted: false });
  const stranger = fake.seed.character(other, 'Stranger', 'heel');
  fake.signInAs(me);
  return { fake, pipe, waiting, stranger };
}
/** Opens the one address the page has; `name` picks a character in the page, as a player does. */
const open = async (w: ReturnType<typeof world>, name?: string) => {
  renderIn(w.fake, <ProfileEdit />, { path: '/characters/edit' });
  if (name) await userEvent.selectOptions(await screen.findByLabelText('Character'), name);
};

describe('profile edit', () => {
  test('the character is chosen in the page, from the player\'s own characters only, and defaults to the HUD\'s', async () => {
    const w = world();
    await open(w);
    const select = await screen.findByLabelText('Character');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pipewrench', 'Spritey']);
    expect(select).toHaveValue(w.pipe);
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/characters/edit');
  });

  test('a character carried from the My characters link in history.state opens first; a stranger\'s id there is ignored', async () => {
    const w = world();
    renderIn(w.fake, <><Link to="/characters/edit" state={{ character: w.waiting }}>mine</Link><Link to="/characters/edit" state={{ character: w.stranger }}>theirs</Link><ProfileEdit /></>, { path: '/characters' });
    await userEvent.click(await screen.findByRole('link', { name: 'mine' }));
    expect(await screen.findByLabelText('Character')).toHaveValue(w.waiting);
    expect(await screen.findByText(/waiting to debut/iu)).toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/characters/edit');
    await userEvent.click(screen.getByRole('link', { name: 'theirs' }));
    expect(await screen.findByLabelText('Character')).toHaveValue(w.pipe);
  });

  test('choosing another character in the page puts nothing in the address', async () => {
    const w = world();
    await open(w);
    await screen.findByLabelText('Title');
    await userEvent.selectOptions(screen.getByLabelText('Character'), 'Spritey');
    expect(window.location.href).not.toContain(w.waiting);
    expect(window.location.href).not.toContain(w.pipe);
    expect(window.location.pathname).toBe('/characters/edit');
  });

  test('no link on the page puts a character in an address', async () => {
    const w = world();
    await open(w);
    await screen.findByLabelText('Title');
    for (const a of document.querySelectorAll('a[href]')) {
      for (const id of [w.pipe, w.waiting]) expect(a.getAttribute('href')).not.toContain(id);
    }
  });

  test('says plainly that a player with no characters has no profile to edit, and links to making one', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('lonely'));
    renderIn(fake, <ProfileEdit />, { path: '/characters/edit' });
    expect(await screen.findByText(/no characters yet/iu)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make a character' })).toHaveAttribute('href', '/characters/new');
  });

  test('a character waiting to debut has no profile to edit yet', async () => {
    const w = world();
    await open(w, 'Spritey');
    expect(await screen.findByText(/waiting to debut/iu)).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  test('edits the title, the signature and the pip style', async () => {
    const w = world();
    const setProfile = vi.spyOn(w.fake, 'setProfile');
    await open(w);
    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, 'Professional Wrench');
    await userEvent.click(screen.getByLabelText('Signature'));
    await userEvent.paste('I [b]brought[/b] a wrench.');
    expect(screen.getByLabelText('Pip style')).toHaveValue('default');
    expect(within(screen.getByLabelText('Pip style')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default']);
    await userEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    await waitFor(() => expect(setProfile).toHaveBeenCalledWith(w.pipe, 'Professional Wrench', 'I [b]brought[/b] a wrench.', 'default'));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect((await w.fake.characters([w.pipe]))[0]).toMatchObject({ title: 'Professional Wrench', signature: 'I [b]brought[/b] a wrench.' });
  });

  test('previews the signature as it will be drawn', async () => {
    const w = world();
    await open(w);
    await userEvent.click(await screen.findByLabelText('Signature'));
    await userEvent.paste('I [b]brought[/b] it.');
    const preview = screen.getByRole('group', { name: 'Signature preview' });
    expect(within(preview).getByText('brought').tagName).toBe('STRONG');
  });

  test('holds the title to 40 characters and the signature to 500, and counts them', async () => {
    const w = world();
    await open(w);
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('Signature')).toHaveAttribute('maxlength', '500');
    await userEvent.type(title, 'abc');
    expect(screen.getByText('3 of 40')).toBeInTheDocument();
  });

  test('shows a refusal in the server\'s words', async () => {
    const w = world();
    vi.spyOn(w.fake, 'setProfile').mockResolvedValue({ ok: false, error: 'a title is at most 40 characters' });
    await open(w);
    await screen.findByLabelText('Title');
    await userEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a title is at most 40 characters');
  });

  test('has the avatar cropper', async () => {
    const w = world();
    await open(w);
    expect(await screen.findByLabelText('Choose a picture')).toBeInTheDocument();
  });
});
