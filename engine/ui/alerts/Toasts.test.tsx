import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type AccountListener, type Alert, type KayfaApi, type Preferences, type ReachListener, type Update } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { Toasts } from './Toasts.tsx';
import { TOAST_DEFAULTS, toastsOn } from './toast-kinds.ts';
import { announceToastChoice } from './toast-choice.ts';
import { useAlertFeed } from './useAlertFeed.ts';

const ACCOUNT = 'acc';
const NOW = '2026-11-02T10:00:00Z';

/** A backend that holds the listeners, so a test can send an alert or news as the server would. */
function backend(options: { unread?: () => number; updates?: readonly Update[]; rows?: () => readonly Alert[]; toasts?: Preferences['toasts'] } = {}) {
  const heard: { account: AccountListener | null; reach: ReachListener | null; accountOff: number; reachOff: number } = { account: null, reach: null, accountOff: 0, reachOff: 0 };
  const api = {
    alertsUnread: vi.fn(async () => options.unread?.() ?? 0),
    subscribeAccount: vi.fn((l: AccountListener) => { heard.account = l; return () => { heard.accountOff += 1; }; }),
    subscribeReach: vi.fn((l: ReachListener) => { heard.reach = l; return () => { heard.reachOff += 1; }; }),
    actsById: vi.fn(async () => []),
    characters: vi.fn(async () => []),
    thread: vi.fn(async () => null),
    updates: vi.fn(async () => options.updates ?? []),
    alerts: vi.fn(async () => options.rows?.() ?? []),
    preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, toasts: options.toasts ?? null })),
  } as unknown as KayfaApi;
  return { api, heard };
}

const quote = (id: string, over: Partial<{ kind: Alert['kind']; sub: string | null; act: string | null; at: string }> = {}) =>
  ({ id, kind: 'quote' as const, sub: null, act: null, character: null, at: NOW, ...over });

const focusBack = vi.fn();
function Harness({ api, hand = false, path = '/' }: { readonly api: KayfaApi; readonly hand?: boolean; readonly path?: string }) {
  const feed = useAlertFeed(api, ACCOUNT, path);
  return (
    <>
      <output data-testid="unread">{feed.unread === null ? 'none' : feed.unread}</output>
      <Toasts arrivals={feed.arrivals} hold={hand} returnFocus={focusBack} />
    </>
  );
}

function mount(b: ReturnType<typeof backend>, props: { hand?: boolean; path?: string; toastDefaults?: readonly Alert['kind'][] } = {}) {
  const kayfa = {
    api: b.api, instance: { cards: [] }, ui: { glass: testGlass, copy: {} }, settings: { postsPerPage: 20, walletCap: 600, ...(props.toastDefaults ? { toastDefaults: props.toastDefaults } : {}) },
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

beforeEach(() => { window.history.replaceState(null, '', '/'); reduceMotion(true); focusBack.mockClear(); });
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
    const more = screen.getByRole('link', { name: '+2 more alerts' });
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
    expect(screen.queryByRole('link', { name: /more alerts/ })).toBeNull();
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
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(toasts()).toHaveLength(1);
    fireEvent.pointerLeave(card, { pointerType: 'mouse' });
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
    expect(screen.queryByRole('link', { name: /more alerts/ })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    unread = 2;
    await send(b, quote('2', { kind: 'seasonNews', sub: 'tally' }));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));
    expect(toasts()).toHaveLength(0);
  });

  test('the kinds the player chose toast, whatever the instance\'s defaults say; the rest count and wait in Alerts', async () => {
    let unread = 0;
    const b = backend({ unread: () => unread, toasts: ['hint'] });
    mount(b);
    await act(async () => {});
    unread = 1;
    await send(b, quote('1'));
    expect(toasts()).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    unread = 2;
    await send(b, quote('2', { kind: 'hint', sub: 'leading:x' }));
    expect(toasts()).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));
  });

  test('a player who never chose gets the instance\'s defaults, and a choice of nothing silences every kind', async () => {
    const instanceOnly = backend({ toasts: null });
    const first = mount(instanceOnly, { toastDefaults: ['seasonNews'] });
    await act(async () => {});
    await send(instanceOnly, quote('1'));
    expect(toasts()).toHaveLength(0);
    await send(instanceOnly, quote('2', { kind: 'seasonNews', sub: 'tally' }));
    expect(toasts()).toHaveLength(1);
    first.unmount();
    const silent = backend({ toasts: [] });
    mount(silent);
    await act(async () => {});
    await send(silent, quote('3'));
    expect(toasts()).toHaveLength(0);
  });

  test('a change made in Settings reaches the toasts with no reload, and a reset goes back to the instance\'s defaults', async () => {
    const b = backend({ toasts: null });
    mount(b);
    await act(async () => {});
    await send(b, quote('1', { kind: 'hint', sub: 'leading:x' }));
    expect(toasts()).toHaveLength(0);
    await act(async () => { announceToastChoice(['hint']); });
    await send(b, quote('2', { kind: 'hint', sub: 'leading:y' }));
    expect(toasts()).toHaveLength(1);
    await act(async () => { announceToastChoice(null); });
    await send(b, quote('3', { kind: 'hint', sub: 'leading:z' }));
    expect(toasts()).toHaveLength(1);
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

describe('a settlement', () => {
  const row = (sub: string, count = 2): Alert => ({ kind: 'settlement', sub, act: null, character: null, at: '2026-11-02T08:00:01Z', thread: null, name: null, title: null, count });
  const settled = (b: ReturnType<typeof backend>, id: string) => act(async () => { b.heard.reach?.onSettled?.({ id, at: '2026-11-02T08:00:01Z' }); });
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('that moved the player\'s characters toasts when it is announced, in the Alerts row\'s words, and the count is read again', async () => {
    let unread = 0;
    let rows: readonly Alert[] = [];
    const b = backend({ unread: () => unread, rows: () => rows });
    mount(b);
    unread = 1; rows = [row('7')];
    await settled(b, '7');
    await waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0]).toHaveTextContent('A settlement is in');
    expect(toasts()[0]).toHaveTextContent('It moved 2 of your characters.');
    expect(within(toasts()[0]!).getByRole('link', { name: 'Open it in My log' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
  });

  test('that moved none of them toasts nothing, and one announced twice toasts once', async () => {
    let rows: readonly Alert[] = [];
    const b = backend({ rows: () => rows });
    mount(b);
    await settled(b, '8');
    await waitFor(() => expect(b.api.alerts).toHaveBeenCalled());
    expect(toasts()).toHaveLength(0);
    rows = [row('9')];
    await settled(b, '9');
    await settled(b, '9');
    await waitFor(() => expect(toasts()).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(toasts()).toHaveLength(1);
    expect(b.api.alerts).toHaveBeenCalledTimes(2);
  });

  test('an alerts list that cannot be read toasts nothing and loses nothing', async () => {
    const b = backend();
    (b.api.alerts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    mount(b);
    await settled(b, '3');
    await waitFor(() => expect(b.api.alerts).toHaveBeenCalled());
    expect(toasts()).toHaveLength(0);
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

describe('from the quality review of Task 10', () => {
  const pointer = (type: 'mouse' | 'touch') => ({ pointerType: type });
  const ms = (n: number) => act(async () => { await vi.advanceTimersByTimeAsync(n); });

  test('a toast tapped on a touch device is not held by the tap and still times out; a mouse over it holds it', async () => {
    vi.useFakeTimers();
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    const card = toasts()[0]!;
    fireEvent.pointerEnter(card, pointer('touch'));
    await ms(6_500);
    expect(toasts()).toHaveLength(0);
    await send(b, quote('2'));
    const second = toasts()[0]!;
    fireEvent.pointerEnter(second, pointer('mouse'));
    await ms(30_000);
    expect(toasts()).toHaveLength(1);
    fireEvent.pointerLeave(second, pointer('mouse'));
    await ms(6_500);
    expect(toasts()).toHaveLength(0);
  });

  test('hovered and focused together, leaving one while the other holds keeps the toast, and leaving both lets it go', async () => {
    vi.useFakeTimers();
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    const card = toasts()[0]!;
    const dismiss = within(card).getByRole('button', { name: 'Dismiss' });
    fireEvent.pointerEnter(card, pointer('mouse'));
    act(() => dismiss.focus());
    fireEvent.pointerLeave(card, pointer('mouse'));
    await ms(30_000);
    expect(toasts()).toHaveLength(1);
    fireEvent.pointerEnter(card, pointer('mouse'));
    act(() => dismiss.blur());
    await ms(30_000);
    expect(toasts()).toHaveLength(1);
    fireEvent.pointerLeave(card, pointer('mouse'));
    await ms(6_500);
    expect(toasts()).toHaveLength(0);
  });

  test('a toast with under 200ms left when the hand opens survives it and rises after, with its 100ms', async () => {
    reduceMotion(false);
    vi.useFakeTimers();
    const b = backend();
    const view = mount(b);
    await send(b, quote('1'));
    await ms(5_900);
    view.again({ hand: true });
    await ms(1_000);
    view.again({ hand: false });
    expect(toasts()).toHaveLength(1);
    await ms(50);
    expect(toasts()).toHaveLength(1);
    await ms(100);
    await ms(600);
    expect(toasts()).toHaveLength(0);
  });

  test('a hand opened and closed does not draw the toasts again: the same elements, so a live region does not say them twice', async () => {
    const b = backend();
    const view = mount(b);
    await send(b, quote('1'));
    const before = toasts()[0]!;
    view.again({ hand: true });
    expect(toasts()).toHaveLength(0);
    view.again({ hand: false });
    expect(toasts()[0]).toBe(before);
  });

  test('an arrival does not restart the clock of a toast already on screen', async () => {
    vi.useFakeTimers();
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    await ms(3_000);
    /* (Wrapped by hand and put back as it was: a spy's restore would leave the fake clock's function behind.) */
    const real = globalThis.setTimeout;
    const delays: unknown[] = [];
    globalThis.setTimeout = ((fn: () => void, delay?: number, ...rest: unknown[]) => { delays.push(delay); return (real as (...a: unknown[]) => unknown)(fn, delay, ...rest); }) as typeof setTimeout;
    try {
      await send(b, quote('2'));
      await ms(10);
    } finally { globalThis.setTimeout = real; }
    expect(delays.filter((d) => d === 3_000)).toHaveLength(0);
  });

  test('"+N more" is named for what it opens, and it and a toast\'s link are 44px targets', async () => {
    const b = backend({ updates: [{ act: 'u1', name: 'Dev', title: 'T', at: NOW } as Update] });
    mount(b);
    await send(b, quote('1', { kind: 'update', act: 'u1' }));
    for (const id of ['2', '3', '4']) await send(b, quote(id));
    expect(screen.getByRole('link', { name: '+1 more alerts' }).textContent).toBe('+1 more');
    expect(getComputedStyle(screen.getByRole('link', { name: '+1 more alerts' })).minHeight).toBe('44px');
    expect(getComputedStyle(screen.getByRole('link', { name: 'Read it in Updates' })).minHeight).toBe('44px');
  });

  test('dismissing the toast that has focus moves it to the next toast\'s dismiss button, and to the caller when none is left', async () => {
    const b = backend();
    mount(b);
    await send(b, quote('1'));
    await send(b, quote('2'));
    const [first, second] = toasts();
    const one = within(first!).getByRole('button', { name: 'Dismiss' });
    one.focus();
    await userEvent.click(one);
    expect(within(second!).getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    expect(focusBack).not.toHaveBeenCalled();
    const last = within(second!).getByRole('button', { name: 'Dismiss' });
    await userEvent.click(last);
    expect(focusBack).toHaveBeenCalledTimes(1);
  });

  test('the device\'s own reduced-motion setting is honored when the player has made no choice', async () => {
    document.documentElement.removeAttribute('data-kb-motion');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      const b = backend();
      mount(b);
      await send(b, quote('1'));
      expect(toasts()[0]!.style.transform === '' || toasts()[0]!.style.transform === 'none').toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  test('a burst of arrivals reads the count once, a little after the last', async () => {
    const b = backend();
    mount(b);
    await waitFor(() => expect(b.api.alertsUnread).toHaveBeenCalledTimes(1));
    for (const id of ['1', '2', '3', '4']) await send(b, quote(id));
    expect(b.api.alertsUnread).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(b.api.alertsUnread).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(b.api.alertsUnread).toHaveBeenCalledTimes(2);
  });

  test('a settlement that moved none of the player\'s characters reads no count', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const b = backend();
    mount(b);
    await waitFor(() => expect(b.api.alertsUnread).toHaveBeenCalledTimes(1));
    await act(async () => { b.heard.reach?.onSettled?.({ id: '5', at: NOW }); });
    await waitFor(() => expect(b.api.alerts).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(b.api.alertsUnread).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  test('the settled read is spread over about ten seconds', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const b = backend();
    mount(b);
    await act(async () => { b.heard.reach?.onSettled?.({ id: '6', at: NOW }); });
    await ms(9_000);
    expect(b.api.alerts).not.toHaveBeenCalled();
    await ms(1_500);
    expect(b.api.alerts).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('useAlertFeed on its own', () => {
  test('an account change clears what was heard and counted, closes the old channels and opens new ones', async () => {
    const b = backend({ unread: () => 4 });
    const { result, rerender } = renderHook(({ account }) => useAlertFeed(b.api, account, '/'), { initialProps: { account: 'a' as string | null } });
    await waitFor(() => expect(result.current.unread).toBe(4));
    await act(async () => { b.heard.account?.onAlert?.(quote('x')); });
    expect(result.current.arrivals).toHaveLength(1);
    rerender({ account: 'b' });
    expect(b.heard.accountOff).toBe(1);
    expect(b.heard.reachOff).toBe(1);
    expect(b.api.subscribeAccount).toHaveBeenCalledTimes(2);
    expect(result.current.arrivals).toEqual([]);
    expect(result.current.unread).toBeNull();
    await act(async () => { b.heard.account?.onAlert?.(quote('x')); });
    expect(result.current.arrivals).toHaveLength(1);
  });

  test('what it remembers having heard is bounded: after more than it keeps, the oldest may toast again', async () => {
    const b = backend();
    const { result } = renderHook(() => useAlertFeed(b.api, 'a', '/'));
    await act(async () => { for (let i = 0; i < 150; i++) b.heard.account?.onAlert?.(quote(`id${i}`)); });
    expect(result.current.arrivals).toHaveLength(100);
    await act(async () => { b.heard.account?.onAlert?.(quote('id0')); });
    expect(result.current.arrivals.at(-1)?.id).toBe('id0');
  });
});
