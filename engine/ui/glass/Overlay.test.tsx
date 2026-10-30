/**
 * The glass's overlay (the web plan's glass amendment to Task 3): it opens over what it was opened
 * from, dims it, holds focus, closes on Esc and returns focus. It is the board's modal underneath
 * (engine/ui/modal.tsx), so the two share one stack: Esc closes only the top one, and an Esc inside
 * an overlay on a glass page closes the overlay and leaves the page.
 */
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
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

/*
 * Task 2.1: the React picker is the first overlay that opens by what it was opened from. Its board
 * names the dialog more fully than its heading, sets its count in the bar, has no Close in the bar,
 * and stands by the post it reacts to.
 */
describe('a popover overlay (the React picker\'s)', () => {
  function Pop({ anchored = true }: { readonly anchored?: boolean }) {
    const [open, setOpen] = useState(false);
    const row = useRef<HTMLDivElement>(null);
    return (
      <>
        <div ref={row} data-testid="row"><button type="button" onClick={() => setOpen(true)}>React</button></div>
        {open && (
          <Overlay
            title="React" label="React to Spritey's post" surface="react" describedBy="count" closeAt="foot"
            aside={<span id="count">2 of 3 left</span>} anchor={anchored ? row : undefined} onClose={() => setOpen(false)}
          >
            <button type="button">Fire</button>
          </Overlay>
        )}
      </>
    );
  }
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  test('is named by its label where that says more than its title, described by what it names, with its aside in the bar', async () => {
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const dialog = screen.getByRole('dialog', { name: 'React to Spritey\'s post' });
    expect(dialog).toHaveAccessibleDescription('2 of 3 left');
    expect(within(dialog).getByRole('heading', { name: 'React' })).toBeInTheDocument();
    expect(dialog.querySelector('.kb-glass-dialog-bar')).toHaveTextContent(/^React2 of 3 left$/u);
  });

  test('with its Close at the foot, Close comes after the body: Tab reaches it last and comes back round', async () => {
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const dialog = screen.getByRole('dialog', { name: 'React to Spritey\'s post' });
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual(['Fire', 'Close']);
    expect(screen.getByRole('button', { name: 'Fire' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Fire' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  test('opened by an anchor, it stands below it, its left edge at the anchor\'s, inside the window', async () => {
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    vi.spyOn(screen.getByTestId('row'), 'getBoundingClientRect').mockReturnValue(rect(224, 160, 300, 24));
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const dialog = screen.getByRole('dialog', { name: 'React to Spritey\'s post' });
    expect(dialog).toHaveAttribute('data-kb-place', 'below');
    expect(dialog.style.position).toBe('absolute');
    expect(parseFloat(dialog.style.left)).toBe(224);
    expect(parseFloat(dialog.style.top)).toBeGreaterThan(184);
  });

  test('on the Phone board\'s layout it is a sheet above the HUD instead', async () => {
    /* A window narrower than the switch, as useBoard reads it (jsdom answers no media query, which is the Main board's). */
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const dialog = screen.getByRole('dialog', { name: 'React to Spritey\'s post' });
    expect(dialog).toHaveAttribute('data-kb-place', 'sheet');
    expect(dialog.style.top).toBe('');
  });

  test('with no anchor, it stands where every overlay does', async () => {
    renderInWorld(<Pop anchored={false} />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(screen.getByRole('dialog', { name: 'React to Spritey\'s post' })).not.toHaveAttribute('data-kb-place');
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
