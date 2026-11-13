/**
 * The hand on the Main board is a modal (the hand-arc design, sections 2 to 4): while it is open the rest of the HUD is
 * inert and faded, a press outside the cards closes it and acts on nothing beneath, opening puts the keyboard on a card,
 * arming a card closes it and leaves the card's peek over the hand button. The Phone board's sheet is none of that.
 * The Frame here is the real one over a fake API, as Frame.test.tsx draws it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { KayfaApi, MyCharacter } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider } from '../player.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { forgetBoard } from '../glass/back.ts';
import { Frame } from './Frame.tsx';
import { usePlay } from '../cards/play.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

/* jsdom has no WAAPI: Motion's `animate`, which glass/play.ts runs the cards' deal and gather with, is a stub that holds each run until a test settles it. */
interface Run { readonly el: HTMLElement; readonly frames: Record<string, unknown[]>; settle: () => void; readonly stop: ReturnType<typeof vi.fn> }
const runs: Run[] = [];
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  animate: (el: HTMLElement, frames: Record<string, unknown[]>) => {
    let settle: () => void = () => {};
    const p = new Promise<void>((r) => { settle = r; });
    /* Motion's stop() commits the pose the run had reached; a mid-gather card is part way to the hand button and part way faded. */
    const run = { el, frames, settle, stop: vi.fn(() => { el.style.opacity = '0.4'; el.style.transform = 'translateX(30px) translateY(-20px) scale(0.8)'; }) };
    runs.push(run);
    return Object.assign(p, { stop: run.stop });
  },
}));

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
afterEach(() => { runs.length = 0; cleanup(); document.documentElement.removeAttribute('data-kb-motion'); document.documentElement.removeAttribute('data-kb-text-size'); vi.restoreAllMocks(); });

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
    fireEvent.pointerDown(backdrop, { button: 0 });
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

  test('a right or middle press on the backdrop does nothing: the hand stays open', async () => {
    setup();
    const hand = await handButton();
    await userEvent.click(hand);
    for (const button of [1, 2]) fireEvent.pointerDown(document.querySelector('.kb-hand-backdrop')!, { button });
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.kb-hand-backdrop')).not.toBeNull();
  });

  test('a press that ends without a click (a touch that becomes a scroll, a context menu, a drag) leaves no swallower for the next real click', async () => {
    const under = vi.fn();
    setup(<button type="button" onClick={under}>beneath</button>);
    const hand = await handButton();
    for (const ends of ['pointercancel', 'contextmenu'] as const) {
      await userEvent.click(hand);
      fireEvent.pointerDown(document.querySelector('.kb-hand-backdrop')!, { button: 0, pointerId: 7 });
      expect(hand).toHaveAttribute('aria-expanded', 'false');
      fireEvent(window, new Event(ends === 'contextmenu' ? 'contextmenu' : 'pointercancel', { bubbles: true }));
      fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
      expect(under, ends).toHaveBeenCalledTimes(ends === 'pointercancel' ? 1 : 2);
    }
  });

  test('a later press drops the swallower of an earlier one', async () => {
    const under = vi.fn();
    setup(<button type="button" onClick={under}>beneath</button>);
    const hand = await handButton();
    await userEvent.click(hand);
    fireEvent.pointerDown(document.querySelector('.kb-hand-backdrop')!, { button: 0 });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'beneath' }), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
    expect(under).toHaveBeenCalledTimes(1);
  });

  test('a press on the HUD itself (its plate, or its bare ground) closes the hand like the backdrop, but a press on the hand button is the button\'s', async () => {
    const under = vi.fn();
    setup(<button type="button" onClick={under}>beneath</button>);
    const hand = await handButton();
    await userEvent.click(hand);
    const plate = document.querySelector('.kb-hud-plate')!;
    fireEvent.pointerDown(plate, { button: 0 });
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    fireEvent.click(plate);
    expect(under).not.toHaveBeenCalled();
    await userEvent.click(hand);
    expect(hand).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(document.querySelector('.kb-hud')!, { button: 0 });
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

/* A button that opens a compose on post 7 as a post's ghost mark would; the compose's own draw is the card's, so none is mounted here. */
function OpenCompose() {
  const play = usePlay()!;
  const target = { post: { id: 'p7', seq: 7 }, title: 't', author: 'Gloomba', to: '/t/x', plays: {}, know: async () => {} } as unknown as Parameters<typeof play.openCompose>[1];
  return <button type="button" onClick={() => play.openCompose('stick-around', target)}>Open compose</button>;
}

describe('the peek while a compose is open', () => {
  test('says Playing · post #N while one is open, and Armed · pick a post after Esc', async () => {
    setup(<OpenCompose />);
    const hand = await handButton();
    await userEvent.click(hand);
    await userEvent.click(card(STICK));
    expect(document.querySelector('.kb-hand-peek')).toHaveTextContent('Armed · pick a post');
    await userEvent.click(screen.getByRole('button', { name: 'Open compose' }));
    expect(document.querySelector('.kb-hand-peek')).toHaveTextContent('Playing · post #7');
    expect(document.querySelector('.kb-hand-peek')).not.toHaveTextContent('Armed');
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('.kb-hand-peek')).toHaveTextContent('Armed · pick a post');
  });
});

describe('the hand on the Main board, reopened while it gathers', () => {
  test('the cards play in again, and when the last gather ends the drawer is hidden, nothing is inert and the hand button has focus', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    expect(runs).toHaveLength(2);
    for (const r of runs) expect(r.el.matches('li.kb-hand-card')).toBe(true);
    await act(async () => { for (const r of runs) r.settle(); });
    runs.length = 0;
    /* Close: the cards gather (exits), the drawer stays shown and inert. */
    await userEvent.click(hand);
    const gathering = [...runs];
    expect(gathering).toHaveLength(2);
    expect(drawer.hidden).toBe(false);
    expect(drawer).toHaveAttribute('inert');
    /* Reopen before the gather ends: it is stopped, the cards deal in again (a run from the hand button to the slot) and the drawer is live. */
    await userEvent.click(hand);
    for (const r of gathering) expect(r.stop).toHaveBeenCalledTimes(1);
    const dealing = runs.slice(2);
    expect(dealing).toHaveLength(2);
    for (const r of dealing) expect(r.frames.scale?.[0]).toBe(0.6);
    expect(drawer.hidden).toBe(false);
    expect(drawer).not.toHaveAttribute('inert');
    expect(document.querySelector('.kb-hud')).toHaveAttribute('data-kb-hand-open');
    /* The stopped gather's committed pose is not left on the cards for the deal to start from or to keep: each card is back on its slot's stylesheet. */
    await act(async () => { for (const r of dealing) r.settle(); });
    await waitFor(() => expect(drawer.querySelector<HTMLElement>('li.kb-hand-card')!.style.transform).toBe(''));
    for (const li of drawer.querySelectorAll<HTMLElement>('li.kb-hand-card')) {
      expect(li.style.opacity).toBe('');
      expect(li.style.transform).toBe('');
      expect(getComputedStyle(li).opacity).toBe('1');
    }
    /* Close again, and let every run, the stale ones too, settle. */
    await userEvent.click(hand);
    const last = runs.slice(4);
    expect(last).toHaveLength(2);
    await act(async () => { for (const r of runs) r.settle(); });
    expect(drawer.hidden).toBe(true);
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.kb-hud')).not.toHaveAttribute('data-kb-hand-open');
    expect(hand).toHaveFocus();
  });
});

describe('the hand on the Main board, a gather stopped by switching motion Off', () => {
  test('the stopped gather gives each card its stylesheet transition back', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    setup();
    const hand = await handButton();
    await userEvent.click(hand);
    await act(async () => { for (const r of runs) r.settle(); });
    await waitFor(() => expect(document.querySelector<HTMLElement>('li.kb-hand-card')!.style.transition).toBe(''));
    await userEvent.click(hand);
    expect(document.querySelector<HTMLElement>('li.kb-hand-card')!.style.transition).toBe('none');
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
    await userEvent.click(hand);
    for (const li of document.querySelectorAll<HTMLElement>('li.kb-hand-card')) expect(li.style.transition).toBe('');
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

  test('while a compose is open the hand button says Playing, and pressing it puts the card back', async () => {
    phone();
    setup(<OpenCompose />);
    await userEvent.click(await handButton());
    await userEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: STICK }));
    expect(screen.getByRole('button', { name: 'Armed · Stick Around, press to put it back' })).toHaveTextContent('Armed · Stick Around');
    await userEvent.click(screen.getByRole('button', { name: 'Open compose' }));
    const playing = screen.getByRole('button', { name: 'Playing · Stick Around, press to put it back' });
    expect(playing).toHaveTextContent('Playing · Stick Around');
    await userEvent.click(playing);
    expect(await handButton()).toBeInTheDocument();
  });
});
