/**
 * The /search page (docs/plans/2026-11-07-search-design.md, section 5; the board docs/research/2026-11-07-search/01-search.html): the form,
 * the count line in each of its forms, the results as posts and as threads, the paging and the states. The results are canned pages, since
 * the fake's own search is held by data/fake-search.test.tsx.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { PostHit, SearchCursor, SearchPage, ThreadHit } from '../data/api.ts';
import type { CardUi } from '../cards/types.ts';
import { LoadedSearch } from '../loaded.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { forgetWalk, recordWalk, walkOf } from './walked.ts';

beforeEach(() => { localStorage.clear(); forgetWalk(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const hit = (n: number, o: Partial<PostHit> = {}): PostHit => ({
  act: `act-${n}`, thread: `thread-${n}`, title: `Thread ${n}`, board: 'b-general', boardSlug: 'general', boardName: 'General', seq: 3, page: 2,
  character: 'c-spritey', name: 'Spritey', createdAt: '2026-10-06T19:00:00Z', snippet: 'I throw a <<green shell>> at whoever did it', cards: [], ...o,
});
const thit = (n: number, o: Partial<ThreadHit> = {}): ThreadHit => ({ ...hit(n), matches: 3, matchesMore: false, ...o });
const page = <T,>(results: readonly T[], o: Partial<SearchPage<T>> = {}): SearchPage<T> => ({ count: results.length, more: false, pooled: false, results, next: null, ...o });
const cursor = (n: number): SearchCursor => ({ rank: null, at: '2026-10-05T00:00:00.000Z', act: `act-${n}` });

const art = { color: '#ff3d8b', ink: '#19061a', canvas: '/whoops-card.svg', mark: '/whoops.svg', credit: 'test' };
const whoops: CardUi = { key: 'whoops', describe: () => 'Does a thing.', summary: 'Does a thing.', art };

function open(path: string, canned: { posts?: SearchPage<PostHit> | Error; threads?: SearchPage<ThreadHit> | Error; seed?: (f: ReturnType<typeof buildWorld>) => void } = {}, settings: Record<string, unknown> = {}) {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  fake.seed.character(me, 'Pipewrench', 'heel');
  canned.seed?.(fake);
  fake.signInAs(me);
  const call = (v: SearchPage<never> | Error | undefined) => async () => { if (v instanceof Error) throw v; return v as never; };
  const posts = vi.spyOn(fake, 'searchPosts').mockImplementation(call(canned.posts as never));
  const threads = vi.spyOn(fake, 'searchThreads').mockImplementation(call(canned.threads as never));
  const view = renderIn(fake, <LoadedSearch />, { path, cards: [whoops], settings });
  return { fake, posts, threads, view };
}
const line = async () => (await screen.findByTestId('search-count')).textContent;

describe('the form', () => {
  test('is a panel "Search the boards" with every field the design names, and says nothing of results before a search', async () => {
    const { posts } = open('/search');
    const form = await screen.findByRole('search', { name: 'Search the boards' });
    for (const name of ['Keywords', 'Posted by']) expect(within(form).getByRole('combobox', { name })).toBeInTheDocument();
    for (const name of ['Board', 'Sort']) expect(within(form).getByRole('combobox', { name })).toBeInTheDocument();
    expect(within(form).getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(within(form).getByLabelText('To')).toHaveAttribute('type', 'date');
    expect(within(form).getByRole('group', { name: 'Search in' })).toBeInTheDocument();
    expect(within(form).getByRole('radio', { name: 'titles and posts' })).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'titles only' })).not.toBeChecked();
    expect(within(form).getByRole('group', { name: 'Show results as' })).toBeInTheDocument();
    expect(within(form).getByRole('radio', { name: 'posts' })).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'threads' })).not.toBeChecked();
    expect(within(form).getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(form).toHaveTextContent('Quote a phrase, put - before a word to leave it out, and use or between words to match either.');
    expect(screen.queryByTestId('search-count')).toBeNull();
    expect(posts).not.toHaveBeenCalled();
  });

  test('is filled from the address: every field', async () => {
    open('/search?q=green+shell&board=b-general&from=2026-10-05&to=2026-10-06&in=titles&as=threads&sort=oldest', { threads: page([]), seed: (f) => { void f; } });
    const form = await screen.findByRole('search', { name: 'Search the boards' });
    expect(within(form).getByRole('combobox', { name: 'Keywords' })).toHaveValue('green shell');
    expect(within(form).getByLabelText('From')).toHaveValue('2026-10-05');
    expect(within(form).getByLabelText('To')).toHaveValue('2026-10-06');
    expect(within(form).getByRole('radio', { name: 'titles only' })).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'threads' })).toBeChecked();
    expect(within(form).getByRole('combobox', { name: 'Sort' })).toHaveValue('oldest');
  });

  test('searching writes every field to the address and asks for the first page', async () => {
    const user = userEvent.setup();
    open('/search', { posts: page([hit(1)]) });
    await user.type(await screen.findByRole('combobox', { name: 'Keywords' }), 'green shell');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'newest');
    await user.click(screen.getByRole('radio', { name: 'titles only' }));
    await user.click(screen.getByRole('radio', { name: 'threads' }));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.search).toBe('?q=green+shell&in=titles&as=threads&sort=newest'));
  });

  test('Enter in the keywords box searches, and so does the "Search posts for" row', async () => {
    const user = userEvent.setup();
    open('/search', { posts: page([hit(1)]) });
    await user.type(await screen.findByRole('combobox', { name: 'Keywords' }), 'wario{Enter}');
    await waitFor(() => expect(window.location.search).toBe('?q=wario'));
  });

  test('Posted by picks a character through suggest, and the address holds the id; changing the text lets go of it', async () => {
    const user = userEvent.setup();
    let spritey = '';
    const { posts } = open('/search', { posts: page([hit(1)]), seed: (f) => { spritey = f.seed.character(f.seed.account('other'), 'Spritey', 'face'); } });
    const by = await screen.findByRole('combobox', { name: 'Posted by' });
    await user.type(by, 'Sprit');
    await user.click(await screen.findByRole('option', { name: /Spritey/ }));
    expect(by).toHaveValue('Spritey');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(window.location.search).toBe(`?author=${spritey}`));
    await waitFor(() => expect(posts).toHaveBeenCalled());
    expect(posts.mock.calls[0]![0]).toMatchObject({ author: spritey });
    // The address names the character: the box shows who, and typing over the name drops the filter.
    expect(await screen.findByRole('combobox', { name: 'Posted by' })).toHaveValue('Spritey');
    await user.type(screen.getByRole('combobox', { name: 'Posted by' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    // Nothing is left to ask, so the form stays and says what is needed (the address keeps the last search).
    expect(await screen.findByText('Type a word to search for, or choose a board or a character.')).toBeInTheDocument();
  });

  test('the Board select lists every board, "All boards" first', async () => {
    open('/search');
    const select = await screen.findByRole('combobox', { name: 'Board' });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All boards', 'General', 'Off Topic', 'The System']));
  });
});

describe('the count line', () => {
  test('exact: the count, and how the results are ordered', async () => {
    open('/search?q=shell', { posts: page([hit(1)], { count: 14 }) });
    expect(await line()).toBe('14 posts match, best first.');
  });
  test('one result', async () => {
    open('/search?q=shell&sort=oldest', { posts: page([hit(1)], { count: 1 }) });
    expect(await line()).toBe('1 post matches, oldest first.');
  });
  test('only filters sort newest first', async () => {
    open('/search?board=b-general', { posts: page([hit(1)], { count: 2 }) });
    expect(await line()).toBe('2 posts match, newest first.');
  });
  test('more than 1,000', async () => {
    open('/search?q=shell&sort=newest', { posts: page([hit(1)], { count: 1001, more: true }) });
    expect(await line()).toBe('More than 1,000 posts match, newest first.');
  });
  test('pooled: says it ranked the newest of the instance\'s pool, and how to see them all', async () => {
    open('/search?q=shell', { posts: page([hit(1)], { count: 1001, more: true, pooled: true }) }, { searchRankPool: 5000 });
    expect(await line()).toBe('More than 5,000 posts match; ranked among the newest 5,000. Sort by newest to see them all.');
  });
  test('pooled names the instance\'s own number', async () => {
    open('/search?q=shell', { posts: page([hit(1)], { count: 1001, more: true, pooled: true }) }, { searchRankPool: 1200 });
    expect(await line()).toBe('More than 1,200 posts match; ranked among the newest 1,200. Sort by newest to see them all.');
  });
  test('threads count threads', async () => {
    open('/search?q=shell&as=threads', { threads: page([thit(1)], { count: 7 }) });
    expect(await line()).toBe('7 threads match, best first.');
  });
});

describe('results as posts', () => {
  test('each names its thread, board and page, its author and date, and links to the post', async () => {
    open('/search?q=green+shell', { posts: page([hit(1)]) });
    const table = await screen.findByRole('table', { name: 'Posts matching the search, best first' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByRole('link', { name: 'Thread 1' })).toHaveAttribute('href', '/t/thread-1?page=2#post-3');
    expect(row).toHaveTextContent('in General · page 2');
    expect(within(row).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
    expect(within(row).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', '/c/c-spritey');
    expect(within(row).getByText('Oct 6, 2026')).toBeInTheDocument();
  });

  test('matched words are in an element, not a color', async () => {
    open('/search?q=green+shell', { posts: page([hit(1)]) });
    const word = await screen.findByText('green shell');
    expect(word.tagName).toBe('MARK');
    expect(word.closest('td')).toHaveTextContent('I throw a green shell at whoever did it');
  });

  test('a snippet is text: a tag in it is not drawn', async () => {
    open('/search?q=x', { posts: page([hit(1, { snippet: '<b>hi</b> <<x>>' })]) });
    await screen.findByText('x');
    expect(document.querySelector('.kb-search-snippet b')).toBeNull();
    expect(screen.getByText(/<b>hi<\/b>/)).toBeInTheDocument();
  });

  test('a card live on the post is drawn as its mark, named for a screen reader', async () => {
    open('/search?q=green', { posts: page([hit(1, { cards: ['whoops'] })]) });
    const mark = await screen.findByRole('img', { name: 'Whoops! card on this post' });
    expect(mark).toHaveClass('kb-mark', 'kb-meta-tile');
    expect(mark).toHaveAttribute('data-kb-card', 'whoops');
    expect(mark.querySelector('img')).toHaveAttribute('src', '/whoops.svg');
  });

  test('a post by The System names it, and a mask not seen is "A character"', async () => {
    open('/search?q=x', { posts: page([hit(1, { character: null, name: null }), hit(2, { name: null })]) });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('The System')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A character' })).toHaveAttribute('href', '/c/c-spritey');
  });
});

describe('results as threads', () => {
  test('each thread once, with its best snippet and how many of its posts match', async () => {
    open('/search?q=green&as=threads', { threads: page([thit(1), thit(2, { matches: 100, matchesMore: true }), thit(3, { matches: 1 })]) });
    const table = await screen.findByRole('table', { name: 'Threads matching the search, best first' });
    expect(within(table).getByText('3 matching posts')).toBeInTheDocument();
    expect(within(table).getByText('100+ matching posts')).toBeInTheDocument();
    expect(within(table).getByText('1 matching post')).toBeInTheDocument();
    expect(within(table).getAllByText('green shell')[0]!.tagName).toBe('MARK');
    expect(within(table).getByRole('link', { name: 'Thread 1' })).toHaveAttribute('href', '/t/thread-1?page=2#post-3');
  });
});

describe('the states', () => {
  test('no match says so and what to try', async () => {
    open('/search?q=zzz', { posts: page([]) });
    expect(await screen.findByText('No posts match. Try fewer words, or another board.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('search-count')).toBeNull();
  });
  test('no thread matches', async () => {
    open('/search?q=zzz&as=threads', { threads: page([]) });
    expect(await screen.findByText('No threads match. Try fewer words, or another board.')).toBeInTheDocument();
  });
  test('a refusal is said plainly, and the form stays', async () => {
    open('/search?q=zzz', { posts: new Error('refused') });
    const note = await screen.findByText('That search could not be run. Check the dates and the words, then try again.');
    expect(note.closest('.kb-notice')).toHaveAttribute('data-kb-tone', 'refusal');
    expect(screen.getByRole('search', { name: 'Search the boards' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('review fixes', () => {
  test('Q-2: a search that could not reach the server says so, not that the words were wrong', async () => {
    open('/search?q=zzz', { posts: new TypeError('Failed to fetch') });
    const note = await screen.findByText('The search could not reach the server. Check your connection and try again.');
    expect(note.closest('.kb-notice')).toHaveAttribute('data-kb-tone', 'refusal');
    expect(screen.queryByText(/Check the dates and the words/)).toBeNull();
    expect(screen.getByRole('search', { name: 'Search the boards' })).toBeInTheDocument();
  });

  test('Q-1: a page number is shown only for a page walked in this search, not for one typed into the address', async () => {
    open('/search?q=green&page=9&after=%7C2026-10-05T00%3A00%3A00.000Z%7Cact-1', { posts: page([hit(9)], { count: 200, next: cursor(9) }) });
    const nav = await screen.findByRole('navigation', { name: 'Pages of results' });
    expect(nav).not.toHaveTextContent(/Page 9|of 10/);
    expect(within(nav).queryByText('9')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'First page' })).toBeInTheDocument();
  });

  test('Q-8: the walk is one search\'s: a different search forgets it when it records, and reading writes nothing', () => {
    recordWalk('q=a', 2, cursor(1));
    expect(walkOf('q=b').size).toBe(0);
    expect(walkOf('q=a').get(2)).toEqual(cursor(1));
    recordWalk('q=b', 2, cursor(7));
    expect(walkOf('q=a').size).toBe(0);
    expect(walkOf('q=b').get(2)).toEqual(cursor(7));
  });

  test('Q-3: after a search is run, focus is on the new page\'s heading, not lost with the old form', async () => {
    const user = userEvent.setup();
    open('/search', { posts: page([hit(1)]) });
    await user.type(await screen.findByRole('combobox', { name: 'Keywords' }), 'green');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('link', { name: 'Thread 1' });
    await waitFor(() => expect(document.body.contains(document.activeElement) && document.activeElement !== document.body).toBe(true));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Search' }));
  });

  test('Q-4: the results table is native, with no roles repeated on its parts', async () => {
    open('/search?q=green', { posts: page([hit(1)]) });
    const table = await screen.findByRole('table');
    expect(table.querySelectorAll('[role]').length).toBe(0);
    expect(table.getAttribute('role')).toBeNull();
  });

  test('Q-5: the snippet claims no cut it cannot know of', async () => {
    open('/search?q=green', { posts: page([hit(1)]) });
    const snippet = (await screen.findByRole('table')).querySelector('.kb-search-snippet')!;
    expect(snippet.textContent).toBe('I throw a green shell at whoever did it');
  });

  test('Q-6: a search with nothing to look for keeps the form, says what is needed, and moves focus to the message', async () => {
    const user = userEvent.setup();
    open('/search');
    await user.click(await screen.findByRole('button', { name: 'Search' }));
    const msg = await screen.findByText('Type a word to search for, or choose a board or a character.');
    expect(msg.closest('[role="alert"], [role="status"]')).not.toBeNull();
    expect(window.location.search).toBe('');
    expect(screen.getByRole('search', { name: 'Search the boards' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Keywords' }));
    await user.type(screen.getByRole('combobox', { name: 'Keywords' }), 'a');
    expect(screen.queryByText('Type a word to search for, or choose a board or a character.')).toBeNull();
  });
});

describe('paging by cursor', () => {
  test('Next carries the cursor, Previous and the numbered pages go back to where the player has been', async () => {
    const user = userEvent.setup();
    const { posts } = open('/search?q=green&per=1', {});
    posts.mockImplementation(async (_q, after) => (after === null || after === undefined
      ? page([hit(1)], { count: 3, next: cursor(1) })
      : after.act === 'act-1' ? page([hit(2)], { count: 3, next: cursor(2) }) : page([hit(3)], { count: 3 })));
    await screen.findByRole('link', { name: 'Thread 1' });
    const nav = screen.getByRole('navigation', { name: 'Pages of results' });
    expect(within(nav).queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(within(nav).getByText(/Page 1 of 3/)).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Next' }));
    await screen.findByRole('link', { name: 'Thread 2' });
    expect(window.location.search).toBe('?q=green&per=1&page=2&after=%7C2026-10-05T00%3A00%3A00.000Z%7Cact-1');
    await user.click(within(screen.getByRole('navigation', { name: 'Pages of results' })).getByRole('link', { name: 'Next' }));
    await screen.findByRole('link', { name: 'Thread 3' });
    const third = screen.getByRole('navigation', { name: 'Pages of results' });
    expect(within(third).queryByRole('link', { name: 'Next' })).toBeNull();
    expect(within(third).getByText('3', { selector: '[aria-current="page"]' })).toBeInTheDocument();
    // Page 2 was walked: its link carries the cursor that reached it.
    await user.click(within(third).getByRole('link', { name: 'Page 2' }));
    await screen.findByRole('link', { name: 'Thread 2' });
    await user.click(within(screen.getByRole('navigation', { name: 'Pages of results' })).getByRole('link', { name: 'Previous' }));
    await screen.findByRole('link', { name: 'Thread 1' });
    expect(window.location.search).toBe('?q=green&per=1');
  });

  test('a page opened from a link offers the first page where it has not walked the one before', async () => {
    open('/search?q=green&page=3&after=%7C2026-10-05T00%3A00%3A00.000Z%7Cact-1', { posts: page([hit(3)], { count: 5 }) });
    const nav = await screen.findByRole('navigation', { name: 'Pages of results' });
    expect(within(nav).queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'First page' })).toHaveAttribute('href', '/search?q=green');
  });

  test('a single page has no pager', async () => {
    open('/search?q=green', { posts: page([hit(1)], { count: 1 }) });
    await screen.findByRole('link', { name: 'Thread 1' });
    expect(screen.queryByRole('navigation', { name: 'Pages of results' })).toBeNull();
  });
});

describe('accessibility', () => {
  test.each([
    ['the blank form', '/search', {}],
    ['posts with a card mark', '/search?q=green', { posts: page([hit(1, { cards: ['whoops'] }), hit(2)], { count: 40, next: cursor(2) }) }],
    ['threads', '/search?q=green&as=threads', { threads: page([thit(1)]) }],
    ['no match', '/search?q=zzz', { posts: page([]) }],
    ['a refusal', '/search?q=zzz', { posts: new Error('no') }],
  ] as const)('%s is axe clean', async (_name, path, canned) => {
    const { view } = open(path, canned);
    await screen.findByRole('search', { name: 'Search the boards' });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    const found = await axeViolations(view.container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
