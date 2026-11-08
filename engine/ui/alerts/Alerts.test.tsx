/**
 * Alerts at /alerts (the alerts plan, Task 9; the alerts design, sections 2, 4 and 12; board 02-alerts.html): the player's alerts and the two kinds
 * every player gets, newest first, with a divider at the account's mark, filters by character, cards on one target batched among the new, Older to
 * page, Unfollow on a followed row, and plain words that name no caster and no reactor. Opening the page moves the mark, forward only.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { ALERTS_PAGE, type Alert } from '../data/api.ts';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';

const must = <T,>(a: { readonly ok: boolean; readonly value?: T }) => { expect(a.ok).toBe(true); return a.value as T; };
import { LoadedAlerts } from '../loaded.tsx';
import { loadAlerts } from '../glass-docs.ts';
import { AlertsScreen } from './Alerts.tsx';

const entered = vi.hoisted(() => ({ calls: [] as Element[] }));
vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  animate: (el: Element) => { entered.calls.push(el); return { then: () => {}, stop: () => {} }; },
}));

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
function world(o: { mark?: number | null; cards?: number; joinedAt?: number } = {}) {
  const fake = buildWorld();
  const { seed } = fake;
  const me = seed.account('me', o.joinedAt === undefined ? undefined : { joinedAt: o.joinedAt });
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
  /* Boot is read as the app's first load reads it, so the player's characters are the frame's before the page is drawn. */
  return renderIn(w.fake, <LoadedAlerts />, { path, boot: await w.fake.boot() });
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

  test('an account that has never looked has what arrived since it joined new, and the rest under Earlier (issue #148)', async () => {
    const w = world({ mark: null, joinedAt: T0 + 4.5 * H });
    await show(w);
    const fresh = await screen.findByRole('heading', { level: 2, name: 'New since you joined, Nov 2 · 04:30 UTC' });
    const earlier = screen.getByRole('heading', { level: 2, name: 'Earlier' });
    expect(screen.queryByRole('heading', { level: 2, name: /New since you last looked/ })).toBeNull();
    expect(before(fresh, earlier)).toBe(true);
    expect(rows().filter((r) => before(earlier, r))).toHaveLength(3);
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
    await waitFor(() => expect(see).toHaveBeenCalledTimes(2), { timeout: 1500 }); // the test's own setting of the mark, then the page's
    expect(see.mock.calls.at(-1)?.[0]).toBe(iso(T0 + 9 * H));
    expect((await w.fake.preferences()).alertsSeenAt).toBe(iso(T0 + 9 * H));
    expect(await w.fake.alertsUnread()).toBe(0);
    expect(screen.getByRole('heading', { level: 2, name: 'New since you last looked, Nov 2 · 04:30 UTC' })).toBeInTheDocument();
  });

  test('for an account that never looked, the first time passed is the newest row\'s, not the oldest', async () => {
    const w = world({ mark: null });
    const see = vi.spyOn(w.fake, 'seeAlerts');
    await show(w);
    await screen.findByText('A settlement is in');
    await waitFor(() => expect(see).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(see.mock.calls[0]![0]).toBe(iso(T0 + 9 * H));
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
    renderIn(w.fake, <LoadedAlerts />, { path: '/alerts' });
    expect(await screen.findByText(/Nothing is new since you last looked/u)).toBeInTheDocument();
  });
});

describe('batching', () => {
  test('cards on one target among the new rows are one row, and the older ones stay as they are', async () => {
    const w = world({ cards: 3, mark: T0 + 3.5 * H });
    await show(w);
    await screen.findByText('A settlement is in');
    const lines = rows().map((r) => r.querySelector('.kb-alerts-line')!.textContent);
    expect(lines).toContain('Whoops! and 2 more were played on Pipewrench\'s post #1');
    expect(lines.filter((l) => l!.startsWith('Whoops!'))).toHaveLength(1);
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
      'A pattern in the reactions to Pipewrench\'s post', 'Whoops! was played on Pipewrench\'s post #1', '2 new posts in who keeps splatting my posts', 'Pipewrench\'s post was quoted',
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
  test('started by one of the player\'s characters: tagged with it, says so, and shows under its filter', async () => {
    const w = world();
    const opening = vi.spyOn(w.fake, 'openingActs');
    const page = vi.spyOn(w.fake, 'alertsPage');
    await show(w);
    await screen.findByText('A settlement is in');
    const row = rowWith('new posts in');
    expect(within(row).getByText('Pipewrench')).toHaveClass('kb-alerts-who');
    expect(row).toHaveTextContent('You follow it because Pipewrench started it.');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Whose alerts' })).getByRole('button', { name: 'Mrs. Hooligan' }));
    expect(screen.queryByText(/new posts in/u)).toBeNull();
    // The followed rows' first posts are the document's: one read of it, none of its own.
    expect(page).toHaveBeenCalledTimes(1);
    expect(opening).not.toHaveBeenCalled();
  });

  test('followed by choice, a thread someone else started stays "Followed" and says nothing about who started it', async () => {
    const w = world();
    const ink = w.fake.seed.thread('general', w.spritey, 'best ink color', 'Defend it.', { at: T0 + 5.5 * H });
    w.fake.seed.post(ink.thread, w.boFace, 'Defending it.', { at: T0 + 5.6 * H });
    w.fake.signInAs(w.me);
    must(await w.fake.follow(ink.thread, true));
    const page = vi.spyOn(w.fake, 'alertsPage');
    await show(w);
    await screen.findByText('A settlement is in');
    const row = rowWith('best ink color');
    expect(within(row).getByText('Followed')).toHaveClass('kb-alerts-who');
    expect(row).not.toHaveTextContent('because');
    expect(page).toHaveBeenCalledTimes(1);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Whose alerts' })).getByRole('button', { name: 'Pipewrench' }));
    expect(screen.queryByText(/best ink color/u)).toBeNull();
  });

  test('Unfollow is named for its thread, so each row\'s own is told apart, and "this thread" when the title is missing', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    expect(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow \u2018who keeps splatting my posts\u2019' })).toHaveTextContent(/^Unfollow$/u);
  });

  test('has Unfollow on its row, which unfollows it and takes the row off the list', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    const follow = vi.spyOn(w.fake, 'follow');
    expect(await w.fake.following(w.thread)).toBe(true);
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow \u2018who keeps splatting my posts\u2019' }));
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
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow \u2018who keeps splatting my posts\u2019' }));
    expect(await within(rowWith('new posts in')).findByRole('alert')).toHaveTextContent('No such thread.');
    expect(rowWith('new posts in')).toBeTruthy();
  });

  test('a call that fails says so and leaves the row to try again', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    vi.spyOn(w.fake, 'follow').mockRejectedValue(new Error('offline'));
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow \u2018who keeps splatting my posts\u2019' }));
    expect(await within(rowWith('new posts in')).findByRole('alert')).toHaveTextContent('That did not go through. Try again.');
  });
});

describe('a followed row with no title', () => {
  test('names its Unfollow "this thread"', async () => {
    const w = world();
    const real = await w.fake.alertsPage(null);
    vi.spyOn(w.fake, 'alertsPage').mockResolvedValue({ ...real, alerts: real.alerts.map((r) => (r.kind === 'followed' ? { ...r, title: null } : r)) });
    await show(w);
    await screen.findByText('A settlement is in');
    expect(within(rowWith('new posts in')).getByRole('button', { name: 'Unfollow this thread' })).toBeInTheDocument();
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

  test('Older is a busy button while the page loads: aria-busy, its name kept, and a second press reads one page', async () => {
    const w = busy();
    await show(w);
    await screen.findByRole('button', { name: 'Older' });
    const orig = w.fake.alerts.bind(w.fake);
    let release!: () => void;
    const read = vi.spyOn(w.fake, 'alerts').mockImplementationOnce((...args) => new Promise((resolve) => { release = () => resolve(orig(...args)); }));
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    const older = screen.getByRole('button', { name: 'Older' });
    expect(older).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(older);
    expect(read).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Older' })).toBeNull());
  });

  test('the rows Older adds enter, and the rows already there do not', async () => {
    const w = busy();
    await show(w);
    await screen.findByRole('button', { name: 'Older' });
    const had = rows().length;
    const first = rows().map((r) => r.getAttribute('data-kb-key'));
    entered.calls.length = 0;
    const orig = w.fake.alerts.bind(w.fake);
    let release!: () => void;
    vi.spyOn(w.fake, 'alerts').mockImplementationOnce((...args) => new Promise((resolve) => { release = () => resolve(orig(...args)); }));
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(screen.getByRole('button', { name: 'Older' })).toHaveAttribute('aria-busy', 'true');
    expect(entered.calls).toHaveLength(0);
    release();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Older' })).toBeNull());
    await waitFor(() => expect(entered.calls.length).toBeGreaterThan(0));
    expect(entered.calls.length).toBe(rows().length - had);
    for (const el of entered.calls) expect(first).not.toContain(el.getAttribute('data-kb-key'));
    expect(document.querySelector('[data-kb-entering]')).toBeNull();
  });

  test('a page that fails says so and leaves the rows and the control to try again', async () => {
    const w = busy();
    await show(w);
    await screen.findByRole('button', { name: 'Older' });
    const read = vi.spyOn(w.fake, 'alerts').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The older alerts could not be read. Try again.');
    expect(rows()).toHaveLength(ALERTS_PAGE);
    read.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Older' })).toBeNull());
  });
});

const deferred = <T,>() => { let release!: (v: T) => void; const promise = new Promise<T>((r) => { release = r; }); return { promise, release }; };
/** A hint row with nothing to open, older than the world's rows (`n` minutes before it began). */
const filler = (n: number, pipe: string): Alert => ({ kind: 'hint', sub: `f${n}`, act: null, character: pipe, at: iso(T0 - n * MIN), thread: null, name: 'Pipewrench', title: null, count: null });

describe('a page that is left or changed while it loads', () => {
  test('a row unfollowed while Older loads does not come back with the page', async () => {
    const w = world({ mark: null });
    const real = await w.fake.alertsPage(null);
    const followed = real.alerts.find((r) => r.kind === 'followed')!;
    const page = deferred<readonly Alert[]>();
    vi.spyOn(w.fake, 'alertsPage').mockResolvedValueOnce({ ...real, alerts: [...real.alerts, ...Array.from({ length: ALERTS_PAGE - real.alerts.length }, (_, i) => filler(i + 1, w.pipe))] });
    vi.spyOn(w.fake, 'alerts').mockReturnValueOnce(page.promise);
    await show(w);
    await screen.findByText('A settlement is in');
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: /^Unfollow/u }));
    await waitFor(() => expect(screen.queryByText(/new posts in/u)).toBeNull());
    page.release([filler(99, w.pipe), followed]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Older' })).toBeNull());
    expect(screen.queryByText(/new posts in/u)).toBeNull();
    expect(rows().filter((r) => r.getAttribute('data-kb-key')!.includes('f99'))).toHaveLength(1);
  });
});

describe('a page that cannot read everything', () => {
  test('without the player\'s characters there are no filters, and the rows are all there', async () => {
    const w = world();
    vi.spyOn(w.fake, 'myCharacters').mockRejectedValue(new Error('offline'));
    renderIn(w.fake, <LoadedAlerts />, { path: '/alerts' });
    await screen.findByText('A settlement is in');
    expect(screen.queryByRole('navigation', { name: 'Whose alerts' })).toBeNull();
    expect(rows()).toHaveLength(8);
  });

  test('a document without the first posts is a followed row tagged "Followed"', async () => {
    const w = world();
    const real = await w.fake.alertsPage(null);
    vi.spyOn(w.fake, 'alertsPage').mockResolvedValue({ ...real, openings: [] });
    await show(w);
    await screen.findByText('A settlement is in');
    expect(within(rowWith('new posts in')).getByText('Followed')).toHaveClass('kb-alerts-who');
    expect(rowWith('new posts in')).not.toHaveTextContent('because');
  });

  test('a document without the Acts or the reading places still renders, linking the threads', async () => {
    const w = world();
    const real = await w.fake.alertsPage(null);
    vi.spyOn(w.fake, 'alertsPage').mockResolvedValue({ ...real, acts: [], people: [], reading: {} });
    await show(w);
    await screen.findByText('A settlement is in');
    expect(rows()).toHaveLength(8);
    expect(within(rowWith('new posts in')).getByRole('link', { name: 'First unread post' })).toHaveAttribute('href', expect.stringContaining(`/t/${w.thread}`));
  });
});

describe('what is announced', () => {
  test('the page is whole in its first render, from its document: no status, no empty busy block, and nothing read', async () => {
    const w = world();
    const boot = await w.fake.boot();
    const doc = await w.fake.alertsPage(null);
    const read = holdReads(w.fake, ['session', 'seeAlerts']);
    renderIn(w.fake, <AlertsScreen doc={doc} />, { path: '/alerts', boot });
    expect(screen.getByText('A settlement is in')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Whose alerts' })).getAllByRole('button')).toHaveLength(3);
    expect(rowWith('new posts in')).toHaveTextContent('You follow it because Pipewrench started it.');
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(read).toEqual([]);
  });

  test('the page reads its one document and nothing else of its own', async () => {
    const w = world();
    const page = vi.spyOn(w.fake, 'alertsPage');
    const own = ['alerts', 'preferences', 'accountOpenedAt', 'myCharacters', 'actsById', 'characters', 'openingActs', 'reading'] as const;
    const spies = own.map((n) => vi.spyOn(w.fake, n));
    await show(w);
    await screen.findByText('A settlement is in');
    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith(null);
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual(own.map(() => 0));
  });

  test('the mark moves after the page has landed; loading the document alone writes nothing', async () => {
    const w = world({ mark: null });
    const see = vi.spyOn(w.fake, 'seeAlerts');
    const doc = await loadAlerts({ api: w.fake, signedIn: () => true }, () => Promise.resolve());
    expect(see).not.toHaveBeenCalled();
    renderIn(w.fake, <AlertsScreen doc={doc as never} />, { path: '/alerts', boot: await w.fake.boot() });
    await screen.findByText('A settlement is in');
    await waitFor(() => expect(see).toHaveBeenCalledTimes(1));
    expect(see).toHaveBeenCalledWith(iso(T0 + 9 * H));
  });
});

describe('where focus goes', () => {
  test('after Unfollow, to the first control of the next row', async () => {
    const w = world();
    await show(w);
    await screen.findByText('A settlement is in');
    await userEvent.click(within(rowWith('new posts in')).getByRole('button', { name: /^Unfollow/u }));
    await waitFor(() => expect(screen.queryByText(/new posts in/u)).toBeNull());
    expect(document.activeElement).toBe(within(rowWith('was quoted')).getByRole('link', { name: 'Go to the post' }));
  });

  test('after Unfollow of the last row on the page, to the list', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const { thread } = fake.seed.thread('general', pipe, 'Mine', 'opening', { at: T0 });
    fake.seed.post(thread, spritey, 'a reply', { at: T0 + H });
    fake.signInAs(me);
    renderIn(fake, <LoadedAlerts />, { path: '/alerts' });
    await userEvent.click(await screen.findByRole('button', { name: /^Unfollow/u }));
    await screen.findByText(/Nothing here yet/u);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Your alerts' }));
  });

  test('a failed Older leaves no claim on focus: a later change of rows moves it only to where that change says', async () => {
    const w = world({ mark: null });
    for (let i = 0; i < 40; i++) w.fake.seed.alert(w.me, { kind: 'hint', act: w.opener, character: w.pipe, sub: `h${i}`, at: T0 + 100 * H + i * MIN });
    await show(w);
    await screen.findByRole('button', { name: 'Older' });
    vi.spyOn(w.fake, 'alerts').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await screen.findByRole('alert');
    const before = document.activeElement;
    expect(rows()).toHaveLength(ALERTS_PAGE);
    // The followed row is on the second page, so the page that reads again brings new rows; focus goes to the first of them, once.
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(ALERTS_PAGE));
    expect(document.activeElement).toBe(rows()[ALERTS_PAGE]);
    expect(before).not.toBe(rows()[ALERTS_PAGE]);
  });

  test('on Older, to the first row that was loaded', async () => {
    const w = world({ mark: null });
    for (let i = 0; i < 40; i++) w.fake.seed.alert(w.me, { kind: 'hint', act: w.opener, character: w.pipe, sub: `h${i}`, at: T0 + 100 * H + i * MIN });
    await show(w);
    await screen.findByRole('button', { name: 'Older' });
    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(ALERTS_PAGE));
    expect(document.activeElement).toBe(rows()[ALERTS_PAGE]);
    expect(rows()[ALERTS_PAGE]).toHaveAttribute('tabindex', '-1');
  });
});

describe('the states', () => {
  test('with nothing yet it says so and what fills the page', async () => {
    const fake = buildWorld();
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <LoadedAlerts />, { path: '/alerts' });
    expect(await screen.findByText(/Nothing here yet/u)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
  });

  test('a read that fails is the glass\'s, and Try again reads the document again', async () => {
    const w = world();
    vi.spyOn(w.fake, 'alertsPage').mockRejectedValueOnce(new Error('offline'));
    await show(w);
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('A settlement is in')).toBeInTheDocument();
  });

  test('a visitor is asked to sign in', async () => {
    const fake: Fake = buildWorld();
    renderIn(fake, <LoadedAlerts />, { path: '/alerts' });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
