/**
 * Rankings at /rankings (the web plan's glass amendment to Task 10): the season's public standings
 * in their order, the player's own rows marked with their classes, another character's class only
 * as its player made it public. Its requests are the same for every player but the own-row read,
 * so nothing it asks for or shows is computed from another player's private rows.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { usePlayer } from '../player.tsx';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { useLocation } from '../router.tsx';
import { RankingsScreen as RankingsFromDoc } from './Rankings.tsx';
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { loadSeason, seasonKey } from '../glass-docs.ts';
import { isSignedOutDoc } from '../screen-docs.ts';
import { Routes, type Route } from '../routes.tsx';
import { SignInPrompt } from '../mini.tsx';
import userEvent from '@testing-library/user-event';
import { addressOf } from '../router.tsx';
import { readFileSync } from 'node:fs';

function Where() {
  const l = useLocation();
  return <output data-testid="where">{addressOf(l)}</output>;
}

/**
 * The Rankings tab as the app draws it: the season page's route loads the document (`/rankings` is the same page, as the old address), and the
 * tab is drawn from it. `season` and `character` are the address's, as the season page passes them.
 */
function RankingsScreen({ embedded = false, season, character, href }: { readonly embedded?: boolean; readonly season?: number; readonly character?: string; readonly href?: (page: number) => string } = {}) {
  const { api } = useKayfa();
  const routes = useMemo<readonly Route[]>(() => {
    const env = { api, signedIn: async () => (await api.session()).signedIn };
    const load = ({ query }: { readonly query: URLSearchParams }) => loadSeason(env, query, () => Promise.resolve());
    const draw = (_: unknown, doc?: unknown) => (isSignedOutDoc(doc) ? <SignInPrompt /> : <RankingsFromDoc doc={doc as never} embedded={embedded} season={season} character={character} {...(href ? { href } : {})} />);
    return ['/season', '/rankings'].map((path) => ({ path, load, key: (_: unknown, query: URLSearchParams) => seasonKey(query), render: draw }));
  }, [api, embedded, season, character, href]);
  return <Routes routes={routes} />;
}

const at = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

function world() {
  const fake = buildWorld();
  const { seed } = fake;
  seed.season({ number: 1 });
  const me = seed.account('me');
  const other = seed.account('other');
  const pipe = seed.character(me, 'Pipewrench', 'heel', { at: at(1) });
  const spritey = seed.character(other, 'Spritey', 'face', { at: at(1) });
  const gloomba = seed.character(other, 'Gloomba', 'heel', { at: at(1) });
  const quiet = seed.character(other, 'Quiet', 'face', { at: at(1) });
  const system = seed.thread('the-system', null, 'Turns', 'All of them.', { at: at(1) });
  const said = seed.thread('general', spritey, 'here it is', 'Fine.', { at: at(3) });
  seed.reveal(spritey, said.thread, { at: at(3, 13) });
  const gloat = seed.thread('general', gloomba, 'me too', 'Fine.', { at: at(5) });
  seed.reveal(gloomba, gloat.thread, { at: at(5, 13) });
  /* A Turn announced before Gloomba's reveal changes nothing it says; one after Spritey's makes it out of date. */
  seed.announceTurn(gloomba, system.thread, { at: at(4) });
  seed.announceTurn(spritey, system.thread, { at: at(20, 8) });
  seed.settle({ at: at(29, 8), debut: false, standings: { [spritey]: 650, [pipe]: 330, [gloomba]: 180, [quiet]: 40 } });
  return { fake, me, other, pipe, spritey, gloomba, quiet };
}

afterEach(() => { vi.restoreAllMocks(); });

/** A season of `count` characters, named in order, signed in as their player. */
function crowd(count: number) {
  const fake = buildWorld();
  const account = fake.seed.account('x');
  for (let i = 0; i < count; i++) fake.seed.character(account, `Name ${String(i).padStart(3, '0')}`, 'face', { at: at(1) });
  fake.signInAs(account);
  return fake;
}

/** Move to an address as Back or Forward does, which the router hears. */
const goTo = (path: string) => act(() => {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
});

const bodyRows = () => screen.getAllByRole('row').slice(1);
const rowOf = (name: string) => bodyRows().find((r) => within(r).queryByRole('rowheader', { name: new RegExp(`^${name}`, 'u') }))!;
const names = () => bodyRows().map((r) => within(r).getByRole('link').textContent);

/** Season 1 ended Oct 30 with `count` characters ranked and results landed; season 2 is open. Signed in as the owner of the character named `Name 060`. */
function finished(count = 120) {
  const fake = buildWorld();
  const { seed } = fake;
  const me = seed.account('me');
  const other = seed.account('other');
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(seed.character(i === 60 ? me : other, `Name ${String(i).padStart(3, '0')}`, 'face', { at: at(1) }));
  const shown = [
    { kind: 'reveal' as const, act: 'a1', at: new Date(at(3)).toISOString(), class: 'heel', was: null },
    { kind: 'turn' as const, act: 'a2', at: new Date(at(9)).toISOString(), class: null, was: null },
  ];
  seed.season({ number: 1, endsAt: new Date(at(30)).toISOString() });
  seed.season({ number: 2, startsAt: new Date(at(30)).toISOString() });
  seed.seasonResults(1, ids.map((character, i) => ({ character, place: i + 1, standing: 1000 - i, shown: i === 0 ? shown : [] })), { at: at(30, 9) });
  fake.signInAs(me);
  return { fake, ids, me };
}

describe('a finished season', () => {
  test('draws its first page of fifty, headed with its number, final standings and end date', async () => {
    const w = finished();
    renderIn(w.fake, <RankingsScreen embedded season={1} />, { path: '/season?tab=rankings&season=1' });
    await waitFor(() => expect(bodyRows()).toHaveLength(50));
    expect(screen.getByText('Season 1 · Final standings · Ended Oct 30')).toBeInTheDocument();
    expect(names()[0]).toBe('Name 000');
    expect(names()[49]).toBe('Name 049');
    expect(screen.getByText(/Page 1 of 3/u)).toBeInTheDocument();
  });

  test('shows the class its player made public, with the Turn after it, and no class for anyone else', async () => {
    const w = finished();
    renderIn(w.fake, <RankingsScreen embedded season={1} />, { path: '/season?tab=rankings&season=1' });
    await waitFor(() => expect(bodyRows()).toHaveLength(50));
    const first = rowOf('Name 000');
    expect(first).toHaveTextContent('Heel');
    expect(within(first).getByText('Revealed Oct 3')).toBeInTheDocument();
    expect(within(first).getByText('Has Turned since Oct 9')).toBeInTheDocument();
    expect(rowOf('Name 001')).toHaveTextContent('Not revealed');
  });

  test('the select is labeled Season, lists this season as now and then the finished ones, and navigates with replace', async () => {
    const w = finished();
    const user = userEvent.setup();
    renderIn(w.fake, <><RankingsScreen embedded season={1} /><Where /></>, { path: '/season?tab=rankings&season=1' });
    const select = await screen.findByRole('combobox', { name: 'Season' });
    expect(select.tagName).toBe('SELECT');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Season 2 (now)', 'Season 1']);
    expect(select).toHaveValue('1');
    const before = window.history.length;
    await user.selectOptions(select, 'Season 2 (now)');
    expect(screen.getByTestId('where')).toHaveTextContent('/season?tab=rankings');
    expect(screen.getByTestId('where')).not.toHaveTextContent('season=');
    expect(window.history.length).toBe(before);
  });

  test('a character in the link opens the page holding its row, highlighted, and marks the player\'s own', async () => {
    const w = finished();
    renderIn(w.fake, <RankingsScreen embedded season={1} character={w.ids[60]} />, { path: `/season?tab=rankings&season=1&character=${w.ids[60]}` });
    await waitFor(() => expect(screen.getByText(/Page 2 of 3/u)).toBeInTheDocument());
    const row = rowOf('Name 060');
    expect(row).toHaveAttribute('data-kb-highlight');
    expect(row).toHaveAttribute('aria-current', 'true');
    /* The player's own characters are the provider's (boot's, in the app). */
    expect(await within(row).findByText('Yours')).toBeInTheDocument();
    expect(bodyRows().filter((r) => r.hasAttribute('data-kb-highlight'))).toHaveLength(1);
    expect(names()[0]).toBe('Name 050');
  });

  test('the pager keeps to the season', async () => {
    const w = finished();
    renderIn(w.fake, <RankingsScreen embedded season={1} href={(p) => `/season?tab=rankings&season=1&page=${p}`} />, { path: '/season?tab=rankings&season=1' });
    expect(await screen.findByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/season?tab=rankings&season=1&page=2');
  });

  test('the current season, named or not, is today\'s standings', async () => {
    const w = finished(3);
    renderIn(w.fake, <RankingsScreen embedded season={2} />, { path: '/season?tab=rankings&season=2' });
    await screen.findByRole('table');
    expect(screen.queryByText(/Final standings/u)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('');
  });

  test('a season with no final standings is a document that is not there: the router says nothing is here', async () => {
    const w = finished(3);
    renderIn(w.fake, <RankingsScreen embedded season={7} />, { path: '/season?tab=rankings&season=7' });
    expect(await screen.findByRole('heading', { name: 'The page cannot be found' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

/** What the season page does: the season and character come from the address, so a change of the choice changes the props. */
function Host() {
  const { query } = useLocation();
  const s = Number.parseInt(query.get('season') ?? '', 10);
  return <RankingsScreen embedded season={Number.isNaN(s) ? undefined : s} character={query.get('character') ?? undefined} />;
}

describe('a finished season, beyond what the eye sees', () => {
  test('the season choice keeps keyboard focus when it changes: the old table stays until the new one lands, and the select is never replaced', async () => {
    const w = finished();
    const user = userEvent.setup();
    renderIn(w.fake, <Host />, { path: '/season?tab=rankings&season=1' });
    const select = await screen.findByRole('combobox', { name: 'Season' });
    select.focus();
    const real = w.fake.seasonPage.bind(w.fake);
    let answer: () => void = () => {};
    vi.spyOn(w.fake, 'seasonPage').mockImplementationOnce(async (...args) => { await new Promise<void>((resolve) => { answer = resolve; }); return real(...args); });
    await user.selectOptions(select, 'Season 2 (now)');
    /* While it loads: the same select, still focused, and the table of the season shown until the new one has landed. */
    expect(screen.getByRole('combobox', { name: 'Season' })).toBe(select);
    expect(document.activeElement).toBe(select);
    expect(screen.getByText(/Final standings/u)).toBeInTheDocument();
    await act(async () => { answer(); });
    await screen.findByRole('table');
    expect(screen.queryByText(/Final standings/u)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent("Showing Season 2's standings.");
    expect(screen.getByRole('combobox', { name: 'Season' })).toBe(select);
    expect(document.activeElement).toBe(select);
  });

  test('the highlighted row says so in words, not only in color, and is scrolled into view', async () => {
    const w = finished();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      renderIn(w.fake, <RankingsScreen embedded season={1} character={w.ids[60]} />, { path: `/season?tab=rankings&season=1&character=${w.ids[60]}` });
      await waitFor(() => expect(screen.getByText(/Page 2 of 3/u)).toBeInTheDocument());
      expect(within(rowOf('Name 060')).getByText('(the character you followed)')).toBeInTheDocument();
      expect(within(rowOf('Name 061')).queryByText('(the character you followed)')).toBeNull();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(rowOf('Name 060'));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test('a linked character with no row that season is said plainly above the table', async () => {
    const w = finished(3);
    const stranger = w.fake.seed.character(w.me, 'Latecomer', 'face', { at: at(31) });
    renderIn(w.fake, <RankingsScreen embedded season={1} character={stranger} />, { path: `/season?tab=rankings&season=1&character=${stranger}` });
    const note = await screen.findByText('That character has no row in Season 1\'s final standings.');
    const table = await screen.findByRole('table');
    expect(note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bodyRows().filter((r) => r.hasAttribute('data-kb-highlight'))).toHaveLength(0);
  });

  test('the season choice\'s layout does not depend on the order of the stylesheets', () => {
    const css = readFileSync('engine/ui/rankings/rankings.css', 'utf8');
    expect(css).toMatch(/^\.kb-rankings \.kb-rankings-choice \{/mu);
    expect(css).not.toMatch(/^\.kb-rankings-choice \{/mu);
  });
});

describe('Rankings', () => {
  test('a character with no reveal shows no class', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('table');
    const row = rowOf('Quiet');
    expect(within(row).getByText('Not revealed')).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/Face|Heel/u);
  });

  test('a revealed class shows with the reveal\'s date, and a later announced Turn says so', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('table');
    const spritey = rowOf('Spritey');
    expect(spritey).toHaveTextContent('Face');
    expect(within(spritey).getByText('Revealed Oct 3')).toBeInTheDocument();
    expect(within(spritey).getByText('Has Turned since Oct 20')).toBeInTheDocument();
    const gloomba = rowOf('Gloomba');
    expect(gloomba).toHaveTextContent('Heel');
    expect(within(gloomba).getByText('Revealed Oct 5')).toBeInTheDocument();
    expect(within(gloomba).queryByText(/Has Turned/u)).toBeNull();
  });

  test('the player\'s own rows are marked Yours, with their classes now, and no one else\'s', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('table');
    expect(await within(rowOf('Pipewrench')).findByText('Yours')).toBeInTheDocument();
    expect(rowOf('Pipewrench')).toHaveTextContent('Heel');
    expect(screen.getAllByText('Yours')).toHaveLength(1);
  });

  test('the order is the standings\' order whoever is signed in', async () => {
    const w = world();
    const order = (await w.fake.standingsPage(0, 50)).map((s) => s.name);
    expect(order).toEqual(['Spritey', 'Pipewrench', 'Gloomba', 'Quiet']);
    for (const account of [w.me, w.other]) {
      w.fake.signInAs(account);
      const { unmount } = renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
      await screen.findByRole('table');
      expect(names()).toEqual(order);
      unmount();
    }
  });

  test('the page\'s requests are the same for every player apart from the player\'s own rows', async () => {
    const w = world();
    /** Every call the screen makes on the backend, with its arguments, in order. */
    const recorded = async (account: string) => {
      w.fake.signInAs(account);
      const calls: { readonly name: string; readonly args: readonly unknown[] }[] = [];
      const api = new Proxy(w.fake, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver) as unknown;
          if (typeof value !== 'function' || typeof key !== 'string') return value;
          /* A callback (onSession's) is a fresh function each render: it is recorded as one, not by its identity. */
          return (...args: unknown[]) => { calls.push({ name: key, args: args.map((a) => (typeof a === 'function' ? 'a function' : a)) }); return (value as (...a: unknown[]) => unknown).apply(target, args); };
        },
      }) as Fake;
      const { unmount } = renderIn(api, <RankingsScreen />, { path: '/rankings' });
      /* The table is drawn once every read has answered. */
      await screen.findByRole('table');
      unmount();
      return calls;
    };
    const mine = await recorded(w.me);
    const theirs = await recorded(w.other);
    const own = (c: { readonly name: string }) => c.name === 'myCharacters';
    expect(mine.filter((c) => !own(c))).toEqual(theirs.filter((c) => !own(c)));
    /* One request for the page, asked the same for every player. */
    expect(mine.filter((c) => c.name === 'seasonPage').map((c) => c.args)).toEqual([['rankings', null, null, null]]);
    /* The reveals and the Turns come for the page's characters, the player's own among them, in the standings' order. */
    const page = [w.spritey, w.pipe, w.gloomba, w.quiet];
    w.fake.signInAs(w.me);
    const doc = (await w.fake.seasonPage('rankings', null, null, null))!;
    if (doc.tab !== 'standings') throw new Error('the standings');
    expect(doc.standings.map((x) => x.character)).toEqual(page);
  });

  test('pages fifty to a page with ?page=, linked from one count', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    for (let i = 0; i < 120; i++) fake.seed.character(account, `Name ${String(i).padStart(3, '0')}`, 'face', { at: at(1) });
    fake.signInAs(account);
    renderIn(fake, <RankingsScreen />, { path: '/rankings?page=3' });
    await waitFor(() => expect(bodyRows()).toHaveLength(20));
    expect(screen.getByText(/Page 3 of 3/u)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute('href', '/rankings?page=2');
  });

  test('a season of exactly fifty is one page with no pager, and fifty-one is two', async () => {
    const { unmount } = renderIn(crowd(50), <RankingsScreen />, { path: '/rankings' });
    await waitFor(() => expect(bodyRows()).toHaveLength(50));
    expect(screen.queryByRole('navigation', { name: 'Pages of the rankings' })).toBeNull();
    unmount();
    renderIn(crowd(51), <RankingsScreen />, { path: '/rankings' });
    await waitFor(() => expect(bodyRows()).toHaveLength(50));
    const pager = screen.getByRole('navigation', { name: 'Pages of the rankings' });
    expect(pager).toHaveTextContent('Page 1 of 2');
    expect(within(pager).getByRole('link', { name: 'Next page' })).toHaveAttribute('href', '/rankings?page=2');
  });

  test('a page change is a load: the old page stays until the new one lands', async () => {
    const fake = crowd(120);
    renderIn(fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('link', { name: 'Name 000' });
    /* Page 2 is asked for and not yet answered. */
    const real = fake.seasonPage.bind(fake);
    let answer: () => void = () => {};
    const page = vi.spyOn(fake, 'seasonPage').mockImplementationOnce(async (...args) => { await new Promise<void>((resolve) => { answer = resolve; }); return real(...args); });
    await goTo('/rankings?page=2');
    expect(page).toHaveBeenLastCalledWith('rankings', null, null, 2);
    expect(screen.getByRole('link', { name: 'Name 000' })).toBeInTheDocument();
    await act(async () => { answer(); });
    expect(await screen.findByRole('link', { name: 'Name 050' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Name 000' })).toBeNull();
  });

  test('a failed read is the router\'s: the page cannot be displayed, and Try again reads it again', async () => {
    const fake = crowd(120);
    vi.spyOn(fake, 'seasonPage').mockRejectedValueOnce(new Error('the network dropped'));
    renderIn(fake, <RankingsScreen />, { path: '/rankings' });
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Name 000' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The page cannot be displayed' })).toBeNull();
  });

  test('another account signing in reads the page again, with that account\'s own rows', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('table');
    expect(await within(rowOf('Pipewrench')).findByText('Yours')).toBeInTheDocument();
    await act(async () => { w.fake.signInAs(w.other); });
    await waitFor(() => expect(within(rowOf('Spritey')).queryByText('Yours')).not.toBeNull());
    expect(within(rowOf('Pipewrench')).queryByText('Yours')).toBeNull();
  });

  test('no commit after another account signs in paints the last account\'s marks or classes', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    /*
     * Read the page in every commit once the new account is known, after the DOM is written and
     * before any effect of the screen's runs: what a first paint would show.
     */
    const painted: string[][] = [];
    function Probe() {
      const { account } = usePlayer().session;
      useLayoutEffect(() => {
        if (account === w.other) painted.push([...document.querySelectorAll('.kb-rankings-yours, .kb-rankings-class[data-kb-kind="own"]')].map((el) => el.closest('tr')?.querySelector('a')?.textContent ?? ''));
      });
      return null;
    }
    renderIn(w.fake, <><RankingsScreen /><Probe /></>, { path: '/rankings' });
    await screen.findByRole('table');
    expect(await within(rowOf('Pipewrench')).findByText('Yours')).toBeInTheDocument();
    await act(async () => { w.fake.signInAs(w.other); });
    await waitFor(() => expect(within(rowOf('Spritey')).queryByText('Yours')).not.toBeNull());
    expect(painted.length).toBeGreaterThan(0);
    for (const marked of painted) expect(marked).not.toContain('Pipewrench');
  });

  test('no commit after a page change paints the last page\'s rows', async () => {
    const fake = crowd(120);
    const painted: string[] = [];
    function Probe() {
      const { query } = useLocation();
      useLayoutEffect(() => {
        if (query.get('page') === '2') painted.push(...[...document.querySelectorAll('.kb-rankings-name a')].map((a) => a.textContent ?? ''));
      });
      return null;
    }
    renderIn(fake, <><RankingsScreen /><Probe /></>, { path: '/rankings' });
    await screen.findByRole('link', { name: 'Name 000' });
    await goTo('/rankings?page=2');
    await screen.findByRole('link', { name: 'Name 050' });
    expect(painted).not.toContain('Name 000');
  });

  test('one page has no pager, and a page past the end says so and links back to the first', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    const { unmount } = renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('table');
    expect(screen.queryByRole('navigation', { name: 'Pages of the rankings' })).toBeNull();
    unmount();
    renderIn(w.fake, <RankingsScreen />, { path: '/rankings?page=9' });
    expect(await screen.findByText('Nothing on this page.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First page' })).toHaveAttribute('href', '/rankings');
  });

  test('an empty season says so, and a signed-out visitor is asked to sign in', async () => {
    const fake = buildWorld();
    fake.seed.season({ number: 1 });
    fake.signInAs(fake.seed.account('x'));
    const { unmount } = renderIn(fake, <RankingsScreen />, { path: '/rankings' });
    expect(await screen.findByText(/No character has debuted yet/u)).toBeInTheDocument();
    unmount();
    fake.signInAs(null);
    renderIn(fake, <RankingsScreen />, { path: '/rankings' });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});
