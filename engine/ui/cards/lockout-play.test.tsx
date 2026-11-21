/**
 * The play form for a character locked out of a thread (the so-very-happy design, section 2.3): a Move on a post in that thread says so, plainly, and cannot be sent; the same Move on
 * a post in another thread is open. The hand stays open either way. The cards are the engine's own test cards.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lockOut, lockoutCards, lockoutInstance, lockoutWorld, type LockoutWorld } from '../composer/lockout-world.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { hudKey } from '../player.tsx';
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
});
