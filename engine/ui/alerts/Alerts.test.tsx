/**
 * Alerts at /alerts (the alerts plan, Task 9; the alerts design, sections 2, 4 and 12; board 02-alerts.html): the player's alerts and the two kinds
 * every player gets, newest first, with a divider at the account's mark, filters by character, cards on one target batched among the new, Older to
 * page, Unfollow on a followed row, and plain words that name no caster and no reactor. Opening the page moves the mark, forward only.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { ALERTS_PAGE } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { AlertsScreen } from './Alerts.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

const T0 = Date.UTC(2026, 10, 2, 0);
const H = 3_600_000;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Pipewrench and Mrs. Hooligan are the player's; Spritey is another player's; Bo Face is the one who quotes and plays cards (a caster no line may name).
 * Oldest to newest: a quote (2h), a follow (3h, the newest post in Pipewrench's thread), a card (4h), a hint (5h), a ruling on Mrs. Hooligan (6h), a
 * settlement (7h), an update (8h) and the Boss's arrival (9h).
 */
function world(o: { mark?: number | null; cards?: number } = {}) {
  const fake = buildWorld();
  const { seed } = fake;
  const me = seed.account('me');
  const other = seed.account('other');
  const bo = seed.account('bo');
  const pipe = seed.character(me, 'Pipewrench', 'heel');
  const hoo = seed.character(me, 'Mrs. Hooligan', 'face');
  const spritey = seed.character(other, 'Spritey', 'face');
  const boFace = seed.character(bo, 'Bo Face', 'heel');
  const { thread, act: opener } = seed.thread('general', pipe, 'who keeps splatting my posts', 'opening', { at: T0 + H });
  seed.post(thread, boFace, 'quoting you', { quote: opener, at: T0 + 2 * H });
  seed.post(thread, spritey, 'more words', { at: T0 + 3 * H });
  for (let i = 0; i < (o.cards ?? 1); i++) seed.card(boFace, opener, 'whoops', { at: T0 + 4 * H + i * MIN });
  seed.alert(me, { kind: 'hint', act: opener, character: pipe, sub: 'thunder', at: T0 + 5 * H });
  seed.alert(me, { kind: 'ruling', act: opener, character: hoo, sub: 'x', at: T0 + 6 * H });
  seed.settle({ at: T0 + 7 * H, ledger: [{ character: pipe, reason: 'heel.drewHeat', amount: 40 }, { character: hoo, reason: 'face.cheered', amount: 20 }] });
  seed.update({ title: 'Traps now bite board cards', body: 'Words.', at: T0 + 8 * H });
  seed.staff('boss', 'Gloomba Prime', 'boss');
  seed.handover({ boss: 'boss', at: T0 + 9 * H });
  fake.signInAs(me);
  return { fake, me, bo, pipe, hoo, spritey, boFace, thread, opener, mark: o.mark === undefined ? T0 + 4.5 * H : o.mark };
}

/** Sets the account's mark before the page opens, as an earlier visit would have. */
async function show(w: ReturnType<typeof world>, path = '/alerts') {
  if (w.mark !== null) await w.fake.seeAlerts(iso(w.mark));
  return renderIn(w.fake, <AlertsScreen />, { path });
}
const rows = () => screen.getAllByRole('listitem').filter((li) => li.classList.contains('kb-alerts-row'));
const rowWith = (text: RegExp | string) => rows().find((r) => (typeof text === 'string' ? r.textContent!.includes(text) : text.test(r.textContent!)))!;
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the page', () => {
  test('is a heading, the filters, and every kind of the player\'s alerts newest first, each with its words and its link', async () => {
    const w = world();
    await show(w);
    expect(await screen.findByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    await screen.findByText('Gloomba Prime', { exact: false });
    const lines = rows().map((r) => r.querySelector('.kb-alerts-line')!.textContent);
    expect(lines).toEqual([
      'A new Boss has arrived: Gloomba Prime',
      'New update from The developers: “Traps now bite board cards”',
      'A settlement is in',
      'A ruling landed on Mrs. Hooligan',
      'A pattern in the reactions to Pipewrench\'s post',
      'Whoops! was played on Pipewrench\'s post #1',
      '2 new posts in who keeps splatting my posts',
      'Pipewrench\'s post was quoted',
    ]);
    const link = (row: Element, name: string) => within(row as HTMLElement).getByRole('link', { name });
    expect(link(rowWith('Gloomba'), 'Read it on the Season page')).toHaveAttribute('href', '/season?tab=news');
    expect(link(rowWith('New update'), 'Read it in Updates')).toHaveAttribute('href', expect.stringMatching(/^\/updates\?update=/u));
    expect(link(rowWith('settlement'), 'Open the summary')).toHaveAttribute('href', '/log/settlement');
    expect(link(rowWith('A ruling'), 'Go to the post')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
    expect(link(rowWith('A pattern'), 'Go to the post')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
    expect(link(rowWith('Whoops!'), 'Go to the post')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
    expect(link(rowWith('new posts in'), 'First unread post')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
    expect(link(rowWith('was quoted'), 'Go to the post')).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
  });

  test('each row carries its character or whose it is, and its time in UTC as a time element', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    expect(within(rowWith('was quoted')).getByText('Pipewrench')).toHaveClass('kb-alerts-who');
    expect(within(rowWith('A ruling')).getByText('Mrs. Hooligan')).toHaveClass('kb-alerts-who');
    expect(within(rowWith('A settlement')).getByText('All yours')).toBeInTheDocument();
    expect(within(rowWith('New update')).getByText('Everyone')).toBeInTheDocument();
    const time = within(rowWith('A ruling')).getByText(/Nov 2/u);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', iso(T0 + 6 * H));
    expect(time).toHaveTextContent('Nov 2 · 06:00 UTC');
  });

  test('says nothing of who played a card or quoted, and nothing of who reacted', async () => {
    const w = world();
    w.fake.seed.react(w.bo, w.boFace, w.opener, 'fire');
    await show(w);
    await screen.findByText('A settlement is in');
    expect(document.body.textContent).not.toMatch(/Bo Face|Spritey|reacted|reaction by/iu);
    expect(rows().some((r) => /reacted/iu.test(r.textContent!))).toBe(false);
  });
});

describe('the divider', () => {
  test('sits at the account\'s mark: what arrived after it above, Earlier below', async () => {
    const w = world();
    await show(w);
    const fresh = await screen.findByRole('heading', { level: 2, name: 'New since you last looked, Nov 2 · 04:30 UTC' });
    const earlier = screen.getByRole('heading', { level: 2, name: 'Earlier' });
    expect(before(fresh, rowWith('A new Boss'))).toBe(true);
    expect(before(rowWith('A pattern'), earlier)).toBe(true);
    expect(before(fresh, rowWith('A pattern'))).toBe(true);
    expect(before(earlier, rowWith('Whoops!'))).toBe(true);
    expect(before(earlier, rowWith('was quoted'))).toBe(true);
    expect(before(fresh, earlier)).toBe(true);
    expect(rows().filter((r) => before(earlier, r))).toHaveLength(3);
  });

  test('an account that has never looked has everything new and no Earlier', async () => {
    const w = world({ mark: null });
    await show(w);
    expect(await screen.findByRole('heading', { level: 2, name: 'New since you last looked' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Earlier' })).toBeNull();
    expect(rows()).toHaveLength(8);
  });

  test('with nothing new it says so plainly and lists everything under Earlier', async () => {
    const w = world({ mark: T0 + 20 * H });
    await show(w);
    expect(await screen.findByText('Nothing is new since you last looked, Nov 2 · 20:00 UTC.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /New since/u })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Earlier' })).toBeInTheDocument();
    expect(rows()).toHaveLength(8);
  });
});

describe('opening the page', () => {
  test('moves the mark to the newest row\'s time, and the divider stays where the mark was while the page is open', async () => {
    const w = world();
    const see = vi.spyOn(w.fake, 'seeAlerts');
    await show(w);
    await screen.findByText('A settlement is in');
    await waitFor(() => expect(see).toHaveBeenLastCalledWith(iso(T0 + 9 * H)));
    expect((await w.fake.preferences()).alertsSeenAt).toBe(iso(T0 + 9 * H));
    expect(await w.fake.alertsUnread()).toBe(0);
    expect(screen.getByRole('heading', { level: 2, name: 'New since you last looked, Nov 2 · 04:30 UTC' })).toBeInTheDocument();
  });

  test('never moves it backward: a page whose newest row is not past the mark does not ask', async () => {
    const w = world({ mark: T0 + 20 * H });
    const see = vi.spyOn(w.fake, 'seeAlerts');
    await show(w);
    await screen.findByText('A settlement is in');
    expect(see).toHaveBeenCalledTimes(1); // the test's own setting of the mark, before the page opened
    expect((await w.fake.preferences()).alertsSeenAt).toBe(iso(T0 + 20 * H));
  });

  test('a second visit has nothing new', async () => {
    const w = world();
    const first = await show(w);
    await screen.findByText('A settlement is in');
    await waitFor(async () => expect((await w.fake.preferences()).alertsSeenAt).toBe(iso(T0 + 9 * H)));
    first.unmount();
    renderIn(w.fake, <AlertsScreen />, { path: '/alerts' });
    expect(await screen.findByText(/Nothing is new since you last looked/u)).toBeInTheDocument();
  });
});

describe('batching', () => {
  test('cards on one target among the new rows are one row, and the older ones stay as they are', async () => {
    const w = world({ cards: 3, mark: T0 + 3.5 * H });
    await show(w);
    await screen.findByText('A settlement is in');
    const row = rowWith('and 2 more');
    expect(row.querySelector('.kb-alerts-line')).toHaveTextContent('Whoops! and 2 more were played on Pipewrench\'s post #1');
    expect(within(row).getByText('3 cards in all.', { exact: false })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Go to the post' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
    expect(rows().filter((r) => /was played on/u.test(r.textContent!))).toHaveLength(0);
  });

  test('cards already seen are not batched', async () => {
    const w = world({ cards: 3, mark: T0 + 6 * H });
    await show(w);
    await screen.findByText('A settlement is in');
    expect(rows().filter((r) => r.querySelector('.kb-alerts-line')!.textContent === 'Whoops! was played on Pipewrench\'s post #1')).toHaveLength(3);
    expect(screen.queryByText(/and 2 more/u)).toBeNull();
  });
});

describe('the filters', () => {
  test('All and each character: a character shows its own rows and not the rows that are no one\'s', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    const nav = screen.getByRole('navigation', { name: 'Whose alerts' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Mrs. Hooligan', 'Pipewrench']);
    expect(within(nav).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(nav).getByRole('button', { name: 'Mrs. Hooligan' }));
    expect(rows().map((r) => r.querySelector('.kb-alerts-line')!.textContent)).toEqual(['A ruling landed on Mrs. Hooligan']);
    expect(within(nav).getByRole('button', { name: 'Mrs. Hooligan' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(nav).getByRole('button', { name: 'Pipewrench' }));
    expect(rows().map((r) => r.querySelector('.kb-alerts-line')!.textContent)).toEqual([
      'A pattern in the reactions to Pipewrench\'s post', 'Whoops! was played on Pipewrench\'s post #1', 'Pipewrench\'s post was quoted',
    ]);
    await userEvent.click(within(nav).getByRole('button', { name: 'All' }));
    expect(rows()).toHaveLength(8);
  });

  test('a character with nothing says so, and All is a way back', async () => {
    const w = world();
    w.fake.seed.character(w.me, 'Quiet', 'face');
    await show(w);
    await screen.findByText('A settlement is in');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Whose alerts' })).getByRole('button', { name: 'Quiet' }));
    expect(screen.getByText('Nothing for Quiet yet.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Whose alerts' })).toBeInTheDocument();
  });
});

describe('a followed thread', () => {
  test('has Unfollow on its row, which unfollows it and takes the row off the list', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    const follow = vi.spyOn(w.fake, 'follow');
    expect(await w.fake.following(w.thread)).toBe(true);
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow' }));
    await waitFor(() => expect(screen.queryByText(/new posts in/u)).toBeNull());
    expect(follow).toHaveBeenCalledWith(w.thread, false);
    expect(await w.fake.following(w.thread)).toBe(false);
    expect(rows()).toHaveLength(7);
  });

  test('a refusal leaves the row and says why in plain words', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    vi.spyOn(w.fake, 'follow').mockResolvedValue({ ok: false, error: 'No such thread.' } as never);
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow' }));
    expect(await within(rowWith('new posts in')).findByRole('alert')).toHaveTextContent('No such thread.');
    expect(rowWith('new posts in')).toBeTruthy();
  });

  test('a call that fails says so and leaves the row to try again', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    vi.spyOn(w.fake, 'follow').mockRejectedValue(new Error('offline'));
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow' }));
    expect(await within(rowWith('new posts in')).findByRole('alert')).toHaveTextContent('That did not go through. Try again.');
  });
});

describe('Older', () => {
  function busy() {
    const w = world({ mark: null });
    const { seed } = w.fake;
    for (let i = 0; i < 40; i++) seed.alert(w.me, { kind: 'hint', act: w.opener, character: w.pipe, sub: `h${i}`, at: T0 + 100 * H + i * MIN });
    return { ...w, mark: T0 + 100 * H + 35.5 * MIN };
  }
  const hints = () => rows().filter((r) => r.querySelector('.kb-alerts-line')!.textContent!.startsWith('A pattern'));

  test('reads the next page without repeating a row, keeps the divider where it was, and goes once the last page is read', async () => {
    const w = busy();
    await show(w);
    await screen.findByRole('heading', { level: 2, name: /New since you last looked/u });
    expect(rows()).toHaveLength(ALERTS_PAGE);
    const older = screen.getByRole('button', { name: 'Older' });
    await userEvent.click(older);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Older' })).toBeNull());
    expect(hints()).toHaveLength(41);
    const earlier = screen.getByRole('heading', { level: 2, name: 'Earlier' });
    // The four hints after the mark are above the divider; everything on the older page is below it.
    expect(rows().filter((r) => before(r, earlier))).toHaveLength(4);
    expect(rows().filter((r) => before(earlier, r))).toHaveLength(rows().length - 4);
    const keys = rows().map((r) => r.getAttribute('data-kb-key'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('a page that fails says so and leaves the rows and the control to try again', async () => {
    const w = busy();
    await show(w);
    await screen.findByRole('button', { name: 'Older' });
    const read = vi.spyOn(w.fake, 'alerts').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByText('The older alerts could not be read. Try again.')).toBeInTheDocument();
    expect(rows()).toHaveLength(ALERTS_PAGE);
    read.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Older' })).toBeNull());
  });
});

describe('the states', () => {
  test('with nothing yet it says so and what fills the page', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <AlertsScreen />, { path: '/alerts' });
    expect(await screen.findByText(/Nothing here yet/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
  });

  test('a read that fails says so in plain words, with Try again', async () => {
    const w = world();
    vi.spyOn(w.fake, 'alerts').mockRejectedValueOnce(new Error('offline'));
    await show(w);
    expect(await screen.findByText('Your alerts could not be read.', { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('A settlement is in')).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/u)).toBeNull();
  });

  test('a visitor is asked to sign in', async () => {
    const fake: Fake = buildWorld();
    renderIn(fake, <AlertsScreen />, { path: '/alerts' });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
