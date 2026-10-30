import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Character, KayfaApi, MyCharacter } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider } from '../player.tsx';
import { RouterProvider } from '../router.tsx';
import { Frame } from './Frame.tsx';

const mine = (id: string, name: string): MyCharacter => ({
  id, name, class: 'face', classSince: '2026-10-01T00:00:00Z', turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  debutLoudness: 'silent', retiredAt: null, pendingTurn: null,
});
const pub = (id: string, name: string): Character => ({
  id, name, title: '', signature: '', avatarSquare: `data:image/webp;base64,${id}`, avatarPortrait: null, squareFrame: null, portraitFrame: null, pipStyle: 'default', joined: '2026-10-01',
});

function setup(signedIn = true, characters = [mine('a', 'Pipewrench'), mine('b', 'Mrs. Hooligan')]) {
  const api = {
    session: async () => ({ signedIn, account: signedIn ? 'acc' : null }),
    onSession: () => () => {},
    myCharacters: async () => characters,
    wallet: async () => ({ balance: 240, cap: 600 }),
    myCards: async () => [{ card: 'whoops', held: 2 }, { card: 'stick-around', held: 1 }],
    estimate: async () => ({ entries: [{ character: 'a', reason: 'face.cheered', amount: 85 }], lines: [], asOf: null, freshAfter: null }),
    characters: vi.fn(async (ids: readonly string[]) => ids.map((id) => pub(id, id))),
  } as unknown as KayfaApi;
  const kayfa = {
    api,
    instance: { cards: [{ key: 'whoops', name: 'Whoops!' }, { key: 'stick-around', name: 'Stick Around' }] },
    ui: { copy: { siteName: 'Divided World', siteTagline: 'dw.gripe', shopName: 'The Vending Machine' } },
    settings: { walletCap: 600 },
  } as unknown as Kayfa;
  const view = render(
    <RouterProvider>
      <KayfaProvider value={kayfa}>
        <PlayerProvider api={api}>
          <Frame links={[{ to: '/', label: 'Index' }, { to: '/characters', label: 'Characters' }]}><p>page</p></Frame>
        </PlayerProvider>
      </KayfaProvider>
    </RouterProvider>,
  );
  return { api, unmount: view.unmount };
}

beforeEach(() => localStorage.clear());

describe('the frame', () => {
  test('a banner with the instance\'s name and the links, the page, and the HUD', async () => {
    setup();
    expect(screen.getByRole('banner')).toHaveTextContent('Divided World');
    expect(screen.getByRole('navigation', { name: 'Site' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('page');
    const hud = await screen.findByRole('region', { name: 'HUD' });
    await waitFor(() => expect(within(hud).getByRole('img', { name: 'Wallet 2.40 of 6 orbs, 0.85 pending until the next settlement (estimate)' })).toBeInTheDocument());
  });
  test('the quick-swap is a labeled select of the characters that can act, and it changes the HUD\'s character', async () => {
    setup();
    const select = await screen.findByRole('combobox', { name: 'Posting as' });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pipewrench', 'Mrs. Hooligan']));
    await userEvent.selectOptions(select, 'b');
    expect((select as HTMLSelectElement).value).toBe('b');
    expect(localStorage.getItem('kb-hud:acc')).toBe('b');
    expect(window.location.href).not.toContain('b');
  });
  test('the hand button says how many cards are held and opens the drawer above the HUD', async () => {
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand: 3 cards' });
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(hand);
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    const drawer = screen.getByRole('region', { name: 'Your hand' });
    expect(drawer).toHaveTextContent('Whoops! ×2');
    expect(drawer).toHaveTextContent('Stick Around ×1');
    hand.blur();
    expect(hand).not.toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
  });
  test('the Menu button discloses the links (a phone shows it; jsdom lays out the desktop, so it is read hidden here)', async () => {
    setup();
    const menu = screen.getByText('Menu', { selector: 'button' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
  });
  test('signed out, the HUD offers sign-in and holds no orbs', async () => {
    setup(false);
    const hud = await screen.findByRole('region', { name: 'HUD' });
    await act(async () => {});
    expect(within(hud).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(within(hud).queryByRole('img')).toBeNull();
  });
  test('a player with no character that can act is told how to make one', async () => {
    setup(true, []);
    const hud = await screen.findByRole('region', { name: 'HUD' });
    await waitFor(() => expect(within(hud).getByRole('link', { name: 'Make a character' })).toBeInTheDocument());
  });
});

describe('from the Task 3 quality review', () => {
  test('the hand button controls a drawer that is always there, hidden while closed', async () => {
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand: 3 cards' });
    const drawer = document.getElementById(hand.getAttribute('aria-controls')!);
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveAttribute('hidden');
  });
  test('an Esc another control has already handled leaves the drawer and focus alone', async () => {
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand: 3 cards' });
    await userEvent.click(hand);
    const other = document.createElement('input');
    document.body.append(other);
    other.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); });
    other.focus();
    await userEvent.keyboard('{Escape}');
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    expect(other).toHaveFocus();
    other.remove();
  });
  test('moving to another page puts focus at the top of the new page', async () => {
    setup();
    await userEvent.click(screen.getByRole('link', { name: 'Characters' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('the measured HUD height', () => {
  /* What sits above the HUD reads --kb-hud-measured, so it is set from the HUD's real height and kept right as that changes. */
  const measured = () => document.documentElement.style.getPropertyValue('--kb-hud-measured');
  let height = 57.2;
  let tell: () => void = () => {};
  let disconnected = 0;
  beforeEach(() => {
    height = 57.2;
    disconnected = 0;
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { tell = cb; } observe() {} disconnect() { disconnected += 1; } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }) as DOMRect);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  test('is set when the HUD mounts, follows it as it resizes, and is removed when it unmounts', async () => {
    const { unmount } = setup();
    await screen.findByRole('region', { name: 'HUD' });
    expect(measured()).toBe('58px');
    height = 96;
    act(() => tell());
    expect(measured()).toBe('96px');
    unmount();
    expect(measured()).toBe('');
    expect(disconnected).toBe(1);
  });
});
