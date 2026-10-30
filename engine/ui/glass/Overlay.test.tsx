/**
 * The glass's overlay (the web plan's glass amendment to Task 3): it opens over what it was opened
 * from, dims it, holds focus, closes on Esc and returns focus. It is the board's modal underneath
 * (engine/ui/modal.tsx), so the two share one stack: Esc closes only the top one, and an Esc inside
 * an overlay on a glass page closes the overlay and leaves the page.
 */
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { Modal } from '../modal.tsx';
import { renderInWorld } from '../test-world.tsx';
import { Overlay } from './Overlay.tsx';
import { Page } from './Page.tsx';

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));

function Opener({ inModal = false }: { readonly inModal?: boolean }) {
  const [open, setOpen] = useState(false);
  const overlay = open && (
    <Overlay title="Turn Pipewrench" surface="turn" onClose={() => setOpen(false)}>
      <button type="button">Confirm the Turn</button>
    </Overlay>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Turn</button>
      {inModal ? <Modal title="A dialog" onClose={() => {}}><button type="button" onClick={() => setOpen(true)}>Open over</button>{overlay}</Modal> : overlay}
    </>
  );
}

afterEach(cleanup);

describe('the overlay', () => {
  test('is a dialog named by its title, over its own smoke, with focus inside', async () => {
    renderInWorld(<Opener />, { path: '/characters', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'Turn' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn Pipewrench' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.querySelector('.kb-smoke')).toHaveAttribute('data-kb-surface', 'turn');
    expect(screen.getByRole('button', { name: 'Confirm the Turn' })).toHaveFocus();
  });
  test('Esc inside an overlay on a glass page closes the overlay and leaves the page, focus returned', async () => {
    renderInWorld(<Page surface="characters"><Opener /></Page>, { path: '/characters', seed: signedIn });
    const turn = await screen.findByRole('button', { name: 'Turn' });
    await userEvent.click(turn);
    expect(screen.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: 'Turn Pipewrench' })).toBeNull();
    expect(window.location.pathname).toBe('/characters');
    expect(turn).toHaveFocus();
  });
  test('the page behind is inert while it is open, and its Close closes it', async () => {
    const { container } = renderInWorld(<Opener />, { path: '/characters', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'Turn' }));
    expect(container).toHaveAttribute('inert');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container).not.toHaveAttribute('inert');
  });
  test('over a board modal, it is the top of the one stack: Esc closes it and leaves the modal', async () => {
    renderInWorld(<Opener inModal />, { path: '/characters', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'Open over' }));
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: 'Turn Pipewrench' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'A dialog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open over' })).toHaveFocus();
  });
});

describe('from the Task 1.4 reviews', () => {
  function Twice() {
    const [open, setOpen] = useState(0);
    return (
      <>
        <button type="button" onClick={() => setOpen(1)}>Open</button>
        {open >= 1 && (
          <Overlay title="First" surface="turn" onClose={() => setOpen(0)}>
            <button type="button" onClick={() => setOpen(2)}>Open the second</button>
            {open >= 2 && <Overlay title="Second" surface="effect" onClose={() => setOpen(1)}><button type="button">Inside</button></Overlay>}
          </Overlay>
        )}
      </>
    );
  }
  test('an overlay over an overlay: Esc closes the top one, then the next, and the page is clean after', async () => {
    const { container } = renderInWorld(<Twice />, { path: '/characters', seed: signedIn });
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Open the second' }));
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'First' }).closest('.kb-glass-overlay')).toHaveAttribute('inert');
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: 'Second' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'First' }).closest('.kb-glass-overlay')).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Open the second' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container).not.toHaveAttribute('inert');
    expect([...document.body.children].filter((el) => el.hasAttribute('inert'))).toEqual([]);
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });
});
