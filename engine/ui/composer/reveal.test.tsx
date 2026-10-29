import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openThread, replyBox, threadWorld } from './support.tsx';

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* The composer's menu entry for the class reveal (Task 9): the dialog itself is tested with My characters. */
describe('Reveal… in the composer', () => {
  test('is beside Send, names the HUD\'s character\'s class, and reveals it in this thread', async () => {
    const w = threadWorld();
    const unmask = vi.spyOn(w.fake, 'unmask');
    openThread(w);
    await replyBox();
    await userEvent.click(screen.getByRole('button', { name: 'Reveal…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reveal Pipewrench\'s class' });
    expect(within(dialog).getByText(/Pipewrench is a Heel/u)).toBeInTheDocument();
    expect(within(dialog).getByText(/this can.t be taken back/iu)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Board')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reveal Pipewrench as a Heel' }));
    await waitFor(() => expect(unmask).toHaveBeenCalledWith(w.pipe, w.thread, ''));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Reveal…' })).toHaveFocus();
  });

  test('confirming it does not also send the reply being written', async () => {
    const w = threadWorld();
    const post = vi.spyOn(w.fake, 'post');
    openThread(w);
    await userEvent.click(await replyBox());
    await userEvent.paste('A half-written reply.');
    await userEvent.click(screen.getByRole('button', { name: 'Reveal…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Reveal Pipewrench as/u }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).not.toHaveBeenCalled();
    expect(await replyBox()).toHaveValue('A half-written reply.');
  });

  test('Esc closes it without revealing anything', async () => {
    const w = threadWorld();
    const unmask = vi.spyOn(w.fake, 'unmask');
    openThread(w);
    await replyBox();
    await userEvent.click(screen.getByRole('button', { name: 'Reveal…' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(unmask).not.toHaveBeenCalled();
  });
});
