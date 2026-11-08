/**
 * The glass's field of clouds, rasterized (the glass polish design, section 6). The smoke is one
 * field in the viewport's coordinates and every surface is a window onto it, so each layer's noise
 * is drawn once, here, to an image, and a window draws the layer as an element masked by that
 * image. The filter (feTurbulence, a color matrix, a blur) runs once per field, width class and
 * device pixel ratio, not once per window and never per frame; what moves a frame is a composited
 * transform.
 *
 * The images are `blob:` URLs, which cost memory until they are revoked, so the cache is one object
 * for the whole page, shared by every window, and it holds exactly one set: the layers of the
 * field in the width class the viewport is in, at the pixel ratio it is drawn at. Asking for
 * another set (the class changed, the ratio changed, the field changed) revokes the old one at
 * once. A window going away does not: a crossing between the board and a glass page unmounts the
 * HUD's window and mounts the page's in the same commit, and giving the rasters back between the two
 * would make every crossing a re-rasterization. The last window going away starts a grace
 * (`GRACE_MS`), and a window coming back inside it keeps the set; at its end everything is revoked.
 * So the live URLs are, at any moment, the one set's, and a long session of crossings holds the
 * same few images it started with.
 *
 * On a resize inside a width class the raster is kept and drawn stretched (`mask-size: 100% 100%`,
 * Smoke.tsx): the noise is blurred, so a small stretch is invisible, and re-rasterizing a layer on
 * every frame of a window drag would cost more than the stretch shows. A phone's address bar showing
 * and hiding is not a resize here at all: the field's height is the large viewport's (viewport.ts). Past a stretch of 15% across
 * or 25% down, once the window has been still for `RESIZE_MS`, the set is made again at the new
 * size, and the old one is revoked only when the new one is whole, so no frame is without smoke.
 *
 * Each layer is rasterized the viewport's width plus its own drift travel wide, so that sliding it
 * left by the travel never bares its right edge (the strips the HUD's smoke drifted on before the
 * field were wider than their frame for the same reason).
 *
 * `rasterize` is the one function that touches a canvas; jsdom has none, so the cache takes it as a
 * parameter and tests give it a stand-in. Where the browser cannot draw the image (no 2d context,
 * a canvas that will not allocate) the layer is simply not drawn, and the
 * ground the page is legible on shows, as it does before the raster is ready.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { FieldLayer } from '../types.ts';
import { largeViewportHeight } from './viewport.ts';

/** A size in CSS pixels. */
export interface Size { readonly width: number; readonly height: number }

/** Draws one layer at `size` (CSS pixels) times `dpr` and returns the `blob:` URL of its image. */
export type Rasterize = (layer: FieldLayer, size: Size, dpr: number) => Promise<string>;

/** The width below which the field's narrow layers are drawn (base.css and tools/check-glass-contrast.mjs agree: 600px). */
export const NARROW_QUERY = '(max-width: 599.98px)';

/** How long the last window's going away waits for another before the rasters are revoked. */
export const GRACE_MS = 5000;

/**
 * Dispatched on `window` by a surface that has moved itself (an overlay, placed by its anchor), so the
 * windows it holds, and the calm regions on them, measure their place again: a placement is made after its children mount.
 */
export const FIELD_PLACED = 'kb-field-placed';
/** How long the window must be still before a stretched raster is made again. */
export const RESIZE_MS = 300;
/** A raster is made again once it would be stretched past this share of its width, or of its height. */
const STRETCH_X = 0.15;
const STRETCH_Y = 0.25;
/** The pixel ratio the field is rasterized at is capped here: the clouds are blurred, so more is memory for nothing. */
const MAX_DPR = 2;
/**
 * A layer's pixels, at most. A decoded layer is 4 bytes a pixel and the field holds four, so 6 million pixels each was about
 * 84MB at 1440 and ratio 2. The noise is blurred (a standard deviation of 9 to 18 CSS pixels), so nothing in it is finer than
 * a pixel and a layer drawn at 1.2 times and stretched by the browser looks the same: 2 million is about 32MB for the four.
 */
const MAX_PIXELS = 2_000_000;

/** The pixels a layer is drawn in for `size` CSS pixels at `dpr`: the ratio capped at 2, and lowered where the pixel budget needs it. */
export function rasterSize(size: Size, dpr: number): { readonly width: number; readonly height: number; readonly scale: number } {
  let scale = Math.min(Math.max(dpr || 1, 0.25), MAX_DPR);
  const area = size.width * size.height;
  if (area * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / area);
  return { width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)), scale };
}

const hex = (n: number) => Math.round(n * 1000) / 1000;

/** The SVG of a layer (exported as `fieldLayerSvg`): its noise, turned to white with the layer's alpha row, blurred, in sRGB (the guard's numbers are sRGB). */
export function fieldLayerSvg(layer: FieldLayer, size: Size, pixels: { readonly width: number; readonly height: number }): string {
  const matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, ...layer.alpha.map(hex)].join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels.width}" height="${pixels.height}" viewBox="0 0 ${size.width} ${size.height}">`
    + '<filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
    + `<feTurbulence type="fractalNoise" baseFrequency="${layer.frequency.join(' ')}" numOctaves="${layer.octaves}" seed="${layer.seed}"/>`
    + `<feColorMatrix type="matrix" values="${matrix}"/><feGaussianBlur stdDeviation="${layer.blur}"/></filter>`
    + '<rect width="100%" height="100%" filter="url(#f)"/></svg>';
}

/**
 * The real rasterizer: the layer's SVG as an image, drawn to a canvas at the ratio, kept as a PNG
 * `blob:` URL. The image is only the noise's alpha (its color is white; the window's own
 * background-color is the layer's color), so it is used as a mask.
 */
export const rasterize: Rasterize = async (layer, size, dpr) => {
  if (typeof Image !== 'function' || typeof document === 'undefined') throw new Error('this browser cannot rasterize the field');
  const pixels = rasterSize(size, dpr);
  const url = URL.createObjectURL(new Blob([fieldLayerSvg(layer, size, pixels)], { type: 'image/svg+xml' }));
  try {
    /* The SVG's own width and height are the pixels, so the image is drawn straight to the canvas at that size; no bitmap in between to be closed. */
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('the field\'s canvas has no 2d context');
    ctx.drawImage(img, 0, 0, pixels.width, pixels.height);
    const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    /* The canvas's own bytes are no use once it is a PNG; a zero size lets the browser free them now rather than at collection. */
    canvas.width = canvas.height = 0;
    if (!png) throw new Error('the canvas gave no image');
    return URL.createObjectURL(png);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** What the cache holds: the key of the set (`keyOf`) and each layer's URL, null where it is not ready or could not be made. */
export interface RasterSet {
  readonly key: string;
  readonly urls: readonly (string | null)[];
}

/** The size a layer is rasterized at: the viewport, and the layer's travel more across. */
const layerSize = (layer: FieldLayer, view: Size): Size => ({ width: view.width + layer.drift.travel, height: view.height });

/** Whether a raster made for `made` would be stretched past what the eye takes in drawn at `now`. */
const stale = (made: Size, now: Size): boolean =>
  Math.abs(now.width - made.width) / made.width > STRETCH_X || Math.abs(now.height - made.height) / made.height > STRETCH_Y;

/** An object's identity as a short number, for a key: the field's layers are one array the glass holds for the page's life. */
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object): number => { let id = ids.get(o); if (id === undefined) { id = nextId++; ids.set(o, id); } return id; };

/**
 * A cache of the field's rasters. `acquire` says a window wants the set and hands back what ends
 * its want; `get` and `subscribe` are a store for `useSyncExternalStore`. `rasterizer` is called as
 * it is written, so a test can change it; `revoke` defaults to `URL.revokeObjectURL`, looked up when
 * it is called.
 */
export function createRasters(initial: Rasterize = rasterize, revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)) {
  let raster = initial;
  let snapshot: RasterSet = { key: '', urls: [] };
  const listeners = new Set<() => void>();
  /* What is wanted: the layers, the ratio and the size the raster in `snapshot` was made for. */
  let layers: readonly FieldLayer[] | null = null;
  let dpr = 1;
  let made: Size = { width: 0, height: 0 };
  let latest: Size = made;
  let holders = 0;
  /* Each (re)start of the set is a generation; an answer from an earlier one is revoked on arrival. */
  let generation = 0;
  let grace: ReturnType<typeof setTimeout> | null = null;
  let still: ReturnType<typeof setTimeout> | null = null;

  const emit = () => { for (const l of listeners) l(); };
  const publish = (next: RasterSet) => { snapshot = next; emit(); };
  const revokeAll = (urls: readonly (string | null)[]) => { for (const u of urls) if (u !== null) revoke(u); };
  const cancel = (t: ReturnType<typeof setTimeout> | null) => { if (t !== null) clearTimeout(t); };

  const keyOf = (l: readonly FieldLayer[], ratio: number) => `${idOf(l)}@${Math.min(Math.max(ratio || 1, 0.25), MAX_DPR)}`;

  /**
   * Makes the set for `l` at `view`: one raster a layer, answered as each is ready. With `keep` the
   * set already shown stays until the new one is whole, and then it is swapped and revoked (a
   * resize); without it the old set is revoked now (another field, class or ratio).
   */
  function build(l: readonly FieldLayer[], view: Size, keep: boolean) {
    const mine = ++generation;
    const key = keyOf(l, dpr);
    made = view;
    const got: (string | null)[] = l.map(() => null);
    if (!keep) {
      revokeAll(snapshot.urls);
      publish({ key, urls: got.slice() });
    }
    let left = l.length;
    /* In a rebuild, a layer that fails keeps the URL it had (and it is not revoked below), so a failure costs one new raster, not the layer for the session. */
    const carried: boolean[] = l.map(() => false);
    l.forEach((layer, i) => {
      raster(layer, layerSize(layer, view), dpr).then(
        (url) => {
          if (mine !== generation) { revoke(url); return; }
          got[i] = url;
          if (!keep) publish({ key, urls: got.slice() });
        },
        () => {
          /* In a first build this layer stays undrawn and the others still draw; in a rebuild it keeps its old raster. */
          if (mine !== generation || !keep) return;
          got[i] = snapshot.urls[i] ?? null;
          carried[i] = got[i] !== null;
        },
      ).finally(() => {
        if (mine !== generation || --left > 0 || !keep) return;
        /* Whole: the new set replaces the old in one step, and the old is given back. */
        const old = snapshot.urls;
        publish({ key, urls: got.slice() });
        revokeAll(old.filter((_, i) => !carried[i]));
      });
    });
  }

  function release() {
    generation++;
    cancel(still); still = null;
    revokeAll(snapshot.urls);
    layers = null;
    made = latest = { width: 0, height: 0 };
    publish({ key: '', urls: [] });
  }

  return {
    keyOf,
    get: (): RasterSet => snapshot,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /**
     * A window wants the field's `l` at `ratio`, the viewport being `view`. The same want as the one
     * held changes nothing; another set replaces it. Returns the call that ends this want, which
     * counts once however often it is called.
     */
    acquire(l: readonly FieldLayer[], ratio: number, view: Size): () => void {
      holders++;
      cancel(grace); grace = null;
      const key = keyOf(l, ratio);
      latest = view;
      if (layers === null || key !== snapshot.key) {
        cancel(still); still = null;
        layers = l;
        dpr = ratio;
        build(l, view, false);
      }
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        if (--holders > 0) return;
        cancel(grace);
        grace = setTimeout(() => { grace = null; if (holders === 0) release(); }, GRACE_MS);
      };
    },

    /** The viewport is now `view`: kept as it is, stretched, until it would show, and made again after it has been still. */
    resize(view: Size) {
      latest = view;
      cancel(still); still = null;
      if (layers === null || !stale(made, view)) return;
      still = setTimeout(() => {
        still = null;
        if (layers !== null && stale(made, latest)) build(layers, latest, true);
      }, RESIZE_MS);
    },

    /** The one function that draws, replaced by a test (jsdom has no canvas). */
    setRasterizer(next: Rasterize) { raster = next; },

    /** Gives everything back at once and forgets what was wanted (a test's reset; the page never needs it). */
    reset() { cancel(grace); grace = null; holders = 0; release(); },
  };
}

/** The page's cache: one for every window of every surface. */
export const fieldRasters = createRasters();

/** The viewport's width class, pixel ratio and size, kept current. */
export interface FieldEnv { readonly narrow: boolean; readonly dpr: number; readonly view: Size }

/**
 * The size windows are drawn to: the layout viewport's width, which a scrollbar's width is not part of, and the large viewport's
 * height (viewport.ts). The layers' mask is drawn at 100% of their height, so a field as tall as `innerHeight` squashed and
 * stretched its clouds whenever a phone's address bar turned. Drawn to the large viewport, anchored at the window's top, the field
 * holds still, and while the bar shows its foot is cut off by the window's own `overflow: hidden` rather than squeezed.
 */
function viewport(): Size {
  return { width: document.documentElement.clientWidth || window.innerWidth, height: largeViewportHeight() };
}

function envNow(): FieldEnv {
  return {
    narrow: typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches,
    dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    view: viewport(),
  };
}

const same = (a: FieldEnv, b: FieldEnv) => a.narrow === b.narrow && a.dpr === b.dpr && a.view.width === b.view.width && a.view.height === b.view.height;

/*
 * One watch on the window for every Smoke on the page, not one each: a busy screen has a window for the page, the HUD, the hand
 * and every open overlay. The listeners are on while any window is subscribed. A resize (which a zoom also is) is gathered into
 * one reading a frame; the width class's media query is read at once, as a class change is rare and wants no frame of the wrong set.
 */
let env: FieldEnv | null = null;
const watchers = new Set<() => void>();
let off: (() => void) | null = null;

function refresh() {
  const now = envNow();
  if (env && same(env, now)) return;
  env = now;
  for (const w of watchers) w();
}

function attach(): () => void {
  const mq = typeof matchMedia === 'function' ? matchMedia(NARROW_QUERY) : null;
  let frame: number | null = null;
  const soon = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; refresh(); }); };
  mq?.addEventListener('change', refresh);
  window.addEventListener('resize', soon);
  return () => {
    mq?.removeEventListener('change', refresh);
    window.removeEventListener('resize', soon);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

function subscribeEnv(watcher: () => void): () => void {
  if (watchers.size === 0) { env = envNow(); off = attach(); }
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
    /* Nobody is watching, so what was read is going stale: the next window reads afresh. */
    if (watchers.size === 0) { off?.(); off = null; env = null; }
  };
}

const getEnv = (): FieldEnv => env ?? (env = envNow());

/** Where the window is: below 600px or not, at what pixel ratio and size, following a resize, a zoom and the class's media query. */
export function useFieldEnv(): FieldEnv {
  return useSyncExternalStore(subscribeEnv, getEnv, getEnv);
}

/**
 * The URLs of `layers`' rasters, each null until it is ready; all null while `layers` is null (no
 * window draws: smoke Off) or while the cache holds another set. Holds the want while mounted.
 */
export function useFieldRasters(layers: readonly FieldLayer[] | null, env: FieldEnv): readonly (string | null)[] {
  const snap = useSyncExternalStore(fieldRasters.subscribe, fieldRasters.get, fieldRasters.get);
  const { dpr, view } = env;
  useEffect(() => {
    if (!layers) return;
    return fieldRasters.acquire(layers, dpr, view);
    /* The size is not a dependency: a resize is told to the cache, which decides whether it is worth a new raster. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, dpr]);
  useEffect(() => { if (layers) fieldRasters.resize(view); }, [layers, view]);
  return layers && snap.key === fieldRasters.keyOf(layers, dpr) ? snap.urls : [];
}
