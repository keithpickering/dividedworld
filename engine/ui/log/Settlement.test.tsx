/**
 * The settlement's summary (the web plan's glass amendment to Task 8, as the Settlement board draws
 * it): on the player's first load after a settlement they have not seen, a glass page with a tab per
 * character, the wallet before and after, each reason in the log's own words with its amount, a rank
 * change and a Turn that took effect, with Open my log and Back to the board. It reads the same rows
 * as the log and says nothing the log does not; the last settlement seen is kept on the account (alerts plan, Task 2), so a second device does not show it again.
 */
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { hudKey } from '../player.tsx';
import { useLocation, useRouterInternals } from '../router.tsx';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';
import { LoadedLog } from '../loaded.tsx';
import { loadLog } from '../glass-docs.ts';
import { SettlementScreen } from './Settlement.tsx';
import { SettlementOnLoad, startLoad } from './Settlement.tsx';

const at = (day: number, hour = 12, minute = 0) => Date.UTC(2026, 9, day, hour, minute);

function world(o: { hooTurns?: boolean } = {}) {
  const fake = buildWorld();
  const { seed } = fake;
  seed.season({ number: 1, startsAt: new Date(at(1, 0)).toISOString() });
  const me = seed.account('me');
  const pipe = seed.character(me, 'Pipewrench', 'heel', { at: at(2), pronouns: PRONOUN_PRESETS.she });
  const hoo = seed.character(me, 'Mrs. Hooligan', 'face', { at: at(3), pronouns: PRONOUN_PRESETS.they });
  const turns = seed.thread('announcements', null, 'Season 1: Who Turned', 'Every Turn.', { at: at(2) });
  const { thread } = seed.thread('general', pipe, 'a thread', 'Opening.', { at: at(27) });
  const p2 = seed.post(thread, pipe, 'Pipewrench speaks.', { at: at(28, 10) });
  seed.wallet(me, 290);
  seed.turn(pipe, 'face', { loudness: 'announced', showFrom: true });
  if (o.hooTurns) seed.turn(hoo, 'heel', { loudness: 'announced', showFrom: true });
  seed.settle({
    at: at(29, 8, 17), debut: false, turns: true,
    ledger: [
      { character: pipe, reason: 'heel.drewHeat', amount: 330, shares: [{ act: p2, quadrant: 'excitedNegative', amount: 330 }] },
      { character: pipe, reason: 'heel.shrugged', amount: -5, shares: [{ act: p2, quadrant: 'calmPositive', amount: -5 }] },
    ],
  });
  seed.announceTurn(pipe, turns.thread, { was: 'heel', at: at(29, 8, 17) });
  if (o.hooTurns) seed.announceTurn(hoo, turns.thread, { was: 'face', at: at(29, 8, 17) });
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

/** The account's settlement mark, as the account keeps it (not the device). */
const seenOf = async (fake: Fake) => (await fake.preferences()).settlementSeen;

async function openSummary(fake: Fake, me: string, hud: string) {
  localStorage.clear();
  localStorage.setItem(hudKey(me), hud);
  return renderIn(fake, <><LoadedLog /><Where /></>, { path: '/log/settlement', ...((await fake.session()).signedIn ? { boot: await fake.boot() } : {}) });
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('the settlement\'s summary', () => {
  test('says when it settled, the wallet before and after, and each reason in the log\'s words with its amount', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    expect(await screen.findByRole('heading', { level: 1, name: 'While you were away' })).toBeInTheDocument();
    expect(screen.getByText('Settled Oct 29 · 08:17 UTC')).toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Your characters' })).getAllByRole('button');
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-pressed')])).toEqual([['Pipewrench', 'true'], ['Mrs. Hooligan', 'false']]);
    const wallet = screen.getByRole('region', { name: 'Wallet' });
    expect(within(wallet).getByRole('img', { name: 'Wallet now 6.00 of 6.00' })).toBeInTheDocument();
    expect(within(wallet).getByText('2.90 →')).toBeInTheDocument();
    expect(within(wallet).getByText('6.00')).toBeInTheDocument();
    expect(within(wallet).getByText('+3.10')).toBeInTheDocument();
    /* The wallet is every character's together, beside one character's reasons: it says so. */
    expect(within(wallet).getByText('all your characters')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why, in plain words · scored as a Heel' })).toBeInTheDocument();
    const lines = within(screen.getByRole('list', { name: 'Why, in plain words · scored as a Heel' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toEqual([
      "Drew heat: excited, negative reactions to the character's posts and cards+3.30",
      "Shrugged off: calm, positive reactions to the character's posts and cards−0.05",
    ]);
    /* 2.90 + 3.25 is past the cap: the summary says what the log says. */
    expect(screen.getByText('Your wallet holds at most 6.00, so 0.15 of this was not added.')).toBeInTheDocument();
  });

  test('shows the rank change and the Turn that took effect, as the log\'s lines do', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    const rank = await screen.findByRole('region', { name: 'Rank up' });
    expect(within(rank).getByText('Jobber')).toBeInTheDocument();
    expect(within(rank).getByText('Midcarder')).toBeInTheDocument();
    expect(within(rank).getByRole('img', { name: 'Rank: 2 of 3 pips' })).toBeInTheDocument();
    expect(within(rank).getByText('Season standing 0.00 → 3.25. Every post of Pipewrench\'s now shows the new rank.')).toBeInTheDocument();
    const turn = screen.getByRole('region', { name: 'Turn' });
    expect(within(turn).getByText('Heel')).toBeInTheDocument();
    expect(within(turn).getByText('Face')).toBeInTheDocument();
    expect(turn.textContent).toContain('Pipewrench\'s Turn took effect. From the Oct 29 settlement she scores as a Face. Her own Promo announced it, with the old class, in Season 1: Who Turned.');
  });

  test('a they/them character\'s Turn line agrees with the plural: "they score as", never "they scores"', async () => {
    const { fake, me, hoo } = world({ hooTurns: true });
    openSummary(fake, me, hoo);
    const turn = await screen.findByRole('region', { name: 'Turn' });
    expect(turn.textContent).toContain('Mrs. Hooligan\'s Turn took effect. From the Oct 29 settlement they score as a Heel.');
  });

  test('each line is the log\'s line for the same reason: the same name and the same amount', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    const lines = within(await screen.findByRole('list', { name: /^Why, in plain words/u })).getAllByRole('listitem')
      .map((li) => `${li.querySelector('[data-kb-reason]')!.textContent!.split(':')[0]!.toLowerCase()} ${li.querySelector('[data-kb-amount]')!.textContent}`);
    const view = renderIn(fake, <LoadedLog />, { path: '/log', boot: await fake.boot() });
    const row = await within(view.container).findByText(/^Scored as a Heel for Oct 28/u);
    for (const line of lines) expect(row.textContent).toContain(line);
  });

  test('a character with nothing in the window says so, and the wallet is the account\'s whatever the tab', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    fireEvent.click(await screen.findByRole('button', { name: 'Mrs. Hooligan' }));
    expect(screen.getByText('Nothing was settled for Mrs. Hooligan in this window.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Wallet' })).getByText('+3.10')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rank up' })).toBeNull();
  });

  test('Open my log opens the log on this settlement\'s row, open, for the character shown; Back to the board leaves', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    const settled = (await fake.log()).settlements[0]!;
    expect(await screen.findByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/');
    fireEvent.click(await screen.findByRole('link', { name: 'Open my log' }));
    expect(where).toEqual({ path: '/log', state: { open: settled.id, character: pipe } });
  });

  test('Open my log follows the tab picked', async () => {
    const { fake, me, pipe, hoo } = world();
    await openSummary(fake, me, pipe);
    const settled = (await fake.log()).settlements[0]!;
    fireEvent.click(await screen.findByRole('button', { name: 'Mrs. Hooligan' }));
    fireEvent.click(screen.getByRole('link', { name: 'Open my log' }));
    expect(where).toEqual({ path: '/log', state: { open: settled.id, character: hoo } });
  });

  test('names no one who reacted, and no class but the player\'s own: it never asks for anyone else\'s', async () => {
    const { fake, me, pipe, hoo } = world();
    const rival = fake.seed.account('rival');
    const glo = fake.seed.character(rival, 'Gloomba', 'face');
    const posts = (await fake.log()).settlements[0]!.lines[0]!.shares.map((s) => s.act);
    fake.seed.react(rival, glo, posts[0]!, 'tomato');
    const reveals = vi.spyOn(fake, 'classReveals');
    const turns = vi.spyOn(fake, 'turnsAnnounced');
    await openSummary(fake, me, pipe);
    await screen.findByRole('heading', { level: 1, name: 'While you were away' });
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Gloomba');
    expect(text).not.toMatch(/tomato|reacted by/iu);
    expect(reveals).not.toHaveBeenCalled();
    for (const [ids] of turns.mock.calls) expect([...ids].sort()).toEqual([pipe, hoo].sort());
  });

  test('Esc goes back to the board, as Back does', async () => {
    const { fake, me, pipe } = world();
    window.history.replaceState(null, '', '/');
    await openSummary(fake, me, pipe);
    await screen.findByRole('heading', { level: 1, name: 'While you were away' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(where.path).toBe('/'));
  });

  test('Esc is not the page\'s while its tree is leaving (inert, held for an exit)', async () => {
    const { fake, me, pipe } = world();
    window.history.replaceState(null, '', '/log/settlement');
    await openSummary(fake, me, pipe);
    await screen.findByRole('heading', { level: 1, name: 'While you were away' });
    document.body.firstElementChild!.setAttribute('inert', '');
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 30));
    expect(where.path).not.toBe('/');
  });
});

/*
 * The page is drawn with no menu bar (web/src/App.tsx's NO_MENU), and a touch screen has no Esc: every state of it carries
 * Back to the board, the ready state's own link, so none is a dead end (#90).
 */
describe('the summary is the log\'s document', () => {
  test('is whole in its first render from the document, and marks the settlement seen once it is drawn, not before', async () => {
    const { fake, me, pipe } = world();
    localStorage.setItem(hudKey(me), pipe);
    const boot = await fake.boot();
    const estimate = await fake.estimate();
    const page = await fake.logPage(null);
    const see = vi.spyOn(fake, 'seeSettlement');
    const doc = await loadLog({ api: fake, signedIn: () => true }, () => Promise.resolve());
    expect(see).not.toHaveBeenCalled();
    const read = holdReads(fake, ['session', 'seeSettlement']);
    renderIn(fake, <SettlementScreen doc={{ page, estimate }} />, { path: '/log/settlement', boot });
    expect(screen.getByRole('region', { name: 'Wallet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open my log' })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await waitFor(() => expect(see).toHaveBeenCalledTimes(1));
    expect(read).toEqual([]);
    void doc;
  });

  test('the log and the summary are one document: a move from one to the other reads nothing', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    await screen.findByRole('link', { name: 'Open my log' });
    const page = vi.spyOn(fake, 'logPage');
    const estimate = vi.spyOn(fake, 'estimate');
    fireEvent.click(screen.getByRole('link', { name: 'Open my log' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My log' })).toBeInTheDocument();
    expect(page).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });
});

describe('the summary is marked seen once per settlement', () => {
  test('an in-place re-read of the document does not send seeSettlement again', async () => {
    const { fake, me, pipe } = world();
    function Again() { const { retry } = useRouterInternals(); return <button type="button" onClick={retry}>Again</button>; }
    localStorage.setItem(hudKey(me), pipe);
    const see = vi.spyOn(fake, 'seeSettlement');
    const page = vi.spyOn(fake, 'logPage');
    renderIn(fake, <><LoadedLog /><Again /></>, { path: '/log/settlement', boot: await fake.boot() });
    await screen.findByRole('link', { name: 'Open my log' });
    await waitFor(() => expect(see).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Again' }));
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(see).toHaveBeenCalledTimes(1);
  });
});

describe('every state of the summary\'s page has Back to the board', () => {
  const backIn = async () => {
    const link = await screen.findByRole('link', { name: 'Back to the board' });
    expect(link).toHaveAttribute('href', '/');
    /* Outside anything busy, so a screen reader is not told the way out is still loading; and no log to open on nothing. */
    expect(link.closest('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open my log' })).toBeNull();
    return link;
  };

  test('a load that fails is the router\'s failure, which reads the document again on Try again', async () => {
    const { fake, me, pipe } = world();
    vi.spyOn(fake, 'logPage').mockRejectedValueOnce(new Error('down'));
    await openSummary(fake, me, pipe);
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Open my log' })).toBeInTheDocument();
  });

  test('empty', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    fake.signInAs(me);
    await openSummary(fake, me, pipe);
    expect(await screen.findByText('Nothing has settled for you yet.')).toBeInTheDocument();
    await backIn();
  });

  test('signed out', async () => {
    const { fake, me, pipe } = world();
    fake.signInAs(null);
    await openSummary(fake, me, pipe);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    await backIn();
  });

  test('Esc goes back from a state that is not ready', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    fake.signInAs(me);
    await openSummary(fake, me, pipe);
    await screen.findByText('Nothing has settled for you yet.');
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
    expect(await seenOf(fake)).toBe(new Date(at(29, 8, 17)).toISOString());
    first.unmount();
    /* A new page load, on the same backend's data: only the account's mark keeps it from opening again. */
    startLoad();
    load(fake);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(where.path).toBe('/');
  });

  test('a summary seen on one device is not shown on a second: the mark is the account\'s', async () => {
    const { fake } = world();
    localStorage.clear();
    const first = load(fake);
    await waitFor(() => expect(where.path).toBe('/log/settlement'));
    first.unmount();
    /* A second device: its storage is empty, the account is the same. */
    localStorage.clear();
    startLoad();
    load(fake, '/');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(where.path).toBe('/');
    expect(Object.keys(localStorage).filter((k) => k.startsWith('kb-settled-seen'))).toEqual([]);
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
    expect(await seenOf(later.fake)).toBeNull();
  });

  test('opened by its address, the summary marks its settlement seen, so a load after does not open it again', async () => {
    const { fake, me, pipe } = world();
    await openSummary(fake, me, pipe);
    await screen.findByRole('heading', { level: 1, name: 'While you were away' });
    await waitFor(async () => expect(await seenOf(fake)).toBe(new Date(at(29, 8, 17)).toISOString()));
  });

  test('a newest settlement that held nothing of the player\'s does not open an older one that did', async () => {
    const { fake, me } = world();
    const other = fake.seed.account('other');
    const glo = fake.seed.character(other, 'Gloomba', 'heel');
    fake.seed.settle({ at: at(30, 8, 17), debut: false, turns: false, ledger: [{ character: glo, reason: 'heel.drewHeat', amount: 10 }] });
    localStorage.clear();
    load(fake);
    await waitFor(async () => expect(await seenOf(fake)).toBe(new Date(at(30, 8, 17)).toISOString()));
    expect(where.path).toBe('/');
  });

  /* #89: a read dropped by leaving the board page is looked for again, on the next board page of the same load. */
  for (const leave of ['leaves for a glass page', 'unmounts'] as const) {
    test(`a first load whose read is dropped (the page ${leave}) is looked for again on the next board page`, async () => {
      const { fake, me } = world();
      localStorage.clear();
      startLoad();
      let release: () => void = () => {};
      const real = fake.log.bind(fake);
      const held = vi.spyOn(fake, 'log').mockImplementationOnce(async (before) => { await new Promise<void>((r) => { release = r; }); return real(before); });
      let setActive: (on: boolean) => void = () => {};
      function Board() {
        const [on, set] = useState(true);
        setActive = set;
        return <SettlementOnLoad active={on} />;
      }
      const first = renderIn(fake, <><Board /><Where /></>, { path: '/' });
      await waitFor(() => expect(held).toHaveBeenCalledTimes(1));
      if (leave === 'unmounts') first.unmount();
      else act(() => setActive(false));
      await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
      expect(await seenOf(fake)).toBeNull();
      expect(where.path).toBe('/');
      if (leave === 'unmounts') load(fake);
      else act(() => setActive(true));
      await waitFor(() => expect(where.path).toBe('/log/settlement'));
    });
  }

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
    await waitFor(async () => expect(await seenOf(fake)).toBe(new Date(at(29, 8, 17)).toISOString()));
    expect(where.path).toBe('/');
  });
});
