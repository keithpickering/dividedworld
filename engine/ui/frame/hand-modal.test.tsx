/**
 * The hand on the Main board is a modal (the hand-arc design, sections 2 to 4): while it is open the rest of the HUD is
 * inert and faded, a press outside the cards closes it and acts on nothing beneath, opening puts the keyboard on a card,
 * arming a card closes it and leaves the card's peek over the hand button. The Phone board's sheet is none of that.
 * The Frame here is the real one over a fake API, as Frame.test.tsx draws it.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { KayfaApi, MyCharacter } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider } from '../player.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { forgetBoard } from '../glass/back.ts';
import { Frame } from './Frame.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

const mine = (id: string, name: string): MyCharacter => ({
  id, name, pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: '2026-10-01T00:00:00Z', classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  debutLoudness: 'silent', retiredAt: null, pendingTurn: null, presenceHidden: false,
});

function setup(page = <p>page</p>) {
  const api = {
    session: async () => ({ signedIn: true, account: 'acc' }),
    onSession: () => () => {},
    myCharacters: async () => [mine('a', 'Pipewrench')],
    wallet: async () => ({ balance: 240, cap: 600 }),
    myCards: async () => [{ card: 'whoops', held: 2 }, { card: 'stick-around', held: 1 }],
    estimate: async () => ({ entries: [], lines: [], asOf: null, freshAfter: null }),
    characters: vi.fn(async () => []),
    boards: async () => [],
    nextSettlementAt: async () => '2026-10-31T08:17:00Z',
    preferences: async () => ({ tips: 'off', tipsSeen: [] }),
    alertsUnread: async () => 0,
    subscribeAccount: () => () => {},
    subscribeReach: () => () => {},
    actsById: async () => [],
    thread: async () => null,
  } as unknown as KayfaApi;
  const kayfa = {
    api,
    instance: {
      cards: [
        { key: 'whoops', name: 'Whoops!', alignment: 'salty', rarity: 'common', playPrice: () => 0 },
        { key: 'stick-around', name: 'Stick Around', alignment: 'sweet', rarity: 'common', playPrice: () => 0 },
      ],
      settings: { economy: { 'whoops.price': 100, 'stick.price': 100 } },
      classes: [{ key: 'face', name: 'Face' }, { key: 'heel', name: 'Heel' }],
    },
    ui: { glass: testGlass, copy: { siteName: 'Divided World', siteTagline: 'dw.gripe', shopName: 'The Vending Machine', badges: [] }, cards: [], frontDoor: { prompt: { title: 'Who will you play as?', line: 'A test game.' } } },
    settings: { walletCap: 600, registrationMode: 'invite' },
  } as unknown as Kayfa;
  render(
    <RouterProvider>
      <KayfaProvider value={kayfa}>
        <PlayerProvider api={api}><Frame>{page}</Frame></PlayerProvider>
      </KayfaProvider>
    </RouterProvider>,
  );
}

/* Under Off the drawer is shown and hidden at once, so each test sees the page the moment the hand closes. */
beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); localStorage.clear(); sessionStorage.clear(); forgetBoard(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); document.documentElement.removeAttribute('data-kb-text-size'); vi.restoreAllMocks(); });

/** The Phone board's layout, as a player's text size of 150% makes it (useBoard.ts). */
const phone = () => document.documentElement.setAttribute('data-kb-text-size', '150');
const handButton = () => screen.findByRole('button', { name: /^Hand, 3 postcards/u });
const card = (name: RegExp) => within(screen.getByRole('dialog', { name: 'Your hand' })).getByRole('button', { name });
/* An armed card's name ends ", armed: pick a post". */
const STICK = /^Stick Around, Sweet, Cast, common postcard/u;

describe('the hand on the Main board is a modal', () => {
  test('it is a dialog named Your hand, the plate, the aura, Menu and Alerts are inert, and the first card has focus', async () => {
    setup();
    await userEvent.click(await handButton());
    const dialog = screen.getByRole('dialog', { name: 'Your hand' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const hud = document.querySelector('.kb-hud')!;
    expect(hud).toHaveAttribute('data-kb-hand-open');
    for (const sel of ['.kb-hud-plate', '.kb-hud-aura', '.kb-hud-menu', '.kb-hud-alerts']) expect(hud.querySelector(sel), sel).toHaveAttribute('inert');
    expect(hud.querySelector('.kb-hud-hand')).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(dialog.querySelector('li.kb-hand-card > button'));
  });

  test('a press on the backdrop closes the hand and returns focus to the hand button, and the click that follows reaches nothing beneath', async () => {
    const under = vi.fn();
    setup(<button type="button" onClick={under}>beneath</button>);
    const hand = await handButton();
    await userEvent.click(hand);
    const backdrop = document.querySelector('.kb-hand-backdrop')!;
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(fireEvent.pointerDown(backdrop)).toBe(false);
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    expect(document.querySelector('.kb-hand-backdrop')).toBeNull();
    /* The backdrop is gone, so the browser's click lands on what lay beneath it. */
    fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
    expect(under).not.toHaveBeenCalled();
    /* Only that one click: the next acts as usual. */
    fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
    expect(under).toHaveBeenCalledTimes(1);
  });

  test('a press on the HUD itself (its plate, or its bare ground) closes the hand like the backdrop, but a press on the hand button is the button\'s', async () => {
    const under = vi.fn();
    setup(<button type="button" onClick={under}>beneath</button>);
    const hand = await handButton();
    await userEvent.click(hand);
    const plate = document.querySelector('.kb-hud-plate')!;
    expect(fireEvent.pointerDown(plate)).toBe(false);
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    fireEvent.click(plate);
    expect(under).not.toHaveBeenCalled();
    await userEvent.click(hand);
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    expect(fireEvent.pointerDown(document.querySelector('.kb-hud')!)).toBe(false);
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    /* The press's own click is swallowed once, then the hand button's press is not a dismissal: its click opens the hand. */
    fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
    await userEvent.click(hand);
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(hand);
    expect(hand).toHaveAttribute('aria-expanded', 'true');
  });

  test('pressing a card arms it and closes the hand, and the armed card shows as a peek over the hand button', async () => {
    setup();
    const hand = await handButton();
    expect(document.querySelector('.kb-hand-peek')).toBeNull();
    await userEvent.click(hand);
    expect(document.querySelector('.kb-hand-peek')).toBeNull();
    await userEvent.click(card(STICK));
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    const peek = document.querySelector('.kb-hand-peek')!;
    expect(peek).toHaveAttribute('aria-hidden', 'true');
    expect(peek).toHaveTextContent('Stick Around');
    expect(peek).toHaveTextContent('Armed · pick a post');
    /* Opening again takes the keyboard to the armed card, and the peek is put away. */
    await userEvent.click(hand);
    expect(document.querySelector('.kb-hand-peek')).toBeNull();
    expect(document.activeElement).toBe(card(STICK));
    /* Pressing the armed card puts it back and leaves the hand open. */
    await userEvent.click(card(STICK));
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    expect(card(STICK)).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('.kb-hand-peek')).toBeNull();
  });
});

describe('the hand on the Phone board', () => {
  test('stays a region, with nothing inert and no backdrop', async () => {
    phone();
    setup();
    await userEvent.click(await handButton());
    const sheet = screen.getByRole('region', { name: 'Your hand' });
    expect(sheet).not.toHaveAttribute('aria-modal');
    expect(document.querySelector('.kb-hud')).not.toHaveAttribute('data-kb-hand-open');
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.kb-hand-backdrop')).toBeNull();
  });
});
