/**
 * The glass's overlay (the web plan's glass amendment to Task 3): it opens over what it was opened
 * from, dims it, holds focus, closes on Esc and returns focus. It is the board's modal underneath
 * (engine/ui/modal.tsx), so the two share one stack: Esc closes only the top one, and an Esc inside
 * an overlay on a glass page closes the overlay and leaves the page.
 */
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

describe('over a glass page (the web plan\'s 2026-10-30 amendment to Task 9)', () => {
  /* jsdom lays nothing out: the menu bar's box is given, the board's 84px at the top or scrolled away. */
  const boxAt = (top: number) => () => ({ x: 0, y: top, top, left: 0, right: 1440, bottom: top + 84, width: 1440, height: 84, toJSON: () => ({}) });
  const overlayOf = (name: string) => screen.getByRole('dialog', { name }).closest<HTMLElement>('.kb-glass-overlay')!;

  test('leaves the menu bar in view, dimmed and inert, and starts under it; Esc gives the page back as it was', async () => {
    renderInWorld(<Page surface="characters"><Opener /></Page>, { path: '/characters', seed: signedIn });
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    menu.getBoundingClientRect = boxAt(0);
    const turn = screen.getByRole('button', { name: 'Turn' });
    await userEvent.click(turn);
    expect(overlayOf('Turn Pipewrench').style.getPropertyValue('--kb-glass-overlay-top')).toBe('84px');
    expect(menu.closest('[inert]')).not.toBeNull();
    expect(menu).toHaveAttribute('data-kb-dimmed');
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menu.closest('[inert]')).toBeNull();
    expect(menu).not.toHaveAttribute('data-kb-dimmed');
    expect(turn).toHaveFocus();
  });
  test('a menu bar scrolled out of view is not made room for: the overlay covers the window', async () => {
    renderInWorld(<Page surface="characters"><Opener /></Page>, { path: '/characters', seed: signedIn });
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    menu.getBoundingClientRect = boxAt(-400);
    await userEvent.click(screen.getByRole('button', { name: 'Turn' }));
    expect(overlayOf('Turn Pipewrench').style.getPropertyValue('--kb-glass-overlay-top')).toBe('0px');
  });
  test('on the board, with no menu bar, the overlay covers the window', async () => {
    renderInWorld(<Opener />, { path: '/characters', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'Turn' }));
    expect(overlayOf('Turn Pipewrench').style.getPropertyValue('--kb-glass-overlay-top')).toBe('0px');
  });

  test('two stacked: the menu bar stays dimmed and inert until the last one closes', async () => {
    function Stacked() {
      const [open, setOpen] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setOpen(1)}>Open</button>
          {open >= 1 && (
            <Overlay title="First" surface="turn" onClose={() => setOpen(0)}>
              <button type="button" onClick={() => setOpen(2)}>Open the second</button>
              {open >= 2 && <Overlay title="Second" surface="turn" onClose={() => setOpen(1)}><button type="button">Inside</button></Overlay>}
            </Overlay>
          )}
        </>
      );
    }
    renderInWorld(<Page surface="characters"><Stacked /></Page>, { path: '/characters', seed: signedIn });
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open the second' }));
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog', { name: 'Second' })).toBeNull();
    expect(menu).toHaveAttribute('data-kb-dimmed');
    expect(menu.closest('[inert]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menu).not.toHaveAttribute('data-kb-dimmed');
    expect(menu.closest('[inert]')).toBeNull();
  });

  test('one that goes without closing (its page moved on under it) leaves the menu bar lit', async () => {
    let hide: () => void = () => {};
    function Gone() {
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return shown ? <Overlay title="Gone" surface="turn" onClose={() => {}}><button type="button">Inside</button></Overlay> : null;
    }
    renderInWorld(<Page surface="characters"><Gone /></Page>, { path: '/characters', seed: signedIn });
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    expect(menu).toHaveAttribute('data-kb-dimmed');
    act(() => hide());
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menu).not.toHaveAttribute('data-kb-dimmed');
    expect(menu.closest('[inert]')).toBeNull();
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
            title="React" label="React to Alex's post" surface="react" describedBy="count" closeAt="foot"
            aside={<span id="count">2 of 3 left</span>} anchor={anchored ? row : undefined} sheetBelow={572} onClose={() => setOpen(false)}
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
    const dialog = screen.getByRole('dialog', { name: 'React to Alex\'s post' });
    expect(dialog).toHaveAccessibleDescription('2 of 3 left');
    expect(within(dialog).getByRole('heading', { name: 'React' })).toBeInTheDocument();
    expect(dialog.querySelector('.kb-glass-dialog-bar')).toHaveTextContent(/^React2 of 3 left$/u);
  });

  test('with its Close at the foot, Close comes after the body: Tab reaches it last and comes back round', async () => {
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const dialog = screen.getByRole('dialog', { name: 'React to Alex\'s post' });
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
    const dialog = screen.getByRole('dialog', { name: 'React to Alex\'s post' });
    expect(dialog).toHaveAttribute('data-kb-place', 'below');
    expect(dialog.style.position).toBe('absolute');
    expect(parseFloat(dialog.style.left)).toBe(224);
    expect(parseFloat(dialog.style.top)).toBeGreaterThan(184);
  });

  test('in a window narrower than the room its popover needs, it is a sheet above the HUD instead', async () => {
    vi.stubGlobal('innerWidth', 571);
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    const dialog = screen.getByRole('dialog', { name: 'React to Alex\'s post' });
    expect(dialog).toHaveAttribute('data-kb-place', 'sheet');
    expect(dialog.style.top).toBe('');
  });

  test('in a window just as wide as that room, and below the boards\' switch, it is still the popover', async () => {
    vi.stubGlobal('innerWidth', 572);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
    renderInWorld(<Pop />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(screen.getByRole('dialog', { name: 'React to Alex\'s post' })).toHaveAttribute('data-kb-place', 'below');
  });

  test('with no anchor, it stands where every overlay does', async () => {
    renderInWorld(<Pop anchored={false} />, { path: '/t/1', seed: signedIn });
    await userEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(screen.getByRole('dialog', { name: 'React to Alex\'s post' })).not.toHaveAttribute('data-kb-place');
  });
});

/*
 * Where an anchored overlay stands, with the page's geometry stubbed (jsdom lays nothing out): the
 * anchor's box, the HUD's, the dialog's own size, and the window. The dialog is 540 by 452 as a
 * popover and the window's width as a sheet, as the React picker is.
 */
describe('placing a popover overlay', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const geo: { anchor: DOMRect; hud: DOMRect | null; height: number } = { anchor: rect(0, 0, 0, 0), hud: null, height: 452 };
  const observers: { cb: ResizeObserverCallback }[] = [];
  let anchorReads = 0;

  function Placed() {
    const [open, setOpen] = useState(false);
    const row = useRef<HTMLDivElement>(null);
    return (
      <>
        <div ref={row} data-testid="row"><button type="button" onClick={() => setOpen(true)}>React</button></div>
        <div className="kb-hud" />
        {open && <Overlay title="React" label="React to Alex's post" surface="react" anchor={row} sheetBelow={572} onClose={() => setOpen(false)}><button type="button">Fire</button></Overlay>}
      </>
    );
  }
  function windowOf(width: number, height: number) {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
  }
  beforeEach(() => {
    geo.anchor = rect(224, 160, 300, 24);
    geo.hud = null;
    geo.height = 452;
    anchorReads = 0;
    observers.length = 0;
    windowOf(900, 700);
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: ResizeObserverCallback) { observers.push({ cb }); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'row') { anchorReads += 1; return geo.anchor; }
      if (this.classList.contains('kb-hud')) return geo.hud ?? rect(0, 0, 0, 0);
      if (this.getAttribute('role') === 'dialog') {
        return this.getAttribute('data-kb-place') === 'sheet' ? rect(0, 0, window.innerWidth, geo.height + 200) : rect(0, 0, 540, geo.height);
      }
      return rect(0, 0, 0, 0);
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const dialog = () => screen.getByRole('dialog', { name: 'React to Alex\'s post' });
  const openIt = async () => { renderInWorld(<Placed />, { path: '/t/1', seed: signedIn }); await userEvent.click(screen.getByRole('button', { name: 'React' })); return dialog(); };
  const frame = () => act(() => new Promise<void>((r) => { requestAnimationFrame(() => r()); }));
  const px = (v: string) => parseFloat(v);

  test('stands 30px below its anchor, its left edge at the anchor\'s', async () => {
    const d = await openIt();
    expect(d).toHaveAttribute('data-kb-place', 'below');
    expect(px(d.style.top)).toBe(184 + 30);
    expect(px(d.style.left)).toBe(224);
  });

  test('is pulled back inside the window\'s right edge', async () => {
    geo.anchor = rect(600, 160, 100, 24);
    const d = await openIt();
    expect(px(d.style.left)).toBe(900 - 4 - 540);
  });

  test('stands above its anchor where below would run under the HUD', async () => {
    windowOf(900, 800);
    geo.hud = rect(0, 700, 900, 100);
    geo.anchor = rect(100, 600, 300, 20);
    const d = await openIt();
    expect(d).toHaveAttribute('data-kb-place', 'above');
    expect(px(d.style.top)).toBe(600 - 30 - 452);
    expect(d.style.maxHeight).toBe('');
  });

  test('is capped to the roomier side\'s height where neither side holds it', async () => {
    geo.hud = rect(0, 500, 900, 200);
    geo.anchor = rect(100, 200, 300, 20);
    const d = await openIt();
    expect(d).toHaveAttribute('data-kb-place', 'below');
    expect(px(d.style.top)).toBe(220 + 30);
    expect(px(d.style.maxHeight)).toBe(500 - 220 - 30 - 4);
  });

  test('as a sheet, its bottom edge is the HUD\'s top edge', async () => {
    windowOf(400, 844);
    geo.hud = rect(0, 700, 400, 144);
    const d = await openIt();
    expect(d).toHaveAttribute('data-kb-place', 'sheet');
    expect(d.style.bottom).toBe('144px');
    expect(d.style.maxHeight).toBe(`${700 - 4}px`);
  });

  test('a HUD that is not laid out (no height) is no HUD: the sheet stands on the window\'s foot', async () => {
    windowOf(400, 844);
    geo.hud = rect(0, 0, 0, 0);
    const d = await openIt();
    expect(d.style.bottom).toBe('0px');
    expect(d.style.maxHeight).toBe(`${844 - 4}px`);
  });

  test('one resize from a sheet\'s width to a popover\'s is measured as a popover, not the sheet it was', async () => {
    windowOf(500, 700);
    geo.anchor = rect(100, 160, 300, 24);
    const d = await openIt();
    expect(d).toHaveAttribute('data-kb-place', 'sheet');
    windowOf(700, 700);
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(d).toHaveAttribute('data-kb-place', 'below');
    expect(px(d.style.left)).toBe(100);
    expect(d.style.bottom).toBe('');
  });

  test('the page\'s scrolling places it again, once a frame however many scroll events the frame brings', async () => {
    const d = await openIt();
    const reads = anchorReads;
    geo.anchor = rect(224, 100, 300, 24);
    for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('scroll'));
    expect(anchorReads).toBe(reads);
    await frame();
    expect(anchorReads).toBe(reads + 1);
    expect(px(d.style.top)).toBe(124 + 30);
  });

  test('a height-capped popover keeps where it was scrolled to when it is placed again', async () => {
    geo.hud = rect(0, 500, 900, 200);
    geo.anchor = rect(100, 200, 300, 20);
    const d = await openIt();
    expect(d.style.maxHeight).not.toBe('');
    /* As a browser does: the box loses its scroll when it stops being a scroller, which it does while it has no placement (shell.css's overflow is the placement's). */
    let scrolled = 0;
    Object.defineProperty(d, 'scrollTop', { configurable: true, get: () => scrolled, set: (v: number) => { scrolled = v; } });
    const remove = d.removeAttribute.bind(d);
    d.removeAttribute = (name: string) => { if (name === 'data-kb-place') scrolled = 0; remove(name); };
    d.scrollTop = 120;
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(d).toHaveAttribute('data-kb-place', 'below');
    expect(d.scrollTop).toBe(120);
  });

  test('its own content growing or shrinking places it again', async () => {
    windowOf(900, 800);
    geo.hud = rect(0, 700, 900, 100);
    geo.anchor = rect(100, 600, 300, 20);
    const d = await openIt();
    expect(px(d.style.top)).toBe(600 - 30 - 452);
    geo.height = 300;
    expect(observers.length).toBeGreaterThan(0);
    act(() => { for (const o of observers) o.cb([], {} as ResizeObserver); });
    await frame();
    expect(px(d.style.top)).toBe(600 - 30 - 300);
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
  test('an overlay that is not to be dismissed (closeAt none) has no Close, and Esc asks its owner, who decides', async () => {
    const asked = vi.fn();
    renderInWorld(
      <Overlay title="Held" surface="effect" closeAt="none" onClose={asked}><button type="button">Only way out</button></Overlay>,
      { path: '/characters', seed: signedIn },
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Only way out' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(asked).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Held' })).toBeInTheDocument();
  });
});
