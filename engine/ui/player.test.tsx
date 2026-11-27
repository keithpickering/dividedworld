import { useLayoutEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountListener, Estimate, KayfaApi, MyCharacter, ReachListener, Session, Slot } from './data/api.ts';
import { createFake } from './data/fake.ts';
import { testInstance } from './test-world.tsx';
import { REACH_SPREAD_MS } from './alerts/useAlertFeed.ts';
import { PlayerProvider, usePlayer } from './player.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../rules/pronouns.ts';

const char = (id: string, over: Partial<MyCharacter> = {}): MyCharacter => ({
  id, name: id.toUpperCase(), pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'face', classSince: '2026-10-01T00:00:00Z', classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  retiredAt: null, pendingTurn: null, presenceHidden: false, ...over,
});

function stubApi(over: Partial<KayfaApi> = {}) {
  const session: Session = { signedIn: true, account: 'acc-1', bar: null, conductAccepted: true };
  const estimate = vi.fn(async (): Promise<Estimate> => ({ entries: [{ character: 'a', reason: 'face.cheered', amount: 30 }], lines: [], crowd: null, asOf: new Date(Date.now()).toISOString(), freshAfter: new Date(Date.now() + 30_000).toISOString() }));
  const api = {
    session: async () => session,
    onSession: () => () => {},
    myCharacters: async () => [char('a'), char('b'), char('w', { debutedAt: null }), char('r', { retiredAt: '2026-10-02T00:00:00Z' })],
    wallet: async () => ({ balance: 240, cap: 600 }),
    myCards: async () => [{ card: 'whoops', held: 2 }],
    lastSettledAt: async () => '2026-10-28T08:17:00Z',
    estimate,
    subscribeAccount: () => () => {},
    subscribeReach: () => () => {},
    ...over,
  } as unknown as KayfaApi;
  return { api, estimate };
}

/** The slot that sells Whoops!, and the one that sells a pack. */
const WHOOPS: Slot = { id: 's-1', position: 1, item: { card: 'whoops' }, rarity: 'common', availability: 'onSale', price: 100, move: null };
const BOOSTER: Slot = { id: 's-2', position: 2, item: { pack: 'booster' }, rarity: null, availability: 'onSale', price: 300, move: null };

/** What the last purchase answered. */
let bought: unknown = null;

function Probe() {
  const p = usePlayer();
  return (
    <div>
      <span data-testid="hud">{p.hudCharacter?.id ?? 'none'}</span>
      <span data-testid="pending">{p.pending}</span>
      <span data-testid="acting">{p.actingCharacters.map((c) => c.id).join(',')}</span>
      <span data-testid="writing">{p.writingCharacters.map((c) => c.id).join(',')}</span>
      <button onClick={() => p.setHudCharacter('b')}>swap</button>
      <button onClick={() => p.reactionLanded()}>landed</button>
      <span data-testid="wallet">{p.wallet?.balance ?? 'none'}</span>
      <span data-testid="hand">{p.cards.map((c) => `${c.card}×${c.held}`).join(',')}</span>
      <button onClick={() => void p.buyCard(WHOOPS).then((a) => { bought = a; })}>buy</button>
      <button onClick={() => void p.buyPack(BOOSTER).then((a) => { bought = a; })}>open</button>
    </div>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a purchase from the Vending Machine', () => {
  /* A server whose wallet and hand a purchase changes, as the real one's do. */
  function shop(refuse = false) {
    let balance = 562;
    let held = 2;
    const buyCard = vi.fn(async (slot: Slot) => {
      if (refuse) return { ok: false as const, error: 'that costs 1.00, and your wallet holds 0.62' };
      balance -= 100;
      held += 1;
      return { ok: true as const, value: { card: 'whoops', balance, held } };
    });
    const buyPack = vi.fn(async (_slot: Slot) => {
      balance -= 300;
      held += 5;
      return { ok: true as const, value: { pack: 'p-1', contents: ['whoops', 'whoops', 'whoops', 'whoops', 'whoops'], balance } };
    });
    const { api } = stubApi({ wallet: async () => ({ balance, cap: 600 }), myCards: async () => [{ card: 'whoops', held }], buyCard, buyPack });
    return { api, buyCard, buyPack };
  }

  test('reads the wallet and the hand again once it is bought, so the HUD and the machine show the new count', async () => {
    bought = null;
    const { api, buyCard } = shop();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hand').textContent).toBe('whoops×2'));
    expect(screen.getByTestId('wallet').textContent).toBe('562');
    act(() => screen.getByText('buy').click());
    await waitFor(() => expect(screen.getByTestId('hand').textContent).toBe('whoops×3'));
    expect(screen.getByTestId('wallet').textContent).toBe('462');
    expect(buyCard).toHaveBeenCalledWith(WHOOPS);
    expect(bought).toEqual({ ok: true, value: { card: 'whoops', balance: 462, held: 3 } });
  });

  test('a pack opened reads the wallet and the hand again too, and hands back what it gave', async () => {
    bought = null;
    const { api, buyPack } = shop();
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hand').textContent).toBe('whoops×2'));
    act(() => screen.getByText('open').click());
    await waitFor(() => expect(screen.getByTestId('hand').textContent).toBe('whoops×7'));
    expect(screen.getByTestId('wallet').textContent).toBe('262');
    expect(buyPack).toHaveBeenCalledWith(BOOSTER);
    expect(bought).toEqual({ ok: true, value: { pack: 'p-1', contents: ['whoops', 'whoops', 'whoops', 'whoops', 'whoops'], balance: 262 } });
  });

  test('a refused purchase changes nothing and says why in the server\'s words', async () => {
    bought = null;
    const { api } = shop(true);
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hand').textContent).toBe('whoops×2'));
    act(() => screen.getByText('buy').click());
    await waitFor(() => expect(bought).toEqual({ ok: false, error: 'that costs 1.00, and your wallet holds 0.62' }));
    expect(screen.getByTestId('wallet').textContent).toBe('562');
    expect(screen.getByTestId('hand').textContent).toBe('whoops×2');
  });
});

describe('the player behind the HUD', () => {
  test('the HUD\'s character is one that can act, kept per device and per account', async () => {
    const { api } = stubApi();
    const { unmount } = render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('a'));
    expect(screen.getByTestId('acting').textContent).toBe('a,b');
    /* The masks whose own posts the player answers for: every debuted one, the retired among them, never one still waiting (#85). */
    expect(screen.getByTestId('writing').textContent).toBe('a,b,r');
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
  test('the pending figure adds the crowd pay so far to the entries: 10 and 4 is 14', async () => {
    const { api } = stubApi({ estimate: async (): Promise<Estimate> => ({ entries: [{ character: 'a', reason: 'face.cheered', amount: 10 }], lines: [], crowd: { acts: ['x', 'y'], amount: 4 }, asOf: null, freshAfter: null }) });
    render(<PlayerProvider api={api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('14'));
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
    const { api, estimate } = stubApi({ session: async () => ({ signedIn: false, account: null, bar: null, conductAccepted: true }) });
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
      return Promise.resolve({ entries: [{ character: 'x', reason: 'face.cheered', amount: 7 }], lines: [], crowd: null, asOf: null, freshAfter: null });
    });
    const api = {
      session: async () => ({ signedIn: true, account: 'acc-a', bar: null, conductAccepted: true }),
      onSession: (l: (s: Session) => void) => { listener = l; return () => {}; },
      subscribeAccount: () => () => {},
      subscribeReach: () => () => {},
      myCharacters: async () => [char('a')],
      wallet: async () => ({ balance: 100, cap: 600 }),
      myCards: async () => [],
      estimate,
    } as unknown as KayfaApi;
    return { api, estimate, switchTo: (account: string | null) => act(() => listener({ signedIn: account !== null, account, bar: null, conductAccepted: true })), answerA: (amount: number) => resolveA({ entries: [{ character: 'a', reason: 'face.cheered', amount }], lines: [], crowd: null, asOf: null, freshAfter: null }) };
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
  test('a failed read sets charactersFailed and refresh answers false; the next good read clears it', async () => {
    let fail = true;
    const { api } = stubApi({ myCharacters: async () => { if (fail) throw new Error('down'); return [char('a')]; } });
    let answers: boolean[] = [];
    function Failed() {
      const p = usePlayer();
      return <div><span data-testid="failed">{String(p.charactersFailed)}</span><span data-testid="loaded">{String(p.loaded)}</span><button onClick={() => void p.refresh().then((ok) => { answers = [...answers, ok]; })}>again</button></div>;
    }
    render(<PlayerProvider api={api}><Failed /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('failed').textContent).toBe('true'));
    expect(screen.getByTestId('loaded').textContent).toBe('true');
    await act(async () => { screen.getByText('again').click(); });
    await waitFor(() => expect(answers).toEqual([false]));
    fail = false;
    await act(async () => { screen.getByText('again').click(); });
    await waitFor(() => expect(answers).toEqual([false, true]));
    expect(screen.getByTestId('failed').textContent).toBe('false');
  });
  test('overlapping refreshes: the latest call decides, so an earlier one failing late changes nothing', async () => {
    let calls = 0;
    let failFirst!: () => void;
    const { api } = stubApi({
      myCharacters: async () => {
        calls += 1;
        if (calls === 1) return [char('a')];
        if (calls === 2) return new Promise<never>((_, reject) => { failFirst = () => reject(new Error('late')); });
        return [char('z')];
      },
    });
    let answers: boolean[] = [];
    function Seq() {
      const p = usePlayer();
      return <div><span data-testid="ids">{p.characters.map((c) => c.id).join(',')}</span><span data-testid="failed">{String(p.charactersFailed)}</span><button onClick={() => void p.refresh().then((ok) => { answers = [...answers, ok]; })}>go</button></div>;
    }
    render(<PlayerProvider api={api}><Seq /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('a'));
    await act(async () => { screen.getByText('go').click(); });
    await act(async () => { screen.getByText('go').click(); });
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('z'));
    await act(async () => { failFirst(); });
    await waitFor(() => expect(answers).toContain(false));
    expect(screen.getByTestId('ids').textContent).toBe('z');
    expect(screen.getByTestId('failed').textContent).toBe('false');
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
      subscribeAccount: () => () => {},
      subscribeReach: () => () => {},
      myCharacters: async () => rows[account as keyof typeof rows].chars,
      wallet: async () => rows[account as keyof typeof rows].wallet,
      myCards: async () => [],
      estimate: vi.fn(() => (account === 'acc-a' ? estimates.a() : estimates.b())),
    } as unknown as KayfaApi;
    const switchTo = (next: string) => act(() => { account = next; listener({ signedIn: true, account: next, bar: null, conductAccepted: true }); });
    return { api, switchTo };
  }
  const answer = (amount: number): Estimate => ({ entries: [{ character: 'x', reason: 'face.cheered', amount }], lines: [], crowd: null, asOf: null, freshAfter: null });

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
    w.emit({ signedIn: true, account: null, bar: null, conductAccepted: true });
    expect(localStorage.getItem('kb-draft:acc-1:t1')).not.toBeNull();
  });
  test('signing out takes them', async () => {
    const w = sessions();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('hud').textContent).toBe('a'));
    localStorage.setItem('kb-draft:acc-1:t1', JSON.stringify({ text: 'unsent', as: 'a' }));
    w.emit({ signedIn: false, account: null, bar: null, conductAccepted: true });
    expect(localStorage.getItem('kb-draft:acc-1:t1')).toBeNull();
  });
});

describe('a provider that starts from the first load\'s session', () => {
  const signedOutFirst = { session: { signedIn: false, account: null, bar: null, conductAccepted: true } as Session, boot: null, estimate: null };

  test('reads the session once more on mount, so a change between the first load and the subscription is not lost', async () => {
    const { api } = stubApi();
    render(<PlayerProvider api={api} initial={signedOutFirst}><Probe /></PlayerProvider>);
    await waitFor(() => expect(screen.getByTestId('acting')).toHaveTextContent('a,b'));
  });

  test('a change heard from the subscription is not taken back by that read', async () => {
    let listener: (s: Session) => void = () => {};
    let answer!: (s: Session) => void;
    const { api } = stubApi({ session: () => new Promise<Session>((r) => { answer = r; }), onSession: (l) => { listener = l; return () => {}; } });
    render(<PlayerProvider api={api} initial={signedOutFirst}><Probe /></PlayerProvider>);
    act(() => { listener({ signedIn: false, account: null, bar: null, conductAccepted: true }); });
    await act(async () => { answer({ signedIn: true, account: 'acc-1', bar: null, conductAccepted: true }); });
    expect(screen.getByTestId('acting')).toHaveTextContent('');
  });
});

describe('the HUD hears its own state', () => {
  const SIGNED_OUT_SESSION: Session = { signedIn: false, account: null, bar: null, conductAccepted: true };
  const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  /* A stub whose two channels the test drives, and whose reads are counted by myCharacters. */
  function heard(reading?: () => Promise<MyCharacter[]>) {
    const account: { l: AccountListener | null } = { l: null };
    const reach: { l: ReachListener | null } = { l: null };
    let emit: (s: Session) => void = () => {};
    const reads = vi.fn(reading ?? (async () => [char('a')]));
    const { api } = stubApi({
      myCharacters: reads,
      onSession: (l) => { emit = l; return () => {}; },
      subscribeAccount: (l) => { account.l = l; return () => { account.l = null; }; },
      subscribeReach: (l) => { reach.l = l; return () => { reach.l = null; }; },
    });
    return { api, account, reach, reads, emit: (s: Session) => emit(s) };
  }
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
  const ms = async (n: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(n); }); };

  test('a wallet move the player did not make moves the HUD with no action by the player', async () => {
    fakeTimers();
    const appeal = {
      key: 'appeal', name: 'Appeal', alignment: 'sweet' as const, rarity: 'uncommon' as const, stack: 3,
      drive: { lasts: { unit: 'day' as const, count: 7 }, gifts: ['driveGift1'], overhead: 'driveOverhead' },
      playPrice: () => 0, validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
      canApply: () => ({ ok: true as const, value: undefined }),
    };
    const drives = { ...testInstance, cards: [appeal], settings: { ...testInstance.settings, economy: { ...testInstance.settings.economy, driveGift1: 25, driveOverhead: 20 } } };
    const fake = createFake({ instance: drives });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana', 'face');
    const boFace = fake.seed.character(bo, 'Bo', 'face');
    const { act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const drive = fake.seed.card(boFace, opener, 'appeal');
    fake.seed.wallet(ana, 100);
    fake.seed.wallet(bo, 562);
    /* The HUD is Bo's: every call the provider makes is answered as Bo, and the session never changes under it. Ana's gift is made beside it, as another player's tab would. */
    /* signInAs(bo) runs before every call, so a provider read is never answered as Ana. */
    const asBo = new Proxy(fake, {
      get: (target, prop, receiver) => {
        if (prop === 'onSession') return () => () => {};
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? (...a: unknown[]) => { target.signInAs(bo); return (v as (...x: unknown[]) => unknown).apply(target, a); } : v;
      },
    });
    fake.signInAs(bo);
    render(<PlayerProvider api={asBo}><Probe /></PlayerProvider>);
    await settle();
    expect(screen.getByTestId('wallet').textContent).toBe('562');
    fake.signInAs(ana);
    const given = await fake.donate(anaFace, drive, 25);
    expect(given.ok).toBe(true);
    fake.signInAs(bo);
    await settle();
    await ms(400);
    expect((await fake.wallet()).balance, 'Bo\'s wallet holds the 25 Ana gave').toBe(582);
    expect(screen.getByTestId('wallet').textContent).toBe('582');
  });

  test('three pokes inside the debounce run one read', async () => {
    fakeTimers();
    const w = heard();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await settle();
    const before = w.reads.mock.calls.length;
    act(() => { w.account.l?.onSelf?.(); });
    await ms(100);
    act(() => { w.account.l?.onSelf?.(); });
    await ms(100);
    act(() => { w.account.l?.onSelf?.(); });
    await ms(50);
    expect(w.reads.mock.calls.length).toBe(before);
    await ms(400);
    expect(w.reads.mock.calls.length).toBe(before + 1);
  });

  test('a settled runs one read, at some moment within the spread', async () => {
    fakeTimers();
    const w = heard();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await settle();
    const before = w.reads.mock.calls.length;
    act(() => { w.reach.l?.onSettled?.({ id: '1', at: '2026-10-28T08:17:00Z' }); w.reach.l?.onSettled?.({ id: '1', at: '2026-10-28T08:17:00Z' }); });
    await ms(0);
    expect(w.reads.mock.calls.length).toBe(before);
    await ms(REACH_SPREAD_MS);
    expect(w.reads.mock.calls.length).toBe(before + 1);
  });

  test('a settled pending (about 9 s out) and then a self: one read by the self\'s debounce, and none more by the end of the spread', async () => {
    fakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const w = heard();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await settle();
    const before = w.reads.mock.calls.length;
    act(() => { w.reach.l?.onSettled?.({ id: '1', at: '2026-10-28T08:17:00Z' }); });
    await ms(100);
    act(() => { w.account.l?.onSelf?.(); });
    await ms(350);
    expect(w.reads.mock.calls.length).toBe(before + 1);
    await ms(REACH_SPREAD_MS);
    expect(w.reads.mock.calls.length).toBe(before + 1);
  });

  test('signing out drops the channels and any timer: a poke after it reads nothing', async () => {
    fakeTimers();
    const w = heard();
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await settle();
    expect(w.account.l).not.toBeNull();
    const before = w.reads.mock.calls.length;
    const account = w.account.l;
    act(() => { account?.onSelf?.(); w.reach.l?.onSettled?.({ id: '1', at: 'x' }); });
    act(() => { w.emit(SIGNED_OUT_SESSION); });
    await settle();
    expect(w.account.l).toBeNull();
    expect(w.reach.l).toBeNull();
    act(() => { account?.onSelf?.(); });
    await ms(REACH_SPREAD_MS * 2);
    expect(w.reads.mock.calls.length).toBe(before);
  });

  test('a poke during a read in flight runs exactly one more after it, never two at once', async () => {
    fakeTimers();
    let open = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const w = heard(() => new Promise<MyCharacter[]>((r) => {
      open += 1; most = Math.max(most, open);
      releases.push(() => { open -= 1; r([char('a')]); });
    }));
    render(<PlayerProvider api={w.api}><Probe /></PlayerProvider>);
    await settle();
    await act(async () => { releases.shift()?.(); });
    await settle();
    const base = w.reads.mock.calls.length;
    act(() => { w.account.l?.onSelf?.(); });
    await ms(350);
    expect(w.reads.mock.calls.length).toBe(base + 1);
    /* two more pokes while that read is out */
    act(() => { w.account.l?.onSelf?.(); });
    await ms(350);
    act(() => { w.account.l?.onSelf?.(); });
    await ms(350);
    expect(w.reads.mock.calls.length).toBe(base + 1);
    await act(async () => { releases.shift()?.(); });
    await settle();
    expect(w.reads.mock.calls.length).toBe(base + 2);
    await act(async () => { releases.shift()?.(); });
    await settle();
    await ms(1000);
    expect(w.reads.mock.calls.length).toBe(base + 2);
    expect(most).toBe(1);
  });

  test('a poke whose read is out when the account switches files nothing under the new account, and the new one reads once', async () => {
    fakeTimers();
    let account = 'acc-a';
    let emit: (s: Session) => void = () => {};
    const listeners: { l: AccountListener | null } = { l: null };
    const outs: { for: string; release: () => void }[] = [];
    const reads: string[] = [];
    const { api } = stubApi({
      session: async () => ({ signedIn: true, account, bar: null, conductAccepted: true }),
      onSession: (l) => { emit = l; return () => {}; },
      subscribeAccount: (l) => { listeners.l = l; return () => { listeners.l = null; }; },
      myCharacters: () => new Promise<MyCharacter[]>((r) => {
        const mine = account;
        reads.push(mine);
        outs.push({ for: mine, release: () => r([char(mine === 'acc-a' ? 'a' : 'z')]) });
      }),
    });
    const commits: string[] = [];
    function Record() {
      const p = usePlayer();
      useLayoutEffect(() => { commits.push(`${p.session.account}|${p.characters.map((c) => c.id).join(',')}`); });
      return null;
    }
    render(<PlayerProvider api={api}><Record /></PlayerProvider>);
    await settle();
    await act(async () => { outs.splice(0).forEach((o) => o.release()); });
    await settle();
    /* A's poke starts a read for A, and it is held. */
    act(() => { listeners.l?.onSelf?.(); });
    await ms(400);
    const aRead = outs.find((o) => o.for === 'acc-a');
    expect(aRead, 'the poke started a read for A').toBeDefined();
    /* The account switches to B before A's read resolves. */
    account = 'acc-b';
    act(() => { emit({ signedIn: true, account: 'acc-b', bar: null, conductAccepted: true }); });
    await settle();
    await act(async () => { outs.filter((o) => o.for === 'acc-b').forEach((o) => o.release()); });
    await settle();
    await act(async () => { aRead?.release(); });
    await settle();
    expect(commits.filter((c) => c.startsWith('acc-b|') && c.split('|')[1]!.split(',').includes('a'))).toEqual([]);
    expect(commits.at(-1)).toBe('acc-b|z');
    /* One poke on B runs exactly one read for B. */
    const before = reads.filter((r) => r === 'acc-b').length;
    act(() => { listeners.l?.onSelf?.(); });
    await ms(400);
    expect(reads.filter((r) => r === 'acc-b').length).toBe(before + 1);
    await act(async () => { outs.filter((o) => o.for === 'acc-b').forEach((o) => o.release()); });
    await ms(1000);
    expect(reads.filter((r) => r === 'acc-b').length).toBe(before + 1);
  });
});
