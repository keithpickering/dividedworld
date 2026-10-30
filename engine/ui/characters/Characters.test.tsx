import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Page } from '../glass/Page.tsx';
import { usePlayer } from '../player.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
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
  return { fake, me, other, pipe, hoolie, waiting, stranger, per };
}
type World = ReturnType<typeof world>;

const open = (w: World) => renderIn(w.fake, <Characters />, { path: '/characters', settings: { charactersPerPlayer: w.per } });
/*
 * On the glass, My characters is the Roster board's: a card per character, and the selected one's
 * panel, which holds what a table row held. So a character's "row" is its panel, reached as a
 * player reaches it, by its card (a click that moves no focus, as a row's controls were always in
 * view). Before the glass this read the table's row.
 */
const roster = () => screen.getByRole('list', { name: /^Roster, /u });
const card = (name: string) => within(roster()).getByRole('button', { name: new RegExp(`^${name}`, 'u') });
const row = (name: string) => {
  fireEvent.click(card(name));
  return screen.getByRole('region', { name });
};
/* Before the glass this waited for the name, which the card and the panel now both show. */
const ready = async () => { await screen.findByRole('heading', { level: 1, name: /Your characters/u }); await within(await screen.findByRole('list', { name: /^Roster, /u })).findByText('Pipewrench'); };

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

  test('the roster reads its standings in one read of the amounts, never a place per character', async () => {
    const w = world();
    const amounts = vi.spyOn(w.fake, 'standingAmounts');
    const place = vi.spyOn(w.fake, 'standingPlace');
    const ranking = vi.spyOn(w.fake, 'standingsPage');
    open(w);
    await ready();
    expect(await within(row('Mrs. Hooligan')).findByText('6.85')).toBeInTheDocument();
    expect(amounts).toHaveBeenCalledTimes(1);
    expect([...(amounts.mock.calls[0]?.[0] ?? [])].sort()).toEqual([w.pipe, w.hoolie].sort());
    expect(place).not.toHaveBeenCalled();
    expect(ranking).not.toHaveBeenCalled();
  });

  test('no link or navigation on the page puts a character in the address: Edit profile carries it in history.state', async () => {
    const w = world();
    open(w);
    await ready();
    for (const a of document.querySelectorAll('a[href]')) {
      for (const id of [w.pipe, w.hoolie, w.waiting]) expect(a.getAttribute('href')).not.toContain(id);
    }
    expect(within(row('Pipewrench')).getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/characters/edit');
    await userEvent.click(within(row('Mrs. Hooligan')).getByRole('link', { name: 'Edit profile' }));
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/characters/edit');
    expect(window.history.state).toEqual({ character: w.hoolie });
  });

  test('says when a Turn opens instead of offering it, and why', async () => {
    const w = world();
    await cooldown(w);
    open(w);
    await ready();
    const r = row('Mrs. Hooligan');
    const button = within(r).getByRole('button', { name: 'Turn Mrs. Hooligan' });
    expect(button).toBeDisabled();
    /*
     * The date it opens is on the button (the Roster board's "Turn · opens Nov 28"); how far off it is,
     * which only the line under it used to say, is the button's description, with the line's why.
     * Before the glass the line "Available Nov 28 (in 30 days)" stood visibly under the button.
     */
    expect(button).toHaveAccessibleDescription(/^Opens in \d+ days\. A character can Turn once every 30 days\./u);
    expect(within(r).queryByText(/^Available /u)).toBeNull();
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
    expect((await w.fake.standingsPage(0, 1000)).map((s) => s.character)).not.toContain(w.waiting);
    expect(await w.fake.standingPlace(w.waiting)).toBeNull();
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
    expect(within(dialog).getByRole('button', { name: 'Confirm Turn' })).toBeDisabled();
  });

  test('is asked for, shows pending with Change and Withdraw, is changed, and is withdrawn', async () => {
    const w = world();
    const turn = vi.spyOn(w.fake, 'turn');
    const withdraw = vi.spyOn(w.fake, 'withdrawTurn');
    open(w);
    await ready();
    let dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
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

describe('Reveal: choosing a thread', () => {
  const openReveal = async () => {
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    return screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
  };

  test('shows twenty threads of a board and offers the older ones, a page at a time', async () => {
    const w = world();
    for (let i = 1; i <= 25; i++) w.fake.seed.thread('general', w.stranger, `Thread ${String(i).padStart(2, '0')}`, 'x', { at: T0 + i * 1000 });
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.selectOptions(within(dialog).getByLabelText('Board'), 'General');
    const select = await within(dialog).findByLabelText('Thread');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(21));
    expect(within(select).queryByRole('option', { name: 'Thread 01' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show older threads' }));
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(26));
    expect(within(select).getByRole('option', { name: 'Thread 01' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Show older threads' })).toBeNull();
  });

  test('says plainly when a board has no threads', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.selectOptions(within(dialog).getByLabelText('Board'), 'Off Topic');
    expect(await within(dialog).findByText('No threads on this board yet; choose another board.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Show older threads' })).toBeNull();
  });
});

describe('My characters: stale words', () => {
  const turnIt = async () => {
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };

  test('a confirmation is gone once another dialog opens', async () => {
    const w = world();
    open(w);
    await ready();
    await turnIt();
    expect(screen.getByRole('status')).toHaveTextContent(/Pipewrench/u);
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    await screen.findByRole('dialog');
    expect(document.querySelector('.kb-flash')).toBeEmptyDOMElement();
  });

  test('a withdrawal\'s refusal is gone once a dialog opens, and a flash is gone once a withdrawal starts', async () => {
    const w = world();
    open(w);
    await ready();
    await turnIt();
    vi.spyOn(w.fake, 'withdrawTurn').mockResolvedValueOnce({ ok: false, error: 'there is nothing to withdraw' });
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Withdraw Pipewrench\'s Turn' }));
    expect(await within(row('Pipewrench')).findByText('there is nothing to withdraw')).toBeInTheDocument();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Change Pipewrench\'s Turn' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(within(row('Pipewrench')).queryByText('there is nothing to withdraw')).toBeNull();
  });

  test('a failed load is not kept once the characters are read again', async () => {
    const w = world();
    const read = vi.spyOn(w.fake, 'characters').mockRejectedValueOnce(new Error('network'));
    function Again() { const { refresh } = usePlayer(); return <button type="button" onClick={() => void refresh()}>Again</button>; }
    renderIn(w.fake, <><Characters /><Again /></>, { path: '/characters', settings: { charactersPerPlayer: w.per } });
    expect(await screen.findByText(/could not be loaded/u)).toBeInTheDocument();
    /* Another character debuts, so the characters read changes and is read again. */
    w.fake.seed.settle({ at: w.fake.clock.now(), debut: true });
    await userEvent.click(screen.getByRole('button', { name: 'Again' }));
    await waitFor(() => expect(screen.queryByText(/could not be loaded/u)).toBeNull());
    expect(read).toHaveBeenCalled();
  });
});

describe('A pending Turn and a reveal', () => {
  const NOTE = 'If its settlement is due, a reveal waits until it has run.';

  test('the row\'s note on a pending Turn says so, and the reveal dialog says it too', async () => {
    const w = world();
    expect((await w.fake.turn(w.pipe, 'heel', 'announced', false, false)).ok).toBe(true);
    open(w);
    await ready();
    expect(within(row('Pipewrench')).getByText(NOTE)).toBeInTheDocument();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByText(new RegExp(NOTE.replace('.', '\\.'), 'u'))).toBeInTheDocument();
  });

  test('a character without a pending Turn is told nothing of the kind', async () => {
    const w = world();
    open(w);
    await ready();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe('My characters on the glass (the Roster board)', () => {
  test('the roster is a list of the slots used, a card per character with its class, rank and Turn state, then New character', async () => {
    const w = world();
    await cooldown(w);
    open(w);
    await ready();
    expect(roster()).toHaveAccessibleName('Roster, 3 of 4 slots used');
    /* In the order they joined, the one still waiting last. */
    expect(within(roster()).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Pipewrench/u), expect.stringMatching(/^Mrs\. Hooligan/u), expect.stringMatching(/^Spritey/u),
    ]);
    expect(within(card('Pipewrench')).getByText('Face')).toBeInTheDocument();
    expect(within(card('Pipewrench')).getByText('Turn ready')).toBeInTheDocument();
    expect(within(card('Mrs. Hooligan')).getByText(/^Next Turn opens Nov 28$/u)).toBeInTheDocument();
    expect(within(card('Spritey')).getByText('Waiting to debut')).toBeInTheDocument();
    expect(within(roster()).getByRole('link', { name: 'New character' })).toHaveAttribute('href', '/characters/new');
  });

  test('a card shows its character\'s rank once the standings are read', async () => {
    const w = world();
    const ranks = testInstance.ranks;
    open(w);
    await ready();
    const names = ranks.map((r) => r.name);
    await waitFor(() => expect(names).toContain(within(card('Pipewrench')).getByTestId('kb-roster-rank').textContent));
  });

  test('a card selects its character into the panel, marked current, and no address names it', async () => {
    const w = world();
    open(w);
    await ready();
    await userEvent.click(card('Mrs. Hooligan'));
    expect(card('Mrs. Hooligan')).toHaveAttribute('aria-current', 'true');
    expect(card('Pipewrench')).not.toHaveAttribute('aria-current');
    const panel = screen.getByRole('region', { name: 'Mrs. Hooligan' });
    expect(within(panel).getByText('Selected')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/characters');
  });

  test('opens on the character a navigation carried, else on the HUD\'s', async () => {
    const w = world();
    renderIn(w.fake, <Characters />, { path: '/characters', state: { character: w.hoolie }, settings: { charactersPerPlayer: w.per } });
    await ready();
    expect(card('Mrs. Hooligan')).toHaveAttribute('aria-current', 'true');
    cleanup();
    localStorage.setItem(`kb-hud:${w.me}`, w.pipe);
    open(w);
    await ready();
    expect(card('Pipewrench')).toHaveAttribute('aria-current', 'true');
  });

  test('the panel says what the Roster board says: the class with its date, rank and standing, the wallet, the posts and the month joined', async () => {
    const w = world();
    open(w);
    await ready();
    const panel = row('Pipewrench');
    expect(await within(panel).findByText('14.20')).toBeInTheDocument();
    expect(within(panel).getByText(/this season/u)).toBeInTheDocument();
    expect(within(panel).getByText('Wallet')).toBeInTheDocument();
    expect(await within(panel).findByText(/joined Oct 2026/u)).toBeInTheDocument();
    expect(within(panel).getByText(/characters at most/u)).toBeInTheDocument();
  });

  test('a character that Turned, announced with its old class, says what it was', async () => {
    const w = world();
    const turns = w.fake.seed.thread('the-system', null, 'Season 1: Who Turned', 'Every Turn.');
    w.fake.seed.announceTurn(w.pipe, turns.thread, { was: 'heel' });
    open(w);
    await ready();
    expect(await within(row('Pipewrench')).findByText('Heel, announced publicly')).toBeInTheDocument();
    expect(within(row('Mrs. Hooligan')).queryByText(/announced publicly/u)).toBeNull();
  });

  test('a Turn in its cooldown says on its button when it opens, and why', async () => {
    const w = world();
    await cooldown(w);
    open(w);
    await ready();
    const panel = row('Mrs. Hooligan');
    expect(within(panel).getByRole('button', { name: 'Turn Mrs. Hooligan' })).toHaveTextContent('Turn · opens Nov 28');
    expect(within(panel).getByText(/^A character can Turn once every 30 days\. Mrs\. Hooligan last Turned at the Oct \d+ settlement\.$/u)).toBeInTheDocument();
  });
});

describe('the class, in its own color, to its own player only', () => {
  test('each of the player\'s characters shows its class as a chip in that class\'s colors', async () => {
    const w = world();
    open(w);
    await ready();
    const chip = within(card('Pipewrench')).getByText('Face').closest<HTMLElement>('[data-kb-class]')!;
    expect(chip).toHaveAttribute('data-kb-class', 'face');
    expect(chip.getAttribute('style')).toContain('--kb-glass-class-face-fill');
  });

  test('the page is drawn from the account\'s own rows: another player sees none of these classes', async () => {
    const w = world();
    w.fake.signInAs(w.other);
    open(w);
    await within(await screen.findByRole('list', { name: /^Roster, /u })).findByText('Stranger');
    expect(screen.queryByText('Pipewrench')).toBeNull();
    expect(document.querySelector('[data-kb-class="face"]')).toBeNull();
    expect(document.querySelector('[style*="--kb-glass-class-face"]')).toBeNull();
  });
});

describe('the Turn modal over My characters (the Turn board)', () => {
  const page = (w: World) => renderIn(w.fake, <Page surface="characters" restyled><Characters /></Page>, { path: '/characters', settings: { charactersPerPlayer: w.per } });

  test('is a glass overlay on the turn smoke, with the menu bar left in view, dimmed and inert', async () => {
    const w = world();
    page(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
    expect(dialog.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'turn');
    expect(within(dialog).getByText('My characters › Turn')).toBeInTheDocument();
    const menu = document.querySelector('nav[aria-label="Menu"]')!;
    expect(menu.closest('[inert]')).not.toBeNull();
    expect(menu).toHaveAttribute('data-kb-dimmed');
  });

  for (const how of ['Close', 'Esc'] as const) {
    test(`${how} returns to My characters, focus on the Turn button and the menu bar lit again`, async () => {
      const w = world();
      page(w);
      await ready();
      const turn = within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' });
      await userEvent.click(turn);
      const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
      if (how === 'Close') await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      else await userEvent.keyboard('{Escape}');
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(window.location.pathname).toBe('/characters');
      expect(turn).toHaveFocus();
      const menu = screen.getByRole('navigation', { name: 'Menu' });
      expect(menu.closest('[inert]')).toBeNull();
      expect(menu).not.toHaveAttribute('data-kb-dimmed');
    });
  }

  test('shows the class the character holds as a card marked Now, which cannot be chosen', async () => {
    const w = world();
    open(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
    const group = within(dialog).getByRole('group', { name: 'Turn to' });
    expect(within(group).getByText('Now')).toBeInTheDocument();
    expect(within(group).getByText('Face')).toBeInTheDocument();
    expect(within(group).queryByRole('radio', { name: /^Face/u })).toBeNull();
    expect(within(group).getAllByRole('radio')).toHaveLength(1);
  });

  test('names each class\'s quadrant marks in words, from the instance', async () => {
    const w = world();
    open(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
    expect(within(dialog).getByRole('img', { name: 'Earns from heat, hurt by the calm' })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Earns from hype, hurt by the groan' })).toBeInTheDocument();
    expect(within(dialog).getByText((_, el) => el?.classList.contains('kb-turn-map') === true)).toHaveTextContent('The map: Heat · Hype on top, Groan · Calm below, the same grid as the React picker.');
  });

  test('shows the character beside the choice: its rank, its season standing, and its class, seen by its player alone', async () => {
    const w = world();
    open(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
    const who = within(dialog).getByRole('complementary');
    expect(within(who).getByText('Season standing')).toBeInTheDocument();
    expect(await within(who).findByText('14.20')).toBeInTheDocument();
    expect(within(who).getByText('Class now')).toBeInTheDocument();
    expect(within(who).getByText('Face')).toBeInTheDocument();
    expect(within(who).getByText('Only you')).toBeInTheDocument();
    expect(within(who).getByRole('img', { name: /^Rank \d of \d: / })).toBeInTheDocument();
  });
});

describe('the panel\'s pip style (the Roster board)', () => {
  test('is the character\'s own, and choosing one saves it with the profile\'s title and signature as they are', async () => {
    const w = world();
    const setProfile = vi.spyOn(w.fake, 'setProfile');
    open(w);
    await ready();
    const select = await within(row('Pipewrench')).findByRole('combobox', { name: 'Pip style' });
    expect(select).toHaveValue('default');
    await userEvent.selectOptions(select, 'default');
    await waitFor(() => expect(setProfile).toHaveBeenCalledWith(w.pipe, '', '', 'default'));
    expect(within(row('Spritey')).queryByRole('combobox', { name: 'Pip style' })).toBeNull();
  });
});

describe('the class cards\' radios', () => {
  test('are each named by the class alone and described by its words, then its marks\' words', async () => {
    const w = world();
    open(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn Pipewrench' });
    const heel = within(dialog).getByRole('radio', { name: 'Heel' });
    expect(heel).toHaveAccessibleDescription('Earns heat: boos and tomatoes. Earns from heat, hurt by the calm');
    expect(within(heel.closest('label')!).getByRole('img', { name: 'Earns from heat, hurt by the calm' })).toBeInTheDocument();
  });
});
