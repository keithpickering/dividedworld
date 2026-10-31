/**
 * The settlement's summary (the web plan's glass amendment to Task 8, as the Settlement board draws
 * it): on the player's first load after a settlement they have not seen, a glass page with a tab per
 * character, the wallet before and after, each reason in the log's own words with its amount, a rank
 * change and a Turn that took effect, with Open my log and Back to the board. It reads the same rows
 * as the log and says nothing the log does not; the last settlement seen is kept on the device.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { hudKey } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { LogScreen } from './Log.tsx';
import { SettlementOnLoad, SettlementScreen, seenKey } from './Settlement.tsx';

const at = (day: number, hour = 12, minute = 0) => Date.UTC(2026, 9, day, hour, minute);

function world() {
  const fake = buildWorld();
  const { seed } = fake;
  seed.season({ number: 1, startsAt: new Date(at(1, 0)).toISOString() });
  const me = seed.account('me');
  const pipe = seed.character(me, 'Pipewrench', 'heel', { at: at(2) });
  const hoo = seed.character(me, 'Mrs. Hooligan', 'face', { at: at(3) });
  const turns = seed.thread('the-system', null, 'Season 1: Who Turned', 'Every Turn.', { at: at(2) });
  const { thread } = seed.thread('general', pipe, 'a thread', 'Opening.', { at: at(27) });
  const p2 = seed.post(thread, pipe, 'Pipewrench speaks.', { at: at(28, 10) });
  seed.wallet(me, 290);
  seed.turn(pipe, 'face', { loudness: 'announced', showFrom: true });
  seed.settle({
    at: at(29, 8, 17), debut: false, turns: true,
    ledger: [
      { character: pipe, reason: 'heel.drewHeat', amount: 330, shares: [{ act: p2, quadrant: 'excitedNegative', amount: 330 }] },
      { character: pipe, reason: 'heel.shrugged', amount: -5, shares: [{ act: p2, quadrant: 'calmPositive', amount: -5 }] },
    ],
  });
  seed.announceTurn(pipe, turns.thread, { was: 'heel', at: at(29, 8, 17) });
  fake.signInAs(me);
  return { fake, me, pipe, hoo };
}

/** Where the app is, read as a screen reads it. */
let where = { path: '', state: null as unknown };
function Where() {
  const l = useLocation();
  where = { path: l.path, state: l.state };
  return null;
}

function openSummary(fake: Fake, me: string, hud: string) {
  localStorage.clear();
  localStorage.setItem(hudKey(me), hud);
  return renderIn(fake, <><SettlementScreen /><Where /></>, { path: '/log/settlement' });
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('the settlement\'s summary', () => {
  test('says when it settled, the wallet before and after, and each reason in the log\'s words with its amount', async () => {
    const { fake, me, pipe } = world();
    openSummary(fake, me, pipe);
    expect(await screen.findByRole('heading', { level: 1, name: 'While you were away' })).toBeInTheDocument();
    expect(screen.getByText('Settled Oct 29 · 08:17 UTC')).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Your characters' })).getAllByRole('button');
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-pressed')])).toEqual([['Mrs. Hooligan', 'false'], ['Pipewrench', 'true']]);
    const wallet = screen.getByRole('region', { name: 'Wallet' });
    expect(within(wallet).getByRole('img', { name: 'Wallet now 6.00 of 6.00' })).toBeInTheDocument();
    expect(within(wallet).getByText('2.90 →')).toBeInTheDocument();
    expect(within(wallet).getByText('6.00')).toBeInTheDocument();
    expect(within(wallet).getByText('+3.10')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why, in plain words · scored as a Heel' })).toBeInTheDocument();
    const lines = within(screen.getByRole('list', { name: 'Why, in plain words · scored as a Heel' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toEqual([
      'Drew heat: excited, negative reactions to its posts and cards+3.30',
      'Shrugged off: calm, positive reactions to its posts and cards−0.05',
    ]);
    /* 2.90 + 3.25 is past the cap: the summary says what the log says. */
    expect(screen.getByText('Your wallet holds at most 6.00, so 0.15 of this was not added.')).toBeInTheDocument();
  });

  test('shows the rank change and the Turn that took effect, as the log\'s lines do', async () => {
    const { fake, me, pipe } = world();
    openSummary(fake, me, pipe);
    const rank = await screen.findByRole('region', { name: 'Rank up' });
    expect(within(rank).getByText('Jobber')).toBeInTheDocument();
    expect(within(rank).getByText('Midcarder')).toBeInTheDocument();
    expect(within(rank).getByRole('img', { name: 'Rank: 2 of 3 pips' })).toBeInTheDocument();
    expect(within(rank).getByText('Season standing 0.00 → 3.25. Every post of Pipewrench\'s now shows the new rank.')).toBeInTheDocument();
    const turn = screen.getByRole('region', { name: 'Turn' });
    expect(within(turn).getByText('Heel')).toBeInTheDocument();
    expect(within(turn).getByText('Face')).toBeInTheDocument();
    expect(turn.textContent).toContain('Pipewrench\'s Turn took effect. From today it scores as a Face. The System announced it, with the old class, in Season 1: Who Turned.');
  });

  test('each line is the log\'s line for the same reason: the same name and the same amount', async () => {
    const { fake, me, pipe } = world();
    openSummary(fake, me, pipe);
    const lines = within(await screen.findByRole('list', { name: /^Why, in plain words/u })).getAllByRole('listitem')
      .map((li) => `${li.querySelector('[data-kb-reason]')!.textContent!.split(':')[0]!.toLowerCase()} ${li.querySelector('[data-kb-amount]')!.textContent}`);
    const view = renderIn(fake, <LogScreen />, { path: '/log' });
    const row = await within(view.container).findByText(/^Scored as a Heel for Oct 28/u);
    for (const line of lines) expect(row.textContent).toContain(line);
  });

  test('a character with nothing in the window says so, and the wallet is the account\'s whatever the tab', async () => {
    const { fake, me, pipe } = world();
    openSummary(fake, me, pipe);
    fireEvent.click(await screen.findByRole('button', { name: 'Mrs. Hooligan' }));
    expect(screen.getByText('Nothing was settled for Mrs. Hooligan in this window.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Wallet' })).getByText('+3.10')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rank up' })).toBeNull();
  });

  test('Open my log opens the log on this settlement\'s row, open, for the character shown; Back to the board leaves', async () => {
    const { fake, me, pipe } = world();
    openSummary(fake, me, pipe);
    const settled = (await fake.log()).settlements[0]!;
    fireEvent.click(await screen.findByRole('link', { name: 'Open my log' }));
    expect(where).toEqual({ path: '/log', state: { open: settled.id, character: pipe } });
    expect(screen.getByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/');
  });

  test('Esc goes back to the board, as Back does', async () => {
    const { fake, me, pipe } = world();
    window.history.replaceState(null, '', '/');
    openSummary(fake, me, pipe);
    await screen.findByRole('heading', { level: 1, name: 'While you were away' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(where.path).toBe('/'));
  });
});

describe('the summary on the first load after a settlement', () => {
  function load(fake: Fake, path = '/') {
    return renderIn(fake, <><SettlementOnLoad active /><Where /></>, { path });
  }

  test('opens once per settlement, and not again once it has been seen', async () => {
    const { fake, me } = world();
    localStorage.clear();
    const first = load(fake);
    await waitFor(() => expect(where.path).toBe('/log/settlement'));
    expect(localStorage.getItem(seenKey(me))).toBe(new Date(at(29, 8, 17)).toISOString());
    first.unmount();
    load(fake);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(where.path).toBe('/');
  });

  test('opens nothing before the first settlement, and nothing while it is not on (a glass page, signed out)', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    fake.seed.character(me, 'Pipewrench', 'heel');
    fake.signInAs(me);
    localStorage.clear();
    load(fake);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(where.path).toBe('/');

    const later = world();
    localStorage.clear();
    renderIn(later.fake, <><SettlementOnLoad active={false} /><Where /></>, { path: '/characters' });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(where.path).toBe('/characters');
    expect(localStorage.getItem(seenKey(later.me))).toBeNull();
  });

  test('a settlement that held nothing of the player\'s is marked seen without opening', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const glo = fake.seed.character(other, 'Gloomba', 'heel');
    fake.seed.settle({ at: at(29, 8, 17), ledger: [{ character: glo, reason: 'heel.drewHeat', amount: 10 }] });
    fake.signInAs(me);
    localStorage.clear();
    load(fake);
    await waitFor(() => expect(localStorage.getItem(seenKey(me))).toBe(new Date(at(29, 8, 17)).toISOString()));
    expect(where.path).toBe('/');
  });
});
