/**
 * The season page at /season (the alerts plan, Task 8; the alerts design, section 7): a Rankings tab (today's Rankings, inside the page) and
 * a News tab, the season's public record newest first: the results with the top three and a link to all, debuts, Turns, the Boss arriving and
 * leaving. The tabs are a tablist the keyboard moves along, `?tab=` names the open one. The player's own characters are marked "yours" by
 * this screen, from the player's own rows; the news itself is the same whoever reads it. The Boss's words are quoted, linked, and never spoken.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { addressOf, useLocation } from '../router.tsx';
import { SIGNED_OUT_DOC } from '../screen-docs.ts';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';
import { SEASON_NEWS_PAGE } from '../data/api.ts';
import { firstWords, SeasonScreen } from './Season.tsx';
import { LoadedSeason } from '../loaded.tsx';
import { Page } from '../glass/Page.tsx';

const entered = vi.hoisted(() => ({ calls: [] as Element[] }));
vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  animate: (el: Element) => { entered.calls.push(el); return { then: () => {}, stop: () => {} }; },
}));

afterEach(() => { vi.restoreAllMocks(); });

const at = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

/** `places` gives Season 1's four places in the order Spritey, Gloomba, Mrs. Hooligan, Pipewrench; by default 1, 2, 3, 4. */
function world(places: readonly [number, number, number, number] = [1, 2, 3, 4]) {
  const fake = buildWorld();
  const { seed } = fake;
  const me = seed.account('me');
  const other = seed.account('other');
  const pipe = seed.character(me, 'Pipewrench', 'heel', { at: at(1) });
  const mrs = seed.character(me, 'Mrs. Hooligan', 'face', { at: at(1) });
  const spritey = seed.character(other, 'Spritey', 'face', { at: at(1) });
  const gloomba = seed.character(other, 'Gloomba', 'heel', { at: at(1) });
  const thwomp = seed.character(other, 'Thwompson', 'face', { at: at(1) });
  const bossA = seed.staff('lady-ledger', 'Lady Ledger', 'boss', { at: at(1) });
  const bossB = seed.staff('mister-spreadsheet', 'Mister Spreadsheet', 'boss', { at: at(1) });
  /* The announcements thread is The System's board's first: where a Boss speaks. */
  const announcements = seed.thread('announcements', null, 'Announcements', 'Welcome.', { at: at(1) });
  const said = seed.thread('general', spritey, 'here it is', 'Fine.', { at: at(3) });
  seed.reveal(spritey, said.thread, { at: at(3, 13), class: 'face' });
  seed.season({ number: 1, startsAt: new Date(at(1)).toISOString(), endsAt: new Date(at(28)).toISOString() });
  /* Season 1's results are rows, not Acts: the final table as it stood. */
  seed.seasonResults(1, [
    { character: spritey, place: places[0], standing: 985, shown: [{ kind: 'reveal', act: said.act, at: new Date(at(3, 13)).toISOString(), class: 'face', was: null }] },
    { character: gloomba, place: places[1], standing: places[1] === places[0] ? 985 : 840 },
    { character: mrs, place: places[2], standing: 795 },
    { character: pipe, place: places[3], standing: 100 },
  ], { at: at(28) });
  /* Season 1's Promos: a debut, then a Turn announced with its old class. */
  seed.announce(thwomp, 'debut', { at: at(26, 8) });
  const turned = seed.announce(pipe, 'turn', { at: at(27, 8), was: 'heel' });
  seed.season({ number: 2, startsAt: new Date(at(28)).toISOString() });
  /* The Boss changed at the roll-over, and each said a line in the announcements thread. */
  seed.staffPost(bossA, announcements.thread, 'My [b]ledger[/b] is closed. Goodbye.', { at: at(28) });
  seed.staffPost(bossB, announcements.thread, 'Efficiency is a virtue. So is fear.', { at: at(28) });
  seed.handover({ outgoing: 'lady-ledger', boss: 'mister-spreadsheet', at: at(28) });
  seed.settle({ at: at(29, 8), debut: false, standings: { [spritey]: 50, [pipe]: 30 } });
  fake.signInAs(me);
  return { fake, me, other, pipe, mrs, spritey, gloomba, thwomp, turned, announcements };
}

function Probe() {
  const l = useLocation();
  return <output data-testid="at">{addressOf(l)}</output>;
}
const show = (fake: ReturnType<typeof world>['fake'], path = '/season?tab=news') => renderIn(fake, <><LoadedSeason /><Probe /></>, { path });
const feed = () => screen.getByRole('tabpanel').querySelector<HTMLElement>('ul.kb-season-feed')!;
const itemOf = (heading: string | RegExp) => screen.getByRole('heading', { level: 3, name: heading }).closest('li')!;

describe('the tabs', () => {
  test('are a tablist of Rankings and News; Rankings is open by default, with the table of today\'s Rankings inside its panel', async () => {
    const w = world();
    show(w.fake, '/season');
    expect(await screen.findByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Season' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Rankings', 'News']);
    expect(within(tabs).getByRole('tab', { name: 'Rankings' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tabs).getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: 'Rankings' });
    expect(await within(panel).findByRole('table')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { level: 1 })).toBeNull();
  });

  test('?tab=news opens News; the open tab alone is in the tab order and labels the panel', async () => {
    const w = world();
    show(w.fake);
    const panel = await screen.findByRole('tabpanel', { name: 'News' });
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Rankings' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-controls', panel.id);
  });

  test('Right, Left, End and Home move between them and open the tab, with the focus', async () => {
    const w = world();
    const user = userEvent.setup();
    show(w.fake, '/season?tab=rankings');
    const rankings = await screen.findByRole('tab', { name: 'Rankings' });
    rankings.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: 'News' })).toHaveFocus();
    expect(screen.getByTestId('at')).toHaveTextContent('/season?tab=news');
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Rankings' })).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{End}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'News' })).toHaveFocus());
    await user.keyboard('{Home}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Rankings' })).toHaveFocus());
  });

  test('a click opens the other tab', async () => {
    const w = world();
    const user = userEvent.setup();
    show(w.fake, '/season?tab=rankings');
    await user.click(await screen.findByRole('tab', { name: 'News' }));
    expect(await screen.findByRole('tabpanel', { name: 'News' })).toBeInTheDocument();
    expect(screen.getByTestId('at')).toHaveTextContent('/season?tab=news');
  });

  test('the Rankings tab\'s pager keeps to the season page', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    for (let i = 0; i < 51; i++) fake.seed.character(account, `Name ${String(i).padStart(3, '0')}`, 'face', { at: at(1) });
    fake.signInAs(account);
    renderIn(fake, <LoadedSeason />, { path: '/season?tab=rankings' });
    const next = await screen.findByRole('link', { name: 'Next page' });
    expect(next).toHaveAttribute('href', '/season?tab=rankings&page=2');
  });
});

describe('the page is its document', () => {
  const held = async (fake: ReturnType<typeof world>['fake'], tab: string | null, season: number | null, character: string | null, page: number | null) => {
    const boot = await fake.boot();
    const doc = (await fake.seasonPage(tab, season, character, page))!;
    return { boot, doc, read: holdReads(fake, ['session']) };
  };
  const quiet = async (read: readonly string[]) => {
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(read).toEqual([]);
  };

  test('the Rankings tab is whole in the first render, from the document, and nothing is read for it', async () => {
    const w = world();
    const { boot, doc, read } = await held(w.fake, 'rankings', null, null, null);
    renderIn(w.fake, <SeasonScreen doc={doc} />, { path: '/season?tab=rankings', boot });
    expect(screen.getByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel', { name: 'Rankings' })).getByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/Settled /u)).toBeInTheDocument();
    await quiet(read);
  });

  test('a finished season\'s table is whole in the first render, the linked row marked', async () => {
    const w = world();
    const { boot, doc, read } = await held(w.fake, 'rankings', 1, w.pipe, null);
    renderIn(w.fake, <SeasonScreen doc={doc} />, { path: `/season?tab=rankings&season=1&character=${w.pipe}`, boot });
    const row = screen.getByRole('row', { name: /Pipewrench/u });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText(/Final standings/u)).toBeInTheDocument();
    await quiet(read);
  });

  test('the News tab is whole in the first render, the player\'s own characters marked', async () => {
    const w = world();
    const { boot, doc, read } = await held(w.fake, 'news', null, null, null);
    renderIn(w.fake, <SeasonScreen doc={doc} />, { path: '/season?tab=news', boot });
    expect(itemOf('Season 1 results')).toBeInTheDocument();
    expect(screen.getAllByText('Yours')).toHaveLength(2);
    await quiet(read);
  });

  test('signed out, the marker is the sign-in line', () => {
    renderIn(buildWorld(), <SeasonScreen doc={SIGNED_OUT_DOC} />, { path: '/season' });
    expect(screen.getByText(/Sign in/u)).toBeInTheDocument();
  });

  test('a tab change is a load: one seasonPage call, the pressed tab busy while it is out, the old tab drawn until the new one lands', async () => {
    const w = world();
    const real = w.fake.seasonPage.bind(w.fake);
    let release!: () => void;
    const page = vi.spyOn(w.fake, 'seasonPage');
    show(w.fake, '/season?tab=rankings');
    await screen.findByRole('table');
    page.mockClear();
    page.mockImplementationOnce(async (...args) => { await new Promise<void>((r) => { release = r; }); return real(...args); });
    await userEvent.click(screen.getByRole('tab', { name: 'News' }));
    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenLastCalledWith('news', null, null, null);
    expect(screen.getByRole('tab', { name: 'News' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('at')).toHaveTextContent('/season?tab=rankings');
    await act(async () => { release(); });
    expect(await screen.findByRole('tabpanel', { name: 'News' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'News' })).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('at')).toHaveTextContent('/season?tab=news');
  });

  test('a Rankings page is a load: the pager asks seasonPage for that page', async () => {
    const fake = buildWorld();
    const account = fake.seed.account('x');
    for (let i = 0; i < 51; i++) fake.seed.character(account, `Name ${String(i).padStart(3, '0')}`, 'face', { at: at(1) });
    fake.signInAs(account);
    const page = vi.spyOn(fake, 'seasonPage');
    renderIn(fake, <><LoadedSeason /><Probe /></>, { path: '/season?tab=rankings' });
    await userEvent.click(await screen.findByRole('link', { name: 'Next page' }));
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/season?tab=rankings&page=2'));
    expect(page).toHaveBeenCalledTimes(2);
    expect(page).toHaveBeenLastCalledWith('rankings', null, null, 2);
    expect(await screen.findByText('Name 050')).toBeInTheDocument();
  });

  test('the season choice is a navigation to the finished season\'s address', async () => {
    const w = world();
    const page = vi.spyOn(w.fake, 'seasonPage');
    show(w.fake, '/season?tab=rankings');
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Season' }), 'Season 1');
    await waitFor(() => expect(screen.getByTestId('at')).toHaveTextContent('/season?tab=rankings&season=1'));
    expect(page).toHaveBeenLastCalledWith('rankings', 1, null, null);
  });

  test('a season that does not exist is the router\'s "nothing here"', async () => {
    const w = world();
    show(w.fake, '/season?tab=rankings&season=999');
    expect(await screen.findByRole('heading', { name: 'There is no page at this address.' })).toBeInTheDocument();
  });
});

describe('the News tab', () => {
  test('lists the season\'s news newest first: the Boss, the results, the Turn, the debut', async () => {
    const w = world();
    show(w.fake);
    await screen.findByRole('heading', { level: 3, name: /results/iu });
    const heads = within(feed()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual([
      'Mister Spreadsheet has arrived', 'Lady Ledger has left', 'Season 1 results', 'Pipewrench turned', 'Thwompson debuted',
    ]);
  });

  test('the lede names the season and its Boss, and says it is all public', async () => {
    const w = world();
    show(w.fake);
    await screen.findByRole('heading', { level: 3, name: /results/iu });
    expect(screen.getByText(/The Boss this season is Mister Spreadsheet\./u)).toBeInTheDocument();
    expect(screen.getByText(/Everything here is public/u)).toBeInTheDocument();
  });

  test('the results show the top three with their standings and what their players made public of their classes, and a link to all', async () => {
    const w = world();
    show(w.fake);
    const item = await waitFor(() => itemOf('Season 1 results'));
    const podium = within(item).getAllByRole('listitem');
    expect(podium).toHaveLength(3);
    expect(podium[0]).toHaveTextContent('First');
    expect(podium[0]).toHaveTextContent('Spritey');
    expect(podium[0]).toHaveTextContent('9.85');
    expect(podium[0]).toHaveTextContent('was a Face');
    expect(podium[1]).toHaveTextContent('Gloomba');
    expect(podium[1]).toHaveTextContent('class not revealed');
    expect(podium[2]).toHaveTextContent('Mrs. Hooligan');
    expect(within(item).queryByText('Pipewrench')).toBeNull();
    expect(within(podium[0]!).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${w.spritey}`);
    expect(within(item).getByRole('link', { name: 'All 4 characters and their standings' })).toHaveAttribute('href', '/season?tab=rankings&season=1');
  });

  test('each of the top three is named by its place, so a tie at first is two Firsts and the next a Second (dense places, #453)', async () => {
    const w = world([1, 1, 2, 3]);
    show(w.fake);
    const item = await waitFor(() => itemOf('Season 1 results'));
    const places = within(item).getAllByRole('listitem').map((li) => li.querySelector('.kb-season-place')?.textContent);
    expect(places).toEqual(['First', 'First', 'Second']);
  });

  test('the player\'s own characters are marked yours, by the screen, in the results and in the Turns', async () => {
    const w = world();
    show(w.fake);
    const item = await waitFor(() => itemOf('Season 1 results'));
    /* The player's own characters are the provider's (boot's, in the app). */
    await screen.findAllByText('Yours');
    const podium = within(item).getAllByRole('listitem');
    expect(within(podium[2]!).getByText('Yours')).toBeInTheDocument();
    expect(within(podium[0]!).queryByText('Yours')).toBeNull();
    expect(within(podium[1]!).queryByText('Yours')).toBeNull();
    expect(within(itemOf('Pipewrench turned')).getByText('Yours')).toBeInTheDocument();
    expect(within(itemOf('Thwompson debuted')).queryByText('Yours')).toBeNull();
    expect(screen.getAllByText('Yours')).toHaveLength(2);
  });

  test('the news is the same for every reader: it carries no mark, and another player is marked by their own rows', async () => {
    const w = world();
    const mine = await w.fake.seasonNews();
    w.fake.signInAs(w.other);
    expect(await w.fake.seasonNews()).toEqual(mine);
    show(w.fake);
    await waitFor(() => itemOf('Season 1 results'));
    await screen.findAllByText('Yours');
    const podium = within(itemOf('Season 1 results')).getAllByRole('listitem');
    expect(within(podium[0]!).getByText('Yours')).toBeInTheDocument();
    expect(within(podium[1]!).getByText('Yours')).toBeInTheDocument();
    expect(within(podium[2]!).queryByText('Yours')).toBeNull();
  });

  test('a debut names the character and links its profile; a Turn announced with its old class names the class it left', async () => {
    const w = world();
    show(w.fake);
    const debut = await waitFor(() => itemOf('Thwompson debuted'));
    expect(within(debut).getByRole('link', { name: 'Thwompson' })).toHaveAttribute('href', `/c/${w.thwomp}`);
    expect(debut).toHaveTextContent('The class stays a secret until the player says otherwise.');
    const turn = itemOf('Pipewrench turned');
    expect(turn).toHaveTextContent('Pipewrench was a Heel');
    expect(turn).toHaveTextContent('What Pipewrench is now isn’t being said.');
  });

  test('the Boss\'s arrival quotes the Boss\'s first words and links the post on The System\'s board; the farewell does the same with the last', async () => {
    const w = world();
    show(w.fake);
    const arrived = await waitFor(() => itemOf('Mister Spreadsheet has arrived'));
    expect(arrived).toHaveTextContent('Mister Spreadsheet runs the board for Season 2.');
    expect(within(arrived).getByText(/Efficiency is a virtue\. So is fear\./u).tagName).toBe('BLOCKQUOTE');
    const post = within(arrived).getByRole('link', { name: 'Read the post on the board' });
    expect(post.getAttribute('href')).toMatch(new RegExp(`^/t/${w.announcements.thread}\\?page=1#post-\\d+$`, 'u'));
    const left = itemOf('Lady Ledger has left');
    expect(within(left).getByText(/My ledger is closed\. Goodbye\./u)).toBeInTheDocument();
    expect(left).toHaveTextContent('Lady Ledger has left');
    expect(left).toHaveTextContent("Season 1's Boss has left.");
    expect(within(left).getByRole('link', { name: 'Read the last post on the board' })).toHaveAttribute('href', expect.stringContaining(`/t/${w.announcements.thread}`));
    /* The glass quotes; it does not speak as the Boss. */
    expect(arrived).not.toHaveTextContent(/^Mister Spreadsheet:/u);
  });

  test('a Boss with no post to quote has none quoted and no link, and the item still stands', async () => {
    const w = world();
    const newBoss = w.fake.seed.staff('new-boss', 'Quiet Boss', 'boss', { at: at(29) });
    w.fake.seed.handover({ outgoing: 'mister-spreadsheet', boss: 'new-boss', at: at(29) });
    /* It speaks later, about something else: not its handover's words. */
    w.fake.seed.staffPost(newBoss, w.announcements.thread, 'Unrelated.', { at: at(30) });
    show(w.fake);
    const arrived = await waitFor(() => itemOf('Quiet Boss has arrived'));
    expect(within(arrived).queryByRole('link')).toBeNull();
    expect(arrived.querySelector('blockquote')).toBeNull();
  });

  test('says plainly when nothing has happened yet', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    fake.signInAs(me);
    show(fake as never);
    expect(await screen.findByText(/Nothing yet\./u)).toBeInTheDocument();
  });

  test('an announcements landing is one item that lists its names, as a tally did', async () => {
    const w = world();
    w.fake.seed.announce(w.gloomba, 'turn', { at: at(27, 8), was: 'face', class: 'heel' });
    show(w.fake);
    const item = await waitFor(() => itemOf('2 characters turned'));
    const names = within(item).getAllByRole('listitem');
    expect(names.map((n) => within(n).getByRole('link').textContent)).toEqual(['Pipewrench', 'Gloomba']);
    expect(names[0]).toHaveTextContent('Pipewrench was a Heel');
    expect(names[1]).toHaveTextContent('Gloomba was a Face, now a Heel');
    /* The player's own characters are the player's, read by the provider (boot, in the app). */
    expect(await within(names[0]!).findByText('Yours')).toBeInTheDocument();
  });

  test('each item is one seasonNews alert, the same for every player', async () => {
    const w = world();
    const mine = (await w.fake.alerts()).filter((a) => a.kind === 'seasonNews');
    expect(mine.map((a) => a.sub).sort()).toEqual(['bossArrived', 'bossLeft', 'results', 'tally', 'tally']);
    expect(mine.every((a) => a.character === null)).toBe(true);
    w.fake.signInAs(w.other);
    expect((await w.fake.alerts()).filter((a) => a.kind === 'seasonNews')).toEqual(mine);
  });
});

describe('a quotation', () => {
  test('leaves a post\'s markup out and cuts a long one', () => {
    expect(firstWords('My [b]ledger[/b] is [color=red]closed[/color].')).toBe('My ledger is closed.');
    expect(firstWords('x'.repeat(400))).toHaveLength(281);
    expect(firstWords('x'.repeat(400)).endsWith('…')).toBe(true);
  });
});

describe('Show earlier news', () => {
  test('is busy until its page lands, and the rows it adds enter while the ones there do not', async () => {
    const w = world();
    const { boot, doc } = await (async () => ({ boot: await w.fake.boot(), doc: (await w.fake.seasonPage('news', null, null, null))! }))();
    if (doc.tab !== 'news') throw new Error('not news');
    /* A full page, so that the button shows; each item a Boss line of its own. */
    const item = (i: number) => ({ ...doc.news.find((n) => n.kind === 'bossArrived')!, act: `act-${i}`, at: new Date(Date.UTC(2026, 9, 28, 0, 40 - i)).toISOString() });
    const full = { ...doc, news: Array.from({ length: SEASON_NEWS_PAGE }, (_, i) => item(i)) };
    let land!: () => void;
    vi.spyOn(w.fake, 'seasonNews').mockImplementation(() => new Promise((resolve) => { land = () => resolve([item(50), item(51)]); }));
    renderIn(w.fake, <SeasonScreen doc={full} />, { path: '/season?tab=news', boot });
    const rows = () => document.querySelectorAll('.kb-season-item');
    expect(rows()).toHaveLength(SEASON_NEWS_PAGE);
    entered.calls.length = 0;
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier news' }));
    expect(screen.getByRole('button', { name: 'Show earlier news' })).toHaveAttribute('aria-busy', 'true');
    expect(entered.calls).toHaveLength(0);
    await act(async () => { land(); });
    await waitFor(() => expect(rows()).toHaveLength(SEASON_NEWS_PAGE + 2));
    await waitFor(() => expect(entered.calls).toHaveLength(2));
    expect(entered.calls).toEqual([...rows()].slice(SEASON_NEWS_PAGE));
    expect(screen.queryByRole('button', { name: 'Show earlier news' })).toBeNull();
    expect(document.querySelector('[data-kb-entering]')).toBeNull();
  });
});

describe('signed out', () => {
  test('asks to sign in and reads nothing', async () => {
    const fake = buildWorld();
    const spy = vi.spyOn(fake, 'seasonNews');
    renderIn(fake, <LoadedSeason />, { path: '/season?tab=news' });
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByRole('link', { name: /sign in/iu })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

/* A tab press is the body's change, not the screen's (docs/plans/2026-11-08-glass-in-page-swap-design.md): drawn through the page, as the app draws it. */
describe('a change of tab swaps the panel\'s body only', () => {
  test('the heading and the tablist stay the same nodes, the pressed tab keeps focus, and the panel stays put around its body', async () => {
    const w = world();
    renderIn(w.fake, <Page surface="rankings"><LoadedSeason /></Page>, { path: '/season?tab=rankings' });
    const panel = await screen.findByRole('tabpanel', { name: 'Rankings' });
    await within(panel).findByRole('table');
    const h1 = screen.getByRole('heading', { level: 1 });
    const tabs = screen.getByRole('tablist', { name: 'Season' });
    expect(panel.firstElementChild).toHaveClass('kb-screen-body');
    expect(within(panel.firstElementChild as HTMLElement).getByRole('table')).toBeInTheDocument();
    const news = screen.getByRole('tab', { name: 'News' });
    await userEvent.click(news);
    const shown = await screen.findByRole('tabpanel', { name: 'News' });
    await waitFor(() => expect(shown.querySelector('ul.kb-season-feed')).not.toBeNull());
    expect(shown).toBe(panel);
    expect(shown).toHaveAttribute('id', news.getAttribute('aria-controls'));
    expect(screen.getByRole('heading', { level: 1 })).toBe(h1);
    expect(screen.getByRole('tablist', { name: 'Season' })).toBe(tabs);
    expect(screen.getByRole('tab', { name: 'News' })).toBe(news);
    expect(news).toHaveFocus();
    expect(shown.querySelector('.kb-screen-body > :not([data-kb-exiting]) ul.kb-season-feed')).not.toBeNull();
  });
});
