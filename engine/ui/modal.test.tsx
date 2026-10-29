import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Modal } from './modal.tsx';

afterEach(cleanup);

function Host({ onClose = () => {}, fallback }: { readonly onClose?: () => void; readonly fallback?: () => HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <div>
      {!gone && <button type="button" onClick={() => setOpen(true)}>Open it</button>}
      <p id="elsewhere"><a href="#x">Outside link</a></p>
      {open && (
        <Modal title="Turn Pipewrench" onClose={() => { onClose(); setOpen(false); }} returnFocusTo={fallback}>
          <label>Name <input /></label>
          <button type="button">Middle</button>
          <button type="button" onClick={() => setGone(true)}>Remove opener</button>
          <button type="button">Last</button>
        </Modal>
      )}
    </div>
  );
}

const opener = () => screen.getByRole('button', { name: 'Open it' });

describe('the modal', () => {
  test('is a dialog named by its title, and moves focus inside when it opens', async () => {
    render(<Host />);
    await userEvent.click(opener());
    const dialog = screen.getByRole('dialog', { name: 'Turn Pipewrench' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  test('holds Tab and Shift+Tab inside: the last control wraps to the first and back', async () => {
    render(<Host />);
    await userEvent.click(opener());
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  test('pulls focus back in if it somehow lands outside', async () => {
    render(<Host />);
    await userEvent.click(opener());
    screen.getByRole('link', { name: 'Outside link' }).focus();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  test('closes on Esc and returns focus to the button that opened it', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(opener());
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  test('closes from its Close button, and from a press on the dimmed page', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(opener());
    await userEvent.click(document.querySelector('.kb-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('a press inside the box does not close it', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Middle' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('when the opener is gone by the time it closes, focus goes to the place the screen names', async () => {
    render(<Host fallback={() => document.querySelector<HTMLElement>('#elsewhere a')} />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(opener());
    await userEvent.click(opener());
    // The opener is removed while the dialog is open (a row that changed under it).
    await userEvent.click(screen.getByRole('button', { name: 'Remove opener' }));
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Outside link' }));
  });
});
