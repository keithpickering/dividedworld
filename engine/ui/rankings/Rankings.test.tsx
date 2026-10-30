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
import { RankingsScreen } from './Rankings.tsx';

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
    expect(within(rowOf('Pipewrench')).getByText('Yours')).toBeInTheDocument();
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
    expect(mine.some(own)).toBe(true);
    expect(theirs.some(own)).toBe(true);
    expect(mine.filter((c) => !own(c))).toEqual(theirs.filter((c) => !own(c)));
    /* The reveals and the Turns are asked about for the page's characters, the player's own among them, in the standings' order. */
    const page = [w.spritey, w.pipe, w.gloomba, w.quiet];
    expect(mine.find((c) => c.name === 'classReveals')?.args).toEqual([page]);
    expect(mine.find((c) => c.name === 'turnsAnnounced')?.args).toEqual([page]);
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

  test('a page change shows neither the old page\'s rows nor its error while the new page loads', async () => {
    const fake = crowd(120);
    renderIn(fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('link', { name: 'Name 000' });
    /* Page 2 is asked for and not yet answered. */
    vi.spyOn(fake, 'standingsPage').mockReturnValueOnce(new Promise(() => {}));
    await goTo('/rankings?page=2');
    expect(screen.queryByRole('link', { name: 'Name 000' })).toBeNull();
    expect(screen.queryByText(/Page 1 of 3/u)).toBeNull();
    expect(document.querySelector('.kb-rankings[aria-busy="true"]')).not.toBeNull();
  });

  test('a failed read is tried again on a page change, and its error does not stay while it is', async () => {
    const fake = crowd(120);
    const real = fake.standingsPage.bind(fake);
    let answer: (rows: Awaited<ReturnType<typeof real>>) => void = () => {};
    const page = vi.spyOn(fake, 'standingsPage')
      .mockRejectedValueOnce(new Error('the network dropped'))
      .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    renderIn(fake, <RankingsScreen />, { path: '/rankings' });
    expect(await screen.findByText(/could not be loaded/u)).toBeInTheDocument();
    await goTo('/rankings?page=2');
    expect(page).toHaveBeenLastCalledWith(50, 50);
    expect(screen.queryByText(/could not be loaded/u)).toBeNull();
    await act(async () => { answer(await real(50, 50)); });
    expect(await screen.findByRole('link', { name: 'Name 050' })).toBeInTheDocument();
  });

  test('another account signing in reads the page again, with that account\'s own rows', async () => {
    const w = world();
    w.fake.signInAs(w.me);
    renderIn(w.fake, <RankingsScreen />, { path: '/rankings' });
    await screen.findByRole('table');
    expect(within(rowOf('Pipewrench')).getByText('Yours')).toBeInTheDocument();
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
    expect(within(rowOf('Pipewrench')).getByText('Yours')).toBeInTheDocument();
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
