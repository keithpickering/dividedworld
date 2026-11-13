/**
 * The hand on the Main board is a modal (the hand-arc design, sections 2 to 4): while it is open the rest of the HUD is
 * inert and faded, a press outside the cards closes it and acts on nothing beneath, opening puts the keyboard on a card,
 * arming a card closes it and leaves the card's peek over the hand button. The Phone board's sheet is the same modal, with no peek (a post's + mark and the
 * hand button's words say what is armed there), and the Phone board's tests below hold it to it.
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
    /* Motion's stop() commits the pose the run had reached; a mid-gather card is part way to the hand button and part way faded, and a sheet is part way blurred or cut. */
    const run = { el, frames, settle, stop: vi.fn(() => { el.style.opacity = '0.4'; el.style.transform = 'translateX(30px) translateY(-20px) scale(0.8)'; el.style.filter = 'blur(6px)'; el.style.clipPath = 'inset(0 0 40% 0)'; }) };
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

describe('the hand on the Main board opens calmly (the phone-hand design, section 1)', () => {
  /* A pointer move on the window at a client point, as the browser's pointermove carries it. */
  const moveTo = (x: number, y: number) => act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })); });

  test('the drawer waits for the pointer to move more than 4px from the press that opened the hand', async () => {
    setup();
    const hand = await handButton();
    fireEvent.pointerDown(hand, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.click(hand);
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await waitFor(() => expect(hand).toHaveAttribute('aria-expanded', 'true'));
    expect(drawer).toHaveAttribute('data-kb-hover-waits');
    await moveTo(102, 100);
    expect(drawer).toHaveAttribute('data-kb-hover-waits');
    await moveTo(120, 100);
    expect(drawer).not.toHaveAttribute('data-kb-hover-waits');
  });

  test('a hand opened with no press (a key) loses the wait at the first pointer move, and a close and reopen waits again', async () => {
    setup();
    const hand = await handButton();
    fireEvent.click(hand);
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await waitFor(() => expect(drawer).toHaveAttribute('data-kb-hover-waits'));
    await moveTo(1, 1);
    expect(drawer).not.toHaveAttribute('data-kb-hover-waits');
    fireEvent.click(hand);
    fireEvent.click(hand);
    await waitFor(() => expect(drawer).toHaveAttribute('data-kb-hover-waits'));
  });

  test('under a feel the drawer carries data-kb-dealing until the last deal ends, and again until the last gather ends', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    expect(runs).toHaveLength(2);
    expect(drawer).toHaveAttribute('data-kb-dealing');
    await act(async () => { runs[0]!.settle(); });
    expect(drawer).toHaveAttribute('data-kb-dealing');
    await act(async () => { runs[1]!.settle(); });
    await waitFor(() => expect(drawer).not.toHaveAttribute('data-kb-dealing'));
    runs.length = 0;
    await userEvent.click(hand);
    expect(runs).toHaveLength(2);
    expect(drawer).toHaveAttribute('data-kb-dealing');
    await act(async () => { for (const r of runs) r.settle(); });
    await waitFor(() => expect(drawer).not.toHaveAttribute('data-kb-dealing'));
  });

  test('a deal that is stopped leaves no mark: the stop itself clears data-kb-dealing, with no play having ended', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    expect(runs).toHaveLength(2);
    expect(drawer).toHaveAttribute('data-kb-dealing');
    /* Unmount mid-deal: the drawer's run is stopped, and no fake play has ended, so no card's landing can have cleared the mark. */
    cleanup();
    for (const r of runs) expect(r.stop).toHaveBeenCalledTimes(1);
    expect(drawer).not.toHaveAttribute('data-kb-dealing');
  });

  test('under Off the drawer never carries data-kb-dealing', async () => {
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    expect(drawer).not.toHaveAttribute('data-kb-dealing');
    await userEvent.click(hand);
    expect(drawer).not.toHaveAttribute('data-kb-dealing');
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

/* Arms a card and opens the hand with it armed, as a keyboard's Esc-less return can: the phone's hand button puts an armed card back, so no press reaches the open hand with a card armed. */
function ArmAndOpen({ card: key }: { readonly card: string }) {
  const play = usePlay()!;
  return <button type="button" onClick={() => { play.arm(key); play.setHandOpen(true); }}>Arm and open</button>;
}

describe('the hand on the Phone board', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Your hand' });
  const handCard = (name: RegExp) => within(dialog()).getByRole('button', { name });
  const WHOOPS = /^Whoops!, /u;
  /* A press with no pointer, as a keyboard or a reader makes it: it acts on the card whether or not it is in the middle. */
  const activate = (el: HTMLElement) => fireEvent.click(el, { detail: 0 });

  test('is a modal dialog: named Your hand, aria-modal, the HUD marked, and the backdrop there', async () => {
    phone();
    setup();
    await userEvent.click(await handButton());
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(document.querySelector('.kb-hud')).toHaveAttribute('data-kb-hand-open');
    expect(document.querySelector('.kb-hand-backdrop')).not.toBeNull();
  });

  test('the plate, the aura, Alerts and Menu are inert while it is open, and the hand button is not', async () => {
    phone();
    setup();
    await userEvent.click(await handButton());
    const hud = document.querySelector('.kb-hud')!;
    for (const sel of ['.kb-hud-plate', '.kb-hud-aura', '.kb-hud-menu', '.kb-hud-alerts']) expect(hud.querySelector(sel), sel).toHaveAttribute('inert');
    expect(hud.querySelector('.kb-hud-hand')).not.toHaveAttribute('inert');
  });

  test('a press on one of the HUD\'s faded parts closes the hand through the same dismissal, focuses the hand button, and nothing stays inert', async () => {
    const under = vi.fn();
    phone();
    setup(<button type="button" onClick={under}>beneath</button>);
    const hand = await handButton();
    await userEvent.click(hand);
    fireEvent.pointerDown(document.querySelector('.kb-hud-plate')!, { button: 0 });
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.kb-hud')).not.toHaveAttribute('data-kb-hand-open');
    /* The press's own click is swallowed once, as on a backdrop press. */
    fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
    expect(under).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'beneath' }));
    expect(under).toHaveBeenCalledTimes(1);
  });

  test('a close interrupted by a reopen leaves the dialog shown with the first card focused, and a last close leaves nothing inert and the focus on the hand button', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    phone();
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    await act(async () => { for (const r of runs) r.settle(); });
    runs.length = 0;
    await userEvent.click(hand);
    expect(drawer.hidden).toBe(false);
    expect(drawer).toHaveAttribute('inert');
    const closing = [...runs];
    await userEvent.click(hand);
    for (const r of closing) expect(r.stop).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeVisible();
    expect(drawer).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(dialog().querySelector('li.kb-hand-card > button'));
    await userEvent.click(hand);
    await act(async () => { for (const r of runs) r.settle(); });
    await waitFor(() => expect(drawer.hidden).toBe(true));
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.kb-hud')).not.toHaveAttribute('data-kb-hand-open');
    expect(hand).toHaveFocus();
  });

  test('a pointer press on the backdrop closes the hand and focuses the hand button, and nothing stays inert', async () => {
    phone();
    setup();
    const hand = await handButton();
    await userEvent.click(hand);
    fireEvent.pointerDown(document.querySelector('.kb-hand-backdrop')!, { button: 0 });
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    expect(document.querySelector('.kb-hand-backdrop')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.kb-hud')).not.toHaveAttribute('data-kb-hand-open');
  });

  test('Esc closes it and focuses the hand button', async () => {
    phone();
    setup();
    const hand = await handButton();
    await userEvent.click(hand);
    await userEvent.keyboard('{Escape}');
    expect(hand).toHaveAttribute('aria-expanded', 'false');
    expect(hand).toHaveFocus();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  test('opening takes focus to the first card, and with Whoops! armed to the Whoops! card', async () => {
    phone();
    setup();
    const hand = await handButton();
    await userEvent.click(hand);
    expect(document.activeElement).toBe(dialog().querySelector('li.kb-hand-card > button'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Close the hand' }));
    cleanup();
    setup(<ArmAndOpen card="stick-around" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Arm and open' }));
    expect(document.activeElement).toBe(handCard(/^Stick Around, /u));
    cleanup();
    setup(<ArmAndOpen card="whoops" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Arm and open' }));
    expect(document.activeElement).toBe(handCard(WHOOPS));
  });

  test('pressing the armed card puts it back and leaves the dialog open; pressing another card arms it, closes the dialog and the hand button says Armed', async () => {
    phone();
    setup(<ArmAndOpen card="whoops" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Arm and open' }));
    activate(handCard(WHOOPS));
    expect(dialog()).toBeVisible();
    expect(handCard(WHOOPS)).toHaveAttribute('aria-pressed', 'false');
    activate(handCard(STICK));
    expect(screen.queryByRole('dialog', { name: 'Your hand' })).toBeNull();
    const hand = screen.getByRole('button', { name: 'Armed · Stick Around, press to put it back' });
    expect(hand).toHaveTextContent('Armed · Stick Around');
    expect(hand).toHaveFocus();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('.kb-hand-peek')).toBeNull();
  });

  test('Tab wraps inside the dialog: from the Vending Machine button to the first part, and Shift+Tab back', async () => {
    phone();
    setup();
    await userEvent.click(await handButton());
    const close = within(dialog()).getByRole('button', { name: 'Close the hand' });
    const vending = within(dialog()).getByRole('link', { name: 'Vending Machine' });
    vending.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(vending);
  });

  test('under a feel the sheet plays and only the cards in the row\'s width are dealt; a stopped deal leaves no inline transform', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    phone();
    /* jsdom lays nothing out: the row is 300px wide, the Whoops! card stands in it and the Stick Around card beyond it. */
    const at = (left: number, width: number) => ({ left, right: left + width, top: 0, bottom: 100, width, height: 100, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('ul.kb-hand-cards')) return at(0, 300);
      if (this.matches('[data-kb-card="whoops"]')) return at(100, 104);
      if (this.matches('[data-kb-card="stick-around"]')) return at(500, 104);
      return at(0, 100);
    });
    setup();
    const hand = await handButton();
    await userEvent.click(hand);
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    const cards = runs.filter((r) => r.el.matches('li.kb-hand-card'));
    expect(cards.map((r) => r.el.dataset.kbCard)).toEqual(['whoops']);
    expect(runs.some((r) => r.el === drawer)).toBe(true);
    /* The deal's turn is 0: the pose's rotation is the card's own `rotate`. */
    expect(cards[0]!.frames.rotate).toEqual([0, 0]);
    expect(drawer).toHaveAttribute('data-kb-dealing');
    /* Motion goes Off mid-deal: the run is stopped, its committed pose is not left on any card, and the mark is gone. */
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
    await userEvent.click(hand);
    for (const li of drawer.querySelectorAll<HTMLElement>('li.kb-hand-card')) {
      expect(li.style.transform).toBe('');
      expect(li.style.opacity).toBe('');
    }
    expect(drawer).not.toHaveAttribute('data-kb-dealing');
    expect(drawer.hidden).toBe(true);
  });

  test('a sheet entrance stopped by motion going Off, then a close and a reopen, leaves no inline opacity, transform, filter or clip-path on the drawer', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    phone();
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    const sheet = runs.find((r) => r.el === drawer)!;
    expect(sheet).toBeDefined();
    const bare = (when: string) => { for (const p of ['opacity', 'transform', 'filter', 'clip-path']) expect(drawer.style.getPropertyValue(p), `${p} ${when}`).toBe(''); };
    /* Motion goes Off mid-entrance and the hand is closed: the stop committed the pose it had reached, and none of it is left. */
    await act(async () => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
    await userEvent.click(hand);
    expect(sheet.stop).toHaveBeenCalledTimes(1);
    bare('after the close');
    await userEvent.click(hand);
    bare('after the reopen');
  });

  test('a reopen during the sheet\'s exit starts clean: nothing the stopped exit committed is left on the drawer', async () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    phone();
    setup();
    const hand = await handButton();
    const drawer = document.querySelector<HTMLElement>('.kb-hand-drawer')!;
    await userEvent.click(hand);
    await act(async () => { for (const r of runs) r.settle(); });
    runs.length = 0;
    await userEvent.click(hand);
    const exit = runs.find((r) => r.el === drawer)!;
    await userEvent.click(hand);
    expect(exit.stop).toHaveBeenCalledTimes(1);
    for (const p of ['opacity', 'transform', 'filter', 'clip-path']) expect(drawer.style.getPropertyValue(p), p).toBe('');
  });

  test('while a compose is open the hand button says Playing, and pressing it puts the card back', async () => {
    phone();
    setup(<OpenCompose />);
    await userEvent.click(await handButton());
    /* A pointer press on a card that is not in the middle only brings it there; the press with no pointer acts on it. */
    activate(handCard(STICK));
    expect(screen.getByRole('button', { name: 'Armed · Stick Around, press to put it back' })).toHaveTextContent('Armed · Stick Around');
    await userEvent.click(screen.getByRole('button', { name: 'Open compose' }));
    const playing = screen.getByRole('button', { name: 'Playing · Stick Around, press to put it back' });
    expect(playing).toHaveTextContent('Playing · Stick Around');
    await userEvent.click(playing);
    expect(await handButton()).toBeInTheDocument();
  });
});
