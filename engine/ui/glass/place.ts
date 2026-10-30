/**
 * Where an overlay opened by an anchor goes on the Main board's layout (Overlay.tsx; the React
 * picker's, which this was first written for), as numbers: below its button if it fits above the HUD, else above
 * it, else on the roomier side with a height cap (the popover scrolls inside it); and pulled back
 * inside the window's left and right edges. Everything is in viewport pixels in, and out relative to
 * the popover's containing block (the container's top-left), which is what an absolute element needs.
 */
export interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

export interface PlaceInput {
  readonly button: Box;
  /** The popover's containing block. */
  readonly container: Box;
  /** The popover's natural size, uncapped. */
  readonly size: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
  /** The top of whatever is fixed at the foot of the window (the HUD); the viewport's height when none. */
  readonly hudTop: number;
  readonly gap?: number;
  readonly margin?: number;
}

export interface Placement {
  readonly side: 'below' | 'above';
  readonly top: number;
  readonly left: number;
  /** Set when neither side holds the popover; it scrolls within this. */
  readonly maxHeight: number | null;
  readonly maxWidth: number;
}

export function placePopover({ button, container, size, viewport, hudTop, gap = 4, margin = 4 }: PlaceInput): Placement {
  const below = hudTop - button.bottom - gap - margin;
  const above = button.top - gap - margin;
  const side = size.height <= below || (size.height > above && below >= above) ? 'below' : 'above';
  const room = side === 'below' ? below : above;
  const capped = size.height > room;
  const height = capped ? Math.max(0, room) : size.height;
  const edge = side === 'below' ? button.bottom + gap : button.top - gap - height;
  const maxWidth = viewport.width - 2 * margin;
  const width = Math.min(size.width, maxWidth);
  const left = Math.min(Math.max(container.left, margin), viewport.width - margin - width);
  return { side, top: edge - container.top, left: left - container.left, maxHeight: capped ? height : null, maxWidth };
}
