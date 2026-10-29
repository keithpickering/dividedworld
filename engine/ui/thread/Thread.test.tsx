import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act, Id, ThreadListener } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { pageOf, pageRange, threadHref } from './pages.ts';
import { createTallies } from './tallies.ts';
import { GAP_FILL_MS, READ_DEBOUNCE_MS, ThreadScreen } from './Thread.tsx';

/* The HUD's estimate is asked for through the player; this test file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

/* ---------------------------------------------------------------- the browser's observer ---- */
class MockObserver {
  static all: MockObserver[] = [];
  readonly els = new Set<Element>();
  constructor(readonly cb: IntersectionObserverCallback) { MockObserver.all.push(this); }
  observe(el: Element) { this.els.add(el); }
  unobserve(el: Element) { this.els.delete(el); }
  disconnect() { this.els.clear(); }
  takeRecords() { return []; }
}
/** The observer reports an element in view, or out of it. */
function see(el: Element | null, visible = true) {
  if (!el) throw new Error('no such element to see');
  act(() => {
    for (const o of MockObserver.all) if (o.els.has(el)) o.cb([{ target: el, isIntersecting: visible } as IntersectionObserverEntry], o as unknown as IntersectionObserver);
  });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const sentinel = () => document.querySelector('[data-kb-end]');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  MockObserver.all = [];
  vi.stubGlobal('IntersectionObserver', MockObserver);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.removeAttribute('data-kb-motion');
});
afterEach(() => { vi.unstubAllGlobals(); });

/* ---------------------------------------------------------------------------- the world ---- */
function world(acts: number) {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A long thread', 'post 1');
  const ids = [first];
  for (let i = 2; i <= acts; i++) ids.push(fake.seed.post(thread, i % 2 ? spritey : pipe, `post ${i}`));
  fake.signInAs(me);
  return { fake, me, other, pipe, spritey, thread, ids };
}
const open = (w: { fake: Fake; thread: Id }, hash = '', query = '') =>
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}${query}${hash}` });

/** Capture the thread's live listener so a test can deliver events as the server would, twice or out of order. */
function tap(fake: Fake) {
  let listener: ThreadListener | undefined;
  const real = fake.subscribeThread.bind(fake);
  fake.subscribeThread = (t, l) => { listener = l; return real(t, l); };
  return () => listener!;
}
let counter = 0;
const live = (thread: Id, seq: number, character: Id | null, over: Partial<Act> = {}): Act => ({
  id: `99999999-0000-4000-8000-${String(++counter).padStart(12, '0')}`, character, kind: 'post', thread, targetActId: null, seq,
  createdAt: '2026-10-29T12:00:00Z', payload: { body: `live ${seq}` }, currentPayload: { body: `live ${seq}` }, editedAt: null, shownEditedAt: null, ...over,
});
const deliver = (fn: () => void) => act(() => { fn(); });

/* ------------------------------------------------------------------------------ pages ---- */
describe('pages and permalinks', () => {
  test('page N holds seqs (N-1)*P+1..N*P, and post 142 is on page 8', () => {
    expect(pageOf(142, 20)).toBe(8);
    expect(pageOf(140, 20)).toBe(7);
    expect(pageOf(141, 20)).toBe(8);
    expect(pageRange(8, 20)).toEqual({ start: 141, end: 160 });
    expect(threadHref('t', 8, 142)).toBe('/t/t?page=8#post-142');
    expect(threadHref('t', 1)).toBe('/t/t?page=1');
  });

  test('a permalink to post 142 opens page 8 at it', async () => {
    const w = world(170);
    open(w, '#post-142');
    await screen.findByRole('article', { name: /^Post 142 /u });
    expect(post(141)).toBeInTheDocument();
    expect(post(160)).toBeInTheDocument();
    expect(document.getElementById('post-140')).toBeNull();
    expect(document.getElementById('post-161')).toBeNull();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1)).toBe(post(142));
    expect(window.location.search + window.location.hash).toBe('?page=8#post-142');
  });

  test('?page=3 opens 41 to 60, and a page past the end shows the last', async () => {
    const w = world(45);
    const { unmount } = open(w, '', '?page=3');
    await screen.findByRole('article', { name: /^Post 41 /u });
    expect(post(45)).toBeInTheDocument();
    expect(document.getElementById('post-40')).toBeNull();
    unmount();
    renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}?page=99` });
    await screen.findByRole('article', { name: /^Post 41 /u });
  });

  test('a page is twenty posts, then "Continue to page 2" loads the next in place and updates the address without scrolling', async () => {
    const w = world(45);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    expect(document.querySelectorAll('article.kb-act')).toHaveLength(20);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    await userEvent.click(screen.getAllByRole('link', { name: 'Continue to page 2' })[0]!);
    await screen.findByRole('article', { name: /^Post 40 /u });
    expect(document.querySelectorAll('article.kb-act')).toHaveLength(40);
    expect(post(1)).toBeInTheDocument();
    expect(window.location.search).toBe('?page=2');
    expect(window.location.hash).toBe('');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link', { name: 'Continue to page 3' }).length).toBeGreaterThan(0);
  });

  test('no address carries the HUD\'s character', async () => {
    const w = world(45);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    await userEvent.click(screen.getAllByRole('link', { name: 'Continue to page 2' })[0]!);
    await screen.findByRole('article', { name: /^Post 40 /u });
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href') ?? '').not.toContain(w.pipe);
    expect(window.location.href).not.toContain(w.pipe);
  });

  test('"Jump to latest" goes to the last page\'s last post', async () => {
    const w = world(45);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    await userEvent.click(screen.getAllByRole('link', { name: 'Jump to latest' })[0]!);
    await screen.findByRole('article', { name: /^Post 45 /u });
    expect(document.getElementById('post-40')).toBeNull();
    expect(window.location.search + window.location.hash).toBe('?page=3#post-45');
  });

  test('a page costs one read of the Acts and one each of its characters, stats, standings, reveals, turns and tallies', async () => {
    const w = world(20);
    const spies = (['acts', 'characters', 'characterStats', 'standingsOf', 'classReveals', 'turnsAnnounced', 'tallies'] as const).map((m) => [m, vi.spyOn(w.fake, m)] as const);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    for (const [name, spy] of spies) expect(spy, name).toHaveBeenCalledTimes(1);
  });

  test('a thread that is not there says so and leads back', async () => {
    const w = world(3);
    renderIn(w.fake, <ThreadScreen thread="00000000-0000-4000-8000-00000000ffff" />);
    expect(await screen.findByRole('heading', { name: 'No such thread' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the index' })).toBeInTheDocument();
  });

  test('a visitor who is not signed in is asked to sign in', async () => {
    const w = world(3);
    w.fake.signInAs(null);
    open(w);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------------ postbit ---- */
describe('the postbit in a thread', () => {
  test('side by side by default, stacked by the reader\'s preference', async () => {
    const w = world(3);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(within(post(2)).getByRole('group', { name: 'About Pipewrench' })).toHaveAttribute('data-kb-postbit', 'side');
  });

  test('stacked when the reader chose it', async () => {
    const w = world(3);
    await w.fake.setPreferences({ postbit: 'stacked' });
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(within(post(2)).getByRole('group', { name: 'About Pipewrench' })).toHaveAttribute('data-kb-postbit', 'stacked');
  });

  test('rank, posts, the month joined and a class made public', async () => {
    const w = world(5);
    w.fake.seed.settle({ standings: { [w.pipe]: 350 } });
    w.fake.seed.reveal(w.pipe, w.thread, { class: 'heel', at: Date.parse('2026-10-03T12:00:00Z') });
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    const bit = within(post(2)).getByRole('group', { name: 'About Pipewrench' });
    expect(within(bit).getByRole('img', { name: 'Rank 2 of 3: Midcarder' })).toBeInTheDocument();
    expect(bit).toHaveTextContent('Posts: 2');
    expect(bit).toHaveTextContent('Joined Oct 2026');
    expect(bit).toHaveTextContent('Revealed: Heel (Oct 3)');
  });

  test('The System has a name and no postbit', async () => {
    const w = world(1);
    const sys = w.fake.seed.thread('the-system', null, 'Tally', 'Tonight, the board turns.');
    renderIn(w.fake, <ThreadScreen thread={sys.thread} />, { path: `/t/${sys.thread}` });
    const article = await screen.findByRole('article', { name: /^Post 1 by The System/u });
    expect(within(article).queryByRole('group')).toBeNull();
    expect(article).toHaveTextContent('Tonight, the board turns.');
  });
});

/* ------------------------------------------------------------------- acts that are not posts ---- */
describe('Acts that are not posts', () => {
  test('a card is one line naming who played what on which post', async () => {
    const w = world(3);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 4, w.pipe, { kind: 'card', targetActId: w.ids[1]!, payload: { card: 'whoops', message: 'oops' }, currentPayload: { card: 'whoops', message: 'oops' } })));
    const line = await screen.findByRole('article', { name: /^Post 4 /u });
    expect(line).toHaveTextContent('Pipewrench played Whoops! on post #2: “oops”');
  });

  test('an unmask says who revealed which class, and its message', async () => {
    const w = world(2);
    w.fake.seed.reveal(w.pipe, w.thread, { class: 'heel', message: 'It was me.' });
    open(w);
    const line = await screen.findByRole('article', { name: /^Post 3 /u });
    expect(line).toHaveTextContent('Pipewrench revealed: Heel');
    expect(line).toHaveTextContent('It was me.');
  });

  test('The System\'s tally lists debuts and announced Turns by name and class', async () => {
    const w = world(1);
    const sys = w.fake.seed.thread('the-system', null, 'Tally', '');
    w.fake.seed.post(sys.thread, null, '', { payload: { debuts: [{ character: w.spritey, name: 'Spritey', class: 'face' }, { character: w.pipe, name: 'Pipewrench' }], turns: [{ character: w.pipe, name: 'Pipewrench', loudness: 'announced', was: 'face', class: 'heel' }] } });
    renderIn(w.fake, <ThreadScreen thread={sys.thread} />, { path: `/t/${sys.thread}` });
    const line = await screen.findByRole('article', { name: /^Post 2 by The System/u });
    expect(line).toHaveTextContent('Spritey debuts as Face');
    expect(line).toHaveTextContent('Pipewrench debuts');
    expect(line).toHaveTextContent('Pipewrench has Turned from Face to Heel');
  });

  test('a spun thread opens on an ORIGIN box that links to its origin', async () => {
    const w = world(3);
    const spun = await w.fake.spin(w.ids[1]!, (await w.fake.myCharacters())[0]!.id, 'Spun off', 'Taking this elsewhere.');
    if (!spun.ok) throw new Error(spun.error);
    renderIn(w.fake, <ThreadScreen thread={spun.value.thread.id} />, { path: `/t/${spun.value.thread.id}` });
    const first = await screen.findByRole('article', { name: /^Post 1 /u });
    const origin = within(first).getByRole('group', { name: 'Origin' });
    expect(within(origin).getByRole('link', { name: /#2 in A long thread/u })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    expect(first).toHaveTextContent('Taking this elsewhere.');
  });
});

/* ------------------------------------------------------------------------------ quoting ---- */
describe('quotes', () => {
  test('a quote of an Act in this thread links to its post', async () => {
    const w = world(2);
    w.fake.seed.post(w.thread, w.pipe, `[quote=${w.ids[0]}]post 1[/quote]I agree.`);
    open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    expect(within(reply).getByRole('link', { name: 'Post #1' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
  });

  test('a quote of an Act in another thread finds it', async () => {
    const w = world(2);
    const other = w.fake.seed.thread('general', w.spritey, 'Elsewhere', 'x');
    const quoted = w.fake.seed.post(other.thread, w.pipe, 'elsewhere post');
    w.fake.seed.post(w.thread, w.pipe, `[quote=${quoted}]elsewhere post[/quote]`);
    open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(within(reply).getByRole('link', { name: 'Post #2' })).toHaveAttribute('href', `/t/${other.thread}?page=1#post-2`));
  });
});

/* ------------------------------------------------------------------------------ mark read ---- */
describe('mark_read', () => {
  test('sends the highest seq in view, debounced, through the HUD\'s character', async () => {
    const w = world(10);
    const spy = vi.spyOn(w.fake, 'markRead');
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    see(post(3));
    see(post(5));
    expect(spy).not.toHaveBeenCalled();
    await pause(READ_DEBOUNCE_MS + 150);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(w.thread);
    expect(spy.mock.calls[0]![1]).toBe(5);
    expect(spy.mock.calls[0]![2]).toBe(w.pipe);
    expect(await w.fake.reading([w.thread])).toEqual({ [w.thread]: 5 });
  });

  test('never sends a lower seq than it has sent', async () => {
    const w = world(10);
    const spy = vi.spyOn(w.fake, 'markRead');
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    see(post(8));
    await pause(READ_DEBOUNCE_MS + 150);
    see(post(2));
    see(post(8));
    await pause(READ_DEBOUNCE_MS + 150);
    expect(spy).toHaveBeenCalledTimes(1);
    see(post(9));
    await pause(READ_DEBOUNCE_MS + 150);
    expect(spy.mock.calls.map((c) => c[1])).toEqual([8, 9]);
  });

  test('starts from what the server already has: a read row of 6 is not sent again at 4', async () => {
    const w = world(10);
    await w.fake.markRead(w.thread, 6, null);
    const spy = vi.spyOn(w.fake, 'markRead');
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    see(post(4));
    await pause(READ_DEBOUNCE_MS + 150);
    expect(spy).not.toHaveBeenCalled();
  });

  test('a read in flight when the reader leaves is still sent', async () => {
    const w = world(10);
    const spy = vi.spyOn(w.fake, 'markRead');
    const { unmount } = open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    see(post(7));
    unmount();
    expect(spy.mock.calls[0]!.slice(0, 2)).toEqual([w.thread, 7]);
  });
});

/* ---------------------------------------------------------------------------------- live ---- */
describe('live updates', () => {
  test('on the last page and at the bottom, a new post slides in at the bottom', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.spritey)));
    const added = await screen.findByRole('article', { name: /^Post 6 by Spritey/u });
    expect(added).toHaveAttribute('data-kb-arrived', 'slide');
    expect(added).toHaveTextContent('live 6');
    expect(screen.queryByRole('button', { name: /new post/u })).toBeNull();
    expect(added.previousElementSibling).toBe(post(5));
  });

  test('reduced motion inserts it without sliding', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.spritey)));
    const added = await screen.findByRole('article', { name: /^Post 6 /u });
    expect(added).not.toHaveAttribute('data-kb-arrived');
  });

  test('reading higher up, a bar above the HUD counts the new posts and nothing moves; clicking shows them and scrolls to the first', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), false);
    deliver(() => { tapped().onAct?.(live(w.thread, 6, w.spritey)); tapped().onAct?.(live(w.thread, 7, w.pipe)); tapped().onAct?.(live(w.thread, 8, w.spritey)); });
    const bar = await screen.findByRole('button', { name: '3 new posts' });
    expect(document.getElementById('post-6')).toBeNull();
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    await userEvent.click(bar);
    await screen.findByRole('article', { name: /^Post 8 /u });
    expect(screen.queryByRole('button', { name: /new posts?$/u })).toBeNull();
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1)).toBe(post(6));
  });

  test('one new post says "1 new post"', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), false);
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.spritey)));
    expect(await screen.findByRole('button', { name: '1 new post' })).toBeInTheDocument();
  });

  test('reading on, to the bottom, shows them without a click', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), false);
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.spritey)));
    await screen.findByRole('button', { name: '1 new post' });
    see(sentinel(), true);
    await screen.findByRole('article', { name: /^Post 6 /u });
    expect(screen.queryByRole('button', { name: /new post/u })).toBeNull();
  });

  test('on an earlier page the bar says which page, and leads there', async () => {
    const w = world(45);
    const tapped = tap(w.fake);
    open(w, '', '?page=1');
    await screen.findByRole('article', { name: /^Post 20 /u });
    deliver(() => tapped().onAct?.(live(w.thread, 46, w.spritey)));
    deliver(() => tapped().onAct?.(live(w.thread, 47, w.spritey)));
    const bar = await screen.findByRole('link', { name: '2 new posts on page 3' });
    expect(bar).toHaveAttribute('href', `/t/${w.thread}?page=3#post-46`);
    expect(document.getElementById('post-46')).toBeNull();
    await userEvent.click(bar);
    // The posts arrived live only; the server has none of them, so the page ends at the 45 it holds.
    await screen.findByRole('article', { name: /^Post 45 /u });
  });

  test('out of order, and twice, each post appears once and in order', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    const six = live(w.thread, 6, w.spritey);
    const seven = live(w.thread, 7, w.pipe);
    deliver(() => { tapped().onAct?.(seven); tapped().onAct?.(six); tapped().onAct?.(six); tapped().onAct?.(seven); });
    await screen.findByRole('article', { name: /^Post 7 /u });
    expect(document.querySelectorAll('[id="post-6"]')).toHaveLength(1);
    expect(document.querySelectorAll('[id="post-7"]')).toHaveLength(1);
    expect(post(6).nextElementSibling).toBe(post(7));
  });

  test('a gap that never fills is read from the server', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    // Post 6 is real on the server but its broadcast is lost; post 7 arrives alone.
    w.fake.seed.post(w.thread, w.pipe, 'post 6');
    w.fake.seed.post(w.thread, w.spritey, 'post 7');
    const seven = (await w.fake.acts(w.thread, 7, 7))[0]!;
    deliver(() => tapped().onAct?.(seven));
    await screen.findByRole('article', { name: /^Post 6 /u }, { timeout: GAP_FILL_MS + 1500 });
    expect(post(7)).toBeInTheDocument();
  });

  test('an edit arrives again under its own id and updates in place, as "Last edited", and is not announced', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    const before = within(screen.getByRole('status')).queryAllByText(/./u).length;
    const original = (await w.fake.acts(w.thread, 3, 3))[0]!;
    expect(post(3)).not.toHaveTextContent('Last edited');
    deliver(() => tapped().onAct?.({ ...original, currentPayload: { body: 'post 3, fixed' }, editedAt: '2026-10-29T13:00:00Z', shownEditedAt: '2026-10-29T13:00:00Z' }));
    await waitFor(() => expect(post(3)).toHaveTextContent('post 3, fixed'));
    expect(post(3)).toHaveTextContent('Last edited');
    expect(within(post(3)).getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(within(screen.getByRole('status')).queryAllByText(/./u)).toHaveLength(before);
  });

  test('History lists every version, so it leads somewhere', async () => {
    const w = world(3);
    const mine = (await w.fake.myCharacters())[0]!.id;
    const made = await w.fake.post(w.thread, mine, 'first words', null);
    if (!made.ok) throw new Error(made.error);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(made.value.id, mine, 'second words');
    open(w);
    const article = await screen.findByRole('article', { name: /^Post 4 /u });
    expect(article).toHaveTextContent('Last edited');
    await userEvent.click(within(article).getByRole('button', { name: 'History' }));
    const list = await within(article).findByRole('list', { name: 'Versions of this post' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('first words');
    expect(list).toHaveTextContent('second words');
  });

  test('a tally updates its post in place and only grows', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    deliver(() => tapped().onTally?.(w.ids[2]!, { fire: 2 }));
    await waitFor(() => expect(within(post(3)).getByLabelText('2 fire')).toBeInTheDocument());
    deliver(() => tapped().onTally?.(w.ids[2]!, { fire: 1, tea: 1 }));
    await waitFor(() => expect(within(post(3)).getByLabelText('1 tea')).toBeInTheDocument());
    expect(within(post(3)).getByLabelText('2 fire')).toBeInTheDocument();
    expect(within(post(2)).queryByLabelText(/fire/u)).toBeNull();
  });

  test('a tally that lands on one of the player\'s own Acts asks for the estimate, and on anyone else\'s does not', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 4 /u });
    await pause(80);
    landed.mockClear();
    deliver(() => tapped().onTally?.(w.ids[2]!, { fire: 1 }));
    await pause(80);
    expect(landed).not.toHaveBeenCalled();
    deliver(() => tapped().onTally?.(w.ids[3]!, { fire: 1 }));
    await waitFor(() => expect(landed).toHaveBeenCalledTimes(1));
    deliver(() => tapped().onTally?.(w.ids[3]!, { fire: 1 }));
    await pause(80);
    expect(landed).toHaveBeenCalledTimes(1);
  });

  test('and so does one on an Act of the player\'s own that is on another page', async () => {
    const w = world(45);
    const tapped = tap(w.fake);
    open(w, '', '?page=1');
    await screen.findByRole('article', { name: /^Post 20 /u });
    landed.mockClear();
    deliver(() => tapped().onTally?.(w.ids[43]!, { fire: 1 }));
    await waitFor(() => expect(landed).toHaveBeenCalledTimes(1));
  });
});

/* ---------------------------------------------------------------------------- announcer ---- */
describe('the announcer', () => {
  test('says each new post once, however many times it arrives, and no reaction or edit', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    const six = live(w.thread, 6, w.spritey);
    deliver(() => { tapped().onAct?.(six); tapped().onAct?.(six); });
    await waitFor(() => expect(region).toHaveTextContent('New post by Spritey'));
    deliver(() => tapped().onAct?.(six));
    deliver(() => tapped().onTally?.(w.ids[0]!, { fire: 3 }));
    deliver(() => tapped().onAct?.({ ...(live(w.thread, 3, w.pipe, { id: w.ids[2]! })), currentPayload: { body: 'changed' } }));
    await pause(60);
    expect(region.textContent!.match(/New post by Spritey/gu)).toHaveLength(1);
    expect(region.textContent).not.toMatch(/fire|changed|edit/iu);
  });

  test('says it for a post held back by the bar too, since the reader cannot see it', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), false);
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.pipe)));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('New post by Pipewrench'));
  });
});

/* ----------------------------------------------------------------------------- tallies ---- */
describe('the tally store', () => {
  test('keeps each kind\'s largest, whatever order the counts arrive in', () => {
    const t = createTallies();
    expect(t.merge('a', { fire: 2 })).toBe(true);
    expect(t.merge('a', { fire: 1 })).toBe(false);
    expect(t.merge('a', { fire: 1, tea: 4 })).toBe(true);
    expect(t.get('a')).toEqual({ fire: 2, tea: 4 });
    expect(t.get('never')).toEqual({});
  });

  test('wakes only the post a tally is for, so a storm does not re-render a page', () => {
    const t = createTallies();
    const a = vi.fn();
    const b = vi.fn();
    t.subscribe('a', a);
    t.subscribe('b', b);
    for (let i = 1; i <= 50; i++) t.merge('a', { fire: i });
    t.merge('a', { fire: 50 });
    expect(a).toHaveBeenCalledTimes(50);
    expect(b).not.toHaveBeenCalled();
  });

  test('hands the same object back until it changes', () => {
    const t = createTallies();
    t.merge('a', { fire: 1 });
    const first = t.get('a');
    t.merge('a', { fire: 1 });
    expect(t.get('a')).toBe(first);
  });
});

