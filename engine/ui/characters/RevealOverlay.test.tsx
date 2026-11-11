import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { RevealOverlay, type RevealOverlayProps } from './RevealOverlay.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The overlay rendered by itself, as an opener (the HUD, My characters) renders it. */
async function overlay(extra: Partial<RevealOverlayProps> & { readonly w?: World; readonly onDone?: (m: string) => void } = {}) {
  const { w = world(), ...props } = extra;
  const character = (await w.fake.myCharacters()).find((c) => c.name === 'Pipewrench')!;
  renderIn(w.fake, <RevealOverlay character={character} kicker="My characters › Reveal" onClose={() => {}} onDone={() => {}} {...props} />, { path: '/characters' });
  const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
  return { w, dialog, character };
}

type World = ReturnType<typeof world>;

function world() {
  const fake = buildWorld({ charactersPerPlayer: 4 });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'face', { at: Date.parse('2026-10-01T12:00:00Z'), pronouns: PRONOUN_PRESETS.she });
  const stranger = fake.seed.character(other, 'Stranger', 'heel', { at: Date.parse('2026-10-01T12:00:00Z') });
  fake.signInAs(me);
  return { fake, stranger };
}

const boardId = async (w: World, slug: string) => (await w.fake.boards()).find((b) => b.slug === slug)!.id;
const submitName = 'Reveal Pipewrench as a Face';

describe('RevealOverlay opened on a thread', () => {
  test('shows the thread at once, Reveal enabled, and the preview in that thread', async () => {
    const w = world();
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    const board = await boardId(w, 'general');
    const { dialog } = await overlay({ w, at: { id: t.thread, title: 'The tea thread', board } });
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('The tea thread');
    expect(within(dialog).getByRole('button', { name: submitName })).toBeEnabled();
    expect(dialog).toHaveTextContent('At once, in The tea thread.');
  });

  test('the board select shows the thread\'s board, and the thread is chosen though it is not among the newest', async () => {
    const w = world();
    const target = w.fake.seed.thread('general', w.stranger, 'Ancient history', 'x', { at: Date.parse('2026-09-01T12:00:00Z') });
    for (let i = 1; i <= 25; i++) w.fake.seed.thread('general', w.stranger, `Newer ${i}`, 'x', { at: Date.parse('2026-10-01T12:00:00Z') + i * 1000 });
    const board = await boardId(w, 'general');
    const { dialog } = await overlay({ w, at: { id: target.thread, title: 'Ancient history', board } });
    await waitFor(() => expect(within(dialog).getByLabelText('Board (optional)')).toHaveValue(board));
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('Ancient history');
    expect(within(dialog).getByRole('button', { name: submitName })).toBeEnabled();
  });

  test('a change of board clears the thread', async () => {
    const w = world();
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    const board = await boardId(w, 'general');
    const { dialog } = await overlay({ w, at: { id: t.thread, title: 'The tea thread', board } });
    const filter = within(dialog).getByLabelText('Board (optional)');
    await waitFor(() => expect(within(filter).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(filter, 'Off Topic');
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: submitName })).toBeDisabled();
  });

  test('pressing Reveal reveals in that thread, and says so', async () => {
    const w = world();
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    const board = await boardId(w, 'general');
    const unmask = vi.spyOn(w.fake, 'unmask');
    const onDone = vi.fn();
    const { dialog, character } = await overlay({ w, onDone, at: { id: t.thread, title: 'The tea thread', board } });
    await userEvent.click(within(dialog).getByRole('button', { name: submitName }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(unmask).toHaveBeenCalledWith(character.id, t.thread, '');
    expect(onDone.mock.calls[0]![0]).toMatch(/Pipewrench revealed as Face/u);
    expect((await w.fake.classReveals([character.id])).map((r) => r.class)).toEqual(['face']);
  });

  test('a reveal that lands whose refresh fails is still done, with the added sentence, and unmask was called once', async () => {
    const w = world();
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    const board = await boardId(w, 'general');
    const unmask = vi.spyOn(w.fake, 'unmask');
    const onDone = vi.fn();
    const onClose = vi.fn();
    const { dialog } = await overlay({ w, onDone, onClose, at: { id: t.thread, title: 'The tea thread', board } });
    /* The provider's own first read of the player's rows has landed by now, so the next read is the refresh's. */
    await new Promise((r) => setTimeout(r, 50));
    w.fake.seed.failNextRead('server');
    await userEvent.click(within(dialog).getByRole('button', { name: submitName }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onDone.mock.calls[0]![0]).toBe('Pipewrench revealed as Face in The tea thread. This page may be out of date until you reload it.');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(unmask).toHaveBeenCalledTimes(1);
  });

  test('a reveal that landed while its refresh is out cannot be cancelled and sent again', async () => {
    const w = world();
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    const board = await boardId(w, 'general');
    const unmask = vi.spyOn(w.fake, 'unmask');
    const onClose = vi.fn();
    const { dialog } = await overlay({ w, onClose, at: { id: t.thread, title: 'The tea thread', board } });
    await new Promise((r) => setTimeout(r, 50));
    let release!: () => void;
    const real = w.fake.wallet.bind(w.fake);
    vi.spyOn(w.fake, 'wallet').mockImplementation(() => new Promise((resolve) => { release = () => resolve(real()); }));
    await userEvent.click(within(dialog).getByRole('button', { name: submitName }));
    await waitFor(() => expect(unmask).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(unmask).toHaveBeenCalledTimes(1);
  });

  test('typing different text in the Thread box clears the choice', async () => {
    const w = world();
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    const board = await boardId(w, 'general');
    const { dialog } = await overlay({ w, at: { id: t.thread, title: 'The tea thread', board } });
    const submit = within(dialog).getByRole('button', { name: submitName });
    expect(submit).toBeEnabled();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), 'x');
    expect(submit).toBeDisabled();
  });
});

describe('RevealOverlay opened on nothing', () => {
  test('has no thread and no board chosen, and Reveal is disabled', async () => {
    const { dialog } = await overlay();
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('');
    expect(within(dialog).getByLabelText('Board (optional)')).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: submitName })).toBeDisabled();
  });

  test('null at is the same as none', async () => {
    const { dialog } = await overlay({ at: null });
    expect(within(dialog).getByRole('button', { name: submitName })).toBeDisabled();
  });

  test('the kicker is the one passed', async () => {
    const { dialog } = await overlay({ kicker: 'A thread › Reveal' });
    expect(within(dialog).getByText('A thread › Reveal')).toBeInTheDocument();
    expect(within(dialog).queryByText('My characters › Reveal')).toBeNull();
  });
});

describe('RevealOverlay: the words and the refusals', () => {
  const onTea = async (w: World) => {
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    return { id: t.thread, title: 'The tea thread', board: await boardId(w, 'general') };
  };

  test('says the class and that it cannot be taken back, and counts the character\'s words', async () => {
    const { dialog } = await overlay();
    expect(within(dialog).getByText(/Pipewrench is a Face/u)).toBeInTheDocument();
    expect(within(dialog).getByText(/this can.t be taken back/iu)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/In the character.s words/u), 'It was me.');
    expect(within(dialog).getByText('10 of 200')).toBeInTheDocument();
  });

  test('sends the words, shows a refusal in the server\'s words, and clears it on the next try', async () => {
    const w = world();
    const at = await onTea(w);
    const unmask = vi.spyOn(w.fake, 'unmask').mockResolvedValueOnce({ ok: false, error: 'this character\'s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' });
    const onDone = vi.fn();
    const { dialog, character } = await overlay({ w, at, onDone });
    await userEvent.type(within(dialog).getByLabelText(/In the character.s words/u), 'It was me.');
    await userEvent.click(within(dialog).getByRole('button', { name: submitName }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('reveal once it has run, or withdraw the Turn');
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: submitName }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(unmask).toHaveBeenLastCalledWith(character.id, at.id, 'It was me.');
  });

  test('Esc closes it without revealing anything', async () => {
    const w = world();
    const unmask = vi.spyOn(w.fake, 'unmask');
    const onClose = vi.fn();
    await overlay({ w, onClose, at: await onTea(w) });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(unmask).not.toHaveBeenCalled();
  });

  test('over 200 characters, a notice says so and Reveal is disabled; at 200 it is enabled again', async () => {
    const w = world();
    const { dialog } = await overlay({ w, at: await onTea(w) });
    const words = within(dialog).getByLabelText(/In the character.s words/u);
    await userEvent.click(words);
    await userEvent.paste('a'.repeat(201));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The message is at most 200 characters.');
    expect(within(dialog).getByRole('button', { name: submitName })).toBeDisabled();
    await userEvent.type(words, '{Backspace}');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('button', { name: submitName })).toBeEnabled();
  });
});
