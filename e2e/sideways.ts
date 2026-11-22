import type { Page } from '@playwright/test';

/**
 * How far a page's layout reaches past the window's right edge, in CSS px: 0 or less when it fits (#994).
 *
 * The frame clips sideways at the window's edge (`.kb-frame { overflow-x: clip }`, engine/ui/frame/frame.css, #988), so the document
 * of a board page never scrolls sideways, however wide its content runs, and `document.documentElement.scrollWidth` can no longer see a
 * heading, a form or a table that is too wide for the window: the clip cuts it off at the screen's edge where nobody can reach it, and a
 * guard on the document stays green. The frame's own `scrollWidth` still counts what it clips, so this reads the larger of the two: the
 * frame's overflow past its width, and the document's (for anything whose containing block is the window, which the frame's clip does not
 * reach). It is what the document's overflow was before the clip, which is what every guard that says a page fits its window means.
 *
 * A test that the clip itself holds (the page does not scroll, whatever runs past the window) reads the document, not this.
 * The self-test is e2e/sideways.spec.ts.
 */
export const sideways = (page: Page): Promise<number> => page.evaluate(() => {
  const doc = document.documentElement;
  const frame = document.querySelector<HTMLElement>('.kb-frame');
  return Math.max(doc.scrollWidth - doc.clientWidth, frame ? frame.scrollWidth - frame.clientWidth : -Infinity);
});
