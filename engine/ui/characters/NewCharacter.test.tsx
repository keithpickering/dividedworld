import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { NewCharacter } from './NewCharacter.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function world(per = 3) {
  const fake = buildWorld({ charactersPerPlayer: per });
  const me = fake.seed.account('me');
  fake.seed.character(me, 'Pipewrench', 'face');
  fake.signInAs(me);
  return { fake, me, per };
}
const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <NewCharacter />, { path: '/characters/new', settings: { charactersPerPlayer: w.per } });
const form = async () => screen.findByRole('form', { name: 'New character' });

describe('New character', () => {
  test('offers the class cards with the instance\'s descriptions', async () => {
    open(world());
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^Face/u })).toBeInTheDocument();
    expect(within(f).getByRole('radio', { name: /^Heel/u })).toBeInTheDocument();
    expect(within(f).getByText('The crowd favorite: earns from cheers.')).toBeInTheDocument();
    expect(within(f).getByText('Earns heat: boos and tomatoes.')).toBeInTheDocument();
  });

  test('previews what everyone will see, and shows no class unless "with its class" is chosen', async () => {
    open(world());
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    const preview = within(f).getByRole('group', { name: 'What everyone will see' });
    expect(preview).toHaveTextContent('Spritey debuts');
    expect(preview).toHaveTextContent(/next settlement/u);
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    await userEvent.click(within(f).getByRole('radio', { name: /^Silent/u }));
    expect(preview).toHaveTextContent(/Nothing is posted/u);
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    await userEvent.click(within(f).getByRole('radio', { name: /^Drop now/u }));
    expect(preview).toHaveTextContent(/first post is its entrance/u);
    await userEvent.click(within(f).getByRole('radio', { name: /^Announced, with its class/u }));
    expect(preview).toHaveTextContent('Spritey debuts as Heel');
    expect(preview).toHaveTextContent('Spritey revealed: Heel');
  });

  test('makes a character that waits to debut, announced by default, and leaves the player on My characters', async () => {
    const w = world();
    const create = vi.spyOn(w.fake, 'createCharacter');
    open(w);
    const f = await form();
    const submit = within(f).getByRole('button', { name: 'Make the character' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    expect(submit).toBeDisabled();
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledWith('Spritey', 'heel', 'tally', 'announced'));
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
    const mine = await w.fake.myCharacters();
    expect(mine.find((c) => c.name === 'Spritey')).toMatchObject({ debutedAt: null, class: 'heel' });
    expect((await w.fake.characters(mine.map((c) => c.id))).map((c) => c.name)).toEqual(['Pipewrench']);
  });

  test('can drop at once, silently', async () => {
    const w = world();
    const create = vi.spyOn(w.fake, 'createCharacter');
    open(w);
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Face/u }));
    await userEvent.click(within(f).getByRole('radio', { name: /^Drop now/u }));
    await userEvent.click(within(f).getByRole('radio', { name: /^Silent/u }));
    await userEvent.click(within(f).getByRole('button', { name: 'Make the character' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Spritey', 'face', 'now', 'silent'));
    expect((await w.fake.myCharacters()).find((c) => c.name === 'Spritey')!.debutedAt).not.toBeNull();
  });

  test('shows a refusal in the server\'s words and keeps what was typed', async () => {
    open(world());
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Pipewrench');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(f).getByRole('button', { name: 'Make the character' }));
    expect(await within(f).findByRole('alert')).toHaveTextContent('that name is taken');
    expect(within(f).getByLabelText('Name')).toHaveValue('Pipewrench');
  });

  test('on a full roster says so, and that an admin can retire a character on request', async () => {
    open(world(1));
    expect(await screen.findByText(/an admin can retire a character on request/iu)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New character' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to your characters' })).toHaveAttribute('href', '/characters');
  });
});
