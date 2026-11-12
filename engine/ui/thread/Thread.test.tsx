import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import type { CardUi } from '../cards/types.ts';
import type { Act, Id, ThreadListener } from '../data/api.ts';
import { landsOn } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, holdReads, renderIn, testInstance } from '../test-world.tsx';
import { pageOf, pageRange, threadHref } from './pages.ts';
import { createTallies } from './tallies.ts';
import { GAP_FILL_MS, GAP_RETRY_MAX_MS, READ_DEBOUNCE_MS, ThreadScreen } from './Thread.tsx';
import { ACT_CACHE_SIZE, actLoader } from './locate.tsx';
import { returnState } from '../glass/back.ts';
import { useNavigation } from '../router.tsx';
import { LoadedThread } from '../loaded.tsx';
import { spunLoader } from '../spin/spun.ts';
import { SIGNED_OUT_DOC } from '../screen-docs.ts';
import { tokensOf } from '../contrast.ts';
import { POST_INK } from '../shine/band.ts';
import { cling, landAll, loose, makeFlakes } from '../shine/flakes.ts';
import { probe } from '../shine/landing.ts';

/* The HUD's estimate is asked for through the player; this test file watches that call. */
const landed = vi.hoisted(() => vi.fn());
vi.mock('../player.tsx', async (original) => {
  const m = await original<typeof import('../player.tsx')>();
  return { ...m, usePlayer: () => ({ ...m.usePlayer(), reactionLanded: landed }) };
});

/* Glitter's landing places: the real ones, counted, so a test can ask what is registered and what has been let go. */
const landing = vi.hoisted(() => ({ posts: new Set<HTMLElement>(), pages: 0, pageCalls: 0 }));
vi.mock('../shine/landing.ts', async (original) => {
  const m = await original<typeof import('../shine/landing.ts')>();
  return {
    ...m,
    landPost: (article: HTMLElement) => {
      const off = m.landPost(article);
      landing.posts.add(article);
      return () => { landing.posts.delete(article); off(); };
    },
    landPage: () => {
      const off = m.landPage();
      landing.pages++; landing.pageCalls++;
      return () => { landing.pages--; off(); };
    },
  };
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
  landing.posts.clear(); landing.pages = 0; landing.pageCalls = 0;
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
function world(acts: number, settings: Parameters<typeof buildWorld>[0] = undefined, instance?: Parameters<typeof buildWorld>[1]) {
  const fake = buildWorld(settings, instance);
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
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}${query}${hash}` });

/** Capture the thread's live listener so a test can deliver events as the server would, twice or out of order. */
function tap(fake: Fake) {
  let listener: ThreadListener | undefined;
  /* The screen subscribes after its first render (in a passive effect), so an event asked for earlier waits for it. */
  const waiting: ((l: ThreadListener) => void)[] = [];
  const real = fake.subscribeThread.bind(fake);
  fake.subscribeThread = (t, l) => {
    listener = l;
    const off = real(t, l);
    for (const call of waiting.splice(0)) call(l);
    return off;
  };
  const proxy: ThreadListener = {
    onAct: (a) => (listener ? listener.onAct?.(a) : void waiting.push((l) => l.onAct?.(a))),
    onTally: (act, t) => (listener ? listener.onTally?.(act, t) : void waiting.push((l) => l.onTally?.(act, t))),
    onEffect: (p, at) => (listener ? listener.onEffect?.(p, at) : void waiting.push((l) => l.onEffect?.(p, at))),
  };
  return () => proxy;
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
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}?page=99` });
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

  test('a page is one threadPage read, and none of the reads it replaces: the Acts, characters, stats, standings, reveals, turns, tallies, board, preferences or reading', async () => {
    const w = world(20);
    const page = vi.spyOn(w.fake, 'threadPage');
    const names = ['acts', 'characters', 'characterStats', 'standingAmounts', 'classReveals', 'turnsAnnounced', 'tallies', 'myReactions', 'cardsOnMany', 'effectsAbove', 'board', 'boards', 'preferences', 'reading', 'following', 'standingsPage'] as const;
    const spies = names.map((m) => [m, vi.spyOn(w.fake, m)] as const);
    /* The page is read twice: once for the document, and once more by the catch-up when the channels are joined. The summary is no longer read. */
    const summary = vi.spyOn(w.fake, 'thread');
    open(w);
    await screen.findByRole('article', { name: /^Post 20 /u });
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    await act(async () => { await pause(20); });
    expect(page).toHaveBeenCalledTimes(2);
    expect(summary).not.toHaveBeenCalled();
    expect(spies.map(([name, spy]) => [name, spy.mock.calls.length])).toEqual(names.map((n) => [n, 0]));
  });

  test('a thread that is not there is the router\'s "cannot be found" (no document), which leads back', async () => {
    const w = world(3);
    renderIn(w.fake, <LoadedThread thread="00000000-0000-4000-8000-00000000ffff" />, { path: '/t/00000000-0000-4000-8000-00000000ffff' });
    expect(await screen.findByRole('heading', { level: 1, name: 'The thread you requested does not exist.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Click here to return to the index' })).toHaveAttribute('href', '/');
  });

  test('a visitor who is not signed in sees the front door', async () => {
    const w = world(3);
    w.fake.signInAs(null);
    open(w);
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(screen.queryByText(/The board is for players\./u)).toBeNull();
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

describe('the thread\'s crumb, post cells and bottom row (the board look, Task 6)', () => {
  test('the crumb is Index, the thread\'s board as a link, then the thread', async () => {
    const w = world(3);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    const crumb = document.querySelector('.kb-crumb')!;
    expect(crumb).toHaveTextContent('Index › General › A long thread');
    expect(within(crumb as HTMLElement).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
    expect(within(crumb as HTMLElement).getByRole('link', { name: 'Index' })).toHaveAttribute('href', '/');
  });

  test('with no board on the thread\'s document, the crumb\'s board comes from the frame\'s board list by the thread\'s board', async () => {
    const w = world(3);
    const boot = await w.fake.boot();
    const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    renderIn(w.fake, <ThreadScreen thread={w.thread} doc={{ ...doc, board: null }} />, { path: `/t/${w.thread}?page=1`, boot });
    await screen.findByRole('article', { name: /^Post 3 /u });
    const crumb = document.querySelector<HTMLElement>('.kb-crumb')!;
    const general = boot.boards.find((b) => b.id === doc.thread.board)!;
    expect(crumb).toHaveTextContent(`Index › ${general.name} › A long thread`);
    expect(within(crumb).getByRole('link', { name: general.name })).toHaveAttribute('href', `/b/${general.slug}`);
  });

  test('a post is three cells beside its postbit: the post line holds the time and permalink and none of the words, the words hold the words, the actions the buttons', async () => {
    const w = world(3);
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 /u });
    const cells = [...second.children].filter((c) => c.hasAttribute('data-kb-cell'));
    expect(cells.map((c) => c.getAttribute('data-kb-cell'))).toEqual(['line', 'words', 'actions']);
    const [line, words, actions] = cells as HTMLElement[];
    expect(line).toContainElement(within(second).getByRole('link', { name: 'Permalink to post #2' }));
    expect(line!.querySelector('time')).not.toBeNull();
    expect(line).not.toHaveTextContent('post 2');
    expect(words).toHaveTextContent('post 2');
    expect(within(actions!).getByRole('button', { name: 'Quote' })).toBeInTheDocument();
    expect(second.querySelector('.kb-postbit')!.parentElement).toBe(second);
  });

  test('a post\'s row color follows its seq, not its place on the page: an odd page opened at 41 starts on odd', async () => {
    const w = world(45);
    open(w, '', '?page=3');
    await screen.findByRole('article', { name: /^Post 41 /u });
    expect(post(41)).toHaveAttribute('data-kb-parity', 'odd');
    expect(post(42)).toHaveAttribute('data-kb-parity', 'even');
    expect(post(45)).toHaveAttribute('data-kb-parity', 'odd');
  });

  test('Unfollow shares the bottom pager\'s row, after it', async () => {
    const w = world(45);
    open(w, '', '?page=3');
    await screen.findByRole('article', { name: /^Post 41 /u });
    const pager = screen.getByRole('navigation', { name: 'Pages, bottom' });
    const follow = screen.getByRole('button', { name: /^(Un)?[Ff]ollow this thread$/u });
    expect(follow.closest('.kb-thread-controls')!.parentElement).toBe(pager.parentElement);
    expect(pager.parentElement).toHaveClass('kb-thread-below');
    expect(pager.compareDocumentPosition(follow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  test('a null-character Act has the staff word for a name (staffWord) and no postbit', async () => {
    const w = world(1);
    const sys = w.fake.seed.thread('announcements', null, 'Tally', 'Tonight, the board turns.');
    renderIn(w.fake, <LoadedThread thread={sys.thread} />, { path: `/t/${sys.thread}` });
    const article = await screen.findByRole('article', { name: /^Post 1 by the staff/u });
    expect(within(article).queryByRole('group')).toBeNull();
    expect(article).toHaveTextContent('Tonight, the board turns.');
  });

  test('a staff post\'s reaction picker reads "React to the staff\'s post", the name slot staying "The staff"', async () => {
    const w = world(1);
    const sys = w.fake.seed.thread('announcements', null, 'Tally', 'Tonight, the board turns.');
    renderIn(w.fake, <LoadedThread thread={sys.thread} />, { path: `/t/${sys.thread}` });
    const article = await screen.findByRole('article', { name: /^Post 1 by the staff/u });
    expect(article.querySelector('.kb-postbit-name')).toHaveTextContent(/^The staff$/u);
    await userEvent.click(within(article).getByRole('button', { name: /React/u }));
    expect(await screen.findByRole('dialog', { name: "React to the staff's post" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------- acts that are not posts ---- */
describe('Acts that are not posts', () => {
  test('a card play is a mark on its post, naming the card, and never a line of its own', async () => {
    const w = world(3);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, null as unknown as number, w.pipe, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'whoops', layer: 1, message: 'oops' }, currentPayload: { card: 'whoops', layer: 1, message: 'oops' }, createdAt: '2026-10-29T21:16:00Z' })));
    const mark = await within(post(2)).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' });
    /* The mark has no words on it: the caster's words, who and when are the Lens's. */
    expect(mark.textContent).not.toMatch(/\boops|Pipewrench/u);
    /* No line of its own: still three posts, and no other post carries the mark. */
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(post(3).querySelector('.kb-mark')).toBeNull();
    expect(screen.queryByRole('button', { name: /new posts?$/u })).toBeNull();
  });

  test('a play already on a post is its mark when the page opens, read for the whole page in one request, and the posts keep their numbers', async () => {
    const w = world(4);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'first' });
    const next = w.fake.seed.post(w.thread, w.spritey, 'after the card');
    w.fake.seed.card(w.pipe, w.ids[2]!, 'whoops', { message: 'second' });
    const page = vi.spyOn(w.fake, 'threadPage');
    const many = vi.spyOn(w.fake, 'cardsOnMany');
    const one = vi.spyOn(w.fake, 'cardsOn');
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    expect(post(5)).toHaveTextContent('after the card');
    expect((await w.fake.act(next))?.seq).toBe(5);
    expect(await within(post(2)).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
    expect(await within(post(3)).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    /* The whole page's plays are in the page's own document: one request, whatever the plays, and the catch-up's read of it again once the channels are joined. */
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    await act(async () => { await pause(20); });
    expect(page).toHaveBeenCalledTimes(2);
    expect(many).not.toHaveBeenCalled();
    expect(one).not.toHaveBeenCalled();
  });

  test('plays of several cards on one post are several marks, in billing order: with nothing drawn yet, the newest first', async () => {
    const w = world(2);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'one' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'two' });
    open(w);
    await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(billed(2)).toEqual(['stick-around:1', 'whoops:1']));
  });

  test('an unmask says who revealed which class, and its message', async () => {
    const w = world(2);
    w.fake.seed.reveal(w.pipe, w.thread, { class: 'heel', message: 'It was me.' });
    open(w);
    const line = await screen.findByRole('article', { name: /^Post 3 /u });
    expect(line).toHaveTextContent('Pipewrench revealed: Heel');
    expect(line).toHaveTextContent('It was me.');
  });

  test('an announce is a character\'s own Act: its line, its postbit, its reactions, and a thread can be spun from it', async () => {
    const w = world(1);
    w.fake.seed.season({ number: 1 });
    const announced = w.fake.seed.announce(w.spritey, 'turn', { was: 'face', class: 'heel' });
    w.fake.seed.react(w.me, w.pipe, announced, 'fire');
    const promos = (await w.fake.actsById([announced]))[0]!.thread;
    renderIn(w.fake, <LoadedThread thread={promos} />, { path: `/t/${promos}` });
    const line = await screen.findByRole('article', { name: /^Post 1 by Spritey/u });
    expect(line).toHaveTextContent('Spritey has Turned from Face to Heel.');
    expect(line.querySelector('.kb-postbit-avatar')).not.toBeNull();
    expect(line.querySelector('[data-kb-reaction="fire"]')).toHaveTextContent('1');
    const user = userEvent.setup();
    await user.click(within(line).getByRole('button', { name: 'Spin thread' }));
    expect(await screen.findByRole('form', { name: 'Spin a thread from post 1' })).toBeInTheDocument();
  });

  test('The System\'s tally lists debuts and announced Turns by name and class', async () => {
    const w = world(1);
    const sys = w.fake.seed.thread('announcements', null, 'Tally', '');
    w.fake.seed.post(sys.thread, null, '', { payload: { debuts: [{ character: w.spritey, name: 'Spritey', class: 'face' }, { character: w.pipe, name: 'Pipewrench' }], turns: [{ character: w.pipe, name: 'Pipewrench', loudness: 'announced', was: 'face', class: 'heel' }] } });
    renderIn(w.fake, <LoadedThread thread={sys.thread} />, { path: `/t/${sys.thread}` });
    const line = await screen.findByRole('article', { name: /^Post 2 by the staff/u });
    expect(line).toHaveTextContent('Spritey debuts as Face');
    expect(line).toHaveTextContent('Pipewrench debuts');
    expect(line).toHaveTextContent('Pipewrench has Turned from Face to Heel');
  });

  test('a spun thread opens on an ORIGIN box that links to its origin', async () => {
    const w = world(3);
    const spun = await w.fake.spin(w.ids[1]!, (await w.fake.myCharacters())[0]!.id, 'Spun off', 'Taking this elsewhere.');
    if (!spun.ok) throw new Error(spun.error);
    renderIn(w.fake, <LoadedThread thread={spun.value.thread.id} />, { path: `/t/${spun.value.thread.id}` });
    const first = await screen.findByRole('article', { name: /^Post 1 /u });
    const origin = within(first).getByRole('group', { name: 'Origin' });
    expect(within(origin).getByRole('link', { name: /#2 in A long thread/u })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    expect(first).toHaveTextContent('Taking this elsewhere.');
  });
});

/* ------------------------------------------------------------------------------ quoting ---- */
/* The marks on a post, in the order they are drawn: each card kind and how many plays of it the post carries. */
const billed = (seq: number) => [...post(seq).querySelectorAll('.kb-mark[data-kb-card]')].map((el) => `${el.getAttribute('data-kb-card')}:${el.getAttribute('data-kb-plays')}`);

describe('the plays on a post: their tallies, own reactions and spins, read with the page', () => {
  /* Three plays on post 2, a minute apart: Spritey's, then Pipewrench's, then Spritey's again. */
  function played(acts = 3) {
    const w = world(acts);
    const first = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'one' });
    w.fake.clock.advance(60_000);
    const second = w.fake.seed.card(w.pipe, w.ids[1]!, 'stick-around', { message: 'two' });
    w.fake.clock.advance(60_000);
    const third = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'three', layer: 2 });
    return { ...w, first, second, third };
  }

  test('a page whose post has three plays is one document, with their tallies and the player\'s own reactions in it and no read for them', async () => {
    const w = played();
    const page = vi.spyOn(w.fake, 'threadPage');
    const tallies = vi.spyOn(w.fake, 'tallies');
    const own = vi.spyOn(w.fake, 'myReactions');
    open(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(billed(2)).toHaveLength(2));
    /* The document, and the catch-up's read of the page again. */
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    expect(tallies).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
    const doc = await page.mock.results[0]!.value;
    for (const play of [w.first, w.second, w.third, w.ids[1]]) expect(doc.tallies).toHaveProperty(play!);
  });

  test('the play that has drawn the most is billed first; with no draws the newest is', async () => {
    const w = played();
    open(w);
    await waitFor(() => expect(billed(2)).toHaveLength(2));
    expect(billed(2)).toEqual(['whoops:2', 'stick-around:1']);
  });

  test('a play\'s reactions and the threads spun from it are what it has drawn', async () => {
    const w = played();
    w.fake.seed.react(w.me, w.pipe, w.first, 'fire');
    w.fake.seed.react(w.other, w.spritey, w.second, 'fire');
    await w.fake.spin(w.second, w.pipe, 'From the second play', '');
    open(w);
    await waitFor(() => expect(billed(2)).toHaveLength(2));
    expect(billed(2)).toEqual(['stick-around:1', 'whoops:2']);
  });

  test('a live reaction that makes a later play the most drawn leaves the order as it was, and a reread of the page reorders it', async () => {
    const w = played(25);
    const tapped = tap(w.fake);
    const page = vi.spyOn(w.fake, 'threadPage');
    open(w);
    await waitFor(() => expect(billed(2)).toHaveLength(2));
    expect(billed(2)).toEqual(['whoops:2', 'stick-around:1']);
    /* The catch-up's read of the page bills the post again, so it is taken in before the reactions land: on a slow machine it came after them and read them. */
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    await act(async () => { await page.mock.results[1]!.value; });
    w.fake.seed.react(w.other, w.spritey, w.second, 'fire');
    w.fake.seed.react(w.other, w.spritey, w.second, 'tea');
    deliver(() => tapped().onTally?.(w.second, { fire: 1, tea: 1 }));
    /* The count grows in place, from the same store the posts' tallies are kept in: the play has drawn more than its post, and its mark does not move. */
    await waitFor(() => expect(post(2).querySelector('[data-kb-card="stick-around"]')).toHaveAccessibleName(/One has more reactions than the post\.$/u));
    expect(billed(2)).toEqual(['whoops:2', 'stick-around:1']);
    await userEvent.click(screen.getAllByRole('link', { name: 'Page 2' })[0]!);
    await screen.findByRole('article', { name: /^Post 21 /u });
    await userEvent.click(screen.getAllByRole('link', { name: 'Page 1' })[0]!);
    await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(billed(2)).toHaveLength(2));
    expect(billed(2)).toEqual(['stick-around:1', 'whoops:2']);
  });

  test('two posts with plays are one document, with the plays and the threads spun from them in it: no read of the plays or the spins, one per post or play or in chunks', async () => {
    const w = played(4);
    w.fake.seed.card(w.spritey, w.ids[3]!, 'whoops', { message: 'on four' });
    await w.fake.spin(w.second, w.pipe, 'From the second play', '');
    const page = vi.spyOn(w.fake, 'threadPage');
    const many = vi.spyOn(w.fake, 'cardsOnMany');
    const spins = vi.spyOn(w.fake, 'spunFromMany');
    const one = vi.spyOn(w.fake, 'spunFrom');
    open(w);
    await waitFor(() => expect(billed(4)).toHaveLength(1));
    expect(billed(2)).toHaveLength(2);
    /* The document, and the catch-up's read of the page again. */
    await waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    expect(many).not.toHaveBeenCalled();
    expect(spins).not.toHaveBeenCalled();
    expect(one).not.toHaveBeenCalled();
    /* What the line under the play that was spun from draws is the document's own answer. */
    expect(spunLoader(w.fake).peek(w.second)?.threads.map((t) => t.title)).toEqual(['From the second play']);
  });

  test('a play of a new card that arrives live is billed last, however new it is', async () => {
    const w = played();
    const tapped = tap(w.fake);
    open(w);
    await waitFor(() => expect(billed(2)).toHaveLength(2));
    expect(billed(2)).toEqual(['whoops:2', 'stick-around:1']);
    const late = live(w.thread, null as unknown as number, w.pipe, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'late-card', layer: 3, message: 'late' }, currentPayload: { card: 'late-card', layer: 3, message: 'late' }, createdAt: '2026-11-01T00:00:00Z' });
    deliver(() => tapped().onAct?.(late));
    await waitFor(() => expect(billed(2)).toHaveLength(3));
    expect(billed(2)).toEqual(['whoops:2', 'stick-around:1', 'late-card:1']);
  });
});

describe('quote heads', () => {
  const GHOST = '33333333-3333-4333-8333-333333333333';

  test('a real quote names its author and links both the profile and the post', async () => {
    const w = world(2);
    w.fake.seed.post(w.thread, w.pipe, `[quote=${w.ids[0]}]post 1[/quote]I agree.`);
    open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    const head = await waitFor(() => {
      const h = reply.querySelector('blockquote cite')!;
      expect(within(h as HTMLElement).getByRole('link', { name: 'Spritey' })).toBeInTheDocument();
      return h as HTMLElement;
    });
    expect(within(head).getByRole('link', { name: 'Spritey' })).toHaveAttribute('href', `/c/${w.spritey}`);
    expect(within(head).getByRole('link', { name: 'Post #1' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-1`);
  });

  test('a counterfeit names the character, has no link and carries the mark', async () => {
    const w = world(2);
    w.fake.seed.post(w.thread, w.pipe, `[quote=Geno user=${w.spritey}]never said it[/quote]`);
    open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    const quote = reply.querySelector('blockquote')!;
    expect(quote).toHaveAttribute('data-kb-counterfeit');
    await waitFor(() => expect(quote.querySelector('cite')).toHaveTextContent('Spritey'));
    expect(quote.querySelector('cite')).not.toHaveTextContent('Geno');
    expect(quote.querySelector('cite a')).toBeNull();
  });

  test('an unknown user and an undebuted one both fall back to the typed name, alike', async () => {
    const w = world(2);
    const shy = w.fake.seed.character(w.other, 'Shy', 'face', { debuted: false });
    w.fake.seed.post(w.thread, w.pipe, `[quote=Geno user=${GHOST}]a[/quote][quote=Geno user=${shy}]b[/quote]`);
    const read = vi.spyOn(w.fake, 'characters');
    open(w);
    const reply = await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(read).toHaveBeenCalled());
    await waitFor(() => expect(reply.querySelectorAll('blockquote cite .kb-byline-name')).toHaveLength(2));
    const names = [...reply.querySelectorAll('blockquote cite')].map((c) => c.innerHTML);
    expect(names[0]).toBe(names[1]);
    expect(names[0]).toContain('Geno');
    expect(reply.querySelector('blockquote cite a')).toBeNull();
    expect(reply).not.toHaveTextContent('Shy');
  });

  test('a page of ten counterfeit quotes asks for characters once', async () => {
    const w = world(2);
    const others = Array.from({ length: 10 }, (_, i) => w.fake.seed.character(w.other, `Extra ${i}`, 'face'));
    for (const c of others) w.fake.seed.post(w.thread, w.pipe, `[quote=Geno user=${c}]x[/quote]`);
    const read = vi.spyOn(w.fake, 'characters');
    open(w);
    await screen.findByRole('article', { name: /^Post 12 /u });
    await waitFor(() => expect(screen.getAllByText(/^Extra \d$/u)).toHaveLength(10));
    const asked = read.mock.calls.filter(([ids]) => ids.some((id) => others.includes(id)));
    expect(asked).toHaveLength(1);
  });
});

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
     one, so the page's read is stubbed to leave it out, as the server's reads leave cards out. */
  const withoutSeq = (w: ReturnType<typeof world>, gone: number) => {
    const real = w.fake.threadPage.bind(w.fake);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (...args) => {
      const page = await real(...args);
      return page && { ...page, acts: page.acts.filter((x) => x.seq !== gone) };
    });
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
    await waitFor(() => expect(within(post(3)).getByRole('button', { name: /^Fire, 2\./u })).toBeInTheDocument());
    deliver(() => tapped().onTally?.(w.ids[2]!, { fire: 1, tea: 1 }));
    await waitFor(() => expect(within(post(3)).getByRole('button', { name: /^Tea, 1\./u })).toBeInTheDocument());
    expect(within(post(3)).getByRole('button', { name: /^Fire, 2\./u })).toBeInTheDocument();
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
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}${where}`, state: returnState({ shown, known }) });
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
    /* The play is no post that came after the reader left: no bar, and its mark is on the post it landed on. */
    expect(await within(post(4)).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
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
    key, art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}`,
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
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, cards });

describe('a card\'s effect on a post', () => {
  test('a card with no CardUi draws the post untouched, and its play as its mark alone', async () => {
    const w = world(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    openWith(w, []);
    const second = await screen.findByRole('article', { name: /^Post 2 /u });
    const mark = await within(second).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' });
    expect(second).toHaveTextContent('post 2');
    expect(within(second).queryByTestId('fx-whoops')).toBeNull();
    /* The mark stands in the post's date row, not in its words. */
    expect(mark.closest('.kb-act-meta')).not.toBeNull();
    expect(second.querySelector('.kb-act-main .kb-mark')).toBeNull();
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

  test('its saved state and the reader\'s release arrive with the page\'s document, with no read, for the cards that draw an effect only', async () => {
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
    /* The document was asked for the cards the instance draws an effect for, so the plain one's play has no state in it. */
    expect(Object.keys(JSON.parse(wrapped.dataset.states!))).toEqual([played]);
    expect(other).not.toBe(played);
    expect(states).not.toHaveBeenCalled();
    expect(releases).not.toHaveBeenCalled();
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

  /*
   * #85: a splat on a post whose author was later retired. Its own player washes it through the retired mask that wrote the post
   * (supabase/migrations/0038_retired_author_washes.sql), and another reader loads the layer as they left it. Every other
   * refusal stands: a retired mask that did not write the post, and another player's retired mask, which reads as any mask
   * they do not play.
   */
  test('the player of a retired author washes the post it wrote clean, and another reader loads the layer clean', async () => {
    const w = world(3);
    const spare = w.fake.seed.character(w.me, 'Spare Mask', 'face');
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    w.fake.seed.retire(w.pipe);
    w.fake.seed.retire(spare);
    /* Whoops!'s own control marks the layer clean when the author washes to the share (whoops/Effect.test.tsx, given `reader.author`); here it is that save. */
    const washes: CardUi = { ...fx('whoops'), Effect: ({ plays, reader, save, children }) => (
      <div data-testid="fx-whoops" data-author={String(reader.author)}>
        <button type="button" onClick={() => void save(plays[0]!.id, { clean: true, strokes: [] })}>wash clean</button>
        {children}
      </div>
    ) };
    openWith(w, [washes]);
    const wrapped = await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByTestId('fx-whoops');
    await waitFor(() => expect(wrapped.dataset.author).toBe('true'));
    await userEvent.click(within(wrapped).getByRole('button', { name: 'wash clean' }));
    await waitFor(async () => expect((await w.fake.effectStates([played]))[played]?.state).toEqual({ clean: true, strokes: [] }));
    expect(await w.fake.saveEffect(played, spare, {})).toEqual({ ok: false, error: 'that character is retired; an admin can restore it' });
    w.fake.signInAs(w.other);
    expect((await w.fake.effectStates([played]))[played]?.state).toEqual({ clean: true, strokes: [] });
    const theirs = await w.fake.saveEffect(played, w.pipe, {});
    expect(theirs).toEqual(await w.fake.saveEffect(played, w.fake.seed.character(w.me, 'Not Retired', 'face'), {}));
    expect(theirs).toEqual({ ok: false, error: 'you do not play that character' });
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

  test('a card can choose the ink of its mark\'s edge and border from its top-billed play (Whoops!\'s top layer takes its ink)', async () => {
    /* The glass's key resolves the tab's words on the root, as the app's stylesheet does (web/src/main.tsx); a test page has none. */
    document.documentElement.style.setProperty('--kb-glass-ink-neon', '#000000');
    onTestFinished(() => { document.documentElement.style.removeProperty('--kb-glass-ink-neon'); });
    const w = world(2);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'under', layer: 1 });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'over', layer: 2 });
    const tint: CardUi = { ...fx('whoops'), tag: (play, all) => (play === all[all.length - 1] ? '#ff2bd6' : undefined) };
    openWith(w, [tint]);
    const second = await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(second.querySelector<HTMLElement>('.kb-mark')).not.toBeNull());
    /* The kind is one mark, billed newest first with neither drawing yet, so the top layer's ink is the mark's; the card's plays are given to `tag` in play order. */
    expect(second.querySelectorAll('.kb-mark')).toHaveLength(1);
    expect(second.querySelector<HTMLElement>('.kb-mark')!.style.getPropertyValue('--kb-mark-ink')).toBe('#ff2bd6');
  });

  test('a play that arrives live gets its mark and its effect on a post already on screen', async () => {
    const w = world(3);
    const tapped = tap(w.fake);
    openWith(w, [fx('whoops')]);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(within(post(2)).queryByTestId('fx-whoops')).toBeNull();
    deliver(() => tapped().onAct?.(live(w.thread, 0, w.spritey, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'whoops', layer: 1, message: 'live' }, currentPayload: { card: 'whoops', layer: 1, message: 'live' } })));
    expect(await within(post(2)).findByTestId('fx-whoops')).toHaveAttribute('data-plays', '1:live');
    expect(within(post(2)).getByRole('button', { name: 'Whoops!, 1 play, whoops. Opens the cards on this post.' })).toBeInTheDocument();
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

  test('stays silent for a card, an unmask and a tally: the card is a mark, the others still appear', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 0, w.pipe, { kind: 'card', seq: null, targetActId: w.ids[1]!, payload: { card: 'whoops' }, currentPayload: { card: 'whoops' } })));
    deliver(() => tapped().onAct?.(live(w.thread, 6, w.pipe, { kind: 'unmask', payload: { class: 'heel', message: '' }, currentPayload: { class: 'heel', message: '' } })));
    deliver(() => tapped().onAct?.(live(w.thread, 7, null, { kind: 'tally', payload: { body: 'x' }, currentPayload: { body: 'x' } })));
    await screen.findByRole('article', { name: /^Post 7 by the staff/u });
    expect(post(6)).toBeInTheDocument();
    expect(await within(post(2)).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
    expect(announcer()).toBeEmptyDOMElement();
    deliver(() => tapped().onAct?.(live(w.thread, 8, w.spritey)));
    await waitFor(() => expect(announcer()).toHaveTextContent('New post by Spritey'));
  });

  test('names the staff in lower case mid-sentence: "New post by the staff"', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    deliver(() => tapped().onAct?.(live(w.thread, 6, null)));
    await waitFor(() => expect(announcer()).toHaveTextContent('New post by the staff'));
    expect(announcer()).not.toHaveTextContent('The staff');
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
    /* The catch-up's read of the page (the channels joined) is over before the window the test means. */
    await advance(50);
    const read = vi.spyOn(w.fake, 'threadPage');
    w.fake.seed.post(w.thread, w.pipe, 'post 6');
    w.fake.seed.post(w.thread, w.spritey, 'post 7');
    const seven = (await w.fake.acts(w.thread, 7, 7))[0]!;
    read.mockClear();
    deliver(() => tapped().onAct?.(seven));
    for (let seq = 8; seq <= 12; seq++) {
      await advance(500);
      deliver(() => tapped().onAct?.(live(w.thread, seq, w.pipe)));
    }
    /* The gap is read from the page that holds its first missing post: one page read. */
    expect(read).toHaveBeenCalledWith(w.thread, { seq: 6 }, expect.any(Number), expect.anything());
    await screen.findByRole('article', { name: /^Post 6 /u });
  });

  test('when the gap cannot be read, the bar offers the held posts, and clicking shows them', async () => {
    const w = world(5);
    const tapped = tap(w.fake);
    clock();
    open(w);
    await screen.findByRole('article', { name: /^Post 5 /u });
    see(sentinel(), true);
    /* The catch-up's read of the page (the channels joined) is over before the window the test means. */
    await advance(50);
    const read = vi.spyOn(w.fake, 'threadPage').mockRejectedValue(new Error('down'));
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
    /* The catch-up's read of the page (the channels joined) is over before the window the test means. */
    await advance(50);
    w.fake.seed.post(w.thread, w.pipe, 'post 6');
    w.fake.seed.post(w.thread, w.spritey, 'post 7');
    const seven = (await w.fake.acts(w.thread, 7, 7))[0]!;
    const real = w.fake.threadPage.bind(w.fake);
    const read = vi.spyOn(w.fake, 'threadPage').mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down')).mockImplementation(real);
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
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
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
    const view = open(w);
    await screen.findByRole('article', { name: /^Post 10 /u });
    await watched(post(10));
    clock();
    see(post(7));
    asked.mockClear();
    /* The screen leaves (the router draws the front door for a reader who signed out): what was read is sent as it goes. */
    view.unmount();
    await debounced();
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
    /* One per post, each inside its article; the presence box's heading is the page's only other. */
    expect(screen.getAllByRole('article').flatMap((a) => within(a).getAllByRole('heading', { level: 2 }))).toHaveLength(3);
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
    const real = w.fake.threadPage.bind(w.fake);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (t, at, p, e) => {
      const page = await real(t, at, p, e);
      return page && (at.page === 2 ? { ...page, acts: [] } : page);
    });
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

describe('who is browsing', () => {
  test('the thread\'s foot holds "Users browsing this thread", listing the HUD\'s mask', async () => {
    const w = world(2);
    open(w);
    const box = await screen.findByRole('region', { name: 'Users browsing this thread' });
    expect(await within(box).findByRole('link', { name: 'Pipewrench' })).toHaveAttribute('href', `/c/${w.pipe}`);
  });
});

/* ------------------------------------------------------------------ the document ---- */
describe('a thread drawn from its document (the forum-load plan, Task 13)', () => {
  /** The thread's first page as the router would hand it over, with the backend held to the reads a landed page makes. */
  async function landed(w: ReturnType<typeof world>, at: { page?: number; seq?: number } = { page: 1 }, allowed: readonly string[] = [], between?: () => void | Promise<void>, cards: readonly CardUi[] = []) {
    const boot = await w.fake.boot();
    const doc = (await w.fake.threadPage(w.thread, at, 20, cards.map((c) => c.key)))!;
    /* What happens after the server has read the page and before the screen is drawn. */
    await between?.();
    /* The screen reads its drawn pages again once its channels are joined (the catch-up): `threadPage` is its read, and the summary is not. */
    const read = holdReads(w.fake, ['markRead', 'here', 'session', 'threadPage', ...allowed]);
    renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=${at.page ?? 1}`, boot, ...(cards.length > 0 ? { cards } : {}) });
    return { read, doc };
  }

  test('its whole page is in the first render, and nothing is read for it', async () => {
    const w = world(45);
    w.fake.seed.react(w.other, w.spritey, w.ids[1]!, 'fire');
    w.fake.seed.react(w.me, w.pipe, w.ids[0]!, 'tea');
    const { read } = await landed(w);
    /* Synchronously after render: the posts, their authors, the tallies, the player's own reaction, the follow button, the box and the reply form. */
    expect(post(1)).toBeInTheDocument();
    expect(post(20)).toBeInTheDocument();
    expect(within(post(2)).getAllByText('Pipewrench').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Follow this thread' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Users browsing this thread' })).toHaveTextContent('Pipewrench');
    expect(document.querySelector('form.kb-composer')).not.toBeNull();
    expect(within(post(2)).getByText('Fire, 1')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await act(async () => { await pause(20); });
    expect(read).toEqual([]);
  });

  test('the reply box is in the first commit, before any passive effect runs', async () => {
    const w = world(45);
    localStorage.setItem(`kb-draft:${w.me}:${w.thread}`, JSON.stringify({ text: 'half a thought', as: null }));
    const seen: (string | null)[] = [];
    function Probe() {
      useLayoutEffect(() => { seen.push(document.querySelector('form.kb-composer textarea, form.kb-composer [role="textbox"]')?.textContent ?? (document.querySelector('form.kb-composer') ? '' : null)); }, []);
      return null;
    }
    const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    renderIn(w.fake, <><ThreadScreen thread={w.thread} doc={doc} /><Probe /></>, { path: `/t/${w.thread}?page=1`, boot: await w.fake.boot() });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBeNull();
    localStorage.clear();
  });

  test('a post written after the server read the document and before the subscription shows with no later live event', async () => {
    const w = world(45);
    clock();
    const { doc } = await landed(w, { page: 3 }, [], async () => { w.fake.seed.post(w.thread, w.pipe, 'post 46'); });
    expect(doc.thread.lastSeq).toBe(45);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(await screen.findByRole('button', { name: '1 new post' })).toBeInTheDocument();
  });

  test('its next page is one threadPage read, on the meter, and nothing else', async () => {
    const w = world(45);
    const board = vi.spyOn(w.fake, 'threadPage');
    const { read } = await landed(w, { page: 1 }, ['threadPage']);
    board.mockClear();
    await userEvent.click(screen.getByRole('link', { name: 'Continue to page 2' }));
    await waitFor(() => expect(post(21)).toBeInTheDocument());
    expect(board).toHaveBeenCalledTimes(1);
    expect(board.mock.calls[0]![0]).toBe(w.thread);
    expect(board.mock.calls[0]![1]).toEqual({ page: 2 });
    expect(read).toEqual([]);
  });

  test('the live channel starts after the first render and a gap is read from the document\'s last seq, with one threadPage read', async () => {
    const w = world(45);
    const listener = tap(w.fake);
    const page = vi.spyOn(w.fake, 'threadPage');
    clock();
    const { doc, read } = await landed(w, { page: 3 }, ['acts']);
    expect(doc.thread.lastSeq).toBe(45);
    /* The catch-up (the channels joined) reads the page once; what lands after it is the live channel's, and a gap in it is read from the document's last seq. */
    await screen.findByRole('article', { name: /^Post 45 /u });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    w.fake.seed.post(w.thread, w.pipe, 'post 46');
    w.fake.seed.post(w.thread, w.spritey, 'post 47');
    w.fake.seed.post(w.thread, w.pipe, 'post 48');
    const last = (await w.fake.acts(w.thread, 48, 48))[0]!;
    page.mockClear();
    deliver(() => listener().onAct?.(last));
    /* The held post is in before the gap's clock starts. */
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(GAP_FILL_MS + 100); });
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0]![0]).toBe(w.thread);
    expect(page.mock.calls[0]![1]).toEqual({ seq: 46 });
    expect(read).toEqual([]);
    expect(await screen.findByRole('button', { name: '3 new posts' })).toBeInTheDocument();
  });

  /*
   * The catch-up (the thread catch-up plan, Task 2): once its channels are joined the screen reads the pages it draws again, so whatever
   * landed between the server's read and the join (a play, a back, a spring, an end, an edit, a reaction, a saved state, a play beyond a post) is
   * shown with no later live event. Each `between` writes what nobody hears: a muted seed, or a real write made before the screen subscribes.
   */
  describe('the catch-up reads the drawn pages again', () => {
    const mark = /^Whoops!, 1 play\b/u;
    const article = (n: number) => screen.findByRole('article', { name: new RegExp(`^Post ${n} `, 'u') });

    test('a card played on a shown post in the window shows its mark', async () => {
      const w = world(3);
      await landed(w, { page: 1 }, [], () => { w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' }); });
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
    });

    test('a card set face down in the window shows its back, and one sprung in the window shows revealed', async () => {
      const w = world(3);
      /* A back is drawn until its end, read against the browser's clock while the fake dates its Acts on its own: the browser's is set to the fake's. */
      vi.useFakeTimers({ shouldAdvanceTime: true, now: w.fake.clock.now() });
      /* A back is set on its setter's own post: post 2 is Pipewrench's, posts 1 and 3 are Spritey's. */
      w.fake.seed.set(w.pipe, w.ids[1]!, 'whoops');
      const springing = w.fake.seed.set(w.spritey, w.ids[2]!, 'whoops');
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
      w.fake.seed.set(w.spritey, w.ids[0]!, 'whoops');
      w.fake.seed.spring(springing, { trigger: 'quote', by: w.me });
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=1`, boot });
      const back = (seq: number) => post(seq).querySelector('[data-kb-back]');
      await waitFor(() => expect(back(1)?.getAttribute('data-kb-back')).toBe('down'));
      expect(back(2)?.getAttribute('data-kb-back')).toBe('down');
      expect(back(3)?.getAttribute('data-kb-back')).toBe('sprung');
    });

    test('a play on a shown post that an admin ended in the window (after the document, before the join) is drawn ended', async () => {
      const w = world(3);
      w.fake.seed.admin(w.me);
      const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'live' });
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, ['whoops']))!;
      expect((await w.fake.reverseCard(played)).ok).toBe(true);
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=1`, boot, cards: [fx('whoops')] });
      await article(2);
      await waitFor(() => expect(within(post(2)).queryByTestId('fx-whoops')).toBeNull());
      expect(within(post(2)).getByRole('button', { name: mark })).toBeInTheDocument();
    });

    test('a post edited in the window shows its new words', async () => {
      const w = world(3);
      await landed(w, { page: 1 }, [], async () => { expect((await w.fake.edit(w.ids[1]!, w.pipe, 'post two, mended')).ok).toBe(true); });
      expect(await within(post(2)).findByText('post two, mended')).toBeInTheDocument();
    });

    test('a reaction made in the window shows in the tally', async () => {
      const w = world(3);
      await landed(w, { page: 1 }, [], () => { w.fake.seed.react(w.other, w.spritey, w.ids[1]!, 'fire'); });
      expect(await within(post(2)).findByText('Fire, 1')).toBeInTheDocument();
    });

    test('a saved effect state written in the window is the state shown', async () => {
      const w = world(3);
      const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
      expect((await w.fake.saveEffect(played, w.pipe, { v: 1 })).ok).toBe(true);
      await landed(w, { page: 1 }, [], async () => { w.fake.clock.advance(1000); expect((await w.fake.saveEffect(played, w.pipe, { v: 2 })).ok).toBe(true); }, [fx('whoops')]);
      const wrapped = await within(await article(2)).findByTestId('fx-whoops');
      await waitFor(() => expect(JSON.parse(wrapped.dataset.states!)[played].state).toEqual({ v: 2 }));
    });

    test('a play beyond a post made in the window is drawn, and one in the document that was ended in the window is not', async () => {
      const w = world(3);
      w.fake.seed.admin(w.me);
      const ended = w.fake.seed.reach(w.spritey, 'thread', w.thread, 'whoops', { ends: Date.now() + 86_400_000, message: 'first' });
      const head = () => document.querySelector('.kb-thread-head') as HTMLElement;
      const beyond = /^Whoops!, \d plays?\b.*Opens the cards on this thread\./u;
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
      expect(doc.above.map((x) => x.act.id)).toContain(ended);
      expect((await w.fake.reverseCard(ended)).ok).toBe(true);
      w.fake.seed.reach(w.pipe, 'thread', w.thread, 'whoops', { ends: Date.now() + 86_400_000, message: 'second' });
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=1`, boot });
      /* The head first draws the document's one play; then the read after the join ends it and draws the new one. */
      await waitFor(() => expect(within(head()).getByRole('button', { name: /^Whoops!, 1 play\b.*Opens the cards on this thread\./u })).toBeInTheDocument());
      const lens = async () => {
        await userEvent.click(within(head()).getByRole('button', { name: beyond }));
        const dialog = await screen.findByRole('dialog');
        return dialog;
      };
      const dialog = await lens();
      /* One play, and it is the new one's caster's, not the ended one's. */
      expect(dialog).toHaveTextContent('1 play · Pipewrench');
      expect(dialog).not.toHaveTextContent('Spritey');
    });

    test('the same card play on a page that is not the last is caught up, and no page beyond it is read', async () => {
      const w = world(45);
      const page = vi.spyOn(w.fake, 'threadPage');
      await landed(w, { page: 1 }, [], () => { page.mockClear(); w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' }); });
      await article(2);
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
      await act(async () => { await pause(30); });
      expect(page.mock.calls.map((c) => c[1])).toEqual([{ page: 1 }]);
    });

    test('a post written in the window is held behind the bar, as the thread\'s catch-up always has', async () => {
      const w = world(45);
      clock();
      await landed(w, { page: 3 }, [], async () => { w.fake.seed.post(w.thread, w.pipe, 'post 46'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(await screen.findByRole('button', { name: '1 new post' })).toBeInTheDocument();
      expect(document.getElementById('post-46')).toBeNull();
    });

    test('with joins held nothing is read until the join, and a card played after the mount and before it is caught up by the read the join starts', async () => {
      const w = world(3);
      w.fake.broadcast.holdJoins();
      const page = vi.spyOn(w.fake, 'threadPage');
      await landed(w, { page: 1 }, [], () => { page.mockClear(); });
      await article(2);
      /* Played after the document and after the screen drew, before its channels joined: no listener could hear it. */
      w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
      await act(async () => { await pause(30); });
      expect(page).not.toHaveBeenCalled();
      expect(within(post(2)).queryByRole('button', { name: mark })).toBeNull();
      await act(async () => { w.fake.broadcast.join(); });
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
      expect(page).toHaveBeenCalledTimes(1);
    });

    test('it waits for both channels: the thread\'s joined alone reads nothing', async () => {
      const w = world(3);
      const page = vi.spyOn(w.fake, 'threadPage');
      const reach = w.fake.subscribeReach.bind(w.fake);
      /* The reach channel never reports joined until released. */
      let release: (() => void) | undefined;
      w.fake.subscribeReach = (l) => {
        const gated = { ...l, onJoined: () => { release = () => l.onJoined?.(); } };
        return reach(gated);
      };
      await landed(w, { page: 1 }, [], () => { page.mockClear(); });
      await article(2);
      w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
      await act(async () => { await pause(30); });
      expect(page).not.toHaveBeenCalled();
      await act(async () => { release!(); });
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
      expect(page).toHaveBeenCalledTimes(1);
    });

    test('a rejoin reads the drawn pages again, and two rejoins during one run make one more run, not two', async () => {
      const w = world(3);
      const { read } = await landed(w, { page: 1 });
      await article(2);
      await act(async () => { await pause(30); });
      const real = w.fake.threadPage.bind(w.fake);
      let gate!: () => void;
      const held = new Promise<void>((r) => { gate = r; });
      const page = vi.spyOn(w.fake, 'threadPage').mockImplementation(async (...a) => { if (page.mock.calls.length === 1) await held; return real(...a); });
      w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
      await act(async () => { w.fake.broadcast.rejoin(); });
      expect(page).toHaveBeenCalledTimes(1);
      await act(async () => { w.fake.broadcast.rejoin(); w.fake.broadcast.rejoin(); });
      expect(page).toHaveBeenCalledTimes(1);
      await act(async () => { gate(); await pause(30); });
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
      await act(async () => { await pause(30); });
      expect(page).toHaveBeenCalledTimes(2);
      expect(read).toEqual([]);
    });

    /* The thread channel's listener, to tell it alone that it rejoined (the fake's `rejoin` tells every listener, the reach channel's too). */
    const threadChannel = (fake: Fake) => {
      const seen: ThreadListener[] = [];
      const real = fake.subscribeThread.bind(fake);
      fake.subscribeThread = (t, l) => { seen.push(l); return real(t, l); };
      return () => seen.at(-1)!;
    };

    test('a catch-up read that fails is asked again, and lands; after three failures nothing more is asked', async () => {
      const w = world(3);
      const channel = threadChannel(w.fake);
      clock();
      await landed(w, { page: 1 });
      await article(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      const real = w.fake.threadPage.bind(w.fake);
      let failing = 2;
      const page = vi.spyOn(w.fake, 'threadPage').mockImplementation(async (...a) => { if (failing-- > 0) throw new Error('the network went'); return real(...a); });
      w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
      await act(async () => { channel().onJoined?.(); });
      expect(page).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(GAP_FILL_MS + 50); });
      expect(page).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(GAP_FILL_MS * 2 + 50); });
      expect(page).toHaveBeenCalledTimes(3);
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
      /* Settled: nothing more is asked. */
      await act(async () => { await vi.advanceTimersByTimeAsync(GAP_RETRY_MAX_MS * 3); });
      expect(page).toHaveBeenCalledTimes(3);
    });

    test('three failures end the run quietly: nothing more is asked until the next join', async () => {
      const w = world(3);
      const channel = threadChannel(w.fake);
      clock();
      await landed(w, { page: 1 });
      await article(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      const page = vi.spyOn(w.fake, 'threadPage').mockRejectedValue(new Error('the network went'));
      await act(async () => { channel().onJoined?.(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(GAP_RETRY_MAX_MS * 4); });
      expect(page).toHaveBeenCalledTimes(3);
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => { channel().onJoined?.(); });
      expect(page).toHaveBeenCalledTimes(4);
    });

    test('a landed page makes exactly one threadPage read (the catch-up\'s) and no thread read, and the router\'s meter never shows for it', async () => {
      const w = world(3);
      const page = vi.spyOn(w.fake, 'threadPage');
      const summary = vi.spyOn(w.fake, 'thread');
      const tracking: number[] = [];
      function Meter() {
        tracking.push(useNavigation().tracking);
        return null;
      }
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
      page.mockClear();
      holdReads(w.fake, ['markRead', 'here', 'session', 'threadPage']);
      renderIn(w.fake, <><ThreadScreen thread={w.thread} doc={doc} /><Meter /></>, { path: `/t/${w.thread}?page=1`, boot });
      await article(2);
      await waitFor(() => expect(page).toHaveBeenCalledTimes(1));
      await act(async () => { await pause(30); });
      expect(page).toHaveBeenCalledTimes(1);
      expect(page.mock.calls[0]![1]).toEqual({ page: 1 });
      expect(summary).not.toHaveBeenCalled();
      expect(Math.max(...tracking)).toBe(0);
    });

    /* Reads of one page that are answered in an order other than the one they were asked in: each read's answer is taken when it is asked, and given when its gate opens. */
    const gated = (fake: Fake, gates: readonly Promise<void>[]) => {
      const real = fake.threadPage.bind(fake);
      return vi.spyOn(fake, 'threadPage').mockImplementation(async (...a) => {
        const at = gates[vi.mocked(fake.threadPage).mock.calls.length - 1];
        const answer = await real(...a);
        if (at) await at;
        return answer;
      });
    };
    const gate = () => { let open!: () => void; const promise = new Promise<void>((r) => { open = r; }); return { promise, open }; };

    test('an older read of a page that is answered after a newer one does not end a play the newer one held', async () => {
      const w = world(45);
      w.fake.seed.admin(w.me);
      const head = () => document.querySelector('.kb-thread-head') as HTMLElement;
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 2 }, 20, []))!;
      const first = gate();
      /* The catch-up's read of page 2 is asked first and answered last; the reads of pages 1 and 2 again are asked after it and answered at once. */
      gated(w.fake, [first.promise]);
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=2`, boot });
      await article(21);
      await waitFor(() => expect(vi.mocked(w.fake.threadPage)).toHaveBeenCalledTimes(1));
      w.fake.seed.reach(w.spritey, 'thread', w.thread, 'whoops', { ends: Date.now() + 86_400_000, message: 'between' });
      await userEvent.click(screen.getAllByRole('link', { name: 'Page 1' })[0]!);
      await article(1);
      await userEvent.click(screen.getAllByRole('link', { name: 'Page 2' })[0]!);
      await article(21);
      await act(async () => { await pause(50); });
      const beyond = /^Whoops!, 1 play\b.*Opens the cards on this thread\./u;
      expect(await within(head()).findByRole('button', { name: beyond })).toBeInTheDocument();
      await act(async () => { first.open(); await pause(30); });
      expect(within(head()).getByRole('button', { name: beyond })).toBeInTheDocument();
    });

    test('a page the reader continues to, read before the join and answered during the catch-up, is caught up too', async () => {
      const w = world(45);
      w.fake.broadcast.holdJoins();
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
      const onContinue = gate();
      const onCatchUp = gate();
      /* The continue's read (the first) is taken before the play; the catch-up's read of page 1 (the second) waits for it to land. */
      gated(w.fake, [onContinue.promise, onCatchUp.promise]);
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=1`, boot });
      await article(1);
      await userEvent.click(screen.getByRole('link', { name: 'Continue to page 2' }));
      await waitFor(() => expect(vi.mocked(w.fake.threadPage)).toHaveBeenCalledTimes(1));
      await act(async () => { await pause(10); });
      w.fake.seed.card(w.spritey, w.ids[21]!, 'whoops', { message: 'oops' });
      await act(async () => { w.fake.broadcast.join(); });
      await waitFor(() => expect(vi.mocked(w.fake.threadPage)).toHaveBeenCalledTimes(2));
      await act(async () => { onContinue.open(); await pause(30); });
      await article(21);
      await act(async () => { onCatchUp.open(); await pause(30); });
      expect(await within(post(22)).findByRole('button', { name: mark })).toBeInTheDocument();
    });

    test('a page read before the join and answered after its catch-up run has finished is caught up by one more run', async () => {
      const w = world(45);
      w.fake.broadcast.holdJoins();
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
      const onContinue = gate();
      /* The continue's read (the first) is answered before the play and given after the run; the catch-up's own read of page 1 is not held. */
      gated(w.fake, [onContinue.promise]);
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=1`, boot });
      await article(1);
      await userEvent.click(screen.getByRole('link', { name: 'Continue to page 2' }));
      await waitFor(() => expect(vi.mocked(w.fake.threadPage)).toHaveBeenCalledTimes(1));
      await act(async () => { await pause(10); });
      w.fake.seed.card(w.spritey, w.ids[21]!, 'whoops', { message: 'oops' });
      await act(async () => { w.fake.broadcast.join(); await pause(50); });
      /* The run read page 1 only (the drawn range then) and is over. */
      expect(vi.mocked(w.fake.threadPage)).toHaveBeenCalledTimes(2);
      await act(async () => { onContinue.open(); await pause(50); });
      await article(21);
      expect(await within(post(22)).findByRole('button', { name: mark })).toBeInTheDocument();
    });

    test('a continue with no join in between asks for no catch-up read', async () => {
      const w = world(45);
      const boot = await w.fake.boot();
      const doc = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
      const spy = vi.spyOn(w.fake, 'threadPage');
      renderIn(w.fake, <ThreadScreen thread={w.thread} doc={doc} />, { path: `/t/${w.thread}?page=1`, boot });
      await article(1);
      await act(async () => { await pause(50); });
      const start = spy.mock.calls.length;
      await userEvent.click(screen.getByRole('link', { name: 'Continue to page 2' }));
      await article(21);
      await act(async () => { await pause(50); });
      expect(spy.mock.calls.length - start).toBe(1);
    });

    test('it moves nothing the reader is looking at: no scroll, no focus change, no announcement of a post already announced', async () => {
      const w = world(3);
      await landed(w, { page: 1 }, [], () => { w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' }); });
      await article(2);
      const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
      const focused = document.activeElement;
      expect(await within(post(2)).findByRole('button', { name: mark })).toBeInTheDocument();
      expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBe(scrolled);
      expect(document.activeElement).toBe(focused);
      expect(announcer()).toHaveTextContent('');
    });
  });
});

/* ------------------------------------------------------------------------ a post that cannot be quoted ---- */
describe('a post under a no-quote card', () => {
  const stops = {
    ...testInstance,
    cards: testInstance.cards.map((c, i) => (i === 0 ? { ...c, key: 'stopper', name: 'Stopper', play: 'use' as const, gimmick: { kind: 'noQuote' as const }, lasts: { unit: 'day' as const, count: 7 } } : c)),
  };
  /* Post 2 is Spritey's and carries the card; posts 1 and 3 are quotable. */
  function stopped(over: { ends?: string; reversed?: boolean } = {}) {
    const w = world(3, undefined, stops);
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'stopper', { ends: over.ends ?? new Date(Date.now() + 3_600_000).toISOString() });
    return { w, played };
  }
  const quoteOf = (seq: number) => within(post(seq)).queryByRole('button', { name: 'Quote' });
  const openStopped = (w: { fake: Fake; thread: Id }) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: stops });

  test('has no Quote button while the play is live, and its neighbors do', async () => {
    const { w } = stopped();
    openStopped(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    await within(post(2)).findByRole('button', { name: /^Stopper, 1 play\b/u });
    expect(quoteOf(2)).toBeNull();
    expect(quoteOf(1)).not.toBeNull();
    expect(quoteOf(3)).not.toBeNull();
  });

  test('a selection inside it shows no Quote, and one inside a neighbor does', async () => {
    const { w } = stopped();
    openStopped(w);
    await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByRole('button', { name: /^Stopper, 1 play\b/u });
    const select = (seq: number) => {
      const text = post(seq).querySelector('.kb-bb')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0); range.setEnd(text, 4);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      act(() => { document.dispatchEvent(new Event('selectionchange')); });
    };
    select(2);
    await pause(30);
    expect(screen.queryByRole('button', { name: 'Quote the selected text' })).toBeNull();
    select(3);
    expect(await screen.findByRole('button', { name: 'Quote the selected text' })).toBeInTheDocument();
  });

  test('the toolbar\'s Quote is absent when the last post shown is one, and there when it is not', async () => {
    const { w } = stopped();
    openStopped(w);
    await within(await screen.findByRole('article', { name: /^Post 3 /u })).findByRole('button', { name: 'Quote' });
    expect(screen.getByRole('button', { name: 'Quote the last post shown' })).toBeInTheDocument();
    /* A post under the card is the last one shown. */
    const t = world(2, undefined, stops);
    t.fake.clock.advance(60_000);
    t.fake.seed.card(t.spritey, t.ids[1]!, 'stopper', { ends: new Date(Date.now() + 3_600_000).toISOString() });
    cleanup();
    openStopped(t);
    await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByRole('button', { name: /^Stopper, 1 play\b/u });
    expect(screen.queryByRole('button', { name: 'Quote the last post shown' })).toBeNull();
  });

  test('with the play ended, or reversed, the button is there', async () => {
    const ended = stopped({ ends: new Date(Date.now() - 60_000).toISOString() });
    openStopped(ended.w);
    /* The mark stays on an ended play: it proves the plays were read before the button is asserted. */
    await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByRole('button', { name: /^Stopper, 1 play\b/u });
    expect(quoteOf(2)).not.toBeNull();
  });

  test('a play reversed by an admin leaves the Quote button', async () => {
    const { w, played } = stopped();
    expect((await w.fake.reverseCard(played)).ok).toBe(true);
    openStopped(w);
    /* The mark stays on an ended play: it proves the plays were read before the button is asserted. */
    await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByRole('button', { name: /^Stopper, 1 play\b/u });
    expect(quoteOf(2)).not.toBeNull();
  });
});

/* An admin's end of a card (supabase/migrations/0092_card_end.sql): its layer is off for everyone, whether the page read it ended or heard it end. */
describe('a card an admin ended', () => {
  test('draws no effect on its post, where the same card live beside it does, and its mark stays', async () => {
    const w = world(3);
    w.fake.seed.admin(w.me);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'live' });
    const ended = w.fake.seed.card(w.spritey, w.ids[2]!, 'whoops', { message: 'ended' });
    expect((await w.fake.reverseCard(ended)).ok).toBe(true);
    openWith(w, [fx('whoops')]);
    expect(await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByTestId('fx-whoops')).toHaveAttribute('data-plays', '1:live');
    const third = await screen.findByRole('article', { name: /^Post 3 /u });
    await within(third).findByRole('button', { name: /^Whoops!, 1 play\b/u });
    expect(within(third).queryByTestId('fx-whoops')).toBeNull();
  });

  test('heard on the thread\'s topic while the page is open, it takes the layer off at once', async () => {
    const w = world(3);
    w.fake.seed.admin(w.me);
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'live' });
    openWith(w, [fx('whoops')]);
    expect(await within(await screen.findByRole('article', { name: /^Post 2 /u })).findByTestId('fx-whoops')).toBeInTheDocument();
    /* The end comes from the admin's call, not the Lens: only the broadcast carries it to this page. */
    await act(async () => { expect((await w.fake.reverseCard(played)).ok).toBe(true); });
    await waitFor(() => expect(within(post(2)).queryByTestId('fx-whoops')).toBeNull());
  });
});

/* A card's author veil (card notes, Part 3): the post is drawn under the stand-in for every reader, and only its author's player is told it is theirs. */
describe('a post under an author veil', () => {
  const MIN = 60_000;
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const veiling: Instance = {
    ...testInstance,
    anonymous: { name: 'Nobody', tagline: 'Could be anyone.' },
    cards: [...testInstance.cards, {
      key: 'whodunnit', name: 'Whodunnit?', alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], lasts: { unit: 'minute', count: 10 }, veil: 'author',
      playPrice: () => 0, validateConfig: (c) => ok(c ?? {}), canApply: (t, e, _c, now) => landsOn({ key: 'whodunnit', reaches: ['post'] }, t, e, now),
    }],
  };
  /** Spritey's Whodunnit? on Pipewrench's post 2 (the signed-in player's own), with a third player in the world. */
  async function veiled() {
    const w = world(3, undefined, veiling);
    const third = w.fake.seed.account('third');
    const thirdFace = w.fake.seed.character(third, 'Thirdwheel', 'face');
    w.fake.seed.cards(w.other, { whodunnit: 1 });
    w.fake.signInAs(w.other);
    expect((await w.fake.playCard('whodunnit', w.spritey, w.ids[1]!, {}, '')).ok).toBe(true);
    return { ...w, third, thirdFace };
  }
  const openVeiled = (w: { fake: Fake; thread: Id }) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: veiling });

  test('its author\'s player has Edit and no React on it, though the post is drawn under the stand-in', async () => {
    const w = await veiled();
    w.fake.signInAs(w.me);
    openVeiled(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Nobody$/u });
    expect(await within(second).findByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await within(post(3)).findByRole('button', { name: 'React' });
    expect(within(second).queryByRole('button', { name: 'React' })).toBeNull();
    expect(second).not.toHaveTextContent('Pipewrench');
  });

  test('a reader has neither Edit nor the author\'s name anywhere in the post\'s markup, and can react to it', async () => {
    const w = await veiled();
    w.fake.signInAs(w.third);
    openVeiled(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Nobody$/u });
    expect(await within(second).findByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(second.innerHTML).not.toContain('Pipewrench');
    expect(second.innerHTML).toContain('Nobody');
  });

  test('the page is read again when a veil play arrives, and again at its end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: world(1).fake.clock.now() });
    const w = world(3, undefined, veiling);
    w.fake.seed.cards(w.me, { whodunnit: 1 });
    vi.setSystemTime(w.fake.clock.now());
    const read = vi.spyOn(w.fake, 'threadPage');
    openVeiled(w);
    expect(await screen.findByRole('article', { name: /^Post 1 by Spritey$/u })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const settled = read.mock.calls.length;
    /* A play arrives on the thread's topic: the post is read again, and the stand-in takes its place. */
    await act(async () => { expect((await w.fake.playCard('whodunnit', w.pipe, w.ids[0]!, {}, '')).ok).toBe(true); });
    expect(await screen.findByRole('article', { name: /^Post 1 by Nobody$/u })).toBeInTheDocument();
    expect(read.mock.calls.length).toBeGreaterThan(settled);
    /* At its end the page reads again by itself, and the author shows. */
    const armed = read.mock.calls.length;
    await act(async () => { w.fake.clock.advance(10 * MIN + 1_000); await vi.advanceTimersByTimeAsync(10 * MIN + 2_000); });
    expect(await screen.findByRole('article', { name: /^Post 1 by Spritey$/u })).toBeInTheDocument();
    expect(read.mock.calls.length).toBeGreaterThan(armed);
  });
});

describe('where glitter lands in a thread', () => {
  test('a mounted post is registered as a landing place, and one that unmounts lets go of it', async () => {
    const w = world(3);
    const shown = open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(landing.posts.has(second)).toBe(true));
    expect(landing.posts.size).toBe(3);
    shown.unmount();
    expect(landing.posts.size).toBe(0);
  });

  test('a post that comes live is registered, and the one before it keeps its registration', async () => {
    const w = world(2);
    const tapped = tap(w.fake);
    open(w);
    await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(landing.posts.size).toBe(2));
    see(sentinel(), true);
    deliver(() => tapped().onAct?.(live(w.thread, 3, w.pipe)));
    await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(landing.posts.size).toBe(3));
    expect(landing.posts.has(post(1))).toBe(true);
  });

  /* Real glitter on the page and on a post cell: a sticky host far off lends flakes, a pointer move drops them where `elementFromPoint` says. */
  const tokens = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8')).light;
  function seedGlitter(): { cell: HTMLElement; undo: () => void } {
    const cell = post(2).querySelector<HTMLElement>('.kb-act-main')!;
    for (const el of [document.body, ...Array.from(post(2).children).filter((c): c is HTMLElement => c instanceof HTMLElement)]) {
      for (const k of ['--kb-bg', ...POST_INK]) el.style.setProperty(k, tokens[k]!);
    }
    const rect = (l: number, t: number, w: number, h: number) => () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} });
    cell.getBoundingClientRect = rect(100, 130, 600, 300);
    const source = document.createElement('div');
    source.getBoundingClientRect = rect(5000, 0, 300, 300);
    document.body.append(source);
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
    const realCtx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    const realAt = document.elementFromPoint;
    let target: Element = source;
    document.elementFromPoint = () => target;
    vi.stubGlobal('devicePixelRatio', 1);
    document.documentElement.setAttribute('data-kb-motion', 'full');
    const realMedia = window.matchMedia;
    vi.stubGlobal('matchMedia', (q: string) => ({ get matches() { return q.includes('hover: hover'); }, addEventListener() {}, removeEventListener() {} }));
    window.matchMedia = globalThis.matchMedia;
    const flakes = makeFlakes({ seed: 'lend', box: { w: 300, h: 300 }, inks: ['#ff3b4a', '#2fd6ff', '#dfe4ec'], holo: 7, density: 70, glint: '#ffffff' });
    landAll(flakes);
    const unreg = cling.register(source, { sticky: true, flakes });
    let t = 0;
    const pointer = (x: number, y: number, over: Element) => {
      const e = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true });
      Object.defineProperty(e, 'pointerType', { value: 'mouse' });
      Object.defineProperty(e, 'timeStamp', { value: (t += 1) });
      Object.defineProperty(e, 'target', { value: over });
      return e as PointerEvent;
    };
    const move = (x: number, y: number, over: Element) => window.dispatchEvent(pointer(x, y, over));
    const drop = (x: number, y: number, over: Element) => {
      target = source;
      for (let i = 0; i < 400; i++) { const x0 = 5010 + (i % 2) * 120; cling.over(pointer(x0, 100, source)); move(x0, 100, source); }
      target = over;
      move(x, y, over);
      for (let ms = 0; (cling.falling() || cling.carried()) && ms < 12000; ms += 16) cling.tick(ms);
    };
    drop(300, 250, cell);
    drop(900, 300, document.body);
    return { cell, undo: () => { unreg(); source.remove(); HTMLCanvasElement.prototype.getContext = realCtx; document.elementFromPoint = realAt; window.matchMedia = realMedia; } };
  }

  test('the thread screen holds the page while it is on screen, and leaving sweeps it: no loose flake, no tile, no cell marked landed', async () => {
    const w = world(2);
    const shown = open(w);
    await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(landing.pages).toBe(1));
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const seeded = seedGlitter();
    try {
      const was = probe.landed();
      expect(was.cell).toBeGreaterThan(5);
      expect(was.page).toBeGreaterThan(5);
      expect(loose(seeded.cell).length).toBe(was.cell);
      expect(seeded.cell.hasAttribute('data-kb-landed')).toBe(true);
      expect(document.querySelectorAll('canvas[data-kb-landing]').length).toBeGreaterThan(1);
      shown.unmount();
      expect(landing.pages).toBe(0);
      expect(landing.posts.size).toBe(0);
      expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: 0 });
      expect(document.querySelectorAll('canvas[data-kb-landing]')).toHaveLength(0);
      expect(document.querySelectorAll('[data-kb-landed]')).toHaveLength(0);
    } finally {
      seeded.undo();
      cling.reset();
      vi.unstubAllGlobals();
    }
  });

  /* A thread (or the front door) is swapped in the same tree: the page is held by one thread view at a time. */
  function Swap({ docs }: { readonly docs: Record<string, Awaited<ReturnType<Fake['threadPage']>> | typeof SIGNED_OUT_DOC>; }) {
    const [at, setAt] = useState(Object.keys(docs)[0]!);
    (Swap as unknown as { go: (k: string) => void }).go = setAt;
    const [thread] = at.split('|');
    return <ThreadScreen thread={thread!} doc={docs[at]! as never} />;
  }
  const swapTo = (k: string) => act(() => { (Swap as unknown as { go: (k: string) => void }).go(k); });

  test('switching threads releases the old thread\'s page and holds the new one: 1, 0, 1 and never 2', async () => {
    const w = world(2);
    const other = w.fake.seed.thread('general', w.spritey, 'Another thread', 'other 1').thread;
    const boot = await w.fake.boot();
    const a = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    const b = (await w.fake.threadPage(other, { page: 1 }, 20, []))!;
    renderIn(w.fake, <Swap docs={{ [`${w.thread}|1`]: a, [`${other}|1`]: b }} />, { path: `/t/${w.thread}?page=1`, boot });
    await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(landing.pages).toBe(1));
    const calls = landing.pageCalls;
    await swapTo(`${other}|1`);
    await screen.findByText('other 1');
    expect(landing.pages).toBe(1);
    expect(landing.pageCalls).toBe(calls + 1);
    expect(screen.queryByRole('article', { name: /^Post 2 /u })).toBeNull();
  });

  test('a reader who signs out leaves the thread: the page is let go, and stays so', async () => {
    const w = world(2);
    const boot = await w.fake.boot();
    const a = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    renderIn(w.fake, <Swap docs={{ [`${w.thread}|in`]: a, [`${w.thread}|out`]: SIGNED_OUT_DOC }} />, { path: `/t/${w.thread}?page=1`, boot });
    await screen.findByRole('article', { name: /^Post 2 /u });
    await waitFor(() => expect(landing.pages).toBe(1));
    const calls = landing.pageCalls;
    await swapTo(`${w.thread}|out`);
    expect(await screen.findByRole('heading', { level: 1, name: 'How do we explain this' })).toBeInTheDocument();
    expect(landing.pages).toBe(0);
    expect(landing.posts.size).toBe(0);
    expect(landing.pageCalls).toBe(calls);
    expect(probe.landed()).toEqual({ effect: 0, cell: 0, page: 0 });
  });

  /* Source-level guard: jsdom has no layout or stacking, so the stacking of a landed cell can only be asserted on the stylesheet's text. */
  test('thread.css (source-level guard): a landed meta cell keeps a positive stack level over the body, so its hung marks and callout are not trapped under it', () => {
    const css = readFileSync(join(process.cwd(), 'engine/ui/thread/thread.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const rule = /(^|\})\s*\.kb-act\s*>\s*\.kb-act-meta\[data-kb-landed\]\s*\{([^}]*)\}/u.exec(css);
    expect(rule, 'a rule for .kb-act > .kb-act-meta[data-kb-landed]').not.toBeNull();
    const z = /z-index:\s*(\d+)/u.exec(rule![2]!);
    expect(z, 'with a z-index').not.toBeNull();
    expect(Number(z![1])).toBeGreaterThan(0);
    /* Over the body's own level, which the body takes so a moment's glow covers the actions (and the postbit's gear is under it). */
    const main = [...css.matchAll(/(?:^|\})\s*\.kb-act-main\s*\{([^}]*)\}/gu)].map((m) => /z-index:\s*(-?\d+)/u.exec(m[1]!)?.[1]).find((v) => v !== undefined);
    expect(Number(z![1])).toBeGreaterThan(Number(main ?? 0));
  });
});
