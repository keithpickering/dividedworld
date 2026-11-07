import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createFake, type Fake } from '../data/fake.ts';
import type { ThreadSummary } from '../data/api.ts';
import { buildWorld, holdReads, renderIn, renderInWorld } from '../test-world.tsx';
import { SIGNED_OUT_DOC } from '../screen-docs.ts';
import { useLocation } from '../router.tsx';
import { BoardScreen } from './Board.tsx';
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
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=1#post-3`);
  });

  test('no NEW when the player has read to the last post', async () => {
    const { seeded, fake } = renderInWorld(<LoadedBoard slug="general" />, {
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 2); return w; },
    });
    fake.markRead(seeded.ids[0]!, 3, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).queryByText('NEW')).toBeNull();
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
    expect(within(row).getByText('NEW')).toBeInTheDocument();
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
    expect(within(hot).getByText('HOT')).toBeInTheDocument();
    expect(hot).toHaveTextContent('44');
    expect(within(hot).getByText('3', { selector: '.kb-thread-replies .kb-num' })).toBeInTheDocument();
    expect(within(rowOf('Thread 001')).queryByText('HOT')).toBeNull();
    expect(within(rowOf('Thread 003')).queryByText('HOT')).toBeNull();
    expect(within(rowOf('Thread 004')).queryByText('HOT')).toBeNull();
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

describe('The System\'s board', () => {
  test('is read-only: no new-thread form, and a plain note says why', async () => {
    renderInWorld(<LoadedBoard slug="the-system" />, {
      seed: (f) => { const w = world(f); f.seed.thread('the-system', null, 'The Bulletin', 'Tonight.', { at: T0 }); return w; },
    });
    await screen.findByRole('link', { name: 'The Bulletin' });
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByText(/only The System posts here/i)).toBeInTheDocument();
    expect(rowOf('The Bulletin')).toHaveTextContent('The System');
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
    expect(screen.queryByText('NEW')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a board that is not there', () => {
  test('is the router\'s "cannot be found" (no document), which links back to the index', async () => {
    renderInWorld(<LoadedBoard slug="nowhere" />, { seed: (f) => world(f) });
    expect(await screen.findByRole('heading', { level: 1, name: 'The page cannot be found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'index' })).toHaveAttribute('href', '/');
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
    const notice = await screen.findByRole('region', { name: 'Announcement from The Director' });
    expect(notice).toHaveTextContent('THE SYSTEM RENAMED THIS BOARD');
    expect(within(notice).getByRole('button', { name: /^WAY OUT: 5 OF 12 POSTERS/u })).toBeInTheDocument();
    expect(within(notice).getByRole('list', { name: 'Reactions' }).querySelectorAll('li')).toHaveLength(3);
    expect(seeded.inForce).toBeTruthy();
  });

  test('a board whose moves have all ended has its own name back and no notice', async () => {
    renderInWorld(<LoadedBoard slug="off-topic" />, { seed: withMoves });
    expect(await screen.findByRole('heading', { level: 1, name: 'Off Topic' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Announcement from/u })).toBeNull();
  });

  test('the old name returns the moment the move ends, and the notice goes with it', async () => {
    const fake = buildWorld();
    const w = withMoves(fake);
    fake.seed.endMove(w.inForce, { why: 'reversed', by: 'admin' });
    renderIn(fake, <LoadedBoard slug="general" />, { path: '/b/general' });
    expect(await screen.findByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Announcement from/u })).toBeNull();
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
    priceKey: 'whoops.price', playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c }),
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
    await user.click(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: /^Rumble, /u })[0]!);
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
