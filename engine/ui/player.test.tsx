import { useLayoutEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Estimate, KayfaApi, MyCharacter, Session } from './data/api.ts';
import { PlayerProvider, usePlayer } from './player.tsx';

const char = (id: string, over: Partial<MyCharacter> = {}): MyCharacter => ({
  id, name: id.toUpperCase(), class: 'face', classSince: '2026-10-01T00:00:00Z', turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  debutLoudness: 'silent', retiredAt: null, pendingTurn: null, ...over,
});

function stubApi(over: Partial<KayfaApi> = {}) {
  const session: Session = { signedIn: true, account: 'acc-1' };
  const estimate = vi.fn(async (): Promise<Estimate> => ({ entries: [{ character: 'a', reason: 'face.cheered', amount: 30 }], lines: [], asOf: new Date(Date.now()).toISOString(), freshAfter: new Date(Date.now() + 30_000).toISOString() }));
  const api = {
    session: async () => session,
    onSession: () => () => {},
    myCharacters: async () => [char('a'), char('b'), char('w', { debutedAt: null }), char('r', { retiredAt: '2026-10-02T00:00:00Z' })],
    wallet: async () => ({ balance: 240, cap: 600 }),
    myCards: async () => [{ card: 'whoops', held: 2 }],
    lastSettledAt: async () => '2026-10-28T08:17:00Z',
    estimate,
    ...over,
  } as unknown as KayfaApi;
  return { api, estimate };
}

function Probe() {
  const p = usePlayer();
  return (
    <div>
      <span data-testid="hud">{p.hudCharacter?.id ?? 'none'}</span>
      <span data-testid="pending">{p.pending}</span>
      <span data-testid="acting">{p.actingCharacters.map((c) => c.id).join(',')}</span>
      <button onClick={() => p.setHudCharacter('b')}>swap</button>
      <button onClick={() => p.reactionLanded()}>landed</button>
    </div>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('the player behind the HUD', () => {
  test('the HUD\'s character is one that can act, kept per device and per account', async () => {
    const { api } = stubApi();
    const { unmount } = render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('a'));
    expect(screen.getByTestId('acting').textContent).toBe('a,b');
    act(() => screen.getByText('swap').click());
    expect(screen.getByTestId('hud').textContent).toBe('b');
    unmount();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('b'));
    expect(Object.keys(localStorage).some((k) => k.includes('acc-1'))).toBe(true);
  });
  test('a kept character that can no longer act falls back to the first that can', async () => {
    localStorage.setItem('kb-hud:acc-1', 'r');
    const { api } = stubApi();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('a'));
  });
});

describe('the estimate is asked for on events, never on a timer', () => {
  test('once when the HUD opens, and the pending figure is the sum of its entries', async () => {
    const { api, estimate } = stubApi();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('30'));
    expect(estimate).toHaveBeenCalledTimes(1);
  });
  test('a storm of reactions before freshAfter is one ask at freshAfter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, estimate } = stubApi();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 25; i++) act(() => screen.getByText('landed').click());
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(estimate).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(estimate).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(estimate).toHaveBeenCalledTimes(2);
  });
  test('a reaction after freshAfter asks at once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, estimate } = stubApi();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(estimate).toHaveBeenCalledTimes(1);
    act(() => screen.getByText('landed').click());
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(2));
  });
  test('signed out, nothing is asked', async () => {
    const { api, estimate } = stubApi({ session: async () => ({ signedIn: false, account: null }) });
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await act(async () => {});
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.getByTestId('hud').textContent).toBe('none');
  });
});

describe('from the Task 3 quality review: an account switch, a failed read', () => {
  function switchable() {
    let listener: (s: Session) => void = () => {};
    let resolveA: (e: Estimate) => void = () => {};
    const estimate = vi.fn((): Promise<Estimate> => {
      if (estimate.mock.calls.length === 1) return new Promise((r) => { resolveA = r; });
      return Promise.resolve({ entries: [{ character: 'x', reason: 'face.cheered', amount: 7 }], lines: [], asOf: null, freshAfter: null });
    });
    const api = {
      session: async () => ({ signedIn: true, account: 'acc-a' }),
      onSession: (l: (s: Session) => void) => { listener = l; return () => {}; },
      myCharacters: async () => [char('a')],
      wallet: async () => ({ balance: 100, cap: 600 }),
      myCards: async () => [],
      estimate,
    } as unknown as KayfaApi;
    return { api, estimate, switchTo: (account: string | null) => act(() => listener({ signedIn: account !== null, account })), answerA: (amount: number) => resolveA({ entries: [{ character: 'a', reason: 'face.cheered', amount }], lines: [], asOf: null, freshAfter: null }) };
  }
  test('an estimate that answers after the account changed is dropped, and the new account asks at once', async () => {
    const w = switchable();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(w.estimate).toHaveBeenCalledTimes(1));
    w.switchTo('acc-b');
    await waitFor(() => expect(w.estimate).toHaveBeenCalledTimes(2));
    await act(async () => { w.answerA(999); });
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('7'));
  });
  test('an estimate that answers after sign-out shows nothing', async () => {
    const w = switchable();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(w.estimate).toHaveBeenCalledTimes(1));
    w.switchTo(null);
    await act(async () => { w.answerA(999); });
    expect(screen.getByTestId('pending').textContent).toBe('0');
  });
  test('a failed read of the player\'s rows still ends loading, so the HUD is never a blank bar', async () => {
    const { api } = stubApi({ myCharacters: async () => { throw new Error('no answer came back'); } });
    function Loaded() { const p = usePlayer(); return <span data-testid="loaded">{String(p.loaded)}</span>; }
    render(<PlayerProvider api={api}><Loaded /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
  });
  test('signing in is not "loaded" until the player\'s rows have come', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { api } = stubApi({ myCharacters: async () => { await gate; return [char('a')]; } });
    function Loaded() { const p = usePlayer(); return <span data-testid="loaded">{String(p.loaded)}:{p.characters.length}</span>; }
    render(<PlayerProvider api={api}><Loaded /></PlayerProvider>);
    await act(async () => {});
    expect(screen.getByTestId('loaded').textContent).toBe('false:0');
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true:1'));
  });
  test('the wallet last seen on this device is where a cascade starts, until it is marked seen', async () => {
    localStorage.setItem('kb-wallet-seen:acc-1', '140');
    const { api } = stubApi();
    function Seen() { const p = usePlayer(); return <><span data-testid="seen">{String(p.walletSeen)}</span><button onClick={p.markWalletSeen}>seen</button></>; }
    render(<PlayerProvider api={api}><Seen /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('seen').textContent).toBe('140'));
    act(() => screen.getByText('seen').click());
    expect(screen.getByTestId('seen').textContent).toBe('null');
    expect(localStorage.getItem('kb-wallet-seen:acc-1')).toBe('240');
  });
  test('a first visit on this device has nothing to cascade from', async () => {
    const { api } = stubApi();
    function Seen() { const p = usePlayer(); return <span data-testid="seen">{String(p.walletSeen)}:{String(p.wallet?.balance)}</span>; }
    render(<PlayerProvider api={api}><Seen /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('seen').textContent).toBe('null:240'));
    /* The write is an effect after the render that shows the wallet, so it is waited for, not assumed. */
    await waitFor(() => expect(localStorage.getItem('kb-wallet-seen:acc-1')).toBe('240'));
  });
});

describe('from PR #49\'s fifth review: what the provider holds is the account\'s it was read for', () => {
  /* Two accounts with their own rows and their own estimates; the session is switched as another tab would. */
  function twoAccounts(estimates: { readonly a: () => Promise<Estimate>; readonly b: () => Promise<Estimate> }) {
    let listener: (s: Session) => void = () => {};
    let account = 'acc-a';
    const rows = {
      'acc-a': { chars: [char('a')], wallet: { balance: 100, cap: 600 } },
      'acc-b': { chars: [char('z')], wallet: { balance: 500, cap: 600 } },
    } as const;
    const api = {
      session: async () => ({ signedIn: true, account }),
      onSession: (l: (s: Session) => void) => { listener = l; return () => {}; },
      myCharacters: async () => rows[account as keyof typeof rows].chars,
      wallet: async () => rows[account as keyof typeof rows].wallet,
      myCards: async () => [],
      estimate: vi.fn(() => (account === 'acc-a' ? estimates.a() : estimates.b())),
    } as unknown as KayfaApi;
    const switchTo = (next: string) => act(() => { account = next; listener({ signedIn: true, account: next }); });
    return { api, switchTo };
  }
  const answer = (amount: number): Estimate => ({ entries: [{ character: 'x', reason: 'face.cheered', amount }], lines: [], asOf: null, freshAfter: null });

  test('no commit pairs the account signed in now with rows read for the last one', async () => {
    const w = twoAccounts({ a: async () => answer(11), b: async () => answer(77) });
    const commits: string[] = [];
    function Record() {
      const p = usePlayer();
      useLayoutEffect(() => {
        commits.push(`${p.session.account}|${p.wallet?.balance ?? '-'}|${p.hudCharacter?.id ?? '-'}|${p.characters.map((c) => c.id).join(',')}`);
      });
      return null;
    }
    render(<PlayerProvider api={w.api}><Record /></PlayerProvider>);
    await waitFor(() => expect(commits.at(-1)).toBe('acc-a|100|a|a'));
    w.switchTo('acc-b');
    await waitFor(() => expect(commits.at(-1)).toBe('acc-b|500|z|z'));
    expect(commits.filter((c) => c.startsWith('acc-b|') && (c.includes('|100|') || /\|a(\||,|$)/u.test(c)))).toEqual([]);
  });

  test('a reaction landed for one account asks nothing, and files nothing, once another is signed in', async () => {
    let aAsked = 0;
    const w = twoAccounts({
      /* A answers its first ask; its asks after that never answer. */
      a: () => (++aAsked === 1 ? Promise.resolve(answer(11)) : new Promise<Estimate>(() => {})),
      b: async () => answer(77),
    });
    let landedForA: (() => void) | null = null;
    function Keep() {
      const p = usePlayer();
      if (p.session.account === 'acc-a' && landedForA === null) landedForA = p.reactionLanded;
      return <span data-testid="pending">{p.pending}</span>;
    }
    render(<PlayerProvider api={w.api}><Keep /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('11'));
    w.switchTo('acc-b');
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('77'));
    /* A's reaction answers late, as the picker's choose does after its await, with B signed in. */
    await act(async () => { landedForA!(); });
    w.switchTo('acc-a');
    await act(async () => {});
    expect(screen.getByTestId('pending').textContent).not.toBe('77');
  });

  test('a reaction landed for the last account takes nothing from the one signed in now: its own next reaction still shows', async () => {
    let bAsked = 0;
    const w = twoAccounts({ a: async () => answer(11), b: async () => answer(++bAsked === 1 ? 77 : 88) });
    let landedForA: (() => void) | null = null;
    let landed: () => void = () => {};
    function Keep() {
      const p = usePlayer();
      if (p.session.account === 'acc-a' && landedForA === null) landedForA = p.reactionLanded;
      landed = p.reactionLanded;
      return <span data-testid="pending">{p.pending}</span>;
    }
    render(<PlayerProvider api={w.api}><Keep /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('11'));
    w.switchTo('acc-b');
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('77'));
    /* A's late reaction, then B's own, in one turn: B's must be asked and shown. */
    await act(async () => { landedForA!(); landed(); });
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('88'));
  });
});

describe('from the Task 7 re-review: drafts leave the device only with their account', () => {
  function sessions() {
    let listener: (s: Session) => void = () => {};
    const { api } = stubApi({ onSession: ((l: (s: Session) => void) => { listener = l; return () => {}; }) as KayfaApi['onSession'] });
    return { api, emit: (s: Session) => act(() => listener(s)) };
  }
  test('signed in with no account for a moment (a refresh, a failed whoami) keeps the drafts', async () => {
    const w = sessions();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('a'));
    localStorage.setItem('kb-draft:acc-1:t1', JSON.stringify({ text: 'unsent', as: 'a' }));
    w.emit({ signedIn: true, account: null });
    expect(localStorage.getItem('kb-draft:acc-1:t1')).not.toBeNull();
  });
  test('signing out takes them', async () => {
    const w = sessions();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('a'));
    localStorage.setItem('kb-draft:acc-1:t1', JSON.stringify({ text: 'unsent', as: 'a' }));
    w.emit({ signedIn: false, account: null });
    expect(localStorage.getItem('kb-draft:acc-1:t1')).toBeNull();
  });
});
