/**
 * What a closed overlay, float or modal does (layer.tsx; glass polish design, section 9, "What motion may never do"). The caller wraps the layer
 * in `<Layers>{open && <Overlay />}</Layers>`; at full motion a close keeps React's own tree on the page, `inert` and `aria-hidden` from the
 * render that closes it, while its exit plays, and removes it when the exit ends. Under Off the exit has nothing to play and the layer goes at once.
 * Its own effects (focus back to the opener, the page behind made live again) happen at the start of the close. Motion runs in jsdom on
 * requestAnimationFrame, so the tests look right after the close and then wait for the layer to go.
 */
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Modal } from '../modal.tsx';
import { renderInWorld } from '../test-world.tsx';
import { Float } from './Float.tsx';
import { Layers } from './layer.tsx';
import { Overlay } from './Overlay.tsx';

const root = document.documentElement;
const at = (motion: 'full' | 'reduce') => { root.setAttribute('data-kb-motion', motion); };
beforeEach(() => at('full'));
afterEach(() => { cleanup(); root.removeAttribute('data-kb-motion'); });

const leaving = () => Array.from(document.querySelectorAll<HTMLElement>('[data-kb-exiting]'));
const dialog = (name: string) => screen.queryByRole('dialog', { name, hidden: true });

function Opener({ kind, onClosed }: { readonly kind: 'overlay' | 'float' | 'modal'; readonly onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => { onClosed?.(); setOpen(false); };
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>Open it</button>
      <Layers>
        {open && kind === 'overlay' && <Overlay title="Over" surface="turn" onClose={close}><button type="button">Inside</button></Overlay>}
        {open && kind === 'float' && <Float label="Floating" surface="turn" onClose={close} anchor={opener} sheet={false}><button type="button">Inside</button></Float>}
        {open && kind === 'modal' && <Modal title="Boxed" onClose={close}><button type="button">Inside</button></Modal>}
      </Layers>
    </>
  );
}

const KINDS = [['overlay', 'Over'], ['float', 'Floating'], ['modal', 'Boxed']] as const;

describe.each(KINDS)('a closed %s', (kind, name) => {
  test('at full motion stays on the page, inert and hidden, as the same tree, until its exit ends', async () => {
    renderInWorld(<Opener kind={kind} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    const open = screen.getByRole('dialog', { name });
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    /* The very element that was open, still React's own, held out of every tree from the render that closed it. */
    expect(dialog(name)).toBe(open);
    const layer = open.closest('[data-kb-exiting]');
    expect(layer).not.toBeNull();
    expect(layer).toHaveAttribute('inert');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(leaving()).toHaveLength(1);
    await waitFor(() => expect(dialog(name)).toBeNull(), { timeout: 3000 });
    expect(leaving()).toHaveLength(0);
  });

  test('under Off is removed at once', async () => {
    at('reduce');
    renderInWorld(<Opener kind={kind} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(dialog(name)).toBeNull();
    expect(leaving()).toHaveLength(0);
  });

  test('gives focus back to its opener at the start of the close, not at the end of the exit', async () => {
    renderInWorld(<Opener kind={kind} />, { path: '/characters' });
    const open = screen.getByRole('button', { name: 'Open it' });
    await userEvent.click(open);
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(leaving()).toHaveLength(1);
    expect(open).toHaveFocus();
    await waitFor(() => expect(dialog(name)).toBeNull(), { timeout: 3000 });
  });
});

describe('a modal layer that is leaving', () => {
  test.each([['overlay'], ['modal']] as const)('a %s answers no Esc, and the page behind is live again', async (kind) => {
    const closed = vi.fn();
    renderInWorld(<Opener kind={kind} onClosed={closed} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(leaving()).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(closed).toHaveBeenCalledTimes(1);
    /* Nothing behind it is inert but the leaving layer itself. */
    expect(screen.getByRole('button', { name: 'Open it' }).closest('[inert]')).toBeNull();
    await waitFor(() => expect(leaving()).toHaveLength(0), { timeout: 3000 });
  });
});

describe('a layer mounted without the wrapper', () => {
  test('is present, and is removed at once when its caller removes it', async () => {
    function Bare() {
      const [open, setOpen] = useState(true);
      return <>{open && <Overlay title="Bare" surface="turn" onClose={() => setOpen(false)}>x</Overlay>}</>;
    }
    renderInWorld(<Bare />, { path: '/characters' });
    expect(screen.getByRole('dialog', { name: 'Bare' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(dialog('Bare')).toBeNull();
  });
});

describe('a modal opened as another closes', () => {
  test('does not take an opener inside the layer that is leaving: focus goes to its fallback', async () => {
    function Swap() {
      const [which, setWhich] = useState<'a' | 'b' | null>(null);
      return (
        <>
          <button type="button" onClick={() => setWhich('a')}>Open A</button>
          <button type="button">Fallback</button>
          <Layers>
            {which === 'a' && <Modal key="a" title="Alpha" onClose={() => setWhich(null)}><button type="button" onClick={() => setWhich('b')}>Swap to B</button></Modal>}
            {which === 'b' && <Modal key="b" title="Beta" onClose={() => setWhich(null)} returnFocusTo={() => screen.getByRole('button', { name: 'Fallback' })}>b</Modal>}
          </Layers>
        </>
      );
    }
    renderInWorld(<Swap />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Swap to B' }));
    await act(async () => {});
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog('Beta')).toBeNull(), { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();
  });
});

describe('a layer\'s exit origin', () => {
  test('is measured again at the start of the close, from where the anchor stands then', async () => {
    let anchorLeft = 10;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const isAnchor = this.tagName === 'BUTTON' && this.textContent === 'Open it';
      const left = isAnchor ? anchorLeft : 0;
      const [width, height] = isAnchor ? [20, 20] : [200, 100];
      return { left, top: 0, right: left + width, bottom: height, width, height, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      renderInWorld(<Opener kind="float" />, { path: '/characters' });
      await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
      const originOf = (root: Element) => [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].map((e) => (e as HTMLElement).style.transformOrigin).find((o) => o) ?? '';
      const open = originOf(screen.getByRole('dialog', { name: 'Floating' }).closest('[class]')!.parentElement!);
      anchorLeft = 300;
      await userEvent.keyboard('{Escape}');
      await act(async () => {});
      const layer = leaving()[0]!;
      expect(open).not.toBe('');
      expect(originOf(layer)).toBe('310px 10px');
      expect(originOf(layer)).not.toBe(open);
      await waitFor(() => expect(leaving()).toHaveLength(0), { timeout: 3000 });
    } finally { spy.mockRestore(); }
  });
});

