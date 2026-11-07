import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Link } from '../router.tsx';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
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

  test('starts on the stored pronouns, saves a new set with the rest, and a bad custom set disables saving', async () => {
    const w = world();
    const xe = { subject: 'xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: false };
    const setProfile = vi.spyOn(w.fake, 'setProfile');
    await open(w);
    await screen.findByLabelText('Title');
    const group = screen.getByRole('group', { name: 'Pronouns' });
    expect(within(group).getByRole('radio', { name: /^it\/its/u })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: /^Custom/u }));
    const save = screen.getByRole('button', { name: 'Save the profile' });
    expect(save).toBeEnabled();
    await userEvent.clear(screen.getByLabelText('Subject'));
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Subject'), 'abcdefghijklm');
    expect(screen.getByText('the subject has 13 characters; at most 12')).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Subject'));
    for (const [label, v] of [['Subject', 'Xe'], ['Object', 'xem'], ['Possessive adjective', 'xyr'], ['Possessive', 'xyrs'], ['Reflexive', 'xemself']] as const) { await userEvent.clear(screen.getByLabelText(label)); await userEvent.type(screen.getByLabelText(label), v); }
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(setProfile).toHaveBeenCalledWith(w.pipe, '', '', 'default', { ...xe, subject: 'Xe' }));
    expect((await w.fake.characters([w.pipe]))[0]!.pronouns).toEqual(xe);
  });

  test('opens on a stored custom set with its fields filled, and saves it untouched as it was', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me2');
    const xe = { subject: 'xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: false };
    const gloomba = fake.seed.character(me, 'Gloomba', 'face', { pronouns: xe });
    fake.signInAs(me);
    const setProfile = vi.spyOn(fake, 'setProfile');
    renderIn(fake, <ProfileEdit />, { path: '/characters/edit' });
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Custom/u })).toBeChecked();
    expect(screen.getByLabelText('Subject')).toHaveValue('xe');
    expect(screen.getByLabelText('Reflexive')).toHaveValue('xemself');
    await userEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    await waitFor(() => expect(setProfile).toHaveBeenCalledWith(gloomba, '', '', 'default', xe));
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
    await waitFor(() => expect(setProfile).toHaveBeenCalledWith(w.pipe, 'Professional Wrench', 'I [b]brought[/b] a wrench.', 'default', PRONOUN_PRESETS.it));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect((await w.fake.characters([w.pipe]))[0]).toMatchObject({ title: 'Professional Wrench', signature: 'I [b]brought[/b] a wrench.' });
  });

  test('previews the postbit as the board will draw it, beside the fields, following what is typed and sending nothing', async () => {
    const w = world();
    const setProfile = vi.spyOn(w.fake, 'setProfile');
    await open(w);
    const aside = await screen.findByRole('complementary', { name: 'What everyone will see' });
    const postbit = await within(aside).findByRole('group', { name: 'About Pipewrench' });
    /* The page is two columns: the fields, and the preview beside them. */
    expect(aside.closest('.kb-profile-columns')).toBe(screen.getByLabelText('Title').closest('.kb-profile-columns'));
    expect(within(postbit).queryByText('Magenta enthusiast')).toBeNull();
    await userEvent.type(screen.getByLabelText('Title'), 'Magenta enthusiast');
    expect(within(postbit).getByText('Magenta enthusiast')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Signature'));
    await userEvent.paste('I [b]brought[/b] it.');
    expect(within(aside).getByText('brought').tagName).toBe('STRONG');
    expect(within(postbit).getByText(/^Posts: \d+$/u)).toBeInTheDocument();
    /* The preview is the form's own values: nothing was sent, and the post is drawn as the thread draws it, a name that links nowhere. */
    expect(setProfile).not.toHaveBeenCalled();
    expect(within(postbit).queryByRole('link')).toBeNull();
    expect(aside).toHaveTextContent('The preview follows what you type. Nothing changes on the board until you save.');
  });

  test('reserves the postbit column and says it is busy until what it shows has been read', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.characterCounts.bind(w.fake);
    vi.spyOn(w.fake, 'characterCounts').mockImplementation(async (id) => { await new Promise<void>((r) => { release = r; }); return real(id); });
    await open(w);
    const aside = await screen.findByRole('complementary', { name: 'What everyone will see' });
    const side = aside.querySelector('.kb-profile-preview-side')!;
    expect(side).toHaveAttribute('aria-busy', 'true');
    expect(within(aside).queryByRole('group', { name: 'About Pipewrench' })).toBeNull();
    await waitFor(() => expect(release).toBeDefined());
    release();
    await within(aside).findByRole('group', { name: 'About Pipewrench' });
    expect(side).not.toHaveAttribute('aria-busy', 'true');
  });

  test('the preview says the class its player made public, as the thread does, and no more', async () => {
    const w = world();
    const { thread } = w.fake.seed.thread('general', w.pipe, 'A thread', 'Hi.');
    expect((await w.fake.unmask(w.pipe, thread, '')).ok).toBe(true);
    await open(w);
    const postbit = await within(await screen.findByRole('complementary', { name: 'What everyone will see' })).findByRole('group', { name: 'About Pipewrench' });
    expect(postbit).toHaveTextContent(/Revealed: Face/u);
    expect(postbit).not.toHaveTextContent(/Has Turned/u);
  });

  test('says the title and the signature each on their count line, the hint at the left', async () => {
    const w = world();
    await open(w);
    const title = await screen.findByLabelText('Title');
    const titleCount = document.getElementById(title.getAttribute('aria-describedby')!)!;
    expect(titleCount.children[0]).toHaveTextContent('Under the name on every post.');
    expect(titleCount.children[1]).toHaveTextContent('0 of 40');
    const signatureCount = document.getElementById(screen.getByLabelText('Signature').getAttribute('aria-describedby')!)!;
    expect(signatureCount.children[0]).toHaveTextContent('BBCode, as in a post.');
    expect(signatureCount.children[1]).toHaveTextContent('0 of 500');
  });

  test('sets the lead under the title', async () => {
    const w = world();
    await open(w);
    await screen.findByLabelText('Title');
    expect(screen.getByText(/What you set here is public/u).closest('.kb-page-head')).toHaveAttribute('data-kb-lead', 'under');
  });

  test('holds the title to 40 characters and the signature to 500, and counts them', async () => {
    const w = world();
    await open(w);
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('Signature')).toHaveAttribute('maxlength', '500');
    await userEvent.type(title, 'abc');
    expect(screen.getAllByText('3 of 40')).toHaveLength(1);
  });

  test('shows a refusal in the server\'s words', async () => {
    const w = world();
    vi.spyOn(w.fake, 'setProfile').mockResolvedValue({ ok: false, error: 'a title is at most 40 characters' });
    await open(w);
    await screen.findByLabelText('Title');
    await userEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a title is at most 40 characters');
  });

  test('has the avatar cropper: a secondary button labels a file input the eye never sees, beside the two crops\' frames', async () => {
    const w = world();
    await open(w);
    const input = await screen.findByLabelText('Choose a picture');
    expect(input).toHaveAttribute('type', 'file');
    /* Only the button is in the accessibility tree: one control named Choose a picture, not two. */
    expect(input).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('button', { name: 'Choose a picture' })).toHaveLength(1);
    expect(document.querySelectorAll('input[type=file]:not([aria-hidden=true])')).toHaveLength(0);
    expect(input).toHaveClass('kb-visually-hidden');
    const button = screen.getByRole('button', { name: 'Choose a picture' });
    expect(button).toHaveAttribute('data-kb-kind', 'secondary');
    /* The button opens the picker the input holds; the input itself is out of the tab order, as the button stands for it. */
    const picker = vi.spyOn(input as HTMLInputElement, 'click');
    await userEvent.click(button);
    expect(picker).toHaveBeenCalled();
    expect(input).toHaveAttribute('tabindex', '-1');
    const frames = document.querySelectorAll('.kb-avatar-frame');
    expect([...frames].map((f) => f.getAttribute('data-kb-frame'))).toEqual(['portrait', 'square']);
    expect(screen.getByText('No picture yet.')).toBeInTheDocument();
  });
});
