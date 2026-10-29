import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Characters } from './Characters.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T12:00:00Z');

/** The player's three characters: one free to Turn, one in its cooldown, one still waiting to debut. */
function world(options: { readonly per?: number } = {}) {
  const per = options.per ?? 4;
  const fake = buildWorld({ charactersPerPlayer: per });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'face', { at: T0 });
  const hoolie = fake.seed.character(me, 'Mrs. Hooligan', 'heel', { at: T0 + DAY });
  const waiting = fake.seed.character(me, 'Spritey', 'heel', { debuted: false, loudness: 'announced' });
  const stranger = fake.seed.character(other, 'Stranger', 'heel', { at: T0 });
  fake.seed.settle({ at: T0 + 2 * DAY, debut: false, standings: { [pipe]: 1420, [hoolie]: 685, [stranger]: 100 } });
  fake.signInAs(me);
  return { fake, me, pipe, hoolie, waiting, stranger, per };
}
type World = ReturnType<typeof world>;

const open = (w: World) => renderIn(w.fake, <Characters />, { path: '/characters', settings: { charactersPerPlayer: w.per } });
const row = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`, 'u') });
const ready = async () => { await screen.findByRole('heading', { level: 1, name: /Your characters/u }); await screen.findByText('Pipewrench'); };

/** Mrs. Hooligan has Turned once, today, so she cannot Turn for 30 days. */
async function cooldown(w: World) {
  w.fake.signInAs(w.me);
  expect((await w.fake.turn(w.hoolie, 'face', 'silent', false, false)).ok).toBe(true);
  w.fake.seed.settle({ at: w.fake.clock.now(), debut: false });
}

describe('My characters', () => {
  test('lists each mask with its class marked "only you", its standing and pips, and a Turn button', async () => {
    const w = world();
    open(w);
    await ready();
    const r = row('Pipewrench');
    expect(within(r).getByText('only you')).toBeInTheDocument();
    expect(within(r).getByText(/Face/u)).toBeInTheDocument();
    expect(within(r).getByText(/since Oct 1/u)).toBeInTheDocument();
    expect(await within(r).findByText('14.20')).toBeInTheDocument();
    expect(within(r).getByRole('img', { name: /^Rank \d of \d: / })).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Turn Pipewrench' })).toBeEnabled();
    expect(within(r).getByRole('link', { name: 'Edit profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your characters (3 of 4)' })).toBeInTheDocument();
  });

  test('says when a Turn opens instead of offering it, and why', async () => {
    const w = world();
    await cooldown(w);
    open(w);
    await ready();
    const r = row('Mrs. Hooligan');
    expect(within(r).getByRole('button', { name: 'Turn Mrs. Hooligan' })).toBeDisabled();
    expect(within(r).getByText(/Available Nov 28/u)).toBeInTheDocument();
    expect(within(r).getByText(/in \d+ days/u)).toBeInTheDocument();
  });

  test('a new character is waiting to debut, offers Drop now and a change of how it debuts, and is in no public list', async () => {
    const w = world();
    open(w);
    await ready();
    const r = row('Spritey');
    expect(within(r).getByText(/waiting to debut at the next settlement/iu)).toBeInTheDocument();
    expect(within(r).getByText(/announced/iu)).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Drop Spritey now' })).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Change how Spritey debuts' })).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: /^Turn/u })).toBeNull();
    expect(within(r).queryByRole('link', { name: 'Edit profile' })).toBeNull();
    /* Absent from every public read. */
    expect(await w.fake.characters([w.waiting])).toEqual([]);
    expect((await w.fake.standings()).map((s) => s.character)).not.toContain(w.waiting);
    expect(await w.fake.standingsOf([w.waiting])).toEqual([]);
    expect(await w.fake.characterCounts(w.waiting)).toEqual({ posts: 0, spins: 0, cards: 0 });
    const board = (await w.fake.boards()).find((b) => b.slug === 'general')!;
    expect((await w.fake.threads(board.id, { offset: 0, limit: 20 })).threads.flatMap((t) => [t.firstCharacter, t.lastCharacter])).not.toContain(w.waiting);
    expect((await w.fake.boards()).map((b) => b.lastCharacter)).not.toContain(w.waiting);
  });

  test('Drop now debuts it at once; Change how it debuts changes only the announcement', async () => {
    const w = world();
    const setDebut = vi.spyOn(w.fake, 'setDebut');
    open(w);
    await ready();
    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Change how Spritey debuts' }));
    const dialog = await screen.findByRole('dialog', { name: /Spritey/u });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    expect(within(dialog).getByText(/Nothing is posted/u)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save how Spritey debuts' }));
    await waitFor(() => expect(setDebut).toHaveBeenCalledWith(w.waiting, 'tally', 'silent'));
    await waitFor(() => expect(within(row('Spritey')).getByText(/silently/iu)).toBeInTheDocument());
    expect(await w.fake.characters([w.waiting])).toEqual([]);

    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Drop Spritey now' }));
    const drop = await screen.findByRole('dialog', { name: /Spritey/u });
    await userEvent.click(within(drop).getByRole('button', { name: 'Drop Spritey now' }));
    await waitFor(() => expect(setDebut).toHaveBeenLastCalledWith(w.waiting, 'now', 'silent'));
    await waitFor(() => expect(within(row('Spritey')).queryByText(/waiting to debut/iu)).toBeNull());
    expect((await w.fake.characters([w.waiting])).map((c) => c.name)).toEqual(['Spritey']);
  });

  test('a full roster says an admin can retire a character on request, and offers no New character', async () => {
    const w = world({ per: 3 });
    open(w);
    await ready();
    expect(screen.queryByRole('link', { name: 'New character' })).toBeNull();
    expect(screen.getByText(/most there are/u)).toBeInTheDocument();
    expect(screen.getByText(/an admin can retire a character on request/iu)).toBeInTheDocument();
  });

  test('with room, offers New character and counts the slots', async () => {
    const w = world();
    open(w);
    await ready();
    expect(screen.getByRole('link', { name: 'New character' })).toHaveAttribute('href', '/characters/new');
    expect(screen.getByText(/1 open slot/u)).toBeInTheDocument();
  });

  test('a retired character says an admin can restore it, and offers nothing', async () => {
    const w = world();
    w.fake.seed.retire(w.hoolie);
    open(w);
    await ready();
    const r = row('Mrs. Hooligan');
    expect(within(r).getByText(/retired/iu)).toBeInTheDocument();
    expect(within(r).getByText(/an admin can restore it/iu)).toBeInTheDocument();
    expect(within(r).queryByRole('button')).toBeNull();
  });

  test('is the player\'s own page: a signed-out visitor is asked to sign in', async () => {
    const w = world();
    w.fake.signInAs(null);
    open(w);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Pipewrench')).toBeNull();
  });
});

describe('the Turn', () => {
  const openTurn = async (name = 'Pipewrench') => {
    await userEvent.click(within(row(name)).getByRole('button', { name: `Turn ${name}` }));
    return screen.findByRole('dialog', { name: `Turn ${name}` });
  };

  test('is a modal: focus goes in, Tab is held inside, Esc closes it and focus returns to the Turn button', async () => {
    const w = world();
    open(w);
    await ready();
    const button = within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' });
    const dialog = await openTurn();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 25; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  test('offers the other classes with the instance\'s descriptions, never the one it holds', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    expect(within(dialog).queryByRole('radio', { name: /^Face/u })).toBeNull();
    expect(within(dialog).getByRole('radio', { name: /^Heel/u })).toBeInTheDocument();
    expect(within(dialog).getByText('Earns heat: boos and tomatoes.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Pipewrench is a Face/u)).toBeInTheDocument();
    expect(within(dialog).getByText(/Turn again in 30 days/u)).toBeInTheDocument();
  });

  test('previews what everyone will see as the choice changes, and says it takes effect at the next settlement', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    const preview = within(dialog).getByRole('group', { name: 'What everyone will see' });
    expect(preview).toHaveTextContent('Pipewrench has Turned');
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    expect(within(dialog).getByText(/takes effect at the next settlement/iu)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Name the old class/u }));
    expect(preview).toHaveTextContent('Pipewrench has Turned from Face');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Name the new class/u }));
    expect(preview).toHaveTextContent('Pipewrench has Turned from Face to Heel');
    expect(preview).toHaveTextContent('Pipewrench revealed: Heel');

    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    expect(preview).toHaveTextContent(/Nobody is told/u);
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    expect(within(dialog).getByRole('checkbox', { name: /Name the old class/u })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /Name the old class/u })).not.toBeChecked();
  });

  test('cannot be confirmed until a class is chosen', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    expect(within(dialog).getByRole('button', { name: 'Turn Pipewrench' })).toBeDisabled();
  });

  test('is asked for, shows pending with Change and Withdraw, is changed, and is withdrawn', async () => {
    const w = world();
    const turn = vi.spyOn(w.fake, 'turn');
    const withdraw = vi.spyOn(w.fake, 'withdrawTurn');
    open(w);
    await ready();
    let dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn Pipewrench' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(turn).toHaveBeenCalledWith(w.pipe, 'heel', 'announced', false, false);

    const r = row('Pipewrench');
    expect(within(r).getByText(/Turn waiting/u)).toBeInTheDocument();
    expect(within(r).getByText(/to Heel/u)).toBeInTheDocument();
    expect(within(r).getByText(/takes effect at the next settlement/iu)).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: 'Turn Pipewrench' })).toBeNull();
    /* Focus is not lost to the page's top when the button it came from is replaced. */
    expect(document.body).not.toHaveFocus();
    expect(r.contains(document.activeElement)).toBe(true);

    await userEvent.click(within(r).getByRole('button', { name: 'Change Pipewrench\'s Turn' }));
    dialog = await screen.findByRole('dialog', { name: 'Change Pipewrench\'s Turn' });
    expect(within(dialog).getByRole('radio', { name: /^Heel/u })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /^Announced/u })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change the Turn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(turn).toHaveBeenLastCalledWith(w.pipe, 'heel', 'silent', false, false);
    expect(within(row('Pipewrench')).getByText(/silent/iu)).toBeInTheDocument();

    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Withdraw Pipewrench\'s Turn' }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(w.pipe));
    await waitFor(() => expect(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' })).toBeEnabled());
    expect(within(row('Pipewrench')).queryByText(/Turn waiting/u)).toBeNull();
    expect((await w.fake.myCharacters()).find((c) => c.id === w.pipe)!.pendingTurn).toBeNull();
  });

  test('a Turn the settlement has no window for yet says "at the next settlement"; one with a window says when', async () => {
    const w = world();
    open(w);
    await ready();
    let dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn Pipewrench' }));
    await waitFor(() => expect(within(row('Pipewrench')).getByText(/Turn waiting/u)).toBeInTheDocument());
    expect(within(row('Pipewrench')).getByText('Takes effect at the next settlement.')).toBeInTheDocument();
    cleanup();
    w.fake.seed.nextSettlementAt(Date.parse('2026-10-30T08:17:00Z'));
    open(w);
    await ready();
    expect(within(row('Pipewrench')).getByText(/Takes effect at the next settlement, Oct 30/u)).toBeInTheDocument();
  });

  test('a refusal is shown in the server\'s words, in the dialog, which stays open', async () => {
    const w = world();
    vi.spyOn(w.fake, 'turn').mockResolvedValue({ ok: false, error: 'this character can Turn again at 2026-11-28T12:00:00Z' });
    open(w);
    await ready();
    const dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn Pipewrench' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('this character can Turn again at 2026-11-28T12:00:00Z');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Reveal', () => {
  const general = (w: World) => w.fake.seed.thread('general', w.stranger, 'The tea thread', 'Who keeps reacting?');

  const openReveal = async (name = 'Pipewrench') => {
    await userEvent.click(within(row(name)).getByRole('button', { name: `Reveal ${name}'s class` }));
    return screen.findByRole('dialog', { name: `Reveal ${name}'s class` });
  };

  test('names the class it will show and asks to confirm, saying it cannot be taken back', async () => {
    const w = world();
    general(w);
    open(w);
    await ready();
    const dialog = await openReveal();
    expect(within(dialog).getByText(/Pipewrench is a Face/u)).toBeInTheDocument();
    expect(within(dialog).getByText(/this can.t be taken back/iu)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' })).toHaveFocus();
  });

  test('is made in a thread the player chooses, with an optional line of the character\'s words', async () => {
    const w = world();
    const { thread } = general(w);
    const unmask = vi.spyOn(w.fake, 'unmask');
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.selectOptions(within(dialog).getByLabelText('Board'), 'General');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Thread'), 'The tea thread');
    await userEvent.type(within(dialog).getByLabelText(/In the character.s words/u), 'It was me.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' }));
    await waitFor(() => expect(unmask).toHaveBeenCalledWith(w.pipe, thread, 'It was me.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(/Pipewrench revealed as Face/u);
    expect((await w.fake.classReveals([w.pipe])).map((r) => r.class)).toEqual(['face']);
  });

  test('cannot be confirmed before a thread is chosen, and a refusal is shown in the server\'s words', async () => {
    const w = world();
    general(w);
    vi.spyOn(w.fake, 'unmask').mockResolvedValue({ ok: false, error: 'this character\'s Turn takes effect at the settlement now due; reveal once it has run' });
    open(w);
    await ready();
    const dialog = await openReveal();
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Board'), 'General');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Thread'), 'The tea thread');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('reveal once it has run');
  });

  test('offers none to a character waiting to debut', async () => {
    const w = world();
    open(w);
    await ready();
    expect(within(row('Spritey')).queryByRole('button', { name: /^Reveal/u })).toBeNull();
  });
});
