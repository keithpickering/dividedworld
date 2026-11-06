/**
 * Where a smoke's frame stands in the viewport, and how much it is zoomed: the one reading Smoke.tsx's placement (which moves the
 * layers) and Calm.tsx (which places the calm rects) both make of a window. The HUD below 1440px is drawn with CSS `zoom`, so a
 * box's drawn size is its layout size times the zoom; a length taken from the viewport is divided by it to be in the window's own px.
 */
export interface FrameBox {
  /** The frame's drawn box in the viewport, in screen px. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Drawn px per layout px: 1 where the frame has no size (a hidden drawer, jsdom). */
  readonly zoom: number;
}

export function frameOf(el: HTMLElement): FrameBox {
  const r = el.getBoundingClientRect();
  /* Laid out at `offsetWidth` of its own pixels and drawn `r.width` wide. */
  const zoom = el.offsetWidth > 0 && r.width > 0 ? r.width / el.offsetWidth : 1;
  return { left: r.left, top: r.top, width: r.width, height: r.height, zoom };
}

/** The nearest of `el` and its ancestors laid out `position: fixed`, or null where none is. */
export function fixedAncestor(el: HTMLElement): HTMLElement | null {
  for (let a: HTMLElement | null = el; a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return a;
  return null;
}
