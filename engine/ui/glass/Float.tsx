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
 * Where it stands (backfill-boards design, section 6; board 28): on a desktop it is docked at the right, from the page's top
 * (`DOCK_INSET`, 16px) to `DOCK_INSET` above the HUD's top, as wide as `dockWidth` says (460px at 1440, narrower where the window
 * is, never under 360): it dims and blocks nothing, and a stroke is scrubbed with it open. The page moves aside for it (the owner,
 * 2026-11-06: "Dock, but move the post"): the room it takes is said on the root element (`publishRoom`), and the thread's column and a
 * takeover's view end where it begins. At a tablet's width or less (`sheet`) it is a sheet as wide as the window, ending on the HUD's
 * top edge, the page ends above it, and the page is scrolled so the post it is open on (`keep`, or the anchor where the post is taller
 * than the room) sits above it. What it holds scrolls inside it (the Lens's body), never past the HUD. It places itself as it opens and
 * again at most once a frame on scroll, resize and a change of its own size, measured from its unplaced state. The glow
 * of its ink is a drop shadow on the wrapper, which the dialog's chamfer does not clip (#100's missing glow).
 */
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, useIsPresent } from 'motion/react';
import { useKayfa } from '../context.tsx';
import { modalOpen, topModalHolds } from '../modal.tsx';
import type { GlassSurface } from '../types.ts';
import { pageEscape } from './keys.ts';
import { hudTopOf } from './place.ts';
import { FRAME } from './Frame.tsx';
import { FIELD_PLACED } from './field.ts';
import { largeViewportHeight } from './viewport.ts';
import { isLeaving } from './Held.tsx';
import { focusFell, useLayer } from './layer.tsx';
import { Smoke, useSurfaceStyle } from './Smoke.tsx';
import './shell.css';

/** Where a float stands: docked at the right of a wide window, or the narrow width's sheet. */
export type FloatPlace = 'dock' | 'sheet';

export interface FloatProps {
  /** The dialog's name. */
  readonly label: string;
  readonly surface: GlassSurface;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** What it opened by: a sheet scrolls the page to bring it above the sheet, and focus goes back to it. */
  readonly anchor: RefObject<HTMLElement | null>;
  /** The post the float is open on: kept whole beside a dock and above a sheet where it fits (the anchor alone where it does not). */
  readonly keep?: () => HTMLElement | null;
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

/** The room kept between a sheet and its anchor, and between a sheet and the window's top. */
const GAP = 8;
const MARGIN = 4;
/** The dock's distance from the window's top and right edges and above the HUD (board 28). */
export const DOCK_INSET = 16;
/** The dock's widest and narrowest, and the share of the window it takes between them: 460px at 1440, 360px at a tablet's 834. */
export const DOCK_MAX = 460;
export const DOCK_MIN = 360;
const DOCK_SHARE = 0.32;
/** How wide the dock is in a window `viewport` px wide. */
export const dockWidth = (viewport: number): number => Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, viewport * DOCK_SHARE)));
/** A sheet's share of the room above the HUD, so the post stays in view above it. */
const SHEET_SHARE = 0.55;

/**
 * Where a placement put the float, and for a sheet how far the page must scroll (`over`, in px; none or less is none) to bring the
 * anchor above it, and how tall the sheet stands (`sheetHeight`): the caller scrolls when that changes, not on every placement, and not
 * when only the window's height did (a phone's address bar turning moves the sheet's top in the window and leaves its height alone).
 */
export interface Placement {
  readonly at: FloatPlace;
  readonly over: number;
  readonly sheetHeight: number | null;
  /** The room the float takes from the page, in px: from the window's right edge for a dock, up from its foot for a sheet. The page gives it up (`publishRoom`). */
  readonly room: { readonly right: number; readonly bottom: number };
}

/** Places `wrap` (the float and its glow) as the module comment says, measured from its unplaced state; returns where it took. */
export function placeFloat(wrap: HTMLElement, box: HTMLElement, anchor: HTMLElement, sheet: boolean, keep?: HTMLElement | null): Placement {
  for (const k of ['top', 'left', 'right', 'bottom', 'maxWidth', 'width', 'height'] as const) wrap.style[k] = '';
  box.style.maxHeight = '';
  box.style.height = '';
  const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
  const hudTop = hudTopOf(viewport.height);
  const a = anchor.getBoundingClientRect();
  if (sheet) {
    wrap.style.left = '0';
    wrap.style.right = '0';
    wrap.style.width = 'auto';
    /* The window's own width, not the glow's `max-width: 100vw - 8px`: a sheet runs edge to edge. */
    wrap.style.maxWidth = 'none';
    wrap.style.bottom = `${Math.max(0, viewport.height - hudTop)}px`;
    /*
     * Its room is a share of the large viewport above the HUD (viewport.ts), not of the window: a phone's address bar turning changes
     * the window's height on many scrolls, and a sheet sized from it grew and shrank under the reader and scrolled the page each time.
     * The HUD stands as far above the window's foot either way, so the large viewport less that is where the HUD's top would be with
     * the bar hidden. It is never more than the window shows above the HUD.
     */
    const foot = Math.max(0, viewport.height - hudTop);
    const room = Math.max(0, Math.min(hudTop - MARGIN, Math.floor((largeViewportHeight() - foot - MARGIN) * SHEET_SHARE)));
    box.style.maxHeight = `${room}px`;
    const top = hudTop - Math.min(room, box.scrollHeight + (box.offsetHeight - box.clientHeight));
    /* The whole post is brought above the sheet where it fits there; a post taller than that keeps its mark above it. */
    const post = keep?.getBoundingClientRect();
    const whole = post !== undefined && post.height > 0 && post.height <= top - GAP - MARGIN;
    return { at: 'sheet', over: (whole ? Math.max(post.bottom, a.bottom) : a.bottom) - (top - GAP), sheetHeight: hudTop - top, room: { right: 0, bottom: Math.max(0, viewport.height - top) } };
  }
  /* The dock is as tall as its room, whatever it holds: what is more scrolls inside it. */
  const room = Math.max(0, hudTop - 2 * DOCK_INSET);
  wrap.style.top = `${DOCK_INSET}px`;
  wrap.style.right = `${DOCK_INSET}px`;
  wrap.style.width = `${dockWidth(viewport.width)}px`;
  wrap.style.maxWidth = `${Math.max(0, viewport.width - 2 * DOCK_INSET)}px`;
  box.style.height = `${room}px`;
  return { at: 'dock', over: 0, sheetHeight: null, room: { right: dockWidth(viewport.width) + 2 * DOCK_INSET, bottom: 0 } };
}

/**
 * The room a float takes is given up by the page it stands over (the owner, 2026-11-06: "Dock, but move the post"): the thread's column and a
 * takeover's view end where a dock begins, or above where a sheet begins, so the post it is open on stays whole beside it. The float says it on
 * the root element, the way the page's other global states are (`--kb-float-right`, `--kb-float-bottom`, `data-kb-float`); css reads it.
 */
function publishRoom(placed: Placement): void {
  const root = document.documentElement;
  root.style.setProperty('--kb-float-right', `${placed.room.right}px`);
  root.style.setProperty('--kb-float-bottom', `${placed.room.bottom}px`);
  root.setAttribute('data-kb-float', placed.at);
}
function withdrawRoom(): void {
  const root = document.documentElement;
  root.style.removeProperty('--kb-float-right');
  root.style.removeProperty('--kb-float-bottom');
  root.removeAttribute('data-kb-float');
}

export function Float({ label, surface, onClose, children, anchor, keep, sheet, host, returnFocusTo, onPlace, onKeyDown, className, style, wrapStyle, data }: FloatProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const calm = useSurfaceStyle(surface);
  const { ui } = useKayfa();
  /* False from the render in which the caller closed it, while its exit plays (layer.tsx). */
  const present = useIsPresent();
  const latest = useRef({ onClose, onPlace, returnFocusTo, keep });
  latest.current = { onClose, onPlace, returnFocusTo, keep };

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
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      if (!pageEscape(e) || isLeaving(anchor.current)) return;
      if (modalOpen() && !topModalHolds(host ?? null)) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [host, anchor, present]);

  /* Focus goes back to what opened it, once it has closed, only where focus fell to the page (what held it left with the float). */
  useLayoutEffect(() => {
    if (!present) return;
    const opener = anchor.current;
    const layer = wrap.current;
    return () => {
      queueMicrotask(() => {
        if (!focusFell(layer)) return;
        if (opener?.isConnected) opener.focus();
        else latest.current.returnFocusTo?.()?.focus();
      });
    };
  }, [anchor, present]);

  useLayoutEffect(() => {
    const w = wrap.current;
    const b = box.current;
    if (!w || !b || !present) return;
    let last: FloatPlace | null = null;
    let lastKey = '';
    let lastSheetHeight: number | null = null;
    let lastRoom = '';
    let frame: number | null = null;
    const now = () => {
      frame = null;
      const target = anchor.current;
      /* Never from an anchor that has left the page: a mark can be replaced by "+N" as the strip narrows, and the anchor says the live one. */
      if (!target || !target.isConnected) return;
      /* Placing is measuring and writing; with the anchor, the post, the window and the float's own size where they were, it is skipped. */
      const a = target.getBoundingClientRect();
      const viewport = [document.documentElement.clientWidth || window.innerWidth, window.innerHeight];
      const key = [a.top, a.left, a.right, a.bottom, b.offsetWidth, b.scrollHeight, sheet, viewport[0], viewport[1], hudTopOf(viewport[1]!)].join(',');
      if (key === lastKey) return;
      lastKey = key;
      /* Unplaced for the measuring, what scrolls inside the box (the box, the Lens's body) is as tall as its content and cannot be scrolled, so where each was scrolled to is put back after. */
      const scrolled = [b, ...b.querySelectorAll<HTMLElement>('*')].filter((el) => el.scrollTop > 0).map((el) => [el, el.scrollTop] as const);
      const placed = placeFloat(w, b, target, sheet, latest.current.keep?.() ?? null);
      for (const [el, top] of scrolled) el.scrollTop = top;
      /* The page gives up the room, and where that moved the post (a narrower column is a taller one) it is brought back into the window. */
      publishRoom(placed);
      const room = `${placed.room.right},${placed.room.bottom}`;
      if (placed.at === 'dock' && room !== lastRoom && typeof window.scrollBy === 'function') {
        const post = latest.current.keep?.()?.getBoundingClientRect();
        const mark = target.getBoundingClientRect();
        const hud = hudTopOf(viewport[1]!) - DOCK_INSET;
        const r = post !== undefined && post.height > 0 && post.height <= hud - DOCK_INSET ? post : mark;
        if (r.top < DOCK_INSET) window.scrollBy(0, r.top - DOCK_INSET);
        else if (r.bottom > hud) window.scrollBy(0, Math.min(r.bottom - hud, r.top - DOCK_INSET));
      }
      lastRoom = room;
      /* The float's smoke is a window onto the field and reads where the box stands (Smoke.tsx), which was only just decided. */
      window.dispatchEvent(new Event(FIELD_PLACED));
      /*
       * A sheet scrolls the post so its marks sit just above it: on open and when the sheet's height changes, never
       * for a scroll, which would fight a reader scrolling the page.
       */
      if (placed.at === 'sheet') {
        if (placed.sheetHeight !== lastSheetHeight && placed.over > 0 && typeof window.scrollBy === 'function') window.scrollBy(0, placed.over);
        lastSheetHeight = placed.sheetHeight;
      } else lastSheetHeight = null;
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
      withdrawRoom();
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', onScroll, true);
      grown?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [anchor, sheet, present]);

  /* Enters from its anchor; no dim (it blocks nothing). The wrapper keeps its glow, so the box is what moves. Its close plays out on this same tree (layer.tsx). */
  const lifted = useLayer({ box, kind: 'overlay', anchor, overrides: ui.glass.motion, rootOnly: true });

  return createPortal(
    <div ref={wrap} className="kb-glass kb-float" style={wrapStyle} {...lifted.root}>
      <motion.div
        ref={box} className={`${FRAME} kb-float-box${className ? ` ${className}` : ''}`} role="dialog" aria-modal="false" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
        {...lifted.box} style={{ ...calm, ...style }}
        {...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
      >
        <Smoke surface={surface} />
        {children}
      </motion.div>
    </div>,
    host ?? document.body,
  );
}
