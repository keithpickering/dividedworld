/**
 * My log at /log (the web plan's Task 8 with its glass amendment; the log shares plan's Task 5): the
 * open window's estimate first, then each settlement as the Log board draws its row, with the Turns
 * and rank changes it made; a tab per character and All; the cap's overflow and the floor said
 * plainly. Out of character and true: it names the Act, what changed and how much, never who reacted
 * or anyone's class but the player's own.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  test('names no one who reacted, and no class but the player\'s own', async () => {
    const { fake, me, pipe } = world();
    open(fake, me, pipe);
    await screen.findByRole('table');
    fireEvent.click(tab('All'));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Gloomba');
    expect(text).not.toMatch(/tomato|reacted by/iu);
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

  test('signed out, asks the player to sign in and reads nothing', async () => {
    const { fake, me, pipe } = world();
    fake.signInAs(null);
    const spy = vi.spyOn(fake, 'log');
    open(fake, me, pipe);
    expect(await screen.findByRole('link', { name: /sign in/iu })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test('another account signing in reads its own log, never the last one\'s', async () => {
    const { fake, me, rival, pipe } = world();
    open(fake, me, pipe);
    await screen.findByRole('table');
    act(() => fake.signInAs(rival));
    await waitFor(() => expect(screen.getByText('Nothing has settled for you yet. Your first settlement is the first line here.')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('Pipewrench');
  });
});
