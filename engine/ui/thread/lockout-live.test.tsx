/**
 * A lockout heard live (the so-very-happy design, section 2.2): the spring that locks a character stamps LOCKED OUT on its posts without a read, an admin's end of it (a `card_end` on the spring)
 * takes the stamp off, and the stamp goes by itself when the time passes, with no read.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { lockOut, lockoutCards, lockoutInstance, lockoutWorld } from '../composer/lockout-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import { renderIn } from '../test-world.tsx';

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** The thread open, with a post of Pipewrench's (post 3) to carry her postbit. */
async function open(admin = false) {
  const w = lockoutWorld(admin);
  w.fake.seed.post(w.thread, w.pipe, 'my own post');
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: lockoutInstance, cards: lockoutCards });
  await screen.findByRole('article', { name: /^Post 3 /u });
  return w;
}
const stamps = () => document.querySelectorAll('.kb-postbit-locked');

describe('the LOCKED OUT stamp, live', () => {
  test('a live lockout spring stamps the locked character\'s posts, and no one else\'s', async () => {
    const w = await open();
    expect(stamps()).toHaveLength(0);
    await act(async () => { await lockOut(w); });
    await waitFor(() => expect(stamps().length).toBeGreaterThan(0));
    for (const s of stamps()) expect(s.closest('article')).toHaveAccessibleName(/^Post 3 /u);
    expect(stamps()[0]).toHaveTextContent(/^LOCKED OUT until /u);
  });

  test('a live card_end on the spring takes the stamp off', async () => {
    const w = await open(true);
    const { spring } = await (async () => { let r!: Awaited<ReturnType<typeof lockOut>>; await act(async () => { r = await lockOut(w); }); return r; })();
    await waitFor(() => expect(stamps().length).toBeGreaterThan(0));
    await act(async () => { const ended = await w.fake.reverseCard(spring.id); expect(ended.ok).toBe(true); });
    await waitFor(() => expect(stamps()).toHaveLength(0));
  });

  test('the stamp goes by itself when the time passes, with no read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = lockoutWorld();
    w.fake.seed.post(w.thread, w.pipe, 'my own post');
    await lockOut(w);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance: lockoutInstance, cards: lockoutCards });
    await screen.findByRole('article', { name: /^Post 3 /u });
    await waitFor(() => expect(stamps().length).toBeGreaterThan(0));
    w.fake.clock.advance(24 * 3_600_000 + 1000);
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1000); });
    await waitFor(() => expect(stamps()).toHaveLength(0));
  });
});
