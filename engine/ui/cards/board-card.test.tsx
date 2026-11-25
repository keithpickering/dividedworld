/**
 * The play form of a board card (supabase/migrations/0438_board_cards_on_their_board.sql): a board card is written in a thread on its board, so the form asks for one, limited to that board, and offers
 * the thread the player has open when it is on that board. Without one it cannot be sent. The cards are the engine's own test cards.
 */
import { useEffect } from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lockoutCards, lockoutInstance, lockoutWorld, type LockoutWorld } from '../composer/lockout-world.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { hudKey } from '../player.tsx';
import { createPlays } from './plays.ts';
import { usePlay, type PlayTarget } from './play.tsx';
import { renderIn } from '../test-world.tsx';

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Open({ w, board }: { readonly w: LockoutWorld; readonly board: string }) {
  const openForm = usePlay()!.openForm;
  useEffect(() => {
    const target: PlayTarget = { title: 'General', author: 'Spritey', to: '/b/general', plays: createPlays(), know: async () => {}, post: null, reach: { reach: 'board', target: board, name: 'General' } };
    openForm('lkwide', target);
  }, [openForm, w, board]);
  return null;
}

async function form(opts: { readonly open: boolean }) {
  const w = lockoutWorld();
  const board = (await w.fake.thread(w.thread))!.board;
  localStorage.setItem(hudKey(w.me), w.pipe);
  const settings = { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy };
  renderIn(w.fake, <Frame>{opts.open ? <LoadedThread thread={w.thread} /> : null}<Open w={w} board={board} /></Frame>, { path: opts.open ? `/t/${w.thread}` : '/', instance: lockoutInstance, cards: lockoutCards, settings });
  return { w, board, dialog: await screen.findByRole('dialog', { name: /Lk Wide/u }) };
}

describe('the play form of a board card', () => {
  test('asks for a thread on the board, and starts on the thread the player has open', async () => {
    const { dialog } = await form({ open: true });
    const field = await within(dialog).findByRole('combobox', { name: 'Thread' });
    await waitFor(() => expect(field).toHaveValue('A short thread'));
    expect(within(dialog).queryByRole('option', { name: 'All boards' })).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled());
  });

  test('plays it in that thread, and the thread\'s page then carries it', async () => {
    const { w, dialog } = await form({ open: true });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled());
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Play as Pipewrench' }));
    await waitFor(async () => expect((await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!.boardCards).toHaveLength(1));
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.boardCards[0]).toMatchObject({ kind: 'card', thread: w.thread, targetActId: null, payload: { card: 'lkwide', reach: 'board', targetName: 'General' } });
  });

  test('with no thread open it asks for one and cannot be sent until one is picked', async () => {
    const { dialog } = await form({ open: false });
    expect(await within(dialog).findByText(/Pick the thread to play it in/u)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
    expect(await axeViolations(dialog).then(describeViolations)).toBe('');
  });

  test('the disabled send button says why, and the reason is a live region that stays mounted', async () => {
    const { dialog } = await form({ open: false });
    const send = within(dialog).getByRole('button', { name: 'Play as Pipewrench' });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(/Pick the thread to play it in/u);
    const reason = within(dialog).getByRole('status', { name: 'Where to play it' });
    expect(reason).toHaveTextContent(/Pick the thread to play it in/u);
    /* Once a thread is open the region is still there, empty, and the button no longer waits on it. */
    cleanup();
    const open = await form({ open: true });
    await waitFor(() => expect(within(open.dialog).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled());
    expect(within(open.dialog).getByRole('status', { name: 'Where to play it' })).toBeEmptyDOMElement();
  });

  test('the one board is shown as text, not as a select with a single option', async () => {
    const { dialog } = await form({ open: false });
    await within(dialog).findByRole('combobox', { name: 'Thread' });
    expect(within(dialog).queryByRole('combobox', { name: 'Board' })).toBeNull();
    expect(within(dialog).getByText('General', { selector: '.kb-glass-field span' })).toBeInTheDocument();
  });
});
