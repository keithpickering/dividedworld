/**
 * The large viewport: the window's height with a phone's address bar hidden (`100lvh`), which does not change as the bar shows
 * and hides. `innerHeight` follows the bar, by about 56px each time a scroll turns it (seen on Android's Chrome), so what is sized
 * from `innerHeight` grows and shrinks on those scrolls. What should hold still through them reads its height here: the smoke's
 * field (field.ts), whose clouds were stretched with it, and the float's sheet (Float.tsx), which was resized and scrolled the
 * page under the reader.
 *
 * Script has one reading of `lvh`: an element laid out at it. One is made the first time it is asked for, kept on the body, and
 * made again if something took it away. A browser without `lvh` lays it out at `100vh`, which most phone browsers already hold at
 * the large viewport; where nothing is laid out (jsdom) its height is 0. Either way the larger of it and `innerHeight` is the
 * answer, so what is sized from it never falls short of the window.
 */

/** The attribute the probe carries, so a test can give it a height. */
export const PROBE_ATTRIBUTE = 'data-kb-field-probe';

let probe: HTMLElement | null = null;

function probeHeight(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute(PROBE_ATTRIBUTE, '');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100lvh;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
  }
  return probe.getBoundingClientRect().height;
}

/** The large viewport's height in CSS px, never less than the window's inner height. */
export function largeViewportHeight(): number {
  return Math.max(probeHeight(), window.innerHeight);
}
