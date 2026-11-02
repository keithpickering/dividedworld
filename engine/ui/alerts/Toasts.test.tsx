import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountListener, Alert, KayfaApi, ReachListener, Update } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { Toasts } from './Toasts.tsx';
import { TOAST_DEFAULTS, toastsOn } from './toast-kinds.ts';
import { useAlertFeed } from './useAlertFeed.ts';

const ACCOUNT = 'acc';
const NOW = '2026-11-02T10:00:00Z';

/** A backend that holds the listeners, so a test can send an alert or news as the server would. */
function backend(options: { unread?: () => number; updates?: readonly Update[] } = {}) {
  const heard: { account: AccountListener | null; reach: ReachListener | null; accountOff: number; reachOff: number } = { account: null, reach: null, accountOff: 0, reachOff: 0 };
  const api = {
    alertsUnread: vi.fn(async () => options.unread?.() ?? 0),
    subscribeAccount: vi.fn((l: AccountListener) => { heard.account = l; return () => { heard.accountOff += 1; }; }),
    subscribeReach: vi.fn((l: ReachListener) => { heard.reach = l; return () => { heard.reachOff += 1; }; }),
    actsById: vi.fn(async () => []),
    characters: vi.fn(async () => []),
    thread: vi.fn(async () => null),
    updates: vi.fn(async () => options.updates ?? []),
  } as unknown as KayfaApi;
  return { api, heard };
}

const quote = (id: string, over: Partial<{ kind: Alert['kind']; sub: string | null; act: string | null; at: string }> = {}) =>
  ({ id, kind: 'quote' as const, sub: null, act: null, character: null, at: NOW, ...over });

function Harness({ api, hand = false, path = '/' }: { readonly api: KayfaApi; readonly hand?: boolean; readonly path?: string }) {
  const feed = useAlertFeed(api, ACCOUNT, path);
  return (
    <>
      <output data-testid="unread">{feed.unread === null ? 'none' : feed.unread}</output>
      <Toasts arrivals={feed.arrivals} hold={hand} />
    </>
  );
}

function mount(b: ReturnType<typeof backend>, props: { hand?: boolean; path?: string } = {}) {
  const kayfa = {
    api: b.api, instance: { cards: [] }, ui: { glass: testGlass, copy: {} }, settings: { postsPerPage: 20, walletCap: 600 },
  } as unknown as Kayfa;
  const tree = (hand: boolean, path: string) => (
    <RouterProvider><KayfaProvider value={kayfa}><Harness api={b.api} hand={hand} path={path} /></KayfaProvider></RouterProvider>
  );
  const view = render(tree(props.hand ?? false, props.path ?? '/'));
  return { ...view, again: (next: { hand?: boolean; path?: string }) => view.rerender(tree(next.hand ?? props.hand ?? false, next.path ?? props.path ?? '/')) };
}

/** An alert reaches the account, and what resolving its words reads settles. */
const send = async (b: ReturnType<typeof backend>, a: ReturnType<typeof quote>) => { await act(async () => { b.heard.account?.onAlert?.(a); }); };
const toasts = () => screen.queryAllByRole('article');
const reduceMotion = (on: boolean) => { if (on) document.documentElement.setAttribute('data-kb-motion', 'reduce'); else document.documentElement.setAttribute('data-kb-motion', 'full'); };

beforeEach(() => { window.history.replaceState(null, '', '/'); reduceMotion(true); });
afterEach(() => { vi.useRealTimers(); document.documentElement.removeAttribute('data-kb-motion'); });

describe('which kinds toast', () => {
  test('the design\'s defaults: quotes, cards on yours, traps, rulings, settlements and updates on; followed threads, hints and season news off', () => {
    expect(Object.entries(TOAST_DEFAULTS).filter(([, on]) => on).map(([k]) => k).sort()).toEqual(['cardOnYours', 'quote', 'ruling', 'settlement', 'trapSprang', 'trapStruck', 'update']);
    expect(toastsOn(null, 'quote')).toBe(true);
    expect(toastsOn(null, 'seasonNews')).toBe(false);
  });
  test('a player\'s own choice beats the defaults, and a never-chosen null leaves them', () => {
    expect(toastsOn({ toasts: ['hint'] }, 'hint')).toBe(true);
    expect(toastsOn({ toasts: ['hint'] }, 'quote')).toBe(false);
    expect(toastsOn({ toasts: null }, 'quote')).toBe(true);
    expect(toastsOn(null, 'hint', { ...TOAST_DEFAULTS, hint: true })).toBe(true);
  });
});

describe('the column', () => {
  test('is a polite live region, there before anything arrives', () => {
    const { container } = mount(backend());
    const live = container.querySelector('[aria-live]');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status', { name: 'New alerts' })).toBe(live);
  });

  test('three show, and the rest fold into "+N more", which opens Alerts', async () => {
    const b = backend();
    mount(b);
    for (const id of ['1', '2', '3', '4', '5']) await send(b, quote(id));
    expect(toasts()).toHaveLength(3);
    const more = screen.getByRole('link', { name: '+2 more' });
    expect(more).toHaveAttribute('href', '/alerts');
    await userEvent.click(more);
    expect(window.location.pathname).toBe('/alerts');
  });

  test('a toast holds its icon, the line, its time and a dismiss button of at least 44px; dismissing removes it and the next rises', async () => {
    const b = backend();
    mount(b);
    for (const id of ['1', '2', '3', '4']) await send(b, quote(id));
    expect(toasts()).toHaveLength(3);
    const first = toasts()[0]!;
    expect(within(first).getByText('your post was quoted')).toBeInTheDocument();
    expect(first.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(first.querySelector('time')).toHaveAttribute('datetime', NOW);
    const dismiss = within(first).getByRole('button', { name: /^Dismiss/ });
    expect(dismiss.className).toContain('kb-toast-x');
    await userEvent.click(dismiss);
    await waitFor(() => expect(toasts()).toHaveLength(3));
    expect(screen.queryByRole('link', { name: /more/ })).toBeNull();
  });

  test('fades by itself after about six seconds, and the next one rises', async () => {
    vi.useFakeTimers();
    const b = backend();
    mount(b);
    for (const id of ['1', '2', '3', '4']) await send(b, quote(id));
    expect(toasts()).toHaveLength(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(toasts()).toHaveLength(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    /* The first three have all had their six seconds together; the fourth rose and has its own. */
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
    expect(toasts()).toHaveLength(0);
  });

  test('a hovered toast stays past its time and goes with the time it had left once the pointer leaves', async () => {
    vi.useFakeTimers();
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    const card = toasts()[0]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    fireEvent.mouseEnter(card);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(toasts()).toHaveLength(1);
    fireEvent.mouseLeave(card);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(toasts()).toHaveLength(0);
  });

  test('a focused toast stays past its time and goes after focus leaves it', async () => {
    vi.useFakeTimers();
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    const dismiss = within(toasts()[0]!).getByRole('button', { name: /^Dismiss/ });
    act(() => dismiss.focus());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(toasts()).toHaveLength(1);
    act(() => dismiss.blur());
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(toasts()).toHaveLength(0);
  });

  test('a toast with a way offers one link, and following it dismisses the toast', async () => {
    const b = backend({ updates: [{ act: 'u1', name: 'Dev', title: 'Traps bite', at: NOW } as Update] });
    mount(b);
    await send(b, quote('1', { kind: 'update', act: 'u1' }));
    const card = toasts()[0]!;
    expect(within(card).getByText('New update from Dev: “Traps bite”')).toBeInTheDocument();
    const links = within(card).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Read it in Updates']);
    await userEvent.click(links[0]!);
    expect(window.location.pathname).toBe('/updates');
    expect(toasts()).toHaveLength(0);
  });

  test('the same alert arriving twice toasts once', async () => {
    const b = backend();
    mount(b);
    await send(b, quote('same'));
    await send(b, quote('same'));
    expect(toasts()).toHaveLength(1);
    await send(b, quote('other'));
    expect(toasts()).toHaveLength(2);
  });

  test('a kind turned off does not toast, but counts', async () => {
    let unread = 0;
    const b = backend({ unread: () => unread });
    mount(b);
    unread = 1;
    await send(b, quote('1', { kind: 'hint', sub: 'leading:x' }));
    expect(toasts()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /more/ })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    unread = 2;
    await send(b, quote('2', { kind: 'seasonNews', sub: 'tally' }));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));
    expect(toasts()).toHaveLength(0);
  });

  test('news that lands on reach toasts when its kind is on, once however often it is heard', async () => {
    const b = backend({ updates: [{ act: 'u1', name: 'Dev', title: 'Traps bite', at: NOW } as Update] });
    mount(b);
    const news = { kind: 'update' as const, sub: null, act: 'u1', at: NOW };
    await act(async () => { b.heard.reach?.onNews?.(news); b.heard.reach?.onNews?.(news); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { b.heard.reach?.onNews?.({ kind: 'seasonNews', sub: 'tally', act: 't1', at: NOW }); });
    expect(toasts()).toHaveLength(1);
  });
});

describe('the hand', () => {
  test('nothing toasts while the hand is open; the toasts rise when it closes, and none was lost', async () => {
    const b = backend();
    const view = mount(b, { hand: true });
    await send(b, quote('1'));
    await send(b, quote('2'));
    expect(toasts()).toHaveLength(0);
    view.again({ hand: false });
    await waitFor(() => expect(toasts()).toHaveLength(2));
  });

  test('a toast on screen when the hand opens waits, and keeps the time it had left', async () => {
    vi.useFakeTimers();
    const b = backend();
    const view = mount(b);
    await send(b, quote('1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    view.again({ hand: true });
    expect(toasts()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    view.again({ hand: false });
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(toasts()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(toasts()).toHaveLength(0);
  });
});

describe('motion', () => {
  test('reduced motion renders no transform, on arrival or after', async () => {
    reduceMotion(true);
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    const card = toasts()[0]!;
    for (const el of [card, card.parentElement!]) expect(el.style.transform === '' || el.style.transform === 'none').toBe(true);
  });

  test('with motion the toast slides in (a transform), so the check above can tell', async () => {
    reduceMotion(false);
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    expect(toasts()[0]!.style.transform).toContain('translateY');
  });

  test('with motion a dismissed toast still leaves', async () => {
    reduceMotion(false);
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    await userEvent.click(within(toasts()[0]!).getByRole('button', { name: /^Dismiss/ }));
    await waitFor(() => expect(toasts()).toHaveLength(0));
  });
});

describe('the account', () => {
  test('hears the account\'s channel and reach, lets go of both on unmount, and the count is read again on a new page', async () => {
    let unread = 0;
    const b = backend({ unread: () => unread });
    const view = mount(b);
    expect(b.api.subscribeAccount).toHaveBeenCalledTimes(1);
    expect(b.api.subscribeReach).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('0'));
    unread = 4;
    view.again({ path: '/b/general' });
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('4'));
    expect(b.api.subscribeAccount).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(b.heard.accountOff).toBe(1);
    expect(b.heard.reachOff).toBe(1);
  });
});
