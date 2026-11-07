/**
 * What a closed overlay, float or modal does (lift.ts; glass polish design, section 9, "What motion may never do"). At full motion a close
 * plays its exit on a copy that is `inert` and `aria-hidden` from the first frame and goes when the exit ends; under Off nothing is left.
 * The live element's own close (focus back to the opener, the page behind live again) happens at once, at the start of the close. Motion
 * runs in jsdom on requestAnimationFrame, so the tests look right after the close and then wait for the copy to go.
 */
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Modal } from '../modal.tsx';
import { renderInWorld } from '../test-world.tsx';
import { Float } from './Float.tsx';
import { Overlay } from './Overlay.tsx';

const root = document.documentElement;
const at = (motion: 'full' | 'reduce') => { root.setAttribute('data-kb-motion', motion); };
beforeEach(() => at('full'));
afterEach(() => { cleanup(); root.removeAttribute('data-kb-motion'); });

const copies = () => Array.from(document.querySelectorAll<HTMLElement>('[data-kb-exiting]'));

function Opener({ kind }: { readonly kind: 'overlay' | 'float' | 'modal' }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>Open it</button>
      {open && kind === 'overlay' && <Overlay title="Over" surface="turn" onClose={close}><button type="button">Inside</button></Overlay>}
      {open && kind === 'float' && <Float label="Floating" surface="turn" onClose={close} anchor={opener} sheet={false}><button type="button">Inside</button></Float>}
      {open && kind === 'modal' && <Modal title="Boxed" onClose={close}><button type="button">Inside</button></Modal>}
    </>
  );
}

const KINDS = [['overlay', 'Over'], ['float', 'Floating'], ['modal', 'Boxed']] as const;

describe.each(KINDS)('a closed %s', (kind, name) => {
  test('at full motion is inert and hidden from the first frame of its exit, and goes when the exit ends', async () => {
    renderInWorld(<Opener kind={kind} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(screen.getByRole('dialog', { name })).toBeInTheDocument();
    /* Escape closes the overlay and the modal; the float closes by the same Esc through its own listener. */
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    /* The live dialog is gone for a reader and a test, and a copy stands in its place, held out of every tree. */
    expect(screen.queryByRole('dialog', { name })).toBeNull();
    const [copy, ...rest] = copies();
    expect(rest).toHaveLength(0);
    expect(copy).toBeDefined();
    expect(copy).toHaveAttribute('inert');
    expect(copy).toHaveAttribute('aria-hidden', 'true');
    expect(copy!.querySelector('[id]')).toBeNull();
    await waitFor(() => expect(copies()).toHaveLength(0), { timeout: 3000 });
  });

  test('under Off leaves nothing at all', async () => {
    at('reduce');
    renderInWorld(<Opener kind={kind} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name })).toBeNull();
    expect(copies()).toHaveLength(0);
  });

  test('gives focus back to its opener at the start of the close, not at the end of the exit', async () => {
    renderInWorld(<Opener kind={kind} />, { path: '/characters' });
    const open = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(open);
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(copies()).toHaveLength(1);
    expect(open).toHaveFocus();
    await waitFor(() => expect(copies()).toHaveLength(0), { timeout: 3000 });
  });
});
