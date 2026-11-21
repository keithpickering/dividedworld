/**
 * The reply box of a character locked out of a thread (the so-very-happy design, section 2.3): it says plainly until when and that the lockout ends by itself and holds only this character,
 * and Send is shut until then; another thread and another mask are not held. The lockout is a public fact carried by the player's own characters (`my_characters.lockouts`); the box reads nothing of its own.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { LoadedThread } from '../loaded.tsx';
import { renderIn } from '../test-world.tsx';
import { Swapper } from './support.tsx';
import { lockOut, lockoutCards, lockoutInstance, lockoutWorld, type LockoutWorld } from './lockout-world.tsx';

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const open = (w: LockoutWorld, thread = w.thread) => renderIn(w.fake, <><LoadedThread thread={thread} /><Swapper /></>, { path: `/t/${thread}`, instance: lockoutInstance, cards: lockoutCards });
const box = () => screen.findByRole('textbox', { name: 'Your reply' });

describe('the reply box of a locked-out mask', () => {
  test('says until when, that it ends by itself and holds only this character, and shuts Send', async () => {
    const w = lockoutWorld();
    await lockOut(w);
    open(w);
    await box();
    const note = await screen.findByText(/is locked out of this thread until/u);
    expect(note.closest('p')).toHaveTextContent(/^Pipewrench is locked out of this thread until .+\. The lockout ends by itself then, and it holds only this character, not your other characters\. You can switch to another in the HUD\.$/u);
    expect(note.closest('p')).toHaveAttribute('role', 'status');
    expect(note.closest('p')).toHaveClass('kb-notice', 'kb-composer-lockout');
    await userEvent.click(await box());
    await userEvent.paste('A reply.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    const bad = await axeViolations(note.closest('p')!);
    expect(bad, describeViolations(bad)).toEqual([]);
  });

  test('another mask of the same player is not held, and another thread is not held', async () => {
    const w = lockoutWorld();
    await lockOut(w);
    const { unmount } = open(w);
    await screen.findByText(/is locked out of this thread until/u);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(screen.queryByText(/is locked out of this thread until/u)).toBeNull());
    unmount();
    open(w, w.elsewhere);
    await box();
    expect(screen.queryByText(/is locked out of this thread until/u)).toBeNull();
  });

  test('the lockout ends by itself at its time: the note goes and Send is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = lockoutWorld();
    await lockOut(w);
    open(w);
    await box();
    await screen.findByText(/is locked out of this thread until/u);
    w.fake.clock.advance(24 * 3_600_000 + 1000);
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1000); });
    await waitFor(() => expect(screen.queryByText(/is locked out of this thread until/u)).toBeNull());
    await userEvent.click(await box());
    await userEvent.paste('Back.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  test('an admin ending the lockout early: the note goes and Send is open, with no reload', async () => {
    const w = lockoutWorld(true);
    const { spring } = await lockOut(w);
    open(w);
    await box();
    await screen.findByText(/is locked out of this thread until/u);
    expect((await w.fake.reverseCard(spring.id)).ok).toBe(true);
    await waitFor(() => expect(screen.queryByText(/is locked out of this thread until/u)).toBeNull());
    await userEvent.click(await box());
    await userEvent.paste('Back.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  test('a lockout sprung while the thread is open shows its note at once', async () => {
    const w = lockoutWorld();
    open(w);
    await box();
    expect(screen.queryByText(/is locked out of this thread until/u)).toBeNull();
    await act(async () => { await lockOut(w); });
    await screen.findByText(/is locked out of this thread until/u);
  });

  test('a ban speaks first where both hold: only its note is shown', async () => {
    const w = lockoutWorld();
    await lockOut(w);
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const visit = w.fake.seed.visit(clerk, w.post, { at: w.fake.clock.now() - 3_600_000, endsInMs: 60_000 });
    const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
    w.fake.seed.ban(w.pipe, w.fake.clock.now() + 5 * 3_600_000, { infraction: inf });
    open(w);
    await box();
    await screen.findByText(/is banned until/u);
    expect(screen.queryByText(/is locked out of this thread until/u)).toBeNull();
  });
});
