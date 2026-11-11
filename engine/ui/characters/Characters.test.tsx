import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { Page } from '../glass/Page.tsx';
import { usePlayer } from '../player.tsx';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, holdReads, renderIn, testInstance } from '../test-world.tsx';
import { LoadedCharacters } from '../loaded.tsx';
import { Characters } from './Characters.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T12:00:00Z');

/** The player's three characters: one free to Turn, one in its cooldown, one still waiting to debut. */
function world(options: { readonly per?: number; readonly instance?: Instance } = {}) {
  const per = options.per ?? 4;
  const fake = buildWorld({ charactersPerPlayer: per }, options.instance);
  /* The screen counts the days to a Turn's opening from the browser's clock, and the fake dates the cooldown on its own: the browser's is
     set to the fake's, so "opens in N days" is counted from the scene, never from the day the test runs. */
  vi.useFakeTimers({ shouldAdvanceTime: true, now: fake.clock.now() });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'face', { at: T0, pronouns: PRONOUN_PRESETS.she });
  const hoolie = fake.seed.character(me, 'Mrs. Hooligan', 'heel', { at: T0 + DAY });
  const waiting = fake.seed.character(me, 'Spritey', 'heel', { debuted: false, loudness: 'announced', pronouns: PRONOUN_PRESETS.they });
  const stranger = fake.seed.character(other, 'Stranger', 'heel', { at: T0 });
  fake.seed.settle({ at: T0 + 2 * DAY, debut: false, standings: { [pipe]: 1420, [hoolie]: 685, [stranger]: 100 } });
  fake.signInAs(me);
  return { fake, me, other, pipe, hoolie, waiting, stranger, per };
}
type World = ReturnType<typeof world>;

const open = (w: World) => renderIn(w.fake, <LoadedCharacters />, { path: '/characters', settings: { charactersPerPlayer: w.per } });
/*
 * On the glass, My characters is the Roster board's: a card per character, and the selected one's
 * panel, which holds what a table row held. So a character's "row" is its panel, reached as a
 * player reaches it, by its card (a click that moves no focus, as a row's controls were always in
 * view). Before the glass this read the table's row.
 */
const roster = () => screen.getByRole('tablist', { name: /^Roster, /u });
const card = (name: string) => within(roster()).getByRole('tab', { name: new RegExp(`^${name}`, 'u') });
const row = (name: string) => {
  fireEvent.click(card(name));
  return screen.getByRole('tabpanel', { name });
};
/* Before the glass this waited for the name, which the card and the panel now both show. */
const ready = async () => { await screen.findByRole('heading', { level: 1, name: /Your characters/u }); await within(await screen.findByRole('tablist', { name: /^Roster, /u })).findByText('Pipewrench'); };

/** Types into the Thread field and chooses the option by its title. */
const pickThread = async (dialog: HTMLElement, typed: string, title: string) => {
  await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), typed);
  await userEvent.click((await offered(dialog)).find((o) => o.textContent?.startsWith(title))!);
};

/** The thread options on offer: the list's, not the board filter's. */
const offered = async (dialog: HTMLElement) => within(await within(dialog).findByRole('listbox')).findAllByRole('option');

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

  test('its whole page is in the first render, from the document, and nothing is read for it', async () => {
    const w = world();
    const boot = await w.fake.boot();
    const doc = await w.fake.myCharactersPage();
    const read = holdReads(w.fake, ['session']);
    renderIn(w.fake, <Characters doc={doc} />, { path: '/characters', settings: { charactersPerPlayer: w.per }, boot });
    /* No wait: the faces, standings, counts and Turns are the document's. */
    expect(screen.getByRole('heading', { level: 1, name: 'Your characters (3 of 4)' })).toBeInTheDocument();
    const r = row('Pipewrench');
    expect(within(r).getByText('14.20')).toBeInTheDocument();
    expect(r).toHaveTextContent(/Posts\s*\d+ · joined/u);
    expect(within(roster()).getAllByTestId('kb-roster-rank')).toHaveLength(2);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(read).toEqual([]);
  });

  test('the roster is one document: faces, standings, counts, reveals and Turns come with myCharactersPage, and no read of its own is made', async () => {
    const w = world();
    const page = vi.spyOn(w.fake, 'myCharactersPage');
    const own = ['standingAmounts', 'standingPlace', 'standingsPage', 'characterCounts', 'characters', 'turnsAnnounced', 'nextSettlementAt'] as const;
    const spies = own.map((n) => vi.spyOn(w.fake, n));
    open(w);
    await ready();
    expect(await within(row('Mrs. Hooligan')).findByText('6.85')).toBeInTheDocument();
    expect(page).toHaveBeenCalledTimes(1);
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual(own.map(() => 0));
  });

  test('Characters to Edit profile makes no read: they are one document', async () => {
    const w = world();
    open(w);
    await ready();
    const read = holdReads(w.fake, ['session']);
    const page = vi.spyOn(w.fake, 'myCharactersPage');
    await userEvent.click(within(row('Mrs. Hooligan')).getByRole('link', { name: 'Edit profile' }));
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Character')).toHaveValue(w.hoolie);
    expect(window.location.pathname).toBe('/characters/edit');
    expect(page).not.toHaveBeenCalled();
    expect(read).toEqual([]);
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
    expect((window.history.state as { state: unknown }).state).toEqual({ character: w.hoolie });
  });

  test('a character\'s log opens My log on its tab, carried in history.state as Edit profile is, never in the address', async () => {
    const w = world();
    open(w);
    await ready();
    const link = within(row('Mrs. Hooligan')).getByRole('link', { name: 'Mrs. Hooligan\'s log' });
    expect(link).toHaveAttribute('href', '/log');
    await userEvent.click(link);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/log');
    expect((window.history.state as { state: unknown }).state).toEqual({ character: w.hoolie });
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
    /* A they/them character: the verbs agree, and no "it" is left. */
    expect(within(r).getByText('They will debut announced.', { exact: false })).toBeInTheDocument();
    expect(within(r).getByText('They can Turn once they have debuted.')).toBeInTheDocument();
    expect(within(r).getByText(/\(chosen when they were made\)/u)).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Drop Spritey now…' })).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Change how Spritey debuts…' })).toBeInTheDocument();
    /* No aria-label: each is named by what is drawn on it (the label in the name, WCAG 2.5.3). */
    expect(within(r).getByRole('button', { name: 'Drop Spritey now…' })).not.toHaveAttribute('aria-label');
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

  test('Save how it debuts is a busy button while the save is out: aria-busy, its name kept, and a second press saves once', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.setDebut.bind(w.fake);
    const setDebut = vi.spyOn(w.fake, 'setDebut').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    open(w);
    await ready();
    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Change how Spritey debuts…' }));
    const dialog = await screen.findByRole('dialog', { name: /Spritey/u });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    const save = within(dialog).getByRole('button', { name: 'Save how Spritey debuts' });
    await userEvent.click(save);
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Save how Spritey debuts' })).toBe(save);
    await userEvent.click(save);
    expect(setDebut).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(within(row('Spritey')).getByText(/silently/iu)).toBeInTheDocument());
  });

  test('Drop now debuts it at once; Change how it debuts changes only the announcement', async () => {
    const w = world();
    const setDebut = vi.spyOn(w.fake, 'setDebut');
    open(w);
    await ready();
    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Change how Spritey debuts…' }));
    const dialog = await screen.findByRole('dialog', { name: /Spritey/u });
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    expect(within(dialog).getByText(/Nothing is posted/u)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save how Spritey debuts' }));
    await waitFor(() => expect(setDebut).toHaveBeenCalledWith(w.waiting, 'tally', 'silent'));
    await waitFor(() => expect(within(row('Spritey')).getByText(/silently/iu)).toBeInTheDocument());
    expect(await w.fake.characters([w.waiting])).toEqual([]);

    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Drop Spritey now…' }));
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

  test('a retired she/her character says an admin can restore her', async () => {
    const w = world();
    w.fake.seed.retire(w.pipe);
    open(w);
    await ready();
    expect(within(row('Pipewrench')).getByText('Retired. An admin can restore her.')).toBeInTheDocument();
  });

  test('a waiting they/them character announced with a class says the class is theirs', async () => {
    const w = world();
    w.fake.seed.character(w.me, 'Wobbly', 'face', { debuted: false, loudness: 'with_class', pronouns: PRONOUN_PRESETS.they });
    open(w);
    await ready();
    expect(within(row('Wobbly')).getByText('They will debut announced, with their class.', { exact: false })).toBeInTheDocument();
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
    expect(preview).toHaveTextContent('Pipewrench has Turned, leaving Face.');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Name the new class/u }));
    expect(preview).toHaveTextContent('Pipewrench has Turned from Face to Heel');

    await userEvent.click(within(dialog).getByRole('radio', { name: /^Silent/u }));
    expect(preview).toHaveTextContent(/Nobody is told/u);
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    expect(within(dialog).getByRole('checkbox', { name: /Name the old class/u })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /Name the old class/u })).not.toBeChecked();
  });

  test('holds the two names in one group under Announced, off while the Turn is silent', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    const loud = within(dialog).getByRole('group', { name: 'How loud' });
    const naming = within(loud).getByRole('group', { name: 'Name in the post' });
    expect(within(naming).getByRole('checkbox', { name: /^Name the old class/u })).toBeEnabled();
    expect(within(naming).getByRole('checkbox', { name: /^Name the new class/u })).toBeEnabled();
    expect(naming).toBeEnabled();

    await userEvent.click(within(loud).getByRole('radio', { name: /^Silent/u }));
    expect(naming).toBeDisabled();
    expect(within(naming).getByRole('checkbox', { name: /^Name the new class/u })).toBeDisabled();

    await userEvent.click(within(loud).getByRole('radio', { name: /^Announced/u }));
    expect(naming).toBeEnabled();
  });

  test('keeps the names chosen across a silent Turn, so going back to Announced names what it named', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    const loud = within(dialog).getByRole('group', { name: 'How loud' });
    await userEvent.click(within(loud).getByRole('checkbox', { name: /^Name the old class/u }));
    await userEvent.click(within(loud).getByRole('radio', { name: /^Silent/u }));
    expect(within(loud).getByRole('checkbox', { name: /^Name the old class/u })).not.toBeChecked();
    await userEvent.click(within(loud).getByRole('radio', { name: /^Announced/u }));
    expect(within(loud).getByRole('checkbox', { name: /^Name the old class/u })).toBeChecked();
    expect(within(loud).getByRole('checkbox', { name: /^Name the new class/u })).not.toBeChecked();
  });

  /* A name quotes the words it adds to the character's own Promo; the preview below is the post, so the two are held together. */
  test('says in each name the words it adds to the post, and the preview then shows them', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    const preview = within(dialog).getByRole('group', { name: 'What everyone will see' });
    const quoted = (box: HTMLElement) => {
      const found = /“([^”]+)”/u.exec(box.closest('label')?.textContent ?? '');
      expect(found, 'the name quotes the words it adds').not.toBeNull();
      return found![1]!;
    };

    /* The quoted words are the whole line the post will carry, the one the thread draws: not a fragment of it. */
    const posted = () => Array.from(preview.querySelectorAll('.kb-preview-line')).map((p) => p.textContent);

    const old = within(dialog).getByRole('checkbox', { name: /^Name the old class/u });
    expect(posted()).not.toContain(quoted(old));
    expect(quoted(old)).toBe('Pipewrench has Turned, leaving Face.');
    await userEvent.click(old);
    expect(posted()).toEqual([quoted(old)]);
    await userEvent.click(old);

    const now = within(dialog).getByRole('checkbox', { name: /^Name the new class/u });
    expect(posted()).not.toContain(quoted(now));
    expect(quoted(now)).toBe('Pipewrench has Turned to Heel.');
    await userEvent.click(now);
    expect(posted()).toEqual([quoted(now)]);
    expect(now.closest('label')).toHaveTextContent(/reveals/u);

    /* With the other name on, each option quotes the line the post will carry once it is on too. */
    expect(quoted(old)).toBe('Pipewrench has Turned from Face to Heel.');
    await userEvent.click(old);
    expect(posted()).toEqual(['Pipewrench has Turned from Face to Heel.']);
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
    /* Focus is not lost to the page's top when the button it came from is replaced: it ends on Change, where the Turn button was, once the page's
       document has been read again in place (the dialog closes on the old button, which the new document replaces). */
    await waitFor(() => expect(within(r).getByRole('button', { name: 'Change Pipewrench\'s Turn' })).toHaveFocus());
    expect(document.body).not.toHaveFocus();

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

  test('focus ends on Change when the page\'s document lands after the dialog has closed, and on Turn after a withdrawal that lands late', async () => {
    const w = world();
    open(w);
    await ready();
    /* The document is read again in place after the Turn: held, so the dialog closes first and the new page replaces the old one under focus. */
    let land: () => void = () => undefined;
    const real = w.fake.myCharactersPage.bind(w.fake);
    const hold = () => vi.spyOn(w.fake, 'myCharactersPage').mockImplementationOnce(async () => { await new Promise<void>((resolve) => { land = resolve; }); return real(); });
    const dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    hold();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm Turn' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' })).toHaveFocus();
    await act(async () => { land(); });
    await waitFor(() => expect(within(row('Pipewrench')).getByRole('button', { name: 'Change Pipewrench\'s Turn' })).toHaveFocus());

    hold();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Withdraw Pipewrench\'s Turn' }));
    expect(await screen.findByText('Pipewrench\'s Turn is withdrawn.')).toBeInTheDocument();
    await act(async () => { land(); });
    await waitFor(() => expect(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' })).toHaveFocus());
  });

  test('Confirm Turn is a busy button while the Turn is out: aria-busy, its name kept, and a second press Turns once', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.turn.bind(w.fake);
    const turn = vi.spyOn(w.fake, 'turn').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    open(w);
    await ready();
    const dialog = await openTurn();
    await userEvent.click(within(dialog).getByRole('radio', { name: /^Heel/u }));
    const confirm = within(dialog).getByRole('button', { name: 'Confirm Turn' });
    await userEvent.click(confirm);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Confirm Turn' })).toBe(confirm);
    await userEvent.click(confirm);
    expect(turn).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('Withdraw is a busy button while the withdrawal is out: aria-busy, its name kept, and a second press withdraws once', async () => {
    const w = world();
    await w.fake.turn(w.pipe, 'heel', 'announced', false, false);
    let release!: () => void;
    const real = w.fake.withdrawTurn.bind(w.fake);
    const withdraw = vi.spyOn(w.fake, 'withdrawTurn').mockImplementation((id) => new Promise((resolve) => { release = () => resolve(real(id)); }));
    open(w);
    await ready();
    const button = within(row('Pipewrench')).getByRole('button', { name: 'Withdraw Pipewrench\'s Turn' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(within(row('Pipewrench')).getByRole('button', { name: 'Withdraw Pipewrench\'s Turn' })).toBe(button);
    await userEvent.click(button);
    expect(withdraw).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(within(row('Pipewrench')).queryByText(/Turn waiting/u)).toBeNull());
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

  test('the Turn dialog says, in the character\'s own pronouns, when she can Turn again', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openTurn();
    expect(dialog).toHaveTextContent(/After a Turn she can Turn again in /u);
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

  test('with boot, the overlay opens at once with its boards and reads none', async () => {
    const w = world();
    general(w);
    const boot = await w.fake.boot();
    const doc = await w.fake.myCharactersPage();
    const boards = vi.spyOn(w.fake, 'boards');
    renderIn(w.fake, <Characters doc={doc} />, { path: '/characters', settings: { charactersPerPlayer: w.per }, boot });
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = screen.getByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    /* The first render holds its boards: no wait, no read of them. */
    expect(within(dialog).getByRole('option', { name: 'General' })).toBeInTheDocument();
    expect(boards).not.toHaveBeenCalled();
  });

  test('the reveal is a busy button while it is out: aria-busy, its name kept, and a second press reveals once', async () => {
    const w = world();
    const { thread } = general(w);
    let release!: () => void;
    const real = w.fake.unmask.bind(w.fake);
    const unmask = vi.spyOn(w.fake, 'unmask').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    open(w);
    await ready();
    const dialog = await openReveal();
    await pickThread(dialog, 'tea', 'The tea thread');
    const reveal = within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' });
    await userEvent.click(reveal);
    expect(reveal).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBe(reveal);
    await userEvent.click(reveal);
    expect(unmask).toHaveBeenCalledTimes(1);
    expect(unmask).toHaveBeenCalledWith(w.pipe, thread, '');
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('is made in a thread the player chooses, with an optional line of the character\'s words', async () => {
    const w = world();
    const { thread } = general(w);
    const unmask = vi.spyOn(w.fake, 'unmask');
    open(w);
    await ready();
    const dialog = await openReveal();
    await pickThread(dialog, 'tea', 'The tea thread');
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
    vi.spyOn(w.fake, 'unmask').mockResolvedValue({ ok: false, error: 'this character\'s Turn takes effect at the settlement now due; reveal once it has run, or withdraw the Turn' });
    open(w);
    await ready();
    const dialog = await openReveal();
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeDisabled();
    await pickThread(dialog, 'tea', 'The tea thread');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('reveal once it has run, or withdraw the Turn');
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

  test('empty, the field lists the newest threads, each naming its board', async () => {
    const w = world();
    for (let i = 1; i <= 12; i++) w.fake.seed.thread('general', w.stranger, `Thread ${String(i).padStart(2, '0')}`, 'x', { at: T0 + i * 1000 });
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Thread' }));
    const options = await offered(dialog);
    expect(options).toHaveLength(10);
    expect(options[0]).toHaveTextContent('Thread 12');
    expect(options[0]).toHaveTextContent('General');
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeDisabled();
  });

  test('a thread is found by typing, chosen, and its title feeds the preview', async () => {
    const w = world();
    w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    w.fake.seed.thread('general', w.stranger, 'Other business', 'x');
    open(w);
    await ready();
    const dialog = await openReveal();
    const field = within(dialog).getByRole('combobox', { name: 'Thread' });
    await userEvent.type(field, 'tea');
    const options = await offered(dialog);
    expect(options).toHaveLength(1);
    await userEvent.click(options[0]!);
    expect(field).toHaveValue('The tea thread');
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeEnabled();
    expect(dialog).toHaveTextContent('The tea thread');
  });

  test('typing again after a choice unchooses it', async () => {
    const w = world();
    w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    open(w);
    await ready();
    const dialog = await openReveal();
    await pickThread(dialog, 'tea', 'The tea thread');
    const submit = within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' });
    expect(submit).toBeEnabled();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), 'x');
    expect(submit).toBeDisabled();
  });

  test('the open dialog with the Thread list open is axe clean', async () => {
    const w = world();
    w.fake.seed.thread('general', w.stranger, 'The tea thread', 'x');
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Thread' }));
    await offered(dialog);
    const found = await axeViolations(dialog);
    expect(describeViolations(found)).toBe('');
  });

  test('the open dialog with "No threads found." showing is axe clean', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), 'zzzz');
    expect(await within(dialog).findByText('No threads found.')).toBeInTheDocument();
    const found = await axeViolations(dialog);
    expect(describeViolations(found)).toBe('');
  });

  test('the board filter lists All boards first, without The System\'s, and narrows the threads', async () => {
    const w = world();
    w.fake.seed.thread('general', w.stranger, 'Tea in general', 'x');
    w.fake.seed.thread('off-topic', w.stranger, 'Tea off topic', 'x');
    open(w);
    await ready();
    const dialog = await openReveal();
    const filter = within(dialog).getByLabelText('Board (optional)');
    await waitFor(() => expect(within(filter).getAllByRole('option').length).toBeGreaterThan(1));
    const names = within(filter).getAllByRole('option').map((o) => o.textContent);
    expect(names[0]).toBe('All boards');
    const system = (await w.fake.boards()).filter((b) => b.isSystem).map((b) => b.name);
    expect(system.length).toBeGreaterThan(0);
    for (const n of system) expect(names).not.toContain(n);
    const field = within(dialog).getByRole('combobox', { name: 'Thread' });
    await userEvent.type(field, 'tea');
    expect(await offered(dialog)).toHaveLength(2);
    await userEvent.selectOptions(filter, 'Off Topic');
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), 'tea');
    const narrowed = await offered(dialog);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]).toHaveTextContent('Tea off topic');
  });

  test('The System\'s board threads are never offered, typed for or listed', async () => {
    const w = world();
    const sys = (await w.fake.boards()).find((b) => b.isSystem)!;
    w.fake.seed.thread(sys.slug, null, 'Tea at The System', 'x');
    w.fake.seed.thread('general', w.stranger, 'Tea in general', 'x');
    open(w);
    await ready();
    const dialog = await openReveal();
    const field = within(dialog).getByRole('combobox', { name: 'Thread' });
    await userEvent.click(field);
    await offered(dialog);
    expect(within(dialog).queryByRole('option', { name: /Tea at The System/u })).toBeNull();
    await userEvent.type(field, 'tea');
    await waitFor(async () => expect(await offered(dialog)).toHaveLength(1));
    expect(within(dialog).queryByRole('option', { name: /Tea at The System/u })).toBeNull();
  });

  test('says plainly when nothing is found', async () => {
    const w = world();
    open(w);
    await ready();
    const dialog = await openReveal();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Thread' }), 'zzzz');
    expect(await within(dialog).findByText('No threads found.')).toBeInTheDocument();
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

  test('a failed load is the glass\'s, and Try again reads the document again', async () => {
    const w = world();
    vi.spyOn(w.fake, 'myCharactersPage').mockRejectedValueOnce(new Error('network'));
    open(w);
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
    expect(screen.queryByRole('heading', { name: 'The page cannot be displayed' })).toBeNull();
  });

  test('an action reads the page\'s document again, in place, and the roster follows it', async () => {
    const w = world();
    open(w);
    await ready();
    const page = vi.spyOn(w.fake, 'myCharactersPage');
    expect(within(row('Pipewrench')).getByRole('button', { name: 'Turn Pipewrench' })).toBeEnabled();
    await turnIt();
    expect(page).toHaveBeenCalledTimes(1);
    expect(await within(row('Pipewrench')).findByText(/Turn waiting/u)).toBeInTheDocument();
  });
});

describe('A pending Turn and a reveal', () => {
  const NOTE = 'If the settlement is due, a reveal waits until it has run.';

  test('the row\'s note on a pending Turn says so, and the reveal dialog says it too', async () => {
    const w = world();
    expect((await w.fake.turn(w.pipe, 'heel', 'announced', false, false)).ok).toBe(true);
    open(w);
    await ready();
    expect(within(row('Pipewrench')).getByText(NOTE)).toBeInTheDocument();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByText(new RegExp(NOTE.replace('.', '\\.'), 'u'))).toBeInTheDocument();
    expect(within(dialog).getByText(/This reveals the class she holds now, /u)).toBeInTheDocument();
  });

  test('the reveal dialog\'s pending-Turn line agrees with a they/them character: "the class they hold now"', async () => {
    const w = world();
    const wobbly = w.fake.seed.character(w.me, 'Wobbly', 'face', { at: T0, pronouns: PRONOUN_PRESETS.they });
    expect((await w.fake.turn(wobbly, 'heel', 'announced', false, false)).ok).toBe(true);
    open(w);
    await ready();
    await userEvent.click(within(row('Wobbly')).getByRole('button', { name: 'Reveal Wobbly\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Wobbly\'s class' });
    expect(within(dialog).getByText(/This reveals the class they hold now, /u)).toBeInTheDocument();
  });

  test('a character without a pending Turn is told nothing of the kind', async () => {
    const w = world();
    open(w);
    await ready();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe('My characters on the glass (the Roster board)', () => {
  test('the roster is a tablist of the slots used, a tab per character with its class, rank and Turn state, then New character', async () => {
    const w = world();
    await cooldown(w);
    open(w);
    await ready();
    expect(roster()).toHaveAccessibleName('Roster, 3 of 4 slots used');
    /* In the order they joined, the one still waiting last. */
    expect(within(roster()).getAllByRole('tab').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Pipewrench/u), expect.stringMatching(/^Mrs\. Hooligan/u), expect.stringMatching(/^Spritey/u),
    ]);
    expect(within(card('Pipewrench')).getByText('Face')).toBeInTheDocument();
    expect(within(card('Pipewrench')).getByText('Turn ready')).toBeInTheDocument();
    expect(within(card('Mrs. Hooligan')).getByText(/^Next Turn opens Nov 28$/u)).toBeInTheDocument();
    expect(within(card('Spritey')).getByText('Waiting to debut')).toBeInTheDocument();
    /* New character is a link after the tabs (a link is no tab, so it stands beside the tablist), its line naming the open slots, and no empty slot is drawn. */
    const link = screen.getByRole('link', { name: 'New character' });
    expect(link).toHaveAttribute('href', '/characters/new');
    expect(roster().compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(roster()).queryByRole('link')).toBeNull();
    expect(screen.getByText('You have 1 open slot.')).toBeInTheDocument();
    /* No empty slot is drawn, by role: the only tabs are the characters' (three), and New character is a link outside the tablist. */
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getAllByRole('tab').every((t) => roster().contains(t))).toBe(true);
    expect(roster().contains(link)).toBe(false);
  });

  test('the roster is one tablist with one tab per character, the selected one marked, and the panel is its tabpanel', async () => {
    const w = world();
    await cooldown(w);
    /* The player's rows come with boot, as in the app, so the HUD's character is chosen before the page is drawn and no panel swaps for it. */
    renderIn(w.fake, <LoadedCharacters />, { path: '/characters', settings: { charactersPerPlayer: w.per }, boot: await w.fake.boot() });
    await ready();
    const tabs = within(roster()).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true')!;
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAccessibleName(/^(Pipewrench|Mrs\. Hooligan|Spritey)$/u);
    /* Named by the character's name inside the selected tab. */
    expect(selected.contains(document.getElementById(panel.getAttribute('aria-labelledby')!))).toBe(true);
    expect(selected.getAttribute('aria-controls')).toBe(panel.id);
    /* The panel comes directly after the row. */
    expect(roster().closest('.kb-carousel')!.nextElementSibling).toBe(panel);
    /* One tab stop: the selected tab. */
    expect(tabs.map((t) => t.tabIndex)).toEqual(tabs.map((t) => (t === selected ? 0 : -1)));
  });

  test('the arrow keys select the next or previous character and move focus, wrapping; Home and End go to the ends', async () => {
    const w = world();
    open(w);
    await ready();
    const tabs = () => within(roster()).getAllByRole('tab');
    await userEvent.click(tabs()[0]!);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[1]).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^Mrs\. Hooligan/u);
    await userEvent.keyboard('{End}');
    expect(tabs().at(-1)).toHaveFocus();
    expect(tabs().at(-1)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs()[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tabs().at(-1)).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tabs()[0]).toHaveFocus();
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  test('a card shows its character\'s rank once the standings are read', async () => {
    const w = world();
    open(w);
    await ready();
    /* Pipewrench stands at 14.20, past Main Eventer's 6.00 in the test world's ranks. */
    expect(testInstance.ranks.find((r) => r.name === 'Main Eventer')).toHaveProperty('from', 600);
    expect(await within(card('Pipewrench')).findByTestId('kb-roster-rank')).toHaveTextContent(/^Main Eventer$/u);
    expect(within(card('Mrs. Hooligan')).getByTestId('kb-roster-rank')).toHaveTextContent(/^Main Eventer$/u);
  });

  test('a card selects its character into the panel, marked current, and no address names it', async () => {
    const w = world();
    open(w);
    await ready();
    await userEvent.click(card('Mrs. Hooligan'));
    expect(card('Mrs. Hooligan')).toHaveAttribute('aria-selected', 'true');
    expect(card('Pipewrench')).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: 'Mrs. Hooligan' });
    expect(within(panel).getByText('Selected')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/characters');
  });

  test('opens on the character a navigation carried, else on the HUD\'s', async () => {
    const w = world();
    renderIn(w.fake, <LoadedCharacters />, { path: '/characters', state: { character: w.hoolie }, settings: { charactersPerPlayer: w.per } });
    await ready();
    expect(card('Mrs. Hooligan')).toHaveAttribute('aria-selected', 'true');
    cleanup();
    localStorage.setItem(`kb-hud:${w.me}`, w.pipe);
    open(w);
    await ready();
    expect(card('Pipewrench')).toHaveAttribute('aria-selected', 'true');
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
    const turns = w.fake.seed.thread('announcements', null, 'Season 1: Who Turned', 'Every Turn.');
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
    await within(await screen.findByRole('tablist', { name: /^Roster, /u })).findByText('Stranger');
    expect(screen.queryByText('Pipewrench')).toBeNull();
    expect(document.querySelector('[data-kb-class="face"]')).toBeNull();
    expect(document.querySelector('[style*="--kb-glass-class-face"]')).toBeNull();
  });
});

describe('the Turn modal over My characters (the Turn board)', () => {
  const page = (w: World) => renderIn(w.fake, <Page surface="characters"><LoadedCharacters /></Page>, { path: '/characters', settings: { charactersPerPlayer: w.per } });

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

describe('the Reveal over My characters (the glass)', () => {
  const page = (w: World) => renderIn(w.fake, <Page surface="characters"><LoadedCharacters /></Page>, { path: '/characters', settings: { charactersPerPlayer: w.per } });
  const general = (w: World) => w.fake.seed.thread('general', w.stranger, 'The tea thread', 'Who keeps reacting?');

  test('is a glass overlay on the turn smoke, with the menu bar left in view, dimmed and inert', async () => {
    const w = world();
    page(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(dialog.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'turn');
    expect(within(dialog).getByText('My characters › Reveal')).toBeInTheDocument();
    const menu = document.querySelector('nav[aria-label="Menu"]')!;
    expect(menu.closest('[inert]')).not.toBeNull();
    expect(menu).toHaveAttribute('data-kb-dimmed');
  });

  for (const how of ['Close', 'Esc'] as const) {
    test(`${how} returns to My characters, focus on the Reveal button and the menu bar lit again`, async () => {
      const w = world();
      page(w);
      await ready();
      const reveal = within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' });
      await userEvent.click(reveal);
      const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
      if (how === 'Close') await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      else await userEvent.keyboard('{Escape}');
      await act(async () => {});
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(reveal).toHaveFocus();
      const menu = screen.getByRole('navigation', { name: 'Menu' });
      expect(menu.closest('[inert]')).toBeNull();
      expect(menu).not.toHaveAttribute('data-kb-dimmed');
    });
  }

  test('previews the character\'s own post: its words as typed, in the thread chosen', async () => {
    const w = world();
    general(w);
    page(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    const preview = within(dialog).getByRole('group', { name: 'What everyone will see' });
    expect(within(preview).getByText('Pipewrench revealed: Face')).toBeInTheDocument();
    expect(within(preview).getByText('Pipewrench')).toBeInTheDocument();
    expect(within(preview).getByText('At once, in the thread you choose.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/In the character.s words/u), 'It was me.');
    expect(within(preview).getByText('Pipewrench revealed: Face — “It was me.”')).toBeInTheDocument();
    await pickThread(dialog, 'tea', 'The tea thread');
    expect(within(preview).getByText('At once, in The tea thread.')).toBeInTheDocument();
  });
});

describe('the panel\'s pip style (the Roster board)', () => {
  /* Two styles, so a choice can change one. */
  const twoStyles: Instance = { ...testInstance, pipStyles: [...testInstance.pipStyles, { key: 'stars', name: 'Stars', full: 's.svg', empty: 'se.svg' }] };
  const openTwo = (w: World) => renderIn(w.fake, <LoadedCharacters />, { path: '/characters', instance: twoStyles, settings: { charactersPerPlayer: w.per } });
  const champ = async () => {
    const w = world({ instance: twoStyles });
    expect((await w.fake.setProfile(w.pipe, 'Champ', 'Belts and all.', 'default')).ok).toBe(true);
    return w;
  };
  const pipSelect = async () => {
    const select = await within(row('Pipewrench')).findByRole('combobox', { name: 'Pip style' });
    await waitFor(() => expect(select).toHaveValue('default'));
    return select;
  };

  test('saves the chosen style with the title and signature the profile was loaded with, and shows it after a fresh load', async () => {
    const w = await champ();
    const setProfile = vi.spyOn(w.fake, 'setProfile');
    openTwo(w);
    await ready();
    const select = await pipSelect();
    await userEvent.selectOptions(select, 'stars');
    await waitFor(() => expect(setProfile).toHaveBeenCalledWith(w.pipe, 'Champ', 'Belts and all.', 'stars'));
    await waitFor(() => expect(select).toHaveValue('stars'));
    expect(within(row('Spritey')).queryByRole('combobox', { name: 'Pip style' })).toBeNull();
    cleanup();
    openTwo(w);
    await ready();
    expect(await within(row('Pipewrench')).findByRole('combobox', { name: 'Pip style' })).toHaveValue('stars');
  });

  test('keeps the keyboard on the select while it saves, and a second change made meanwhile is not sent', async () => {
    const w = await champ();
    let finish: () => void = () => {};
    const real = w.fake.setProfile.bind(w.fake);
    const setProfile = vi.spyOn(w.fake, 'setProfile').mockImplementation((...args) => new Promise((done) => { finish = () => done(real(...args)); }));
    openTwo(w);
    await ready();
    const select = await pipSelect();
    await userEvent.selectOptions(select, 'stars');
    /* While the save is out the select shows the style being saved, never the old one. */
    expect(select).toHaveValue('stars');
    expect(select).toHaveFocus();
    expect(select).toBeEnabled();
    expect(select).toHaveAttribute('aria-disabled', 'true');
    await userEvent.selectOptions(select, 'default');
    expect(setProfile).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue('stars');
    await act(async () => { finish(); });
    await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled', 'true'));
    expect(select).toHaveValue('stars');
    expect(select).toHaveFocus();
  });

  test('a refused save says why, and the select shows the style that is saved', async () => {
    const w = await champ();
    vi.spyOn(w.fake, 'setProfile').mockResolvedValue({ ok: false, error: 'there is no pip style "stars"' });
    openTwo(w);
    await ready();
    const select = await pipSelect();
    await userEvent.selectOptions(select, 'stars');
    expect(await within(row('Pipewrench')).findByRole('alert')).toHaveTextContent('there is no pip style "stars"');
    expect(select).toHaveValue('default');
  });
});

describe('the Reveal over My characters: its fields and its foot (the Reveal board)', () => {
  const page = (w: World) => renderIn(w.fake, <Page surface="characters"><LoadedCharacters /></Page>, { path: '/characters', settings: { charactersPerPlayer: w.per } });
  const reveal = async (w: World) => {
    page(w);
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    return screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
  };

  test('The board filter and Thread are one row of two fields, in the board\'s places, and the character\'s words count on their own line, the hint at its left', async () => {
    const dialog = await reveal(world());
    const where = dialog.querySelector('.kb-reveal-where')!;
    expect([...where.querySelectorAll('label')].map((f) => f.querySelector('input,select')!.getAttribute('role') ?? f.querySelector('select')!.tagName)).toEqual(['SELECT', 'combobox']);
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Board (optional)' })).toBeInTheDocument();
    const words = within(dialog).getByLabelText(/In the character.s words/u);
    const count = document.getElementById(words.getAttribute('aria-describedby')!)!;
    expect(count).toHaveClass('kb-glass-field-count');
    expect(count.children[0]).toHaveTextContent('Plain text.');
    expect(count.children[1]).toHaveTextContent('0 of 200');
    await userEvent.type(words, 'It was me.');
    expect(count.children[1]).toHaveTextContent('10 of 200');
    expect(words).toHaveAccessibleDescription('Plain text. 10 of 200');
  });

  test('says in one plain line, beside Cancel and the reveal, what will happen', async () => {
    const dialog = await reveal(world());
    const foot = dialog.querySelector('.kb-glass-form-foot')!;
    expect(foot.children[0]).toHaveTextContent('The reveal is checked by the game and posted at once.');
    expect(within(foot as HTMLElement).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(foot as HTMLElement).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeInTheDocument();
  });
});

describe('the Debut dialog\'s foot (the Debut boards)', () => {
  const page = (w: World) => renderIn(w.fake, <Page surface="characters"><LoadedCharacters /></Page>, { path: '/characters', settings: { charactersPerPlayer: w.per } });

  test('changing how it debuts says when it debuts, how far off, and that it can be dropped now', async () => {
    const w = world();
    w.fake.seed.nextSettlementAt(w.fake.clock.now() + (7 * 60 + 42) * 60_000);
    page(w);
    await ready();
    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Change how Spritey debuts…' }));
    const dialog = await screen.findByRole('dialog', { name: 'How Spritey debuts' });
    expect(dialog.querySelector('.kb-glass-form-foot-line')).toHaveTextContent('They debut at the next settlement, in 7 h 42 min. Until then you can drop them now instead.');
    /* How loud is the dialog\'s only choice, one row of three. */
    expect(within(dialog).getAllByRole('radio')).toHaveLength(3);
    expect(dialog.querySelector('fieldset.kb-choice-loud')).not.toBeNull();
  });

  test('with no settlement known it says so without a time', async () => {
    const w = world();
    w.fake.seed.nextSettlementAt(null);
    page(w);
    await ready();
    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Change how Spritey debuts…' }));
    const dialog = await screen.findByRole('dialog', { name: 'How Spritey debuts' });
    expect(dialog.querySelector('.kb-glass-form-foot-line')).toHaveTextContent(/^They debut at the next settlement\. Until then you can drop them now instead\.$/u);
  });

  test('dropping it now says it goes on the board and can post at once', async () => {
    const w = world();
    page(w);
    await ready();
    await userEvent.click(within(row('Spritey')).getByRole('button', { name: 'Drop Spritey now…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Drop Spritey now' });
    expect(dialog.querySelector('.kb-glass-form-foot-line')).toHaveTextContent('Spritey goes on the board at once and can post at once, instead of at the next settlement.');
    expect(within(dialog.querySelector('.kb-glass-form-foot') as HTMLElement).getByRole('button', { name: 'Drop Spritey now' })).toBeInTheDocument();
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
    expect(heel).toHaveAccessibleDescription('Earns heat: boos and tomatoes. Hurt by the polite shrug. Earns from heat, hurt by the calm');
    expect(within(heel.closest('label')!).getByRole('img', { name: 'Earns from heat, hurt by the calm' })).toBeInTheDocument();
  });
});

/*
 * Choose a class as a carousel (the Technician plan's Task 4). A test in engine/ui may not import an
 * instance, so this is an instance of six classes in Divided World's order, which is what the
 * engine must draw with no count of its own. jsdom lays nothing out, so the row is given the Turn
 * board's lengths: 216px cards in a 972px row, overflowing.
 */
const six: Instance = {
  ...testInstance,
  classes: ['Face', 'Heel', 'Jabroni', 'Technician', 'Tweener', 'Lurker'].map((name) => ({ key: name.toLowerCase(), name, earn: () => [] })),
};
/** Every class's key in the instance's order, and those the held Heel leaves to turn to: the tests read them, never a literal list. */
const sixKeys = six.classes.map((c) => c.key);
const sixTurnTo = sixKeys.filter((k) => k !== 'heel');
function overflowingRow() {
  const grid = (el: HTMLElement) => el.classList.contains('kb-class-grid');
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return grid(this) ? six.classes.length * 216 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return grid(this) ? 972 : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-class-card') ? 216 : 0; });
}

describe('the Turn\'s classes, as a carousel', () => {
  const openSix = (w: World) => renderIn(w.fake, <LoadedCharacters />, { path: '/characters', settings: { charactersPerPlayer: w.per }, instance: six });
  const openTurn = async (name: string) => {
    await userEvent.click(within(row(name)).getByRole('button', { name: `Turn ${name}` }));
    return screen.findByRole('dialog', { name: `Turn ${name}` });
  };

  test('draws every class in the instance\'s order, the one held marked Now, the rest radios of one group', async () => {
    const w = world({ instance: six });
    openSix(w);
    await ready();
    const dialog = await openTurn('Mrs. Hooligan');
    const group = within(dialog).getByRole('group', { name: 'Turn to' });
    const cards = [...group.querySelectorAll<HTMLElement>('.kb-class-card')];
    expect(cards.map((c) => c.dataset.kbClass)).toEqual(sixKeys);
    expect(within(cards[1]!).getByText('Now')).toBeInTheDocument();
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(sixTurnTo);
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
  });

  test('counts and fades by the cards\' real sub-pixel width: the phone\'s 291.375px cards, scrolled to the fifth, read "5–5" with no fade before it', async () => {
    const w = world({ instance: six });
    openSix(w);
    await ready();
    // The phone's row: 355px wide, cards calc(100% - 64px) = 291.375px, 14px apart. offsetWidth rounds a card to 291; the computed width does not.
    const CARD = 291.375;
    const STEP = CARD + 14;
    const SCROLLED = 4 * STEP; // 1221.5: the fifth card (the Tweener) at the row's start
    const grid = (el: HTMLElement) => el.classList.contains('kb-class-grid');
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return grid(this) ? six.classes.length * STEP - 14 : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return grid(this) ? 355 : 0; });
    vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(function (this: HTMLElement) { return grid(this) ? SCROLLED : 0; });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-class-card') ? Math.round(CARD) : 0; });
    // The computed box is what layout reports, fractions and all.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      if (el.classList.contains('kb-class-card')) return { width: `${CARD}px` } as CSSStyleDeclaration;
      if (el.classList.contains('kb-class-grid')) return { columnGap: '14px' } as CSSStyleDeclaration;
      return computed(el, pseudo);
    });
    const dialog = await openTurn('Mrs. Hooligan');
    expect(await within(dialog).findByText(`5–5 of ${six.classes.length}`)).toBeInTheDocument();
    expect(dialog.querySelector('.kb-class-grid')).not.toHaveAttribute('data-kb-peek-before');
  });

  test('hides no class from the accessibility tree while the row overflows', async () => {
    const w = world({ instance: six });
    openSix(w);
    await ready();
    overflowingRow();
    const dialog = await openTurn('Mrs. Hooligan');
    await within(dialog).findByText(`1–4 of ${six.classes.length}`);
    // getAllByRole leaves out what the accessibility tree leaves out (aria-hidden, display, visibility).
    expect(within(within(dialog).getByRole('group', { name: 'Turn to' })).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(sixTurnTo);
    for (const card of dialog.querySelectorAll<HTMLElement>('.kb-class-card')) {
      for (let el: HTMLElement | null = card; el && el !== dialog; el = el.parentElement) {
        expect(el.hidden || el.inert || el.getAttribute('aria-hidden') === 'true', card.dataset.kbClass).toBe(false);
      }
    }
  });

  test('names its arrows and its count while the row overflows, "Earlier classes" disabled at the start', async () => {
    const w = world({ instance: six });
    openSix(w);
    await ready();
    overflowingRow();
    const dialog = await openTurn('Mrs. Hooligan');
    expect(await within(dialog).findByText(`1–4 of ${six.classes.length}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Earlier classes' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'More classes' })).toBeEnabled();
    // The arrows are buttons, never a form's submit.
    expect(within(dialog).getByRole('button', { name: 'More classes' })).toHaveAttribute('type', 'button');
  });

  test('draws no arrows and no count when every class fits', async () => {
    const w = world({ instance: six });
    openSix(w);
    await ready();
    const dialog = await openTurn('Mrs. Hooligan');
    expect(within(dialog).queryByRole('button', { name: 'More classes' })).toBeNull();
    expect(within(dialog).queryByText(/ of \d+$/u)).toBeNull();
  });

  test('still opens with focus on the first class card, before the arrows', async () => {
    const w = world({ instance: six });
    openSix(w);
    await ready();
    overflowingRow();
    const dialog = await openTurn('Mrs. Hooligan');
    await within(dialog).findByText(`1–4 of ${six.classes.length}`);
    expect(within(dialog).getAllByRole('radio')[0]).toHaveFocus();
  });
});

describe('the panel\'s online status', () => {
  /** The player's own characters as the player context holds them, which the HUD's mark reads. */
  function HudHidden() {
    const { characters } = usePlayer();
    return <p data-testid="hud">Hidden: {characters.filter((c) => c.presenceHidden).map((c) => c.name).join(', ') || 'none'}</p>;
  }
  const status = async () => within(row('Pipewrench')).findByRole('combobox', { name: 'Online status' });

  test('shows the character\'s state; choosing Hidden hides it, and the player\'s own characters say so after the refresh', async () => {
    const w = world();
    const hide = vi.spyOn(w.fake, 'setPresenceHidden');
    renderIn(w.fake, <><HudHidden /><LoadedCharacters /></>, { path: '/characters', settings: { charactersPerPlayer: w.per } });
    await ready();
    const select = await status();
    expect(select).toHaveValue('shown');
    expect(screen.getByTestId('hud')).toHaveTextContent('Hidden: none');
    expect(within(row('Pipewrench')).getByText(/A hidden character isn't listed in Who is online or Users browsing\. While you post as her, only you see her there\./u)).toBeInTheDocument();
    await userEvent.selectOptions(select, 'hidden');
    await waitFor(() => expect(hide).toHaveBeenCalledWith(w.pipe, true));
    await waitFor(() => expect(select).toHaveValue('hidden'));
    await waitFor(() => expect(screen.getByTestId('hud')).toHaveTextContent('Hidden: Pipewrench'));
    /* A mask waiting to debut has no switch: it is listed nowhere already. */
    expect(within(row('Spritey')).queryByRole('combobox', { name: 'Online status' })).toBeNull();
  });

  test('a refusal shows in the panel, and the select goes back to what is saved', async () => {
    const w = world();
    vi.spyOn(w.fake, 'setPresenceHidden').mockResolvedValue({ ok: false, error: 'you do not play that character' });
    open(w);
    await ready();
    const select = await status();
    await userEvent.selectOptions(select, 'hidden');
    expect(await within(row('Pipewrench')).findByRole('alert')).toHaveTextContent('you do not play that character');
    expect(select).toHaveValue('shown');
  });

  test('keeps the keyboard on the select while it saves, shows the choice, and a second change made meanwhile is not sent', async () => {
    const w = world();
    let finish: () => void = () => {};
    const real = w.fake.setPresenceHidden.bind(w.fake);
    const hide = vi.spyOn(w.fake, 'setPresenceHidden').mockImplementation((...args) => new Promise((done) => { finish = () => done(real(...args)); }));
    open(w);
    await ready();
    const select = await status();
    await userEvent.selectOptions(select, 'hidden');
    expect(select).toHaveValue('hidden');
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(select).not.toBeDisabled();
    await userEvent.selectOptions(select, 'shown');
    expect(hide).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled'));
    expect(select).toHaveValue('hidden');
  });
});

describe('the Reveal carried from a thread (the HUD reveal plan, Task 4)', () => {
  const generalThread = async (w: World) => {
    const t = w.fake.seed.thread('general', w.stranger, 'The tea thread', 'Who keeps reacting?');
    const board = (await w.fake.boards()).find((b) => b.slug === 'general')!.id;
    return { id: t.thread, title: 'The tea thread', board };
  };

  test('arrived with a carried thread, nothing opens by itself, and "Reveal…" opens on it', async () => {
    const w = world();
    const thread = await generalThread(w);
    renderIn(w.fake, <LoadedCharacters />, { path: '/characters', state: { thread }, settings: { charactersPerPlayer: w.per } });
    await ready();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByText('My characters › Reveal')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Board (optional)')).toHaveValue(thread.board);
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('The tea thread');
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeEnabled();
  });

  test('a carried state that is not a thread of strings starts the overlay empty', async () => {
    const w = world();
    renderIn(w.fake, <LoadedCharacters />, { path: '/characters', state: { thread: { id: 't', title: 3, board: 'b' } }, settings: { charactersPerPlayer: w.per } });
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('');
  });

  test('a revealed character shows "Revealed" in place of "Reveal…", and one not yet revealed keeps the button', async () => {
    const w = world();
    const thread = await generalThread(w);
    expect((await w.fake.unmask(w.pipe, thread.id, '')).ok).toBe(true);
    open(w);
    await ready();
    const panel = row('Pipewrench');
    expect(within(panel).queryByRole('button', { name: /^Reveal/u })).toBeNull();
    expect(within(panel).getByText('Revealed')).toHaveClass('kb-roster-line');
    expect(within(row('Mrs. Hooligan')).getByRole('button', { name: 'Reveal Mrs. Hooligan\'s class' })).toBeInTheDocument();
  });

  test('a reveal here leaves focus in the panel, on the Revealed line, not on the page body', async () => {
    const w = world();
    const thread = await generalThread(w);
    renderIn(w.fake, <LoadedCharacters />, { path: '/characters', state: { thread }, settings: { charactersPerPlayer: w.per } });
    await ready();
    await userEvent.click(within(row('Pipewrench')).getByRole('button', { name: 'Reveal Pipewrench\'s class' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(row('Pipewrench')).getByText('Revealed')).toBeInTheDocument());
    expect(document.body).not.toHaveFocus();
    expect(within(row('Pipewrench')).getByText('Revealed')).toHaveFocus();
  });
});
