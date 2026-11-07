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
import { buildWorld, renderIn } from '../test-world.tsx';
import { firstWords, SeasonScreen } from './Season.tsx';

afterEach(() => { vi.restoreAllMocks(); });

const at = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

function world() {
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
    { character: spritey, place: 1, standing: 985, shown: [{ kind: 'reveal', act: said.act, at: new Date(at(3, 13)).toISOString(), class: 'face', was: null }] },
    { character: gloomba, place: 2, standing: 840 },
    { character: mrs, place: 3, standing: 795 },
    { character: pipe, place: 4, standing: 100 },
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
const show = (fake: ReturnType<typeof world>['fake'], path = '/season?tab=news') => renderIn(fake, <><SeasonScreen /><Probe /></>, { path });
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
    renderIn(fake, <SeasonScreen />, { path: '/season?tab=rankings' });
    const next = await screen.findByRole('link', { name: 'Next page' });
    expect(next).toHaveAttribute('href', '/season?tab=rankings&page=2');
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

  test('the player\'s own characters are marked yours, by the screen, in the results and in the Turns', async () => {
    const w = world();
    show(w.fake);
    const item = await waitFor(() => itemOf('Season 1 results'));
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
    expect(debut).toHaveTextContent('Its class is its own secret until it says otherwise.');
    const turn = itemOf('Pipewrench turned');
    expect(turn).toHaveTextContent('Pipewrench was a Heel');
    expect(turn).toHaveTextContent('What it is now, it isn’t saying.');
  });

  test('the Boss\'s arrival quotes its first words and links its post on The System\'s board; the farewell does the same with its last', async () => {
    const w = world();
    show(w.fake);
    const arrived = await waitFor(() => itemOf('Mister Spreadsheet has arrived'));
    expect(arrived).toHaveTextContent('Mister Spreadsheet runs the board for Season 2.');
    expect(within(arrived).getByText(/Efficiency is a virtue\. So is fear\./u).tagName).toBe('BLOCKQUOTE');
    const post = within(arrived).getByRole('link', { name: 'Read its post on the board' });
    expect(post.getAttribute('href')).toMatch(new RegExp(`^/t/${w.announcements.thread}\\?page=1#post-\\d+$`, 'u'));
    const left = itemOf('Lady Ledger has left');
    expect(within(left).getByText(/My ledger is closed\. Goodbye\./u)).toBeInTheDocument();
    expect(left).toHaveTextContent('Lady Ledger has left');
    expect(left).toHaveTextContent("Season 1's Boss has left.");
    expect(within(left).getByRole('link', { name: 'Read its last post on the board' })).toHaveAttribute('href', expect.stringContaining(`/t/${w.announcements.thread}`));
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
    expect(within(names[0]!).getByText('Yours')).toBeInTheDocument();
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

describe('signed out', () => {
  test('asks to sign in and reads nothing', async () => {
    const fake = buildWorld();
    const spy = vi.spyOn(fake, 'seasonNews');
    renderIn(fake, <SeasonScreen />, { path: '/season?tab=news' });
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByRole('link', { name: /sign in/iu })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
