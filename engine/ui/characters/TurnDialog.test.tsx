import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { axeViolations, describeViolations } from '../a11y.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { TurnDialog, type TurnDialogProps } from './TurnDialog.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld({ charactersPerPlayer: 4 });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'face', { at: Date.parse('2026-10-01T12:00:00Z'), pronouns: PRONOUN_PRESETS.she });
  const stranger = fake.seed.character(other, 'Stranger', 'heel', { at: Date.parse('2026-10-01T12:00:00Z') });
  fake.signInAs(me);
  return { fake, stranger };
}
type World = ReturnType<typeof world>;

/** The dialog rendered by itself, as an opener (the HUD, My characters) renders it. */
async function dialogOf(extra: Partial<TurnDialogProps> & { readonly w?: World; readonly name?: string } = {}) {
  const { w = world(), name = 'Turn Pipewrench', ...props } = extra;
  const character = (await w.fake.myCharacters()).find((c) => c.name === 'Pipewrench')!;
  renderIn(w.fake, <TurnDialog character={character} nextSettlement={null} onClose={() => {}} onDone={() => {}} {...props} />, { path: '/characters' });
  return { w, dialog: await screen.findByRole('dialog', { name }), character };
}

const thread = (w: World) => w.fake.seed.thread('general', w.stranger, 'The tea thread', 'Who keeps reacting?');
const pick = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), 'tea');
  await userEvent.click((await within(await within(dialog).findByRole('listbox')).findAllByRole('option'))[0]!);
};

describe('an announced Turn', () => {
  test('needs a thread, and says it commits: it cannot be changed or withdrawn once announced', async () => {
    const { dialog } = await dialogOf();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    expect(within(dialog).getByRole('radio', { name: /^Announced/u })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm Turn' })).toBeDisabled();
    expect(dialog.querySelector('.kb-turn-effect')).toHaveTextContent("Once announced, this Turn can't be changed or withdrawn. It takes effect at the next settlement.");
  });

  test('is sent with the thread chosen, and is posted there at once', async () => {
    const w = world();
    const t = thread(w);
    const onDone = vi.fn();
    const turn = vi.spyOn(w.fake, 'turn');
    const { dialog, character } = await dialogOf({ w, onDone });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await pick(dialog);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^Name the new class/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(turn).toHaveBeenCalledWith(character.id, 'heel', 'announced', false, true, t.thread);
    expect(onDone.mock.calls[0]![0]).toMatch(/Pipewrench's Turn is announced in The tea thread\. It takes effect at the next settlement\./u);
    const acts = await w.fake.actsById([(await w.fake.myCharacters()).find((c) => c.id === character.id)!.pendingTurn!.announced!.act]);
    expect(acts[0]).toMatchObject({ kind: 'announce', thread: t.thread, payload: { what: 'turn', class: 'heel', ahead: true } });
  });

  test('opened on a thread, says it will be posted there and shows no picker', async () => {
    const w = world();
    const t = thread(w);
    const board = (await w.fake.boards()).find((b) => b.slug === 'general')!.id;
    const turn = vi.spyOn(w.fake, 'turn');
    const { dialog, character } = await dialogOf({ w, at: { id: t.thread, title: 'The tea thread', board } });
    expect(within(dialog).getByText('It will be posted in this thread.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Thread' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
    await waitFor(() => expect(turn).toHaveBeenCalledWith(character.id, 'heel', 'announced', false, false, t.thread));
  });

  test('a silent Turn shows no picker and sends no thread', async () => {
    const w = world();
    const turn = vi.spyOn(w.fake, 'turn');
    const { dialog, character } = await dialogOf({ w });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    expect(within(dialog).queryByRole('combobox', { name: 'Thread' })).toBeNull();
    expect(within(dialog).queryByLabelText('Board (optional)')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
    await waitFor(() => expect(turn).toHaveBeenCalledWith(character.id, 'heel', 'silent', false, false, undefined));
  });

  test('the dialog with its picker is axe clean, and so is the announce-later dialog', async () => {
    const { dialog } = await dialogOf();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    const found = await axeViolations(dialog);
    expect(found, describeViolations(found)).toEqual([]);
    cleanup();
    const w = world();
    expect((await w.fake.turn((await w.fake.myCharacters())[0]!.id, 'heel', 'silent', false, false)).ok).toBe(true);
    const announce = await dialogOf({ w, announce: true, name: 'Announce Pipewrench\'s Turn' });
    const again = await axeViolations(announce.dialog);
    expect(again, describeViolations(again)).toEqual([]);
  });
});
