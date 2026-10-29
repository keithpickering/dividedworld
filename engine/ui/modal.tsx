/**
 * A modal: the board's own box over a dimmed page, used where it is the best experience (the Turn,
 * a reveal's confirmation). It is a dialog named by its title. Focus moves inside when it opens
 * (to the first control of its body, else its Close button), Tab and Shift+Tab are held inside it,
 * Esc and a press on the dimmed page close it, and focus returns to the control that opened it. If
 * that control is gone by then (the row it sat in changed under the dialog), focus goes to the
 * place the screen names with `returnFocusTo`, so a keyboard never lands on the page's top.
 */
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './modal.css';

export interface ModalProps {
  readonly title: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Where focus goes on close when the control that opened the dialog is no longer on the page. */
  readonly returnFocusTo?: () => HTMLElement | null;
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const tabbables = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true');

export function Modal({ title, onClose, children, returnFocusTo }: ModalProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  /* The latest props, read by listeners that live as long as the dialog does. */
  const latest = useRef({ onClose, returnFocusTo });
  latest.current = { onClose, returnFocusTo };
  /* Cleared first thing when the dialog closes, so giving focus back is not mistaken for focus escaping. */
  const open = useRef(true);

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = tabbables(box.current!).find((el) => el !== closeButton.current) ?? closeButton.current;
    first?.focus();
    open.current = true;
    return () => {
      open.current = false;
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else latest.current.returnFocusTo?.()?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = box.current;
      if (!dialog) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const stops = tabbables(dialog);
      if (stops.length === 0) { e.preventDefault(); return; }
      const [head, tail] = [stops[0]!, stops[stops.length - 1]!];
      const at = document.activeElement;
      if (!dialog.contains(at)) { e.preventDefault(); head.focus(); }
      else if (e.shiftKey && at === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && at === tail) { e.preventDefault(); head.focus(); }
    };
    /* Focus that lands outside (a script, a click through) is brought back in. */
    const onFocus = (e: FocusEvent) => {
      const dialog = box.current;
      if (open.current && dialog && e.target instanceof Node && !dialog.contains(e.target)) (tabbables(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);

  return createPortal(
    <div className="kb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="kb-modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="kb-modal-bar">
          <h2 id={id} className="kb-modal-head">{title}</h2>
          <button ref={closeButton} type="button" className="kb-button kb-modal-close" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
