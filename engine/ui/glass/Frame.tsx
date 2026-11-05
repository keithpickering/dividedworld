/**
 * The glass dialog's one frame (the glass polish plan, "Modals"): the Reveal modal's look, worn by every dialog, the Turn, the
 * Reveal, the Debut, the play form, card info, the React picker and the Lens. A dialog stands in `FRAME` (the chamfered box,
 * its border drawn on the cut by base.css's `.kb-glass-cut-dialog`, sized by shell.css's two tokens and nobody else's), opens
 * with a `DialogBar` (the title row, sticky while the body scrolls) and closes with a `CloseCross` (the one look of Close, a
 * square with a cross, its word kept for its name and hidden). Overlay.tsx and Float.tsx are the two things that stand a
 * dialog; neither draws a frame of its own, and a test holds that (frame.test.tsx).
 */
import type { MouseEventHandler, ReactNode, Ref } from 'react';

/** The classes of every dialog's box. */
export const FRAME = 'kb-glass-dialog kb-glass-cut-dialog';

/** Close: the one look, a square with a cross. Its word is its name and is hidden. */
export function CloseCross({ onClick, buttonRef }: { readonly onClick: MouseEventHandler<HTMLButtonElement>; readonly buttonRef?: Ref<HTMLButtonElement> }) {
  return <button ref={buttonRef} type="button" className="kb-glass-dialog-close" onClick={onClick}><span className="kb-visually-hidden">Close</span></button>;
}

/** The title row: what names the dialog, whatever the title sets beside it, and Close. It stays in view while the body scrolls. */
export function DialogBar({ children, close }: { readonly children: ReactNode; readonly close?: ReactNode }) {
  return <div className="kb-glass-dialog-bar">{children}{close}</div>;
}
