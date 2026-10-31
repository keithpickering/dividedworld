/**
 * The glass's float: a panel that stands over the page and does not own it (the Lens, engine/ui/cards/Lens.tsx; marks-and-the-lens
 * design, section 2). It is the overlay's sibling (Overlay.tsx) without its modality: nothing is dimmed, nothing is made `inert`,
 * Tab is not held inside, and a press outside it does not close it, since the reason for a float is that the page under it
 * stays in use (a stroke is scrubbed with the Lens open). It is a `role="dialog"` with `aria-modal="false"`.
 *
 * Esc closes it, through the modal layer's stack (engine/ui/modal.tsx): while a modal surface is open (a picker opened from
 * the float) Esc is that surface's and the float stays; the next Esc is the float's. Esc typed in a text field is the
 * field's, and a held key's repeats, an IME's Esc and one already answered are not a close, as the page's own Esc is
 * (glass/keys.ts). Focus goes back to what opened it when it closes by itself leaving the page's focus on nothing.
 *
 * Where it stands: on a desktop beside the right edge of `beside` (the post) when the window has the float's width and a
 * gutter free there, so it does not cover the ink being scrubbed; else under (or over) its `anchor`, kept in the window,
 * between its top and the HUD (place.ts `placePopover`). Under the thread's narrow width (`sheet`) it is a short sheet
 * standing on the HUD's top edge, and the page is scrolled so the anchor sits just above it. It places itself as it opens
 * and again at most once a frame on scroll, resize and a change of its own size, measured from its unplaced state. The glow
 * of its ink is a drop shadow on the wrapper, which the dialog's chamfer does not clip (#100's missing glow).
 */
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { modalOpen, topModalHolds } from '../modal.tsx';
import type { GlassSurface } from '../types.ts';
import { pageEscape } from './keys.ts';
import { hudTopOf, placePopover } from './place.ts';
import { Smoke, useSurfaceStyle } from './Smoke.tsx';
import './shell.css';

/** Where a float stands: beside the post, under its anchor, over it where there is no room under, or the narrow width's sheet. */
export type FloatPlace = 'side' | 'under' | 'above' | 'sheet';

export interface FloatProps {
  /** The dialog's name. */
  readonly label: string;
  readonly surface: GlassSurface;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** What it opened by, which it stands under where there is no room beside `beside`, and gives focus back to. */
  readonly anchor: RefObject<HTMLElement | null>;
  /** The part of the page whose right edge it stands beside on a desktop; none stands it under the anchor. */
  readonly beside?: RefObject<HTMLElement | null>;
  /** The narrow width's sheet on the HUD, whatever the window's room. */
  readonly sheet: boolean;
  /** Where it renders; the page's body by default. */
  readonly host?: HTMLElement | null;
  /** Where focus goes on close when what opened it is no longer on the page. */
  readonly returnFocusTo?: () => HTMLElement | null;
  /** Told where it was placed, each time it is. */
  readonly onPlace?: (place: FloatPlace) => void;
  /** Keys typed inside the float (React events: those of a surface portaled from it arrive too, so a handler checks the target). */
  readonly onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  readonly className?: string;
  /** The dialog's own style over its smoke's (the Lens sets its tab's ink). */
  readonly style?: CSSProperties;
  /** The wrapper's style: what the glow is drawn from. */
  readonly wrapStyle?: CSSProperties;
  /** The dialog's own data attributes, by their names after `data-`. */
  readonly data?: Readonly<Record<string, string | undefined>>;
}

/** The room kept between the float and its anchor or the post, and between it and the window's edges. */
const GAP = 8;
const GUTTER = 12;
const MARGIN = 4;
/** A sheet's share of the room above the HUD, so the post stays in view above it. */
const SHEET_SHARE = 0.55;

/**
 * Where a placement put the float, and for a sheet how far the page must scroll (`over`, in px; none or less is none) to bring the
 * anchor above it, and where the sheet's top edge is (`sheetTop`): the caller scrolls when the edge moves, not on every placement.
 */
export interface Placement { readonly at: FloatPlace; readonly over: number; readonly sheetTop: number | null }

/** Places `wrap` (the float and its glow) as the module comment says, measured from its unplaced state; returns where it took. */
export function placeFloat(wrap: HTMLElement, box: HTMLElement, anchor: HTMLElement, beside: HTMLElement | null, sheet: boolean): Placement {
  for (const k of ['top', 'left', 'right', 'bottom', 'maxWidth', 'width'] as const) wrap.style[k] = '';
  box.style.maxHeight = '';
  const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
  const hudTop = hudTopOf(viewport.height);
  const a = anchor.getBoundingClientRect();
  if (sheet) {
    wrap.style.left = '0';
    wrap.style.right = '0';
    wrap.style.width = 'auto';
    wrap.style.bottom = `${Math.max(0, viewport.height - hudTop)}px`;
    const room = Math.max(0, Math.floor((hudTop - MARGIN) * SHEET_SHARE));
    box.style.maxHeight = `${room}px`;
    const top = hudTop - Math.min(room, box.scrollHeight + (box.offsetHeight - box.clientHeight));
    return { at: 'sheet', over: a.bottom - (top - GAP), sheetTop: top };
  }
  const r = box.getBoundingClientRect();
  const height = box.scrollHeight + (r.height - box.clientHeight);
  const post = beside?.getBoundingClientRect();
  if (post && viewport.width - post.right >= r.width + GUTTER + MARGIN) {
    const room = Math.max(0, hudTop - 2 * MARGIN);
    const tall = Math.min(height, room);
    wrap.style.left = `${post.right + GUTTER}px`;
    wrap.style.top = `${Math.min(Math.max(a.top, MARGIN), Math.max(MARGIN, hudTop - MARGIN - tall))}px`;
    if (height > room) box.style.maxHeight = `${room}px`;
    return { at: 'side', over: 0, sheetTop: null };
  }
  const p = placePopover({
    button: a, container: { left: a.left, top: 0, right: a.right, bottom: 0 }, size: { width: r.width, height },
    viewport, hudTop, gap: GAP, margin: MARGIN,
  });
  wrap.style.top = `${p.top}px`;
  wrap.style.left = `${p.left + a.left}px`;
  wrap.style.maxWidth = `${p.maxWidth}px`;
  if (p.maxHeight !== null) box.style.maxHeight = `${p.maxHeight}px`;
  return { at: p.side === 'below' ? 'under' : 'above', over: 0, sheetTop: null };
}

export function Float({ label, surface, onClose, children, anchor, beside, sheet, host, returnFocusTo, onPlace, onKeyDown, className, style, wrapStyle, data }: FloatProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const calm = useSurfaceStyle(surface);
  const latest = useRef({ onClose, onPlace, returnFocusTo });
  latest.current = { onClose, onPlace, returnFocusTo };

  /*
   * Esc is the float's when no modal surface is open over it and the key is a deliberate press outside a text field (the page's own
   * test, glass/keys.ts). It listens in the capture phase of the document and answers the key, so the float closes before the HUD's
   * Menu or the glass page's Back hears an Esc (they listen later, and an answered key is theirs no longer).
   *
   * A float hosted inside a modal surface (a takeover's view gives the Lens its host, Task 5 of the marks-and-the-lens plan) stands
   * above that surface: while that surface is the top one, Esc is the float's. It listens on the window then, which hears a key before
   * the document does, so the view's own Esc (Stick Around's Break free press, its modal layer's close) never sees the key the float
   * answered; the next Esc is the view's.
   */
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageEscape(e)) return;
      if (modalOpen() && !topModalHolds(host ?? null)) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [host]);

  /* Focus goes back to what opened it, once it has closed, only where focus fell to the page (what held it left with the float). */
  useLayoutEffect(() => {
    const opener = anchor.current;
    return () => {
      queueMicrotask(() => {
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        if (opener?.isConnected) opener.focus();
        else latest.current.returnFocusTo?.()?.focus();
      });
    };
  }, [anchor]);

  useLayoutEffect(() => {
    const w = wrap.current;
    const b = box.current;
    if (!w || !b) return;
    let last: FloatPlace | null = null;
    let lastKey = '';
    let lastSheetTop: number | null = null;
    let frame: number | null = null;
    const now = () => {
      frame = null;
      const target = anchor.current;
      /* Never from an anchor that has left the page: a mark can be replaced by "+N" as the strip narrows, and the anchor says the live one. */
      if (!target || !target.isConnected) return;
      /* Placing is measuring and writing; with the anchor, the post, the window and the float's own size where they were, it is skipped. */
      const a = target.getBoundingClientRect();
      const post = beside?.current?.getBoundingClientRect();
      const viewport = [document.documentElement.clientWidth || window.innerWidth, window.innerHeight];
      const key = [a.top, a.left, a.right, a.bottom, post?.right, b.offsetWidth, b.scrollHeight, sheet, viewport[0], viewport[1], hudTopOf(viewport[1]!)].join(',');
      if (key === lastKey) return;
      lastKey = key;
      /* Unplaced for the measuring, the box is no scroller, so where it was scrolled to is put back after. */
      const scrolled = b.scrollTop;
      const placed = placeFloat(w, b, target, beside?.current ?? null, sheet);
      b.scrollTop = scrolled;
      /*
       * A sheet scrolls the post so its marks sit just above it: on open and when the sheet's edge moves (its size changed), never
       * for a scroll, which would fight a reader scrolling the page.
       */
      if (placed.at === 'sheet') {
        if (placed.sheetTop !== lastSheetTop && placed.over > 0 && typeof window.scrollBy === 'function') window.scrollBy(0, placed.over);
        lastSheetTop = placed.sheetTop;
      } else lastSheetTop = null;
      latest.current.onPlace?.(placed.at);
      /* A change of side lays what it holds out anew, so it is measured again once that has landed. */
      if (last !== null && placed.at !== last) { lastKey = ''; soon(); }
      last = placed.at;
    };
    /* Placing reads the layout, so the events that ask for it (a scroll brings many) are gathered into one placement a frame. */
    const soon = () => { if (frame === null) frame = requestAnimationFrame(now); };
    now();
    window.addEventListener('resize', soon);
    /* The page scrolling moves the anchor; the float's own scrolling is no reason to place it again. */
    const onScroll = (e: Event) => { if (e.target !== b) soon(); };
    window.addEventListener('scroll', onScroll, true);
    const grown = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    grown?.observe(b);
    return () => {
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', onScroll, true);
      grown?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [anchor, beside, sheet]);

  return createPortal(
    <div ref={wrap} className="kb-glass kb-float" style={wrapStyle}>
      <div
        ref={box} className={`kb-glass-dialog kb-glass-cut-dialog kb-float-box${className ? ` ${className}` : ''}`} role="dialog" aria-modal="false" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
        style={{ ...calm, ...style }}
        {...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
      >
        <Smoke surface={surface} />
        {children}
      </div>
    </div>,
    host ?? document.body,
  );
}
