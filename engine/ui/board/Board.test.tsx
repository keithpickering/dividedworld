import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createFake, type Fake } from '../data/fake.ts';
import type { ThreadSummary } from '../data/api.ts';
import { buildWorld, holdReads, renderIn, renderInWorld } from '../test-world.tsx';
import { SIGNED_OUT_DOC } from '../screen-docs.ts';
import { useLocation } from '../router.tsx';
import { BoardScreen, ClosedBoard } from './Board.tsx';
import { Frame } from '../frame/Frame.tsx';
import { seedMoves } from './move-world.ts';
import { testInstance } from '../test-world.tsx';
import { LoadedBoard } from '../loaded.tsx';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12);

/** Two players: the visitor (signed in, with Pipewrench) and another (Spritey), and a thread of Spritey's with some replies. */
function world(fake: Fake, options: { readonly threads?: number; readonly signedIn?: boolean; readonly characters?: boolean } = {}) {
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const mine = options.characters === false ? null : fake.seed.character(me, 'Pipewrench', 'heel', { at: T0 });
  const spritey = fake.seed.character(other, 'Spritey', 'face', { at: T0 });
  const ids: string[] = [];
  for (let i = 0; i < (options.threads ?? 1); i++) {
    ids.push(fake.seed.thread('general', spritey, `Thread ${String(i + 1).padStart(3, '0')}`, 'first', { at: T0 + i * 60_000 }).thread);
  }
  if (options.signedIn !== false) fake.signInAs(me);
  return { me, other, mine, spritey, ids };
}

/** Spritey replies `n` times to a thread, an hour apart from `at`. */
function replies(fake: Fake, thread: string, by: string, n: number, at = T0 + 3 * DAY) {
  for (let i = 0; i < n; i++) fake.seed.post(thread, by, `reply ${i + 1}`, { at: at + i * 3_600_000 });
}

function Switch() {
  const { path } = useLocation();
  return <LoadedBoard slug={path.split('/').pop()!} />;
}

/** The new-thread form is a disclosure: the button opens it in place. */
async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'Start a thread' }));
  return screen.findByRole('form', { name: 'Start a thread' });
}
const rowOf = (title: string) => screen.getByRole('link', { name: title }).closest('tr')!;

beforeEach(() => localStorage.clear());

describe('NEW comes from the player\'s own reading rows', () => {
  test('a reading row behind the last post marks the thread NEW and links to the first unread post', async () => {
    const { seeded, fake } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 4); return w; },
    });
    fake.markRead(seeded.ids[0]!, 2, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).getByText(/^New\b/)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=1#post-3`);
  });

  test('no NEW when the player has read to the last post', async () => {
    const { seeded, fake } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 2); return w; },
    });
    fake.markRead(seeded.ids[0]!, 3, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).getByText('No new posts')).toBeInTheDocument();
    expect(within(row).queryByText('New')).toBeNull();
    expect(within(row).queryByRole('link', { name: /^First unread post in / })).toBeNull();
  });

  test('first unread is on the page that holds the post', async () => {
    const { seeded, fake } = renderInWorld(<LoadedBoard slug="general" />, {
      settings: { postsPerPage: 2 },
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 6); return w; },
    });
    fake.markRead(seeded.ids[0]!, 4, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(rowOf('Thread 001')).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=3#post-5`);
  });

  test('a thread the player has never read is NEW from its first post', async () => {
    const { seeded } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).getByText('New')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=1#post-1`);
  });

  test('a thread is never marked as the player\'s own', async () => {
    renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f); f.seed.thread('general', w.mine, 'Plain thread', 'x', { at: T0 + 5 * DAY }); return w; },
    });
    await screen.findByRole('link', { name: 'Plain thread' });
    expect(rowOf('Plain thread')).not.toHaveTextContent(/\byou\b|\byours\b|\bmine\b/i);
  });
});

describe('the folder icons and the legend', () => {
  test('a row that is new and hot draws one folder with the flame and one name, and the NEW and HOT chips are gone', async () => {
    renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 3, f.clock.now() - 2 * DAY); return w; },
    });
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).getByText('New, hot')).toBeInTheDocument();
    const svgs = row.querySelectorAll('.kb-thread-flags svg');
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(svgs[0]).toHaveAttribute('width', '24');
    expect(svgs[0]).toHaveAttribute('height', '20');
    expect(svgs[0]).toHaveAttribute('viewBox', '0 0 24 20');
    expect(svgs[0]!.querySelector('.hot')).not.toBeNull();
    expect(row.querySelector('.kb-flag')).toBeNull();
  });

  test('a read, quiet thread is the empty folder named "No new posts", and a hot read one is named "Hot"', async () => {
    const { fake, seeded } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f, { threads: 2 }); replies(f, w.ids[1]!, w.spritey, 3, f.clock.now() - 2 * DAY); return w; },
    });
    fake.markRead(seeded.ids[0]!, 1, null);
    fake.markRead(seeded.ids[1]!, 4, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(rowOf('Thread 001')).getByText('No new posts')).toBeInTheDocument();
    expect(rowOf('Thread 001').querySelector('svg .paper')).toBeNull();
    expect(within(rowOf('Thread 002')).getByText('Hot')).toBeInTheDocument();
  });

  test('the legend is one row under the list, and its Hot number is the setting', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { settings: { hotReplies: 7 }, seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    const legend = document.querySelector('.kb-thread-legend') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(legend).toHaveTextContent('New posts');
    expect(legend).toHaveTextContent('No new posts');
    expect(legend).toHaveTextContent('Hot: 7 replies this week');
    expect(legend.querySelectorAll('svg')).toHaveLength(3);
  });

  test('the legend says "1 reply" in the singular when the setting is 1', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { settings: { hotReplies: 1 }, seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    const legend = document.querySelector('.kb-thread-legend') as HTMLElement;
    expect(legend).toHaveTextContent('Hot: 1 reply this week');
    expect(legend).not.toHaveTextContent('1 replies');
  });

  test('Start a thread carries its icon, aria-hidden, and its name is unchanged', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    const button = await screen.findByRole('button', { name: 'Start a thread', expanded: false });
    const icons = button.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    expect(button.textContent).toBe('Start a thread');
  });

  test('the legend names no card and no pin', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect((document.querySelector('.kb-thread-legend') as HTMLElement).textContent).not.toMatch(/pin|card/i);
  });
});

describe('the row', () => {
  test('HOT at the instance\'s replies-this-week setting, replies, hourly views and the spin', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 4 });
    const old = fake.clock.now() - 10 * DAY;
    const lately = fake.clock.now() - 2 * DAY;
    replies(fake, w.ids[3]!, w.spritey, 5, old); /* plenty, but older than seven days */
    replies(fake, w.ids[2]!, w.spritey, 2, lately); /* one short of hotReplies (3) */
    replies(fake, w.ids[1]!, w.spritey, 3, lately);
    fake.seed.views(w.ids[1]!, 44);
    const origin = fake.seed.post(w.ids[0]!, w.spritey, 'a line to spin from', { at: T0 + 2 * DAY });
    const spun = await fake.spin(origin, w.mine!, 'Spun thread', 'x');
    expect(spun.ok).toBe(true);
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'Thread 002' });
    const hot = rowOf('Thread 002');
    expect(within(hot).getByText('New, hot')).toBeInTheDocument();
    expect(hot.querySelector('svg .hot')).not.toBeNull();
    expect(hot).toHaveTextContent('44');
    expect(within(hot).getByText('3', { selector: '.kb-thread-replies .kb-num' })).toBeInTheDocument();
    expect(rowOf('Thread 001').querySelector('svg .hot')).toBeNull();
    expect(rowOf('Thread 003').querySelector('svg .hot')).toBeNull();
    expect(rowOf('Thread 004').querySelector('svg .hot')).toBeNull();
    const row = rowOf('Spun thread');
    expect(row).toHaveTextContent('spun from');
    expect(within(row).getByRole('link', { name: /Thread 001/ })).toHaveAttribute('href', `/t/${w.ids[0]}?page=1#post-2`);
  });

  test('a thread spun from a play on a post says so, and links to that post; one spun from an update links to the Updates page', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 1 });
    const target = fake.seed.post(w.ids[0]!, w.spritey, 'a line to play on', { at: T0 + 2 * DAY });
    const played = fake.seed.card(w.spritey, target, 'whoops');
    expect((await fake.spin(played, w.mine!, 'From a play', 'x')).ok).toBe(true);
    const update = fake.seed.update({ title: 'Traps bite', body: 'Hi.' });
    expect((await fake.spin(update, w.mine!, 'From an update', 'x')).ok).toBe(true);
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'From a play' });
    const play = rowOf('From a play');
    expect(play).toHaveTextContent(/spun from Whoops! on #2 in Thread 001/u);
    expect(within(play).getByRole('link', { name: /^Whoops! on #2 in Thread 001$/u })).toHaveAttribute('href', `/t/${w.ids[0]}?page=1#post-2`);
    const upd = rowOf('From an update');
    expect(within(upd).getByRole('link', { name: 'the update “Traps bite”' })).toHaveAttribute('href', `/updates?update=${encodeURIComponent(update)}`);
  });

  /* A row's origin place, replaced in what the board reads: the fake always places what it can, so the unplaceable cases are made here. */
  function withOrigin(fake: Fake, title: string, origin: ThreadSummary['origin']) {
    const real = fake.boardPage.bind(fake);
    vi.spyOn(fake, 'boardPage').mockImplementation(async (...args) => {
      const got = await real(...args);
      return got && { ...got, threads: got.threads.map((t) => (t.title === title ? { ...t, origin } : t)) };
    });
  }

  test('a play on a target that cannot be placed says what was played, with no link', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 1 });
    const target = fake.seed.post(w.ids[0]!, w.spritey, 'a line to play on', { at: T0 + 2 * DAY });
    expect((await fake.spin(fake.seed.card(w.spritey, target, 'whoops'), w.mine!, 'From a play', 'x')).ok).toBe(true);
    withOrigin(fake, 'From a play', { kind: 'play', card: 'whoops', on: null });
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'From a play' });
    const row = rowOf('From a play');
    const spun = row.querySelector('.kb-thread-spun') as HTMLElement;
    expect(spun).toHaveTextContent(/spun from Whoops!$/u);
    expect(within(spun).queryByRole('link')).toBeNull();
  });

  test('a row with an origin Act but no place reads "spun from an Act"', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 1 });
    const origin = fake.seed.post(w.ids[0]!, w.spritey, 'a line to spin from', { at: T0 + 2 * DAY });
    expect((await fake.spin(origin, w.mine!, 'Placeless', 'x')).ok).toBe(true);
    withOrigin(fake, 'Placeless', null);
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'Placeless' });
    const spun = rowOf('Placeless').querySelector('.kb-thread-spun') as HTMLElement;
    expect(spun).toHaveTextContent(/spun from an Act$/u);
    expect(within(spun).queryByRole('link')).toBeNull();
  });

  test('replies count the posts after the first: a thread whose last Act is not a post counts only its posts', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 2 });
    replies(fake, w.ids[0]!, w.spritey, 2);
    fake.seed.reveal(w.spritey, w.ids[0]!); /* its last Act, which is no reply */
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(rowOf('Thread 001')).getByText('2', { selector: '.kb-thread-replies .kb-num' })).toBeInTheDocument();
    expect(within(rowOf('Thread 002')).getByText('0', { selector: '.kb-thread-replies .kb-num' })).toBeInTheDocument();
  });

  test('"started by" and "last post" name their characters, with the last post linked to its page', async () => {
    const { seeded } = renderInWorld(<LoadedBoard slug="general" />, {
      settings: { postsPerPage: 2 },
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.mine!, 4); return w; },
    });
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(row).toHaveTextContent('Spritey');
    expect(within(row).getByRole('link', { name: 'Pipewrench' })).toHaveAttribute('href', `/c/${seeded.mine}`);
    expect(within(row).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${seeded.spritey}`);
    expect(row.querySelectorAll('.kb-thread-started .kb-mini[aria-hidden="true"]')).toHaveLength(1);
    expect(within(row.querySelector('.kb-thread-started')! as HTMLElement).getByRole('link')).toHaveAttribute('href', `/c/${seeded.spritey}`);
    expect(within(row.querySelector('.kb-thread-last')! as HTMLElement).getAllByRole('link')[0]).toHaveAttribute('href', `/c/${seeded.mine}`);
    /* WCAG 2.5.3: the link's name holds its visible text (the time), then says where it goes. */
    const latest = within(row).getByRole('link', { name: /latest post in Thread 001/u });
    expect(latest).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=3#post-5`);
    expect(latest).not.toHaveAttribute('aria-label');
    expect(latest.getAttribute('href')).toBeTruthy();
    expect(latest.textContent!.startsWith(latest.querySelector('time')!.textContent!)).toBe(true);
    expect(within(latest).getByText(/latest post in Thread 001/u)).toHaveClass('kb-visually-hidden');
    expect(within(row).getByRole('link', { name: 'Page 2 of Thread 001' })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=2`);
  });
});

describe('the staff board', () => {
  test('is read-only: no new-thread form, and a plain note says why', async () => {
    renderInWorld(<LoadedBoard slug="announcements" />, {
      seed: (f) => { const w = world(f); f.seed.thread('announcements', null, 'The Bulletin', 'Tonight.', { at: T0 }); return w; },
    });
    await screen.findByRole('link', { name: 'The Bulletin' });
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByText(/only the staff post here/i)).toBeInTheDocument();
    expect(rowOf('The Bulletin')).toHaveTextContent('The staff');
    /* Unlike the index, the board draws the staff with its "S" avatar, and never as a profile link. */
    const bulletin = rowOf('The Bulletin');
    expect(bulletin.querySelectorAll('.kb-system-name')).toHaveLength(2);
    expect(bulletin.querySelectorAll('.kb-mini-none')[0]).toHaveTextContent('S');
    expect(bulletin.querySelector('a[href^="/c/"]')).toBeNull();
  });

  test('the ordinary board has a "Start a thread" button that opens the form in place, above the list, with focus on the title', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    const button = await screen.findByRole('button', { name: 'Start a thread' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    await userEvent.click(button);
    const form = await screen.findByRole('form', { name: 'Start a thread' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', form.id);
    expect(button).toHaveClass('kb-button'); /* drawn pressed in by base.css's [aria-expanded='true'] while its form is open */
    await waitFor(() => expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveFocus());
    expect(form.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(button);
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('a list of 0, 1 and 200 threads', () => {
  test('none: says so, and the form is there to start one', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    expect(await screen.findByText('No threads here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await openForm();
  });

  test('one: a row and no pager', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 1 }) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  test('two hundred: twenty to a page, newest first, ten pages, and the page in the address', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 200 }) });
    await screen.findByRole('link', { name: 'Thread 200' });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByRole('link', { name: 'Thread 181' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Thread 180' })).toBeNull();
    const pages = screen.getByRole('navigation', { name: 'Pages, top' });
    expect(pages).toHaveTextContent('Page 1 of 10');
    expect(within(pages).getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/b/general?page=2');
  });

  test('turning a page is a navigation: the screen reads nothing, and is handed the next page\'s document, with focus on the board\'s heading', async () => {
    const fake = buildWorld();
    world(fake, { threads: 200 });
    const boot = await fake.boot();
    const docs = { 1: (await fake.boardPage('general', 1, []))!, 2: (await fake.boardPage('general', 2, []))! };
    const read = holdReads(fake, ['session', 'here']);
    /* The router's part: the screen drawn is the one the address names, from the document its load brought. */
    function Route() {
      const { query } = useLocation();
      return <BoardScreen slug="general" doc={query.get('page') === '2' ? docs[2] : docs[1]} />;
    }
    renderIn(fake, <Route />, { path: '/b/general', boot });
    expect(screen.getByRole('link', { name: 'Thread 200' })).toBeInTheDocument();
    const next = within(screen.getByRole('navigation', { name: 'Pages, top' })).getByRole('link', { name: 'Next' });
    next.focus();
    await userEvent.click(next);
    expect(window.location.search).toBe('?page=2');
    expect(screen.getByRole('link', { name: 'Thread 180' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Thread 200' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(read).toEqual([]);
  });

  test('page 3 of the same list', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { path: '/b/general?page=3', seed: (f) => world(f, { threads: 200 }) });
    await screen.findByRole('link', { name: 'Thread 160' });
    expect(screen.getByRole('link', { name: 'Thread 141' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages, top' })).toHaveTextContent('Page 3 of 10');
  });

  test('a page past the end shows the last page', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { path: '/b/general?page=99', seed: (f) => world(f, { threads: 41 }) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(screen.getByRole('navigation', { name: 'Pages, top' })).toHaveTextContent('Page 3 of 3');
  });
});

describe('what a page of a board reads', () => {
  test('one boardPage read, and none of the board, the list of threads or the list of boards', async () => {
    let spies: Record<'boardPage' | 'boards' | 'board' | 'threads', { readonly mock: { readonly calls: readonly unknown[][] } }> | null = null;
    renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => {
        world(f, { threads: 3 });
        spies = { boardPage: vi.spyOn(f, 'boardPage'), boards: vi.spyOn(f, 'boards'), board: vi.spyOn(f, 'board'), threads: vi.spyOn(f, 'threads') };
      },
    });
    await screen.findByRole('heading', { level: 1, name: /General/u });
    expect(spies!.boardPage.mock.calls).toHaveLength(1);
    expect(spies!.boardPage.mock.calls[0]!.slice(0, 2)).toEqual(['general', 1]);
    expect(spies!.board.mock.calls).toHaveLength(0);
    expect(spies!.threads.mock.calls).toHaveLength(0);
    expect(spies!.boards.mock.calls).toHaveLength(0);
  });

  test('its whole page is in the first render, from the document, and nothing is read for it', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 3 });
    replies(fake, w.ids[0]!, w.spritey, 2);
    fake.signInAs(w.other);
    const board = (await fake.boards()).find((b) => b.slug === 'general')!;
    await fake.here({ kind: 'board', board: board.id }, w.spritey);
    fake.signInAs(w.me);
    const boot = await fake.boot();
    const doc = (await fake.boardPage('general', 1, []))!;
    const read = holdReads(fake, ['session', 'here']);
    renderIn(fake, <BoardScreen slug="general" doc={doc} />, { path: '/b/general', boot });
    const row = rowOf('Thread 001');
    expect(within(row).getByText('2', { selector: '.kb-num' })).toBeInTheDocument();
    expect(row).toHaveTextContent('Spritey');
    expect(screen.getByRole('heading', { level: 1, name: /General/u })).toBeInTheDocument();
    /* The box of who is browsing the board: the snapshot, with the reader's mask added. */
    const box = screen.getByRole('region', { name: 'Users browsing this board' });
    expect(within(box).getAllByRole('link').map((a) => a.textContent)).toEqual(['Spritey', 'Pipewrench']);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(read).toEqual([]);
  });

  test('signed out, the loader\'s marker is the front door, with no read', () => {
    const fake = buildWorld();
    const read = holdReads(fake, ['session']);
    renderIn(fake, <BoardScreen slug="general" doc={SIGNED_OUT_DOC} />);
    expect(screen.getByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(read).toEqual([]);
  });
});

describe('the new-thread form', () => {
  test('posts as the HUD\'s character and goes to the new thread', async () => {
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'Title' }), 'A fresh start');
    await userEvent.type(within(form).getByRole('textbox', { name: 'First post' }), 'Hello.');
    await userEvent.click(within(form).getByRole('button', { name: 'Start thread' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/t\//));
    const board = (await fake.boards()).find((b) => b.slug === 'general')!;
    const listed = (await fake.threads(board.id, { offset: 0, limit: 10 })).threads;
    expect(listed.map((t) => t.title)).toEqual(['A fresh start']);
    expect(window.location.pathname).toBe(`/t/${listed[0]!.id}`);
    expect(window.location.href).not.toContain(listed[0]!.firstCharacter ?? 'never');
  });

  test('sends the characters its first post\'s counterfeit quotes name as framing', async () => {
    let spritey = '';
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => { const w = world(f, { threads: 0 }); spritey = w.spritey; return w; } });
    const started = vi.spyOn(fake, 'startThread');
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'Title' }), 'Framed');
    await userEvent.click(within(form).getByRole('textbox', { name: 'First post' }));
    await userEvent.paste(`[quote=Spritey user=${spritey}]Nope.[/quote]`);
    await userEvent.click(within(form).getByRole('button', { name: 'Start thread' }));
    await waitFor(() => expect(started).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'Framed', expect.stringContaining('Nope.'), [spritey]));
  });

  test('the first post is the shared editor: the toolbar, a Preview drawn by the post\'s renderer, the count, and the hint', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    expect(within(form).getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    expect(within(form).getByText(/^0 of \d+$/u)).toBeInTheDocument();
    expect(within(form).getByText('Ctrl+Enter or Command+Enter starts it')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('textbox', { name: 'First post' }));
    await userEvent.paste('Hello [b]there[/b]');
    await userEvent.click(within(form).getByRole('button', { name: 'Preview' }));
    const preview = within(form).getByRole('region', { name: 'Preview' });
    expect(preview.querySelector('strong, b')?.textContent).toBe('there');
    expect(within(form).queryAllByRole('button').filter((b) => b.hasAttribute('data-kb-primary'))).toHaveLength(1);
  });

  test.each([['Control', '{Control>}{Enter}{/Control}'], ['Meta', '{Meta>}{Enter}{/Meta}']])('%s+Enter in the first post starts the thread', async (_name, keys) => {
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'Title' }), 'By keyboard');
    await userEvent.type(within(form).getByRole('textbox', { name: 'First post' }), 'Hello.');
    await userEvent.keyboard(keys);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/t\//));
    const board = (await fake.boards()).find((b) => b.slug === 'general')!;
    expect((await fake.threads(board.id, { offset: 0, limit: 10 })).threads.map((t) => t.title)).toEqual(['By keyboard']);
  });

  test('the form opens under a light band that names it, says who posts, and draws its boxes inset', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    expect(within(form).getByRole('heading', { name: 'Start a thread' })).toHaveClass('kb-box-head');
    expect(form).toHaveClass('kb-form');
    expect(within(form).getByText(/Posting as/u).textContent).toBe('Posting as Pipewrench');
  });

  test('a refusal shows the server\'s words and keeps the draft', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'First post' }), 'Body without a title');
    await userEvent.click(within(form).getByRole('button', { name: 'Start thread' }));
    const notice = await within(form).findByRole('alert');
    expect(notice).toHaveAttribute('data-kb-tone', 'refusal');
    expect(notice.textContent).toBeTruthy();
    expect(within(form).getByRole('textbox', { name: 'First post' })).toHaveValue('Body without a title');
  });

  test('clicking the visible "First post" label puts the cursor in the box', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.click(within(form).getByText('First post', { selector: 'label' }));
    expect(within(form).getByRole('textbox', { name: 'First post' })).toHaveFocus();
  });

  test('a body over the limit does not post on Ctrl+Enter', async () => {
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const sent = vi.spyOn(fake, 'startThread');
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'Title' }), 'Too long');
    await userEvent.click(within(form).getByRole('textbox', { name: 'First post' }));
    await userEvent.paste('x'.repeat(201));
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(sent).not.toHaveBeenCalled();
    expect(window.location.pathname).not.toMatch(/^\/t\//);
  });

  test('Ctrl+Enter with an empty title shows the server\'s refusal as an alert', async () => {
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const sent = vi.spyOn(fake, 'startThread');
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'First post' }), 'Body without a title');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    const notice = await within(form).findByRole('alert');
    expect(sent).toHaveBeenCalledTimes(1);
    expect(notice.textContent).toBeTruthy();
    expect(within(form).getByRole('textbox', { name: 'First post' })).toHaveValue('Body without a title');
  });

  test('Ctrl+Enter twice during a pending request posts once', async () => {
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    const real = fake.startThread.bind(fake);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const sent = vi.spyOn(fake, 'startThread').mockImplementation(async (...args) => { await gate; return real(...args); });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'Title' }), 'Once only');
    await userEvent.type(within(form).getByRole('textbox', { name: 'First post' }), 'Hello.');
    await userEvent.keyboard('{Control>}{Enter}{Enter}{/Control}');
    expect(sent).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/t\//));
    const board = (await fake.boards()).find((b) => b.slug === 'general')!;
    expect((await fake.threads(board.id, { offset: 0, limit: 10 })).threads).toHaveLength(1);
  });

  test('when the player\'s characters could not be read, it says so and offers Try again, then shows the form when they come', async () => {
    const { seeded } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => { world(f); return vi.spyOn(f, 'myCharacters').mockRejectedValue(new Error('down')); } });
    const form = await openForm();
    expect(await within(form).findByText('Your characters couldn\'t be loaded.')).toBeInTheDocument();
    expect(within(form).queryByRole('link', { name: 'Make a character' })).toBeNull();
    seeded.mockRestore();
    await userEvent.click(within(form).getByRole('button', { name: 'Try again' }));
    expect(await within(form).findByRole('button', { name: 'Start thread' })).toBeInTheDocument();
  });

  test('with no character that can act, it says so and links to making one', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { characters: false }) });
    const form = await openForm();
    expect(within(form).queryByRole('button', { name: 'Start thread' })).toBeNull();
    expect(within(form).getByRole('link', { name: 'Make a character' })).toHaveAttribute('href', '/characters/new');
  });
});

describe('a signed-out visitor', () => {
  test('sees the front door, and no threads, NEW or form', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { signedIn: false }) });
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByText(/The board is for players\./u)).toBeNull();
    expect(screen.queryByText('New')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a board that is not there', () => {
  test('is the router\'s "cannot be found" (no document), which links back to the index', async () => {
    renderInWorld(<LoadedBoard slug="nowhere" />, { seed: (f) => world(f), path: '/b/nowhere' });
    expect(await screen.findByRole('heading', { level: 1, name: 'The board you requested does not exist.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Click here to return to the index' })).toHaveAttribute('href', '/');
  });
});

describe('moving between boards', () => {
  test('the old rows and the draft do not follow the player to the other board', async () => {
    renderInWorld(<Switch />, { path: '/b/general', seed: (f) => { const w = world(f); f.seed.thread('off-topic', w.spritey, 'Elsewhere thread', 'x', { at: T0 }); return w; } });
    const form = await openForm();
    await waitFor(() => expect(within(form).getByText('Pipewrench')).toBeInTheDocument());
    await userEvent.type(within(form).getByRole('textbox', { name: 'Title' }), 'Draft for general');
    act(() => { window.history.pushState(null, '', '/b/off-topic'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.queryByRole('link', { name: 'Thread 001' })).toBeNull();
    await screen.findByRole('link', { name: 'Elsewhere thread' });
    const next = await openForm();
    await waitFor(() => expect(within(next).getByText('Pipewrench')).toBeInTheDocument());
    expect(within(next).getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });
});

describe('accessible names', () => {
  test('the pagers are told apart, and the views column says what it counts in text', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f, { threads: 41 }) });
    await screen.findByRole('link', { name: 'Thread 041' });
    expect(screen.getByRole('navigation', { name: 'Pages, top' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages, bottom' })).toBeInTheDocument();
    const views = screen.getByRole('columnheader', { name: /Views/ });
    expect(views).toHaveTextContent('Characters that have read it, counted hourly');
  });

  test('the table keeps its roles where the phone layout drops the native ones', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('role', 'table');
    expect(within(table).getAllByRole('row')[1]).toHaveAttribute('role', 'row');
    expect(within(table).getAllByRole('cell').length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('cell')[0]).toHaveAttribute('role', 'cell');
  });
});

describe('a move in force on the board', () => {
  const withMoves = (fake: Fake) => seedMoves(fake, testInstance);

  test('the board reads its name and description from the move in force, and shows the notice under the description', async () => {
    const { seeded } = renderInWorld(<LoadedBoard slug="general" />, { seed: withMoves });
    expect(await screen.findByRole('heading', { level: 1, name: 'Pointless Toast Palace' })).toBeInTheDocument();
    expect(screen.getByText('Welcome to the Pointless Toast Palace. Please butter responsibly.')).toBeInTheDocument();
    const notice = await screen.findByRole('table', { name: 'Announcement from The Director' });
    expect(screen.getByText('The Boss renamed this board')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^WAY OUT: 5 OF 12 POSTERS/u })).toBeInTheDocument();
    expect(within(notice).getByRole('list', { name: 'Reactions' }).querySelectorAll('li')).toHaveLength(3);
    expect(seeded.inForce).toBeTruthy();
  });

  test('a board whose moves have all ended has its own name back and no notice', async () => {
    renderInWorld(<LoadedBoard slug="off-topic" />, { seed: withMoves });
    expect(await screen.findByRole('heading', { level: 1, name: 'Off Topic' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /^Announcement from/u })).toBeNull();
  });

  test('the old name returns the moment the move ends, and the notice goes with it', async () => {
    const fake = buildWorld();
    const w = withMoves(fake);
    fake.seed.endMove(w.inForce, { why: 'reversed', by: 'admin' });
    renderIn(fake, <LoadedBoard slug="general" />, { path: '/b/general' });
    expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /^Announcement from/u })).toBeNull();
  });
});

describe('who is browsing', () => {
  test('under the thread list, "Users browsing this board" lists a mask on one of its threads', async () => {
    const { seeded, fake } = renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    fake.signInAs(seeded.other);
    await fake.here({ kind: 'thread', thread: seeded.ids[0]! }, seeded.spritey);
    fake.signInAs(seeded.me);
    const box = await screen.findByRole('region', { name: 'Users browsing this board' });
    await within(box).findByRole('link', { name: 'Spritey' });
    expect(await within(box).findByRole('link', { name: 'Pipewrench' })).toBeInTheDocument();
  });
});

/* Main Event's kind (docs/plans/2026-11-01-card-reach-plan.md, Task 5): a thread with a live play of a card that pins is drawn above
   page 1's threads, with its mark, without taking a page's slots or moving the pager; it goes when the play ends. A board's own live
   board card is a mark on its banner. The cards are the engine's test cards. */
describe('pinned threads and the banner', () => {
  /* The first render of a file parses the house CSS, which takes a few seconds under jsdom. */
  vi.setConfig({ testTimeout: 20_000 });
  const pinning = {
    key: 'beacon', name: 'Beacon', alignment: 'sweet' as const, rarity: 'rare' as const, reaches: ['thread' as const], lasts: { unit: 'day' as const, count: 1 }, pins: true as const,
    playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }),
  };
  const rumble = { ...pinning, key: 'rumble', name: 'Rumble', rarity: 'legendary' as const, reaches: ['board' as const], pins: undefined };
  const instance = { ...testInstance, cards: [...testInstance.cards, pinning, rumble] };
  const pinned = () => document.querySelector('[data-kb-pinned]') as HTMLElement | null;

  async function open(o: { readonly page?: number; readonly ends?: number; readonly alsoPin?: number } = {}) {
    const fake = createFake({ instance, now: () => Date.now() });
    const w = world(fake, { threads: 25 });
    /* Thread 003 is far down page 1, and Thread 001 on page 2: each is pinned all the same. */
    const pin = fake.seed.reach(w.spritey, 'thread', w.ids[0]!, 'beacon', { ends: o.ends ?? Date.now() + DAY, message: 'Look here.' });
    if (o.alsoPin !== undefined) fake.seed.reach(w.spritey, 'thread', w.ids[o.alsoPin]!, 'beacon', { ends: Date.now() + DAY });
    const board = (await fake.board('general'))!.id;
    const banner = fake.seed.reach(w.spritey, 'board', board, 'rumble', { ends: Date.now() + DAY });
    renderIn(fake, <LoadedBoard slug="general" />, { instance, path: `/b/general${o.page ? `?page=${o.page}` : ''}` });
    await screen.findByRole('link', { name: o.page === 2 ? 'Thread 005' : 'Thread 025' });
    return { fake, w, pin, banner };
  }

  test('a pin is drawn above page 1, with its mark, and not above page 2', async () => {
    await open();
    await waitFor(() => expect(pinned()).not.toBeNull());
    expect(within(pinned()!).getByRole('link', { name: 'Thread 001' })).toBeInTheDocument();
    expect(within(pinned()!).getByRole('button', { name: /^Beacon, 1 play\b.*Opens the cards on this thread\./u })).toBeInTheDocument();
    /* It takes none of page 1's twenty slots: Thread 006 to 025 are all still there. */
    const list = document.querySelector('.kb-thread-list tbody:not([data-kb-pinned])') as HTMLElement;
    expect(within(list).getAllByRole('row')).toHaveLength(20);
    expect(screen.getAllByText('Page 1 of 2').length).toBeGreaterThan(0);
  });

  test('the 4px gap under the pins is a presentation row, hidden from the reading order, and absent with no pins', async () => {
    await open();
    await waitFor(() => expect(pinned()).not.toBeNull());
    const gap = pinned()!.querySelector('tr.kb-thread-gap') as HTMLElement;
    expect(gap).not.toBeNull();
    expect(gap).toHaveAttribute('role', 'presentation');
    expect(gap).toHaveAttribute('aria-hidden', 'true');
    expect(within(pinned()!).getAllByRole('row')).toHaveLength(1);
  });

  test('with no pins there is no gap row', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(document.querySelector('.kb-thread-gap')).toBeNull();
  });

  test('the pager\'s total is unchanged, and page 2 shows no pin, its own thread in its bump place', async () => {
    await open({ page: 2 });
    expect(screen.getAllByText('Page 2 of 2').length).toBeGreaterThan(0);
    expect(within(rowOf('Thread 001')).getByRole('link', { name: 'Thread 001' })).toBeInTheDocument();
    expect(pinned()).toBeNull();
  });

  test('a pinned thread page 1 already holds is moved up, never listed twice', async () => {
    await open({ alsoPin: 9 });
    await waitFor(() => expect(within(pinned()!).getAllByRole('row')).toHaveLength(2));
    expect(screen.getAllByRole('link', { name: 'Thread 010' })).toHaveLength(1);
    expect(within(pinned()!).getByRole('link', { name: 'Thread 010' })).toBeInTheDocument();
  });

  test('an ended pin is gone, by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await open({ ends: Date.now() + 30_000 });
      await waitFor(() => expect(pinned()).not.toBeNull());
      await act(() => vi.advanceTimersByTimeAsync(31_000));
      await waitFor(() => expect(pinned()).toBeNull());
    } finally { vi.useRealTimers(); }
  });

  /* An admin's end (supabase/migrations/0092_card_end.sql) is announced on `reach` alone (a thread's pin and the board's card are played beyond
     the board's own topic), so only the board's reach listener can take either off the page it is open on. */
  test('a pin an admin ends is unpinned live, its thread kept in its bump place', async () => {
    const { fake, w, pin } = await open();
    await waitFor(() => expect(pinned()).not.toBeNull());
    fake.seed.admin(w.me);
    expect((await fake.reverseCard(pin)).ok).toBe(true);
    await waitFor(() => expect(pinned()).toBeNull());
  });

  test('a board card an admin ends leaves the banner live, and the pin beside it stays', async () => {
    const { fake, w, banner } = await open();
    const rumbleMark = () => document.querySelector('.kb-board-banner')!.querySelector('button[aria-label^="Rumble, 1 play"]');
    await waitFor(() => expect(rumbleMark()).not.toBeNull());
    fake.seed.admin(w.me);
    expect((await fake.reverseCard(banner)).ok).toBe(true);
    await waitFor(() => expect(rumbleMark()).toBeNull());
    expect(pinned()).not.toBeNull();
  });

  test('a board card armed puts its ghost on the banner, and focus goes back to the board\'s title after the play', async () => {
    const fake = createFake({ instance, now: () => Date.now() });
    const w = world(fake, { threads: 2 });
    fake.seed.cards(w.me, { rumble: 1 });
    fake.seed.wallet(w.me, 500);
    renderIn(fake, <Frame><LoadedBoard slug="general" /></Frame>, { instance, path: '/b/general' });
    await screen.findByRole('link', { name: 'Thread 002' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
    await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getAllByRole('button', { name: /^Rumble, /u })[0]!);
    const banner = document.querySelector('.kb-board-banner') as HTMLElement;
    await user.click(await within(banner).findByRole('button', { name: 'Play Rumble on General' }));
    const dialog = await screen.findByRole('dialog', { name: /Rumble/u });
    await user.click(within(dialog).getByRole('button', { name: /^Play as / }));
    expect(await within(banner).findByRole('button', { name: /^Rumble, 1 play\b/u })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(banner.querySelector('h1')));
  });

  test('a board card played while the page is open is drawn on the banner, heard on reach', async () => {
    const fake = createFake({ instance, now: () => Date.now() });
    const heard = vi.spyOn(fake, 'subscribeReach');
    const w = world(fake, { threads: 2 });
    renderIn(fake, <LoadedBoard slug="general" />, { instance, path: '/b/general' });
    await screen.findByRole('link', { name: 'Thread 002' });
    /* The page listens from an effect, which can run after the list is on screen: a play sent before it would be heard by no one. */
    await waitFor(() => expect(heard).toHaveBeenCalled());
    const banner = document.querySelector('.kb-board-banner') as HTMLElement;
    expect(within(banner).queryByRole('button', { name: /^Rumble, 1 play\b/u })).toBeNull();
    const board = (await fake.board('general'))!.id;
    /* Another player's play: on the announcements thread's topic, which this page is not on. */
    fake.seed.reach(w.spritey, 'board', board, 'rumble', { ends: Date.now() + DAY, live: true });
    expect(await within(banner).findByRole('button', { name: /^Rumble, 1 play\b/u })).toBeInTheDocument();
  });

  test('a board card on another board is not drawn on this banner', async () => {
    const fake = createFake({ instance, now: () => Date.now() });
    const heard = vi.spyOn(fake, 'subscribeReach');
    const w = world(fake, { threads: 2 });
    renderIn(fake, <LoadedBoard slug="general" />, { instance, path: '/b/general' });
    await screen.findByRole('link', { name: 'Thread 002' });
    /* The page listens from an effect, which can run after the list is on screen: a play sent before it would be heard by no one. */
    await waitFor(() => expect(heard).toHaveBeenCalled());
    const banner = document.querySelector('.kb-board-banner') as HTMLElement;
    fake.seed.reach(w.spritey, 'board', '99999999-9999-4999-8999-999999999999', 'rumble', { ends: Date.now() + DAY, live: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(banner).queryByRole('button', { name: /^Rumble, \d play/u })).toBeNull();
  });

  test('the board\'s live board card is a mark on its banner', async () => {
    await open();
    const banner = document.querySelector('.kb-board-banner') as HTMLElement;
    expect(await within(banner).findByRole('button', { name: /^Rumble, 1 play\b.*Opens the cards on this board\./u })).toBeInTheDocument();
  });
});

describe('a thread that moved away leaves a stub, and a closed board says where its threads went', () => {
  test('a stub row reads "Moved: <title>", links to the thread, and says the board it is on now; it sits below the board\'s own threads', async () => {
    const { seeded } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f, { threads: 2 }); f.seed.moveThread(w.ids[0]!, 'off-topic', { at: f.clock.now() - 2 * DAY }); return w; },
    });
    const stub = await screen.findByRole('link', { name: 'Moved: Thread 001' });
    expect(stub).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=1`);
    const row = stub.closest('tr')!;
    expect(within(row).getByRole('link', { name: 'Off Topic' })).toHaveAttribute('href', '/b/off-topic');
    expect(row).toHaveTextContent('now on Off Topic');
    const own = rowOf('Thread 002');
    expect(own.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* The board it is on lists it as its own thread, with no stub. */
    expect(screen.queryByRole('link', { name: 'Thread 001' })).toBeNull();
  });

  test('a board with no move away draws no stub, and a stub row is no thread row: it has no reading folder or counts', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(screen.queryByText(/^Moved:/u)).toBeNull();
  });

  test('a board that only has a stub is not "No threads here yet": the stub is the page', async () => {
    renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f, { threads: 1 }); f.seed.moveThread(w.ids[0]!, 'off-topic', { at: f.clock.now() - DAY }); return w; },
    });
    await screen.findByRole('link', { name: 'Moved: Thread 001' });
  });

  test('a merged board shows one plain line, linked, and no New Thread control and no list', async () => {
    renderInWorld(<LoadedBoard slug="off-topic" />, {
      seed: (f) => { const w = world(f, { threads: 1 }); f.seed.closeBoard('off-topic', { mergedInto: 'general' }); return w; },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Off Topic' })).toBeInTheDocument();
    const line = await screen.findByText(/^This board was merged into /u);
    expect(line).toHaveTextContent('This board was merged into General.');
    expect(within(line).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('No threads here yet.')).toBeNull();
  });

  test('a closed board that was not merged says where its threads are', async () => {
    renderInWorld(<LoadedBoard slug="off-topic" />, {
      seed: (f) => { const w = world(f, { threads: 1 }); f.seed.closeBoard('off-topic', { fallback: 'general' }); return w; },
    });
    const line = await screen.findByText(/^This board was closed\./u);
    expect(line).toHaveTextContent('This board was closed. Its threads are in General.');
    expect(within(line).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
  });

  test('the index lists no closed board, and starting a thread on one is refused in words that name where its threads went', async () => {
    const { fake, seeded } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f); f.seed.closeBoard('off-topic', { mergedInto: 'general' }); return w; },
    });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect((await fake.boards()).map((b) => b.slug)).not.toContain('off-topic');
    const refused = await fake.startThread('off-topic', seeded.mine!, 'Late', 'Hello.');
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).toMatch(/merged into General/u);
  });

  test('a board merged into one that was merged again names both: where it was merged, and the first open board its threads are in', async () => {
    renderInWorld(<LoadedBoard slug="off-topic" />, {
      seed: (f) => { const w = world(f, { threads: 1 }); f.seed.board('third', 'Third'); f.seed.closeBoard('off-topic', { mergedInto: 'third' }); f.seed.closeBoard('third', { mergedInto: 'general' }); return w; },
    });
    const line = await screen.findByText(/^This board was merged into /u);
    expect(line).toHaveTextContent('This board was merged into Third. That board was closed too; its threads are in General.');
    expect(within(line).getByRole('link', { name: 'Third' })).toHaveAttribute('href', '/b/third');
    expect(within(line).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
  });

  test('a closed board with no board to name says where to look, linked to the index, in plain words', async () => {
    const fake = buildWorld();
    const board = { id: 'b1', slug: 'gone', name: 'Gone', description: '', isSystem: false, moveAct: null };
    const { container } = renderIn(fake, <ClosedBoard board={board} closed={{ mergedInto: null, fallback: null, goesTo: null }} />);
    expect(container).toHaveTextContent('This board was closed. Its threads were moved to other boards; look for them on the index.');
    expect(within(container).getByRole('link', { name: 'index' })).toHaveAttribute('href', '/');
  });

  test('a stub is on the first page of a busy board, below its twenty threads, and not on the second', async () => {
    const { fake } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f, { threads: 26 }); f.seed.moveThread(w.ids[0]!, 'off-topic', { at: f.clock.now() - DAY }); return w; },
    });
    await screen.findByRole('link', { name: 'Moved: Thread 001' });
    expect((await fake.boardPage('general', 1, []))!.stubs).toHaveLength(1);
    expect((await fake.boardPage('general', 1, []))!.threads).toHaveLength(20);
    expect((await fake.boardPage('general', 2, []))!.stubs).toHaveLength(0);
  });
});

describe('a thread row\'s units and lines (list-rows plan, Task 1)', () => {
  test('a unit is singular at one: "1 reply", "1 view", "4 replies"', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 2 });
    replies(fake, w.ids[0]!, w.spritey, 1);
    replies(fake, w.ids[1]!, w.spritey, 4);
    fake.seed.views(w.ids[0]!, 1);
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'Thread 001' });
    const one = rowOf('Thread 001');
    expect(one.querySelector('.kb-thread-replies')!.textContent).toBe('1 reply');
    expect(one.querySelector('.kb-thread-views')!.textContent).toMatch(/1 view$/u);
    expect(rowOf('Thread 002').querySelector('.kb-thread-replies')!.textContent).toBe('4 replies');
  });

  test('a spun row\'s "spun from" starts at the arrow, a sibling after the title\'s link', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 1 });
    const origin = fake.seed.post(w.ids[0]!, w.spritey, 'a line to spin from', { at: T0 + 2 * DAY });
    expect((await fake.spin(origin, w.mine!, 'Spun thread', 'x')).ok).toBe(true);
    renderIn(fake, <LoadedBoard slug="general" />);
    await screen.findByRole('link', { name: 'Spun thread' });
    const row = rowOf('Spun thread');
    const spun = row.querySelector('.kb-thread-spun') as HTMLElement;
    expect(spun.textContent!.startsWith('↳')).toBe(true);
    const title = row.querySelector('.kb-thread-title') as HTMLElement;
    expect(spun.parentElement).toBe(title.parentElement);
    expect(title.compareDocumentPosition(spun) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the last cell starts at "last: ", with no leading separator', async () => {
    renderInWorld(<LoadedBoard slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(rowOf('Thread 001').querySelector('.kb-thread-last')!.textContent!.startsWith('last: ')).toBe(true);
  });
});
