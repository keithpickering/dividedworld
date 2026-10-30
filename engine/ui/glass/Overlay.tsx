/**
 * The glass's overlay (the web plan's glass amendment to Task 3): a dialog over the page it was
 * opened from, on its own surface's smoke, with the page dimmed and inert behind it. It is the
 * board's modal layer underneath (useModalLayer, engine/ui/modal.tsx): focus moves inside when it
 * opens, Tab is held inside, Esc and a press on the dimmed page close it, and focus returns to the
 * control that opened it. The two kinds share one stack, so Esc closes only the top one, and an Esc
 * an overlay answers never reaches the glass page's Back (MenuBar.tsx).
 */
import { useId, type ReactNode } from 'react';
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
}

export function Overlay({ title, onClose, children, surface, returnFocusTo }: OverlayProps) {
  const id = useId();
  const { overlay, box, closeButton } = useModalLayer({ onClose, returnFocusTo });
  const calm = useSurfaceStyle(surface);
  return createPortal(
    <div ref={overlay} className="kb-glass kb-glass-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="kb-glass-dialog kb-glass-cut-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} style={calm}>
        <Smoke surface={surface} />
        <div className="kb-glass-dialog-bar">
          <h2 id={id} className="kb-glass-dialog-head kb-glass-display">{title}</h2>
          <button ref={closeButton} type="button" className="kb-glass-dialog-close kb-glass-cut-button" onClick={onClose}>Close</button>
        </div>
        <div className="kb-glass-dialog-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
