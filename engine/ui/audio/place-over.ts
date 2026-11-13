/**
 * Where the caption bar stands while a glass dialog is open (Captions.tsx). The bar is drawn above the dialog's scrim, and the dialog's own box is the
 * scrim's child, so the bar cannot be layered between them: it is placed clear of the box instead. Pure, so it is tested on rectangles alone.
 */
export interface Rect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** The room the bar keeps above a box it is lifted over, as it keeps above the HUD's seam at rest (captions.css). */
export const REST_GAP = 10;

const meets = (a: Rect, b: Rect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * How far up the bar must go to stand clear of every box, from its resting rectangle `bar`: 0 where it meets none, otherwise enough to rest REST_GAP
 * above the highest box it would meet, again if that lands it on another. `null` where there are no boxes (nothing to stand over) or where no room is
 * left above a box: `viewport.top` is where the dialogs' overlay starts (under the menu bar's foot, Overlay.tsx), the highest the bar may stand, since
 * above it is the page's own chrome, which the bar would climb over. Then the bar stays where it is, under the scrim, still announced by its live region.
 * A lift is never negative, so a bar that rests inside the window never leaves it below.
 */
export function placeOver(bar: Rect, boxes: readonly Rect[], viewport: { readonly top: number }): { readonly lift: number } | null {
  if (boxes.length === 0) return null;
  let lift = 0;
  for (let pass = 0; pass <= boxes.length; pass++) {
    const at: Rect = { left: bar.left, right: bar.right, top: bar.top - lift, bottom: bar.bottom - lift };
    const hit = boxes.filter((b) => meets(at, b));
    if (hit.length === 0) return at.top >= viewport.top ? { lift } : null;
    lift = Math.max(lift, bar.bottom - (Math.min(...hit.map((b) => b.top)) - REST_GAP));
  }
  return null;
}
