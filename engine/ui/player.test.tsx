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
