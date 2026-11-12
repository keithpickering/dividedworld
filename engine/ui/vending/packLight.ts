/**
 * A pictured pack's light (docs/plans/2026-11-12-booster-pack-render-design.md sections 3 and 7): a canvas laid over the pack's picture that
 * the page's shine loop lights with the pack's relief, a picture of which way each bit of the film faces. Engine code: it names no pack and
 * no instance. It is a `.ts` file, so the component is written with `createElement`.
 *
 * `loadRelief` decodes a relief once for the page: every pack showing the same relief at the same size shares one decode. A relief that cannot be
 * had (an image that does not load, a canvas with no 2D context, pixels the browser will not hand over) leaves the pack as its picture alone, with
 * one warning naming the address. The canvas is never sized past the relief's own 540 by 840.
 *
 * Units: `w` and `h` are canvas px; a relief's rows are canvas rows from the top; `rows` are shares of the bitmap's height (`TEAR_HI`, `TEAR_LO`).
 * The picture is as tall as the pack's 2:3 box, so the bitmap's height is the box's height and the shares are shares of the pack's height.
 */
import { createElement, useEffect, useRef } from 'react';
import { lightRelief, makeRelief, type Relief } from '../shine/relief.ts';
import { MAX_DENSITY, register, unregister } from '../shine/loop.ts';

/** The relief's own size: a canvas never exceeds it. */
const MAX_W = 540;
const MAX_H = 840;
/**
 * The tear's lower and upper points as shares of the pack's height. These are the plan's numbers (14% and 9%), not pack.css's own heights (about
 * 9.3% and 6% of the height): they overshoot the tear's own heights, about half again, so each torn part lights its whole jagged edge, and the
 * part's clip-path in pack.css cuts what overshoots.
 */
const TEAR_HI = 0.14;
const TEAR_LO = 0.09;
/** A box change restarts the light only once the box has held still this long (trailing), so a drag across many sizes decodes once. */
export const RESIZE_DEBOUNCE_MS = 150;

/**
 * One decode per relief address and size, counted by the mounted lights using it: the last release drops it (a full-size Relief is about 8.6 MB,
 * and a window resize, a zoom or the opening's park would otherwise keep one per size for the life of the page).
 */
const cache = new Map<string, { readonly made: Promise<Relief | null>; users: number }>();
/** Relief addresses that could not be used: remembered per address, not per size, so the warning is once for the page and nothing is fetched again. */
const failed = new Set<string>();
const keyOf = (reliefUrl: string, w: number, h: number): string => `${reliefUrl}|${w}|${h}`;

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** The pixels of `img` drawn at `w` by `h`; throws where there is no 2D context or the image is cross-origin and unreadable. */
function pixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D context');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * The relief at `reliefUrl` decoded at `w` by `h`, tinted from the picture at `pictureUrl`, or null. Every call is one use of the entry for that
 * address and size, which stays until each use is given back with `releaseRelief` (a call for an address that failed uses nothing and needs no
 * release; releasing it is harmless). A picture that cannot be read while the relief can gives a relief with no tint.
 */
export function loadRelief(reliefUrl: string, pictureUrl: string, w: number, h: number): Promise<Relief | null> {
  if (failed.has(reliefUrl)) return Promise.resolve(null);
  const key = keyOf(reliefUrl, w, h);
  const kept = cache.get(key);
  if (kept) { kept.users++; return kept.made; }
  const made = (async () => {
    try {
      const [relief, picture] = await Promise.all([image(reliefUrl), image(pictureUrl).catch(() => null)]);
      const normals = pixels(relief, w, h);
      let tint: Uint8ClampedArray | null = null;
      if (picture) { try { tint = pixels(picture, w, h); } catch { tint = null; } }
      return makeRelief(normals, tint, w, h);
    } catch (err) {
      if (!failed.has(reliefUrl)) {
        failed.add(reliefUrl);
        console.warn(`The pack's relief ${reliefUrl} could not be used, so its light is left off:`, err);
      }
      return null;
    }
  })();
  cache.set(key, { made, users: 1 });
  return made;
}

/** Gives back one use taken by `loadRelief` with the same address and size; the last release drops the decode. */
export function releaseRelief(reliefUrl: string, w: number, h: number): void {
  const key = keyOf(reliefUrl, w, h);
  const entry = cache.get(key);
  if (!entry) return;
  if (--entry.users <= 0) cache.delete(key);
}

/**
 * The bitmap for a box of `boxW` by `boxH` canvas-density px: the largest 540:840 shape that fits inside the box, never past 540 by 840. A pack's
 * picture and relief are 9:14 and `object-fit: contain` letterboxes the picture in the (2:3) box, so a bitmap of this shape is letterboxed the
 * same way and sits exactly over the picture.
 */
export function bitmapFor(boxW: number, boxH: number, density: number): { w: number; h: number } {
  const scale = Math.min(1, (boxW * density) / MAX_W, (boxH * density) / MAX_H);
  return { w: Math.max(1, Math.round(MAX_W * scale)), h: Math.max(1, Math.round(MAX_H * scale)) };
}

export interface PackLightProps {
  readonly picture: string;
  readonly relief: string;
  readonly part: 'whole' | 'opened' | 'top';
}

/** The rows of a `h`-row canvas the part lights: the top piece to the tear's lower points, the body from its upper points, a whole pack all. */
const rowsOf = (part: PackLightProps['part'], h: number): { top: number; bottom: number } | undefined => {
  if (part === 'top') return { top: 0, bottom: Math.round(TEAR_HI * h) };
  if (part === 'opened') return { top: Math.round(TEAR_LO * h), bottom: h };
  return undefined;
};

export function PackLight({ picture, relief, part }: PackLightProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const host = {};
    let live = true;
    let box = { w: 0, h: 0 };
    let ticket = 0;
    /* The size whose relief the registration now draws from, holding one use of its entry. */
    let held: { w: number; h: number } | null = null;
    const giveBack = (): void => { if (held) releaseRelief(relief, held.w, held.h); held = null; };
    const start = (): void => {
      const here = ++ticket;
      const rect = canvas.getBoundingClientRect();
      box = { w: rect.width, h: rect.height };
      if (!(box.w > 0) || !(box.h > 0)) { unregister(host); giveBack(); return; }
      const density = Math.min(MAX_DENSITY, Math.max(0, window.devicePixelRatio || 1));
      const { w, h } = bitmapFor(box.w, box.h, density);
      const seen = box;
      /* The registration already drawing stays until this size's relief is ready; then it is swapped. */
      void loadRelief(relief, picture, w, h).then((loaded) => {
        if (!live || here !== ticket || !loaded) { releaseRelief(relief, w, h); return; }
        giveBack();
        held = { w, h };
        const rows = rowsOf(part, h);
        let data: ImageData | null = null;
        let frameLight = { x: 0, y: 0 };
        const draw = (): boolean => {
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; data = null; }
          const ctx = canvas.getContext('2d');
          if (!ctx) return false;
          data ??= ctx.createImageData(w, h);
          lightRelief(loaded, frameLight, data.data, rows);
          ctx.putImageData(data, 0, 0);
          return false;
        };
        register(host, canvas, seen, density, (f) => { frameLight = f.light; return draw(); }, {
          quiet: true,
          hidden: () => { canvas.width = 0; canvas.height = 0; data = null; },
        });
      });
    };
    start();
    /* The slot's zoom and the opening's `--kb-parked-w` change the box without a remount; the restart waits until the box holds still. */
    let observer: ResizeObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const rect = canvas.getBoundingClientRect();
          if (rect.width !== box.w || rect.height !== box.h) start();
        }, RESIZE_DEBOUNCE_MS);
      });
      observer.observe(canvas);
    }
    return () => { live = false; ticket++; clearTimeout(timer); observer?.disconnect(); unregister(host); giveBack(); };
  }, [picture, relief, part]);
  return createElement('canvas', { ref, className: 'kb-pack-light' });
}
