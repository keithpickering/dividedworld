/**
 * The composer for a banned mask (the Mod Bots design, section 5: "a banned character can browse but cannot post"): it says plainly until when and that the ban ends by itself,
 * and holds only this character, so another mask of the same player posts. The ban is a public fact carried by the player's own characters; the composer reads nothing of its own.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { openThread, replyBox, threadWorld } from './support.tsx';

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Pipewrench is banned for `hours`, by an infraction the post's visit filed (the seeds write what `infract` does). */
function banned(hours = 5) {
  const w = threadWorld();
  const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
  const visit = w.fake.seed.visit(clerk, w.ids[1]!, { at: Date.now() - 3_600_000, endsInMs: 60_000 });
  const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
  w.fake.seed.ban(w.pipe, Date.now() + hours * 3_600_000, { infraction: inf });
  return w;
}

describe('the composer of a banned mask', () => {
  test('says plainly until when and that it ends by itself, and holds only this character', async () => {
    const w = banned();
    openThread(w);
    await replyBox();
    const note = await screen.findByText(/is banned until/u);
    expect(note.closest('p')).toHaveTextContent(/^Pipewrench is banned until .+\. The ban ends by itself then, and it holds only this character: switch to another in the HUD to post as it\. Appeal to the Boss · 0.50 Aura$/u);
    expect(note.closest('p')).toHaveAttribute('role', 'status');
  });

  test('offers the way out beside "it ends by itself": an appeal to the Boss, for this mask alone', async () => {
    const w = banned();
    openThread(w);
    await replyBox();
    expect(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Appeal to the Boss/u })).toBeNull());
  });

  test('cannot send, however much is written', async () => {
    const w = banned();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    const box = await replyBox();
    await userEvent.click(box);
    await userEvent.paste('A reply.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(posted).not.toHaveBeenCalled();
  });

  test('another mask of the same player is not held, and the note goes with the banned one', async () => {
    const w = banned();
    openThread(w);
    await replyBox();
    await screen.findByText(/is banned until/u);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(screen.queryByText(/is banned until/u)).toBeNull());
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.click(await replyBox());
    await userEvent.paste('Zed speaks.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  test('is a plain composer for a mask that is not banned, and for one whose ban has ended', async () => {
    const w = threadWorld();
    openThread(w);
    await replyBox();
    expect(screen.queryByText(/is banned until/u)).toBeNull();
  });

  test('the ban ends by itself at its time: the note goes and Send is open, with no read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = banned(1);
    openThread(w);
    await replyBox();
    await screen.findByText(/is banned until/u);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000 + 1000); });
    await waitFor(() => expect(screen.queryByText(/is banned until/u)).toBeNull());
    await userEvent.click(await replyBox());
    await userEvent.paste('Back.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  test('passes axe', async () => {
    const w = banned();
    openThread(w);
    const form = (await replyBox()).closest('form')!;
    await screen.findByText(/is banned until/u);
    const bad = await axeViolations(within(form).getByRole('textbox', { name: 'Your reply' }).closest('form')!);
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});
