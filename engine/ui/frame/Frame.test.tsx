import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Character, KayfaApi, MyCharacter } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider } from '../player.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { boardPlace, forgetBoard, keepBoardPlace } from '../glass/back.ts';
import { boardSwitch } from '../glass/board.ts';
import { Frame } from './Frame.tsx';

const mine = (id: string, name: string, cls = 'heel'): MyCharacter => ({
  id, name, class: cls, classSince: '2026-10-01T00:00:00Z', turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  debutLoudness: 'silent', retiredAt: null, pendingTurn: null,
});
const pub = (id: string, name: string): Character => ({
  id, name, title: '', signature: '', avatarSquare: `data:image/webp;base64,${id}`, avatarPortrait: null, squareFrame: null, portraitFrame: null, pipStyle: 'default', joined: '2026-10-01',
});

/* The glass routes as the app names them (web/src/App.tsx): the router's moves into them keep the board's place. */
const GLASS = new Set(['/characters', '/characters/new', '/characters/edit', '/invites', '/settings', '/sign-in', '/register', '/log', '/log/settlement']);
const isGlass = (path: string) => GLASS.has(path);

function setup(signedIn = true, characters = [mine('a', 'Pipewrench'), mine('b', 'Mrs. Hooligan', 'face')], page = <p>page</p>) {
  const api = {
    session: async () => ({ signedIn, account: signedIn ? 'acc' : null }),
    onSession: () => () => {},
    myCharacters: async () => characters,
    wallet: async () => ({ balance: 240, cap: 600 }),
    myCards: async () => [{ card: 'whoops', held: 2 }, { card: 'stick-around', held: 1 }],
    estimate: async () => ({ entries: [{ character: 'a', reason: 'face.cheered', amount: 85 }], lines: [], asOf: null, freshAfter: null }),
    characters: vi.fn(async (ids: readonly string[]) => ids.map((id) => pub(id, id))),
    boards: async () => {
      if (!signedIn) throw new Error('reads answer only for a session');
      return [{ id: 'g', slug: 'general', name: 'General' }, { id: 's', slug: 'the-system', name: 'The System' }];
    },
    nextSettlementAt: async () => '2026-10-31T08:17:00Z',
  } as unknown as KayfaApi;
  const kayfa = {
    api,
    instance: {
      /* Rules enough for the hand to price and draw each card (engine/ui/cards/faces.ts). */
      cards: [
        { key: 'whoops', name: 'Whoops!', alignment: 'salty', priceKey: 'whoops.price', playPrice: () => 0 },
        { key: 'stick-around', name: 'Stick Around', alignment: 'sweet', priceKey: 'stick.price', playPrice: () => 0 },
      ],
      settings: { economy: { 'whoops.price': 100, 'stick.price': 100 } },
      classes: [{ key: 'face', name: 'Face' }, { key: 'heel', name: 'Heel' }],
    },
    ui: { glass: testGlass, copy: { siteName: 'Divided World', siteTagline: 'dw.gripe', shopName: 'The Vending Machine' }, cards: [] },
    settings: { walletCap: 600 },
  } as unknown as Kayfa;
  const view = render(
    <RouterProvider onMove={keepBoardPlace(isGlass)}>
      <KayfaProvider value={kayfa}>
        <PlayerProvider api={api}>
          <Frame>{page}</Frame>
        </PlayerProvider>
      </KayfaProvider>
    </RouterProvider>,
  );
  return { api, unmount: view.unmount };
}

const here = () => window.location.pathname + window.location.search + window.location.hash;
const hud = () => screen.findByRole('region', { name: 'Game HUD' });

/** A window this wide, as matchMedia answers it (jsdom has none). */
function width(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const m = /\((min|max)-width:\s*([\d.]+)px\)/.exec(q);
    const matches = m ? (m[1] === 'min' ? px >= Number(m[2]) : px <= Number(m[2])) : false;
    return { matches, media: q, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
  vi.stubGlobal('innerWidth', px);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => px });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); forgetBoard(); window.history.replaceState(null, '', '/'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (document.documentElement as { clientWidth?: number }).clientWidth; });

describe('the banner: the board\'s own', () => {
  test('holds the instance\'s name, then Index and the boards, and nothing of the glass', async () => {
    setup();
    expect(screen.getByRole('banner')).toHaveTextContent('Divided World');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Index', 'General', 'The System']));
    expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('main')).toHaveTextContent('page');
  });
  test('the links are a row of their own under the name, as the Main board draws them, and the phone\'s Boards button stays in the banner', async () => {
    setup();
    const banner = screen.getByRole('banner');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(banner).not.toContainElement(nav);
    expect(banner.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner).toContainElement(screen.getByText('Boards', { selector: 'button' }));
  });
  test('signed out, it holds Index and Sign in, and no Sign out', async () => {
    setup(false);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await act(async () => {});
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Index', 'Sign in']);
    expect(screen.queryByText('Sign out')).toBeNull();
  });
  test('its phone button reads Boards and discloses the links, and its name is not the HUD\'s Menu', async () => {
    /* A phone shows it; jsdom lays out the desktop, where it is display: none, so it is read hidden here. */
    setup();
    const boards = screen.getByText('Boards', { selector: 'button' });
    expect(boards).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(boards);
    expect(boards).toHaveAttribute('aria-expanded', 'true');
    expect(within(await hud()).getByRole('button', { name: 'Menu' })).not.toBe(boards);
  });
});

describe('the HUD: the glass, docked at the bottom', () => {
  test('is the Game HUD, with the orbs\' wallet', async () => {
    setup();
    const h = await hud();
    await waitFor(() => expect(within(h).getByRole('img', { name: 'Wallet 2.40 of 6 orbs, 0.85 pending until the next settlement (estimate)' })).toBeInTheDocument());
  });
  test('the character plate: the name, the class tag only its player sees, and the swap', async () => {
    setup();
    const h = await hud();
    await waitFor(() => expect(within(h).getByText('Pipewrench', { selector: '.kb-hud-name' })).toBeInTheDocument());
    expect(within(h).getByText('Heel')).toBeInTheDocument();
    expect(within(h).getByText('Only you see this')).toBeInTheDocument();
  });
  test('the swap is "Swap mask" from the width where the Main board\'s layout holds and "Posting as" below it, and it changes the HUD\'s character', async () => {
    /* testGlass's smallest phone size is 16px and its smallest Main board size 20px: 1440 × 16 / 20. */
    const at = boardSwitch(testGlass);
    expect(at).toBe(1152);
    width(at);
    const { unmount } = setup();
    const select = await within(await hud()).findByRole('combobox', { name: 'Swap mask' });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pipewrench', 'Mrs. Hooligan']));
    await userEvent.selectOptions(select, 'b');
    expect(localStorage.getItem('kb-hud:acc')).toBe('b');
    expect(window.location.href).not.toContain('b');
    unmount();
    width(at - 1);
    setup();
    expect(await within(await hud()).findByRole('combobox', { name: 'Posting as' })).toBeInTheDocument();
  });
  test('marks the root with the board\'s layout and the scale the Main board\'s is drawn at, which the stylesheets read', async () => {
    const root = document.documentElement;
    width(1300);
    const { unmount } = setup();
    await hud();
    expect(root).toHaveAttribute('data-kb-layout', 'main');
    expect(Number(root.style.getPropertyValue('--kb-board-scale'))).toBeCloseTo(1300 / 1440, 9);
    unmount();
    expect(root).not.toHaveAttribute('data-kb-layout');
    width(1600);
    const second = setup();
    await hud();
    expect(root).toHaveAttribute('data-kb-layout', 'main');
    expect(root.style.getPropertyValue('--kb-board-scale')).toBe('1');
    second.unmount();
    width(1151);
    setup();
    await hud();
    expect(root).toHaveAttribute('data-kb-layout', 'phone');
    expect(root.style.getPropertyValue('--kb-board-scale')).toBe('1');
  });
  test('the clock says when the next settlement is', async () => {
    setup();
    expect(await within(await hud()).findByText('Next settlement')).toBeInTheDocument();
  });
  test('Menu, with Esc as its key, opens the glass at My characters and keeps the board\'s place; it navigates, so it claims no popup', async () => {
    window.history.replaceState(null, '', '/b/general?page=2');
    setup();
    const menu = await within(await hud()).findByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(menu).not.toHaveAttribute('aria-haspopup');
    /* Its key cap is read by sight; the button's name stays Menu. */
    expect(within(menu).getByText('ESC')).toBeInTheDocument();
    expect(menu).toHaveAccessibleName('Menu');
    await userEvent.click(menu);
    expect(here()).toBe('/characters');
    expect(boardPlace()).toMatchObject({ href: '/b/general?page=2' });
  });
  test('the avatar opens My characters, and the orbs open My log, each keeping the board\'s place', async () => {
    window.history.replaceState(null, '', '/t/abc');
    setup();
    const h = await hud();
    await userEvent.click(await within(h).findByRole('link', { name: 'My characters' }));
    expect(here()).toBe('/characters');
    expect(boardPlace()).toMatchObject({ href: '/t/abc' });
    /* The browser's back out of the glass forgets the place, as every move out does. */
    window.history.replaceState(null, '', '/t/abc');
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(boardPlace()).toBeNull();
    await userEvent.click(await within(h).findByRole('link', { name: /^My log: Wallet 2\.40/ }));
    expect(here()).toBe('/log');
    expect(boardPlace()).toMatchObject({ href: '/t/abc' });
  });
  test('Esc anywhere on the board opens the menu, but not while typing', async () => {
    window.history.replaceState(null, '', '/b/general');
    setup(true, undefined, <textarea aria-label="Your reply" />);
    await within(await hud()).findByRole('button', { name: 'Menu' });
    await userEvent.click(screen.getByRole('textbox', { name: 'Your reply' }));
    await userEvent.keyboard('{Escape}');
    expect(here()).toBe('/b/general');
    screen.getByRole('textbox', { name: 'Your reply' }).blur();
    await userEvent.keyboard('{Escape}');
    expect(here()).toBe('/characters');
  });
});

describe('the hand', () => {
  test('its button names the postcards held, and says open while the drawer is', async () => {
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(hand);
    expect(hand).toHaveAccessibleName('Hand, 3 postcards, open');
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    /* One card for each copy held, each a button by its name. */
    const drawer = screen.getByRole('region', { name: 'Your hand' });
    expect(within(drawer).getAllByRole('button', { name: 'Whoops!, Salty postcard' })).toHaveLength(2);
    expect(within(drawer).getByRole('button', { name: 'Stick Around, Sweet postcard' })).toBeInTheDocument();
  });
  test('Esc closes the drawer and returns focus to the hand, and does not open the menu', async () => {
    window.history.replaceState(null, '', '/b/general');
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    hand.blur();
    await userEvent.keyboard('{Escape}');
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    expect(here()).toBe('/b/general');
  });
  test('the hand is a sheet of its own above the HUD, not inside it, and its close button is an icon named for what it does', async () => {
    /* The Phone board's layout: the Main board's has no sheet, only the cards (engine/ui/frame/frame.css). */
    width(390);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Hand, 3 postcards' }));
    const sheet = screen.getByRole('region', { name: 'Your hand' });
    const h = await hud();
    expect(h).not.toContainElement(sheet);
    expect(sheet.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const close = within(sheet).getByRole('button', { name: 'Close the hand' });
    expect(close).toHaveTextContent(/^$/u);
    expect(close.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
  test('on the Phone board arming a card puts the sheet away, and the card waits armed in the hand', async () => {
    width(390);
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Stick Around, Sweet postcard' }));
    expect(document.querySelector('.kb-hand-drawer')).toHaveAttribute('hidden');
    /* The hand button now says the card is armed, and one press puts it back (#80), so the hand is opened again from there. */
    const armed = screen.getByRole('button', { name: 'Armed · Stick Around, press to put it back' });
    expect(armed).toHaveTextContent('Armed · Stick Around');
    await userEvent.click(armed);
    await userEvent.click(screen.getByRole('button', { name: 'Hand, 3 postcards' }));
    expect(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: 'Stick Around, Sweet postcard' })).toHaveLength(1);
  });
  test('on the Phone board an armed card is the hand button\'s words, one press puts it back, and the status line says to press Armed (#80)', async () => {
    width(390);
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Stick Around, Sweet postcard' }));
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Stick Around is armed. Press Play Stick Around on a post, the dashed + mark beside its date, to play it there, or press Armed to put it back.');
    const armed = screen.getByRole('button', { name: 'Armed · Stick Around, press to put it back' });
    expect(armed).not.toHaveAttribute('aria-expanded');
    await userEvent.click(armed);
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Stick Around is put back.');
    expect(screen.getByRole('button', { name: 'Hand, 3 postcards' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Armed/u })).toBeNull();
  });
  test('on the Main board the hand button keeps its words while a card is armed, and the status line says Esc (#80)', async () => {
    width(1440);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Hand, 3 postcards' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Stick Around, Sweet postcard' }));
    expect(screen.getByRole('status', { name: 'Playing a card' })).toHaveTextContent('Stick Around is armed. Press Play Stick Around on a post, the dashed + mark beside its date, to play it there, or Esc to put it back.');
    expect(screen.getByRole('button', { name: 'Hand, 3 postcards, open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Armed/u })).toBeNull();
  });
  test('Close the hand closes it', async () => {
    width(390);
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Close the hand' }));
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
  });
});

describe('signed out and new', () => {
  test('signed out, the HUD offers sign-in and holds no orbs, no Menu and no hand', async () => {
    setup(false);
    const h = await hud();
    await act(async () => {});
    expect(within(h).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(within(h).queryByRole('img')).toBeNull();
    expect(within(h).queryByRole('button')).toBeNull();
  });
  test('a player with no character that can act is told how to make one', async () => {
    setup(true, []);
    const h = await hud();
    await waitFor(() => expect(within(h).getByRole('link', { name: 'Make a character' })).toBeInTheDocument());
  });
});

describe('from the Task 3 quality review', () => {
  test('the hand button controls a drawer that is always there, hidden while closed', async () => {
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    const drawer = document.getElementById(hand.getAttribute('aria-controls')!);
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveAttribute('hidden');
  });
  test('an Esc another control has already handled leaves the drawer, focus and the page alone', async () => {
    window.history.replaceState(null, '', '/b/general');
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    const other = document.createElement('input');
    other.type = 'checkbox';
    document.body.append(other);
    other.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); });
    other.focus();
    await userEvent.keyboard('{Escape}');
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    expect(other).toHaveFocus();
    expect(here()).toBe('/b/general');
    other.remove();
  });
  test('moving to another page puts focus at the top of the new page', async () => {
    setup();
    await userEvent.click(await screen.findByRole('link', { name: 'General' }));
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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height, left: 0, width: 0, top: 0, bottom: height }) as DOMRect);
  });

  test('is set when the HUD mounts, follows it as it resizes, and is removed when it unmounts', async () => {
    const { unmount } = setup();
    await hud();
    expect(measured()).toBe('58px');
    height = 96;
    act(() => tell());
    expect(measured()).toBe('96px');
    unmount();
    expect(measured()).toBe('');
    expect(disconnected).toBeGreaterThanOrEqual(1);
  });
});

describe('the tab\'s points on the scaled Main board', () => {
  /*
   * The HUD is drawn at the board's scale (CSS zoom), so the aura's box, measured in the window,
   * is divided by the zoom to give the tab's points in the HUD's own px. Where a browser draws the
   * zoom but has no currentCSSZoom (older Safari), the board's scale is the zoom; reading it as 1
   * would put the tab short of the aura by the scale. jsdom has no currentCSSZoom, so it is that
   * browser here.
   */
  test('are the aura\'s edges in the HUD\'s own px, divided by the board\'s scale where currentCSSZoom is undefined', async () => {
    width(1296);
    let tell: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { tell = cb; } observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('kb-hud-aura')) return { left: 450, width: 452 * 0.9, top: 0, height: 100, bottom: 100, right: 450 + 452 * 0.9 } as DOMRect;
      if (this.classList.contains('kb-hud')) return { left: 0, width: 1296, top: 0, height: 190, bottom: 190, right: 1296 } as DOMRect;
      return { left: 0, width: 0, top: 0, height: 0, bottom: 0, right: 0 } as DOMRect;
    });
    setup();
    const h = await hud();
    expect((h as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom).toBeUndefined();
    /* The aura comes with the session; its box resizing is what the HUD hears. */
    await waitFor(() => expect(h.querySelector('.kb-hud-aura')).not.toBeNull());
    act(() => tell());
    /* 450 / 0.9 = 500 and (450 + 406.8) / 0.9 = 952, each 20px wider for the tab's top and 28px more for its slopes. */
    expect([h.style.getPropertyValue('--tab-a'), h.style.getPropertyValue('--tab-b'), h.style.getPropertyValue('--tab-c'), h.style.getPropertyValue('--tab-d')]).toEqual(['452px', '480px', '972px', '1000px']);
  });
});

describe('from the Task 1.4 reviews', () => {
  test('a held Esc (its repeats) and an Esc that ends an IME composition do not open the menu', async () => {
    window.history.replaceState(null, '', '/b/general');
    setup();
    await within(await hud()).findByRole('button', { name: 'Menu' });
    fireEvent.keyDown(document.body, { key: 'Escape', repeat: true });
    expect(here()).toBe('/b/general');
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
    expect(here()).toBe('/b/general');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(here()).toBe('/characters');
  });
  test('a modified click on the avatar or the orbs opens as the browser would, and moves nothing here', async () => {
    window.history.replaceState(null, '', '/t/abc');
    setup();
    const h = await hud();
    const avatar = await within(h).findByRole('link', { name: 'My characters' });
    const orbs = await within(h).findByRole('link', { name: /^My log: / });
    for (const link of [avatar, orbs]) {
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        fireEvent.click(link, mod);
        expect(here()).toBe('/t/abc');
      }
    }
  });
  test('every way into the glass keeps the board\'s place: Make a character, and Sign in in the HUD and the banner', async () => {
    window.history.replaceState(null, '', '/b/general?page=3');
    const { unmount } = setup(true, []);
    await userEvent.click(await within(await hud()).findByRole('link', { name: 'Make a character' }));
    expect(boardPlace()).toMatchObject({ href: '/b/general?page=3' });
    unmount();
    for (const where of ['hud', 'banner'] as const) {
      forgetBoard();
      window.history.replaceState(null, '', '/b/general?page=3');
      const view = setup(false);
      const scope = where === 'hud' ? await hud() : screen.getByRole('navigation', { name: 'Main' });
      await userEvent.click(await within(scope).findByRole('link', { name: 'Sign in' }));
      expect(boardPlace()).toMatchObject({ href: '/b/general?page=3' });
      view.unmount();
    }
  });
  test('the hand, opened from the keyboard, takes focus into its sheet; Tab reaches Close the hand', async () => {
    width(390);
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    hand.focus();
    await userEvent.keyboard('{Enter}');
    const drawer = screen.getByRole('region', { name: 'Your hand' });
    expect(drawer).toHaveFocus();
    await userEvent.tab();
    expect(within(drawer).getByRole('button', { name: 'Close the hand' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
  });
});
