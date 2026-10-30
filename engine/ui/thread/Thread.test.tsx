import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardUi } from '../cards/types.ts';
import type { Act, Id, ThreadListener } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { pageOf, pageRange, threadHref } from './pages.ts';
import { createTallies } from './tallies.ts';
import { GAP_FILL_MS, READ_DEBOUNCE_MS, ThreadScreen } from './Thread.tsx';
import { ACT_CACHE_SIZE, actLoader } from './locate.tsx';
import { returnState } from '../glass/back.ts';

/* The HUD's estimate is asked for through the player; this test file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

/* What a post's words cost to draw: every render of a body, and every parse of a long one. */
const drawn = vi.hoisted(() => ({ bodies: [] as string[], parses: [] as string[] }));
vi.mock('../bbcode/render.tsx', async (original) => {
  const m = await original<typeof import('../bbcode/render.tsx')>();
  const Inner = m.BbCode;
  return { ...m, BbCode: (p: React.ComponentProps<typeof Inner>) => { drawn.bodies.push(p.text); return <Inner {...p} />; } };
});
vi.mock('../../bbcode/parse.ts', async (original) => {
  const m = await original<typeof import('../../bbcode/parse.ts')>();
  return { ...m, parse: (...a: Parameters<typeof m.parse>) => { drawn.parses.push(a[0]); return m.parse(...a); } };
});

/* ---------------------------------------------------------------- the browser's observer ---- */
class MockObserver {
  static all: MockObserver[] = [];
  readonly els = new Set<Element>();
  gone = false;
  constructor(readonly cb: IntersectionObserverCallback) { MockObserver.all.push(this); }
  observe(el: Element) { this.els.add(el); }
  unobserve(el: Element) { this.els.delete(el); }
  disconnect() { this.els.clear(); this.gone = true; }
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
/* The debounce is waited out on a fake clock, so a loaded machine cannot make it late. Call before the first `see`. */
const clock = () => vi.useFakeTimers({ shouldAdvanceTime: true });
const debounced = () => act(() => vi.advanceTimersByTimeAsync(READ_DEBOUNCE_MS + 50));
/* A post is observed in an effect, which can land after the post is on screen: wait for it before reporting it in view. */
const watched = (el: Element | null) => waitFor(() => expect(MockObserver.all.some((o) => !!el && o.els.has(el))).toBe(true));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  MockObserver.all = [];
  drawn.bodies = [];
  drawn.parses = [];
  vi.stubGlobal('IntersectionObserver', MockObserver);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.removeAttribute('data-kb-motion');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/* ---------------------------------------------------------------------------- the world ---- */
function world(acts: number, settings: Parameters<typeof buildWorld>[0] = undefined) {
  const fake = buildWorld(settings);
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
/** The thread's own polite region (the reply box keeps status regions of its own). */
const announcer = () => document.querySelector<HTMLElement>('.kb-thread > [aria-live="polite"]')!;

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

  test('a page opened with no post asked stays at its top, where its breadcrumb, title and pages are; a page the reader moves to lands at its first post', async () => {
    const w = world(45);
    open(w, '', '?page=3');
    await screen.findByRole('article', { name: /^Post 41 /u });
    await screen.findByRole('article', { name: /^Post 45 /u });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole('link', { name: 'Page 1' })[0]!);
    await screen.findByRole('article', { name: /^Post 1 /u });
    await waitFor(() => expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1)).toBe(post(1)));
  });

  test('a page is twenty posts, then "Continue to page 2" loads the next in place and updates the address without scrolling', async () => {
    const w = world(45);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    expect(document.querySelectorAll('article.kb-act')).toHaveLength(20);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
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
    /* A character's own public page is the one place its id is an address: the postbit's name links to it. */
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('/c/')) expect(href).not.toContain(w.pipe);
    }
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
    const spies = (['acts', 'characters', 'characterStats', 'standingAmounts', 'classReveals', 'turnsAnnounced', 'tallies'] as const).map((m) => [m, vi.spyOn(w.fake, m)] as const);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    for (const [name, spy] of spies) expect(spy, name).toHaveBeenCalledTimes(1);
  });

  test('a page learns what kind of board it is from one read of that board, never from the list of boards', async () => {
    const w = world(3);
    const list = vi.spyOn(w.fake, 'boards');
    const one = vi.spyOn(w.fake, 'board');
    const ranked = vi.spyOn(w.fake, 'standingsPage');
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(one).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    expect(ranked).not.toHaveBeenCalled();
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
describe('the thread\'s head, as the Main board draws it', () => {
  test('the title and the pages share one head, and no line says when the thread started', async () => {
    const w = world(45);
    open(w, '', '?page=3');
    await screen.findByRole('article', { name: /^Post 41 /u });
    const title = screen.getByRole('heading', { level: 1 });
    const pages = screen.getByRole('navigation', { name: 'Pages, top' });
    expect(title.parentElement).toHaveClass('kb-thread-head');
    expect(pages.parentElement).toBe(title.parentElement);
    expect(screen.queryByText(/^Started/u)).toBeNull();
  });

  test('side by side, a column head names the Author and the Message, outside the reading order', async () => {
    const w = world(3);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    const head = document.querySelector('.kb-acts-head');
    expect(head).toHaveTextContent(/^AuthorMessage$/u);
    expect(head).toHaveAttribute('aria-hidden', 'true');
  });

  test('stacked, the postbit heads each post, and there is no column head', async () => {
    const w = world(3);
    await w.fake.setPreferences({ postbit: 'stacked' });
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(document.querySelector('.kb-acts-head')).toBeNull();
  });
});

describe('the postbit in a thread', () => {
  test('side by side by default, stacked by the reader\'s preference', async () => {
    const w = world(3);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(within(post(2)).getByRole('group', { name: 'About Pipewrench' })).toHaveAttribute('data-kb-postbit', 'side');
  });

  test('a post is read author first, then its line (when, and the permalink), then its words', async () => {
    const w = world(3);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    const bit = within(post(2)).getByRole('group', { name: 'About Pipewrench' });
    const permalink = within(post(2)).getByRole('link', { name: 'Permalink to post #2' });
    expect(bit.compareDocumentPosition(permalink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  test('a card play is a tag on its post, naming who played what with their words and when, and never a line of its own', async () => {
    const w = world(3);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, null as unknown as number, w.pipe, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'whoops', layer: 1, message: 'oops' }, currentPayload: { card: 'whoops', layer: 1, message: 'oops' }, createdAt: '2026-10-29T21:16:00Z' })));
    const tags = await within(post(2)).findByRole('list', { name: 'Cards played on this post' });
    expect(tags).toHaveTextContent('Pipewrench played Whoops! on this post: “oops”');
    expect(within(tags).getByText(/Oct 29, 2026/u)).toBeInTheDocument();
    /* Linking to the post it is on: a play is a layer on a post and has no number of its own to link to. */
    expect(within(tags).getByRole('link', { name: 'Pipewrench played Whoops! on this post: “oops”' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    /* No line of its own: still three posts, and no other post carries the tag. */
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(within(post(3)).queryByRole('list', { name: 'Cards played on this post' })).toBeNull();
    expect(screen.queryByRole('button', { name: /new posts?$/u })).toBeNull();
  });

  test('a play already on a post is its tag when the page opens, read for the whole page in one request, and the posts keep their numbers', async () => {
    const w = world(4);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'first' });
    const next = w.fake.seed.post(w.thread, w.spritey, 'after the card');
    w.fake.seed.card(w.pipe, w.ids[2]!, 'whoops', { message: 'second' });
    const many = vi.spyOn(w.fake, 'cardsOnMany');
    const one = vi.spyOn(w.fake, 'cardsOn');
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    expect(post(5)).toHaveTextContent('after the card');
    expect((await w.fake.act(next))?.seq).toBe(5);
    expect(await within(post(2)).findByRole('list', { name: 'Cards played on this post' })).toHaveTextContent('Spritey played Whoops! on this post: “first”');
    expect(await within(post(3)).findByRole('list', { name: 'Cards played on this post' })).toHaveTextContent('Pipewrench played Whoops! on this post: “second”');
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(many).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
  });

  test('several plays on one post are several tags, in the order they were played', async () => {
    const w = world(2);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'one' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'two' });
    open(w);
    const tags = await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByRole('list', { name: 'Cards played on this post' });
    expect(within(tags).getAllByRole('listitem').map((li) => li.getAttribute('data-kb-card'))).toEqual(['whoops', 'stick-around']);
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
    await watched(post(10));
    clock();
    see(post(3));
    see(post(5));
    expect(spy).not.toHaveBeenCalled();
    await debounced();
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
    await watched(post(10));
    clock();
    see(post(8));
    await debounced();
    see(post(2));
    see(post(8));
    await debounced();
    expect(spy).toHaveBeenCalledTimes(1);
    see(post(9));
    await debounced();
    expect(spy.mock.calls.map((c) => c[1])).toEqual([8, 9]);
  });

  test('starts from what the server already has: a read row of 6 is not sent again at 4', async () => {
    const w = world(10);
    await w.fake.markRead(w.thread, 6, null);
    const spy = vi.spyOn(w.fake, 'markRead');
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    await watched(post(10));
    clock();
    see(post(4));
    await debounced();
    expect(spy).not.toHaveBeenCalled();
  });

  test('a read in flight when the reader leaves is still sent', async () => {
    const w = world(10);
    const spy = vi.spyOn(w.fake, 'markRead');
    const { unmount } = open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    await watched(post(10));
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

  /* A card numbered before cards took none (0035_card_takes_no_seq.sql) is a seq no read returns: the fake cannot hold
     one, so the read is stubbed to leave it out, as the server's reads leave cards out. */
  const withoutSeq = (w: ReturnType<typeof world>, gone: number) => {
    const real = w.fake.acts.bind(w.fake);
    vi.spyOn(w.fake, 'acts').mockImplementation(async (t, a, b) => (await real(t, a, b)).filter((x) => x.seq !== gone));
  };

  test('a page with a legacy numbered card missing from it is short but is not the end of the thread', async () => {
    const w = world(30);
    withoutSeq(w, 4);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    expect(post(4)).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Continue to page 2' }).length).toBeGreaterThan(0);
  });

  test('a post that follows a legacy numbered card at the tail is shown at the bottom as any next post is', async () => {
    const w = world(4);
    withoutSeq(w, 4);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    see(sentinel(), true);
    w.fake.seed.post(w.thread, w.pipe, 'post 5');
    const five = (await w.fake.acts(w.thread, 5, 5))[0]!;
    deliver(() => tapped().onAct?.(five));
    await screen.findByRole('article', { name: /^Post 5 /u });
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
    const before = within(announcer()).queryAllByText(/./u).length;
    const original = (await w.fake.acts(w.thread, 3, 3))[0]!;
    expect(post(3)).not.toHaveTextContent('Last edited');
    deliver(() => tapped().onAct?.({ ...original, currentPayload: { body: 'post 3, fixed' }, editedAt: '2026-10-29T13:00:00Z', shownEditedAt: '2026-10-29T13:00:00Z' }));
    await waitFor(() => expect(post(3)).toHaveTextContent('post 3, fixed'));
    expect(post(3)).toHaveTextContent('Last edited');
    expect(within(post(3)).getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(within(announcer()).queryAllByText(/./u)).toHaveLength(before);
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
    const list = await within(article).findByRole('list', { name: 'Versions of this post, oldest first' });
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
    await waitFor(() => expect(within(post(3)).getByText('Fire, 2')).toBeInTheDocument());
    deliver(() => tapped().onTally?.(w.ids[2]!, { fire: 1, tea: 1 }));
    await waitFor(() => expect(within(post(3)).getByText('Tea, 1')).toBeInTheDocument());
    expect(within(post(3)).getByText('Fire, 2')).toBeInTheDocument();
    expect(within(post(2)).queryByText(/^Fire, /u)).toBeNull();
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

/* ------------------------------------------------------------------- back from the glass ---- */
/* A find waits five seconds (web/test-setup.ts), so a test is given longer than that to say what it did not find. */
describe('back from the glass, to a thread that grew meanwhile', { timeout: 15_000 }, () => {
  /** The thread opened as Back opens it: at the post that was in view, with what it showed and knew of when the reader left. */
  const returning = (w: { fake: Fake; thread: Id }, where: string, shown: number, known = shown) =>
    renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}${where}`, state: returnState({ shown, known }) });
  const scrolledTo = () => (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1);

  test('the posts that came while the reader was away wait behind the bar, and the reader is at their post', async () => {
    const w = world(5);
    w.fake.seed.post(w.thread, w.spritey, 'came while away');
    w.fake.seed.post(w.thread, w.spritey, 'and another');
    returning(w, '?page=1#post-3', 5);
    const at = await screen.findByRole('article', { name: /^Post 3 /u });
    const bar = await screen.findByRole('button', { name: '2 new posts' });
    expect(document.getElementById('post-6')).toBeNull();
    expect(scrolledTo()).toBe(at);
    expect(at).toHaveFocus();
    await userEvent.click(bar);
    await screen.findByRole('article', { name: /^Post 7 /u });
    expect(screen.queryByRole('button', { name: /new posts?$/u })).toBeNull();
  });

  test('reading on to the bottom brings them in, as it does a live post', async () => {
    const w = world(5);
    w.fake.seed.post(w.thread, w.spritey, 'came while away');
    returning(w, '?page=1#post-3', 5);
    await screen.findByRole('button', { name: '1 new post' });
    see(sentinel(), true);
    await screen.findByRole('article', { name: /^Post 6 /u });
    expect(screen.queryByRole('button', { name: /new post/u })).toBeNull();
  });

  test('on a page the thread grew past, the bar says which pages and leads to the first post that came', async () => {
    const w = world(25);
    for (let i = 26; i <= 45; i++) w.fake.seed.post(w.thread, w.spritey, `came ${i}`);
    returning(w, '?page=2#post-22', 25);
    await screen.findByRole('article', { name: /^Post 22 /u });
    const bar = await screen.findByRole('link', { name: '20 new posts on pages 2 to 3' });
    expect(bar).toHaveAttribute('href', `/t/${w.thread}?page=2#post-26`);
    expect(document.getElementById('post-26')).toBeNull();
    await userEvent.click(bar);
    await waitFor(() => expect(scrolledTo()).toBe(post(26)));
  });

  test('on an earlier page, the bar counts only the posts that came, not the pages the reader had not reached', async () => {
    const w = world(45);
    w.fake.seed.post(w.thread, w.spritey, 'came 46');
    returning(w, '?page=1#post-5', 20, 45);
    await screen.findByRole('article', { name: /^Post 5 /u });
    expect(await screen.findByRole('link', { name: '1 new post on page 3' })).toHaveAttribute('href', `/t/${w.thread}?page=3#post-46`);
  });

  test('a post edited, and a card played on one, while the reader was away show as they are now', async () => {
    const w = world(5);
    const [fourth] = await w.fake.acts(w.thread, 4, 4);
    w.fake.clock.advance(10 * 60_000);
    const edited = await w.fake.edit(fourth!.id, w.pipe, 'post 4, edited while away');
    if (!edited.ok) throw new Error(edited.error);
    w.fake.seed.card(w.spritey, fourth!.id, 'whoops');
    returning(w, '?page=1#post-3', 5);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(post(4)).toHaveTextContent('post 4, edited while away');
    expect(post(4)).toHaveTextContent('Last edited');
    /* The play is no post that came after the reader left: no bar, and its tag is on the post it landed on. */
    expect(await within(post(4)).findByRole('list', { name: 'Cards played on this post' })).toHaveTextContent('Spritey played Whoops! on this post');
    expect(screen.queryByRole('button', { name: /new posts?$/u })).toBeNull();
  });

  test('a thread opened with no return is the page as it is, and holds nothing back', async () => {
    const w = world(7);
    open(w, '#post-3', '?page=1');
    await screen.findByRole('article', { name: /^Post 7 /u });
    expect(screen.queryByRole('button', { name: /new posts?$/u })).toBeNull();
  });
});

/* ------------------------------------------------------------------------ card effects ---- */
/** An instance's card, drawing what it is given as data a test can read, around the post's words. */
function fx(key: string): CardUi {
  return {
    key, art: { color: '#000000', ink: '#ffffff' }, describe: () => `${key}`,
    Effect: ({ plays, states, released, reader, place, save, release, children }) => (
      <div
        data-testid={`fx-${key}`} data-plays={plays.map((p) => `${p.layer}:${p.message}`).join('|')} data-author={String(reader.author)} data-caster={String(reader.caster)}
        data-place={place} data-states={JSON.stringify(states)} data-released={[...released].join(',')}
      >
        <button type="button" onClick={() => void save(plays[0]!.id, { saved: key })}>save {key}</button>
        <button type="button" onClick={() => void release(plays[0]!.id)}>release {key}</button>
        {children}
      </div>
    ),
  };
}
const openWith = (w: { fake: Fake; thread: Id }, cards: readonly CardUi[]) =>
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, cards });

describe('a card\'s effect on a post', () => {
  test('a card with no CardUi draws the post untouched, and its play as its tag alone', async () => {
    const w = world(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    openWith(w, []);
    const second = await screen.findByRole('article', { name: /^Post 2 /u });
    await within(second).findByRole('list', { name: 'Cards played on this post' });
    expect(second).toHaveTextContent('post 2');
    expect(within(second).queryByTestId('fx-whoops')).toBeNull();
    expect(second.querySelector('.kb-act-main')).toHaveTextContent('Spritey played Whoops! on this post: “oops”');
  });

  test('a card the instance gives an effect wraps the post\'s words, given its plays and who the reader is', async () => {
    const w = world(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    w.fake.seed.card(w.pipe, w.ids[2]!, 'whoops', { message: 'mine' });
    openWith(w, [fx('whoops')]);
    const second = await screen.findByRole('article', { name: /^Post 2 /u });
    const wrapped = await within(second).findByTestId('fx-whoops');
    expect(wrapped).toHaveTextContent('post 2');
    expect(wrapped.getAttribute('data-plays')).toBe('1:oops');
    /* Post 2 is the reader's own character's: the author, and not a caster. Post 3 is Spritey's, played on by the reader's own. */
    expect([wrapped.dataset.author, wrapped.dataset.caster, wrapped.dataset.place]).toEqual(['true', 'false', 'thread']);
    const third = within(await screen.findByRole('article', { name: /^Post 3 /u })).getByTestId('fx-whoops');
    expect([third.dataset.author, third.dataset.caster]).toEqual(['false', 'true']);
    /* A post no card was played on is the post as it is. */
    expect(within(post(1)).queryByTestId('fx-whoops')).toBeNull();
  });

  test('each played card\'s effect wraps the one played before it, in play order, the latest outermost', async () => {
    const w = world(2);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'first' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'second' });
    openWith(w, [fx('whoops'), fx('stick-around')]);
    const outer = await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByTestId('fx-whoops');
    const inner = within(outer).getByTestId('fx-stick-around');
    expect(inner).toHaveTextContent('post 2');
    expect(within(inner).queryByTestId('fx-whoops')).toBeNull();
  });

  test('its saved state and the reader\'s release arrive with the page, in one read each, for the cards that draw an effect only', async () => {
    const w = world(2);
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const other = w.fake.seed.card(w.spritey, w.ids[1]!, 'no-effect', { message: 'plain' });
    expect((await w.fake.saveEffect(played, w.pipe, { strokes: [1] })).ok).toBe(true);
    expect((await w.fake.releaseEffect(played)).ok).toBe(true);
    const states = vi.spyOn(w.fake, 'effectStates');
    const releases = vi.spyOn(w.fake, 'myReleases');
    openWith(w, [fx('whoops')]);
    const wrapped = await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByTestId('fx-whoops');
    await waitFor(() => expect(JSON.parse(wrapped.dataset.states!)[played].state).toEqual({ strokes: [1] }));
    expect(wrapped.dataset.released).toBe(played);
    expect(states).toHaveBeenCalledTimes(1);
    expect(states.mock.calls[0]![0]).toEqual([played]);
    expect(releases).toHaveBeenCalledTimes(1);
    expect(states.mock.calls[0]![0]).not.toContain(other);
  });

  test('the author\'s save lands at once and is heard live by another reader; a release shows at once', async () => {
    const w = world(2);
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    openWith(w, [fx('whoops')]);
    const wrapped = await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByTestId('fx-whoops');
    await userEvent.click(within(wrapped).getByRole('button', { name: 'save whoops' }));
    await waitFor(() => expect(JSON.parse(wrapped.dataset.states!)[played].state).toEqual({ saved: 'whoops' }));
    expect((await w.fake.effectStates([played]))[played]?.state).toEqual({ saved: 'whoops' });
    await userEvent.click(within(wrapped).getByRole('button', { name: 'release whoops' }));
    await waitFor(() => expect(wrapped.dataset.released).toBe(played));
    expect(await w.fake.myReleases([played])).toEqual([played]);
    /* The same state saved elsewhere (another device of the author's) is heard by the broadcast and read. */
    w.fake.clock.advance(1000);
    await w.fake.saveEffect(played, w.pipe, { saved: 'from elsewhere' });
    await waitFor(() => expect(JSON.parse(wrapped.dataset.states!)[played].state).toEqual({ saved: 'from elsewhere' }));
  });

  test('a reader who is not the post\'s author cannot save: the effect is told so in the server\'s words', async () => {
    const w = world(3);
    w.fake.seed.card(w.pipe, w.ids[2]!, 'whoops', { message: 'mine' });
    openWith(w, [fx('whoops')]);
    const third = within(await screen.findByRole('article', { name: /^Post 3 /u }));
    const saved = vi.spyOn(w.fake, 'saveEffect');
    await userEvent.click(await third.findByRole('button', { name: 'save whoops' }));
    expect(saved).not.toHaveBeenCalled();
  });

  test('a play that arrives live gets its tag and its effect on a post already on screen', async () => {
    const w = world(3);
    const tapped = tap(w.fake);
    openWith(w, [fx('whoops')]);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(within(post(2)).queryByTestId('fx-whoops')).toBeNull();
    deliver(() => tapped().onAct?.(live(w.thread, 0, w.spritey, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'whoops', layer: 1, message: 'live' }, currentPayload: { card: 'whoops', layer: 1, message: 'live' } })));
    expect(await within(post(2)).findByTestId('fx-whoops')).toHaveAttribute('data-plays', '1:live');
    expect(post(2)).toHaveTextContent('Spritey played Whoops! on this post: “live”');
  });
});

/* ---------------------------------------------------------------------------- announcer ---- */
describe('the announcer', () => {
  test('says each new post once, however many times it arrives, and no reaction or edit', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    const region = announcer();
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

  test('stays silent for a card, an unmask and a tally: the card is a tag, the others still appear', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 0, w.pipe, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'whoops' }, currentPayload: { card: 'whoops' } })));
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.pipe, { kind: 'unmask', payload: { class: 'heel', message: '' }, currentPayload: { class: 'heel', message: '' } })));
    deliver(() => tapped().onAct?.(live(w.thread, 7, null, { kind: 'tally', payload: { body: 'x' }, currentPayload: { body: 'x' } })));
    await screen.findByRole('article', { name: /^Post 7 by The System/u });
    expect(post(6)).toBeInTheDocument();
    expect(await within(post(2)).findByRole('list', { name: 'Cards played on this post' })).toBeInTheDocument();
    expect(announcer()).toBeEmptyDOMElement();
    deliver(() => tapped().onAct?.(live(w.thread, 8, w.spritey)));
    await waitFor(() => expect(announcer()).toHaveTextContent('New post by Spritey'));
  });

  test('says it for a post held back by the bar too, since the reader cannot see it', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), false);
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.pipe)));
    await waitFor(() => expect(announcer()).toHaveTextContent('New post by Pipewrench'));
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


/* ------------------------------------------------------- from the Task 5 quality review ---- */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const UNKNOWN = '00000000-0000-4000-8000-00000000ffff';

describe('a gap in the live Acts', () => {
  test('an Act every 500 ms past a gap does not keep the gap from being read', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    clock();
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    const read = vi.spyOn(w.fake, 'acts');
    w.fake.seed.post(w.thread, w.pipe, 'post 6');
    w.fake.seed.post(w.thread, w.spritey, 'post 7');
    const seven = (await w.fake.acts(w.thread, 7, 7))[0]!;
    read.mockClear();
    deliver(() => tapped().onAct?.(seven));
    for (let seq = 8; seq <= 12; seq++) {
      await advance(500);
      deliver(() => tapped().onAct?.(live(w.thread, seq, w.pipe)));
    }
    expect(read).toHaveBeenCalledWith(w.thread, 6, expect.any(Number));
    await screen.findByRole('article', { name: /^Post 6 /u });
  });

  test('when the gap cannot be read, the bar offers the held posts, and clicking shows them', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    clock();
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    const read = vi.spyOn(w.fake, 'acts').mockRejectedValue(new Error('down'));
    deliver(() => tapped().onAct?.(live(w.thread, 7, w.spritey)));
    await advance(50);
    await advance(GAP_FILL_MS + 100);
    expect(read).toHaveBeenCalled();
    const bar = await screen.findByRole('button', { name: '1 new post' });
    expect(document.getElementById('post-7')).toBeNull();
    await userEvent.click(bar);
    await screen.findByRole('article', { name: /^Post 7 /u });
    expect(screen.queryByRole('button', { name: /new post/u })).toBeNull();
  });

  test('a gap read that failed is tried again, with longer waits, until it fills', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    clock();
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    w.fake.seed.post(w.thread, w.pipe, 'post 6');
    w.fake.seed.post(w.thread, w.spritey, 'post 7');
    const seven = (await w.fake.acts(w.thread, 7, 7))[0]!;
    const real = w.fake.acts.bind(w.fake);
    const read = vi.spyOn(w.fake, 'acts').mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down')).mockImplementation(real);
    deliver(() => tapped().onAct?.(seven));
    await advance(50);
    await advance(GAP_FILL_MS + 50);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(GAP_FILL_MS + 50);
    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
    await advance(GAP_FILL_MS * 4);
    await screen.findByRole('article', { name: /^Post 6 /u });
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('an Act read while its author is read', () => {
  test('an edited version is not overwritten by the original arriving late', async () => {
    const w = world(5);
    const stranger = w.fake.seed.character(w.fake.seed.account('stranger'), 'Newcomer', 'face');
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    let open_!: () => void;
    const gate = new Promise<void>((r) => { open_ = r; });
    const real = w.fake.characters.bind(w.fake);
    vi.spyOn(w.fake, 'characters').mockImplementation(async (ids) => { await gate; return real(ids); });
    const original = live(w.thread, 6, stranger);
    const edited = { ...original, currentPayload: { body: 'edited words' }, editedAt: '2026-10-29T13:00:00Z', shownEditedAt: '2026-10-29T13:00:00Z' };
    deliver(() => { tapped().onAct?.(original); tapped().onAct?.(edited); tapped().onAct?.(original); });
    open_();
    const added = await screen.findByRole('article', { name: /^Post 6 /u });
    expect(added).toHaveTextContent('edited words');
    expect(added).not.toHaveTextContent('live 6');
  });
});

describe('quotes and tallies off the page', () => {
  const quoting = (n: number) => {
    const w = world(2);
    const other = w.fake.seed.thread('general', w.spritey, 'Elsewhere', 'x');
    const quoted = Array.from({ length: n }, (_, i) => w.fake.seed.post(other.thread, w.pipe, `elsewhere ${i}`));
    for (const q of quoted) w.fake.seed.post(w.thread, w.pipe, `[quote=${q}]x[/quote]`);
    return { w, other, quoted };
  };

  test('a page of quotes of other threads is one read', async () => {
    const { w, other } = quoting(5);
    const many = vi.spyOn(w.fake, 'actsById');
    const one = vi.spyOn(w.fake, 'act');
    open(w);
    await screen.findByRole('article', { name: /^Post 7 /u });
    await waitFor(() => expect(screen.getAllByRole('link', { name: /^Post #/u })).toHaveLength(5));
    expect(many).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link', { name: 'Post #2' })[0]).toHaveAttribute('href', `/t/${other.thread}?page=1#post-2`);
  });

  test('a quote whose read failed is asked again on a later render', async () => {
    const { w } = quoting(1);
    const many = vi.spyOn(w.fake, 'actsById').mockRejectedValueOnce(new Error('down'));
    const first = open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(many).toHaveBeenCalledTimes(1));
    await pause(30);
    expect(within(reply).queryByRole('link', { name: /^Post #/u })).toBeNull();
    expect(reply).toHaveTextContent('Quoted post');
    first.unmount();
    renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}` });
    const again = await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(within(again).getByRole('link', { name: 'Post #2' })).toBeInTheDocument());
  });

  test('a quote of an Act that does not exist says "Quoted post" and links nowhere, and is not asked about again', async () => {
    const w = world(2);
    w.fake.seed.post(w.thread, w.pipe, `[quote=${UNKNOWN}]gone[/quote]reply`);
    const many = vi.spyOn(w.fake, 'actsById');
    open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(many).toHaveBeenCalledTimes(1));
    await pause(30);
    expect(reply).toHaveTextContent('Quoted post');
    expect(within(reply).queryByRole('link', { name: /^Post #/u })).toBeNull();
    expect(await actLoader(w.fake).ask(UNKNOWN)).toBeNull();
    expect(many).toHaveBeenCalledTimes(1);
  });

  test('tallies on Acts of other pages are one read for the author of each, in one call', async () => {
    const w = world(45);
    const tapped = tap(w.fake);
    open(w, '', '?page=1');
    await screen.findByRole('article', { name: /^Post 20 /u });
    const many = vi.spyOn(w.fake, 'actsById');
    const one = vi.spyOn(w.fake, 'act');
    landed.mockClear();
    deliver(() => { for (const i of [40, 41, 42, 43]) tapped().onTally?.(w.ids[i]!, { fire: 1 }); });
    await waitFor(() => expect(landed).toHaveBeenCalled());
    expect(many).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
  });

  test('what is remembered of the Acts read is bounded, the oldest asked for forgotten first', async () => {
    const w = world(2);
    const loader = actLoader(w.fake);
    const many = vi.spyOn(w.fake, 'actsById');
    const first = w.ids[0]!;
    await loader.ask(first);
    for (let i = 0; i < ACT_CACHE_SIZE + 5; i++) await loader.ask(`ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`);
    many.mockClear();
    await loader.ask(w.ids[1]!);
    expect(many).toHaveBeenCalledTimes(1);
    many.mockClear();
    await loader.ask(first);
    expect(many).toHaveBeenCalledTimes(1);
    many.mockClear();
    await loader.ask(first);
    expect(many).not.toHaveBeenCalled();
  });
});

describe('what a tally storm and a long post cost', () => {
  test('a storm of tallies re-renders the post it lands on and no other post body', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), false);
    await pause(30);
    const before = drawn.bodies.length;
    /* A live post held by the bar changes the page itself in the middle of the storm. */
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.spritey)));
    for (let i = 1; i <= 30; i++) {
      deliver(() => tapped().onTally?.(w.ids[1]!, { fire: i }));
      if (i === 15) deliver(() => tapped().onAct?.(live(w.thread, 7, w.pipe)));
    }
    await waitFor(() => expect(within(post(2)).getByText('Fire, 30')).toBeInTheDocument());
    await screen.findByRole('button', { name: '2 new posts' });
    expect(drawn.bodies.length).toBe(before);
    expect(within(post(3)).queryByText(/^Fire, /u)).toBeNull();
  });

  test('a 20,000-character post is drawn once and parsed once, whatever happens around it', async () => {
    const w = world(2, { postMaxLength: 30_000 });
    const long = `${'word '.repeat(3999)}end`;
    expect(long.length).toBeGreaterThan(19_000);
    w.fake.seed.post(w.thread, w.pipe, long);
    const tapped = tap(w.fake);
    open(w);
    const article = await screen.findByRole('article', { name: /^Post 3 /u });
    see(sentinel(), false);
    deliver(() => tapped().onAct?.(live(w.thread, 4, w.spritey)));
    deliver(() => tapped().onTally?.(w.ids[1]!, { fire: 1 }));
    deliver(() => tapped().onTally?.(w.ids[0]!, { fire: 1 }));
    await screen.findByRole('button', { name: '1 new post' });
    expect(drawn.bodies.filter((t) => t === long)).toHaveLength(1);
    expect(drawn.parses.filter((t) => t === long)).toHaveLength(1);
    expect(article.querySelector('.kb-bb')).toHaveTextContent(/end$/u);
  });
});

describe('reading when it cannot be sent', () => {
  test('a read that fails while the reader signs out is caught, not left to throw on its own', async () => {
    const w = world(10);
    /* A rejection nobody handles surfaces in the browser; one `.then` or `.catch` is called on is handled. */
    const failed = Promise.reject(new Error('signed out'));
    failed.catch(() => { /* this one is the test's own */ });
    const asked = vi.spyOn(failed, 'then');
    const sent: unknown[][] = [];
    /* Assigned, not spied: a spy attaches a handler of its own and would hide the defect. */
    w.fake.markRead = ((...a: unknown[]) => { sent.push(a); return failed; }) as unknown as typeof w.fake.markRead;
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    await watched(post(10));
    clock();
    see(post(7));
    asked.mockClear();
    act(() => { w.fake.signInAs(null); });
    await debounced();
    await screen.findByRole('link', { name: 'Sign in' });
    expect(sent[0]!.slice(0, 2)).toEqual([w.thread, 7]);
    expect(asked).toHaveBeenCalled();
  });

  test('a read that failed is sent again with the next position', async () => {
    const w = world(10);
    const spy = vi.spyOn(w.fake, 'markRead').mockRejectedValueOnce(new Error('down'));
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    await watched(post(10));
    clock();
    see(post(4));
    await debounced();
    await advance(10);
    see(post(4));
    await debounced();
    expect(spy.mock.calls.map((c) => c[1])).toEqual([4, 4]);
  });
  test('a read the server refused is sent again with the next position', async () => {
    const w = world(10);
    const spy = vi.spyOn(w.fake, 'markRead').mockResolvedValueOnce(false);
    open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    await watched(post(10));
    clock();
    see(post(4));
    await debounced();
    await advance(10);
    see(post(4));
    await debounced();
    expect(spy.mock.calls.map((c) => c[1])).toEqual([4, 4]);
  });
});

describe('the observers', () => {
  test('a thread has one observer for what is read and one for the bottom, however many posts, and leaving lets go of both', async () => {
    const w = world(20);
    const tapped = tap(w.fake);
    const { unmount } = open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    await watched(post(20));
    expect(MockObserver.all).toHaveLength(2);
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 21, w.spritey)));
    await screen.findByRole('article', { name: /^Post 21 /u });
    await watched(post(21));
    expect(MockObserver.all).toHaveLength(2);
    const reading = MockObserver.all.find((o) => o.els.has(post(1)))!;
    expect(reading.els.size).toBe(21);
    unmount();
    for (const o of MockObserver.all) { expect(o.els.size).toBe(0); expect(o.gone).toBe(true); }
  });
});

describe('landmarks and focus', () => {
  test('each post has a heading that names its author and number', async () => {
    const w = world(3);
    open(w);
    const article = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    expect(within(article).getByRole('heading', { level: 2, name: 'Post 2 by Pipewrench' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
  });

  test('the History button controls the list it opens', async () => {
    const w = world(3);
    const mine = (await w.fake.myCharacters())[0]!.id;
    const made = await w.fake.post(w.thread, mine, 'first words', null);
    if (!made.ok) throw new Error(made.error);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(made.value.id, mine, 'second words');
    open(w);
    const article = await screen.findByRole('article', { name: /^Post 4 /u });
    const button = within(article).getByRole('button', { name: 'History' });
    const controlled = button.getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(controlled!)).toContainElement(await within(article).findByRole('list', { name: 'Versions of this post, oldest first' }));
  });

  test('"Continue" that loads nothing leaves focus on the last post and not on the page', async () => {
    const w = world(25);
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    const real = w.fake.acts.bind(w.fake);
    vi.spyOn(w.fake, 'acts').mockImplementation(async (t, a, b) => (a === 21 ? [] : real(t, a, b)));
    const link = screen.getAllByRole('link', { name: 'Continue to page 2' })[0]!;
    link.focus();
    await userEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Continue to page 2' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(post(20)));
  });
});

describe('the tally store keeps no empty sets', () => {
  test('a key with no listener left is gone', () => {
    const t = createTallies();
    const off = t.subscribe('a', () => {});
    const off2 = t.subscribe('a', () => {});
    expect(t.listening()).toBe(1);
    off();
    expect(t.listening()).toBe(1);
    off2();
    expect(t.listening()).toBe(0);
    t.subscribe('a', () => {})();
    expect(t.listening()).toBe(0);
  });
});
