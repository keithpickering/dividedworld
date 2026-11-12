/**
 * A pictured pack's light (docs/plans/2026-11-12-booster-pack-render-design.md sections 3 and 7): a canvas laid over the pack's picture that
 * the page's shine loop lights with the pack's relief, a picture of which way each bit of the film faces. Engine code: it names no pack and
 * no instance. It is a `.ts` file, so the component is written with `createElement`.
 *
 * `loadRelief` decodes a relief once for the page: every pack showing the same relief at the same size shares one decode. A relief that cannot be
 * had (an image that does not load, a canvas with no 2D context, pixels the browser will not hand over) leaves the pack as its picture alone, with
 * one warning naming the address. The canvas is never sized past the relief's own 540 by 840.
 *
 * Units: `w` and `h` are canvas px; a relief's rows are canvas rows from the top; `rows` are shares of the box's height (`TEAR_HI`, `TEAR_LO`),
 * which are the tear line's two heights in pack.css.
 */
import { createElement, useEffect, useRef } from 'react';
import { lightRelief, makeRelief, type Relief } from '../shine/relief.ts';
import { MAX_DENSITY, register, unregister } from '../shine/loop.ts';

/** The relief's own size: a canvas never exceeds it. */
const MAX_W = 540;
const MAX_H = 840;
/** The tear's lower and upper points as shares of the pack's height, a little past pack.css's own (14 and 9 hundredths of the width, so 9.3% and 6% of the height) so the light covers the whole jag. */
const TEAR_HI = 0.14;
const TEAR_LO = 0.09;

const cache = new Map<string, Promise<Relief | null>>();

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
 * The relief at `reliefUrl` decoded at `w` by `h`, tinted from the picture at `pictureUrl`, or null. The promise is cached by the relief's address
 * and size. A picture that cannot be read while the relief can gives a relief with no tint.
 */
export function loadRelief(reliefUrl: string, pictureUrl: string, w: number, h: number): Promise<Relief | null> {
  const key = `${reliefUrl}|${w}|${h}`;
  const kept = cache.get(key);
  if (kept) return kept;
  const made = (async () => {
    try {
      const [relief, picture] = await Promise.all([image(reliefUrl), image(pictureUrl).catch(() => null)]);
      const normals = pixels(relief, w, h);
      let tint: Uint8ClampedArray | null = null;
      if (picture) { try { tint = pixels(picture, w, h); } catch { tint = null; } }
      return makeRelief(normals, tint, w, h);
    } catch (err) {
      console.warn(`The pack's relief ${reliefUrl} could not be used, so its light is left off:`, err);
      return null;
    }
  })();
  cache.set(key, made);
  return made;
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
    const start = (): void => {
      const here = ++ticket;
      const rect = canvas.getBoundingClientRect();
      box = { w: rect.width, h: rect.height };
      unregister(host);
      if (!(box.w > 0) || !(box.h > 0)) return;
      const density = Math.min(MAX_DENSITY, Math.max(0, window.devicePixelRatio || 1));
      const w = Math.min(MAX_W, Math.max(1, Math.round(box.w * density)));
      const h = Math.min(MAX_H, Math.max(1, Math.round(box.h * density)));
      void loadRelief(relief, picture, w, h).then((loaded) => {
        if (!live || here !== ticket || !loaded) return;
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
        register(host, canvas, box, density, (f) => { frameLight = f.light; return draw(); }, {
          quiet: true,
          hidden: () => { canvas.width = 0; canvas.height = 0; data = null; },
        });
      });
    };
    start();
    /* The slot's zoom and the opening's `--kb-parked-w` change the box without a remount. */
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width !== box.w || rect.height !== box.h) start();
      });
      observer.observe(canvas);
    }
    return () => { live = false; ticket++; observer?.disconnect(); unregister(host); };
  }, [picture, relief, part]);
  return createElement('canvas', { ref, className: 'kb-pack-light' });
}
