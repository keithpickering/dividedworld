/**
 * An admin's Write an update (the alerts plan, Task 7): a title, the words, and the plain What changed list as rows of a label and a text; it
 * posts through `postUpdate` as the instance's developer persona. It is plain text (an admin writes it, no model does), shows the server's
 * refusal in the server's words and keeps what was written, and sends nothing twice.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { Update } from '../data/api.ts';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { WriteUpdate } from './WriteUpdate.tsx';

const instance: Instance = { ...testInstance, developer: { name: 'Gabe', tagline: 'Made this. Sorry.' } };

function world(admin = true) {
  const fake = buildWorld(undefined, instance);
  const account = fake.seed.account('admin');
  fake.seed.admin(account, admin);
  fake.signInAs(account);
  return fake;
}

const form = () => screen.getByRole('form', { name: 'Write an update' });
const fill = async (title: string, words: string) => {
  await userEvent.type(within(form()).getByLabelText('Title'), title);
  await userEvent.type(within(form()).getByLabelText('Words'), words);
};

describe('Write an update', () => {
  test('names who it posts as, that every player is told, and that no model writes it', () => {
    renderIn(world(), <WriteUpdate />, { instance });
    expect(within(form()).getByText(/posts as Gabe/u)).toBeInTheDocument();
    expect(within(form()).getByText(/Every player gets it as an alert/u)).toBeInTheDocument();
    expect(within(form()).getByText(/No model writes it/u)).toBeInTheDocument();
    expect(within(form()).getByRole('textbox', { name: 'Change 1 label' })).toBeInTheDocument();
    expect(within(form()).getByRole('textbox', { name: 'Change 1 text' })).toBeInTheDocument();
  });

  test('posts the title, the words and the changes, then clears, says so, and hands the update to its page', async () => {
    const fake = world();
    const onWritten = vi.fn<(u: Update) => void>();
    renderIn(fake, <WriteUpdate onWritten={onWritten} />, { instance });
    await fill('Traps bite', 'The trap was offended.');
    await userEvent.type(within(form()).getByRole('textbox', { name: 'Change 1 label' }), 'Trap Card');
    await userEvent.type(within(form()).getByRole('textbox', { name: 'Change 1 text' }), 'catches more.');
    await userEvent.click(within(form()).getByRole('button', { name: 'Add a change' }));
    await userEvent.type(within(form()).getByRole('textbox', { name: 'Change 2 text' }), 'No label here.');
    await userEvent.click(within(form()).getByRole('button', { name: 'Post update' }));
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1));
    expect(onWritten.mock.calls[0]![0]).toMatchObject({ title: 'Traps bite', body: 'The trap was offended.', name: 'Gabe', changes: [{ label: 'Trap Card', text: 'catches more.' }, { label: '', text: 'No label here.' }] });
    expect((await fake.updates()).map((u) => u.title)).toEqual(['Traps bite']);
    expect(await screen.findByText('Posted. Every player has it in their alerts.')).toBeInTheDocument();
    expect(within(form()).getByLabelText('Title')).toHaveValue('');
    expect(within(form()).getByLabelText('Words')).toHaveValue('');
    expect(within(form()).getAllByRole('textbox', { name: /^Change \d+ (label|text)$/u })).toHaveLength(2);
  });

  test('a refusal comes back in the server\'s words, and what was written stays', async () => {
    renderIn(world(), <WriteUpdate />, { instance });
    await fill('Traps bite', 'Words.');
    await userEvent.type(within(form()).getByRole('textbox', { name: 'Change 1 label' }), 'Orphan');
    await userEvent.click(within(form()).getByRole('button', { name: 'Post update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('change 1 has a label and no text; give it a text, or leave the row out');
    expect(within(form()).getByLabelText('Title')).toHaveValue('Traps bite');
    expect(within(form()).getByRole('textbox', { name: 'Change 1 label' })).toHaveValue('Orphan');
    // Mended, it goes.
    await userEvent.type(within(form()).getByRole('textbox', { name: 'Change 1 text' }), 'fixed.');
    await userEvent.click(within(form()).getByRole('button', { name: 'Post update' }));
    expect(await screen.findByText('Posted. Every player has it in their alerts.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a player who is not an admin is refused in the server\'s words', async () => {
    renderIn(world(false), <WriteUpdate />, { instance });
    await fill('Mine', 'Words.');
    await userEvent.click(within(form()).getByRole('button', { name: 'Post update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('only an admin writes an update');
  });

  test('a row is added and removed, at most 30, and the last one left is cleared rather than removed', async () => {
    renderIn(world(), <WriteUpdate />, { instance });
    const add = within(form()).getByRole('button', { name: 'Add a change' });
    for (let i = 0; i < 29; i++) await userEvent.click(add);
    expect(within(form()).getAllByRole('textbox', { name: /^Change \d+ text$/u })).toHaveLength(30);
    expect(add).toBeDisabled();
    await userEvent.type(within(form()).getByRole('textbox', { name: 'Change 2 text' }), 'two');
    await userEvent.click(within(form()).getByRole('button', { name: 'Remove change 1' }));
    expect(within(form()).getAllByRole('textbox', { name: /^Change \d+ text$/u })).toHaveLength(29);
    expect(within(form()).getByRole('textbox', { name: 'Change 1 text' })).toHaveValue('two');
    expect(add).toBeEnabled();
    for (let i = 0; i < 28; i++) await userEvent.click(within(form()).getByRole('button', { name: 'Remove change 1' }));
    expect(within(form()).getAllByRole('textbox', { name: /^Change \d+ text$/u })).toHaveLength(1);
    await userEvent.click(within(form()).getByRole('button', { name: 'Remove change 1' }));
    expect(within(form()).getByRole('textbox', { name: 'Change 1 text' })).toHaveValue('');
  });

  test('counts the words against what a post may hold, and holds the button while there is nothing to post or too much', async () => {
    renderIn(world(), <WriteUpdate />, { instance });
    const post = within(form()).getByRole('button', { name: 'Post update' });
    expect(post).toBeDisabled();
    await userEvent.type(within(form()).getByLabelText('Title'), 'T');
    expect(post).toBeDisabled();
    await userEvent.click(within(form()).getByLabelText('Words'));
    await userEvent.paste('x'.repeat(201));
    expect(within(form()).getByText('201 of 200')).toBeInTheDocument();
    expect(post).toBeDisabled();
  });

  test('says why the button is held: a blank form is described by a hint, and too long by a live line with the count', async () => {
    renderIn(world(), <WriteUpdate />, { instance });
    const post = within(form()).getByRole('button', { name: 'Post update' });
    expect(post).toBeDisabled();
    expect(post).toHaveAccessibleDescription('Give the update a title and some words to post it.');
    await userEvent.type(within(form()).getByLabelText('Title'), 'T');
    await userEvent.click(within(form()).getByLabelText('Words'));
    await userEvent.paste('x'.repeat(205));
    expect(within(form()).getByLabelText('Words')).toHaveAccessibleDescription('205 of 200');
    const live = within(form()).getByText('Too long by 5 characters');
    expect(live.closest('[aria-live="polite"]')).not.toBeNull();
    expect(post).toHaveAccessibleDescription('Too long by 5 characters');
    await userEvent.clear(within(form()).getByLabelText('Words'));
    await userEvent.paste('x'.repeat(200));
    expect(within(form()).queryByText(/Too long by/u)).toBeNull();
    expect(post).toBeEnabled();
    expect(post).not.toHaveAccessibleDescription();
  });

  test('a lost answer is not resent: it says to look before posting again, and keeps what was written', async () => {
    const fake = world();
    vi.spyOn(fake, 'postUpdate').mockResolvedValue({ ok: false, error: 'No answer came back. It may have gone through: look at Updates before you post it again.', uncertain: true });
    renderIn(fake, <WriteUpdate />, { instance });
    await fill('Once', 'Words.');
    await userEvent.click(within(form()).getByRole('button', { name: 'Post update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/may have gone through/u);
    expect(within(form()).getByLabelText('Title')).toHaveValue('Once');
    expect(fake.postUpdate).toHaveBeenCalledTimes(1);
  });
});
