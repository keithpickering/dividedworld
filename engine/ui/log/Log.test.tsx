/**
 * My log at /log (the web plan's Task 8 with its glass amendment; the log shares plan's Task 5): the
 * open window's estimate first, then each settlement as the Log board draws its row, with the Turns
 * and rank changes it made; a tab per character and All; the cap's overflow and the floor said
 * plainly. Out of character and true: it names the Act, what changed and how much, never who reacted
 * or anyone's class but the player's own.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { hudKey } from '../player.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { LogScreen } from './Log.tsx';

const at = (day: number, hour = 12, minute = 0) => Date.UTC(2026, 9, day, hour, minute);

/**
 * The player plays Pipewrench (a Heel who Turns to Face at the Oct 29 settlement, announced with its old class) and Mrs.
 * Hooligan (a Face); the rival plays Gloomba, who reacted to Pipewrench's post. Two settlements: Oct 28's, made before shares
 * were kept, and Oct 29's, which took Pipewrench from Jobber to Midcarder.
 */
function world() {
  const fake = buildWorld();
  const { seed } = fake;
  seed.season({ number: 1, startsAt: new Date(at(1, 0)).toISOString() });
  const me = seed.account('me');
  const rival = seed.account('rival');
  const pipe = seed.character(me, 'Pipewrench', 'heel', { at: at(2) });
  const hoo = seed.character(me, 'Mrs. Hooligan', 'face', { at: at(3) });
  const glo = seed.character(rival, 'Gloomba', 'heel', { at: at(4) });
  const turns = seed.thread('the-system', null, 'Season 1: Who Turned', 'Every Turn.', { at: at(2) });
  const { thread } = seed.thread('general', glo, 'a thread', 'Opening.', { at: at(27) });
  const p2 = seed.post(thread, pipe, 'Pipewrench speaks.', { at: at(28, 10) });
  const h3 = seed.post(thread, hoo, 'Mrs. Hooligan speaks.', { at: at(28, 11) });
  seed.react(rival, glo, p2, 'tomato');
  seed.wallet(me, 200);
  seed.settle({ at: at(28, 8, 17), debut: false, sharesKept: false, ledger: [{ character: pipe, reason: 'heel.drewHeat', amount: 50 }, { character: hoo, reason: 'face.cheered', amount: 40 }] });
  seed.turn(pipe, 'face', { loudness: 'announced', showFrom: true });
  seed.settle({
    at: at(29, 8, 17), debut: false, turns: true,
    ledger: [
      { character: pipe, reason: 'heel.drewHeat', amount: 280, shares: [{ act: p2, quadrant: 'excitedNegative', amount: 280 }] },
      { character: pipe, reason: 'heel.shrugged', amount: -5, shares: [{ act: p2, quadrant: 'calmPositive', amount: -5 }] },
    ],
  });
  seed.announceTurn(pipe, turns.thread, { was: 'heel', at: at(29, 8, 17) });
  seed.estimate(me, { lines: [{ character: hoo, reason: 'face.cheered', amount: 10, act: h3, quadrant: 'excitedPositive', at: at(29, 11, 5) }] });
  fake.signInAs(me);
  return { fake, me, rival, pipe, hoo, glo, p2, h3, thread };
}

function open(fake: Fake, me: string, hud: string | null, path = '/log') {
  localStorage.clear();
  if (hud) localStorage.setItem(hudKey(me), hud);
  return renderIn(fake, <LogScreen />, { path });
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent?.replace(/\s+/gu, ' ').trim());
const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Whose log' })).getByRole('button', { name });

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('My log', () => {
  test('opens on the HUD\'s character, with a tab for All and each character, and says it is true', async () => {
    const { fake, me, pipe } = world();
    open(fake, me, pipe);
    expect(await screen.findByRole('heading', { level: 1, name: 'My log' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Whose log' })).getAllByRole('button').map((b) => b.textContent);
    /* In the order the characters debuted, as the boards and the roster list them. */
    expect(tabs).toEqual(['All', 'Pipewrench', 'Mrs. Hooligan']);
    expect(tab('Pipewrench')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/^Everything on this page is true\./u)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Pipewrench\'s log, newest first' })).toBeInTheDocument();
    expect(screen.getByText('If a line here looks wrong, that is a bug and not the game. Tell an admin.')).toBeInTheDocument();
  });

  test('draws each settlement as the board does, its Turn and rank change beside it, newest first, in UTC', async () => {
    const { fake, me, pipe } = world();
    open(fake, me, pipe);
    await screen.findByRole('table', { name: 'Pipewrench\'s log, newest first' });
    const rows = bodyRows().map(cells);
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ['Oct 29 · 08:17', 'Settlement'],
      ['Oct 29 · 08:17', 'Turn took effect'],
      ['Oct 29 · 08:17', 'Rank up'],
      ['Oct 28 · 08:17', 'Settlement'],
    ]);
    expect(rows[0]![2]).toMatch(/^Scored as a Heel for Oct 28: drew heat \+2\.80, shrugged off −0\.05\./u);
    expect(rows[0]!.slice(3)).toEqual(['+2.75', '5.65']);
    expect(rows[1]![2]).toBe('Pipewrench is a Face now. Announced with its old class in Season 1: Who Turned.');
    expect(rows[1]!.slice(3)).toEqual(['0.00', '5.65']);
    expect(rows[2]![2]).toBe('Jobber to Midcarder. Standing 0.50 to 3.25 this season.');
    expect(rows[3]![2]).toMatch(/^Scored as a Heel for Oct 27: drew heat \+0\.50\./u);
    expect(rows[3]!.slice(3)).toEqual(['+0.50', '2.90']);
    /* The Turn's line links the announcement, on The System's board. */
    expect(within(bodyRows()[1]!).getByRole('link', { name: 'Season 1: Who Turned' })).toHaveAttribute('href', expect.stringMatching(/^\/t\//u));
  });

  test('Show posts names the breakdown it controls, closed as well as open', async () => {
    const { fake, me, pipe } = world();
    open(fake, me, pipe);
    const button = await screen.findByRole('button', { name: 'Show posts' });
    const id = button.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).not.toBeNull();
    expect(document.getElementById(id!)).not.toBeVisible();
  });

  test('says a settlement\'s reasons as the board does, what it paid first and the largest first, whatever order they were read in', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel', { at: at(2) });
    fake.seed.settle({ at: at(29, 8, 17), ledger: [
      { character: pipe, reason: 'heel.shrugged', amount: -5 }, { character: pipe, reason: 'heel.stoleThunder', amount: 20 }, { character: pipe, reason: 'heel.drewHeat', amount: 20 },
    ] });
    fake.signInAs(me);
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(bodyRows().map(cells)[0]![2]).toMatch(/^Scored as a Heel for Oct 28: drew heat \+0\.20, stole the thunder \+0\.20, shrugged off −0\.05\./u);
  });

  test('puts the open window\'s estimate first, labeled as one, with "up to" and no reactor', async () => {
    const { fake, me, hoo } = world();
    open(fake, me, hoo);
    await screen.findByRole('table', { name: 'Mrs. Hooligan\'s log, newest first' });
    const [first] = bodyRows();
    expect(first).toHaveAttribute('data-kb-estimate');
    const [when, what, details, aura, wallet] = cells(first!);
    expect([when, what, aura, wallet]).toEqual(['Oct 29 · 11:05', 'Estimate', 'up to +0.10', '—']);
    expect(details).toBe('A Hype reaction on your post #3. It counts at the next settlement, before the shared vote and halving. Who reacted is never shown.');
    expect(within(first!).getByRole('link', { name: 'your post #3' })).toHaveAttribute('href', expect.stringMatching(/#post-3$/u));
  });

  test('All holds every character\'s lines, each settlement once, its Aura the sum of the player\'s', async () => {
    const { fake, me, pipe } = world();
    open(fake, me, pipe);
    await screen.findByRole('table', { name: 'Pipewrench\'s log, newest first' });
    fireEvent.click(tab('All'));
    expect(tab('All')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table', { name: 'Your log, newest first' })).toBeInTheDocument();
    const settlements = bodyRows().map(cells).filter((r) => r[1] === 'Settlement');
    expect(settlements.map((r) => r[0])).toEqual(['Oct 29 · 08:17', 'Oct 28 · 08:17']);
    expect(settlements[1]![2]).toMatch(/^Scored for Oct 27\. Mrs\. Hooligan as a Face: cheered \+0\.40\. Pipewrench as a Heel: drew heat \+0\.50\./u);
    expect(settlements[1]![3]).toBe('+0.90');
    expect(bodyRows().map(cells)[0]![1]).toBe('Estimate');
  });

  test('a character\'s tab holds only that character\'s lines', async () => {
    const { fake, me, hoo } = world();
    open(fake, me, hoo);
    await screen.findByRole('table', { name: 'Mrs. Hooligan\'s log, newest first' });
    expect(bodyRows().map(cells).map((r) => r[1])).toEqual(['Estimate', 'Settlement']);
    expect(screen.getByRole('table').textContent).not.toContain('Pipewrench');
  });

  test('says plainly what the cap held back of a credit, and what the floor held back of a loss', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel', { at: at(2) });
    fake.seed.wallet(me, 590);
    fake.seed.settle({ at: at(27, 8, 17), ledger: [{ character: pipe, reason: 'heel.drewHeat', amount: 30 }] });
    fake.seed.wallet(me, 2);
    fake.seed.settle({ at: at(28, 8, 17), ledger: [{ character: pipe, reason: 'heel.shrugged', amount: -5 }] });
    fake.signInAs(me);
    open(fake, me, pipe);
    await screen.findByRole('table');
    const [loss, gain] = bodyRows().map(cells);
    expect(loss![2]).toContain('Your wallet cannot go below 0.00, so 0.03 of this loss was not taken.');
    expect(loss!.slice(3)).toEqual(['−0.05', '0.00']);
    expect(gain![2]).toContain('Your wallet holds at most 6.00, so 0.20 of this was not added.');
    expect(gain!.slice(3)).toEqual(['+0.30', '6.00']);
  });

  test('before the first settlement it says so, and shows no table of settlements', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    fake.signInAs(me);
    open(fake, me, pipe);
    expect(await screen.findByText('Nothing has settled for you yet. Your first settlement is the first line here.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('names no one who reacted, and no class but the player\'s own: it never asks for anyone else\'s', async () => {
    const { fake, me, pipe, hoo } = world();
    const reveals = vi.spyOn(fake, 'classReveals');
    const turns = vi.spyOn(fake, 'turnsAnnounced');
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(tab('All'));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Gloomba');
    expect(text).not.toMatch(/tomato|reacted by/iu);
    /* A class it names is the player's own: no reveal is read, and the announced Turns asked about are the player's characters' alone. */
    expect(reveals).not.toHaveBeenCalled();
    for (const [ids] of turns.mock.calls) expect([...ids].sort()).toEqual([pipe, hoo].sort());
  });

  test('reads an older page from the last one\'s cursor, and adds its lines below', async () => {
    const { fake, me, pipe } = world();
    const real = fake.log.bind(fake);
    const first = await real();
    const spy = vi.spyOn(fake, 'log').mockImplementation(async (before) => (before
      ? { ...first, settlements: first.settlements.slice(1), wallet: first.wallet.filter((e) => e.settlement === first.settlements[1]!.id), before: null }
      : { ...first, settlements: first.settlements.slice(0, 1), wallet: first.wallet.filter((e) => e.settlement === first.settlements[0]!.id), before: first.settlements[0]!.endsAt }));
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(bodyRows().map(cells).filter((r) => r[1] === 'Settlement').map((r) => r[0])).toEqual(['Oct 29 · 08:17']);
    fireEvent.click(screen.getByRole('button', { name: 'Show older lines' }));
    await waitFor(() => expect(bodyRows().map(cells).filter((r) => r[1] === 'Settlement').map((r) => r[0])).toEqual(['Oct 29 · 08:17', 'Oct 28 · 08:17']));
    expect(spy).toHaveBeenLastCalledWith(first.settlements[0]!.endsAt);
    expect(screen.queryByRole('button', { name: 'Show older lines' })).toBeNull();
  });

  test('an older page reads only what is new to it: the player\'s own state once, and no Act a page before named', async () => {
    const { fake, me, pipe } = world();
    const real = fake.log.bind(fake);
    const first = await real();
    vi.spyOn(fake, 'log').mockImplementation(async (before) => (before
      ? { ...first, settlements: first.settlements.slice(1), wallet: [], before: null }
      : { ...first, settlements: first.settlements.slice(0, 1), before: first.settlements[0]!.endsAt }));
    const mine = vi.spyOn(fake, 'myCharacters');
    const acts = vi.spyOn(fake, 'actsById');
    open(fake, me, pipe);
    await screen.findByRole('table');
    const asked = new Set(acts.mock.calls.flatMap(([ids]) => [...ids]));
    const mineCalls = mine.mock.calls.length;
    acts.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Show older lines' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show older lines' })).toBeNull());
    expect(mine.mock.calls.length).toBe(mineCalls);
    for (const [ids] of acts.mock.calls) for (const id of ids) expect(asked.has(id)).toBe(false);
    /* Show older lines is gone, so focus is on the table it filled, not lost to the page. */
    await waitFor(() => expect(screen.getByRole('table')).toHaveFocus());
  });

  test('an older page that cannot be read says so and keeps what is shown; a failed estimate leaves the rest of the log', async () => {
    const { fake, me, pipe } = world();
    const real = fake.log.bind(fake);
    const first = await real();
    vi.spyOn(fake, 'log').mockImplementation(async (before) => {
      if (before) throw new Error('lost');
      return { ...first, before: first.settlements[0]!.endsAt };
    });
    vi.spyOn(fake, 'estimate').mockRejectedValue(new Error('lost'));
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(bodyRows().map(cells)[0]![1]).toBe('Settlement');
    fireEvent.click(screen.getByRole('button', { name: 'Show older lines' }));
    expect(await screen.findByText(/The older lines could not be read\. Try again\./u)).toBeInTheDocument();
    expect(bodyRows().length).toBeGreaterThan(0);
  });

  test('a read that only names something (a character, a thread) failing leaves the log, in plain words', async () => {
    const { fake, me, pipe } = world();
    vi.spyOn(fake, 'thread').mockRejectedValue(new Error('lost'));
    vi.spyOn(fake, 'characters').mockRejectedValue(new Error('lost'));
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(bodyRows().map(cells)[1]![2]).toBe('Pipewrench is a Face now. Announced with its old class in The System\'s board.');
  });

  test('a tab with nothing on the pages read says so, rather than an empty table', async () => {
    const { fake, me, pipe } = world();
    fake.seed.character(me, 'Spritey', 'face', { at: at(5) });
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(tab('Spritey'));
    expect(screen.getByText('Nothing on these pages is Spritey\'s yet.')).toBeInTheDocument();
  });

  test('signed out, asks the player to sign in and reads nothing', async () => {
    const { fake, me, pipe } = world();
    fake.signInAs(null);
    const spy = vi.spyOn(fake, 'log');
    open(fake, me, pipe);
    expect(await screen.findByRole('link', { name: /sign in/iu })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test('another account signing in reads its own log, never the last one\'s, not for a moment', async () => {
    const { fake, me, rival, pipe } = world();
    open(fake, me, pipe);
    await screen.findByRole('table');
    /* The next account's log is slow to come: nothing of the last one's is drawn meanwhile. */
    const real = fake.log.bind(fake);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(fake, 'log').mockImplementation(async (b) => { await gate; return real(b); });
    act(() => fake.signInAs(rival));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(document.body.textContent).not.toContain('Pipewrench');
    release();
    await waitFor(() => expect(screen.getByText('Nothing has settled for you yet. Your first settlement is the first line here.')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('Pipewrench');
  });
});

describe('the log\'s card lines (the cards plan\'s Task 6)', () => {
  /** The player plays Pipewrench and Mrs. Hooligan; the rival plays Gloomba; each has a post in one thread. */
  function cardWorld() {
    const fake = buildWorld();
    const { seed } = fake;
    const me = seed.account('me');
    const rival = seed.account('rival');
    const pipe = seed.character(me, 'Pipewrench', 'heel', { at: at(2) });
    const hoo = seed.character(me, 'Mrs. Hooligan', 'face', { at: at(3) });
    const glo = seed.character(rival, 'Gloomba', 'heel', { at: at(4) });
    const { thread, act: g1 } = seed.thread('general', glo, 'a thread', 'Gloomba opens.', { at: at(28, 9) });
    const p2 = seed.post(thread, pipe, 'Pipewrench speaks.', { at: at(28, 10) });
    const h3 = seed.post(thread, hoo, 'Mrs. Hooligan speaks.', { at: at(28, 11) });
    seed.wallet(me, 300);
    fake.signInAs(me);
    return { fake, me, rival, pipe, hoo, glo, g1, p2, h3 };
  }
  /* Whoops!'s look, as an instance gives the log a save worth a line (CardUi.logSave). */
  const cards = [{ key: 'whoops', describe: () => '', art: { color: '#000', ink: '#fff', image: '' }, logSave: (state: unknown) => ((state as { clean?: boolean }).clean ? { what: 'Washed clean', said: 'The layer is washed clean, for every reader.' } : undefined) }];
  const show = (fake: Fake, me: string, hud: string) => { localStorage.clear(); localStorage.setItem(hudKey(me), hud); return renderIn(fake, <LogScreen />, { path: '/log', cards: cards as never }); };
  const rowsOf = async () => { await screen.findByRole('table'); return bodyRows().map(cells); };

  test('a card bought: from the machine, at its price, in every tab, with the wallet after', async () => {
    const { fake, me, pipe, hoo } = cardWorld();
    fake.seed.buy(me, 'whoops', { at: at(28, 12) });
    show(fake, me, pipe);
    expect(await rowsOf()).toEqual([['Oct 28 · 12:00', 'You bought Whoops!', 'From the Shop, for 1.00.', '−1.00', '2.00']]);
    fireEvent.click(tab('Mrs. Hooligan'));
    expect(bodyRows().map(cells)[0]![1]).toBe('You bought Whoops!');
    void hoo;
  });

  test('a card played: as which character, on whose post, and what the post added past the card, paid for at the machine', async () => {
    const { fake, me, pipe, g1 } = cardWorld();
    fake.seed.card(pipe, g1, 'whoops', { at: at(28, 13), paid: 25 });
    show(fake, me, pipe);
    const [row] = await rowsOf();
    expect(row).toEqual(['Oct 28 · 13:00', 'You played Whoops!', 'As Pipewrench, on Gloomba\'s post #1. The card was paid for at the machine; this post added 0.25.', '−0.25', '2.75']);
    expect(within(bodyRows()[0]!).getByRole('link', { name: 'Gloomba\'s post #1' })).toHaveAttribute('href', expect.stringMatching(/#post-1$/u));
  });

  test('a play that cost nothing past the card says so, and leaves the wallet it cannot see unsaid', async () => {
    const { fake, me, pipe, g1 } = cardWorld();
    fake.seed.card(pipe, g1, 'whoops', { at: at(28, 13), paid: 0 });
    show(fake, me, pipe);
    expect((await rowsOf())[0]!.slice(2)).toEqual(['As Pipewrench, on Gloomba\'s post #1. The card was paid for at the machine; this play cost nothing more.', '0.00', '—']);
  });

  test('a play on one of the player\'s own characters\' posts says so, and is in both characters\' tabs', async () => {
    const { fake, me, pipe, hoo, h3 } = cardWorld();
    fake.seed.card(pipe, h3, 'whoops', { at: at(28, 13), paid: 0 });
    show(fake, me, pipe);
    expect((await rowsOf())[0]![2]).toBe('As Pipewrench, on Mrs. Hooligan\'s post #3, a post of one of your own characters. The card was paid for at the machine; this play cost nothing more.');
    fireEvent.click(tab('Mrs. Hooligan'));
    expect(bodyRows().map(cells)[0]![1]).toBe('You played Whoops!');
    void hoo;
  });

  test('a play on the player\'s post by someone else: who played what, with the caster\'s message, in the post\'s character\'s tab', async () => {
    const { fake, me, pipe, hoo, glo, p2 } = cardWorld();
    fake.seed.card(glo, p2, 'whoops', { at: at(28, 14), message: 'you dropped your ink' });
    show(fake, me, pipe);
    expect((await rowsOf())[0]).toEqual(['Oct 28 · 14:00', 'A card on your post', 'Gloomba played Whoops! on your post #2, with the message “you dropped your ink”.', '0.00', '—']);
    fireEvent.click(tab('Mrs. Hooligan'));
    expect(screen.queryByRole('table')?.textContent ?? '').not.toContain('Gloomba played');
    void hoo;
  });

  test('a layer washed clean on the player\'s post: the card\'s own words for the save, when it is worth a line', async () => {
    const { fake, me, pipe, glo, p2 } = cardWorld();
    const play = fake.seed.card(glo, p2, 'whoops', { at: at(28, 14) });
    must(await fake.saveEffect(play, pipe, { strokes: [], clean: false }));
    const first = show(fake, me, pipe);
    expect((await rowsOf()).map((r) => r[1])).toEqual(['A card on your post']);
    first.unmount();
    must(await fake.saveEffect(play, pipe, { strokes: [], clean: true }));
    show(fake, me, pipe);
    const rows = await rowsOf();
    expect(rows.map((r) => r[1])).toContain('Washed clean');
    expect(rows.find((r) => r[1] === 'Washed clean')![2]).toBe('Gloomba\'s Whoops! on your post #2. The layer is washed clean, for every reader.');
  });

  test('each purchase and play shows its own wallet after it, two at one instant and at one price included', async () => {
    const { fake, me, pipe, g1, p2 } = cardWorld();
    fake.seed.wallet(me, 500);
    fake.seed.buy(me, 'whoops', { at: at(28, 12) });
    fake.seed.buy(me, 'whoops', { at: at(28, 12) });
    fake.seed.card(pipe, g1, 'whoops', { at: at(28, 13), paid: 25 });
    fake.seed.card(pipe, p2, 'whoops', { at: at(28, 14), paid: 50 });
    show(fake, me, pipe);
    const rows = (await rowsOf()).map((r) => [r[1], r[3], r[4]]);
    expect(rows).toEqual([
      ['You played Whoops!', '−0.50', '2.25'],
      ['You played Whoops!', '−0.25', '2.75'],
      ['You bought Whoops!', '−1.00', '3.00'],
      ['You bought Whoops!', '−1.00', '4.00'],
    ]);
  });

  test('a play the log cannot read, or a card the instance no longer has, is said in plain words, never as a key or "undefined"', async () => {
    const { fake, me, pipe, glo, p2, g1 } = cardWorld();
    fake.seed.card(glo, p2, 'retired-card', { at: at(28, 14), message: '   ' });
    const mine = fake.seed.card(pipe, g1, 'whoops', { at: at(28, 15), paid: 0 });
    const real = fake.actsById.bind(fake);
    vi.spyOn(fake, 'actsById').mockImplementation(async (ids) => (await real(ids)).filter((a) => a.id !== mine));
    show(fake, me, pipe);
    const rows = await rowsOf();
    const text = rows.map((r) => r.join(' ')).join(' ');
    expect(text).not.toMatch(/undefined|retired-card|null/u);
    expect(rows.find((r) => r[1] === 'A card on your post')![2]).toBe('Gloomba played a card on your post #2.');
    expect(rows.find((r) => r[1] === 'You played Whoops!')![2]).toBe('As one of your characters, on a post. The card was paid for at the machine; this play cost nothing more.');
  });

  test('a release from Stick Around is reading, and the log does not track it', async () => {
    const { fake, me, pipe, glo, p2 } = cardWorld();
    fake.signInAs(me);
    const play = fake.seed.card(glo, p2, 'whoops', { at: at(28, 14) });
    must(await fake.releaseEffect(play));
    show(fake, me, pipe);
    expect((await rowsOf()).map((r) => r[1])).toEqual(['A card on your post']);
  });
});

function must<T>(a: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!a.ok) throw new Error(a.error);
  return a.value;
}

/*
 * The breakdown as "12 Log, open" draws it (#88; the owner: "Looks good"): opened and closed from the keyboard with focus kept on
 * Show posts, each reason's shares adding up on screen to the reason's exact total, and the two sentences that say what a share is.
 */
describe('the breakdown', () => {
  /** The world, with a settlement on Oct 30 whose drew heat is split across three posts and whose shrug is scored over the window. */
  function split() {
    const w = world();
    const { seed } = w.fake;
    const p4 = seed.post(w.thread, w.pipe, 'Pipewrench again.', { at: at(29, 14) });
    const p5 = seed.post(w.thread, w.pipe, 'And again.', { at: at(29, 15) });
    seed.settle({
      at: at(30, 8, 17), debut: false, turns: false,
      ledger: [
        { character: w.pipe, reason: 'heel.drewHeat', amount: 287, shares: [
          { act: w.p2, quadrant: 'excitedNegative', amount: 143 }, { act: p4, quadrant: 'excitedNegative', amount: 96 }, { act: p5, quadrant: 'calmNegative', amount: 48 },
        ] },
        { character: w.pipe, reason: 'heel.shrugged', amount: -7 },
      ],
    });
    return w;
  }
  /** Hundredths, as a share or a total is drawn: "+1.43", "−0.07". */
  const hundredths = (drawn: string) => Math.round(Number(drawn.replace('−', '-').replace('+', '')) * 100);

  test('Tab reaches Show posts, Enter opens it and Esc closes it with focus kept; Esc inside the breakdown closes it with focus back on the control', async () => {
    const { fake, me, pipe } = split();
    open(fake, me, pipe);
    await screen.findByRole('table');
    const button = within(bodyRows()[0]!).getByRole('button', { name: 'Show posts' });
    const user = userEvent.setup();
    for (let k = 0; k < 40 && document.activeElement !== button; k++) await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const breakdown = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(breakdown).toBeVisible();
    expect(button).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(breakdown).not.toBeVisible();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(breakdown).toBeVisible();
    await user.tab();
    expect(breakdown).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(breakdown).not.toBeVisible();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  test('each reason\'s shares, as drawn, add up to its total as drawn', async () => {
    const { fake, me, pipe } = split();
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(within(bodyRows()[0]!).getByRole('button', { name: 'Show posts' }));
    const reasons = document.querySelectorAll<HTMLElement>('.kb-log-breakdown:not([hidden]) .kb-log-reason');
    expect(reasons).toHaveLength(2);
    let shared = 0;
    for (const reason of reasons) {
      const total = hundredths(reason.querySelector('[data-kb-amount]')!.textContent!);
      const shares = [...reason.querySelectorAll('.kb-log-share .kb-log-num')].map((n) => hundredths(n.textContent!));
      if (shares.length === 0) continue;
      shared++;
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(shared).toBe(1);
    expect([...reasons].map((r) => r.getAttribute('aria-label'))).toEqual(['Drew heat', 'Shrugged off']);
  });

  test('it says what a share is, and that a reason with no post was scored over the whole window', async () => {
    const { fake, me, pipe } = split();
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(within(bodyRows()[0]!).getByRole('button', { name: 'Show posts' }));
    const breakdown = document.querySelector<HTMLElement>('.kb-log-breakdown:not([hidden])')!;
    expect(within(breakdown).getByText('Each reason\'s total is exact. It is split across your posts by how the live estimate valued their reactions.')).toBeInTheDocument();
    const shrug = within(breakdown).getByRole('region', { name: 'Shrugged off' });
    expect(within(shrug).getByText('Scored over the whole window, not post by post.')).toBeInTheDocument();
    expect(within(within(breakdown).getByRole('region', { name: 'Drew heat' })).queryByText('Scored over the whole window, not post by post.')).toBeNull();
  });
});
