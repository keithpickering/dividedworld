import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccountListener, Character, KayfaApi, MyCharacter } from '../data/api.ts';
import { ALERTS_UNREAD_BOUND } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider, hudKey, usePlayer } from '../player.tsx';
import { RouterProvider, useRouterInternals } from '../router.tsx';
import { Routes } from '../routes.tsx';
import { buildWorld, renderIn, testGlass } from '../test-world.tsx';
import { boardPlace, forgetBoard, keepBoardPlace } from '../glass/back.ts';
import { boardSwitch } from '../glass/board.ts';
import { Link, useLocation } from '../router.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import { Frame } from './Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

const mine = (id: string, name: string, cls = 'heel'): MyCharacter => ({
  id, name, pronouns: ENGINE_DEFAULT_PRONOUNS, class: cls, classSince: '2026-10-01T00:00:00Z', classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  debutLoudness: 'silent', retiredAt: null, pendingTurn: null, presenceHidden: false,
});
const pub = (id: string, name: string): Character => ({
  id, name, title: '', signature: '', avatarSquare: `data:image/webp;base64,${id}`, avatarPortrait: null, squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], trophies: [], pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members',
});

/* The glass routes as the app names them (web/src/App.tsx): the router's moves into them keep the board's place. */
const GLASS = new Set(['/alerts', '/characters', '/characters/new', '/characters/edit', '/invites', '/settings', '/sign-in', '/register', '/log', '/log/settlement']);
const isGlass = (path: string) => GLASS.has(path);

/* What the backend says of the player's alerts: the count, and the channel the player's account hears (the test sends on it). */
const alerts: { unread: number; account: AccountListener | null; subscribed: number; reads: number } = { unread: 0, account: null, subscribed: 0, reads: 0 };

function setup(signedIn = true, characters: readonly MyCharacter[] | 'fails' = [mine('a', 'Pipewrench'), mine('b', 'Mrs. Hooligan', 'face')], page = <p>page</p>, registrationMode: 'invite' | 'open' | 'closed' = 'invite', balance = 240, face: (id: string) => Character = (id) => pub(id, id)) {
  const api = {
    session: async () => ({ signedIn, account: signedIn ? 'acc' : null }),
    onSession: () => () => {},
    myCharacters: async () => { if (characters === 'fails') throw new Error('down'); return characters; },
    wallet: async () => ({ balance, cap: 600 }),
    myCards: async () => [{ card: 'whoops', held: 2 }, { card: 'stick-around', held: 1 }],
    estimate: async () => ({ entries: [{ character: 'a', reason: 'face.cheered', amount: 85 }], lines: [], asOf: null, freshAfter: null }),
    characters: vi.fn(async (ids: readonly string[]) => ids.map((id) => face(id))),
    boards: async () => {
      if (!signedIn) throw new Error('reads answer only for a session');
      return [{ id: 'g', slug: 'general', name: 'General' }, { id: 's', slug: 'announcements', name: 'The System' }];
    },
    nextSettlementAt: async () => '2026-10-31T08:17:00Z',
    /* The frame holds the page's tips (engine/ui/tips/Tips.tsx), which read the account's state; these have them off. */
    preferences: async () => ({ tips: 'off', tipsSeen: [] }),
    alertsUnread: async () => { alerts.reads += 1; return alerts.unread; },
    subscribeAccount: (l: AccountListener) => { alerts.account = l; alerts.subscribed += 1; return () => { alerts.account = null; }; },
    subscribeReach: () => () => {},
    actsById: async () => [],
    thread: async () => null,
    suggest: vi.fn(async () => ({
      threads: [{ id: 't-1', title: 'Wario Ware tier list', board: 'g', boardName: 'General' }],
      characters: [{ id: 'c-9', name: 'Waribob' }],
      boards: [{ id: 'g', slug: 'general', name: 'General' }],
    })),
  } as unknown as KayfaApi;
  const kayfa = {
    api,
    instance: {
      /* Rules enough for the hand to price and draw each card (engine/ui/cards/faces.ts). */
      cards: [
        { key: 'whoops', name: 'Whoops!', alignment: 'salty', rarity: 'common', playPrice: () => 0 },
        { key: 'stick-around', name: 'Stick Around', alignment: 'sweet', rarity: 'common', playPrice: () => 0 },
      ],
      settings: { economy: { 'whoops.price': 100, 'stick.price': 100 } },
      classes: [{ key: 'face', name: 'Face' }, { key: 'heel', name: 'Heel' }],
    },
    ui: { glass: testGlass, copy: { siteName: 'Divided World', siteTagline: 'dw.gripe', shopName: 'The Vending Machine', badges: [['Game', 'On'], ['Masks', 'On'], ['Kilter', 'Off']] }, cards: [], frontDoor: { prompt: { title: 'Who will you play as?', line: 'A test game, played in masks.' } } },
    settings: { walletCap: 600, registrationMode },
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

/* These tests look at the page the moment the hand drawer closes (it stays mounted and plays its exit imperatively, glass/play.ts), as under Off; its exit at full motion is the one test that sets it. */
beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); alerts.unread = 0; alerts.account = null; alerts.subscribed = 0; alerts.reads = 0; localStorage.clear(); sessionStorage.clear(); forgetBoard(); window.history.replaceState(null, '', '/'); });
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (document.documentElement as { clientWidth?: number }).clientWidth; });

describe('the counterfeit quote\'s filter', () => {
  test('is drawn once by the frame, hidden from the reading order, for every post on the page to use', () => {
    setup(true, undefined, <><p>post one</p><p>post two</p></>);
    const filters = document.querySelectorAll('filter#kb-wobble');
    expect(filters).toHaveLength(1);
    expect(filters[0]!.closest('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(filters[0]!.querySelector('feTurbulence')).not.toBeNull();
    expect(filters[0]!.querySelector('feDisplacementMap')).not.toBeNull();
  });
});

describe('the vignette', () => {
  test('is one aria-hidden element in the frame, below the HUD in the tree and out of the reading order', () => {
    setup();
    const all = document.querySelectorAll('.kb-vignette');
    expect(all).toHaveLength(1);
    expect(all[0]).toHaveAttribute('aria-hidden', 'true');
    expect(all[0]!.parentElement).toHaveClass('kb-frame');
    expect(all[0]!.textContent).toBe('');
  });
});

describe('the banner: the board\'s own', () => {
  test('holds the instance\'s name, then Index and the boards, and nothing of the glass', async () => {
    setup();
    expect(screen.getByRole('banner')).toHaveTextContent('Divided World');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Index', 'General', 'The System', 'Search']));
    expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute('href', '/b/general');
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('main')).toHaveTextContent('page');
  });
  test('each nav link carries its aria-hidden icon and keeps its name', async () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(4));
    for (const name of ['Index', 'General', 'The System', 'Search']) {
      const link = within(nav).getByRole('link', { name });
      const icons = link.querySelectorAll('svg');
      expect(icons).toHaveLength(1);
      expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    }
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

describe('the footer ends every board page', () => {
  test('says "Powered by KayfaBB", then the instance\'s badges in its own words, hidden from assistive tech, and links nothing', () => {
    setup();
    const foot = screen.getByRole('contentinfo');
    expect(foot).toHaveTextContent('Powered by KayfaBB');
    expect(foot.querySelectorAll('a')).toHaveLength(0);
    const badges = foot.querySelector('.kb-badges')!;
    expect(badges).toHaveAttribute('aria-hidden', 'true');
    expect([...badges.querySelectorAll('.kb-badge')].map((b) => [...b.children].map((c) => c.textContent))).toEqual([['Game', 'On'], ['Masks', 'On'], ['Kilter', 'Off']]);
    expect(screen.getByRole('main')).not.toContainElement(foot);
    expect(screen.getByRole('main').compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  test('an instance with no badges has the credit alone', () => {
    setup();
    cleanup();
    const copy = { siteName: 'X', siteTagline: 'x', shopName: 'S' };
    render(
      <RouterProvider><KayfaProvider value={{ api: {}, instance: { classes: [], cards: [], settings: {} }, ui: { glass: testGlass, copy, cards: [], frontDoor: { prompt: { title: 'Who?', line: 'A game.' } } }, settings: {} } as unknown as Kayfa}><PlayerProvider api={{ session: async () => ({ signedIn: false, account: null }), onSession: () => () => {} } as unknown as KayfaApi}><Frame><p>x</p></Frame></PlayerProvider></KayfaProvider></RouterProvider>,
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Powered by KayfaBB');
    expect(document.querySelector('.kb-badges')).toBeNull();
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
  test('a character with no avatar shows its letter inside the link named "My characters"', async () => {
    setup(true, [mine('a', 'Pipewrench')], <p>page</p>, 'invite', 240, (id) => ({ ...pub(id, id), avatarSquare: null }));
    const link = await within(await hud()).findByRole('link', { name: 'My characters' });
    await waitFor(() => expect(within(link).getByText('P')).toBeInTheDocument());
    expect(link.querySelector('img')).toBeNull();
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
  test.each([[1440, 'main'], [390, 'phone']] as const)('a full wallet with an estimate on top says the figure once and the way out under it, at %i wide', async (px, layout) => {
    width(px);
    setup(true, undefined, undefined, undefined, 600);
    const h = await hud();
    await waitFor(() => expect(h.ownerDocument.documentElement).toHaveAttribute('data-kb-layout', layout));
    await within(h).findByText('+0.85 est. past the cap');
    expect(within(h).getAllByText(/\+0\.85/u)).toHaveLength(1);
    expect(within(h).getByText("Spend some before the settlement, or it won't fit.")).toBeInTheDocument();
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

describe('Esc and a load', () => {
  /* A board that loads, and a glass page whose load waits on the test: each call is told when its signal is aborted. */
  function loads() {
    const calls: Array<{ readonly signal: AbortSignal; readonly resolve: (d: unknown) => void }> = [];
    let retry: () => void = () => undefined;
    let boardReads = 0;
    function Retry() { retry = useRouterInternals().retry; return null; }
    const routes = [
      { path: '/b/general', load: () => (boardReads++ === 0 ? Promise.resolve('board') : new Promise<unknown>(() => undefined)), render: () => <p>the board</p> },
      { path: '/characters', load: (a: { readonly signal: AbortSignal }) => new Promise<unknown>((resolve) => { calls.push({ signal: a.signal, resolve }); }), render: () => <p>the roster</p> },
    ];
    return { calls, retry: () => retry(), page: <><Retry /><Routes routes={routes} /></> };
  }

  test('an Esc while the load it started is out stops it, and does not start another: the board stays', async () => {
    window.history.replaceState(null, '', '/b/general');
    const { calls, page } = loads();
    setup(true, undefined, page);
    await within(await hud()).findByRole('button', { name: 'Menu' });
    await screen.findByText('the board');
    await userEvent.keyboard('{Escape}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal.aborted).toBe(false);
    await userEvent.keyboard('{Escape}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(here()).toBe('/b/general');
    expect(screen.getByText('the board')).toBeInTheDocument();
  });

  test('Menu pressed toward a loading page keeps its word, its name and its place and shows one spinner over it, until it lands', async () => {
    window.history.replaceState(null, '', '/b/general');
    const { calls, page } = loads();
    setup(true, undefined, page);
    const menu = await within(await hud()).findByRole('button', { name: 'Menu' });
    await screen.findByText('the board');
    const children = () => Array.from(menu.children).map((c) => c.className);
    const before = children();
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('data-kb-pending');
    expect(menu).toHaveAttribute('aria-busy', 'true');
    expect(menu.querySelectorAll('.kb-hud-wait .kb-spinner')).toHaveLength(1);
    /* The label and the key stay in the button, where they were: only the wait is added, as a layer over them. */
    expect(menu.textContent).toContain('Menu');
    expect(children().slice(0, before.length)).toEqual(before);
    expect(menu.lastElementChild!.className).toContain('kb-hud-wait');
    await act(async () => { calls[0]!.resolve('roster'); });
    await waitFor(() => expect(menu.querySelector('.kb-spinner')).toBeNull());
  });

  test('a silent re-read of the shown page does not take the Esc: it still opens the menu', async () => {
    window.history.replaceState(null, '', '/b/general');
    const { calls, retry, page } = loads();
    setup(true, undefined, page);
    await screen.findByText('the board');
    await within(await hud()).findByRole('button', { name: 'Menu' });
    act(() => retry());
    await userEvent.keyboard('{Escape}');
    /* The Esc was the menu's: it asked for the roster. */
    expect(calls).toHaveLength(1);
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
    expect(within(drawer).getAllByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })).toHaveLength(2);
    expect(within(drawer).getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' })).toBeInTheDocument();
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
  test('the render that closes the hand drawer already holds it shown, inert and hidden from a reader: it is never hidden, even for a commit', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Hand, 3 postcards' }));
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    const seen: string[] = [];
    const watch = new MutationObserver((records) => { for (const r of records) seen.push(`${r.attributeName}:${(r.target as HTMLElement).hasAttribute('hidden')}`); });
    watch.observe(drawer, { attributes: true });
    await userEvent.click(screen.getByRole('button', { name: /^Hand, 3 postcards/u }));
    watch.disconnect();
    /* A commit that set `hidden` (to be undone by an effect's re-render) would show here, and would measure the drawer at width 0. */
    expect(seen.filter((s) => s.startsWith('hidden:'))).toEqual([]);
    expect(drawer).not.toHaveAttribute('hidden');
    expect(drawer).toHaveAttribute('inert');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(drawer).toHaveAttribute('hidden'), { timeout: 3000 });
  });

  test('at full motion the closed hand drawer stays shown, inert and hidden from a reader, until its exit ends; under Off it is hidden at once', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    expect(drawer).not.toHaveAttribute('hidden');
    await userEvent.click(screen.getByRole('button', { name: /^Hand, 3 postcards/u }));
    expect(drawer).not.toHaveAttribute('hidden');
    expect(drawer).toHaveAttribute('inert');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('region', { name: 'Your hand' })).toBeNull();
    await waitFor(() => expect(drawer).toHaveAttribute('hidden'), { timeout: 3000 });
    expect(drawer).not.toHaveAttribute('inert');
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    await userEvent.click(screen.getByRole('button', { name: /^Hand, 3 postcards/u }));
    await userEvent.click(screen.getByRole('button', { name: /^Hand, 3 postcards/u }));
    expect(drawer).toHaveAttribute('hidden');
  });
  test('on the Phone board arming a card puts the sheet away, and the card waits armed in the hand', async () => {
    width(390);
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' }));
    expect(document.querySelector('.kb-hand-drawer')).toHaveAttribute('hidden');
    /* The hand button now says the card is armed, and one press puts it back (#80), so the hand is opened again from there. */
    const armed = screen.getByRole('button', { name: 'Armed · Stick Around, press to put it back' });
    expect(armed).toHaveTextContent('Armed · Stick Around');
    await userEvent.click(armed);
    await userEvent.click(screen.getByRole('button', { name: 'Hand, 3 postcards' }));
    expect(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' })).toHaveLength(1);
  });
  test('on the Phone board an armed card is the hand button\'s words, one press puts it back, and the status line says to press Armed (#80)', async () => {
    width(390);
    setup();
    const hand = await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    await userEvent.click(hand);
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' }));
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
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' }));
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
  test('signed out, the HUD holds the instance\'s prompt and line, and no orbs, no Menu and no hand', async () => {
    setup(false);
    const h = await hud();
    await act(async () => {});
    expect(within(h).getByRole('heading', { name: 'Who will you play as?' })).toBeInTheDocument();
    expect(within(h).getByText('A test game, played in masks.')).toBeInTheDocument();
    expect(within(h).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(within(h).queryByRole('img')).toBeNull();
    expect(within(h).queryByRole('button')).toBeNull();
    expect(within(h).queryByText('?')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
  test('signed out, the HUD is the signed-in HUD\'s frame: the Aura notch with six empty sockets and its line, and Sign in and Register as one row of buttons', async () => {
    setup(false);
    const h = await hud();
    await act(async () => {});
    const notch = h.querySelector('.kb-hud-aura');
    expect(notch).not.toBeNull();
    expect(within(notch as HTMLElement).getByText('Aura')).toBeInTheDocument();
    const sockets = (notch as HTMLElement).querySelectorAll('.kb-hud-socket');
    expect(sockets).toHaveLength(6);
    for (const socket of sockets) expect(socket.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(notch as HTMLElement).getByText('No mask, no Aura, no hand yet. Your first character fills them.')).toBeInTheDocument();
    const row = h.querySelector('.kb-button-row') as HTMLElement;
    expect(within(row).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('data-kb-kind')])).toEqual([['Sign in', 'secondary'], ['Register with an invite', 'primary']]);
    expect(h.querySelector('.kb-hud-plate--cast')).not.toBeNull();
  });
  test('the two buttons tab in the order they are drawn: Sign in then Register on the Main board, Register then Sign in on the Phone board', async () => {
    width(1600);
    const main = setup(false);
    const names = async () => within((await hud()).querySelector('.kb-button-row') as HTMLElement).getAllByRole('link').map((a) => a.textContent);
    await act(async () => {});
    expect(await names()).toEqual(['Sign in', 'Register with an invite']);
    main.unmount();
    width(1151);
    setup(false);
    await act(async () => {});
    expect(await names()).toEqual(['Register with an invite', 'Sign in']);
  });
  test.each([
    ['invite', '/b/general?page=3', 'Register with an invite', '/register?next=%2Fb%2Fgeneral%3Fpage%3D3', 'No invite? Ask someone who plays.'],
    ['open', '/b/general?page=3', 'Register', '/register?next=%2Fb%2Fgeneral%3Fpage%3D3', null],
    ['closed', '/b/general?page=3', null, null, 'Registration is closed for now.'],
    ['invite', '/', 'Register with an invite', '/register', 'No invite? Ask someone who plays.'],
  ] as const)('signed out in %s mode at %s, the HUD offers %s', async (mode, at, register, registerTo, line) => {
    window.history.replaceState(null, '', at);
    setup(false, [], <p>page</p>, mode);
    const h = await hud();
    await act(async () => {});
    const to = at === '/' ? '/sign-in' : '/sign-in?next=%2Fb%2Fgeneral%3Fpage%3D3';
    expect(within(h).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', to);
    if (register === null) expect(within(h).queryByRole('link', { name: /^Register/ })).toBeNull();
    else expect(within(h).getByRole('link', { name: register })).toHaveAttribute('href', registerTo);
    if (line === null) expect(within(h).queryByText(/No invite|closed/)).toBeNull();
    else expect(within(h).getByText(line)).toBeInTheDocument();
  });
  test('signed in, none of the front door shows in the HUD', async () => {
    setup(true);
    const h = await hud();
    await screen.findByRole('button', { name: 'Hand, 3 postcards' });
    expect(within(h).queryByText('Who will you play as?')).toBeNull();
    expect(within(h).queryByText('A test game, played in masks.')).toBeNull();
    expect(within(h).queryByRole('link', { name: /^Register/ })).toBeNull();
    expect(within(h).queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(within(h).queryByText(/No invite|Registration is closed/)).toBeNull();
  });
  test('a player whose characters could not be read is told so and offered Try again, not told to make one', async () => {
    setup(true, 'fails');
    const h = await hud();
    expect(await within(h).findByText('Your characters couldn\'t be loaded.')).toBeInTheDocument();
    expect(within(h).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(h).queryByRole('link', { name: 'Make a character' })).toBeNull();
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
  test('a page that put focus inside itself as it arrived keeps it: the frame takes focus only where the page left none', async () => {
    /* The page's effects run before the frame's, as a screen that came with the move does (a spun thread's ORIGIN box). */
    function Placing() {
      const path = useLocation().path;
      const box = useRef<HTMLButtonElement>(null);
      useEffect(() => { if (path === '/b/general') box.current?.focus(); }, [path]);
      return <button ref={box} type="button">placed</button>;
    }
    setup(true, undefined, <Placing />);
    await userEvent.click(await screen.findByRole('link', { name: 'General' }));
    expect(screen.getByRole('button', { name: 'placed' })).toHaveFocus();
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
    /* The HUD's observer is not the only one on the page (the calm regions in it watch their own boxes): a resize is told to all of them. */
    const told: (() => void)[] = [];
    tell = () => told.forEach((cb) => cb());
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { told.push(cb); } observe() {} unobserve() {} disconnect() { disconnected += 1; } });
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
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { tell = cb; } observe() {} unobserve() {} disconnect() {} });
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

describe('the HUD\'s hidden mark', () => {
  test('shows for a hidden HUD mask, in words a screen reader reads, and not for a shown one', async () => {
    setup(true, [{ ...mine('a', 'Pipewrench'), presenceHidden: true }]);
    const tag = await screen.findByText('Hidden');
    expect(tag.closest('.kb-hud-class-line')).not.toBeNull();
    expect(tag).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('hidden from online lists')).toBeInTheDocument();
    cleanup();
    setup(true, [mine('a', 'Pipewrench')]);
    await screen.findByText('Pipewrench', { selector: '.kb-hud-name' });
    expect(screen.queryByText('Hidden')).toBeNull();
  });
  test('on the phone, whose HUD has no name line, the mark stands beside the mask it names', async () => {
    width(boardSwitch(testGlass) - 1);
    setup(true, [{ ...mine('a', 'Pipewrench'), presenceHidden: true }]);
    const select = await within(await hud()).findByRole('combobox', { name: 'Posting as' });
    const tag = await screen.findByText('Hidden');
    expect(tag.closest('.kb-hud-swap')).toBe(select.closest('.kb-hud-swap'));
    expect(screen.getAllByText('hidden from online lists')).toHaveLength(1);
  });
});

describe('the HUD\'s Alerts button and the toasts (the alerts plan, Task 10)', () => {
  const alertsLink = async () => within(await hud()).findByRole('link', { name: /^Alerts/ });
  const quoted = (id: string) => ({ id, kind: 'quote' as const, sub: null, act: null, character: null, at: '2026-10-31T08:00:00Z' });

  test('is a link to Alerts that names itself plainly at none, and shows no count', async () => {
    setup();
    const link = await alertsLink();
    await waitFor(() => expect(alerts.reads).toBeGreaterThan(0));
    expect(link).toHaveAccessibleName('Alerts');
    expect(link).toHaveAttribute('href', '/alerts');
    expect(link.querySelector('.kb-hud-alerts-count')).toBeNull();
  });

  test('on the Main board it sits with the clock, over Hand, and Menu and Hand are where they were', async () => {
    width(1440);
    setup();
    const link = await alertsLink();
    const side = link.closest('.kb-hud-side')!;
    expect(side.querySelector('.kb-hud-clock')).not.toBeNull();
    expect(link.compareDocumentPosition(side.querySelector('.kb-hud-actions')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(side.querySelector<HTMLElement>('.kb-hud-actions')!).getAllByRole('button').map((b) => b.className.split(' ')[0])).toEqual(['kb-hud-menu', 'kb-hud-hand']);
  });

  test('pressed toward a loading page it keeps its name and its parts and shows one spinner over them, until it lands', async () => {
    window.history.replaceState(null, '', '/b/general');
    alerts.unread = 3;
    const calls: Array<(d: unknown) => void> = [];
    const routes = [
      { path: '/b/general', render: () => <p>the board</p> },
      { path: '/alerts', load: () => new Promise<unknown>((resolve) => { calls.push(resolve); }), render: () => <p>the alerts</p> },
    ];
    setup(true, undefined, <Routes routes={routes} />);
    const link = await alertsLink();
    const parts = () => Array.from(link.children).map((c) => c.className);
    const before = parts();
    await userEvent.click(link);
    expect(link).toHaveAttribute('data-kb-pending');
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(link).toHaveAccessibleName('Alerts 3 new');
    expect(link.querySelectorAll('.kb-hud-wait .kb-spinner')).toHaveLength(1);
    expect(parts().slice(0, before.length)).toEqual(before);
    expect(link.lastElementChild!.className).toContain('kb-hud-wait');
    await act(async () => { calls[0]!('alerts'); });
    await waitFor(() => expect(link.querySelector('.kb-spinner')).toBeNull());
  });

  test('on the Phone board it is a bell between "Posting as" and Menu', async () => {
    width(boardSwitch(testGlass) - 1);
    setup();
    const link = await alertsLink();
    const picker = await within(await hud()).findByRole('combobox', { name: 'Posting as' });
    const menu = within(await hud()).getByRole('button', { name: 'Menu' });
    expect(picker.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.querySelector('svg.kb-hud-bell')).not.toBeNull();
  });

  test('the count is what is new, named for a screen reader, and "9+" at the bound', async () => {
    alerts.unread = 3;
    const { unmount } = setup();
    const link = await alertsLink();
    await waitFor(() => expect(link).toHaveAccessibleName('Alerts 3 new'));
    expect(link.querySelector('.kb-hud-alerts-count')).toHaveTextContent('3');
    unmount();
    alerts.unread = ALERTS_UNREAD_BOUND;
    setup();
    const bound = await alertsLink();
    await waitFor(() => expect(bound).toHaveAccessibleName('Alerts 9+ new'));
    expect(bound.querySelector('.kb-hud-alerts-count')).toHaveTextContent('9+');
  });

  test('the count is read again on each page', async () => {
    alerts.unread = 1;
    setup(true, undefined, <Link to="/b/general">go</Link>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Alerts 1 new' })).toBeInTheDocument());
    alerts.unread = 4;
    await userEvent.click(screen.getByRole('link', { name: 'go' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Alerts 4 new' })).toBeInTheDocument());
  });

  test('the count is read again when an alert arrives, and the account\'s channel is opened once', async () => {
    setup();
    await alertsLink();
    await waitFor(() => expect(alerts.account).not.toBeNull());
    alerts.unread = 2;
    await act(async () => { alerts.account!.onAlert?.({ ...quoted('q1'), kind: 'hint', sub: 'leading:x' }); });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Alerts 2 new' })).toBeInTheDocument());
    expect(alerts.subscribed).toBe(1);
  });

  test('signed out there is no Alerts button and no channel', async () => {
    setup(false);
    await act(async () => {});
    expect(screen.queryByRole('link', { name: /^Alerts/ })).toBeNull();
    expect(alerts.subscribed).toBe(0);
  });

  test('an alert that arrives toasts above the HUD, waits while the hand is open and rises when it closes', async () => {
    width(390);
    setup();
    await alertsLink();
    await waitFor(() => expect(alerts.account).not.toBeNull());
    await act(async () => { alerts.account!.onAlert?.(quoted('q1')); });
    const toast = await screen.findByRole('article');
    expect(toast).toHaveTextContent('your post was quoted');
    expect(within(await hud()).queryByRole('article')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Hand, 3 postcards/ }));
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    await act(async () => { alerts.account!.onAlert?.(quoted('q2')); });
    expect(screen.queryByRole('article')).toBeNull();
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Close the hand' }));
    expect(await screen.findAllByRole('article')).toHaveLength(2);
  });

  test('a toast that leaves with focus on it gives focus to the Alerts button', async () => {
    setup();
    const link = await alertsLink();
    await waitFor(() => expect(alerts.account).not.toBeNull());
    await act(async () => { alerts.account!.onAlert?.(quoted('q1')); });
    const dismiss = within(await screen.findByRole('article')).getByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    await userEvent.click(dismiss);
    expect(link).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
  });

  describe('Menu on the Phone board', () => {
    test('is always its glyph, still named Menu, however long the mask\'s name or wide the picker', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const w = this.classList.contains('kb-hud-name-probe') ? 400 : this.classList.contains('kb-hud-select') ? 400 : 0;
        return { width: w, height: 48, left: 0, top: 0, right: w, bottom: 48 } as DOMRect;
      });
      width(boardSwitch(testGlass) - 1);
      setup();
      const menu = await within(await hud()).findByRole('button', { name: 'Menu' });
      expect(menu.querySelector('.kb-hud-menu-glyph')).not.toBeNull();
      expect(menu).toHaveAccessibleName('Menu');
    });

    test('is its glyph again on coming back from the glass, as it was before it was pressed', async () => {
      width(boardSwitch(testGlass) - 1);
      setup();
      const menu = await within(await hud()).findByRole('button', { name: 'Menu' });
      expect(menu.querySelector('.kb-hud-menu-glyph')).not.toBeNull();
      await userEvent.click(menu);
      expect(within(await hud()).getByRole('button', { name: 'Menu' }).querySelector('.kb-hud-menu-glyph')).not.toBeNull();
    });

    test('the Main board\'s Menu is always its word', async () => {
      width(1440);
      setup();
      const menu = await within(await hud()).findByRole('button', { name: 'Menu' });
      expect(menu.querySelector('.kb-hud-menu-glyph')).toBeNull();
      expect(menu).toHaveTextContent('Menu');
      expect(document.querySelector('.kb-hud-name-probe')).toBeNull();
    });
  });
});

describe('the frame while a page opens', () => {
  test('main is busy and the frame carries the loading mark exactly while a click\'s load is out', async () => {
    let answer!: (doc: unknown) => void;
    const page = (
      <Routes routes={[
        { path: '/', render: () => <Link to="/slow">slow</Link> },
        { path: '/slow', load: () => new Promise<unknown>((r) => { answer = r; }), render: () => <p>slow page</p> },
      ]} />
    );
    setup(true, undefined, page);
    const frame = () => document.querySelector('.kb-frame')!;
    const main = () => screen.getByRole('main');
    expect(main()).not.toHaveAttribute('aria-busy');
    expect(frame()).not.toHaveAttribute('data-kb-loading');
    fireEvent.click(await screen.findByRole('link', { name: 'slow' }));
    await waitFor(() => expect(main()).toHaveAttribute('aria-busy', 'true'));
    expect(frame()).toHaveAttribute('data-kb-loading');
    await act(async () => { answer('ok'); });
    await screen.findByText('slow page');
    expect(main()).not.toHaveAttribute('aria-busy');
    expect(frame()).not.toHaveAttribute('data-kb-loading');
  });
});

describe('search in the banner (the search plan, Task 6)', () => {
  const banner = () => screen.getByRole('banner');
  const hostLine = () => document.querySelector('.kb-tagline');
  beforeEach(() => { window.history.replaceState(null, '', '/'); });

  test('signed in, the banner holds the search box under the host line (which stays), and the boards bar ends in Search with its magnifier', async () => {
    setup();
    expect(await within(banner()).findByRole('combobox', { name: 'Search the boards' })).toBeInTheDocument();
    expect(hostLine()).toHaveTextContent('dw.gripe');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const link = await within(nav).findByRole('link', { name: 'Search' });
    expect(link).toHaveAttribute('href', '/search');
    expect(link.parentElement).toBe(within(nav).getAllByRole('listitem').at(-1));
    expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
  test('on /search the box is gone (the page has its own keyword field) and the host line shows', async () => {
    window.history.replaceState(null, '', '/search');
    setup();
    expect(await within(screen.getByRole('navigation', { name: 'Main' })).findByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page');
    expect(within(banner()).queryByRole('combobox')).toBeNull();
    expect(hostLine()).toHaveTextContent('dw.gripe');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Search' })).toHaveAttribute('aria-current', 'page');
  });
  test('signed out there is no box and no link', async () => {
    setup(false);
    await act(async () => {});
    expect(within(banner()).queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull();
    expect(hostLine()).toHaveTextContent('dw.gripe');
  });
  test('suggests threads, characters and boards, and a choice goes where it says', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await user.type(await within(banner()).findByRole('combobox'), 'wari');
    await screen.findByRole('option', { name: /Wario Ware tier list/ });
    expect(api.suggest).toHaveBeenCalledWith('wari', expect.objectContaining({ most: 5 }));
    expect(screen.getByRole('option', { name: /Search posts for/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Wario Ware tier list/ }));
    expect(here()).toBe('/t/t-1');
  });
  test('a board goes to the board, a character opens a search of their posts', async () => {
    const user = userEvent.setup();
    setup();
    const box = await within(banner()).findByRole('combobox');
    await user.type(box, 'wari');
    await user.click(await screen.findByRole('option', { name: /^General$/ }));
    expect(here()).toBe('/b/general');
    await user.clear(box);
    await user.type(box, 'wari');
    await user.click(await screen.findByRole('option', { name: /Waribob/ }));
    expect(here()).toBe('/search?author=c-9');
  });
  test('Enter searches posts for what was typed', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await within(banner()).findByRole('combobox'), 'green shell{Enter}');
    expect(here()).toBe('/search?q=green+shell');
  });
  test('a Search button beside the box does what Enter does: it searches for the typed words, or opens the plain page', async () => {
    const user = userEvent.setup();
    setup();
    const form = await within(banner()).findByRole('search');
    await user.type(within(form).getByRole('combobox'), 'green shell');
    await user.click(within(form).getByRole('button', { name: 'Search' }));
    expect(here()).toBe('/search?q=green+shell');
  });
  test('the Search button with nothing typed opens the plain search page', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await within(await within(banner()).findByRole('search')).findByRole('button', { name: 'Search' }));
    expect(here()).toBe('/search');
  });
  test('the banner is axe clean with its list open', async () => {
    const user = userEvent.setup();
    const { unmount } = setup();
    await user.type(await within(banner()).findByRole('combobox'), 'wari');
    await screen.findByRole('option', { name: /Wario Ware tier list/ });
    const found = await axeViolations(banner());
    expect(found, describeViolations(found)).toEqual([]);
    unmount();
  });
});

/* The HUD's "Only you see this" opens the one Reveal (the HUD reveal plan, Task 4), on the thread the player is reading. */
describe('the HUD opens the Reveal, and says when a class is public', () => {
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  const RevealWorld = () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const pipe = fake.seed.character(me, 'Pipewrench', 'face', { at: Date.parse('2026-10-01T12:00:00Z') });
    const stranger = fake.seed.character(other, 'Stranger', 'heel', { at: Date.parse('2026-10-01T12:00:00Z') });
    const { thread } = fake.seed.thread('general', stranger, 'The tea thread', 'Who keeps reacting?');
    fake.signInAs(me);
    localStorage.setItem(hudKey(me), pipe);
    return { fake, me, pipe, thread };
  };
  type RW = ReturnType<typeof RevealWorld>;
  const Refresh = () => { const { refresh } = usePlayer(); return <button type="button" onClick={() => void refresh()}>Refresh the player</button>; };
  const onThread = async (w: RW) => {
    renderIn(w.fake, <Frame><Refresh /><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}` });
    await screen.findByRole('article', { name: /^Post 1 /u });
  };
  const off = async (w: RW) => {
    renderIn(w.fake, <Frame><Refresh /><p>page</p></Frame>, { path: '/' });
    await screen.findByText('Pipewrench', { selector: '.kb-hud-name' });
  };
  const lineButton = () => screen.findByRole('button', { name: 'Only you see this: reveal Pipewrench\'s class' });
  const generalId = async (w: RW) => (await w.fake.boards()).find((b) => b.slug === 'general')!.id;

  beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); Element.prototype.scrollIntoView = vi.fn(); });

  test('on a thread, the line is a button that opens the Reveal on that thread, and the reveal lands there', async () => {
    const w = RevealWorld();
    await onThread(w);
    const button = await lineButton();
    expect(button).toHaveTextContent('Only you see this');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByText('Reveal')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Board (optional)')).toHaveValue(await generalId(w));
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('The tea thread');
    const unmask = vi.spyOn(w.fake, 'unmask');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' }));
    await waitFor(() => expect(unmask).toHaveBeenCalledWith(w.pipe, w.thread, ''));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/Pipewrench revealed as Face in The tea thread\./u)).toBeInTheDocument();
  });

  test('off a thread, the Board and Thread start empty', async () => {
    const w = RevealWorld();
    await off(w);
    await userEvent.click(await lineButton());
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByLabelText('Board (optional)')).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: 'Thread' })).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' })).toBeDisabled();
  });

  test('once the class is public the line reads "Revealed", and no button by either name is in the HUD', async () => {
    const w = RevealWorld();
    expect((await w.fake.unmask(w.pipe, w.thread, '')).ok).toBe(true);
    await off(w);
    const h = await hud();
    await waitFor(() => expect(within(h).getByText('Revealed')).toBeInTheDocument());
    expect(within(h).queryByRole('button', { name: /Only you see this/u })).toBeNull();
    expect(within(h).queryByRole('button', { name: /Revealed/u })).toBeNull();
    expect(within(h).queryByText('Only you see this')).toBeNull();
    expect(within(h).getByText('Revealed').closest('.kb-hud-secret')?.querySelector('path')?.getAttribute('d')).toContain('M3 5 V3.4 a2.5 2.5 0 0 1 5 0');
  });

  test('after a Turn the class is private again, and the button is back', async () => {
    const w = RevealWorld();
    expect((await w.fake.unmask(w.pipe, w.thread, '')).ok).toBe(true);
    await off(w);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Game HUD' })).getByText('Revealed')).toBeInTheDocument());
    expect((await w.fake.turn(w.pipe, 'heel', 'silent', false, false)).ok).toBe(true);
    /* The Turn lands at the next settlement. */
    w.fake.clock.advance(86_400_000);
    w.fake.seed.settle({});
    await userEvent.click(screen.getByRole('button', { name: 'Refresh the player' }));
    expect(await lineButton()).toBeInTheDocument();
  });

  test('a reveal from the HUD leaves focus on the Revealed line, not on the page body', async () => {
    const w = RevealWorld();
    await onThread(w);
    await userEvent.click(await lineButton());
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Face' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const h = await hud();
    const line = within(h).getByText('Revealed');
    expect(document.body).not.toHaveFocus();
    expect(line.closest('.kb-hud-secret')).toHaveFocus();
  });

  test('Esc in the overlay closes it, and focus returns to the button', async () => {
    const w = RevealWorld();
    await off(w);
    const button = await lineButton();
    await userEvent.click(button);
    await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(button).toHaveFocus();
  });

  test('Menu on a thread carries it to My characters, and Back to the thread does not open the overlay', async () => {
    const w = RevealWorld();
    await onThread(w);
    await screen.findByRole('button', { name: 'Only you see this: reveal Pipewrench\'s class' });
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
    expect((window.history.state as { state: unknown }).state).toEqual({ thread: { id: w.thread, title: 'The tea thread', board: await generalId(w) } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
