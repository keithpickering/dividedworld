/**
 * The glass's overlay (the web plan's glass amendment to Task 3): a dialog over the page it was
 * opened from, on its own surface's smoke, with the page dimmed and inert behind it. It is the
 * board's modal layer underneath (useModalLayer, engine/ui/modal.tsx): focus moves inside when it
 * opens, Tab is held inside, Esc and a press on the dimmed page close it, and focus returns to the
 * control that opened it. The two kinds share one stack, so Esc closes only the top one, and an Esc
 * an overlay answers never reaches the glass page's Back (MenuBar.tsx).
 *
 * Over a glass page it leaves the menu bar in view (the web plan's 2026-10-30 amendment to Task 9;
 * the Turn board draws it so): the overlay starts under the bar's foot, and the bar is dimmed
 * (`data-kb-dimmed`, shell.css) and inert with the rest of the page, so the player sees where
 * Close and Esc put them and cannot reach it until they do. A bar scrolled out of the window is not
 * made room for. Nested overlays share one dimming: the bar is lit again when the last one closes.
 */
import { useId, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../modal.tsx';
import type { GlassSurface } from '../types.ts';
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
  /** A line over the title that says where the overlay is ("My characters › Turn"); not part of its name. */
  readonly kicker?: ReactNode;
  /** The dialog's own class, for an overlay laid out as its board draws it. */
  readonly className?: string;
}

/* The overlays open now, so the menu bar is dimmed while any is and lit when the last one closes. */
const open = new Set<object>();

const menuBar = () => document.querySelector<HTMLElement>('.kb-glass-page .kb-glass-menu');

/** How far down the window the overlay starts: under the menu bar's foot while any of the bar is in view, else at the top. */
function overlayTop(): number {
  const bar = menuBar()?.getBoundingClientRect();
  return bar && bar.bottom > 0 ? Math.round(bar.bottom) : 0;
}

export function Overlay({ title, onClose, children, surface, returnFocusTo, kicker, className }: OverlayProps) {
  const id = useId();
  const { overlay, box, closeButton } = useModalLayer({ onClose, returnFocusTo });
  const calm = useSurfaceStyle(surface);

  useLayoutEffect(() => {
    const self = {};
    open.add(self);
    const place = () => overlay.current?.style.setProperty('--kb-glass-overlay-top', `${overlayTop()}px`);
    place();
    menuBar()?.setAttribute('data-kb-dimmed', '');
    globalThis.addEventListener('resize', place);
    return () => {
      globalThis.removeEventListener('resize', place);
      open.delete(self);
      if (open.size === 0) menuBar()?.removeAttribute('data-kb-dimmed');
    };
  }, []);

  return createPortal(
    <div ref={overlay} className="kb-glass kb-glass-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`kb-glass-dialog kb-glass-cut-dialog${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} style={calm}>
        <Smoke surface={surface} />
        <div className="kb-glass-dialog-bar">
          <div className="kb-glass-dialog-titles">
            {kicker && <p className="kb-glass-dialog-kicker">{kicker}</p>}
            <h2 id={id} className="kb-glass-dialog-head kb-glass-display">{title}</h2>
          </div>
          <button ref={closeButton} type="button" className="kb-glass-dialog-close kb-glass-cut-button" onClick={onClose}>Close</button>
        </div>
        <div className="kb-glass-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
