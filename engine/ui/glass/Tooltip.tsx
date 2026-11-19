/**
 * The glass's tooltip (docs/plans/2026-11-19-reaction-grace-design.md, section 7): a small panel by a control that says one plain,
 * true thing about it, such as "Reactions can't be taken back." It is shown by a press, never by hover alone, and it never takes focus
 * or holds anything pressable, so a reader's place does not move.
 *
 * The caller owns `open`. It closes (calls `onClose`) by itself after `TOOLTIP_MS`, when the anchor loses focus, and on a page Esc
 * (glass/keys.ts `pageEscape`: not one typed in a field, not a held key's repeat). While open the anchor's `aria-describedby` names the
 * tooltip (any value it had stays, and is put back after). Focus alone would not read it on a press, so its text is also said once in a
 * polite `role="status"` region that is in the page while it is mounted (a caller may mount it on its first open and keep it mounted, so its exit plays), emptied and filled again on each open and restart.
 *
 * RESTART: pressing again while it is open should give it a fresh 3 seconds. A parent passes `restart`, a number it bumps on each such
 * press; a changed value restarts the timer. (Opening after a close restarts it anyway, since `open` changed.)
 *
 * It is portaled to the page's body, in the layers (layer.tsx): it enters and leaves as an overlay does, from its anchor, and not at all
 * under Motion Off. It stands above its anchor, below where above would leave the window, and is held inside the window's 16px gutters
 * (the phone's), by place.ts, on open, resize and scroll. It is not visible until it has been placed (so not at all with no anchor). The ⓘ is drawn, `aria-hidden`; there is no smoke.
 */
import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useKayfa } from '../context.tsx';
import { pageEscape } from './keys.ts';
import { Layers, useLayer } from './layer.tsx';
import { placePopover } from './place.ts';
import './tooltip.css';

/** How long it stands before it closes by itself, in ms. */
export const TOOLTIP_MS = 3000;
/** The phone's gutter the tooltip is kept inside, and the room between it and its anchor. */
const GUTTER = 16;
const GAP = 8;
/** The pause between emptying the polite region and filling it again. */
const SAY_MS = 50;

export interface TooltipProps {
  /** The control it is about: it gets `aria-describedby`, and its blur closes the tooltip. */
  readonly anchor: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Bump it to give an open tooltip a fresh 3 seconds. */
  readonly restart?: number;
  readonly children: ReactNode;
}

function Panel({ anchor, id, children }: { readonly anchor: RefObject<HTMLElement | null>; readonly id: string; readonly children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const { ui } = useKayfa();
  /* Placed before paint, from the anchor's and the box's own measure; again when the window changes. */
  useLayoutEffect(() => {
    const el = box.current;
    const target = anchor.current;
    if (!el || !target) return;
    const place = () => {
      const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
      const a = target.getBoundingClientRect();
      /* The width cap is on before the box is measured, so a sentence that wraps is measured wrapped. */
      el.style.maxWidth = `${Math.max(0, viewport.width - 2 * GUTTER)}px`;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const desired = a.left + a.width / 2 - size.width / 2;
      const p = placePopover({ button: a, container: { left: desired, top: 0, right: desired, bottom: 0 }, size, viewport, hudTop: viewport.height, gap: GAP, margin: GUTTER });
      const above = a.top - GAP - size.height >= GUTTER;
      el.style.left = `${p.left + desired}px`;
      el.style.top = `${above ? a.top - GAP - size.height : p.top}px`;
      el.style.maxWidth = `${p.maxWidth}px`;
      el.dataset.kbPlace = above ? 'above' : p.side;
    };
    place();
    /* Resize and any scroll (the page moves the anchor) place it again, at most once a frame. */
    let frame: number | null = null;
    const soon = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; place(); }); };
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', soon, { capture: true });
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [anchor]);
  const lifted = useLayer({ box, kind: 'overlay', anchor, overrides: ui.glass.motion, rootOnly: true });
  return createPortal(
    <div className="kb-glass kb-tooltip-wrap" {...lifted.root}>
      <motion.div ref={box} id={id} role="tooltip" className="kb-tooltip" {...lifted.box}>
        <span className="kb-tooltip-mark" aria-hidden="true">ⓘ</span>
        <span>{children}</span>
      </motion.div>
    </div>,
    document.body,
  );
}

export function Tooltip({ anchor, open, onClose, restart, children }: TooltipProps) {
  const id = useId();
  const latest = useRef(onClose);
  latest.current = onClose;
  /* The text for the polite region goes in after the tooltip is mounted (an effect), so a reader hears it as a change. */
  const text = useRef<HTMLSpanElement>(null);
  const [spoken, setSpoken] = useState('');
  /* On each open and each restart the region is emptied and filled again a tick later, so a second press is heard too. No anchor, nothing said. */
  useEffect(() => {
    setSpoken('');
    if (!open || !anchor.current) return;
    const t = setTimeout(() => setSpoken(text.current?.textContent ?? ''), SAY_MS);
    return () => clearTimeout(t);
  }, [open, restart, anchor]);

  /* The anchor names the tooltip while it is open; what it said before is put back. */
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!open || !el) return;
    const before = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', before ? `${before} ${id}` : id);
    return () => {
      if (before === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', before);
    };
  }, [open, anchor, id]);

  /* It closes by itself; a changed `restart` is a fresh 3 seconds. */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => latest.current(), TOOLTIP_MS);
    return () => clearTimeout(t);
  }, [open, restart]);

  /* It closes when the anchor loses focus, and on a deliberate Esc that is not a field's. */
  useEffect(() => {
    if (!open) return;
    const el = anchor.current;
    const onBlur = () => latest.current();
    const onKey = (e: KeyboardEvent) => { if (pageEscape(e)) latest.current(); };
    el?.addEventListener('blur', onBlur);
    document.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('blur', onBlur);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor]);

  return (
    <>
      <span ref={text} hidden>{children}</span>
      <span className="kb-visually-hidden" role="status" aria-live="polite">{spoken}</span>
      <Layers>{open && <Panel key="tip" anchor={anchor} id={id}>{children}</Panel>}</Layers>
    </>
  );
}
