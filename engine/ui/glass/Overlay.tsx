/**
 * The glass's overlay (the web plan's glass amendment to Task 3): a dialog over the page it was
 * opened from, on its own surface's smoke, with the page dimmed and inert behind it. It is the
 * board's modal layer underneath (useModalLayer, engine/ui/modal.tsx): focus moves inside when it
 * opens, Tab is held inside, Esc and a press on the dimmed page close it, and focus returns to the
 * control that opened it. The two kinds share one stack, so Esc closes only the top one, and an Esc
 * an overlay answers never reaches the glass page's Back (MenuBar.tsx).
 *
 * Most overlays stand in the middle of the window. One opened by a part of the page it belongs to
 * (the React picker, by its post's reactions) is given that part as its `anchor`: on the Main
 * board's layout it stands below the anchor, its left edge at the anchor's, or above it where below
 * would run under the HUD, kept inside the window (place.ts); on the Phone board's layout it is a
 * sheet the width of the window, standing on the HUD's top edge. It is placed as it opens and again
 * when the window resizes or the page under it scrolls.
 */
import { useId, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../modal.tsx';
import type { GlassSurface } from '../types.ts';
import { placePopover } from './place.ts';
import { useBoard } from './useBoard.ts';
import type { BoardLayout } from './board.ts';
import { Smoke, useSurfaceStyle } from './Smoke.tsx';
import './shell.css';

export interface OverlayProps {
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Whose smoke the overlay's panel stands on. */
  readonly surface: GlassSurface;
  /** Where focus goes on close when the control that opened the overlay is no longer on the page. */
  readonly returnFocusTo?: () => HTMLElement | null;
  /** The dialog's name where it says more than the title shown (the React picker's "React to Spritey's post", headed "React"). */
  readonly label?: string;
  /** The id of what describes the dialog (the picker's count of what is left). */
  readonly describedBy?: string;
  /** Set in the bar after the title. */
  readonly aside?: ReactNode;
  /** Where Close stands: in the bar (the default), or after the body, last in the order Tab goes. */
  readonly closeAt?: 'bar' | 'foot';
  /** The part of the page the overlay opens by, as a popover; with none it stands in the middle of the window. */
  readonly anchor?: RefObject<HTMLElement | null>;
  /** The dialog's own class, for its size and its parts. */
  readonly className?: string;
}

/** The room kept between the anchor and the overlay, and between the overlay and the window's edges. */
const GAP = 30;
const MARGIN = 4;

/** Places `box` by `anchor`, as the module comment says; returns the side it took. */
function place(box: HTMLElement, anchor: HTMLElement, board: BoardLayout['board']): 'below' | 'above' | 'sheet' {
  for (const k of ['top', 'left', 'bottom', 'maxHeight', 'maxWidth'] as const) box.style[k] = '';
  const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
  const hud = document.querySelector('.kb-hud')?.getBoundingClientRect().top;
  const hudTop = Math.min(hud ?? viewport.height, viewport.height);
  if (board === 'phone') {
    box.style.bottom = `${Math.max(0, viewport.height - hudTop)}px`;
    box.style.maxHeight = `${Math.max(0, hudTop - MARGIN)}px`;
    return 'sheet';
  }
  const a = anchor.getBoundingClientRect();
  const r = box.getBoundingClientRect();
  /* Placed against the window itself: the anchor's left edge is where the overlay starts. */
  const at = { left: a.left, top: 0, right: a.right, bottom: 0 };
  const p = placePopover({
    button: a, container: at, size: { width: r.width, height: box.scrollHeight + (r.height - box.clientHeight) },
    viewport, hudTop, gap: GAP, margin: MARGIN,
  });
  box.style.top = `${p.top}px`;
  box.style.left = `${p.left + a.left}px`;
  box.style.maxWidth = `${p.maxWidth}px`;
  if (p.maxHeight !== null) box.style.maxHeight = `${p.maxHeight}px`;
  return p.side;
}

export function Overlay({ title, onClose, children, surface, returnFocusTo, label, describedBy, aside, closeAt = 'bar', anchor, className }: OverlayProps) {
  const id = useId();
  const { overlay, box, closeButton } = useModalLayer({ onClose, returnFocusTo });
  const calm = useSurfaceStyle(surface);
  const { board } = useBoard();

  useLayoutEffect(() => {
    const el = box.current;
    if (!anchor || !el) return;
    const again = () => {
      const target = anchor.current;
      if (target) el.setAttribute('data-kb-place', place(el, target, board));
    };
    again();
    window.addEventListener('resize', again);
    /* The page scrolling moves the anchor; the overlay's own scrolling is no reason to place it again. */
    const onScroll = (e: Event) => { if (e.target !== el) again(); };
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', again); window.removeEventListener('scroll', onScroll, true); };
  }, [anchor, box, board]);

  const close = <button ref={closeButton} type="button" className="kb-glass-dialog-close kb-glass-cut-button" onClick={onClose}>Close</button>;
  return createPortal(
    <div
      ref={overlay} className="kb-glass kb-glass-overlay" data-kb-anchored={anchor ? '' : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={box} className={`kb-glass-dialog kb-glass-cut-dialog${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true"
        aria-labelledby={label === undefined ? id : undefined} aria-label={label} aria-describedby={describedBy} tabIndex={-1}
        style={{ ...calm, ...(anchor ? { position: 'absolute' } : {}) }}
      >
        <Smoke surface={surface} />
        <div className="kb-glass-dialog-bar">
          <h2 id={id} className="kb-glass-dialog-head kb-glass-display">{title}</h2>
          {aside}
          {closeAt === 'bar' && close}
        </div>
        <div className="kb-glass-dialog-body">{children}</div>
        {closeAt === 'foot' && <div className="kb-glass-dialog-foot">{close}</div>}
      </div>
    </div>,
    document.body,
  );
}
