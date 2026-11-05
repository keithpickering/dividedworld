import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, holdReads, renderIn } from '../test-world.tsx';
import { ThreadScreen } from './Thread.tsx';
import { LoadedThread } from '../loaded.tsx';

/* The Follow / Unfollow control on the thread page (the alerts plan, Task 4; the alerts design, sections 4 and 12): in the glass, a real
   labeled button, drawn from the server's answer to "does the caller follow this thread". */

class QuietObserver {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', QuietObserver);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const mine = fake.seed.character(me, 'Pipewrench', 'heel');
  const theirs = fake.seed.character(other, 'Spritey', 'face');
  const started = fake.seed.thread('general', mine, 'Mine to follow', 'opening').thread;
  const elsewhere = fake.seed.thread('general', theirs, 'Theirs to read', 'opening').thread;
  fake.signInAs(me);
  return { fake, started, elsewhere };
}
const show = (w: ReturnType<typeof world>, thread: string) => renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}` });

describe('the follow control', () => {
  test('a thread the player did not start offers Follow, from the server, and following it offers Unfollow', async () => {
    const w = world();
    show(w, w.elsewhere);
    const button = await screen.findByRole('button', { name: 'Follow this thread' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(await screen.findByRole('button', { name: 'Unfollow this thread' })).toBeInTheDocument();
    expect(await w.fake.following(w.elsewhere)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow this thread' }));
    expect(await screen.findByRole('button', { name: 'Follow this thread' })).toBeInTheDocument();
    expect(await w.fake.following(w.elsewhere)).toBe(false);
  });

  test('keyboard focus stays on the button while it works and after', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.follow.bind(w.fake);
    w.fake.follow = ((thread: string, on: boolean) => new Promise((done) => { release = () => done(real(thread, on)); })) as unknown as typeof w.fake.follow;
    show(w, w.elsewhere);
    const button = await screen.findByRole('button', { name: 'Follow this thread' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    /* Mid-request the button is busy but not disabled: a disabled button drops focus. */
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await act(async () => { release(); });
    const after = await screen.findByRole('button', { name: 'Unfollow this thread' });
    expect(after).toBe(button);
    expect(after).toHaveFocus();
    expect(after).not.toHaveAttribute('aria-disabled');
  });

  test('a visitor\'s follow is refused as the server refuses it', async () => {
    const w = world();
    w.fake.signInAs(null);
    expect(await w.fake.follow(w.elsewhere, true)).toEqual({ ok: false, error: 'sign in with an account first' });
  });

  test('a thread the player started is followed by default, so it offers Unfollow', async () => {
    const w = world();
    show(w, w.started);
    expect(await screen.findByRole('button', { name: 'Unfollow this thread' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow this thread' })).toBeNull();
  });

  test('the state is the server\'s: a follow chosen elsewhere is shown on opening', async () => {
    const w = world();
    await w.fake.follow(w.elsewhere, true);
    show(w, w.elsewhere);
    expect(await screen.findByRole('button', { name: 'Unfollow this thread' })).toBeInTheDocument();
  });

  test('it is a 2003 board button, the board\'s own plain button and not the glass\'s, outside every post', async () => {
    const w = world();
    show(w, w.elsewhere);
    const button = await screen.findByRole('button', { name: 'Follow this thread' });
    expect(button).toHaveClass('kb-button');
    expect(button.closest('.kb-glass')).toBeNull();
    expect(button).not.toHaveClass('kb-glass-skew', 'kb-glass-button', 'kb-glass-cut-button');
    expect(button.closest('article, .kb-acts')).toBeNull();
    expect(button.closest('[role="group"]')).toHaveAccessibleName('Thread controls');
  });

  test('a refusal leaves the state as the server has it and says so in plain words', async () => {
    const w = world();
    w.fake.follow = (() => ({ ok: false, error: 'there is no such thread' })) as unknown as typeof w.fake.follow;
    show(w, w.elsewhere);
    await userEvent.click(await screen.findByRole('button', { name: 'Follow this thread' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('there is no such thread');
    expect(screen.getByRole('button', { name: 'Follow this thread' })).toBeInTheDocument();
  });

  test('it reads nothing of its own: the state is the document\'s, and only its button asks', async () => {
    const w = world();
    await w.fake.follow(w.elsewhere, true);
    const boot = await w.fake.boot();
    const doc = (await w.fake.threadPage(w.elsewhere, { page: 1 }, 20, []))!;
    const asked = vi.spyOn(w.fake, 'following');
    const read = holdReads(w.fake, ['session', 'here', 'markRead', 'follow']);
    renderIn(w.fake, <ThreadScreen thread={w.elsewhere} doc={doc} />, { path: `/t/${w.elsewhere}`, boot });
    /* In the first render, with no wait: the label the document's state gives. */
    expect(screen.getByRole('button', { name: 'Unfollow this thread' })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(asked).not.toHaveBeenCalled();
    expect(read).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow this thread' }));
    expect(await screen.findByRole('button', { name: 'Follow this thread' })).toBeInTheDocument();
  });
});
