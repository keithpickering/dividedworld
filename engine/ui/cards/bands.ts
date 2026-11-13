/**
 * The band watcher (docs/plans/2026-11-12-whoops-followups-design.md, section 1). An effect that paints a post as tall as the body can be
 * thousands of px of canvas, more than a browser or a phone will hold at once, so it paints only the slices of the box that are near the
 * screen. This cuts a box into bands of a fixed height, places one empty element over each (invisible, never hit, hidden from assistive
 * tech), and lets the browser say which are near: every element is watched with `watchInView` at one `rootMargin`, so the whole post's
 * bands share one IntersectionObserver rather than carrying one each. The watcher names no card and reads nothing about a post but its box.
 *
 * Reports are coalesced into one `requestAnimationFrame`: an observer may deliver forty entries in a callback, or several callbacks in a
 * frame, and the page wants one answer, the sorted indexes of the near bands, only when the set differs from the last one given. Time is
 * never read here (tools/check-one-clock.mjs); the frame is the only clock. Where the browser has no IntersectionObserver `watchInView`
 * counts every element in view, so every band is near and the effect paints the whole box as it would without bands.
 *
 * The elements are placed inline, so no stylesheet is needed to make them harmless; `kb-band` is the hook for a test or a stylesheet.
 */
import { watchInView } from '../shine/inView.ts';
import type { BodyBox } from './body.ts';

/** A band of a box: its offset from the box's top and its height, in CSS px. */
export interface Band {
  readonly top: number;
  readonly h: number;
}

/** What `watchBands` returns: `update` follows a new box, `stop` removes the elements and stops watching. */
export interface BandWatch {
  update(box: BodyBox): void;
  stop(): void;
}

/** The bands of a box `h` px tall, top to bottom, each `bandPx` tall and the last what is left (never empty); a box of no height has none. */
export function bandsOf(h: number, bandPx: number): Band[] {
  const out: Band[] = [];
  if (!(h > 0) || !(bandPx > 0)) return out;
  for (let top = 0; top < h; top += bandPx) out.push({ top, h: Math.min(bandPx, h - top) });
  return out;
}

interface Slot { readonly el: HTMLElement; near: boolean; stop: () => void }

/**
 * Places one element per band of `box` in `host` (an absolutely positioned layer's parent, as `placeLayer` assumes), watches each at
 * `margin` (an IntersectionObserver `rootMargin`), and calls `onChange` with the sorted indexes of the near bands when that set changes,
 * at most once a frame.
 */
export function watchBands(host: HTMLElement, box: BodyBox, bandPx: number, margin: string, onChange: (near: number[]) => void): BandWatch {
  const slots: Slot[] = [];
  let reported = '';
  let frame: number | null = null;
  let stopped = false;

  const flush = () => {
    frame = null;
    if (stopped) return;
    const near: number[] = [];
    slots.forEach((s, i) => { if (s.near) near.push(i); });
    const key = near.join(',');
    if (key === reported) return;
    reported = key;
    onChange(near);
  };
  const soon = () => { if (frame === null && !stopped) frame = requestAnimationFrame(flush); };

  const place = (el: HTMLElement, band: Band) => {
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top + band.top}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${band.h}px`;
  };
  const drop = (s: Slot) => { s.stop(); s.el.remove(); };

  const fit = (to: BodyBox) => {
    /* A late resize after the watcher is let go would place elements nothing ever removes. */
    if (stopped) return;
    box = to;
    const bands = bandsOf(box.h, bandPx);
    while (slots.length > bands.length) drop(slots.pop()!);
    bands.forEach((band, i) => {
      let slot = slots[i];
      if (!slot) {
        const el = document.createElement('div');
        el.className = 'kb-band';
        el.setAttribute('aria-hidden', 'true');
        el.style.position = 'absolute';
        el.style.pointerEvents = 'none';
        host.appendChild(el);
        const made: Slot = { el, near: false, stop: () => {} };
        /* Where there is no observer the callback runs at once, before `stop` is set, which is fine: only `near` is read. */
        made.stop = watchInView(el, (inView) => { made.near = inView; soon(); }, { rootMargin: margin });
        slot = made;
        slots.push(slot);
      }
      place(slot.el, band);
    });
    soon();
  };

  fit(box);
  return {
    update: fit,
    stop() {
      stopped = true;
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = null;
      while (slots.length) drop(slots.pop()!);
    },
  };
}
