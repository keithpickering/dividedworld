import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
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
const open = (w: ReturnType<typeof world>, id: string) => renderIn(w.fake, <ProfileEdit id={id} />, { path: `/characters/${id}/edit` });

describe('profile edit', () => {
  test('says plainly that another player\'s character is not one of yours, and links back', async () => {
    const w = world();
    open(w, w.stranger);
    expect(await screen.findByText(/is not one of your characters/u)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your characters' })).toHaveAttribute('href', '/characters');
    expect(screen.queryByLabelText('Title')).toBeNull();
    /* An id that is nobody's reads the same. */
    cleanup();
    open(w, '00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText(/is not one of your characters/u)).toBeInTheDocument();
  });

  test('a character waiting to debut has no profile to edit yet', async () => {
    const w = world();
    open(w, w.waiting);
    expect(await screen.findByText(/waiting to debut/iu)).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  test('edits the title, the signature and the pip style', async () => {
    const w = world();
    const setProfile = vi.spyOn(w.fake, 'setProfile');
    open(w, w.pipe);
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
    open(w, w.pipe);
    await userEvent.click(await screen.findByLabelText('Signature'));
    await userEvent.paste('I [b]brought[/b] it.');
    const preview = screen.getByRole('group', { name: 'Signature preview' });
    expect(within(preview).getByText('brought').tagName).toBe('STRONG');
  });

  test('holds the title to 40 characters and the signature to 500, and counts them', async () => {
    const w = world();
    open(w, w.pipe);
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('Signature')).toHaveAttribute('maxlength', '500');
    await userEvent.type(title, 'abc');
    expect(screen.getByText('3 of 40')).toBeInTheDocument();
  });

  test('shows a refusal in the server\'s words', async () => {
    const w = world();
    vi.spyOn(w.fake, 'setProfile').mockResolvedValue({ ok: false, error: 'a title is at most 40 characters' });
    open(w, w.pipe);
    await screen.findByLabelText('Title');
    await userEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a title is at most 40 characters');
  });

  test('has the avatar cropper', async () => {
    const w = world();
    open(w, w.pipe);
    expect(await screen.findByLabelText('Choose a picture')).toBeInTheDocument();
  });
});
