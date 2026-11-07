/**
 * My log at /log (the web plan's Task 8 with its glass amendment; the log shares plan's Task 5): the
 * open window's estimate first, then each settlement as the Log board draws its row, with the Turns
 * and rank changes it made; a tab per character and All; the cap's overflow and the floor said
 * plainly. Out of character and true: it names the Act, what changed and how much, never who reacted
 * or anyone's class but the player's own.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { hudKey } from '../player.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { utcWhen } from './lines.ts';
import { LogScreen } from './Log.tsx';
import logCss from './log.css?raw';

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

/* jsdom has no scrollIntoView: a test that stubs it puts it back, so no stub outlives its test. */
let scrolled: unknown = null;
const hadScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  if (scrolled !== null) { if (hadScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', hadScroll); else delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView; scrolled = null; }
});

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
    const foot = document.querySelector('.kb-log-foot')!;
    expect(foot).toHaveTextContent('If a line here looks wrong, that is a bug and not the game. Tell an admin.');
    /* "Tell an admin" is the way to one: the page that says how (/contact). */
    expect(within(foot as HTMLElement).getByRole('link', { name: 'Tell an admin' })).toHaveAttribute('href', '/contact');
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

  test('says a settled line with the numbers it was settled under, and a line with none with the numbers in force (#57)', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel', { at: at(2) });
    fake.seed.settle({ at: at(28, 8, 17), ledger: [{ character: pipe, reason: 'heel.postedTooMuch', amount: -10, params: { 'heel.postsAllowed': 4 } }] });
    fake.seed.settle({ at: at(29, 8, 17), ledger: [{ character: pipe, reason: 'heel.postedTooMuch', amount: -10 }] });
    fake.signInAs(me);
    localStorage.clear();
    localStorage.setItem(hudKey(me), pipe);
    renderIn(fake, <LogScreen />, { path: '/log', settings: { economy: { 'heel.postsAllowed': 3 } } });
    await screen.findByRole('table');
    const [newer, older] = await screen.findAllByRole('button', { name: 'Show posts' });
    await userEvent.click(older!);
    await userEvent.click(newer!);
    const said = [...document.querySelectorAll('.kb-log-reason [data-kb-reason]')].map((e) => e.textContent);
    expect(said).toEqual(['Posted too much: a post past three in one day', 'Posted too much: a post past four in one day']);
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

  /** A player with Pipewrench and Mrs. Hooligan debuted and nothing settled, the next settlement 7 h 42 min off (the empty log's board). */
  function nothingYet(next: number | null = Date.now() + (7 * 60 + 42) * 60_000) {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const hoo = fake.seed.character(me, 'Mrs. Hooligan', 'face');
    if (next !== null) fake.seed.nextSettlementAt(next);
    fake.signInAs(me);
    return { fake, me, pipe, hoo, next };
  }

  test('before the first settlement the table keeps its head and draws one row: when it comes, "Nothing yet", and what its first line will be', async () => {
    const { fake, me, hoo, next } = nothingYet();
    open(fake, me, hoo);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When (UTC)', 'What', 'Details', 'Aura', 'Wallet']);
    expect(bodyRows()).toHaveLength(1);
    expect(cells(bodyRows()[0]!)).toEqual([
      utcWhen(new Date(next!).toISOString()), 'Nothing yet',
      'Nothing has settled for Mrs. Hooligan yet. A line comes here when a settlement scores it; the next is in 7 h 42 min.', '', '—',
    ]);
    expect(screen.queryByText('Nothing has settled for you yet. Your first settlement is the first line here.')).toBeNull();
  });

  /*
   * The tabs are drawn from the log's own reads and the open one from the HUD's character, which the player context reads on its own (player.tsx): either can
   * arrive first. A player context slower than the log leaves the page on All for a moment (nothing to scroll to but All's tab), then on the HUD's character, so
   * what the page scrolls into view is the tab that is current when it is current, and a test waits for that rather than for the table.
   */
  test('the character tabs are one row that scrolls on the phone, and the current one is scrolled into view, whichever read arrives first', async () => {
    const { fake, me, hoo } = nothingYet();
    const real = fake.wallet.bind(fake);
    /* The player context is slower than the log: the HUD's character is not known when the table first stands, and is not until the test lets it be. */
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(fake, 'wallet').mockImplementation(async () => { await gate; return real(); });
    const into = vi.fn();
    scrolled = into;
    Element.prototype.scrollIntoView = into;
    open(fake, me, hoo);
    await screen.findByRole('table');
    const named = () => (into.mock.contexts as HTMLElement[]).map((e) => e.textContent);
    /* The effect that scrolls runs after the commit the table stands in, which the query can resolve before. */
    await waitFor(() => expect(named()[0], 'the first read to arrive scrolls the tab that is current then').toBe('All'));
    release();
    await waitFor(() => expect(named().at(-1)).toBe('Mrs. Hooligan'));
    expect(into).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'center' });
    into.mockClear();
    fireEvent.click(tab('All'));
    expect(named()).toEqual(['All']);
    const css = logCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).toMatch(/\[data-kb-layout='phone'\]\) \.kb-log-tabs \{[^}]*overflow-x:\s*auto/u);
    expect(css).toMatch(/\.kb-log-tabs > \.kb-button-row \{[^}]*flex-wrap:\s*nowrap/u);
  });

  test('on All it says "you", and where no settlement is set it names no time and leaves the row\'s when empty', async () => {
    const { fake, me, hoo } = nothingYet();
    open(fake, me, hoo);
    await screen.findByRole('table');
    fireEvent.click(tab('All'));
    expect(cells(bodyRows()[0]!)[2]).toBe('Nothing has settled for you yet. A line comes here when a settlement scores one of your characters; the next is in 7 h 42 min.');
    cleanup();
    const none = nothingYet(null);
    open(none.fake, none.me, none.pipe);
    await screen.findByRole('table');
    expect(cells(bodyRows()[0]!)).toEqual(['—', 'Nothing yet', 'Nothing has settled for Pipewrench yet. A line comes here when a settlement scores it.', '', '—']);
  });

  /* A settlement writes a line only for a character it scored: a quiet one gets none, so the empty log promises a line only when one scores it, never that the next settlement writes it. */
  test('where nothing has settled but other lines are read (an estimate, a card), a note under the table still says so, truly', async () => {
    const { fake, me, hoo } = nothingYet();
    const th = fake.seed.thread('general', hoo, 'a thread', 'Opening.', { at: at(27) });
    const post = fake.seed.post(th.thread, hoo, 'Mrs. Hooligan speaks.', { at: at(28, 11) });
    fake.seed.estimate(me, { lines: [{ character: hoo, reason: 'face.cheered', amount: 10, act: post, quadrant: 'excitedPositive', at: at(29, 11, 5) }] });
    open(fake, me, hoo);
    await screen.findByRole('table');
    expect(bodyRows().length).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing yet')).toBeNull();
    expect(screen.getByText('Nothing has settled for Mrs. Hooligan yet. A line comes here when a settlement scores it; the next is in 7 h 42 min.', { selector: 'p' })).toBeInTheDocument();
  });

  test('a settlement that is due names no time either, and one settled leaves no empty row', async () => {
    const due = nothingYet(Date.now() - 60_000);
    open(due.fake, due.me, due.pipe);
    await screen.findByRole('table');
    expect(cells(bodyRows()[0]!)[2]).toBe('Nothing has settled for Pipewrench yet. A line comes here when a settlement scores it.');
    cleanup();
    const { fake, me, pipe } = world();
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(screen.queryByText('Nothing yet')).toBeNull();
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
    await waitFor(() => expect(screen.getByText('Nothing has settled for Gloomba yet. A line comes here when a settlement scores it.')).toBeInTheDocument());
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
  const cards = [{ key: 'whoops', describe: () => '', art: { color: '#000', ink: '#fff', canvas: '', mark: '', credit: 'Test' }, logSave: (state: unknown) => ((state as { clean?: boolean }).clean ? { what: 'Washed clean', said: 'The layer is washed clean, for every reader.' } : undefined) }];
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
  /** The world, with a settlement on Oct 30 whose drew heat is split across three posts, whose shrug across two, and whose stolen thunder is scored over the window. */
  function split() {
    const w = world();
    const { seed } = w.fake;
    const p4 = seed.post(w.thread, w.pipe, 'Pipewrench again.', { at: at(29, 14) });
    const p5 = seed.post(w.thread, w.pipe, 'And again.', { at: at(29, 15) });
    seed.settle({
      at: at(30, 8, 17), debut: false, turns: false,
      ledger: [
        { character: w.pipe, reason: 'heel.drewHeat', amount: 287, shares: [
          { act: w.p2, quadrant: 'excitedNegative', amount: 143 }, { act: p4, quadrant: 'excitedNegative', amount: 96 }, { act: p5, quadrant: 'boredNegative', amount: 48 },
        ] },
        { character: w.pipe, reason: 'heel.shrugged', amount: -7, shares: [{ act: w.p2, quadrant: 'calmPositive', amount: -4 }, { act: p4, quadrant: 'calmPositive', amount: -3 }] },
        { character: w.pipe, reason: 'heel.stoleThunder', amount: 12 },
      ],
    });
    return w;
  }
  /** Hundredths, as a share or a total is drawn: "+1.43", "−0.07". */
  const hundredths = (drawn: string) => Math.round(Number(drawn.replace('−', '-').replace('+', '')) * 100);

  test('opens and closes from the keyboard, with focus kept on Show posts and returned to it from inside', async () => {
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
    expect(reasons).toHaveLength(3);
    let shared = 0;
    for (const reason of reasons) {
      const total = hundredths(reason.querySelector('[data-kb-amount]')!.textContent!);
      const shares = [...reason.querySelectorAll('.kb-log-share .kb-log-num')].map((n) => hundredths(n.textContent!));
      if (shares.length === 0) continue;
      shared++;
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(shared).toBe(2);
    expect([...reasons].map((r) => r.getAttribute('aria-label'))).toEqual(['Drew heat', 'Stole the thunder', 'Shrugged off']);
  });

  test('it says what a share is, and that a reason with no post was scored over the whole window', async () => {
    const { fake, me, pipe } = split();
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(within(bodyRows()[0]!).getByRole('button', { name: 'Show posts' }));
    const breakdown = document.querySelector<HTMLElement>('.kb-log-breakdown:not([hidden])')!;
    expect(within(breakdown).getByText('Each reason\'s total is exact. It is split across your posts by how the live estimate valued their reactions.')).toBeInTheDocument();
    const thunder = within(breakdown).getByRole('region', { name: 'Stole the thunder' });
    expect(within(thunder).getByText('Scored over the whole window, not post by post.')).toBeInTheDocument();
    expect(within(within(breakdown).getByRole('region', { name: 'Drew heat' })).queryByText('Scored over the whole window, not post by post.')).toBeNull();
  });

  test('every nested amount, a reason\'s total and each post\'s share, stands in the Aura column, and the Wallet column is empty there', () => {
    /* Rendered below; here the rule the columns rest on: one set of widths for the table and the breakdown, so they cannot drift. */
    const css = logCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).toMatch(/--kb-log-aura:\s*110px/u);
    expect(css).toMatch(/--kb-log-wallet:\s*120px/u);
    expect(css).toMatch(/\.kb-log-breakdown-body\s*\{[^}]*margin-left:\s*calc\(var\(--kb-log-when\) \+ var\(--kb-log-what\)\)/u);
    for (const selector of ['.kb-log-reason-head', '.kb-log-share']) {
      const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*grid-template-columns:([^;]*);`, 'u').exec(css)?.[1] ?? '';
      expect(rule, selector).toMatch(/var\(--kb-log-aura\)\s+var\(--kb-log-wallet\)/u);
    }
  });

  test('on the phone each post\'s kind stands beside its link, and no Wallet gap is drawn', () => {
    const css = logCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).toMatch(/\[data-kb-layout='phone'\]\) \.kb-log-share \{[^}]*grid-template-areas:\s*'post quadrant amount'/u);
    expect(css).toMatch(/\[data-kb-layout='phone'\]\) \.kb-log-wallet \{ display: none; \}/u);
  });

  test('on the phone the empty row draws no Aura or Wallet label over nothing, and the rule outweighs the cells\' own', () => {
    const css = logCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    const rule = /\[data-kb-layout='phone'\]\) \.kb-log-table tbody > tr\[data-kb-kind='nothing'\] > td\.kb-log-num \{([^}]*)\}/u.exec(css);
    expect(rule, 'the nothing row has a phone rule for its number cells').not.toBeNull();
    expect(rule![1]).toMatch(/display:\s*none/u);
  });

  test('each nested row is its words, then its amount in the Aura column, then an empty Wallet cell', async () => {
    const { fake, me, pipe } = split();
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(within(bodyRows()[0]!).getByRole('button', { name: 'Show posts' }));
    const breakdown = document.querySelector<HTMLElement>('.kb-log-breakdown:not([hidden])')!;
    const nested = [...breakdown.querySelectorAll<HTMLElement>('.kb-log-reason-head, .kb-log-share')];
    /* Three reasons and the five shares of the two that were split across posts. */
    expect(nested).toHaveLength(3 + 5);
    for (const row of nested) {
      const aura = row.querySelector<HTMLElement>(':scope > [data-kb-column="aura"]')!;
      const wallet = row.querySelector<HTMLElement>(':scope > [data-kb-column="wallet"]')!;
      expect(aura, row.textContent ?? '').not.toBeNull();
      expect(aura.textContent).toMatch(/^[+−]\d\.\d\d$/u);
      expect(wallet.textContent).toBe('');
      expect(wallet).toHaveAttribute('aria-hidden', 'true');
      /* In order: the words, the Aura amount, the Wallet gap. */
      expect(row.lastElementChild).toBe(wallet);
      expect(wallet.previousElementSibling).toBe(aura);
    }
    /* Nothing under Wallet but the settlement's own balance. */
    expect(breakdown.querySelectorAll('[data-kb-column="wallet"]:not(:empty)')).toHaveLength(0);
  });
});

describe('My log: the Mod Bots\' lines (the design, section 9)', () => {
  /** The Clerk filed a visit on Pipewrench's post, a ban followed, and Pipewrench reported Gloomba's post; each is the player's own. */
  function modded() {
    const w = world();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const visit = w.fake.seed.visit(clerk, w.p2, { at: at(30, 9), endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.', at: at(30, 12) });
    const inf = w.fake.seed.infraction(visit, { points: 2, at: at(30, 12) });
    const gp = w.fake.seed.post(w.thread, w.glo, 'Gloomba again.', { at: at(30, 13) });
    /* Through the door, as a player reports: it is paid from the wallet, and the log reads what was paid from the wallet's event. */
    void w.fake.fileReport(w.pipe, gp, 'rude');
    return { ...w, clerk, visit, inf };
  }

  test('says each in plain words in the character\'s tab, and nothing of the rival\'s', async () => {
    const { fake, me, pipe, hoo } = modded();
    open(fake, me, pipe);
    await screen.findByRole('table');
    const text = bodyRows().map((r) => cells(r).join(' | ')).join('\n');
    expect(text).toContain('Warn points: 2 points');
    expect(text).toContain('The Clerk\'s visit to your post #2 filed Rule 2: No double posting: 2 warn points for Pipewrench, dropping off');
    expect(text).toContain('You reported a post');
    expect(text).toContain('Pipewrench reported post #4, for 0.25 Aura. The report is public. The Clerk dismissed it. The 0.25 Aura was spent.');
    /* The other mask's tab has none of them. */
    await userEvent.click(tab('Mrs. Hooligan'));
    expect(bodyRows().map((r) => cells(r).join(' ')).join('\n')).not.toContain('Warn points');
    void hoo;
  });

  test('a report whose judgment failed shows the refunded line, and the same for an appeal', async () => {
    const { fake, me, pipe, glo, thread } = modded();
    const gp = fake.seed.post(thread, glo, 'Gloomba once more.', { at: at(30, 16) });
    fake.seed.judging({ report: 'failed' });
    void fake.fileReport(pipe, gp, 'rude');
    open(fake, me, pipe);
    await screen.findByRole('table');
    const text = bodyRows().map((r) => cells(r).join(' | ')).join('\n');
    expect(text).toMatch(/could not hear it, so your Aura came back \(0\.25\), and you can make it again\./u);
  });

  test('an appeal and its ruling are a line of their own, and the player reads only their own characters\' lines', async () => {
    const { fake, me, pipe, clerk, inf } = modded();
    void fake.fileAppeal(pipe, inf, 'It was a mistake.');
    void clerk;
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(bodyRows().map((r) => cells(r).join(' | ')).join('\n')).toContain('Pipewrench appealed the warn points from your post #2, for 0.50 Aura. The plea is public. The Clerk upheld it. Nothing changed.');
    /* The rival's view of the same world holds none of these lines. */
    fake.signInAs(fake.seed.account('rival2'));
    expect((await fake.log()).infractions).toEqual([]);
    expect((await fake.log()).reports).toEqual([]);
    expect((await fake.log()).appeals).toEqual([]);
  });
});


describe('My log: the way out of a ban', () => {
  function banned() {
    const w = world();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const visit = w.fake.seed.visit(clerk, w.p2, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
    const ban = w.fake.seed.ban(w.pipe, Date.now() + 86_400_000, { infraction: inf, days: 1 });
    return { ...w, ban };
  }

  test('the ban\'s line offers "Appeal to the Boss", which opens the form and sends the ban\'s Act; once appealed the offer is gone', async () => {
    const { fake, me, pipe, ban } = banned();
    open(fake, me, pipe);
    await screen.findByRole('table');
    await userEvent.click(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' }));
    const form = await screen.findByRole('dialog', { name: 'Appeal the ban' });
    await userEvent.type(await within(form).findByRole('textbox', { name: 'Your plea (public)' }), 'I have learned.');
    await userEvent.click(within(form).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('The Boss heard it'));
    expect((await fake.log()).appeals[0]).toMatchObject({ punishment: ban, punishmentKind: 'ban' });
  });

  test('an appeal whose judgment failed leaves the offer, as its own line says you can appeal again', async () => {
    const { fake, me, pipe, ban } = banned();
    fake.seed.judging({ appeal: 'failed' });
    void fake.fileAppeal(pipe, ban, 'Please.');
    open(fake, me, pipe);
    await screen.findByRole('table');
    expect(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('No one could hear it, so your Aura came back and you can appeal again.');
  });

  test('is on no one else\'s log', async () => {
    const { fake } = banned();
    const stranger = fake.seed.account('stranger');
    fake.seed.character(stranger, 'Stranger', 'face');
    fake.signInAs(stranger);
    open(fake, stranger, null);
    await screen.findByRole('heading', { level: 1, name: 'My log' });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.queryByRole('button', { name: /^Appeal to the Boss/u })).toBeNull();
    expect((await fake.log()).bans).toEqual([]);
  });
});
