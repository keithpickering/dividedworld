/**
 * One frame for every glass dialog (Frame.tsx; the glass polish plan, "Modals"). jsdom paints nothing, so what the frame is
 * is held two ways: the markup every dialog is rendered through (Overlay and Float, the two things that stand a dialog, each
 * through Frame.tsx's FRAME, DialogBar and CloseCross), and the shell's stylesheet, read as text: the chamfer's size and the
 * border's width are set once (base.css). That no other component or stylesheet, the instance's included, draws a frame of its
 * own is web/src/dialog-frames.test.ts (the engine does not read an instance's files). The computed result, on every real
 * dialog, is e2e/glass-dialogs.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import { Float } from './Float.tsx';
import { FRAME } from './Frame.tsx';
import { Overlay } from './Overlay.tsx';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('the markup: every dialog stands in the one frame', () => {
  test('an overlay is the frame, with its bar and the one Close', () => {
    renderInWorld(<Overlay title="Anything" surface="turn" onClose={() => undefined}><p>Body</p></Overlay>);
    const box = screen.getByRole('dialog');
    for (const c of FRAME.split(' ')) expect(box).toHaveClass(c);
    const bar = box.querySelector('.kb-glass-dialog-bar');
    expect(bar).not.toBeNull();
    const close = bar!.querySelector('button.kb-glass-dialog-close');
    expect(close).not.toBeNull();
    expect(close!.querySelector('.kb-visually-hidden')).toHaveTextContent('Close');
    expect(close).not.toHaveAttribute('data-kb-look');
  });

  test('a float (the Lens) is the same frame', () => {
    const anchor = { current: document.body };
    renderInWorld(<Float label="Cards" surface="effect" anchor={anchor} sheet={false} onClose={() => undefined}><p>Body</p></Float>);
    const box = screen.getByRole('dialog');
    for (const c of FRAME.split(' ')) expect(box).toHaveClass(c);
  });
});

/*
 * The bar writes where it stands when stuck from its holders' padding, which a breakpoint (the root's layout) or a Float's place changes
 * with the bar's own size unchanged. jsdom lays out nothing, so the bar's sticky offset is stubbed, and the padding is the holder's inline style.
 */
describe('the bar re-measures when its holders\' padding changes', () => {
  afterEach(() => { vi.restoreAllMocks(); document.documentElement.removeAttribute('data-kb-layout'); });
  const settle = () => act(() => new Promise<void>((r) => { setTimeout(r, 0); }));
  function stub() {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = real(el, pseudo);
      return el.classList.contains('kb-glass-dialog-bar') ? ({ top: '12px' } as CSSStyleDeclaration) : style;
    });
  }
  test('a padding change on the dialog, the bar unchanged in size, is followed', async () => {
    stub();
    renderInWorld(<Overlay title="Anything" surface="turn" onClose={() => undefined}><p>Body</p></Overlay>);
    const box = screen.getByRole('dialog');
    expect(box.style.getPropertyValue('--kb-dialog-bar-stuck')).toBe('16px');
    box.style.paddingTop = '24px';
    await settle();
    expect(box.style.getPropertyValue('--kb-dialog-bar-stuck')).toBe('40px');
  });
  test('a padding change on the overlay around it is followed', async () => {
    stub();
    renderInWorld(<Overlay title="Anything" surface="turn" onClose={() => undefined}><p>Body</p></Overlay>);
    const around = screen.getByRole('dialog').parentElement!;
    expect(around).toHaveClass('kb-glass-overlay');
    expect(around.style.getPropertyValue('--kb-dialog-bar-stuck')).not.toBe('');
    around.style.paddingTop = '40px';
    await settle();
    expect(around.style.getPropertyValue('--kb-dialog-bar-stuck')).toBe('56px');
  });
  test('a change of the root\'s layout (the breakpoint that swaps the padding) is followed', async () => {
    stub();
    renderInWorld(<Overlay title="Anything" surface="turn" onClose={() => undefined}><p>Body</p></Overlay>);
    const box = screen.getByRole('dialog');
    box.style.paddingTop = '10px';
    document.documentElement.setAttribute('data-kb-layout', 'phone');
    await settle();
    expect(box.style.getPropertyValue('--kb-dialog-bar-stuck')).toBe('26px');
  });
});

describe('the stylesheets: the shell holds the frame', () => {
  test('the shell sets the cut once, to the fifth chamfer, and the border once, 1.5px', () => {
    const base = fs.readFileSync(path.join(root, 'engine/ui/glass/base.css'), 'utf8');
    expect(base).toMatch(/\.kb-glass-cut-dialog \{ --kb-cut: var\(--kb-glass-chamfer-5\); \}/u);
    expect(base).toMatch(/--kb-border: 1\.5px;/u);
  });
});
