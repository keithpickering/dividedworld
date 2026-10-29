import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, renderInWorld } from '../test-world.tsx';
import { useLocation } from '../router.tsx';
import { BoardScreen } from './Board.tsx';

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
  return <BoardScreen slug={path.split('/').pop()!} />;
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
    const { seeded, fake } = renderInWorld(<BoardScreen slug="general" />, {
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 4); return w; },
    });
    fake.markRead(seeded.ids[0]!, 2, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=1#post-3`);
  });

  test('no NEW when the player has read to the last post', async () => {
    const { seeded, fake } = renderInWorld(<BoardScreen slug="general" />, {
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 2); return w; },
    });
    fake.markRead(seeded.ids[0]!, 3, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).queryByText('NEW')).toBeNull();
    expect(within(row).queryByRole('link', { name: /^First unread post in / })).toBeNull();
  });

  test('first unread is on the page that holds the post', async () => {
    const { seeded, fake } = renderInWorld(<BoardScreen slug="general" />, {
      settings: { postsPerPage: 2 },
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.spritey, 6); return w; },
    });
    fake.markRead(seeded.ids[0]!, 4, null);
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(rowOf('Thread 001')).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=3#post-5`);
  });

  test('a thread the player has never read is NEW from its first post', async () => {
    const { seeded } = renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(within(row).getByText('NEW')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /^First unread post in / })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=1#post-1`);
  });

  test('a thread is never marked as the player\'s own', async () => {
    renderInWorld(<BoardScreen slug="general" />, {
      seed: (f) => { const w = world(f); f.seed.thread('general', w.mine, 'Mine', 'x', { at: T0 + 5 * DAY }); return w; },
    });
    await screen.findByRole('link', { name: 'Mine' });
    expect(rowOf('Mine')).not.toHaveTextContent(/\byou\b|\byours\b|\bmine\b/i);
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
    renderIn(fake, <BoardScreen slug="general" />);
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

  test('replies count the posts after the first: a thread whose last Act is not a post counts only its posts', async () => {
    const fake = buildWorld();
    const w = world(fake, { threads: 2 });
    replies(fake, w.ids[0]!, w.spritey, 2);
    fake.seed.reveal(w.spritey, w.ids[0]!); /* its last Act, which is no reply */
    renderIn(fake, <BoardScreen slug="general" />);
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(rowOf('Thread 001')).getByText('2', { selector: '.kb-thread-replies .kb-num' })).toBeInTheDocument();
    expect(within(rowOf('Thread 002')).getByText('0', { selector: '.kb-thread-replies .kb-num' })).toBeInTheDocument();
  });

  test('"started by" and "last post" name their characters, with the last post linked to its page', async () => {
    const { seeded } = renderInWorld(<BoardScreen slug="general" />, {
      settings: { postsPerPage: 2 },
      seed: (f) => { const w = world(f); replies(f, w.ids[0]!, w.mine!, 4); return w; },
    });
    await screen.findByRole('link', { name: 'Thread 001' });
    const row = rowOf('Thread 001');
    expect(row).toHaveTextContent('Spritey');
    expect(within(row).getByRole('link', { name: 'Pipewrench' })).toHaveAttribute('href', `/c/${seeded.mine}`);
    expect(within(row).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${seeded.spritey}`);
    expect(within(row).getByRole('link', { name: 'Latest post in Thread 001' })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=3#post-5`);
    expect(within(row).getByRole('link', { name: 'Page 2 of Thread 001' })).toHaveAttribute('href', `/t/${seeded.ids[0]}?page=2`);
  });
});

describe('The System\'s board', () => {
  test('is read-only: no new-thread form, and a plain note says why', async () => {
    renderInWorld(<BoardScreen slug="the-system" />, {
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
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f) });
    const button = await screen.findByRole('button', { name: 'Start a thread' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    await userEvent.click(button);
    const form = await screen.findByRole('form', { name: 'Start a thread' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', form.id);
    await waitFor(() => expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveFocus());
    expect(form.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(button);
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('a list of 0, 1 and 200 threads', () => {
  test('none: says so, and the form is there to start one', async () => {
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
    expect(await screen.findByText('No threads here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await openForm();
  });

  test('one: a row and no pager', async () => {
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 1 }) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  test('two hundred: twenty to a page, newest first, ten pages, and the page in the address', async () => {
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 200 }) });
    await screen.findByRole('link', { name: 'Thread 200' });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByRole('link', { name: 'Thread 181' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Thread 180' })).toBeNull();
    const pages = screen.getByRole('navigation', { name: 'Pages, top' });
    expect(pages).toHaveTextContent('Page 1 of 10');
    expect(within(pages).getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/b/general?page=2');
  });

  test('turning a page keeps the list on screen while the next loads, and puts focus on the board, not the page\'s body', async () => {
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 200 }) });
    await screen.findByRole('link', { name: 'Thread 200' });
    const next = within(screen.getByRole('navigation', { name: 'Pages, top' })).getByRole('link', { name: 'Next' });
    next.focus();
    await userEvent.click(next);
    expect(screen.queryByRole('table')).not.toBeNull();
    await screen.findByRole('link', { name: 'Thread 180' });
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  test('page 3 of the same list', async () => {
    renderInWorld(<BoardScreen slug="general" />, { path: '/b/general?page=3', seed: (f) => world(f, { threads: 200 }) });
    await screen.findByRole('link', { name: 'Thread 160' });
    expect(screen.getByRole('link', { name: 'Thread 141' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages, top' })).toHaveTextContent('Page 3 of 10');
  });

  test('a page past the end shows the last page', async () => {
    renderInWorld(<BoardScreen slug="general" />, { path: '/b/general?page=99', seed: (f) => world(f, { threads: 41 }) });
    await screen.findByRole('link', { name: 'Thread 001' });
    expect(screen.getByRole('navigation', { name: 'Pages, top' })).toHaveTextContent('Page 3 of 3');
  });
});

describe('the new-thread form', () => {
  test('posts as the HUD\'s character and goes to the new thread', async () => {
    const { fake } = renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
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
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 0 }) });
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
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { characters: false }) });
    const form = await openForm();
    expect(within(form).queryByRole('button', { name: 'Start thread' })).toBeNull();
    expect(within(form).getByRole('link', { name: 'Make a character' })).toHaveAttribute('href', '/characters/new');
  });
});

describe('a signed-out visitor', () => {
  test('is asked to sign in, and sees no threads, NEW or form', async () => {
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { signedIn: false }) });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByText('NEW')).toBeNull();
    expect(screen.queryByRole('form', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a thread' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a board that is not there', () => {
  test('says so and links back to the index', async () => {
    renderInWorld(<BoardScreen slug="nowhere" />, { seed: (f) => world(f) });
    expect(await screen.findByText(/There is no such board/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the index' })).toHaveAttribute('href', '/');
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
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f, { threads: 41 }) });
    await screen.findByRole('link', { name: 'Thread 041' });
    expect(screen.getByRole('navigation', { name: 'Pages, top' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pages, bottom' })).toBeInTheDocument();
    const views = screen.getByRole('columnheader', { name: /Views/ });
    expect(views).toHaveTextContent('Characters that have read it, counted hourly');
  });

  test('the table keeps its roles where the phone layout drops the native ones', async () => {
    renderInWorld(<BoardScreen slug="general" />, { seed: (f) => world(f) });
    await screen.findByRole('link', { name: 'Thread 001' });
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('role', 'table');
    expect(within(table).getAllByRole('row')[1]).toHaveAttribute('role', 'row');
    expect(within(table).getAllByRole('cell').length).toBeGreaterThan(0);
    expect(within(table).getAllByRole('cell')[0]).toHaveAttribute('role', 'cell');
  });
});
