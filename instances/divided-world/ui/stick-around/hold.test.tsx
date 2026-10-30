/**
 * Stick Around's view on the page, with the in-memory backend (cards plan, Task 4 as amended 2026-10-30, and the owner's
 * answer on the view's story, #74): when a held post takes the reader over, what the full-screen view does with a scroll, a
 * press of BREAK FREE and an Esc, where it puts the reader when the bar fills, and who is never held. The rules themselves
 * (the bar's step, the press gap, the sides) are tested on plain numbers in cards/stick-around/hold.test.ts; this is the
 * view that feeds them and acts on what comes back.
 *
 * Nothing here has a layout: jsdom measures every box as zero, so the window, the held post's box and the view's scroller
 * are given sizes (`geometry`), and time is a fake clock whose frames and timers the test steps. That is why a frame is
 * 16 ms here and a "screen" is 500 px.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ThreadScreen } from '../../../../engine/ui/thread/Thread.tsx';

import { buildWorld, renderIn } from '../../../../engine/ui/test-world.tsx';
import { instanceUi } from '../index.ts';
import { TUNING } from '../../cards/stick-around/hold.ts';

const SENTENCE = 'I have read every word of Spritey\'s changelog and I feel changed.';
const WINDOW = 800;
const SCREEN = 500;
const FRAME = 1000 / 60;

/* Where the window, the held post and the view's scroller are: the page has no layout in jsdom. */
const geometry = { post: { top: 200, bottom: 520 }, content: 2000 };
const scrolled = new WeakMap<Element, number>();
const isScroller = (el: Element) => el.classList.contains('kb-hold-scroll');
/** The most the post can scroll in the view. */
const MAX = () => geometry.content - SCREEN;

let boxes: ReturnType<typeof vi.spyOn>;
let scrollBy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: WINDOW });
  scrollBy = vi.fn();
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  geometry.post = { top: 200, bottom: 520 };
  geometry.content = 2000;
  boxes = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    /* The held post's words, and the post's own article around them (what the reader is put beside). */
    const held = this.classList.contains('kb-hold') || (this.matches('article') && this.id === 'post-2');
    const rect = held ? geometry.post : { top: 0, bottom: 0 };
    return { ...rect, left: 0, right: 100, width: 100, height: rect.bottom - rect.top, x: 0, y: rect.top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return isScroller(this) ? SCREEN : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return isScroller(this) ? geometry.content : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) { return scrolled.get(this) ?? 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value: number) { scrolled.set(this, value); });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-kb-motion');
  boxes.mockRestore();
});

/* ------------------------------------------------------------------------------ the world ---- */
/* A breaking free is kept in the page's memory by the post's id, so each world's held post is a different one. */
let worlds = 0;

function world(who: 'reader' | 'author' | 'caster' = 'reader') {
  const fake = buildWorld();
  for (let i = 0; i < worlds; i++) fake.seed.account(`filler-${i}`);
  worlds++;
  const reader = fake.seed.account('thwompson');
  const other = fake.seed.account('other');
  const third = fake.seed.account('third');
  const thwompson = fake.seed.character(reader, 'Thwompson', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const gloomba = fake.seed.character(third, 'Gloomba', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'Level editor 2.3', 'Level editor 2.3: the full changelog');
  const held = fake.seed.post(thread, spritey, 'Every one of these was requested in this forum. You\'re welcome. Please read it this time.');
  const play = fake.seed.card(gloomba, held, 'stick-around', { message: 'required reading', config: { sentence: SENTENCE } });
  fake.signInAs({ reader, author: other, caster: third }[who]);
  return { fake, thread, held, first, play, thwompson, spritey, gloomba };
}
type World = ReturnType<typeof world>;

/**
 * The thread open, the held post off the window (so the card has not taken the reader over yet). The page is found on real
 * time, which a find needs, and the card's first settle timer (set as the page mounts, finding the post off the window and
 * doing nothing) is let run out; from there the clock is a fake that only the test advances, so no run is a hair different.
 */
async function openThread(w: World) {
  vi.useRealTimers();
  geometry.post = { top: 5000, bottom: 5320 };
  const rendered = renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}?page=1`, cards: instanceUi.cards });
  await screen.findByText(/Please read it this time/u);
  await new Promise((r) => setTimeout(r, TUNING.settleMs + 60));
  vi.useFakeTimers();
  return rendered;
}

const scrollWindow = () => act(() => { window.dispatchEvent(new Event('scroll')); });
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
/** The reader scrolls the page to the post and stops: the scroll settles after the card's settle time. */
async function settleOn(post: { top: number; bottom: number }) {
  geometry.post = post;
  await scrollWindow();
  await wait(TUNING.settleMs + 20);
}
const view = () => screen.queryByRole('dialog', { name: 'Stick Around' });
const bar = () => within(view()!).getByRole('progressbar', { name: 'Break free' });
const level = () => Number(bar().getAttribute('aria-valuenow'));
const scroller = () => view()!.querySelector<HTMLElement>('.kb-hold-scroll')!;

/** The thread open and the reader taken over: the view is up with its bar empty. */
async function openView(w: World = world()) {
  const rendered = await openThread(w);
  await settleOn(geometry.post = { top: 200, bottom: 520 });
  expect(view()).not.toBeNull();
  return { ...rendered, w };
}

/** Frames of the clock with the reader doing `each` at the start of every one. */
async function frames(count: number, each?: (frame: number) => void) {
  for (let i = 0; i < count; i++) {
    each?.(i);
    await act(() => vi.advanceTimersByTimeAsync(FRAME));
  }
}
/** The reader pushes `px` past an end of the post (positive down) in each of `count` frames. */
const pushing = (el: Element, px: number) => () => { fireEvent.wheel(el, { deltaY: px }); };
const atEnd = (end: 'bottom' | 'top') => { scrolled.set(scroller(), end === 'bottom' ? MAX() : 0); };

/* ---------------------------------------------------------------------------------- taking over ---- */
describe('the take-over', () => {
  test('a scroll that does not settle never takes over, and a settled one with the post mostly in view does', async () => {
    await openThread(world());
    geometry.post = { top: 200, bottom: 520 };
    /* The reader scrolls on, a little each moment: the page never goes quiet for the settle time. */
    for (let i = 0; i < 12; i++) {
      await scrollWindow();
      await wait(TUNING.settleMs - 60);
    }
    expect(view()).toBeNull();
    await wait(TUNING.settleMs + 20);
    expect(view()).not.toBeNull();
  });

  test('a settled scroll with the post mostly out of the window does not take over; once it is mostly in, it does', async () => {
    await openThread(world());
    await settleOn({ top: 700, bottom: 1020 });
    expect(view()).toBeNull();
    await settleOn({ top: 300, bottom: 620 });
    expect(view()).not.toBeNull();
  });

  test('the view is a dialog with the held post in it, the thread dimmed and inert behind it, and no Close', async () => {
    const { container } = await openView();
    const dialog = view()!;
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('article', { name: /^Held post: Spritey/u })).toHaveTextContent('Please read it this time.');
    expect(container).toHaveAttribute('inert');
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(dialog.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'effect');
  });

  test('the author and the card\'s caster are never held', async () => {
    for (const who of ['author', 'caster'] as const) {
      await openThread(world(who));
      await settleOn({ top: 200, bottom: 520 });
      expect(view(), who).toBeNull();
      document.body.innerHTML = '';
    }
  });

  test('with reduced motion the pull is instant, and still happens', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    /* The post is off-centre and the page has room to scroll, so there is a pull to make. */
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 4000 });
    await openThread(world());
    await settleOn({ top: 500, bottom: 820 });
    expect(view()).not.toBeNull();
    expect(window.scrollBy).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
  });

  test('a certified release holds after a reload, and the view never opens for the reader again', async () => {
    const w = world();
    await openView(w);
    fireEvent.click(within(view()!).getByRole('checkbox', { name: /Check to be released/u }));
    await wait(50);
    expect(view()).toBeNull();
    expect((await w.fake.myReleases([w.play])).includes(w.play)).toBe(true);
    /* A reload: the page's memory is gone, the server's is not. */
    document.body.innerHTML = '';
    await openThread(w);
    await settleOn({ top: 200, bottom: 520 });
    expect(view()).toBeNull();
    expect(document.querySelector('.kb-hold')).toBeNull();
  });
});

/* ------------------------------------------------------------------------------- the bar ---- */
describe('the bar', () => {
  test('scrolling inside a long post fills nothing until an end is reached, then a push past the end fills it', async () => {
    await openView();
    const el = scroller();
    /* Reading down the post by the keyboard's page-down: the post scrolls and the bar stays empty. */
    el.focus();
    for (let i = 0; i < 3; i++) {
      await frames(3, (f) => { if (f === 0) fireEvent.keyDown(el, { key: 'PageDown' }); });
      expect(level()).toBe(0);
    }
    expect(el.scrollTop).toBeGreaterThan(0);
    expect(el.scrollTop).toBeLessThan(MAX());
    /* The wheel, partway: the browser would scroll the post, and nothing is pushed. */
    await frames(5, pushing(el, 40));
    expect(level()).toBe(0);
    /* At the end, the next page-down is pushed past it. */
    atEnd('bottom');
    await frames(2, (f) => { if (f === 0) fireEvent.keyDown(el, { key: 'PageDown' }); });
    expect(level()).toBeGreaterThan(0);
  });

  test('a slow push past an end never fills the bar against the drain, and a sustained fast one frees the reader', async () => {
    const slow = await openView();
    atEnd('bottom');
    /* 5 px a frame is 300 px a second: 0.6 screens a second, under the 1.5 the drain asks. */
    await frames(60 * 8, pushing(scroller(), 5));
    expect(level()).toBeLessThan(10);
    expect(view()).not.toBeNull();
    slow.unmount();
    document.body.innerHTML = '';

    await openView();
    atEnd('bottom');
    /* 30 px a frame is 3.6 screens a second. */
    await frames(60 * 8, pushing(scroller(), 30));
    expect(view()).toBeNull();
  });

  test('the bar drains to empty when the input stops', async () => {
    await openView();
    atEnd('bottom');
    await frames(40, pushing(scroller(), 30));
    const filled = level();
    expect(filled).toBeGreaterThan(20);
    expect(view()).not.toBeNull();
    await wait(1000);
    expect(level()).toBeLessThan(filled);
    await wait(Math.ceil(1000 / TUNING.drainPerSecond));
    expect(level()).toBe(0);
  });

  test('one huge jump of the wheel fills no more than a hard push for that moment would', async () => {
    await openView();
    atEnd('bottom');
    fireEvent.wheel(scroller(), { deltaY: 20 * SCREEN });
    await frames(2);
    expect(level()).toBeLessThan(10);
    expect(view()).not.toBeNull();
  });

  test('the BREAK FREE button fills against the same drain, and pressing slowly never frees', async () => {
    const slow = await openView();
    const press = () => fireEvent.click(within(view()!).getByRole('button', { name: 'Break free' }));
    const breakEvenMs = (TUNING.fillPerPress / TUNING.drainPerSecond) * 1000;
    /* Every 1.5 times the break-even gap: the drain wins. */
    for (let i = 0; i < 40; i++) {
      press();
      await wait(breakEvenMs * 1.5);
    }
    expect(view()).not.toBeNull();
    expect(level()).toBeLessThan(30);
    slow.unmount();
    document.body.innerHTML = '';

    await openView();
    for (let i = 0; i < 40 && view() !== null; i++) {
      fireEvent.click(within(view()!).getByRole('button', { name: 'Break free' }));
      await wait(breakEvenMs * 0.5);
    }
    expect(view()).toBeNull();
  });
});

/* -------------------------------------------------------------------------------- Esc ---- */
describe('Esc', () => {
  /* The level reached by `count` presses `gap` ms apart, with the view otherwise left alone. */
  async function reached(count: number, gap: number, press: 'button' | 'escape', init: { repeat?: boolean } = {}) {
    const { unmount } = await openView();
    for (let i = 0; i < count && view() !== null; i++) {
      if (press === 'button') fireEvent.click(within(view()!).getByRole('button', { name: 'Break free' }));
      else fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', ...init });
      await wait(gap);
    }
    const now = view() === null ? 100 : level();
    unmount();
    document.body.innerHTML = '';
    return now;
  }

  test('each Esc press fills the bar exactly as one press of BREAK FREE does, against the same drain', async () => {
    expect(await reached(1, 40, 'button')).toBeGreaterThan(0);
    for (const count of [1, 3, 5]) {
      const button = await reached(count, 250, 'button');
      const escape = await reached(count, 250, 'escape');
      expect(escape, `${count} presses`).toBe(button);
      expect(escape).toBeGreaterThan(0);
    }
  });

  test('pressing Esc slowly never frees, and pressing it fast does, as the button does', async () => {
    const breakEvenMs = (TUNING.fillPerPress / TUNING.drainPerSecond) * 1000;
    expect(await reached(40, breakEvenMs * 1.5, 'escape')).toBeLessThan(30);
    expect(await reached(40, breakEvenMs * 0.5, 'escape')).toBe(100);
  });

  test('a held Esc, its auto-repeat arriving a few milliseconds apart, fills no faster than the button pressed as often, or than tapping 8 times a second', async () => {
    /* Eighteen repeats of a held key, 30 a second: 0.6 s, not long enough to fill the bar either way. */
    const heldKey = await reached(18, 1000 / 30, 'escape', { repeat: true });
    const heldButton = await reached(18, 1000 / 30, 'button');
    expect(heldKey).toBe(heldButton);
    /* The press gap lets one in 120 ms through: tapping every 125 ms for the same 0.6 s counts the same. */
    const tapping = await reached(5, 125, 'escape');
    expect(heldKey).toBeGreaterThan(0);
    /* Within half a press of it, since the two arrive at different moments of the drain. */
    expect(heldKey).toBeLessThanOrEqual(tapping + (TUNING.fillPerPress * 100) / 2);
  });

  test('the view never closes on Esc alone before the bar is full, has no Close, and says what Esc does', async () => {
    await openView();
    const ways = within(view()!).getByRole('status');
    expect(ways).toHaveTextContent('');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await wait(40);
    expect(view()).not.toBeNull();
    expect(ways).toHaveTextContent(/Esc breaks free, like the Break free button/u);
    expect(ways).not.toHaveTextContent(/does not close/u);
    expect(within(view()!).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  test('pressing the dimmed page behind does not close the view either, and says which ways out there are', async () => {
    await openView();
    const backdrop = view()!.parentElement!;
    fireEvent.mouseDown(backdrop);
    await wait(40);
    expect(view()).not.toBeNull();
    expect(within(view()!).getByRole('status')).toHaveTextContent(/does not close this/u);
    expect(within(view()!).getByRole('status')).toHaveTextContent(/Scroll past either end of the post, press Break free, or check the box/u);
  });
});

/* ----------------------------------------------------------------------- where the reader lands ---- */
describe('where a full bar puts the reader', () => {
  test('a release pushed down lands after the post, and the view and its dimming are gone', async () => {
    const { container } = await openView();
    atEnd('bottom');
    await frames(60 * 6, pushing(scroller(), 40));
    await wait(50);
    expect(view()).toBeNull();
    expect(container).not.toHaveAttribute('inert');
    /* Just past the post's end: its bottom (520) less the sliver, scrolled to the top of the window. */
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0]![0].top).toBe(geometry.post.bottom - 24);
  });

  test('a release pushed up lands before the post', async () => {
    await openView();
    atEnd('top');
    await frames(60 * 6, pushing(scroller(), -40));
    await wait(50);
    expect(view()).toBeNull();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    /* The post's start at the bottom of the window, a sliver of it in view. */
    expect(scrollBy.mock.calls[0]![0].top).toBe(geometry.post.top - (WINDOW - 24));
  });

  test('breaking free lasts the visit: the post is not taken again, and a fresh visit holds it again', async () => {
    const w = world();
    const first = await openView(w);
    atEnd('bottom');
    await frames(60 * 6, pushing(scroller(), 40));
    await wait(50);
    expect(view()).toBeNull();
    await settleOn({ top: 200, bottom: 520 });
    expect(view()).toBeNull();
    /* The server heard nothing of it: the reader certified nothing. */
    expect(await w.fake.myReleases([w.play])).toEqual([]);
    first.unmount();
  });
});

/* ------------------------------------------------------------------------------ the keys ---- */
describe('for a keyboard and a screen reader', () => {
  test('the checkbox at the end of the post is reached in the view, named by the caster\'s sentence, and the button says how it works', async () => {
    await openView();
    const dialog = view()!;
    const release = within(dialog).getByRole('region', { name: 'Release' });
    const checkbox = within(release).getByRole('checkbox', { name: new RegExp(SENTENCE.replace(/[.*+?^${}()|[\]\\']/gu, '.')) });
    expect(checkbox).not.toBeChecked();
    /* After the post's words, in reading order, in the same region the keyboard scrolls. */
    const post = within(dialog).getByRole('article', { name: /^Held post/u });
    expect(post.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroller().contains(checkbox)).toBe(true);
    const button = within(dialog).getByRole('button', { name: 'Break free' });
    expect(button).toHaveAccessibleDescription(/Press it again and again to fill the bar, as fast scrolling does\. The bar drains whenever you stop\./u);
    expect(within(dialog).getByRole('progressbar', { name: 'Break free' })).toHaveAttribute('aria-valuenow', '0');
  });

  test('certifying calls the server, releases the reader, and a refusal leaves the view up with its words', async () => {
    const w = world();
    await openView(w);
    vi.spyOn(w.fake, 'releaseEffect').mockResolvedValueOnce({ ok: false, error: 'the server would not' });
    fireEvent.click(within(view()!).getByRole('checkbox'));
    await wait(50);
    expect(within(view()!).getByRole('alert')).toHaveTextContent('the server would not');
    expect(within(view()!).getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(within(view()!).getByRole('checkbox'));
    await wait(50);
    expect(view()).toBeNull();
  });
});

