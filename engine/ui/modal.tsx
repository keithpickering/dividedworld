/**
 * A modal: the board's own box over a dimmed page, used where it is the best experience (the Turn,
 * a reveal's confirmation). It is a dialog named by its title. Focus moves inside when it opens
 * (to the first control of its body, else its Close button), Tab and Shift+Tab are held inside it,
 * Esc and a press on the dimmed page close it, and focus returns to the control that opened it. If
 * that control is gone by then (the row it sat in changed under the dialog), focus goes to the
 * place the screen names with `returnFocusTo`, so a keyboard never lands on the page's top.
 *
 * While any modal is open the page behind cannot scroll (its overflow is restored exactly as it
 * was when the last one closes) and everything behind the top modal is `inert`, so no keyboard,
 * pointer or reader can reach it. Modals nest: a module-level stack makes only the top one answer
 * Esc, Tab and stray focus. The app root is not named here: every direct child of the body other
 * than the top modal's overlay is the page behind, which holds in the web app, in stories and in tests.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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

/*
 * A control taken out of the Tab order (`tabindex="-1"`, as a roving grid does with all but its one
 * stop) is no stop of Tab's, so it is neither the first nor the last the dialog holds Tab between.
 * Nor is a radio left unchecked in a group that has a checked one: the browser's Tab stops on a
 * group once, at its checked radio, so a dialog opened on a choice already made (a pending Turn's
 * class) puts focus on that choice. A group with nothing checked keeps its radios.
 */
const unchosen = (el: HTMLElement, box: HTMLElement) =>
  el instanceof HTMLInputElement && el.type === 'radio' && el.name !== '' && !el.checked
  && [...box.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some((r) => r.name === el.name && r.form === el.form && r.checked);
const tabbables = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex >= 0 && !unchosen(el, box));

/* The open modals, lowest first. A parent renders before its child, so its sequence number is lower even though a child's effects run first. */
interface Entry { readonly seq: number; overlay: HTMLElement | null }
const stack: Entry[] = [];
let sequence = 0;
let saved: { readonly overflow: string; readonly paddingRight: string } | null = null;
const wasInert = new Map<Element, boolean>();

const isTop = (entry: Entry) => stack[stack.length - 1] === entry;

/** Everything in the body but the top modal's overlay is inert; what was inert before stays inert after. */
function settle() {
  const top = stack[stack.length - 1]?.overlay ?? null;
  if (stack.length === 0) {
    for (const [el, was] of wasInert) if (!was) el.removeAttribute('inert');
    wasInert.clear();
    if (saved) { document.body.style.overflow = saved.overflow; document.body.style.paddingRight = saved.paddingRight; saved = null; }
    return;
  }
  if (!saved) {
    saved = { overflow: document.body.style.overflow, paddingRight: document.body.style.paddingRight };
    const bar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    /* The page keeps its width when its scrollbar goes. */
    if (bar > 0 && document.documentElement.clientWidth > 0) document.body.style.paddingRight = `calc(${getComputedStyle(document.body).paddingRight} + ${bar}px)`;
  }
  for (const el of Array.from(document.body.children)) {
    if (el === top) {
      if (wasInert.has(el) && !wasInert.get(el)) el.removeAttribute('inert');
      continue;
    }
    if (!wasInert.has(el)) wasInert.set(el, el.hasAttribute('inert'));
    el.setAttribute('inert', '');
  }
}

export interface ModalLayer {
  readonly overlay: RefObject<HTMLDivElement | null>;
  readonly box: RefObject<HTMLDivElement | null>;
  readonly closeButton: RefObject<HTMLButtonElement | null>;
}

/**
 * The layer every modal surface is: the board's Modal here, and the glass's Overlay
 * (engine/ui/glass/Overlay.tsx), so the two share one stack and only the top one of either kind
 * answers Esc, Tab and stray focus. The caller renders the overlay, the dialog box and its Close
 * button with the refs this returns.
 */
export function useModalLayer({ onClose, returnFocusTo }: Pick<ModalProps, 'onClose' | 'returnFocusTo'>): ModalLayer {
  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  /* The latest props, read by listeners that live as long as the dialog does. */
  const latest = useRef({ onClose, returnFocusTo });
  latest.current = { onClose, returnFocusTo };
  /* Cleared first thing when the dialog closes, so giving focus back is not mistaken for focus escaping. */
  const open = useRef(true);
  const overlay = useRef<HTMLDivElement>(null);
  const [entry] = useState<Entry>(() => ({ seq: ++sequence, overlay: null }));

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    entry.overlay = overlay.current;
    stack.push(entry);
    stack.sort((a, b) => a.seq - b.seq);
    settle();
    const first = tabbables(box.current!).find((el) => el !== closeButton.current) ?? closeButton.current;
    if (isTop(entry)) first?.focus();
    open.current = true;
    return () => {
      open.current = false;
      stack.splice(stack.indexOf(entry), 1);
      settle();
      /* After the commit that closes it: the control that opened it may be replaced by that same commit. */
      queueMicrotask(() => {
        if (opener?.isConnected && opener !== document.body) opener.focus();
        else latest.current.returnFocusTo?.()?.focus();
      });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = box.current;
      if (!dialog || !isTop(entry)) return;
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
      if (open.current && isTop(entry) && dialog && e.target instanceof Node && !dialog.contains(e.target)) (tabbables(dialog)[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);

  return { overlay, box, closeButton };
}

export function Modal({ title, onClose, children, returnFocusTo }: ModalProps) {
  const id = useId();
  const { overlay, box, closeButton } = useModalLayer({ onClose, returnFocusTo });
  return createPortal(
    <div ref={overlay} className="kb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
