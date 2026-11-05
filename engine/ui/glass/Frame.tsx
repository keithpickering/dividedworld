/**
 * The glass dialog's one frame (the glass polish plan, "Modals"): the Reveal modal's look, worn by every dialog, the Turn, the
 * Reveal, the Debut, the play form, card info, the React picker and the Lens. A dialog stands in `FRAME` (the chamfered box,
 * its border drawn on the cut by base.css's `.kb-glass-cut-dialog`, sized by shell.css's four tokens and nobody else's), opens
 * with a `DialogBar` (the title row, sticky while the body scrolls) and closes with a `CloseCross` (the one look of Close, a
 * square with a cross, its word kept for its name and hidden). Overlay.tsx and Float.tsx are the two things that stand a
 * dialog; neither draws a frame of its own, and a test holds that (frame.test.tsx).
 */
import { useLayoutEffect, useRef, type MouseEventHandler, type ReactNode, type Ref } from 'react';

/** The classes of every dialog's box. */
export const FRAME = 'kb-glass-dialog kb-glass-cut-dialog';

/** Close: the one look, a square with a cross. Its word is its name and is hidden. */
export function CloseCross({ onClick, buttonRef }: { readonly onClick: MouseEventHandler<HTMLButtonElement>; readonly buttonRef?: Ref<HTMLButtonElement> }) {
  return <button ref={buttonRef} type="button" className="kb-glass-dialog-close" onClick={onClick}><span className="kb-visually-hidden">Close</span></button>;
}

/**
 * The title row: what names the dialog, whatever the title sets beside it, and Close. It stays in view while the body scrolls.
 *
 * It sits over what scrolls under it, so a control the browser scrolls into view (Shift+Tab, going up) must be scrolled clear of the bar
 * (WCAG 2.4.11). The bar's height is its content's (a title that wraps at large text makes it several times Close's 52px), so the bar writes the
 * height its foot stands at when stuck, `--kb-dialog-bar-stuck`, on its dialog and on the overlay around it, and shell.css's `scroll-padding-top` on
 * every scroll container of a dialog reads it (with Close's own height and the stuck offset as the fallback before this runs).
 *
 * The value also rests on the holders' padding, which changes without the bar's size changing: the root's layout swaps the overlay's
 * padding at the phone breakpoint, and a Float's place moves it between popover and sheet. So the bar measures again when the window
 * resizes, when the root's `data-kb-layout` changes, and when a holder's class, style or `data-kb-place` does.
 */
export function DialogBar({ children, close }: { readonly children: ReactNode; readonly close?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    const dialog = el?.parentElement;
    if (!el || !dialog) return undefined;
    const holders = [dialog, ...(dialog.parentElement?.classList.contains('kb-glass-overlay') ? [dialog.parentElement] : [])];
    const write = () => {
      /* Where the stuck bar's foot lies from a scrollport's top: the holder's own padding (a bar sticks inside it), the sticky offset and the bar's height. */
      const lift = parseFloat(getComputedStyle(el).top) + el.getBoundingClientRect().height;
      for (const h of holders) {
        const stuck = lift + parseFloat(getComputedStyle(h).paddingTop);
        const value = `${Math.ceil(stuck) + 4}px`;
        /* Not written again when it is the same: a write to the style is itself a change the holders' observer would hear. */
        if (Number.isFinite(stuck) && h.style.getPropertyValue('--kb-dialog-bar-stuck') !== value) h.style.setProperty('--kb-dialog-bar-stuck', value);
      }
    };
    write();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
    resize?.observe(el);
    const mutate = typeof MutationObserver === 'undefined' ? null : new MutationObserver(write);
    for (const h of holders) mutate?.observe(h, { attributes: true, attributeFilter: ['class', 'style', 'data-kb-place'] });
    mutate?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-layout'] });
    window.addEventListener('resize', write);
    return () => {
      resize?.disconnect();
      mutate?.disconnect();
      window.removeEventListener('resize', write);
      for (const h of holders) h.style.removeProperty('--kb-dialog-bar-stuck');
    };
  }, []);
  return <div ref={bar} className="kb-glass-dialog-bar">{children}{close}</div>;
}
