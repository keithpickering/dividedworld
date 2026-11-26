/**
 * The play form for a character locked out of a thread (the so-very-happy design, section 2.3): a Move on a post in that thread says so, plainly, and cannot be sent; the same Move on
 * a post in another thread is open. The hand stays open either way. The cards are the engine's own test cards.
 */
import { useEffect } from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lockOut, lockoutCards, lockoutInstance, lockoutWorld, type LockoutWorld } from '../composer/lockout-world.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { hudKey } from '../player.tsx';
import { createPlays } from './plays.ts';
import { usePlay, type PlayTarget } from './play.tsx';
import { renderIn } from '../test-world.tsx';

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function formOn(w: LockoutWorld, thread: string, seq: number) {
  localStorage.setItem(hudKey(w.me), w.pipe);
  renderIn(w.fake, <Frame><LoadedThread thread={thread} /></Frame>, { path: `/t/${thread}`, instance: lockoutInstance, cards: lockoutCards, settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
  await screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Hand, \d+ postcards?/u }));
  await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getByRole('button', { name: /^Lk Salty/u }));
  await user.click(await within(document.getElementById(`post-${seq}`)!).findByRole('button', { name: `Play Lk Salty on post ${seq}` }));
  return screen.findByRole('dialog', { name: /Lk Salty/u });
}

describe('the play form of a locked-out mask', () => {
  test('a Move on a post in that thread shows the lockout note and cannot be sent', async () => {
    const w = lockoutWorld();
    await lockOut(w);
    const form = await formOn(w, w.thread, 2);
    const note = within(form).getByText(/is locked out of this thread until/u).closest('p')!;
    expect(note).toHaveTextContent(/^Pipewrench is locked out of this thread until .+\. The lockout ends by itself then, and it holds only this character, not your other characters\. You can switch to another in the HUD\.$/u);
    expect(note).toHaveAttribute('role', 'status');
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
  });

  test('a Move on a post in another thread is open, and says nothing of a lockout', async () => {
    const w = lockoutWorld();
    await lockOut(w);
    const form = await formOn(w, w.elsewhere, 1);
    expect(within(form).queryByText(/is locked out of this thread until/u)).toBeNull();
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
  });

  test('an admin ending the lockout early opens the form at once', async () => {
    const w = lockoutWorld(true);
    const { spring } = await lockOut(w);
    const form = await formOn(w, w.thread, 2);
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
    await w.listening();
    expect((await w.fake.reverseCard(spring.id)).ok).toBe(true);
    await waitFor(() => expect(within(form).queryByText(/is locked out of this thread until/u)).toBeNull());
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled();
  });

  test('the hand stays open: it opens, the Move is armed and its form opens, with the lockout said inside it', async () => {
    const w = lockoutWorld();
    await lockOut(w);
    const form = await formOn(w, w.thread, 2);
    expect(form).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Hand, \d+ postcards?/u })).toBeInTheDocument();
  });
});

/* A play beyond a post, opened as the thread's title, a postbit and a board's banner open it (thread/Post.tsx): the thread reach's target is the thread's own id, the character reach comes from a post. */
describe('the play form of a locked-out mask, beyond a post', () => {
  function Open({ w, as, board }: { readonly w: LockoutWorld; readonly as: 'thread' | 'character' | 'board' | 'elsewhere'; readonly board: string }) {
    const openForm = usePlay()!.openForm;
    useEffect(() => {
      const plays = createPlays();
      const common = { title: 'A short thread', author: 'Spritey', to: `/t/${w.thread}`, plays, know: async () => {} };
      const post = { id: w.post, character: w.spritey, kind: 'post', thread: w.thread, targetActId: null, seq: 1, createdAt: '2026-10-29T21:00:00Z', payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null } as unknown as NonNullable<PlayTarget['post']>;
      const target: PlayTarget = as === 'thread' ? { ...common, post: null, reach: { reach: 'thread', target: w.thread, name: 'A short thread' } }
        : as === 'character' ? { ...common, post, reach: { reach: 'character', target: w.spritey, name: 'Spritey' } }
        : as === 'board' ? { ...common, post: null, reach: { reach: 'board', target: board, name: 'General' } }
        : { ...common, post: null, reach: { reach: 'thread', target: w.elsewhere, name: 'Another thread' } };
      openForm('lkwide', target);
    }, [openForm, w, as, board]);
    return null;
  }
  async function reach(as: 'thread' | 'character' | 'board' | 'elsewhere') {
    const w = lockoutWorld();
    await lockOut(w);
    const board = (await w.fake.thread(w.thread))!.board;
    localStorage.setItem(hudKey(w.me), w.pipe);
    renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /><Open w={w} as={as} board={board} /></Frame>, { path: `/t/${w.thread}`, instance: lockoutInstance, cards: lockoutCards, settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
    return screen.findByRole('dialog', { name: /Lk Wide/u });
  }

  test('a thread reach on the locked thread is blocked', async () => {
    const form = await reach('thread');
    expect(within(form).getByText(/is locked out of this thread until/u)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
  });

  test('a character reach from a post in the locked thread is blocked', async () => {
    const form = await reach('character');
    expect(within(form).getByText(/is locked out of this thread until/u)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
  });

  test('a thread reach on another thread is not blocked', async () => {
    const form = await reach('elsewhere');
    expect(within(form).queryByText(/is locked out of this thread until/u)).toBeNull();
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeEnabled());
  });

  /* A board card is written in a thread on its board (0438), and the lockout holds in that thread: the thread the player has open is the one offered, and it is this one. */
  test('a board reach is written in the open thread, so the lockout there blocks it', async () => {
    const form = await reach('board');
    expect(await within(form).findByText(/is locked out of this thread until/u)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Play as Pipewrench' })).toBeDisabled();
  });
});
